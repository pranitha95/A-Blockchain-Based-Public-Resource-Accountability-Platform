import type { AnchorStatus, CurrencyTotal, OverviewResponse, ProjectStatus, SessionUser, UserRole } from '@poi/shared';
import { query } from '../../db/pool.js';
import { getEnv } from '../../config/env.js';
import { listAuditEvents } from '../audit/audit.service.js';
import { listReviewQueue } from '../reviews/reviews.service.js';
import { getPlatformSettings } from '../settings/settings.service.js';

interface Scope {
  sql: string;
  params: unknown[];
  label: OverviewResponse['scope'];
  scopeLabel: string;
}

function scopeFor(actor: SessionUser | null): Scope {
  if (!actor) {
    return {
      sql: "p.visibility = 'PUBLIC' AND p.status IN ('APPROVED','IN_PROGRESS','UNDER_REVIEW','COMPLETED','SUSPENDED','CANCELLED')",
      params: [],
      label: 'PUBLIC',
      scopeLabel: 'Public projects',
    };
  }
  switch (actor.role) {
    case 'ADMIN':
      return { sql: 'TRUE', params: [], label: 'ALL', scopeLabel: 'All platform projects' };
    case 'PROJECT_OWNER':
      return { sql: 'p.owner_id = $1', params: [actor.id], label: 'OWNED', scopeLabel: 'Projects you own' };
    case 'REVIEWER':
      return {
        sql: 'p.id IN (SELECT project_id FROM reviewer_assignments WHERE reviewer_id = $1 AND active)',
        params: [actor.id],
        label: 'ASSIGNED',
        scopeLabel: 'Projects assigned to you for independent review',
      };
    default:
      return {
        sql: "p.visibility = 'PUBLIC' AND p.status IN ('APPROVED','IN_PROGRESS','UNDER_REVIEW','COMPLETED','SUSPENDED','CANCELLED')",
        params: [],
        label: 'PUBLIC',
        scopeLabel: 'Public projects',
      };
  }
}

function mapCurrencyTotals(rows: { currency: string; amount: string }[]): CurrencyTotal[] {
  return rows.map((row) => ({ currency: row.currency, amount: String(row.amount) }));
}

export async function getOverview(actor: SessionUser | null): Promise<OverviewResponse> {
  const scope = scopeFor(actor);
  const params = scope.params;
  const s = scope.sql;
  const p = (extra: unknown[]) => [...params, ...extra];

  const [
    projectCount,
    budgetRows,
    claimedRows,
    approvedRows,
    inProgress,
    completedMilestones,
    overdueMilestones,
    claimsAwaiting,
    anchored,
    statusRows,
    budgetVsClaims,
    completionRows,
    categoryRows,
    anchorActivity,
    settings,
    audit,
    queue,
  ] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM projects p WHERE ${s}`, params),
    query<{ currency: string; amount: string }>(
      `SELECT p.currency, COALESCE(SUM(p.budget_amount), 0)::text AS amount
         FROM projects p
        WHERE ${s} AND p.status IN ('APPROVED','IN_PROGRESS','UNDER_REVIEW','COMPLETED','SUSPENDED')
        GROUP BY p.currency ORDER BY p.currency`,
      params,
    ),
    query<{ currency: string; amount: string }>(
      `SELECT c.currency, COALESCE(SUM(c.amount), 0)::text AS amount
         FROM expenditure_claims c JOIN projects p ON p.id = c.project_id
        WHERE ${s} AND c.is_current AND c.status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','DISPUTED')
        GROUP BY c.currency ORDER BY c.currency`,
      params,
    ),
    query<{ currency: string; amount: string }>(
      `SELECT c.currency, COALESCE(SUM(c.amount), 0)::text AS amount
         FROM expenditure_claims c JOIN projects p ON p.id = c.project_id
        WHERE ${s} AND c.is_current AND c.status = 'APPROVED'
        GROUP BY c.currency ORDER BY c.currency`,
      params,
    ),
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM projects p WHERE ${s} AND p.status = 'IN_PROGRESS'`, params),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM milestones m JOIN projects p ON p.id = m.project_id
        WHERE ${s} AND m.status = 'APPROVED'`,
      params,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM milestones m JOIN projects p ON p.id = m.project_id
        WHERE ${s} AND m.status IN ('PLANNED','IN_PROGRESS') AND m.expected_completion < CURRENT_DATE`,
      params,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM expenditure_claims c JOIN projects p ON p.id = c.project_id
        WHERE ${s} AND c.is_current AND c.status IN ('SUBMITTED','UNDER_REVIEW')`,
      params,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM blockchain_anchors a JOIN projects p ON p.id = a.project_id
        WHERE ${s} AND a.status = 'CONFIRMED'`,
      params,
    ),
    query<{ status: ProjectStatus; count: string }>(
      `SELECT p.status, COUNT(*)::text AS count FROM projects p WHERE ${s} GROUP BY p.status ORDER BY p.status`,
      params,
    ),
    query<{
      id: string;
      code: string;
      title: string;
      currency: string;
      budget: string;
      claimed: string;
    }>(
      `WITH scoped AS (
         SELECT p.id, p.code, p.title, p.currency, p.budget_amount
           FROM projects p WHERE ${s}
          ORDER BY p.budget_amount DESC LIMIT 8
       )
       SELECT scoped.id, scoped.code, scoped.title, scoped.currency, scoped.budget_amount::text AS budget,
              COALESCE(SUM(c.amount) FILTER (
                WHERE c.is_current AND c.status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','DISPUTED')
              ), 0)::text AS claimed
         FROM scoped
         LEFT JOIN expenditure_claims c ON c.project_id = scoped.id
        GROUP BY scoped.id, scoped.code, scoped.title, scoped.currency, scoped.budget_amount
        ORDER BY scoped.budget_amount DESC`,
      params,
    ),
    query<{ month: string; count: string }>(
      `SELECT to_char(date_trunc('month', r.created_at), 'YYYY-MM') AS month, COUNT(*)::text AS count
         FROM reviews r JOIN projects p ON p.id = r.project_id
        WHERE ${s} AND r.target_type = 'MILESTONE_SUBMISSION' AND r.decision = 'APPROVED'
          AND r.created_at >= date_trunc('month', now() - interval '11 months')
        GROUP BY 1 ORDER BY 1`,
      params,
    ),
    query<{ category: string; label: string; count: string }>(
      `SELECT p.category_id AS category, cat.label, COUNT(*)::text AS count
         FROM projects p JOIN project_categories cat ON cat.id = p.category_id
        WHERE ${s}
        GROUP BY p.category_id, cat.label ORDER BY COUNT(*) DESC`,
      params,
    ),
    query<{ status: AnchorStatus; count: string }>(
      `SELECT a.status, COUNT(*)::text AS count
         FROM blockchain_anchors a JOIN projects p ON p.id = a.project_id
        WHERE ${s} GROUP BY a.status ORDER BY a.status`,
      params,
    ),
    getPlatformSettings(),
    listAuditEvents({
      viewer: actor ? { role: actor.role as UserRole, userId: actor.id } : null,
      page: 1,
      pageSize: 8,
    }),
    actor ? listReviewQueue(actor) : Promise.resolve([]),
  ]);

  const metrics = {
    totalProjects: Number(projectCount.rows[0]?.count ?? 0),
    totalApprovedBudget: mapCurrencyTotals(budgetRows.rows),
    recordedClaimTotal: mapCurrencyTotals(claimedRows.rows),
    approvedClaimTotal: mapCurrencyTotals(approvedRows.rows),
    projectsInProgress: Number(inProgress.rows[0]?.count ?? 0),
    completedMilestones: Number(completedMilestones.rows[0]?.count ?? 0),
    overdueMilestones: Number(overdueMilestones.rows[0]?.count ?? 0),
    claimsAwaitingReview: Number(claimsAwaiting.rows[0]?.count ?? 0),
    anchoredRecords: Number(anchored.rows[0]?.count ?? 0),
  };

  return {
    scope: scope.label,
    scopeLabel: scope.scopeLabel,
    demoMode: getEnv().DEMO_MODE && settings.showDemoData,
    generatedAt: new Date().toISOString(),
    metrics,
    definitions: {
      totalProjects: 'Projects visible in your scope. Draft and submitted projects are not visible to public observers.',
      totalApprovedBudget:
        'Sum of current project budget allocations, grouped by currency, for projects that have been approved and are not cancelled. This is an allocation, not money spent.',
      recordedClaimTotal:
        'Sum of current expenditure claims submitted for review (submitted, under review, approved or disputed), grouped by currency. It is not a payment total and not all of it is approved.',
      approvedClaimTotal:
        'Sum of current expenditure claims approved by an independent reviewer, grouped by currency. Approval is not proof that a payment was made.',
      projectsInProgress: 'Projects whose current status is In Progress.',
      completedMilestones: 'Milestones approved through independent review.',
      overdueMilestones:
        'Planned or in-progress milestones whose expected completion date is before today and which have not been submitted or approved.',
      claimsAwaitingReview: 'Current expenditure claims submitted or under review without a final decision.',
      anchoredRecords: 'Records with a confirmed, receipt-verified registry transaction. Anchoring proves a commitment existed, not the truth of the record.',
    },
    projectStatusDistribution: statusRows.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
    budgetVsClaims: budgetVsClaims.rows.map((row) => ({
      projectId: row.id,
      code: row.code,
      title: row.title,
      currency: row.currency,
      budget: String(row.budget),
      claimed: String(row.claimed),
    })),
    milestoneCompletionByMonth: completionRows.rows.map((row) => ({ month: row.month, count: Number(row.count) })),
    projectsByCategory: categoryRows.rows.map((row) => ({ category: row.category, label: row.label, count: Number(row.count) })),
    anchoringActivity: anchorActivity.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
    recentActivity: audit.items.map((event) => ({
      id: event.id,
      action: event.action,
      summary: event.summary,
      entityType: event.entityType,
      entityId: event.entityId,
      createdAt: event.createdAt,
      actorRole: event.actorRole,
    })),
    reviewQueue: queue.slice(0, 6).map((item) => ({
      id: item.targetId,
      targetType: item.targetType,
      projectId: item.projectId,
      projectCode: item.projectCode,
      title: item.title,
      submittedAt: item.submittedAt,
      ageDays: item.ageDays,
    })),
  };
}

export function emptyOverview(actor: SessionUser | null): OverviewResponse {
  const scope = scopeFor(actor);
  return {
    scope: scope.label,
    scopeLabel: scope.scopeLabel,
    demoMode: false,
    generatedAt: new Date().toISOString(),
    metrics: {
      totalProjects: 0,
      totalApprovedBudget: [],
      recordedClaimTotal: [],
      approvedClaimTotal: [],
      projectsInProgress: 0,
      completedMilestones: 0,
      overdueMilestones: 0,
      claimsAwaitingReview: 0,
      anchoredRecords: 0,
    },
    definitions: {},
    projectStatusDistribution: [],
    budgetVsClaims: [],
    milestoneCompletionByMonth: [],
    projectsByCategory: [],
    anchoringActivity: [],
    recentActivity: [],
    reviewQueue: [],
  };
}
