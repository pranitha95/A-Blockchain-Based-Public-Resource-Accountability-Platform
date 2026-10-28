import type { UserRole } from '@poi/shared';
import { withTransaction, query } from '../../db/pool.js';
import { conflict, notFound } from '../../lib/errors.js';
import { appendAuditEvent, AUDIT_ACTIONS } from '../audit/audit.service.js';

export interface OrganizationView {
  id: string;
  name: string;
  registrationNumber: string | null;
  contactEmail: string | null;
  website: string | null;
  description: string | null;
  memberCount: number;
  isDemo: boolean;
  createdAt: string;
}

function mapOrganization(row: Record<string, unknown>): OrganizationView {
  return {
    id: String(row.id),
    name: String(row.name),
    registrationNumber: row.registration_number ? String(row.registration_number) : null,
    contactEmail: row.contact_email ? String(row.contact_email) : null,
    website: row.website ? String(row.website) : null,
    description: row.description ? String(row.description) : null,
    memberCount: Number(row.member_count ?? 0),
    isDemo: Boolean(row.is_demo),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  };
}

export async function listOrganizations(search?: string): Promise<OrganizationView[]> {
  const params: unknown[] = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE o.name ILIKE $1`;
  }
  const result = await query(
    `SELECT o.*, (SELECT COUNT(*) FROM organization_memberships m WHERE m.organization_id = o.id)::int AS member_count
       FROM organizations o ${where}
      ORDER BY o.name ASC`,
    params,
  );
  return result.rows.map(mapOrganization);
}

export async function createOrganization(
  input: {
    name: string;
    registrationNumber?: string | null;
    contactEmail?: string | null;
    website?: string | null;
    description?: string | null;
  },
  actor: { id: string; role: UserRole },
): Promise<OrganizationView> {
  const existing = await query('SELECT 1 FROM organizations WHERE lower(name) = lower($1)', [input.name]);
  if (existing.rowCount) throw conflict('An organization with that name already exists');

  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO organizations (name, registration_number, contact_email, website, description)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *, 0 AS member_count`,
      [input.name, input.registrationNumber ?? null, input.contactEmail ?? null, input.website ?? null, input.description ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Organization insert returned no row');
    await appendAuditEvent(client, {
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.ORGANIZATION_CREATED,
      entityType: 'ORGANIZATION',
      entityId: row.id,
      summary: `Organization “${input.name}” was registered.`,
    });
    return mapOrganization(row);
  });
}

export async function updateOrganization(
  organizationId: string,
  input: Partial<{
    name: string;
    registrationNumber: string | null;
    contactEmail: string | null;
    website: string | null;
    description: string | null;
  }>,
  actor: { id: string; role: UserRole },
): Promise<OrganizationView> {
  return withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM organizations WHERE id = $1 FOR UPDATE', [organizationId]);
    const row = current.rows[0];
    if (!row) throw notFound('Organization not found');
    const updated = await client.query(
      `UPDATE organizations SET
         name = $2, registration_number = $3, contact_email = $4, website = $5, description = $6
       WHERE id = $1
       RETURNING *, (SELECT COUNT(*) FROM organization_memberships m WHERE m.organization_id = $1)::int AS member_count`,
      [
        organizationId,
        input.name ?? row.name,
        input.registrationNumber !== undefined ? input.registrationNumber : row.registration_number,
        input.contactEmail !== undefined ? input.contactEmail : row.contact_email,
        input.website !== undefined ? input.website : row.website,
        input.description !== undefined ? input.description : row.description,
      ],
    );
    const updatedRow = updated.rows[0];
    if (!updatedRow) throw new Error('Organization update returned no row');
    await appendAuditEvent(client, {
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.ORGANIZATION_UPDATED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      summary: 'Organization information was updated.',
    });
    return mapOrganization(updatedRow);
  });
}

export async function listOrganizationMembers(organizationId: string): Promise<
  { userId: string; fullName: string; email: string; role: 'ADMIN' | 'MEMBER'; addedAt: string }[]
> {
  const result = await query(
    `SELECT u.id, u.full_name, u.email, m.role, m.created_at
       FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1 ORDER BY u.full_name`,
    [organizationId],
  );
  return result.rows.map((row) => ({
    userId: String(row.id),
    fullName: String(row.full_name),
    email: String(row.email),
    role: row.role as 'ADMIN' | 'MEMBER',
    addedAt: new Date(row.created_at as string | Date).toISOString(),
  }));
}

export async function addOrganizationMember(
  organizationId: string,
  userId: string,
  role: 'ADMIN' | 'MEMBER',
  actor: { id: string; role: UserRole },
): Promise<void> {
  await withTransaction(async (client) => {
    const user = await client.query('SELECT full_name FROM users WHERE id = $1', [userId]);
    if (!user.rows[0]) throw notFound('User not found');
    const org = await client.query('SELECT name FROM organizations WHERE id = $1', [organizationId]);
    if (!org.rows[0]) throw notFound('Organization not found');
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [organizationId, userId, role],
    );
    await appendAuditEvent(client, {
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.ORGANIZATION_MEMBER_ADDED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      summary: `A user was linked to organization “${String(org.rows[0].name)}”.`,
      metadata: { userId, membershipRole: role },
    });
  });
}

export async function removeOrganizationMember(
  organizationId: string,
  userId: string,
  actor: { id: string; role: UserRole },
): Promise<void> {
  await withTransaction(async (client) => {
    const deleted = await client.query(
      'DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [organizationId, userId],
    );
    if (!deleted.rowCount) throw notFound('Membership not found');
    await appendAuditEvent(client, {
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.ORGANIZATION_MEMBER_REMOVED,
      entityType: 'ORGANIZATION',
      entityId: organizationId,
      summary: 'An organization membership was removed.',
      metadata: { userId },
    });
  });
}

export async function userBelongsToOrganization(userId: string, organizationId: string): Promise<boolean> {
  const result = await query(
    'SELECT 1 FROM organization_memberships WHERE user_id = $1 AND organization_id = $2',
    [userId, organizationId],
  );
  return Boolean(result.rowCount);
}
