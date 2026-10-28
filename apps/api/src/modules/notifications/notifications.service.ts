import type pg from 'pg';
import type { NotificationType } from '@poi/shared';
import { query } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { paginationFromQuery, totalPages } from '../../lib/http.js';

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function createNotification(
  client: pg.PoolClient,
  input: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    linkPath?: string | null;
    dedupeKey?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO notifications (user_id, type, title, message, link_path, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [input.userId, input.type, input.title, input.message, input.linkPath ?? null, input.dedupeKey ?? null],
  );
}

export async function notifyProjectReviewers(
  client: pg.PoolClient,
  input: {
    projectId: string;
    type: NotificationType;
    title: string;
    message: string;
    linkPath: string;
    excludeUserId?: string;
  },
): Promise<void> {
  const reviewers = await client.query<{ reviewer_id: string }>(
    `SELECT ra.reviewer_id
       FROM reviewer_assignments ra
       JOIN projects p ON p.id = ra.project_id
      WHERE ra.project_id = $1 AND ra.active AND ra.reviewer_id <> p.owner_id
        AND ($2::uuid IS NULL OR ra.reviewer_id <> $2::uuid)`,
    [input.projectId, input.excludeUserId ?? null],
  );
  for (const row of reviewers.rows) {
    await createNotification(client, {
      userId: row.reviewer_id,
      type: input.type,
      title: input.title,
      message: input.message,
      linkPath: input.linkPath,
      dedupeKey: `${input.type}:${input.projectId}:${row.reviewer_id}`,
    });
  }
}

export async function notifyProjectOwner(
  client: pg.PoolClient,
  projectId: string,
  input: { type: NotificationType; title: string; message: string; linkPath: string },
): Promise<void> {
  const owner = await client.query<{ owner_id: string }>('SELECT owner_id FROM projects WHERE id = $1', [projectId]);
  const ownerId = owner.rows[0]?.owner_id;
  if (!ownerId) return;
  await createNotification(client, { userId: ownerId, ...input });
}

export function mapNotification(row: Record<string, unknown>): NotificationRow {
  return {
    id: String(row.id),
    type: row.type as NotificationType,
    title: String(row.title),
    message: String(row.message),
    linkPath: row.link_path ? String(row.link_path) : null,
    readAt: row.read_at ? new Date(row.read_at as string | Date).toISOString() : null,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  };
}

export async function listNotifications(
  userId: string,
  options: { page: number; pageSize: number; unreadOnly?: boolean },
): Promise<{ items: NotificationRow[]; page: number; pageSize: number; total: number; totalPages: number; unreadCount: number }> {
  const pagination = paginationFromQuery({ page: options.page, pageSize: options.pageSize }, 20);
  const where = options.unreadOnly ? 'AND read_at IS NULL' : '';
  const countResult = await query<{ count: string; unread: string }>(
    `SELECT COUNT(*)::text AS count, COUNT(*) FILTER (WHERE read_at IS NULL)::text AS unread
       FROM notifications WHERE user_id = $1 ${where}`,
    [userId],
  );
  const total = Number(countResult.rows[0]?.count ?? 0);
  const unreadCount = Number(countResult.rows[0]?.unread ?? 0);
  const result = await query(
    `SELECT * FROM notifications WHERE user_id = $1 ${where}
      ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, pagination.pageSize, pagination.offset],
  );
  return {
    items: result.rows.map(mapNotification),
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: totalPages(total, pagination.pageSize),
    unreadCount,
  };
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<NotificationRow> {
  const result = await query(
    'UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING *',
    [notificationId, userId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Notification not found');
  return mapNotification(row);
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  );
  return result.rowCount ?? 0;
}
