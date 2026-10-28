import { Router } from 'express';
import { sendData } from '../../lib/http.js';
import { getOverview } from './stats.service.js';

export const statsRouter = Router();

statsRouter.get('/overview', async (req, res) => {
  sendData(res, await getOverview(req.auth?.user ?? null));
});
