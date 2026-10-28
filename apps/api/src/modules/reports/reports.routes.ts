import { Router } from 'express';
import { sendData, sendPaginated } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { getReport, listReports } from './reports.service.js';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get('/', async (req, res) => {
  const projectId = typeof req.query.projectId === 'string' && req.query.projectId.trim() !== ''
    ? req.query.projectId.trim()
    : undefined;
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 20);
  sendPaginated(res, await listReports(req.auth!.user, { projectId, page, pageSize }));
});

reportsRouter.get('/:reportId', async (req, res) => {
  sendData(res, await getReport(req.auth!.user, String(req.params.reportId)));
});
