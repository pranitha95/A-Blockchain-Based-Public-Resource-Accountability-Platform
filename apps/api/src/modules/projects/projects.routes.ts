import {
  assignReviewerSchema,
  createProjectSchema,
  projectBudgetSchema,
  projectStatusSchema,
  reportCreateSchema,
  updateProjectSchema,
} from '@poi/shared';
import { Router } from 'express';
import { sendData, sendPaginated } from '../../lib/http.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { listAuditEvents } from '../audit/audit.service.js';
import { generateReport } from '../reports/reports.service.js';
import { listProjectReviews } from '../reviews/reviews.service.js';
import { getPlatformSettings } from '../settings/settings.service.js';
import { listProjectEvidence } from '../evidence/evidence.service.js';
import { listProjectClaims, parseClaimListOptions } from '../claims/claims.service.js';
import { createMilestone, listMilestones } from '../milestones/milestones.service.js';
import { milestoneCreateSchema } from '@poi/shared';
import { getProjectAccess, sessionActor } from './project-access.js';
import {
  assignReviewer,
  changeProjectBudget,
  changeProjectStatus,
  createProject,
  getProjectDetail,
  listEligibleReviewers,
  listProjectStatusHistory,
  listProjects,
  listReviewerAssignments,
  parseProjectFilters,
  projectBudgetHistory,
  removeReviewer,
  updateProject,
} from './projects.service.js';

export const projectsRouter = Router();

projectsRouter.get('/', async (req, res) => {
  const actor = req.auth?.user ?? null;
  if (!actor || actor.role === 'OBSERVER') {
    const settings = await getPlatformSettings();
    if (!settings.publicDirectoryEnabled) {
      throw notFound('The public project directory is currently disabled');
    }
  }
  const { filters, pagination } = parseProjectFilters(req.query);
  sendPaginated(res, await listProjects(actor, filters, pagination));
});

projectsRouter.post('/', requireAuth, requireRole('ADMIN'), validateBody(createProjectSchema), async (req, res) => {
  const project = await createProject(req.auth!.user, req.body);
  sendData(res, project, undefined, 201);
});

projectsRouter.get('/:projectId', async (req, res) => {
  sendData(res, await getProjectDetail(req.auth?.user ?? null, String(req.params.projectId)));
});

projectsRouter.patch('/:projectId', requireAuth, validateBody(updateProjectSchema), async (req, res) => {
  sendData(
    res,
    await updateProject(req.auth!.user, String(req.params.projectId), req.body),
  );
});

projectsRouter.patch('/:projectId/status', requireAuth, validateBody(projectStatusSchema), async (req, res) => {
  const project = await changeProjectStatus(req.auth!.user, String(req.params.projectId), {
    status: req.body.status,
    reason: req.body.reason,
  });
  sendData(res, project);
});

projectsRouter.patch('/:projectId/budget', requireAuth, validateBody(projectBudgetSchema), async (req, res) => {
  const project = await changeProjectBudget(req.auth!.user, String(req.params.projectId), req.body);
  sendData(res, project);
});

projectsRouter.get('/:projectId/status-history', async (req, res) => {
  sendData(res, await listProjectStatusHistory(req.auth?.user ?? null, String(req.params.projectId)));
});

projectsRouter.get('/:projectId/budget-history', async (req, res) => {
  sendData(res, await projectBudgetHistory(req.auth?.user ?? null, String(req.params.projectId)));
});

projectsRouter.get('/:projectId/reviewers', requireAuth, async (req, res) => {
  sendData(res, await listReviewerAssignments(req.auth!.user, String(req.params.projectId)));
});

projectsRouter.get('/:projectId/eligible-reviewers', requireAuth, requireRole('ADMIN'), async (req, res) => {
  sendData(res, await listEligibleReviewers(req.auth!.user, String(req.params.projectId)));
});

projectsRouter.post(
  '/:projectId/reviewers',
  requireAuth,
  requireRole('ADMIN'),
  validateBody(assignReviewerSchema),
  async (req, res) => {
    const assignment = await assignReviewer(req.auth!.user, String(req.params.projectId), {
      reviewerId: req.body.reviewerId,
      conflictNote: req.body.conflictNote,
    });
    sendData(res, assignment, undefined, 201);
  },
);

projectsRouter.delete('/:projectId/reviewers/:assignmentId', requireAuth, requireRole('ADMIN'), async (req, res) => {
  await removeReviewer(req.auth!.user, String(req.params.projectId), String(req.params.assignmentId));
  sendData(res, { removed: true });
});

projectsRouter.get('/:projectId/milestones', optionalAuth, async (req, res) => {
  sendData(res, await listMilestones(req.auth?.user ?? null, String(req.params.projectId)));
});

projectsRouter.post(
  '/:projectId/milestones',
  requireAuth,
  validateBody(milestoneCreateSchema),
  async (req, res) => {
    const milestone = await createMilestone(req.auth!.user, String(req.params.projectId), req.body);
    sendData(res, milestone, undefined, 201);
  },
);

projectsRouter.get('/:projectId/claims', async (req, res) => {
  const options = parseClaimListOptions(req.query);
  sendPaginated(
    res,
    await listProjectClaims(req.auth?.user ?? null, String(req.params.projectId), options),
  );
});

projectsRouter.get('/:projectId/evidence', async (req, res) => {
  sendData(res, await listProjectEvidence(req.auth?.user ?? null, String(req.params.projectId)));
});

projectsRouter.get('/:projectId/reviews', async (req, res) => {
  sendData(res, await listProjectReviews(req.auth?.user ?? null, String(req.params.projectId)));
});

projectsRouter.post(
  '/:projectId/reports',
  requireAuth,
  validateBody(reportCreateSchema),
  async (req, res) => {
    const report = await generateReport(req.auth!.user, String(req.params.projectId), {
      format: req.body.format,
      title: req.body.title,
    });
    sendData(res, report, undefined, 201);
  },
);

projectsRouter.get('/:projectId/audit', optionalAuth, async (req, res) => {
  const projectId = String(req.params.projectId);
  const actor = req.auth?.user ?? null;
  const access = await getProjectAccess(sessionActor(actor), projectId);
  if (!access.canView) throw notFound('Project not found');
  if (!access.canSeeInternalAudit) {
    throw forbidden('Detailed project audit history is available to project participants only');
  }
  const action = typeof req.query.action === 'string' ? req.query.action.slice(0, 80) : undefined;
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 25);
  const result = await listAuditEvents({
    viewer: actor ? { role: actor.role, userId: actor.id } : null,
    projectId,
    action,
    page,
    pageSize,
  });
  sendPaginated(res, result);
});
