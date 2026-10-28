import {
  PROJECT_STATUSES,
  type CreateProjectInput,
  type PaginatedResult,
  type ProjectDetail,
  type ProjectListItem,
  type ProjectStatus,
  type ProjectStatusChangeView,
  type ProjectVisibility,
  type SessionUser,
  type UpdateProjectInput,
} from '@poi/shared';
import type pg from 'pg';
import { query, withTransaction } from '../../db/pool.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { paginationFromQuery, totalPages, type PaginationInput } from '../../lib/http.js';
import { appendAuditEvent, AUDIT_ACTIONS } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import {
  assertCanEdit,
  assertCanManageReviewers,
  getProjectAccess,
  getProjectAccessForUpdate,
  isPubliclyVisibleProject,
  PROJECT_SELECT,
  projectScopeCondition,
  sessionActor,
  type ProjectAccess,
  type ProjectRow,
} from './project-access.js';

const CLAIMED_STATUSES = `('SUBMITTED','UNDER_REVIEW','APPROVED','DISPUTED')`;

export interface ProjectListFilters {
  search?: string;
  statuses: ProjectStatus[];
  category?: string;
  organizationId?: string;
  visibility?: ProjectVisibility;
  overdue?: boolean;
  sort?: string;
  direction?: 'asc' | 'desc';
  includeDrafts?: boolean;
}

function mapListItem(row: Record<string, unknown>): ProjectListItem {
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    category: String(row.category_id),
    categoryLabel: String(row.category_label),
    locationName: String(row.location_name),
    organizationName: String(row.organization_name),
    budgetAmount: String(row.budget_amount),
    currency: String(row.currency),
    claimedAmount: String(row.claimed_amount),
    approvedClaimAmount: String(row.approved_claim_amount),
    milestoneCompletionPercent: Number(row.milestone_completion_percent ?? 0),
    status: row.status as ProjectStatus,
    visibility: row.visibility as ProjectVisibility,
    endDate: String(row.end_date),
    latestReviewDecision: (row.latest_review_decision as ProjectListItem['latestReviewDecision']) ?? null,
    openDiscrepancies: Number(row.open_discrepancies ?? 0),
    isDemo: Boolean(row.is_demo),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

export async function listProjects(
  actor: SessionUser | null,
  filters: ProjectListFilters,
  pagination: PaginationInput,
): Promise<PaginatedResult<ProjectListItem>> {
  const params: unknown[] = [];
  const conditions: string[] = [];
  const scope = await projectScopeCondition(sessionActor(actor), params, 'p');
  conditions.push(scope);

  if (filters.statuses.length > 0) {
    params.push(filters.statuses);
    conditions.push(`p.status = ANY($${params.length}::project_status[])`);
  }
  if (filters.category) {
    params.push(filters.category);
    conditions.push(`p.category_id = $${params.length}`);
  }
  if (filters.organizationId) {
    params.push(filters.organizationId);
    conditions.push(`p.organization_id = $${params.length}`);
  }
  if (filters.visibility && actor?.role === 'ADMIN') {
    params.push(filters.visibility);
    conditions.push(`p.visibility = $${params.length}`);
  }
  if (filters.overdue) {
    conditions.push(`EXISTS (
      SELECT 1 FROM milestones m
       WHERE m.project_id = p.id
         AND m.status IN ('PLANNED','IN_PROGRESS')
         AND m.expected_completion < CURRENT_DATE
    )`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(
      p.title ILIKE $${params.length}
      OR p.code ILIKE $${params.length}
      OR p.location_name ILIKE $${params.length}
      OR o.name ILIKE $${params.length}
    )`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const from = `
    FROM projects p
    JOIN organizations o ON o.id = p.organization_id
    JOIN project_categories c ON c.id = p.category_id
  `;

  const countResult = await query<{ count: string }>(`SELECT COUNT(*)::text AS count ${from} ${where}`, params);
  const total = Number(countResult.rows[0]?.count ?? 0);

  const sortKey = filters.sort ?? 'updated';
  const direction = filters.direction === 'asc' ? 'ASC' : 'DESC';
  const sortSql = (() => {
    switch (sortKey) {
      case 'title':
        return `p.title ${direction}`;
      case 'budget':
        return `p.budget_amount ${direction}`;
      case 'endDate':
        return `p.end_date ${direction}`;
      case 'progress':
        return `milestone_completion_percent ${direction}`;
      case 'created':
        return `p.created_at ${direction}`;
      default:
        return `p.updated_at ${direction}`;
    }
  })();

  const listParams = [...params, pagination.pageSize, pagination.offset];
  const rows = await query(
    `WITH claim_totals AS (
        SELECT c.project_id,
               COALESCE(SUM(c.amount) FILTER (WHERE c.status IN ${CLAIMED_STATUSES}), 0) AS claimed_amount,
               COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'APPROVED'), 0) AS approved_claim_amount
          FROM expenditure_claims c
         WHERE c.is_current
         GROUP BY c.project_id
      ), milestone_totals AS (
        SELECT m.project_id,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE m.status = 'APPROVED')::int AS completed
          FROM milestones m
         GROUP BY m.project_id
      ), latest_review AS (
        SELECT DISTINCT ON (r.project_id) r.project_id, r.decision
          FROM reviews r
         ORDER BY r.project_id, r.created_at DESC
      ), discrepancy_totals AS (
        SELECT r.project_id, COUNT(*)::int AS open_discrepancies
          FROM reviews r
         WHERE r.decision = 'DISCREPANCY_OPENED'
           AND (
             (r.target_type = 'MILESTONE_SUBMISSION'
               AND EXISTS (SELECT 1 FROM milestone_submissions ms WHERE ms.id = r.target_id AND ms.status = 'DISPUTED'))
             OR
             (r.target_type = 'EXPENDITURE_CLAIM'
               AND EXISTS (SELECT 1 FROM expenditure_claims ec WHERE ec.id = r.target_id AND ec.status = 'DISPUTED'))
           )
         GROUP BY r.project_id
      )
      SELECT p.*, o.name AS organization_name, c.label AS category_label,
             COALESCE(ct.claimed_amount, 0)::text AS claimed_amount,
             COALESCE(ct.approved_claim_amount, 0)::text AS approved_claim_amount,
             CASE WHEN COALESCE(mt.total, 0) = 0 THEN 0
                  ELSE ROUND((COALESCE(mt.completed, 0)::numeric * 100) / mt.total)::int
             END AS milestone_completion_percent,
             lr.decision AS latest_review_decision,
             COALESCE(dt.open_discrepancies, 0) AS open_discrepancies
        ${from}
        LEFT JOIN claim_totals ct ON ct.project_id = p.id
        LEFT JOIN milestone_totals mt ON mt.project_id = p.id
        LEFT JOIN latest_review lr ON lr.project_id = p.id
        LEFT JOIN discrepancy_totals dt ON dt.project_id = p.id
        ${where}
       ORDER BY ${sortSql}, p.id ASC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );

  return {
    items: rows.rows.map(mapListItem),
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: totalPages(total, pagination.pageSize),
  };
}

interface AggregateRow {
  claimed_amount: string;
  approved_claim_amount: string;
  milestone_total: string;
  milestone_completed: string;
  pending_reviews: string;
  open_discrepancies: string;
  milestone_overdue: string;
}

async function loadProjectAggregates(projectId: string): Promise<AggregateRow> {
  const result = await query<AggregateRow>(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0)::text FROM expenditure_claims
         WHERE project_id = $1 AND is_current AND status IN ${CLAIMED_STATUSES}) AS claimed_amount,
       (SELECT COALESCE(SUM(amount), 0)::text FROM expenditure_claims
         WHERE project_id = $1 AND is_current AND status = 'APPROVED') AS approved_claim_amount,
       (SELECT COUNT(*)::text FROM milestones WHERE project_id = $1) AS milestone_total,
       (SELECT COUNT(*)::text FROM milestones WHERE project_id = $1 AND status = 'APPROVED') AS milestone_completed,
       (SELECT COUNT(*)::text FROM milestones
         WHERE project_id = $1 AND status IN ('PLANNED','IN_PROGRESS') AND expected_completion < CURRENT_DATE) AS milestone_overdue,
       ((SELECT COUNT(*) FROM milestone_submissions ms
           JOIN milestones m ON m.id = ms.milestone_id
          WHERE m.project_id = $1 AND ms.status = 'SUBMITTED')
        + (SELECT COUNT(*) FROM expenditure_claims ec
            WHERE ec.project_id = $1 AND ec.is_current AND ec.status IN ('SUBMITTED','UNDER_REVIEW')))::text AS pending_reviews,
       (SELECT COUNT(*)::text FROM reviews r
         WHERE r.project_id = $1 AND r.decision = 'DISCREPANCY_OPENED'
           AND ((r.target_type = 'MILESTONE_SUBMISSION'
                 AND EXISTS (SELECT 1 FROM milestone_submissions ms WHERE ms.id = r.target_id AND ms.status = 'DISPUTED'))
             OR (r.target_type = 'EXPENDITURE_CLAIM'
                 AND EXISTS (SELECT 1 FROM expenditure_claims ec WHERE ec.id = r.target_id AND ec.status = 'DISPUTED')))) AS open_discrepancies
    `,
    [projectId],
  );
  return result.rows[0]!;
}

function canSeeOwner(access: ProjectAccess): boolean {
  return Boolean(access.isAdmin || access.isOwner || access.isAssignedReviewer);
}

export async function getProjectDetail(actor: SessionUser | null, projectId: string): Promise<ProjectDetail> {
  const access = await getProjectAccess(sessionActor(actor), projectId);
  const { project } = access;

  const [objectives, aggregates, latestBudget] = await Promise.all([
    query<{ objective: string }>('SELECT objective FROM project_objectives WHERE project_id = $1 ORDER BY position', [
      projectId,
    ]),
    loadProjectAggregates(projectId),
    query<{
      version: number;
      amount: string;
      currency: string;
      reason: string;
      changed_at: Date;
      changed_by_name: string | null;
    }>(
      `SELECT pb.version, pb.amount, pb.currency, pb.reason, pb.created_at AS changed_at, u.full_name AS changed_by_name
         FROM project_budgets pb
         LEFT JOIN users u ON u.id = pb.changed_by
        WHERE pb.project_id = $1
        ORDER BY pb.version DESC
        LIMIT 1`,
      [projectId],
    ),
  ]);

  const totalMilestones = Number(aggregates.milestone_total);
  const completed = Number(aggregates.milestone_completed);
  const completionPercent = totalMilestones === 0 ? 0 : Math.round((completed * 100) / totalMilestones);
  const budget = latestBudget.rows[0];

  return {
    id: project.id,
    code: project.code,
    title: project.title,
    description: project.description,
    problemStatement: project.problem_statement,
    objectives: objectives.rows.map((row) => row.objective),
    categoryId: project.category_id,
    categoryLabel: project.category_label,
    organization: { id: project.organization_id, name: project.organization_name, website: null },
    owner: canSeeOwner(access) ? { id: project.owner_id, fullName: project.owner_name } : null,
    locationName: project.location_name,
    latitude: Number(project.latitude),
    longitude: Number(project.longitude),
    budgetAmount: project.budget_amount,
    currency: project.currency,
    startDate: project.start_date,
    endDate: project.end_date,
    status: project.status,
    visibility: project.visibility,
    version: project.version,
    approvedAt: project.approved_at ? new Date(project.approved_at).toISOString() : null,
    completedAt: project.completed_at ? new Date(project.completed_at).toISOString() : null,
    isDemo: project.is_demo,
    createdAt: new Date(project.created_at).toISOString(),
    updatedAt: new Date(project.updated_at).toISOString(),
    claimedAmount: aggregates.claimed_amount,
    approvedClaimAmount: aggregates.approved_claim_amount,
    pendingReviewCount: Number(aggregates.pending_reviews),
    openDiscrepancies: Number(aggregates.open_discrepancies),
    milestoneStats: {
      total: totalMilestones,
      completed,
      overdue: Number(aggregates.milestone_overdue),
      completionPercent,
    },
    latestBudgetChange: budget
      ? {
          version: Number(budget.version),
          amount: String(budget.amount),
          currency: budget.currency,
          reason: budget.reason,
          changedByName: budget.changed_by_name ?? null,
          createdAt: new Date(budget.changed_at).toISOString(),
        }
      : null,
    permissions: {
      canEditProject: access.canEditProject,
      canSubmitRecords: access.canSubmitRecords,
      canUploadEvidence: access.canUploadEvidence,
      canReview: access.canReview,
      canManageReviewers: access.canManageReviewers,
      canApproveProject: access.canApproveProject,
      canAnchor: access.canAnchor,
      canGenerateReport: access.canGenerateReport,
      canSeeRestrictedData: access.canSeeRestrictedData,
    },
  };
}

async function nextProjectCode(): Promise<string> {
  const result = await query<{ value: string }>("SELECT nextval('project_code_seq')::text AS value");
  const value = Number(result.rows[0]?.value ?? 1);
  return `POI-${new Date().getUTCFullYear()}-${String(value).padStart(4, '0')}`;
}

interface ReferenceRow {
  category_active: boolean;
  organization_exists: boolean;
  owner_id: string | null;
  owner_role: string | null;
  owner_status: string | null;
}

async function validateProjectReferences(input: CreateProjectInput | (UpdateProjectInput & { ownerId?: string })): Promise<void> {
  if (input.categoryId) {
    const category = await query<{ is_active: boolean }>('SELECT is_active FROM project_categories WHERE id = $1', [
      input.categoryId,
    ]);
    if (category.rowCount === 0) throw badRequest('The selected project category does not exist');
    if (!category.rows[0]!.is_active) throw badRequest('The selected project category is not active');
  }
  if (input.organizationId) {
    const organization = await query('SELECT 1 FROM organizations WHERE id = $1', [input.organizationId]);
    if (organization.rowCount === 0) throw badRequest('The selected organization does not exist');
  }
  if (input.ownerId) {
    const owner = await query<ReferenceRow>(
      `SELECT true AS category_active, true AS organization_exists, id AS owner_id, role::text AS owner_role, status::text AS owner_status
         FROM users WHERE id = $1`,
      [input.ownerId],
    );
    const row = owner.rows[0];
    if (!row) throw badRequest('The selected project owner account does not exist');
    if (!['PROJECT_OWNER', 'ADMIN'].includes(row.owner_role ?? '')) {
      throw badRequest('The selected account must have the project owner or administrator role');
    }
    if (row.owner_status !== 'ACTIVE') throw badRequest('The selected project owner account is not active');
  }
}

export async function createProject(actor: SessionUser, input: CreateProjectInput): Promise<ProjectDetail> {
  if (actor.role !== 'ADMIN') throw forbidden('Only platform administrators can register projects');
  await validateProjectReferences(input);

  const projectId = await withTransaction(async (client) => {
    const code = await nextProjectCode();
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO projects
         (code, title, description, problem_statement, category_id, organization_id, owner_id,
          location_name, latitude, longitude, budget_amount, currency, start_date, end_date,
          status, visibility, version, is_demo, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'DRAFT',$15,1,false,$16)
       RETURNING id`,
      [
        code,
        input.title,
        input.description,
        input.problemStatement,
        input.categoryId,
        input.organizationId,
        input.ownerId,
        input.locationName,
        input.latitude,
        input.longitude,
        input.budgetAmount,
        input.currency,
        input.startDate,
        input.endDate,
        input.visibility,
        actor.id,
      ],
    );
    const id = inserted.rows[0]!.id;
    for (let index = 0; index < input.objectives.length; index += 1) {
      await client.query('INSERT INTO project_objectives (project_id, position, objective) VALUES ($1,$2,$3)', [
        id,
        index + 1,
        input.objectives[index],
      ]);
    }
    await client.query(
      `INSERT INTO project_budgets (project_id, version, amount, currency, reason, changed_by)
       VALUES ($1, 1, $2, $3, 'Initial registered budget', $4)`,
      [id, input.budgetAmount, input.currency, actor.id],
    );
    await client.query(
      `INSERT INTO project_status_history (project_id, from_status, to_status, reason, changed_by)
       VALUES ($1, NULL, 'DRAFT', 'Project registered', $2)`,
      [id, actor.id],
    );
    await appendAuditEvent(client, {
      projectId: id,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.PROJECT_CREATED,
      entityType: 'PROJECT',
      entityId: id,
      summary: `Project ${code} registered`,
      metadata: { code, title: input.title, budget: input.budgetAmount, currency: input.currency },
      recordVersion: 1,
    });
    return id;
  });

  return getProjectDetail(actor, projectId);
}

export async function updateProject(actor: SessionUser, projectId: string, input: UpdateProjectInput): Promise<ProjectDetail> {
  await withTransaction(async (client) => {
    const access = await getProjectAccessForUpdate(client, sessionActor(actor), projectId);
    assertCanEdit(access);
    const project = access.project;

    if (input.ownerId && input.ownerId !== project.owner_id && actor.role !== 'ADMIN') {
      throw forbidden('Only platform administrators can transfer project ownership');
    }
    if (input.categoryId || input.organizationId || input.ownerId) {
      await validateProjectReferences(input);
    }

    const startDate = input.startDate ?? project.start_date;
    const endDate = input.endDate ?? project.end_date;
    if (endDate < startDate) throw unprocessable('Expected completion date cannot be earlier than the start date');

    const fields: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };
    if (input.title !== undefined) assign('title', input.title);
    if (input.description !== undefined) assign('description', input.description);
    if (input.problemStatement !== undefined) assign('problem_statement', input.problemStatement);
    if (input.categoryId !== undefined) assign('category_id', input.categoryId);
    if (input.organizationId !== undefined) assign('organization_id', input.organizationId);
    if (input.ownerId !== undefined) assign('owner_id', input.ownerId);
    if (input.locationName !== undefined) assign('location_name', input.locationName);
    if (input.latitude !== undefined) assign('latitude', input.latitude);
    if (input.longitude !== undefined) assign('longitude', input.longitude);
    if (input.startDate !== undefined) assign('start_date', input.startDate);
    if (input.endDate !== undefined) assign('end_date', input.endDate);
    if (input.visibility !== undefined) assign('visibility', input.visibility);
    if (input.currency !== undefined && input.currency !== project.currency) {
      throw conflict('Project currency cannot be changed after expenditure records may exist');
    }

    values.push(projectId);
    const updated = await client.query(
      `UPDATE projects SET ${fields.length ? `${fields.join(', ')}, ` : ''}version = version + 1
        WHERE id = $${values.length}
        RETURNING version, status, title, owner_id`,
      values,
    );

    if (input.objectives !== undefined) {
      await client.query('DELETE FROM project_objectives WHERE project_id = $1', [projectId]);
      for (let index = 0; index < input.objectives.length; index += 1) {
        await client.query('INSERT INTO project_objectives (project_id, position, objective) VALUES ($1,$2,$3)', [
          projectId,
          index + 1,
          input.objectives[index],
        ]);
      }
    }

    const changedFields = Object.keys(input).filter((key) => (input as Record<string, unknown>)[key] !== undefined);
    await appendAuditEvent(client, {
      projectId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.PROJECT_UPDATED,
      entityType: 'PROJECT',
      entityId: projectId,
      summary: `Project details updated (${changedFields.join(', ') || 'no changes'})`,
      metadata: { changedFields },
      recordVersion: Number(updated.rows[0]!.version),
    });

    if (input.ownerId && input.ownerId !== project.owner_id) {
      await createNotification(client, {
        userId: input.ownerId,
        type: 'REVIEWER_ASSIGNED',
        title: 'You have been assigned a project',
        message: `${access.project.code} — ${input.title ?? project.title} is now assigned to you as project owner.`,
        linkPath: `/projects/${projectId}`,
        dedupeKey: `PROJECT_OWNER_ASSIGNED:${projectId}:${input.ownerId}`,
      });
    }
  });

  return getProjectDetail(actor, projectId);
}

export async function changeProjectStatus(
  actor: SessionUser,
  projectId: string,
  input: { status: ProjectStatus; reason?: string | null },
): Promise<ProjectDetail> {
  await withTransaction(async (client) => {
    const access = await getProjectAccessForUpdate(client, sessionActor(actor), projectId);
    const project = access.project;
    const from = project.status;
    const to = input.status;

    if (!PROJECT_STATUSES.includes(to)) throw badRequest('Unknown project status');
    if (from === to) throw conflict(`Project is already ${to.toLowerCase().replaceAll('_', ' ')}`);

    const adminTransitions: Record<ProjectStatus, ProjectStatus[]> = {
      DRAFT: ['SUBMITTED', 'CANCELLED'],
      SUBMITTED: ['DRAFT', 'APPROVED', 'CANCELLED'],
      APPROVED: ['IN_PROGRESS', 'SUSPENDED', 'CANCELLED'],
      IN_PROGRESS: ['UNDER_REVIEW', 'COMPLETED', 'SUSPENDED', 'CANCELLED'],
      UNDER_REVIEW: ['IN_PROGRESS', 'COMPLETED', 'SUSPENDED', 'CANCELLED'],
      COMPLETED: ['UNDER_REVIEW'],
      SUSPENDED: ['IN_PROGRESS', 'UNDER_REVIEW', 'CANCELLED'],
      CANCELLED: [],
    };
    const ownerTransitions: Record<ProjectStatus, ProjectStatus[]> = {
      DRAFT: ['SUBMITTED'],
      SUBMITTED: [],
      APPROVED: ['IN_PROGRESS'],
      IN_PROGRESS: ['UNDER_REVIEW'],
      UNDER_REVIEW: [],
      COMPLETED: [],
      SUSPENDED: [],
      CANCELLED: [],
    };

    const allowed = access.isAdmin
      ? adminTransitions[from]
      : access.isOwner
        ? ownerTransitions[from]
        : [];
    if (!allowed.includes(to)) {
      throw forbidden(
        access.isOwner && !access.isAdmin
          ? 'The project owner cannot make that transition directly; an administrator must review the project'
          : `Changing a project from ${from} to ${to} is not permitted`,
      );
    }

    if (to === 'APPROVED') {
      const milestones = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM milestones WHERE project_id = $1', [
        projectId,
      ]);
      if (Number(milestones.rows[0]?.count ?? 0) === 0) {
        throw unprocessable('Add at least one milestone before the project can be approved');
      }
    }

    if (to === 'COMPLETED') {
      if (!access.isAdmin) throw forbidden('Only platform administrators can mark a project completed');
      const pending = await client.query<{ count: string }>(
        `SELECT (
           (SELECT COUNT(*) FROM milestone_submissions ms
              JOIN milestones m ON m.id = ms.milestone_id
             WHERE m.project_id = $1 AND ms.status = 'SUBMITTED')
           + (SELECT COUNT(*) FROM expenditure_claims ec
               WHERE ec.project_id = $1 AND ec.is_current AND ec.status IN ('SUBMITTED','UNDER_REVIEW'))
         )::text AS count`,
        [projectId],
      );
      if (Number(pending.rows[0]?.count ?? 0) > 0) {
        throw unprocessable('Resolve all pending reviews before completing the project');
      }
      const unfinished = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM milestones WHERE project_id = $1 AND status <> 'APPROVED'`,
        [projectId],
      );
      if (Number(unfinished.rows[0]?.count ?? 0) > 0) {
        throw unprocessable('All milestones must be approved before the project can be completed');
      }
    }

    if (to === 'DRAFT' && (!input.reason || input.reason.trim().length < 10)) {
      throw unprocessable('Provide a reason of at least 10 characters when returning a project for revision');
    }
    if (from === 'COMPLETED' && to === 'UNDER_REVIEW' && (!input.reason || input.reason.trim().length < 10)) {
      throw unprocessable('Reopening a completed project requires a documented reason');
    }

    const approvedAt = to === 'APPROVED' ? new Date() : project.approved_at;
    const approvedBy = to === 'APPROVED' ? actor.id : project.approved_by;
    const completedAt = to === 'COMPLETED' ? new Date() : to === 'UNDER_REVIEW' && from === 'COMPLETED' ? null : project.completed_at;

    const updated = await client.query<{ version: number }>(
      `UPDATE projects
          SET status = $1, version = version + 1,
              approved_at = $2, approved_by = $3, completed_at = $4
        WHERE id = $5
        RETURNING version`,
      [to, approvedAt, approvedBy, completedAt, projectId],
    );

    await client.query(
      `INSERT INTO project_status_history (project_id, from_status, to_status, reason, changed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [projectId, from, to, input.reason ?? null, actor.id],
    );

    const action =
      to === 'APPROVED'
        ? AUDIT_ACTIONS.PROJECT_APPROVED
        : to === 'DRAFT' && from === 'SUBMITTED'
          ? AUDIT_ACTIONS.PROJECT_REJECTED
          : from === 'DRAFT'
            ? AUDIT_ACTIONS.PROJECT_SUBMITTED
            : AUDIT_ACTIONS.PROJECT_STATUS_CHANGED;

    await appendAuditEvent(client, {
      projectId,
      actorId: actor.id,
      actorRole: actor.role,
      action,
      entityType: 'PROJECT',
      entityId: projectId,
      summary: `Project status changed from ${from} to ${to}`,
      metadata: { from, to, reason: input.reason ?? null },
      recordVersion: Number(updated.rows[0]!.version),
    });

    if (actor.role === 'ADMIN' && actor.id !== project.owner_id) {
      const notificationType =
        to === 'APPROVED' ? 'PROJECT_APPROVED' : from === 'SUBMITTED' && to === 'DRAFT' ? 'PROJECT_REJECTED' : 'PROJECT_SUBMITTED';
      await createNotification(client, {
        userId: project.owner_id,
        type: notificationType,
        title:
          to === 'APPROVED'
            ? 'Project approved'
            : from === 'SUBMITTED' && to === 'DRAFT'
              ? 'Project returned for revision'
              : 'Project status updated',
        message: `${project.code} — ${project.title} is now ${to.replaceAll('_', ' ').toLowerCase()}.${input.reason ? ` Reason: ${input.reason}` : ''}`,
        linkPath: `/projects/${projectId}`,
      });
    }
  });

  return getProjectDetail(actor, projectId);
}

export async function changeProjectBudget(
  actor: SessionUser,
  projectId: string,
  input: { amount: string; currency: string; reason: string },
): Promise<ProjectDetail> {
  await withTransaction(async (client) => {
    const access = await getProjectAccessForUpdate(client, sessionActor(actor), projectId);
    assertCanEdit(access);
    if (!access.isAdmin && !access.isOwner) throw forbidden();
    if (input.currency !== access.project.currency) {
      throw conflict(`The project currency is ${access.project.currency}; budgets must use the same currency`);
    }
    if (input.amount === access.project.budget_amount) {
      throw conflict('The new budget matches the current approved budget');
    }

    const updated = await client.query<{ version: number }>(
      `UPDATE projects SET budget_amount = $1, version = version + 1 WHERE id = $2 RETURNING version`,
      [input.amount, projectId],
    );
    const version = Number(updated.rows[0]!.version);
    await client.query(
      `INSERT INTO project_budgets (project_id, version, amount, currency, reason, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [projectId, version, input.amount, input.currency, input.reason, actor.id],
    );
    const recorded = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM expenditure_claims
        WHERE project_id = $1 AND is_current AND status IN ${CLAIMED_STATUSES}`,
      [projectId],
    );
    const recordedTotal = recorded.rows[0]?.total ?? '0';
    await appendAuditEvent(client, {
      projectId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.PROJECT_BUDGET_CHANGED,
      entityType: 'PROJECT',
      entityId: projectId,
      summary: `Approved budget changed from ${access.project.budget_amount} to ${input.amount} ${input.currency}`,
      metadata: {
        previousAmount: access.project.budget_amount,
        newAmount: input.amount,
        currency: input.currency,
        reason: input.reason,
        recordedClaimsTotal: recordedTotal,
        exceedsRecordedClaims: Number(recordedTotal) > Number(input.amount),
      },
      recordVersion: version,
    });
    await createNotification(client, {
      userId: access.project.owner_id,
      type: 'PROJECT_SUBMITTED',
      title: 'Project budget updated',
      message: `${access.project.code} — the approved budget is now ${input.amount} ${input.currency}. ${input.reason}`,
      linkPath: `/projects/${projectId}`,
    });
  });
  return getProjectDetail(actor, projectId);
}

export async function listProjectStatusHistory(actor: SessionUser | null, projectId: string): Promise<ProjectStatusChangeView[]> {
  const access = await getProjectAccess(sessionActor(actor), projectId);
  if (!access.canView) throw notFound('Project not found');
  const result = await query(
    `SELECT h.from_status, h.to_status, h.reason, h.created_at, u.full_name AS changed_by_name
       FROM project_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.project_id = $1
      ORDER BY h.created_at DESC`,
    [projectId],
  );
  return result.rows.map((row) => ({
    fromStatus: (row.from_status as ProjectStatus | null) ?? null,
    toStatus: row.to_status as ProjectStatus,
    reason: (row.reason as string | null) ?? null,
    changedByName: access.canSeeRestrictedData ? ((row.changed_by_name as string | null) ?? null) : null,
    createdAt: new Date(row.created_at as Date).toISOString(),
  }));
}

export async function assignReviewer(
  actor: SessionUser,
  projectId: string,
  input: { reviewerId: string; conflictNote?: string | null },
): Promise<void> {
  await withTransaction(async (client) => {
    const access = await getProjectAccessForUpdate(client, sessionActor(actor), projectId);
    assertCanManageReviewers(access);
    if (input.reviewerId === access.project.owner_id) {
      throw unprocessable('The project owner cannot be assigned as an independent reviewer');
    }
    const reviewer = await client.query<{ id: string; role: string; status: string; full_name: string }>(
      'SELECT id, role::text AS role, status::text AS status, full_name FROM users WHERE id = $1',
      [input.reviewerId],
    );
    const row = reviewer.rows[0];
    if (!row) throw badRequest('The selected reviewer account does not exist');
    if (row.role !== 'REVIEWER') throw badRequest('The selected account does not have the independent reviewer role');
    if (row.status !== 'ACTIVE') throw badRequest('The selected reviewer account is not active');

    const existing = await client.query<{ id: string; active: boolean }>(
      'SELECT id, active FROM reviewer_assignments WHERE project_id = $1 AND reviewer_id = $2 FOR UPDATE',
      [projectId, input.reviewerId],
    );
    if (existing.rows[0]?.active) throw conflict('This reviewer is already assigned to the project');

    let assignmentId: string;
    if (existing.rows[0]) {
      const updated = await client.query<{ id: string }>(
        `UPDATE reviewer_assignments
            SET active = true, assigned_by = $1, assigned_at = now(), removed_at = NULL, conflict_note = $2
          WHERE id = $3 RETURNING id`,
        [actor.id, input.conflictNote ?? null, existing.rows[0].id],
      );
      assignmentId = updated.rows[0]!.id;
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO reviewer_assignments (project_id, reviewer_id, assigned_by, conflict_note)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [projectId, input.reviewerId, actor.id, input.conflictNote ?? null],
      );
      assignmentId = inserted.rows[0]!.id;
    }

    await appendAuditEvent(client, {
      projectId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.REVIEWER_ASSIGNED,
      entityType: 'REVIEWER_ASSIGNMENT',
      entityId: assignmentId,
      summary: `${row.full_name} assigned as an independent reviewer`,
      metadata: { reviewerId: input.reviewerId, conflictNote: input.conflictNote ?? null },
    });
    await createNotification(client, {
      userId: input.reviewerId,
      type: 'REVIEWER_ASSIGNED',
      title: 'New project assignment',
      message: `You were assigned as an independent reviewer for ${access.project.code} — ${access.project.title}.`,
      linkPath: `/reviews?project=${projectId}`,
      dedupeKey: `REVIEWER_ASSIGNED:${assignmentId}`,
    });
  });
}

export async function removeReviewer(actor: SessionUser, projectId: string, assignmentId: string): Promise<void> {
  await withTransaction(async (client) => {
    const access = await getProjectAccessForUpdate(client, sessionActor(actor), projectId);
    assertCanManageReviewers(access);
    const assignment = await client.query<{ id: string; reviewer_id: string; active: boolean; full_name: string }>(
      `SELECT ra.id, ra.reviewer_id, ra.active, u.full_name
         FROM reviewer_assignments ra JOIN users u ON u.id = ra.reviewer_id
        WHERE ra.id = $1 AND ra.project_id = $2 FOR UPDATE`,
      [assignmentId, projectId],
    );
    const row = assignment.rows[0];
    if (!row) throw notFound('Reviewer assignment not found');
    if (!row.active) throw conflict('This reviewer assignment is already inactive');

    await client.query('UPDATE reviewer_assignments SET active = false, removed_at = now() WHERE id = $1', [assignmentId]);
    await appendAuditEvent(client, {
      projectId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.REVIEWER_REMOVED,
      entityType: 'REVIEWER_ASSIGNMENT',
      entityId: assignmentId,
      summary: `${row.full_name} removed from independent review of the project`,
      metadata: { reviewerId: row.reviewer_id },
    });
  });
}

export async function listReviewerAssignments(actor: SessionUser, projectId: string) {
  const access = await getProjectAccess(sessionActor(actor), projectId);
  if (!access.viewer || !access.canSeeRestrictedData) {
    throw forbidden('Reviewer assignment details are restricted to project participants');
  }
  const result = await query(
    `SELECT ra.id, ra.conflict_note, ra.assigned_at, ra.active, ra.removed_at,
            u.id AS reviewer_id, u.full_name, u.email
       FROM reviewer_assignments ra
       JOIN users u ON u.id = ra.reviewer_id
      WHERE ra.project_id = $1
      ORDER BY ra.active DESC, ra.assigned_at DESC`,
    [projectId],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    reviewer: { id: String(row.reviewer_id), fullName: String(row.full_name) },
    reviewerEmail: access.isAdmin ? String(row.email) : null,
    conflictNote: (row.conflict_note as string | null) ?? null,
    assignedAt: new Date(row.assigned_at as Date).toISOString(),
    active: Boolean(row.active),
    removedAt: row.removed_at ? new Date(row.removed_at as Date).toISOString() : null,
  }));
}

export async function listEligibleReviewers(actor: SessionUser, projectId: string) {
  if (actor.role !== 'ADMIN') throw forbidden();
  const access = await getProjectAccess(sessionActor(actor), projectId);
  const result = await query<{
    id: string;
    full_name: string;
    email: string;
    active_assignments: string;
  }>(
    `SELECT u.id, u.full_name, u.email,
            (SELECT COUNT(*)::text FROM reviewer_assignments ra WHERE ra.reviewer_id = u.id AND ra.active) AS active_assignments
       FROM users u
      WHERE u.role = 'REVIEWER' AND u.status = 'ACTIVE' AND u.id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM reviewer_assignments ra
           WHERE ra.project_id = $2 AND ra.reviewer_id = u.id AND ra.active
        )
      ORDER BY u.full_name`,
    [access.project.owner_id, projectId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    activeAssignments: Number(row.active_assignments),
  }));
}

export async function projectBudgetHistory(actor: SessionUser | null, projectId: string) {
  const access = await getProjectAccess(sessionActor(actor), projectId);
  const result = await query(
    `SELECT pb.version, pb.amount, pb.currency, pb.reason, pb.created_at, u.full_name AS changed_by_name
       FROM project_budgets pb LEFT JOIN users u ON u.id = pb.changed_by
      WHERE pb.project_id = $1 ORDER BY pb.version DESC`,
    [projectId],
  );
  return result.rows.map((row) => ({
    version: Number(row.version),
    amount: String(row.amount),
    currency: String(row.currency),
    reason: String(row.reason),
    changedByName: access.canSeeRestrictedData ? ((row.changed_by_name as string | null) ?? null) : null,
    createdAt: new Date(row.created_at as Date).toISOString(),
  }));
}

export function parseProjectFilters(queryParams: Record<string, unknown>): {
  filters: ProjectListFilters;
  pagination: PaginationInput;
} {
  const statusesRaw = typeof queryParams.status === 'string' && queryParams.status.trim() !== '' ? queryParams.status.split(',') : [];
  const statuses = statusesRaw
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is ProjectStatus => (PROJECT_STATUSES as readonly string[]).includes(value));
  const visibilityRaw = typeof queryParams.visibility === 'string' ? queryParams.visibility.toUpperCase() : '';
  const pagination = paginationFromQuery(queryParams);
  return {
    filters: {
      search: typeof queryParams.q === 'string' && queryParams.q.trim() !== '' ? queryParams.q.trim() : undefined,
      statuses,
      category: typeof queryParams.category === 'string' && queryParams.category.trim() !== '' ? queryParams.category.trim() : undefined,
      organizationId:
        typeof queryParams.organizationId === 'string' && queryParams.organizationId.trim() !== ''
          ? queryParams.organizationId.trim()
          : undefined,
      visibility: visibilityRaw === 'PUBLIC' || visibilityRaw === 'PRIVATE' ? visibilityRaw : undefined,
      overdue: queryParams.overdue === 'true',
      sort: typeof queryParams.sort === 'string' ? queryParams.sort : undefined,
      direction: queryParams.direction === 'asc' ? 'asc' : 'desc',
    },
    pagination,
  };
}

export async function assertProjectVisibleForPublic(projectId: string): Promise<ProjectRow> {
  const project = await query<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = $1`, [projectId]);
  const row = project.rows[0];
  if (!row || !isPubliclyVisibleProject(row)) throw notFound('Project not found');
  return row;
}

export async function requireProjectAdmin(actor: SessionUser): Promise<void> {
  if (actor.role !== 'ADMIN') throw forbidden();
}

export function projectWhereOwnedBy(ownerId: string): pg.QueryConfig {
  return { text: 'SELECT 1 FROM projects WHERE owner_id = $1 LIMIT 1', values: [ownerId] };
}
