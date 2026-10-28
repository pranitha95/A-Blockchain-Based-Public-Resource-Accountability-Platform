import type { RequestHandler } from 'express';
import { capabilitiesForRole, type Capabilities, type SessionUser, type UserRole } from '@poi/shared';
import { query } from '../db/pool.js';
import { sha256Hex } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export const SESSION_COOKIE = 'poi_session';
export const CSRF_COOKIE = 'poi_csrf';

interface SessionRow {
  session_id: string;
  csrf_token_hash: string;
  last_seen_at: Date;
  user_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  is_demo: boolean;
}

export const loadSession: RequestHandler = async (req, res, next) => {
  req.auth = null;
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) {
    next();
    return;
  }

  try {
    const result = await query<SessionRow>(
      `SELECT s.id AS session_id, s.csrf_token_hash, s.last_seen_at,
              u.id AS user_id, u.email, u.full_name, u.role, u.status, u.is_demo
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
        LIMIT 1`,
      [sha256Hex(token)],
    );

    const row = result.rows[0];
    if (!row || row.status !== 'ACTIVE') {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.clearCookie(CSRF_COOKIE, { path: '/' });
      next();
      return;
    }

    const user: SessionUser = {
      id: row.user_id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      status: row.status,
      isDemo: row.is_demo,
      capabilities: capabilitiesForRole(row.role),
    };
    req.auth = { user, sessionId: row.session_id, csrfTokenHash: row.csrf_token_hash };

    if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
      await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const optionalAuth: RequestHandler = (_req, _res, next) => {
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(unauthorized());
    return;
  }
  next();
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.auth.user.role)) {
      next(forbidden());
      return;
    }
    next();
  };
}

export function requireCapability(capability: keyof Capabilities): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }
    if (!req.auth.user.capabilities[capability]) {
      next(forbidden());
      return;
    }
    next();
  };
}

export function currentUser(req: { auth: Express.Request['auth'] }): SessionUser {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
}
