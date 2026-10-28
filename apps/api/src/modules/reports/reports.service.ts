import { canonicalJson, type PaginatedResult, type ReportDetailView, type ReportSummaryView, type SessionUser } from '@poi/shared';
import { query, withTransaction } from '../../db/pool.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { paginationFromQuery, totalPages } from '../../lib/http.js';
import { sha256Hex } from '../../lib/crypto.js';
import { appendAuditEvent, AUDIT_ACTIONS, getProjectAuditHead } from '../audit/audit.service.js';
import { listAnchors } from '../blockchain/blockchain.service.js';
import { listProjectClaims } from '../claims/claims.service.js';
import { listMilestones } from '../milestones/milestones.service.js';
import { getProjectAccess, sessionActor } from '../projects/project-access.js';
import { getProjectDetail } from '../projects/projects.service.js';
import { listProjectReviews } from '../reviews/reviews.service.js';
import { getPlatformSettings } from '../settings/settings.service.js';

interface ReportRow {
  id: string;
  project_id: string;
  generated_by: string;
  format: 'JSON' | 'PRINT';
  title: string;
  snapshot: Record<string, unknown>;
  checksum: string;
  created_at: Date;
  generated_by_name: string | null;
  project_code: string | null;
}

const REPORT_SELECT = `
  SELECT r.*, u.full_name AS generated_by_name, p.code AS project_code
    FROM reports r
    LEFT JOIN users u ON u.id = r.generated_by
    LEFT JOIN projects p ON p.id = r.project_id
`;

function mapSummary(row: ReportRow): ReportSummaryView {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    format: row.format,
    checksum: row.checksum,
    generatedByName: row.generated_by_name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapDetail(row: ReportRow): ReportDetailView {
  return { ...mapSummary(row), snapshot: row.snapshot };
}

export async function generateReport(
  actor: SessionUser,
  projectId: string,
  input: { format?: 'JSON' | 'PRINT'; title?: string } = {},
): Promise<ReportDetailView> {
  const access = await getProjectAccess(sessionActor(actor), projectId);
  if (!access.canGenerateReport) {
    throw forbidden('Only project participants can generate an accountability report');
  }

  const [detail, milestones, claims, reviews, anchors, auditHead, settings] = await Promise.all([
    getProjectDetail(actor, projectId),
    listMilestones(actor, projectId),
    listProjectClaims(actor, projectId, { history: true, page: 1, pageSize: 100 }),
    listProjectReviews(actor, projectId),
    listAnchors(actor, { projectId, page: 1, pageSize: 100 }),
    getProjectAuditHead(projectId),
    getPlatformSettings(),
  ]);

  const snapshot: Record<string, unknown> = {
    reportSchemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: { id: actor.id, fullName: actor.fullName, role: actor.role },
    platform: { name: 'Proof of Impact', footerNote: settings.reportFooterNote },
    project: detail,
    milestones,
    expenditureClaims: {
      note: 'Only current and historical claim versions visible to the report participants are included. Approved claims are reviewed expenditure records, not proof of payment.',
      items: claims.items,
    },
    reviews,
    anchors: anchors.items,
    audit: auditHead,
    disclosures: [
      'Blockchain anchoring proves that a commitment was recorded on a public chain. It does not prove that a project was completed, an invoice is genuine, or an expenditure was justified.',
      'Approved expenditure claims are independent review decisions, not confirmed payments.',
      'Reviewer identities are disclosed to report participants only; public pages show the reviewer role unless names are separately published.',
      'This snapshot is a point-in-time report. Later records may supersede it and are recorded as new versions.',
    ],
  };
  const checksum = sha256Hex(canonicalJson(snapshot));
  const title = input.title?.trim() || `Accountability report — ${detail.code}`;
  const format = input.format ?? 'PRINT';

  const reportId = await withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO reports (project_id, generated_by, format, title, snapshot, checksum)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
      [projectId, actor.id, format, title, JSON.stringify(snapshot), checksum],
    );
    const id = inserted.rows[0]!.id;
    await appendAuditEvent(client, {
      projectId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.REPORT_GENERATED,
      entityType: 'REPORT',
      entityId: id,
      summary: `Accountability report generated for ${detail.code}`,
      metadata: { reportId: id, checksum, auditHeadSeq: auditHead.latestSeq, anchorCount: anchors.items.length },
    });
    return id;
  });

  const loaded = await query<ReportRow>(`${REPORT_SELECT} WHERE r.id = $1`, [reportId]);
  return mapDetail(loaded.rows[0]!);
}

export async function listReports(
  actor: SessionUser,
  options: { projectId?: string; page?: number; pageSize?: number },
): Promise<PaginatedResult<ReportSummaryView>> {
  const pagination = paginationFromQuery({ page: options.page ?? 1, pageSize: options.pageSize ?? 20 }, 20);
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (options.projectId) {
    const access = await getProjectAccess(sessionActor(actor), options.projectId);
    if (!access.canGenerateReport) throw forbidden('Only project participants can view reports');
    params.push(options.projectId);
    conditions.push(`r.project_id = $${params.length}`);
  } else {
    if (actor.role === 'ADMIN') {
      // all reports
    } else if (actor.role === 'PROJECT_OWNER') {
      params.push(actor.id);
      conditions.push(`p.owner_id = $${params.length}`);
    } else if (actor.role === 'REVIEWER') {
      params.push(actor.id);
      conditions.push(`r.project_id IN (SELECT project_id FROM reviewer_assignments WHERE reviewer_id = $${params.length} AND active)`);
    } else {
      throw forbidden('Public observers cannot list internal accountability reports');
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const count = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM reports r LEFT JOIN projects p ON p.id = r.project_id ${where}`,
    params,
  );
  const total = Number(count.rows[0]?.count ?? 0);
  const result = await query<ReportRow>(
    `${REPORT_SELECT} ${where} ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.pageSize, pagination.offset],
  );
  return { items: result.rows.map(mapSummary), page: pagination.page, pageSize: pagination.pageSize, total, totalPages: totalPages(total, pagination.pageSize) };
}

export async function getReport(actor: SessionUser, reportId: string): Promise<ReportDetailView> {
  const loaded = await query<ReportRow>(`${REPORT_SELECT} WHERE r.id = $1`, [reportId]);
  const row = loaded.rows[0];
  if (!row) throw notFound('Report not found');
  const access = await getProjectAccess(sessionActor(actor), row.project_id);
  if (!access.canGenerateReport) throw notFound('Report not found');
  return mapDetail(row);
}
