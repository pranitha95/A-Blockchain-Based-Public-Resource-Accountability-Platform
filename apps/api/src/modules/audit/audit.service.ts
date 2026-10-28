import type pg from 'pg';
import type { UserRole } from '@poi/shared';
import { query } from '../../db/pool.js';
import { hashAuditEvent } from '../../lib/crypto.js';
import { paginationFromQuery, totalPages } from '../../lib/http.js';
import type { PaginatedResult } from '@poi/shared';

export const AUDIT_ACTIONS = {
  USER_REGISTERED: 'USER_REGISTERED',
  USER_CREATED: 'USER_CREATED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  USER_STATUS_CHANGED: 'USER_STATUS_CHANGED',
  ORGANIZATION_CREATED: 'ORGANIZATION_CREATED',
  ORGANIZATION_UPDATED: 'ORGANIZATION_UPDATED',
  ORGANIZATION_MEMBER_ADDED: 'ORGANIZATION_MEMBER_ADDED',
  ORGANIZATION_MEMBER_REMOVED: 'ORGANIZATION_MEMBER_REMOVED',
  CATEGORY_CREATED: 'CATEGORY_CREATED',
  CATEGORY_UPDATED: 'CATEGORY_UPDATED',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  PROJECT_CREATED: 'PROJECT_CREATED',
  PROJECT_UPDATED: 'PROJECT_UPDATED',
  PROJECT_SUBMITTED: 'PROJECT_SUBMITTED',
  PROJECT_APPROVED: 'PROJECT_APPROVED',
  PROJECT_REJECTED: 'PROJECT_REJECTED',
  PROJECT_STATUS_CHANGED: 'PROJECT_STATUS_CHANGED',
  PROJECT_BUDGET_CHANGED: 'PROJECT_BUDGET_CHANGED',
  MILESTONE_CREATED: 'MILESTONE_CREATED',
  MILESTONE_UPDATED: 'MILESTONE_UPDATED',
  MILESTONE_STARTED: 'MILESTONE_STARTED',
  MILESTONE_SUBMITTED: 'MILESTONE_SUBMITTED',
  EVIDENCE_UPLOADED: 'EVIDENCE_UPLOADED',
  EXPENDITURE_CREATED: 'EXPENDITURE_CREATED',
  EXPENDITURE_SUBMITTED: 'EXPENDITURE_SUBMITTED',
  EXPENDITURE_AMENDED: 'EXPENDITURE_AMENDED',
  REVIEWER_ASSIGNED: 'REVIEWER_ASSIGNED',
  REVIEWER_REMOVED: 'REVIEWER_REMOVED',
  REVIEW_APPROVED: 'REVIEW_APPROVED',
  REVIEW_REJECTED: 'REVIEW_REJECTED',
  REVIEW_CHANGES_REQUESTED: 'REVIEW_CHANGES_REQUESTED',
  REVIEW_DISCREPANCY_OPENED: 'REVIEW_DISCREPANCY_OPENED',
  ANCHOR_PREPARED: 'ANCHOR_PREPARED',
  ANCHOR_CONFIRMED: 'ANCHOR_CONFIRMED',
  ANCHOR_FAILED: 'ANCHOR_FAILED',
  ANCHOR_VERIFICATION_ERROR: 'ANCHOR_VERIFICATION_ERROR',
  ANCHOR_VERIFIED: 'ANCHOR_VERIFIED',
  REPORT_GENERATED: 'REPORT_GENERATED',
} as const;

export interface AuditInput {
  projectId?: string | null;
  actorId: string | null;
  actorRole: UserRole | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata?: Record<string, unknown>;
  recordVersion?: number | null;
  correlationId?: string | null;
}

export interface AuditEventRow {
  id: string;
  seq: number;
  projectId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: UserRole | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: Record<string, unknown>;
  recordVersion: number | null;
  correlationId: string | null;
  eventHash: string;
  prevHash: string | null;
  createdAt: string;
}

function mapAuditRow(row: Record<string, unknown>, includeActorName: boolean): AuditEventRow {
  return {
    id: String(row.id),
    seq: Number(row.seq),
    projectId: row.project_id ? String(row.project_id) : null,
    actorId: row.actor_id ? String(row.actor_id) : null,
    actorName: includeActorName && row.actor_name ? String(row.actor_name) : null,
    actorRole: (row.actor_role as UserRole | null) ?? null,
    action: String(row.action),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    summary: String(row.summary),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    recordVersion: row.record_version === null ? null : Number(row.record_version),
    correlationId: row.correlation_id ? String(row.correlation_id) : null,
    eventHash: String(row.event_hash),
    prevHash: row.prev_hash ? String(row.prev_hash) : null,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  };
}

export async function appendAuditEvent(
  client: pg.PoolClient,
  input: AuditInput,
): Promise<{ seq: number; eventHash: string }> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['proof_of_impact_audit_chain']);
  const previous = await client.query<{ seq: string; event_hash: string }>(
    'SELECT seq, event_hash FROM audit_events ORDER BY seq DESC LIMIT 1',
  );
  const prev = previous.rows[0];
  const seq = prev ? Number(prev.seq) + 1 : 1;
  const prevHash = prev?.event_hash ?? null;
  const createdAt = new Date();
  const metadata = input.metadata ?? {};
  const body: Record<string, unknown> = {
    seq,
    projectId: input.projectId ?? null,
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: input.summary,
    metadata,
    recordVersion: input.recordVersion ?? null,
    correlationId: input.correlationId ?? null,
    createdAt: createdAt.toISOString(),
  };
  const eventHash = hashAuditEvent(prevHash, body);
  await client.query(
    `INSERT INTO audit_events
       (seq, project_id, actor_id, actor_role, action, entity_type, entity_id, summary,
        metadata, record_version, correlation_id, prev_hash, event_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)`,
    [
      seq,
      input.projectId ?? null,
      input.actorId,
      input.actorRole,
      input.action,
      input.entityType,
      input.entityId,
      input.summary,
      JSON.stringify(metadata),
      input.recordVersion ?? null,
      input.correlationId ?? null,
      prevHash,
      eventHash,
      createdAt,
    ],
  );
  return { seq, eventHash };
}

interface AuditListOptions {
  viewer: { role: UserRole; userId: string | null } | null;
  projectId?: string;
  action?: string;
  entityType?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listAuditEvents(options: AuditListOptions): Promise<PaginatedResult<AuditEventRow>> {
  const pagination = paginationFromQuery(
    { page: options.page ?? 1, pageSize: options.pageSize ?? 25 },
    25,
  );
  const params: unknown[] = [];
  const conditions: string[] = [];

  const viewer = options.viewer;
  if (!viewer || viewer.role !== 'ADMIN') {
    if (!viewer) {
      conditions.push(`(
        p.visibility = 'PUBLIC'
        AND p.status IN ('APPROVED','IN_PROGRESS','UNDER_REVIEW','COMPLETED','SUSPENDED','CANCELLED')
        AND a.project_id IS NOT NULL
        AND a.action NOT IN ('REVIEWER_ASSIGNED','REVIEWER_REMOVED')
        AND NOT (a.action = 'EVIDENCE_UPLOADED' AND a.metadata->>'visibility' = 'RESTRICTED')
      )`);
    } else if (viewer.role === 'PROJECT_OWNER') {
      params.push(viewer.userId);
      conditions.push(`(p.owner_id = $${params.length} AND a.project_id IS NOT NULL)`);
    } else if (viewer.role === 'REVIEWER') {
      params.push(viewer.userId);
      conditions.push(`(
        a.project_id IN (SELECT ra.project_id FROM reviewer_assignments ra WHERE ra.reviewer_id = $${params.length} AND ra.active)
      )`);
    } else {
      conditions.push(`(
        p.visibility = 'PUBLIC'
        AND p.status IN ('APPROVED','IN_PROGRESS','UNDER_REVIEW','COMPLETED','SUSPENDED','CANCELLED')
        AND a.project_id IS NOT NULL
        AND a.action NOT IN ('REVIEWER_ASSIGNED','REVIEWER_REMOVED')
        AND NOT (a.action = 'EVIDENCE_UPLOADED' AND a.metadata->>'visibility' = 'RESTRICTED')
      )`);
    }
  }

  if (options.projectId) {
    params.push(options.projectId);
    conditions.push(`a.project_id = $${params.length}`);
  }
  if (options.action) {
    params.push(options.action);
    conditions.push(`a.action = $${params.length}`);
  }
  if (options.entityType) {
    params.push(options.entityType);
    conditions.push(`a.entity_type = $${params.length}`);
  }
  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(`a.summary ILIKE $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM audit_events a
       LEFT JOIN projects p ON p.id = a.project_id
       ${where}`,
    params,
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const listParams = [...params, pagination.pageSize, pagination.offset];
  const rows = await query(
    `SELECT a.*, u.full_name AS actor_name
       FROM audit_events a
       LEFT JOIN projects p ON p.id = a.project_id
       LEFT JOIN users u ON u.id = a.actor_id
       ${where}
       ORDER BY a.seq DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );

  const includeActorName = Boolean(options.viewer && options.viewer.role !== 'OBSERVER');
  return {
    items: rows.rows.map((row) => mapAuditRow(row, includeActorName)),
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: totalPages(total, pagination.pageSize),
  };
}

export interface AuditIntegrityResult {
  valid: boolean;
  checkedEvents: number;
  firstBrokenSeq: number | null;
  headHash: string | null;
  checkedAt: string;
}

export async function verifyAuditChain(): Promise<AuditIntegrityResult> {
  const result = await query('SELECT * FROM audit_events ORDER BY seq ASC');
  let prevHash: string | null = null;
  let expectedSeq = 1;
  for (const row of result.rows) {
    const body: Record<string, unknown> = {
      seq: Number(row.seq),
      projectId: row.project_id ?? null,
      actorId: row.actor_id ?? null,
      actorRole: row.actor_role ?? null,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      summary: row.summary,
      metadata: row.metadata ?? {},
      recordVersion: row.record_version === null ? null : Number(row.record_version),
      correlationId: row.correlation_id ?? null,
      createdAt: new Date(row.created_at).toISOString(),
    };
    const expectedHash = hashAuditEvent(prevHash, body);
    if (Number(row.seq) !== expectedSeq || row.event_hash !== expectedHash || (row.prev_hash ?? null) !== prevHash) {
      return {
        valid: false,
        checkedEvents: expectedSeq - 1,
        firstBrokenSeq: Number(row.seq),
        headHash: prevHash,
        checkedAt: new Date().toISOString(),
      };
    }
    prevHash = row.event_hash as string;
    expectedSeq += 1;
  }
  return {
    valid: true,
    checkedEvents: result.rows.length,
    firstBrokenSeq: null,
    headHash: prevHash,
    checkedAt: new Date().toISOString(),
  };
}

export async function getProjectAuditHead(projectId: string): Promise<{ latestSeq: number | null; headHash: string | null; count: number }> {
  const result = await query<{ seq: string | null; event_hash: string | null; count: string }>(
    `SELECT MAX(seq)::text AS seq,
            (SELECT event_hash FROM audit_events WHERE project_id = $1 ORDER BY seq DESC LIMIT 1) AS event_hash,
            COUNT(*)::text AS count
       FROM audit_events WHERE project_id = $1`,
    [projectId],
  );
  const row = result.rows[0];
  return {
    latestSeq: row?.seq ? Number(row.seq) : null,
    headHash: row?.event_hash ?? null,
    count: Number(row?.count ?? 0),
  };
}
