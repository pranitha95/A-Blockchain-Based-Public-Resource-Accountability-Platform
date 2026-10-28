import type {
  MilestoneCreateInput,
  MilestoneUpdateInput,
  MilestoneView,
  SessionUser,
  SubmissionView,
} from '@poi/shared';
import { query, withTransaction } from '../../db/pool.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { appendAuditEvent, AUDIT_ACTIONS } from '../audit/audit.service.js';
import { loadSubmissionEvidence } from '../evidence/evidence.service.js';
import { createNotification, notifyProjectReviewers } from '../notifications/notifications.service.js';
import {
  assertCanEdit,
  assertCanSubmitRecords,
  getProjectAccess,
  getProjectAccessForUpdate,
  sessionActor,
  type ProjectAccess,
} from '../projects/project-access.js';
import { loadReviewForTarget } from '../reviews/reviews.service.js';

interface MilestoneRow {
  id: string;
  project_id: string;
  sequence: number;
  title: string;
  description: string;
  expected_completion: string;
  deliverables: string;
  allocated_budget: string | null;
  responsible_party: string;
  status: MilestoneView['status'];
  version: number;
  created_at: Date;
  updated_at: Date;
  submission_count: string;
}

interface SubmissionRow {
  id: string;
  milestone_id: string;
  version: number;
  summary: string;
  status: SubmissionView['status'];
  submitted_at: Date;
  decided_at: Date | null;
  submitted_by: string;
  submitted_by_name: string | null;
}

const MILESTONE_SELECT = `
  SELECT m.*,
         (SELECT COUNT(*)::text FROM milestone_submissions ms WHERE ms.milestone_id = m.id) AS submission_count
    FROM milestones m
`;

export interface MilestoneDetailView extends MilestoneView {
  submissions: SubmissionView[];
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function isOverdueMilestone(milestone: Pick<MilestoneRow, 'status' | 'expected_completion'>): boolean {
  return ['PLANNED', 'IN_PROGRESS'].includes(milestone.status) && milestone.expected_completion < todayIso();
}

async function loadSubmissionRow(submissionId: string): Promise<SubmissionRow | null> {
  const result = await query<SubmissionRow>(
    `SELECT ms.*, u.full_name AS submitted_by_name
       FROM milestone_submissions ms LEFT JOIN users u ON u.id = ms.submitted_by
      WHERE ms.id = $1`,
    [submissionId],
  );
  return result.rows[0] ?? null;
}

export async function mapSubmission(
  row: SubmissionRow,
  options: { includeInternal: boolean },
): Promise<SubmissionView> {
  const [evidence, review] = await Promise.all([
    loadSubmissionEvidence(row.id, {
      includeUploaderName: options.includeInternal,
      includeRestricted: options.includeInternal,
    }),
    loadReviewForTarget('MILESTONE_SUBMISSION', row.id, Number(row.version), options.includeInternal),
  ]);
  return {
    id: row.id,
    milestoneId: row.milestone_id,
    version: Number(row.version),
    summary: row.summary,
    status: row.status,
    submittedAt: new Date(row.submitted_at).toISOString(),
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    submittedByName: options.includeInternal ? row.submitted_by_name : null,
    evidence,
    review,
  };
}

async function latestSubmissionFor(milestoneId: string, includeInternal: boolean): Promise<SubmissionView | null> {
  const result = await query<SubmissionRow>(
    `SELECT ms.*, u.full_name AS submitted_by_name
       FROM milestone_submissions ms LEFT JOIN users u ON u.id = ms.submitted_by
      WHERE ms.milestone_id = $1
      ORDER BY ms.version DESC LIMIT 1`,
    [milestoneId],
  );
  const row = result.rows[0];
  return row ? mapSubmission(row, { includeInternal }) : null;
}

function mapMilestone(row: MilestoneRow, latestSubmission: SubmissionView | null): MilestoneView {
  return {
    id: row.id,
    projectId: row.project_id,
    sequence: Number(row.sequence),
    title: row.title,
    description: row.description,
    expectedCompletionDate: row.expected_completion,
    deliverables: row.deliverables,
    allocatedBudget: row.allocated_budget === null ? null : String(row.allocated_budget),
    responsibleParty: row.responsible_party,
    status: row.status,
    version: Number(row.version),
    isOverdue: isOverdueMilestone(row),
    submissionCount: Number(row.submission_count ?? 0),
    latestSubmission,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listMilestones(actor: SessionUser | null, projectId: string): Promise<MilestoneView[]> {
  const access = await getProjectAccess(sessionActor(actor), projectId);
  const result = await query<MilestoneRow>(`${MILESTONE_SELECT} WHERE m.project_id = $1 ORDER BY m.sequence ASC`, [projectId]);
  return Promise.all(
    result.rows.map(async (row) => mapMilestone(row, await latestSubmissionFor(row.id, access.canSeeRestrictedData))),
  );
}

export async function getMilestoneDetail(actor: SessionUser | null, milestoneId: string): Promise<MilestoneDetailView> {
  const result = await query<MilestoneRow>(`${MILESTONE_SELECT} WHERE m.id = $1`, [milestoneId]);
  const row = result.rows[0];
  if (!row) throw notFound('Milestone not found');
  const access = await getProjectAccess(sessionActor(actor), row.project_id);
  const submissions = await query<SubmissionRow>(
    `SELECT ms.*, u.full_name AS submitted_by_name
       FROM milestone_submissions ms LEFT JOIN users u ON u.id = ms.submitted_by
      WHERE ms.milestone_id = $1
      ORDER BY ms.version DESC`,
    [milestoneId],
  );
  const visible = access.canSeeRestrictedData ? submissions.rows : submissions.rows.slice(0, 1);
  const mapped = await Promise.all(visible.map((submission) => mapSubmission(submission, { includeInternal: access.canSeeRestrictedData })));
  const latest = mapped[0] ?? null;
  return { ...mapMilestone(row, latest), submissions: mapped };
}

async function validateMilestoneBudget(projectId: string, budget: string | null, excludeMilestoneId?: string): Promise<void> {
  if (budget === null) return;
  const project = await query<{ budget_amount: string; currency: string }>(
    'SELECT budget_amount, currency FROM projects WHERE id = $1',
    [projectId],
  );
  const info = project.rows[0];
  if (!info) throw notFound('Project not found');
  if (Number(budget) > Number(info.budget_amount)) {
    throw unprocessable(`A milestone allocation cannot exceed the project budget of ${info.budget_amount} ${info.currency}`);
  }
  const allocated = await query<{ total: string }>(
    `SELECT COALESCE(SUM(allocated_budget), 0)::text AS total FROM milestones
      WHERE project_id = $1 ${excludeMilestoneId ? 'AND id <> $2' : ''}`,
    excludeMilestoneId ? [projectId, excludeMilestoneId] : [projectId],
  );
  if (Number(allocated.rows[0]?.total ?? 0) + Number(budget) > Number(info.budget_amount)) {
    throw unprocessable('Milestone allocations would exceed the approved project budget');
  }
}

export async function createMilestone(
  actor: SessionUser,
  projectId: string,
  input: MilestoneCreateInput,
): Promise<MilestoneDetailView> {
  const milestoneId = await withTransaction(async (client) => {
    const access = await getProjectAccessForUpdate(client, sessionActor(actor), projectId);
    assertCanEdit(access);
    if (input.expectedCompletionDate > access.project.end_date) {
      throw unprocessable('A milestone cannot be scheduled after the project completion date');
    }
    await validateMilestoneBudget(projectId, input.allocatedBudget ?? null);

    const sequence = await client.query<{ next: string }>(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM milestones WHERE project_id = $1',
      [projectId],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO milestones
         (project_id, sequence, title, description, expected_completion, deliverables, allocated_budget, responsible_party, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        projectId,
        Number(sequence.rows[0]!.next),
        input.title,
        input.description,
        input.expectedCompletionDate,
        input.deliverables,
        input.allocatedBudget ?? null,
        input.responsibleParty,
        actor.id,
      ],
    );
    const id = inserted.rows[0]!.id;
    await appendAuditEvent(client, {
      projectId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.MILESTONE_CREATED,
      entityType: 'MILESTONE',
      entityId: id,
      summary: `Milestone created: ${input.title}`,
      metadata: { expectedCompletionDate: input.expectedCompletionDate, allocatedBudget: input.allocatedBudget ?? null },
    });
    return id;
  });
  return getMilestoneDetail(actor, milestoneId);
}

export async function updateMilestone(
  actor: SessionUser,
  milestoneId: string,
  input: MilestoneUpdateInput,
): Promise<MilestoneDetailView> {
  await withTransaction(async (client) => {
    const milestoneLookup = await client.query<MilestoneRow>('SELECT * FROM milestones WHERE id = $1 FOR UPDATE', [milestoneId]);
    const milestone = milestoneLookup.rows[0];
    if (!milestone) throw notFound('Milestone not found');
    const access = await getProjectAccessForUpdate(client, sessionActor(actor), milestone.project_id);
    assertCanEdit(access);
    if (milestone.status === 'APPROVED') throw conflict('An approved milestone cannot be edited; record a new change with a documented reason');
    if (milestone.status === 'SUBMITTED') throw conflict('This milestone is awaiting review and cannot be edited');

    if (input.expectedCompletionDate && input.expectedCompletionDate > access.project.end_date) {
      throw unprocessable('A milestone cannot be scheduled after the project completion date');
    }
    if (input.allocatedBudget !== undefined) {
      await validateMilestoneBudget(milestone.project_id, input.allocatedBudget, milestoneId);
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };
    if (input.title !== undefined) assign('title', input.title);
    if (input.description !== undefined) assign('description', input.description);
    if (input.expectedCompletionDate !== undefined) assign('expected_completion', input.expectedCompletionDate);
    if (input.deliverables !== undefined) assign('deliverables', input.deliverables);
    if (input.allocatedBudget !== undefined) assign('allocated_budget', input.allocatedBudget);
    if (input.responsibleParty !== undefined) assign('responsible_party', input.responsibleParty);
    if (fields.length === 0) return;

    values.push(milestoneId);
    const updated = await client.query<{ version: number }>(
      `UPDATE milestones SET ${fields.join(', ')}, version = version + 1 WHERE id = $${values.length} RETURNING version`,
      values,
    );
    const changedFields = Object.keys(input).filter((key) => (input as Record<string, unknown>)[key] !== undefined);
    await appendAuditEvent(client, {
      projectId: milestone.project_id,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.MILESTONE_UPDATED,
      entityType: 'MILESTONE',
      entityId: milestoneId,
      summary: `Milestone updated: ${input.title ?? milestone.title}`,
      metadata: { changedFields },
      recordVersion: Number(updated.rows[0]!.version),
    });
  });
  return getMilestoneDetail(actor, milestoneId);
}

export async function startMilestone(actor: SessionUser, milestoneId: string): Promise<MilestoneDetailView> {
  await withTransaction(async (client) => {
    const lookup = await client.query<MilestoneRow>('SELECT * FROM milestones WHERE id = $1 FOR UPDATE', [milestoneId]);
    const milestone = lookup.rows[0];
    if (!milestone) throw notFound('Milestone not found');
    const access = await getProjectAccessForUpdate(client, sessionActor(actor), milestone.project_id);
    assertCanSubmitRecords(access);
    if (milestone.status !== 'PLANNED') throw conflict('Only a planned milestone can be started');
    await client.query("UPDATE milestones SET status = 'IN_PROGRESS', version = version + 1 WHERE id = $1", [milestoneId]);
    await ensureProjectInProgress(client, access, actor);
    await appendAuditEvent(client, {
      projectId: milestone.project_id,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.MILESTONE_STARTED,
      entityType: 'MILESTONE',
      entityId: milestoneId,
      summary: `Milestone started: ${milestone.title}`,
    });
  });
  return getMilestoneDetail(actor, milestoneId);
}

async function ensureProjectInProgress(
  client: import('pg').PoolClient,
  access: ProjectAccess,
  actor: SessionUser,
): Promise<void> {
  if (access.project.status !== 'APPROVED') return;
  await client.query("UPDATE projects SET status = 'IN_PROGRESS', version = version + 1 WHERE id = $1", [access.project.id]);
  await client.query(
    `INSERT INTO project_status_history (project_id, from_status, to_status, reason, changed_by)
     VALUES ($1, 'APPROVED', 'IN_PROGRESS', 'Project work started by the project owner', $2)`,
    [access.project.id, actor.id],
  );
  await appendAuditEvent(client, {
    projectId: access.project.id,
    actorId: actor.id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.PROJECT_STATUS_CHANGED,
    entityType: 'PROJECT',
    entityId: access.project.id,
    summary: 'Project status changed from APPROVED to IN_PROGRESS',
    metadata: { from: 'APPROVED', to: 'IN_PROGRESS' },
  });
}

export async function submitMilestone(
  actor: SessionUser,
  milestoneId: string,
  input: { summary: string; evidenceIds: string[] },
): Promise<MilestoneDetailView> {
  await withTransaction(async (client) => {
    const lookup = await client.query<MilestoneRow>('SELECT * FROM milestones WHERE id = $1 FOR UPDATE', [milestoneId]);
    const milestone = lookup.rows[0];
    if (!milestone) throw notFound('Milestone not found');
    const access = await getProjectAccessForUpdate(client, sessionActor(actor), milestone.project_id);
    assertCanSubmitRecords(access);
    if (!['PLANNED', 'IN_PROGRESS', 'REJECTED'].includes(milestone.status)) {
      throw conflict('This milestone cannot be submitted in its current state');
    }

    const evidenceIds = [...new Set(input.evidenceIds)];
    const evidence = await client.query<{ id: string; title: string }>(
      `SELECT id, title FROM evidence
        WHERE project_id = $1 AND archived_at IS NULL
          AND id = ANY($2::uuid[])
          AND (milestone_id IS NULL OR milestone_id = $3)
          AND expenditure_claim_id IS NULL`,
      [milestone.project_id, evidenceIds, milestoneId],
    );
    if (evidence.rowCount !== evidenceIds.length) {
      throw badRequest('Some selected evidence is not available for this milestone or belongs to another record');
    }

    const nextVersion = await client.query<{ next: string }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM milestone_submissions WHERE milestone_id = $1',
      [milestoneId],
    );
    const version = Number(nextVersion.rows[0]!.next);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO milestone_submissions (milestone_id, version, summary, submitted_by, status)
       VALUES ($1,$2,$3,$4,'SUBMITTED') RETURNING id`,
      [milestoneId, version, input.summary, actor.id],
    );
    const submissionId = inserted.rows[0]!.id;
    for (const evidenceId of evidenceIds) {
      await client.query('INSERT INTO milestone_submission_evidence (submission_id, evidence_id) VALUES ($1,$2)', [
        submissionId,
        evidenceId,
      ]);
    }
    await client.query("UPDATE milestones SET status = 'SUBMITTED' WHERE id = $1", [milestoneId]);
    await ensureProjectInProgress(client, access, actor);

    await appendAuditEvent(client, {
      projectId: milestone.project_id,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.MILESTONE_SUBMITTED,
      entityType: 'MILESTONE_SUBMISSION',
      entityId: submissionId,
      summary: `Milestone submitted for independent review: ${milestone.title} (version ${version})`,
      metadata: { milestoneId, evidenceIds, submissionVersion: version },
      recordVersion: version,
    });

    await notifyProjectReviewers(client, {
      projectId: milestone.project_id,
      type: 'MILESTONE_SUBMITTED',
      title: 'Milestone awaiting review',
      message: `${access.project.code} — ${milestone.title} was submitted with ${evidenceIds.length} evidence document(s).`,
      linkPath: `/reviews?project=${milestone.project_id}`,
      excludeUserId: actor.id,
    });
    await createNotification(client, {
      userId: actor.id,
      type: 'MILESTONE_SUBMITTED',
      title: 'Milestone submission recorded',
      message: `Your submission for ${milestone.title} is awaiting independent review.`,
      linkPath: `/projects/${milestone.project_id}?tab=milestones`,
      dedupeKey: `MILESTONE_SUBMITTED:${submissionId}`,
    });
  });
  return getMilestoneDetail(actor, milestoneId);
}

export async function listMilestoneSubmissions(actor: SessionUser | null, milestoneId: string): Promise<SubmissionView[]> {
  const detail = await getMilestoneDetail(actor, milestoneId);
  return detail.submissions;
}

export async function recalculateMilestoneOverdue(projectId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM milestones
      WHERE project_id = $1 AND status IN ('PLANNED','IN_PROGRESS') AND expected_completion < CURRENT_DATE`,
    [projectId],
  );
  return Number(result.rows[0]?.count ?? 0);
}
