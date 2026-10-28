import { hash, verify } from '@node-rs/argon2';
import type { Response } from 'express';
import type { AccountStatus, SessionUser, UserRole } from '@poi/shared';
import { capabilitiesForRole } from '@poi/shared';
import { getEnv } from '../../config/env.js';
import { withTransaction, query } from '../../db/pool.js';
import { randomToken, sha256Hex } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../middleware/auth.js';
import { appendAuditEvent, AUDIT_ACTIONS } from '../audit/audit.service.js';

const ARGON_OPTIONS = {
  // 2 is Argon2id; the library exposes it only as an ambient const enum, which this build cannot import.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: AccountStatus;
  is_demo: boolean;
}

export function mapSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    isDemo: row.is_demo,
    capabilities: capabilitiesForRole(row.role),
  };
}

function cookieOptions(maxAgeMs?: number) {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.clearCookie(CSRF_COOKIE, { ...cookieOptions(), httpOnly: false });
}

interface SessionTokens {
  sessionToken: string;
  csrfToken: string;
  tokenHash: string;
  csrfHash: string;
  expiresAt: Date;
}

function buildSessionTokens(): SessionTokens {
  const sessionToken = randomToken(32);
  const csrfToken = randomToken(32);
  const ttlMs = getEnv().SESSION_TTL_HOURS * 3_600_000;
  return {
    sessionToken,
    csrfToken,
    tokenHash: sha256Hex(sessionToken),
    csrfHash: sha256Hex(csrfToken),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

function applySessionCookies(res: Response, tokens: SessionTokens): void {
  const maxAge = tokens.expiresAt.getTime() - Date.now();
  res.cookie(SESSION_COOKIE, tokens.sessionToken, cookieOptions(maxAge));
  res.cookie(CSRF_COOKIE, tokens.csrfToken, {
    ...cookieOptions(maxAge),
    httpOnly: false,
  });
}

let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hash(randomToken(24), ARGON_OPTIONS);
  }
  return dummyHashPromise;
}

export async function registerObserver(
  input: { fullName: string; email: string; password: string },
  context: { ip?: string; userAgent?: string },
  res: Response,
): Promise<SessionUser> {
  const email = input.email.trim().toLowerCase();
  const existing = await query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
  if (existing.rowCount) throw conflict('An account with that email already exists');

  const passwordHash = await hash(input.password, ARGON_OPTIONS);
  const tokens = buildSessionTokens();

  const user = await withTransaction(async (client) => {
    const inserted = await client.query<UserRow>(
      `INSERT INTO users (email, full_name, password_hash, role, status)
       VALUES ($1,$2,$3,'OBSERVER','ACTIVE')
       RETURNING id, email, full_name, role, status, is_demo`,
      [email, input.fullName, passwordHash],
    );
    const row = inserted.rows[0];
    if (!row) throw new AppError(500, 'REGISTRATION_FAILED', 'The account could not be created');
    await appendAuditEvent(client, {
      actorId: row.id,
      actorRole: row.role,
      action: AUDIT_ACTIONS.USER_REGISTERED,
      entityType: 'USER',
      entityId: row.id,
      summary: 'A public observer account registered.',
    });
    await client.query(
      `INSERT INTO sessions (user_id, token_hash, csrf_token_hash, expires_at, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.id, tokens.tokenHash, tokens.csrfHash, tokens.expiresAt, context.ip ?? null, context.userAgent?.slice(0, 500) ?? null],
    );
    return row;
  });

  applySessionCookies(res, tokens);
  return mapSessionUser(user);
}

export async function login(
  input: { email: string; password: string },
  context: { ip?: string; userAgent?: string },
  res: Response,
): Promise<SessionUser> {
  const email = input.email.trim().toLowerCase();
  const result = await query<UserRow & { password_hash: string }>(
    `SELECT id, email, full_name, role, status, is_demo, password_hash
       FROM users WHERE lower(email) = $1 LIMIT 1`,
    [email],
  );
  const row = result.rows[0];

  if (!row) {
    await verify(await getDummyHash(), input.password).catch(() => false);
    throw unauthorized('Email or password is incorrect');
  }

  const passwordMatches = await verify(row.password_hash, input.password).catch(() => false);
  if (!passwordMatches) {
    throw unauthorized('Email or password is incorrect');
  }
  if (row.status !== 'ACTIVE') {
    throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is not active. Contact a platform administrator.');
  }

  const tokens = buildSessionTokens();
  await withTransaction(async (client) => {
    await client.query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
    await client.query(
      `INSERT INTO sessions (user_id, token_hash, csrf_token_hash, expires_at, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.id, tokens.tokenHash, tokens.csrfHash, tokens.expiresAt, context.ip ?? null, context.userAgent?.slice(0, 500) ?? null],
    );
  });

  applySessionCookies(res, tokens);
  return mapSessionUser(row);
}

export async function logout(sessionId: string, res: Response): Promise<void> {
  await query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [sessionId]);
  clearAuthCookies(res);
}

export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
  res: Response,
): Promise<void> {
  const result = await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId]);
  const row = result.rows[0];
  if (!row) throw unauthorized();
  if (input.currentPassword === input.newPassword) {
    throw badRequest('The new password must differ from the current password');
  }
  const matches = await verify(row.password_hash, input.currentPassword).catch(() => false);
  if (!matches) throw badRequest('The current password is incorrect');

  const newHash = await hash(input.newPassword, ARGON_OPTIONS);
  await withTransaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, newHash]);
    await client.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
    await appendAuditEvent(client, {
      actorId: userId,
      actorRole: null,
      action: 'USER_PASSWORD_CHANGED',
      entityType: 'USER',
      entityId: userId,
      summary: 'A user changed their password and all sessions were revoked.',
    });
  });
  clearAuthCookies(res);
}

export async function getActiveAdminCount(): Promise<number> {
  const result = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
  return Number(result.rows[0]?.count ?? 0);
}
