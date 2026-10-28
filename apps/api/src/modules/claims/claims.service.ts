import type { ClaimStatus, ClaimView, ExpenditureClaimInput, PaginatedResult, SessionUser } from '@poi/shared';
import type pg from 'pg';
import { getPool, query, withTransaction } from '../../db/pool.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { paginationFromQuery, totalPages } from '../../lib/http.js';
import { appendAuditEvent, AUDIT_ACTIONS } from '../audit/audit.service.js';
import { loadClaimEvidence } from '../evidence/evidence.service.js';
import { createNotification, notifyProjectReviewers } from '../notifications/notifications.service.js';
import {
  assertCanSubmitRecords,
  getProjectAccess,
  getProjectAccessForUpdate,
  sessionActor,
} from '../projects/project-access.js';
import { loadReviewForTarget } from '../reviews/reviews.service.js';

interface ClaimRow {
  id: string;
  project_id: string;
  reference: string;
  version: number;
  previous_claim_id: string | null;
  is_current: boolean;
  amount: string;
  currency: string;
  claimed_date: string;
  category: string;
  description: string;
  supplier_name: string | null;
  supplier_reference: string | null;
  status: ClaimStatus;
  over_budget: boolean;
  budget_explanation: string | null;
  submitted_by: string;
  submitted_by_name: string | null;
  submitted_at: Date | null;
  created_at: Date;
}

const CLAIM_SELECT = `
  SELECT ec.*, u.full_name AS submitted_by_name
    FROM expenditure_claims ec
    LEFT JOIN users u ON u.id = ec.submitted_by
`;

async function mapClaim(row: ClaimRow, includeInternal: boolean): Promise<ClaimView> {
  const [evidence, review] = await Promise.all([
    loadClaimEvidence(row.id, { includeUploaderName: includeInternal, includeRestricted: includeInternal }),
    loadReviewForTarget('EXPENDITURE_CLAIM', row.id, Number(row.version), includeInternal),
  ]);
  return {
    id: row.id,
    projectId: row.project_id,
    reference: row.reference,
    version: Number(row.version),
    previousClaimId: row.previous_claim_id,
    isCurrent: row.is_current,
    amount: String(row.amount),
    currency: row.currency,
    claimedDate: row.claimed_date,
    category: row.category,
    description: row.description,
    supplierName: row.supplier_name,
    supplierReference: row.supplier_reference,
    status: row.status,
    overBudget: row.over_budget,
    budgetExplanation: row.budget_explanation,
    submittedByName: includeInternal ? row.submitted_by_name : null,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    evidence,
    reviews: review ? [review] : [],
  };
}

export interface ClaimListOptions {
  statuses?: ClaimStatus[];
  search?: string;
  history?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listProjectClaims(
  actor: SessionUser | null,
  projectId: string,
  options: ClaimListOptions,
): Promise<PaginatedResult<ClaimView>> {
  const access = await getProjectAccess(sessionActor(actor), projectId);
  const includeInternal = access.canSeeRestrictedData;
  const pagination = paginationFromQuery({ page: options.page ?? 1, pageSize: options.pageSize ?? 25 }, 25);
  const params: unknown[] = [projectId];
  const conditions = ['ec.project_id = $1'];
  if (!includeInternal) {
    conditions.push('ec.is_current AND ec.status <> \'DRAFT\'');
  } else if (!options.history) {
    conditions.push('ec.is_current');
  }
  if (options.statuses && options.statuses.length > 0) {
    params.push(options.statuses);
    conditions.push(`ec.status = ANY($${params.length}::claim_status[])`);
  }
  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(`(ec.reference ILIKE $${params.length} OR ec.description ILIKE $${params.length} OR ec.category ILIKE $${params.length} OR ec.supplier_name ILIKE $${params.length})`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const count = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM expenditure_claims ec ${where}`, params);
  const total = Number(count.rows[0]?.count ?? 0);
  const rows = await query<ClaimRow>(
    `${CLAIM_SELECT} ${where}
      ORDER BY ec.is_current DESC, ec.claimed_date DESC, ec.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.pageSize, pagination.offset],
  );
  const items = await Promise.all(rows.rows.map((row) => mapClaim(row, includeInternal)));
  return { items, page: pagination.page, pageSize: pagination.pageSize, total, totalPages: totalPages(total, pagination.pageSize) };
}

async function loadClaimRow(executor: pg.Pool | pg.PoolClient, claimId: string, forUpdate = false): Promise<ClaimRow | null> {
  const sql = `${CLAIM_SELECT} WHERE ec.id = $1 ${forUpdate ? 'FOR UPDATE OF ec' : ''}`;
  const result = await executor.query<ClaimRow>(sql, [claimId]);
  return result.rows[0] ?? null;
}

export async function getClaimDetail(
  actor: SessionUser | null,
  claimId: string,
): Promise<ClaimView> {
  const row = await loadClaimRow(getPool(), claimId);
  if (!row) throw notFound('Expenditure claim not found');
  const access = await getProjectAccess(sessionActor(actor), row.project_id);
  if (!access.canSeeRestrictedData && (!row.is_current || row.status === 'DRAFT')) {
    throw notFound('Expenditure claim not found');
  }
  return mapClaim(row, access.canSeeRestrictedData);
}

export async function listClaimVersions(actor: SessionUser | null, claimId: string): Promise<ClaimView[]> {
  const row = await loadClaimRow(getPool(), claimId);
  if (!row) throw notFound('Expenditure claim not found');
  const access = await getProjectAccess(sessionActor(actor), row.project_id);
  const result = await query<ClaimRow>(`${CLAIM_SELECT} WHERE ec.project_id = $1 AND ec.reference = $2 ORDER BY ec.version ASC`, [
    row.project_id,
    row.reference,
  ]);
  const includeInternal = access.canSeeRestrictedData;
  const rows = includeInternal ? result.rows : result.rows.filter((claim) => claim.is_current && claim.status !== 'DRAFT');
  return Promise.all(rows.map((claim) => mapClaim(claim, includeInternal)));
}

async function validateClaimEvidence(
  client: pg.PoolClient,
  projectId: string,
  evidenceIds: string[],
  previousClaimId?: string,
): Promise<void> {
  const unique = [...new Set(evidenceIds)];
  const previousEvidence = previousClaimId
    ? await client.query<{ evidence_id: string }>('SELECT evidence_id FROM expenditure_claim_evidence WHERE claim_id = $1', [previousClaimId])
    : { rows: [] as { evidence_id: string }[] };
  const previousIds = new Set(previousEvidence.rows.map((row) => row.evidence_id));

  const result = await client.query<{ id: string; title: string }>(
    `SELECT e.id, e.title
       FROM evidence e
      WHERE e.project_id = $1 AND e.archived_at IS NULL
        AND e.milestone_id IS NULL
        AND e.expenditure_claim_id IS NULL
        AND e.id = ANY($2::uuid[])`,
    [projectId, unique],
  );
  const foundIds = new Set(result.rows.map((row) => row.id));
  for (const id of unique) {
    if (foundIds.has(id)) continue;
    if (previousIds.has(id)) {
      foundIds.add(id);
      continue;
    }
    throw badRequest('Some selected evidence is not available for this expenditure claim');
  }
}

async function computeOverBudget(
  client: pg.PoolClient,
  projectId: string,
  amount: string,
  currency: string,
  explanation: string | null,
  excludeClaimId?: string,
): Promise<{ overBudget: boolean; total: string; budget: string }> {
  const project = await client.query<{ budget_amount: string; currency: string }>(
    'SELECT budget_amount, currency FROM projects WHERE id = $1 FOR UPDATE',
    [projectId],
  );
  const info = project.rows[0]!;
  if (info.currency !== currency) {
    throw unprocessable(`Claims for this project must use ${info.currency}`);
  }
  const params: unknown[] = [projectId];
  let exclusion = '';
  if (excludeClaimId) {
    params.push(excludeClaimId);
    exclusion = `AND id <> $${params.length}`;
  }
  const existing = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total FROM expenditure_claims
      WHERE project_id = $1 AND is_current AND status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','DISPUTED') ${exclusion}`,
    params,
  );
  const existingTotal = Number(existing.rows[0]?.total ?? 0);
  const newTotal = existingTotal + Number(amount);
  const overBudget = newTotal > Number(info.budget_amount);
  if (overBudget && (!explanation || explanation.trim().length < 20)) {
    throw unprocessable(
      `This claim would bring recorded expenditure to ${newTotal.toFixed(2)} ${currency}, above the approved budget of ${info.budget_amount}. Provide an over-budget explanation of at least 20 characters.`,
      {
        budget: info.budget_amount,
        existingTotal: existingTotal.toFixed(2),
        newTotal: newTotal.toFixed(2),
        overBy: (newTotal - Number(info.budget_amount)).toFixed(2),
      },
    );
  }
  return { overBudget, total: newTotal.toFixed(2), budget: info.budget_amount };
}

async function nextClaimReference(): Promise<string> {
  const result = await query<{ value: string }>("SELECT nextval('expenditure_reference_seq')::text AS value");
  return `EXP-${new Date().getUTCFullYear()}-${String(Number(result.rows[0]?.value ?? 1)).padStart(5, '0')}`;
}

export async function createExpenditureClaim(
  actor: SessionUser,
  projectId: string,
  input: ExpenditureClaimInput,
): Promise<ClaimView> {
  if (input.claimedDate > new Date().toISOString().slice(0, 10)) {
    throw unprocessable('The claimed expenditure date cannot be in the future');
  }

  const claimId = await withTransaction(async (client) => {
    const access = await getProjectAccessForUpdate(client, sessionActor(actor), projectId);
    assertCanSubmitRecords(access);
    await validateClaimEvidence(client, projectId, input.evidenceIds);
    const { overBudget } = await computeOverBudget(
      client,
      projectId,
      input.amount,
      access.project.currency,
      input.overBudgetExplanation ?? null,
    );
    const reference = await nextClaimReference();
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO expenditure_claims
         (project_id, reference, version, is_current, amount, currency, claimed_date, category, description,
          supplier_name, supplier_reference, status, over_budget, budget_explanation, submitted_by, submitted_at)
       VALUES ($1,$2,1,true,$3,$4,$5,$6,$7,$8,$9,'SUBMITTED',$10,$11,$12,now())
       RETURNING id`,
      [
        projectId,
        reference,
        input.amount,
        access.project.currency,
        input.claimedDate,
        input.category,
        input.description,
        input.supplierName ?? null,
        input.supplierReference ?? null,
        overBudget,
        input.overBudgetExplanation ?? null,
        actor.id,
      ],
    );
    const id = inserted.rows[0]!.id;
    for (const evidenceId of [...new Set(input.evidenceIds)]) {
      await client.query('INSERT INTO expenditure_claim_evidence (claim_id, evidence_id) VALUES ($1,$2)', [id, evidenceId]);
    }
    await appendAuditEvent(client, {
      projectId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.EXPENDITURE_CREATED,
      entityType: 'EXPENDITURE_CLAIM',
      entityId: id,
      summary: `Expenditure claim ${reference} submitted for ${input.amount} ${access.project.currency}`,
      metadata: {
        reference,
        amount: input.amount,
        currency: access.project.currency,
        category: input.category,
        claimedDate: input.claimedDate,
        overBudget,
        evidenceIds: input.evidenceIds,
      },
      recordVersion: 1,
    });
    await appendAuditEvent(client, {
      projectId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.EXPENDITURE_SUBMITTED,
      entityType: 'EXPENDITURE_CLAIM',
      entityId: id,
      summary: `Expenditure claim ${reference} entered the independent review queue`,
      metadata: { reference },
      recordVersion: 1,
    });
    await notifyProjectReviewers(client, {
      projectId,
      type: 'CLAIM_SUBMITTED',
      title: 'Expenditure claim awaiting review',
      message: `${access.project.code} — claim ${reference} for ${input.amount} ${access.project.currency} (${input.category}) needs independent review.`,
      linkPath: `/reviews?project=${projectId}`,
      excludeUserId: actor.id,
    });
    await createNotification(client, {
      userId: actor.id,
      type: 'CLAIM_SUBMITTED',
      title: 'Expenditure claim submitted',
      message: `Claim ${reference} was recorded and is awaiting independent review.`,
      linkPath: `/projects/${projectId}?tab=expenditure`,
      dedupeKey: `CLAIM_SUBMITTED:${id}`,
    });
    return id;
  });

  return getClaimDetail(actor, claimId);
}

export async function amendExpenditureClaim(
  actor: SessionUser,
  claimId: string,
  input: ExpenditureClaimInput,
): Promise<ClaimView> {
  if (input.claimedDate > new Date().toISOString().slice(0, 10)) {
    throw unprocessable('The claimed expenditure date cannot be in the future');
  }
  const newClaimId = await withTransaction(async (client) => {
    const existing = await loadClaimRow(client, claimId, true);
    if (!existing) throw notFound('Expenditure claim not found');
    const access = await getProjectAccessForUpdate(client, sessionActor(actor), existing.project_id);
    assertCanSubmitRecords(access);
    if (!existing.is_current) throw conflict('Only the current version of a claim can be amended');
    if (!['SUBMITTED', 'REJECTED', 'DISPUTED', 'DRAFT'].includes(existing.status)) {
      throw conflict(
        existing.status === 'APPROVED'
          ? 'An approved claim is a settled record and cannot be amended; submit a separate corrective claim instead'
          : 'This claim cannot be amended in its current state',
      );
    }
    if (existing.status === 'SUBMITTED') {
      const reviewed = await client.query('SELECT 1 FROM reviews WHERE target_type = $1 AND target_id = $2 LIMIT 1', [
        'EXPENDITURE_CLAIM',
        claimId,
      ]);
      if ((reviewed.rowCount ?? 0) > 0) {
        throw conflict('This claim already has an independent decision; a new version cannot replace the reviewed record');
      }
    }
    await validateClaimEvidence(client, existing.project_id, input.evidenceIds, claimId);
    const { overBudget } = await computeOverBudget(
      client,
      existing.project_id,
      input.amount,
      access.project.currency,
      input.overBudgetExplanation ?? null,
      claimId,
    );
    const version = Number(existing.version) + 1;
    await client.query('UPDATE expenditure_claims SET is_current = false WHERE id = $1', [claimId]);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO expenditure_claims
         (project_id, reference, version, previous_claim_id, is_current, amount, currency, claimed_date, category, description,
          supplier_name, supplier_reference, status, over_budget, budget_explanation, submitted_by, submitted_at)
       VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10,$11,'SUBMITTED',$12,$13,$14,now())
       RETURNING id`,
      [
        existing.project_id,
        existing.reference,
        version,
        claimId,
        input.amount,
        access.project.currency,
        input.claimedDate,
        input.category,
        input.description,
        input.supplierName ?? null,
        input.supplierReference ?? null,
        overBudget,
        input.overBudgetExplanation ?? null,
        actor.id,
      ],
    );
    const id = inserted.rows[0]!.id;
    for (const evidenceId of [...new Set(input.evidenceIds)]) {
      await client.query('INSERT INTO expenditure_claim_evidence (claim_id, evidence_id) VALUES ($1,$2)', [id, evidenceId]);
    }
    await appendAuditEvent(client, {
      projectId: existing.project_id,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.EXPENDITURE_AMENDED,
      entityType: 'EXPENDITURE_CLAIM',
      entityId: id,
      summary: `Expenditure claim ${existing.reference} amended to version ${version}`,
      metadata: {
        previousClaimId: claimId,
        previousVersion: existing.version,
        newVersion: version,
        amount: input.amount,
        overBudget,
      },
      recordVersion: version,
    });
    await notifyProjectReviewers(client, {
      projectId: existing.project_id,
      type: 'CLAIM_SUBMITTED',
      title: 'Amended expenditure claim awaiting review',
      message: `${access.project.code} — claim ${existing.reference} was amended and needs review of version ${version}.`,
      linkPath: `/reviews?project=${existing.project_id}`,
      excludeUserId: actor.id,
    });
    return id;
  });

  return getClaimDetail(actor, newClaimId);
}

export function parseClaimListOptions(queryParams: Record<string, unknown>): ClaimListOptions {
  const statusesRaw = typeof queryParams.status === 'string' ? queryParams.status.split(',') : [];
  return {
    statuses: statusesRaw
      .map((value) => value.trim().toUpperCase())
      .filter((value): value is ClaimStatus => ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DISPUTED'].includes(value)),
    search: typeof queryParams.q === 'string' && queryParams.q.trim() !== '' ? queryParams.q.trim() : undefined,
    history: queryParams.history === 'true',
    page: Number(queryParams.page ?? 1),
    pageSize: Number(queryParams.pageSize ?? 25),
  };
}
