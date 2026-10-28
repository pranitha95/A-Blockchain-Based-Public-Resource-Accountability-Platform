import type { ReviewDecision, ReviewTargetType, ReviewView, SessionUser } from '@poi/shared';
import { query, withTransaction } from '../../db/pool.js';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { appendAuditEvent, AUDIT_ACTIONS } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import { getProjectAccess, sessionActor } from '../projects/project-access.js';

interface ReviewRow {
  id: string;
  project_id: string;
  target_type: ReviewTargetType;
  target_id: string;
  target_version: number;
  reviewer_id: string;
  decision: ReviewDecision;
  rationale: string;
  created_at: Date;
  reviewer_name: string;
  reviewer_role: 'ADMIN' | 'PROJECT_OWNER' | 'REVIEWER' | 'OBSERVER';
}

const REVIEW_SELECT = `
  SELECT r.*, u.full_name AS reviewer_name, u.role AS reviewer_role
    FROM reviews r
    JOIN users u ON u.id = r.reviewer_id
`;

export function mapReview(row: ReviewRow, includeReviewerName: boolean): ReviewView {
  return {
    id: row.id,
    projectId: row.project_id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetVersion: Number(row.target_version),
    decision: row.decision,
    rationale: row.rationale,
    createdAt: new Date(row.created_at).toISOString(),
    reviewerName: includeReviewerName ? row.reviewer_name : 'Independent reviewer',
    reviewerRole: row.reviewer_role,
  };
}

export async function loadReviewForTarget(
  targetType: ReviewTargetType,
  targetId: string,
  targetVersion: number,
  includeReviewerName: boolean,
): Promise<ReviewView | null> {
  const result = await query<ReviewRow>(
    `${REVIEW_SELECT} WHERE r.target_type = $1 AND r.target_id = $2 AND r.target_version = $3 LIMIT 1`,
    [targetType, targetId, targetVersion],
  );
  const row = result.rows[0];
  return row ? mapReview(row, includeReviewerName) : null;
}

export async function listProjectReviews(actor: SessionUser | null, projectId: string): Promise<ReviewView[]> {
  const access = await getProjectAccess(sessionActor(actor), projectId);
  const result = await query<ReviewRow>(`${REVIEW_SELECT} WHERE r.project_id = $1 ORDER BY r.created_at DESC`, [projectId]);
  return result.rows.map((row) => mapReview(row, access.canSeeRestrictedData));
}

interface QueueRow {
  target_type: ReviewTargetType;
  target_id: string;
  target_version: number;
  project_id: string;
  project_code: string;
  project_title: string;
  target_title: string;
  submitted_at: Date;
  submitted_by_name: string;
  age_days: string;
}

export interface ReviewQueueItem {
  targetType: ReviewTargetType;
  targetId: string;
  targetVersion: number;
  projectId: string;
  projectCode: string;
  projectTitle: string;
  title: string;
  submittedAt: string;
  submittedByName: string | null;
  ageDays: number;
}

export async function listReviewQueue(actor: SessionUser): Promise<ReviewQueueItem[]> {
  if (actor.role === 'OBSERVER') return [];
  const params: unknown[] = [];
  let scope = 'TRUE';
  if (actor.role === 'REVIEWER') {
    params.push(actor.id);
    scope = `queue.project_id IN (SELECT project_id FROM reviewer_assignments WHERE reviewer_id = $${params.length} AND active)`;
  }
  const result = await query<QueueRow>(
    `SELECT * FROM (
        SELECT 'MILESTONE_SUBMISSION'::text AS target_type, ms.id AS target_id, ms.version AS target_version,
               p.id AS project_id, p.owner_id AS owner_id, p.code AS project_code, p.title AS project_title,
               m.title AS target_title, ms.submitted_at, u.full_name AS submitted_by_name,
               FLOOR(EXTRACT(EPOCH FROM (now() - ms.submitted_at)) / 86400)::text AS age_days
          FROM milestone_submissions ms
          JOIN milestones m ON m.id = ms.milestone_id
          JOIN projects p ON p.id = m.project_id
          JOIN users u ON u.id = ms.submitted_by
         WHERE ms.status = 'SUBMITTED'
        UNION ALL
        SELECT 'EXPENDITURE_CLAIM'::text AS target_type, ec.id AS target_id, ec.version AS target_version,
               p.id AS project_id, p.owner_id AS owner_id, p.code AS project_code, p.title AS project_title,
               ('Expenditure claim ' || ec.reference || ' · ' || ec.category) AS target_title,
               ec.submitted_at, u.full_name AS submitted_by_name,
               FLOOR(EXTRACT(EPOCH FROM (now() - ec.submitted_at)) / 86400)::text AS age_days
          FROM expenditure_claims ec
          JOIN projects p ON p.id = ec.project_id
          JOIN users u ON u.id = ec.submitted_by
         WHERE ec.is_current AND ec.status IN ('SUBMITTED','UNDER_REVIEW')
     ) queue
     WHERE submitted_at IS NOT NULL AND (${scope})
     ORDER BY submitted_at ASC
     LIMIT 100`,
    params,
  );
  return result.rows.map((row) => ({
    targetType: row.target_type,
    targetId: row.target_id,
    targetVersion: Number(row.target_version),
    projectId: row.project_id,
    projectCode: row.project_code,
    projectTitle: row.project_title,
    title: row.target_title,
    submittedAt: new Date(row.submitted_at).toISOString(),
    submittedByName: row.submitted_by_name ?? null,
    ageDays: Number(row.age_days ?? 0),
  }));
}

interface TargetContext {
  targetType: ReviewTargetType;
  targetId: string;
  targetVersion: number;
  status: string;
  projectId: string;
  projectCode: string;
  projectTitle: string;
  projectStatus: string;
  ownerId: string;
  submittedBy: string;
  submitterName: string;
  title: string;
}

async function loadTargetForReview(client: import('pg').PoolClient, targetType: ReviewTargetType, targetId: string): Promise<TargetContext | null> {
  if (targetType === 'MILESTONE_SUBMISSION') {
    const result = await client.query(
      `SELECT ms.id, ms.version, ms.status, ms.submitted_by, u.full_name AS submitter_name,
              m.project_id, m.title AS milestone_title, p.code AS project_code, p.title AS project_title,
              p.status::text AS project_status, p.owner_id
         FROM milestone_submissions ms
         JOIN milestones m ON m.id = ms.milestone_id
         JOIN projects p ON p.id = m.project_id
         JOIN users u ON u.id = ms.submitted_by
        WHERE ms.id = $1
        FOR UPDATE OF ms, m`,
      [targetId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      targetType,
      targetId,
      targetVersion: Number(row.version),
      status: String(row.status),
      projectId: String(row.project_id),
      projectCode: String(row.project_code),
      projectTitle: String(row.project_title),
      projectStatus: String(row.project_status),
      ownerId: String(row.owner_id),
      submittedBy: String(row.submitted_by),
      submitterName: String(row.submitter_name),
      title: `Milestone: ${row.milestone_title}`,
    };
  }
  const result = await client.query(
    `SELECT ec.id, ec.version, ec.status, ec.submitted_by, u.full_name AS submitter_name,
            ec.project_id, ec.reference, ec.category, p.code AS project_code, p.title AS project_title,
            p.status::text AS project_status, p.owner_id
       FROM expenditure_claims ec
       JOIN projects p ON p.id = ec.project_id
       JOIN users u ON u.id = ec.submitted_by
      WHERE ec.id = $1 AND ec.is_current
      FOR UPDATE OF ec`,
    [targetId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    targetType,
    targetId,
    targetVersion: Number(row.version),
    status: String(row.status),
    projectId: String(row.project_id),
    projectCode: String(row.project_code),
    projectTitle: String(row.project_title),
    projectStatus: String(row.project_status),
    ownerId: String(row.owner_id),
    submittedBy: String(row.submitted_by),
    submitterName: String(row.submitter_name),
    title: `Expenditure claim ${row.reference} · ${row.category}`,
  };
}

const DECISION_AUDIT_ACTION: Record<ReviewDecision, string> = {
  APPROVED: AUDIT_ACTIONS.REVIEW_APPROVED,
  REJECTED: AUDIT_ACTIONS.REVIEW_REJECTED,
  CHANGES_REQUESTED: AUDIT_ACTIONS.REVIEW_CHANGES_REQUESTED,
  DISCREPANCY_OPENED: AUDIT_ACTIONS.REVIEW_DISCREPANCY_OPENED,
};

export async function createReview(
  actor: SessionUser,
  targetType: ReviewTargetType,
  targetId: string,
  input: { decision: ReviewDecision; rationale: string },
): Promise<ReviewView> {
  if (actor.role !== 'REVIEWER') {
    throw forbidden('Only independent reviewers can record review decisions');
  }

  const review = await withTransaction(async (client) => {
    const target = await loadTargetForReview(client, targetType, targetId);
    if (!target) throw notFound('Review target not found');
    if (target.ownerId === actor.id) throw forbidden('You cannot review a record on a project you own');
    if (target.submittedBy === actor.id) throw forbidden('You cannot review a record that you submitted');

    const assignment = await client.query(
      'SELECT 1 FROM reviewer_assignments WHERE project_id = $1 AND reviewer_id = $2 AND active LIMIT 1',
      [target.projectId, actor.id],
    );
    if (assignment.rowCount === 0) {
      throw forbidden('You are not an active independent reviewer for this project');
    }

    const expectedStatuses = targetType === 'MILESTONE_SUBMISSION' ? ['SUBMITTED'] : ['SUBMITTED', 'UNDER_REVIEW'];
    if (!expectedStatuses.includes(target.status)) {
      throw conflict('This record is not awaiting an independent decision');
    }

    const existing = await client.query(
      'SELECT 1 FROM reviews WHERE target_type = $1 AND target_id = $2 AND target_version = $3',
      [targetType, targetId, target.targetVersion],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw conflict('A decision has already been recorded for this record version');
    }

    const inserted = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO reviews (project_id, target_type, target_id, target_version, reviewer_id, decision, rationale)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, created_at`,
      [target.projectId, targetType, targetId, target.targetVersion, actor.id, input.decision, input.rationale],
    );
    const reviewId = inserted.rows[0]!.id;

    if (targetType === 'MILESTONE_SUBMISSION') {
      const submissionStatus =
        input.decision === 'APPROVED'
          ? 'APPROVED'
          : input.decision === 'DISCREPANCY_OPENED'
            ? 'DISPUTED'
            : 'REJECTED';
      const milestoneStatus = input.decision === 'APPROVED' ? 'APPROVED' : input.decision === 'DISCREPANCY_OPENED' ? 'IN_PROGRESS' : 'REJECTED';
      await client.query('UPDATE milestone_submissions SET status = $1, decided_at = now() WHERE id = $2', [
        submissionStatus,
        targetId,
      ]);
      await client.query('UPDATE milestones SET status = $1, version = version + 1 WHERE id = (SELECT milestone_id FROM milestone_submissions WHERE id = $2)', [
        milestoneStatus,
        targetId,
      ]);
    } else {
      const claimStatus =
        input.decision === 'APPROVED'
          ? 'APPROVED'
          : input.decision === 'DISCREPANCY_OPENED'
            ? 'DISPUTED'
            : 'REJECTED';
      await client.query('UPDATE expenditure_claims SET status = $1 WHERE id = $2', [claimStatus, targetId]);
    }

    await appendAuditEvent(client, {
      projectId: target.projectId,
      actorId: actor.id,
      actorRole: actor.role,
      action: DECISION_AUDIT_ACTION[input.decision],
      entityType: targetType,
      entityId: targetId,
      summary: `${target.title} reviewed: ${input.decision.replaceAll('_', ' ').toLowerCase()}`,
      metadata: {
        decision: input.decision,
        targetVersion: target.targetVersion,
        reviewId,
        rationale: input.rationale,
      },
      recordVersion: target.targetVersion,
    });

    await createNotification(client, {
      userId: target.ownerId,
      type: 'REVIEW_DECIDED',
      title: `Review decision: ${input.decision.replaceAll('_', ' ').toLowerCase()}`,
      message: `${target.projectCode} — ${target.title}: ${input.rationale.slice(0, 280)}${input.rationale.length > 280 ? '…' : ''}`,
      linkPath: targetType === 'MILESTONE_SUBMISSION' ? `/projects/${target.projectId}?tab=milestones` : `/projects/${target.projectId}?tab=expenditure`,
      dedupeKey: `REVIEW_DECIDED:${reviewId}`,
    });

    const loaded = await client.query<ReviewRow>(`${REVIEW_SELECT} WHERE r.id = $1`, [reviewId]);
    return mapReview(loaded.rows[0]!, true);
  });

  return review;
}

export async function assertReviewerCanSeeTarget(actor: SessionUser, targetType: ReviewTargetType, targetId: string): Promise<string> {
  const result =
    targetType === 'MILESTONE_SUBMISSION'
      ? await query<{ project_id: string }>(
          `SELECT m.project_id FROM milestone_submissions ms JOIN milestones m ON m.id = ms.milestone_id WHERE ms.id = $1`,
          [targetId],
        )
      : await query<{ project_id: string }>('SELECT project_id FROM expenditure_claims WHERE id = $1', [targetId]);
  const projectId = result.rows[0]?.project_id;
  if (!projectId) throw notFound('Review target not found');
  await getProjectAccess(sessionActor(actor), projectId);
  return projectId;
}
