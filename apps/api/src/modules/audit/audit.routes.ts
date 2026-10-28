import { Router } from 'express';
import { sendPaginated, sendData } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { getProjectAccess, sessionActor } from '../projects/project-access.js';
import { listAuditEvents, verifyAuditChain } from './audit.service.js';

export const auditRouter = Router();

auditRouter.get('/', async (req, res) => {
  const actor = req.auth?.user ?? null;
  const projectId = typeof req.query.projectId === 'string' && req.query.projectId.trim() !== ''
    ? req.query.projectId.trim()
    : undefined;
  if (projectId) {
    const access = await getProjectAccess(sessionActor(actor), projectId);
    if (!access.canView) throw notFound('Project not found');
  }
  const result = await listAuditEvents({
    viewer: actor ? { role: actor.role, userId: actor.id } : null,
    projectId,
    action: typeof req.query.action === 'string' ? req.query.action.slice(0, 80) : undefined,
    entityType: typeof req.query.entityType === 'string' ? req.query.entityType.slice(0, 60) : undefined,
    search: typeof req.query.q === 'string' && req.query.q.trim() !== '' ? req.query.q.trim().slice(0, 160) : undefined,
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 25),
  });
  sendPaginated(res, result);
});

auditRouter.get('/integrity', async (_req, res) => {
  sendData(res, await verifyAuditChain());
});
