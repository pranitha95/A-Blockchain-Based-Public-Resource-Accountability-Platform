import { hash } from '@node-rs/argon2';
import type { AccountStatus, UserRole } from '@poi/shared';
import { withTransaction, query } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { paginationFromQuery, totalPages } from '../../lib/http.js';
import { appendAuditEvent, AUDIT_ACTIONS } from '../audit/audit.service.js';
import type { PaginatedResult } from '@poi/shared';

// 2 is Argon2id; the library exposes it only as an ambient const enum, which this build cannot import.
const ARGON_OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export interface AdminUserView {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: AccountStatus;
  isDemo: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

function mapUser(row: Record<string, unknown>): AdminUserView {
  return {
    id: String(row.id),
    email: String(row.email),
    fullName: String(row.full_name),
    role: row.role as UserRole,
    status: row.status as AccountStatus,
    isDemo: Boolean(row.is_demo),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at as string | Date).toISOString() : null,
  };
}

export async function listUsers(options: {
  search?: string;
  role?: UserRole;
  status?: AccountStatus;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResult<AdminUserView>> {
  const pagination = paginationFromQuery({ page: options.page ?? 1, pageSize: options.pageSize ?? 20 }, 20);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(`(full_name ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  if (options.role) {
    params.push(options.role);
    conditions.push(`role = $${params.length}`);
  }
  if (options.status) {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users ${where}`, params);
  const total = Number(countResult.rows[0]?.count ?? 0);
  const result = await query(
    `SELECT id, email, full_name, role, status, is_demo, created_at, last_login_at
       FROM users ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.pageSize, pagination.offset],
  );
  return {
    items: result.rows.map(mapUser),
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: totalPages(total, pagination.pageSize),
  };
}

export async function listReviewers(search?: string): Promise<{ id: string; fullName: string; email: string }[]> {
  const params: unknown[] = [];
  let condition = "role = 'REVIEWER' AND status = 'ACTIVE'";
  if (search) {
    params.push(`%${search}%`);
    condition += ` AND (full_name ILIKE $1 OR email ILIKE $1)`;
  }
  const result = await query<{ id: string; full_name: string; email: string }>(
    `SELECT id, full_name, email FROM users WHERE ${condition} ORDER BY full_name ASC LIMIT 100`,
    params,
  );
  return result.rows.map((row) => ({ id: row.id, fullName: row.full_name, email: row.email }));
}

export async function createUserByAdmin(
  input: { fullName: string; email: string; password: string; role: UserRole },
  actor: { id: string; role: UserRole },
): Promise<AdminUserView> {
  const email = input.email.trim().toLowerCase();
  const existing = await query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
  if (existing.rowCount) throw conflict('A user with that email already exists');
  const passwordHash = await hash(input.password, ARGON_OPTIONS);

  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO users (email, full_name, password_hash, role, status)
       VALUES ($1,$2,$3,$4,'ACTIVE')
       RETURNING id, email, full_name, role, status, is_demo, created_at, last_login_at`,
      [email, input.fullName, passwordHash, input.role],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('User insert returned no row');
    await appendAuditEvent(client, {
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.USER_CREATED,
      entityType: 'USER',
      entityId: row.id,
      summary: `Administrator created a ${input.role.toLowerCase().replace('_', ' ')} account.`,
      metadata: { role: input.role },
    });
    return mapUser(row);
  });
}

export async function updateUserByAdmin(
  userId: string,
  input: { role?: UserRole; status?: AccountStatus; fullName?: string },
  actor: { id: string; role: UserRole },
): Promise<AdminUserView> {
  return withTransaction(async (client) => {
    const currentResult = await client.query(
      'SELECT id, email, full_name, role, status, is_demo, created_at, last_login_at FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const current = currentResult.rows[0];
    if (!current) throw notFound('User not found');
    const currentRole = current.role as UserRole;

    if (userId === actor.id && (input.role !== undefined && input.role !== currentRole)) {
      throw badRequest('You cannot change your own administrator role');
    }
    if (userId === actor.id && input.status !== undefined && input.status !== 'ACTIVE') {
      throw badRequest('You cannot deactivate your own account');
    }

    if (input.role !== undefined && input.role !== currentRole) {
      if (currentRole === 'PROJECT_OWNER') {
        const owned = await client.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM projects WHERE owner_id = $1',
          [userId],
        );
        if (Number(owned.rows[0]?.count ?? 0) > 0) {
          throw conflict('Reassign this user’s projects before changing their role away from project owner');
        }
      }
      if (currentRole === 'REVIEWER') {
        const assignments = await client.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM reviewer_assignments WHERE reviewer_id = $1 AND active',
          [userId],
        );
        if (Number(assignments.rows[0]?.count ?? 0) > 0) {
          throw conflict('Remove this reviewer’s active assignments before changing their role');
        }
      }
    }

    if (
      currentRole === 'ADMIN' &&
      current.status === 'ACTIVE' &&
      ((input.role !== undefined && input.role !== 'ADMIN') || (input.status !== undefined && input.status !== 'ACTIVE'))
    ) {
      const admins = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'",
      );
      if (Number(admins.rows[0]?.count ?? 0) <= 1) {
        throw conflict('At least one active platform administrator must remain');
      }
    }

    const newRole = input.role ?? currentRole;
    const newStatus = input.status ?? (current.status as AccountStatus);
    const newName = input.fullName ?? (current.full_name as string);
    const updated = await client.query(
      `UPDATE users SET role = $2, status = $3, full_name = $4 WHERE id = $1
       RETURNING id, email, full_name, role, status, is_demo, created_at, last_login_at`,
      [userId, newRole, newStatus, newName],
    );
    const row = updated.rows[0];
    if (!row) throw new Error('User update returned no row');

    if (newRole !== currentRole) {
      await appendAuditEvent(client, {
        actorId: actor.id,
        actorRole: actor.role,
        action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
        entityType: 'USER',
        entityId: userId,
        summary: `Account role changed from ${currentRole} to ${newRole}.`,
        metadata: { from: currentRole, to: newRole },
      });
    }
    if (newStatus !== current.status) {
      await appendAuditEvent(client, {
        actorId: actor.id,
        actorRole: actor.role,
        action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
        entityType: 'USER',
        entityId: userId,
        summary: `Account status changed from ${String(current.status)} to ${newStatus}.`,
        metadata: { from: current.status, to: newStatus },
      });
    }
    if (newName !== current.full_name) {
      await appendAuditEvent(client, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'USER_UPDATED',
        entityType: 'USER',
        entityId: userId,
        summary: 'Administrator updated an account display name.',
      });
    }
    return mapUser(row);
  });
}
