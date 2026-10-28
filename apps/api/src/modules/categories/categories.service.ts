import type { UserRole } from '@poi/shared';
import { withTransaction, query } from '../../db/pool.js';
import { conflict, notFound } from '../../lib/errors.js';
import { appendAuditEvent, AUDIT_ACTIONS } from '../audit/audit.service.js';

export interface CategoryView {
  id: string;
  label: string;
  description: string | null;
  isActive: boolean;
}

export async function listCategories(options: { includeInactive?: boolean } = {}): Promise<CategoryView[]> {
  const result = await query(
    `SELECT id, label, description, is_active FROM project_categories
     ${options.includeInactive ? '' : 'WHERE is_active'}
     ORDER BY label`,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    label: String(row.label),
    description: row.description ? String(row.description) : null,
    isActive: Boolean(row.is_active),
  }));
}

export async function createCategory(
  input: { id: string; label: string; description?: string | null },
  actor: { id: string; role: UserRole },
): Promise<CategoryView> {
  return withTransaction(async (client) => {
    const existing = await client.query('SELECT 1 FROM project_categories WHERE id = $1', [input.id]);
    if (existing.rowCount) throw conflict('A category with that identifier already exists');
    const result = await client.query(
      `INSERT INTO project_categories (id, label, description) VALUES ($1,$2,$3)
       RETURNING id, label, description, is_active`,
      [input.id, input.label, input.description ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Category insert returned no row');
    await appendAuditEvent(client, {
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.CATEGORY_CREATED,
      entityType: 'PROJECT_CATEGORY',
      entityId: input.id,
      summary: `Project category “${input.label}” was created.`,
    });
    return {
      id: row.id,
      label: row.label,
      description: row.description ?? null,
      isActive: row.is_active,
    };
  });
}

export async function updateCategory(
  categoryId: string,
  input: { label?: string; description?: string | null; isActive?: boolean },
  actor: { id: string; role: UserRole },
): Promise<CategoryView> {
  return withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM project_categories WHERE id = $1 FOR UPDATE', [categoryId]);
    if (!current.rows[0]) throw notFound('Category not found');
    const row = current.rows[0];
    const result = await client.query(
      `UPDATE project_categories SET label = $2, description = $3, is_active = $4 WHERE id = $1
       RETURNING id, label, description, is_active`,
      [
        categoryId,
        input.label ?? row.label,
        input.description !== undefined ? input.description : row.description,
        input.isActive ?? row.is_active,
      ],
    );
    const updated = result.rows[0];
    if (!updated) throw new Error('Category update returned no row');
    await appendAuditEvent(client, {
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.CATEGORY_UPDATED,
      entityType: 'PROJECT_CATEGORY',
      entityId: categoryId,
      summary: `Project category “${updated.label}” was updated.`,
    });
    return {
      id: updated.id,
      label: updated.label,
      description: updated.description ?? null,
      isActive: updated.is_active,
    };
  });
}
