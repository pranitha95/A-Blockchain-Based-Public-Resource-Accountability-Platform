import type { ProjectStatus, ProjectVisibility, SessionUser, UserRole } from '@poi/shared';
import type pg from 'pg';
import { query, withTransaction } from '../../db/pool.js';
import { forbidden, notFound } from '../../lib/errors.js';

export const PUBLIC_PROJECT_STATUSES: ProjectStatus[] = [
  'APPROVED',
  'IN_PROGRESS',
  'UNDER_REVIEW',
  'COMPLETED',
  'SUSPENDED',
  'CANCELLED',
];

const OPEN_STATUSES = PUBLIC_PROJECT_STATUSES.join("','");

export const PUBLIC_PROJECT_STATUS_SQL = `('${OPEN_STATUSES}')`;

export interface ProjectRow {
  id: string;
  code: string;
  title: string;
  description: string;
  problem_statement: string;
  category_id: string;
  organization_id: string;
  owner_id: string;
  location_name: string;
  latitude: string;
  longitude: string;
  budget_amount: string;
  currency: string;
  start_date: string;
  end_date: string;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  version: number;
  approved_at: Date | null;
  approved_by: string | null;
  completed_at: Date | null;
  is_demo: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  organization_name: string;
  category_label: string;
  owner_name: string;
}

export const PROJECT_SELECT = `
  SELECT p.*, o.name AS organization_name, c.label AS category_label, u.full_name AS owner_name
    FROM projects p
    JOIN organizations o ON o.id = p.organization_id
    JOIN project_categories c ON c.id = p.category_id
    JOIN users u ON u.id = p.owner_id
`;

export interface ProjectActor {
  id: string;
  role: UserRole;
}

export interface ProjectAccess {
  project: ProjectRow;
  viewer: ProjectActor | null;
  isAdmin: boolean;
  isOwner: boolean;
  isAssignedReviewer: boolean;
  isPubliclyVisible: boolean;
  canView: boolean;
  canEditProject: boolean;
  canSubmitRecords: boolean;
  canUploadEvidence: boolean;
  canReview: boolean;
  canManageReviewers: boolean;
  canApproveProject: boolean;
  canAnchor: boolean;
  canGenerateReport: boolean;
  canSeeRestrictedData: boolean;
  canSeeInternalAudit: boolean;
}

const EDITABLE_STATUSES: ProjectStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'IN_PROGRESS'];
const RECORD_SUBMISSION_STATUSES: ProjectStatus[] = ['APPROVED', 'IN_PROGRESS'];

export function isPubliclyVisibleProject(project: Pick<ProjectRow, 'status' | 'visibility'>): boolean {
  return project.visibility === 'PUBLIC' && PUBLIC_PROJECT_STATUSES.includes(project.status);
}

export async function findProjectRow(projectId: string, executor?: pg.Pool | pg.PoolClient): Promise<ProjectRow | null> {
  const sql = `${PROJECT_SELECT} WHERE p.id = $1`;
  const result = executor ? await executor.query<ProjectRow>(sql, [projectId]) : await query<ProjectRow>(sql, [projectId]);
  return result.rows[0] ?? null;
}

export async function findReviewerAssignment(
  projectId: string,
  reviewerId: string,
  executor?: pg.Pool | pg.PoolClient,
): Promise<{ id: string } | null> {
  const sql = `SELECT id FROM reviewer_assignments WHERE project_id = $1 AND reviewer_id = $2 AND active LIMIT 1`;
  const result = executor
    ? await executor.query<{ id: string }>(sql, [projectId, reviewerId])
    : await query<{ id: string }>(sql, [projectId, reviewerId]);
  return result.rows[0] ?? null;
}

export function buildProjectAccess(project: ProjectRow, actor: ProjectActor | null, assignedReviewer: boolean): ProjectAccess {
  const viewer = actor;
  const isAdmin = actor?.role === 'ADMIN';
  const isOwner = Boolean(actor && project.owner_id === actor.id);
  const isAssignedReviewer = Boolean(actor?.role === 'REVIEWER' && assignedReviewer);
  const isPubliclyVisible = isPubliclyVisibleProject(project);
  const canView = Boolean(isAdmin || isOwner || isAssignedReviewer || isPubliclyVisible);
  const canEditProject = canView && (isAdmin || isOwner) && EDITABLE_STATUSES.includes(project.status);
  const canSubmitRecords = canView && isOwner && RECORD_SUBMISSION_STATUSES.includes(project.status);
  const canUploadEvidence = canView && isOwner && !['COMPLETED', 'CANCELLED'].includes(project.status);
  const canReview = canView && isAssignedReviewer;
  const canManageReviewers = canView && isAdmin;
  const canApproveProject = canView && isAdmin;
  const canAnchor = canView && (isAdmin || isOwner);
  const canSeeRestrictedData = Boolean(viewer && (isAdmin || isOwner || isAssignedReviewer));
  const canSeeInternalAudit = Boolean(viewer && (isAdmin || isOwner || isAssignedReviewer));

  return {
    project,
    viewer,
    isAdmin,
    isOwner,
    isAssignedReviewer,
    isPubliclyVisible,
    canView,
    canEditProject,
    canSubmitRecords,
    canUploadEvidence,
    canReview,
    canManageReviewers,
    canApproveProject,
    canAnchor,
    canGenerateReport: canView && Boolean(viewer) && (isAdmin || isOwner || isAssignedReviewer),
    canSeeRestrictedData,
    canSeeInternalAudit,
  };
}

/** Loads a project and resolves everything the current actor may do with it. Never leaks existence of hidden projects. */
export async function getProjectAccess(actor: ProjectActor | null, projectId: string): Promise<ProjectAccess> {
  const project = await findProjectRow(projectId);
  if (!project) throw notFound('Project not found');
  let assignedReviewer = false;
  if (actor?.role === 'REVIEWER') {
    assignedReviewer = Boolean(await findReviewerAssignment(projectId, actor.id));
  }
  const access = buildProjectAccess(project, actor, assignedReviewer);
  if (!access.canView) throw notFound('Project not found');
  return access;
}

export async function getProjectAccessForUpdate(
  client: pg.PoolClient,
  actor: ProjectActor | null,
  projectId: string,
): Promise<ProjectAccess> {
  const result = await client.query<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = $1 FOR UPDATE OF p`, [projectId]);
  const project = result.rows[0];
  if (!project) throw notFound('Project not found');
  let assignedReviewer = false;
  if (actor?.role === 'REVIEWER') {
    const assignment = await client.query(
      'SELECT 1 FROM reviewer_assignments WHERE project_id = $1 AND reviewer_id = $2 AND active LIMIT 1',
      [projectId, actor.id],
    );
    assignedReviewer = (assignment.rowCount ?? 0) > 0;
  }
  return buildProjectAccess(project, actor, assignedReviewer);
}

export function assertCanEdit(access: ProjectAccess): void {
  if (!access.canEditProject) {
    throw forbidden(
      access.canView
        ? 'This project can no longer be edited in its current state'
        : 'You do not have permission to edit this project',
    );
  }
}

export function assertCanSubmitRecords(access: ProjectAccess): void {
  if (!access.canSubmitRecords) {
    throw forbidden('Only the project owner can submit records, and only while the project is approved or in progress');
  }
}

export function assertCanUploadEvidence(access: ProjectAccess): void {
  if (!access.canUploadEvidence) {
    throw forbidden('Only the project owner can upload evidence while the project is active');
  }
}

export function assertCanManageReviewers(access: ProjectAccess): void {
  if (!access.canManageReviewers) throw forbidden('Only platform administrators can manage reviewer assignments');
}

export function assertCanApproveProject(access: ProjectAccess): void {
  if (!access.canApproveProject) throw forbidden('Only platform administrators can approve or reject projects');
}

export function assertCanReview(access: ProjectAccess): void {
  if (!access.canReview) {
    throw forbidden('You must be an assigned independent reviewer for this project to record a decision');
  }
  if (access.isOwner) throw forbidden('Project owners cannot review their own project records');
}

export function assertCanAnchor(access: ProjectAccess): void {
  if (!access.canAnchor) throw forbidden('Only the project owner or a platform administrator can anchor this record');
}

export function sessionActor(user: SessionUser | null): ProjectActor | null {
  return user ? { id: user.id, role: user.role } : null;
}

export async function projectScopeCondition(
  actor: ProjectActor | null,
  params: unknown[],
  tableAlias = 'p',
): Promise<string> {
  if (!actor) {
    return `${tableAlias}.visibility = 'PUBLIC' AND ${tableAlias}.status IN ${PUBLIC_PROJECT_STATUS_SQL}`;
  }
  if (actor.role === 'ADMIN') return 'TRUE';
  if (actor.role === 'PROJECT_OWNER') {
    params.push(actor.id);
    return `${tableAlias}.owner_id = $${params.length}`;
  }
  if (actor.role === 'REVIEWER') {
    params.push(actor.id);
    return `${tableAlias}.id IN (SELECT project_id FROM reviewer_assignments WHERE reviewer_id = $${params.length} AND active)`;
  }
  return `${tableAlias}.visibility = 'PUBLIC' AND ${tableAlias}.status IN ${PUBLIC_PROJECT_STATUS_SQL}`;
}

export async function runInProjectTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(work);
}
