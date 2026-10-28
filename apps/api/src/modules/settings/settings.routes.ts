import { settingsUpdateSchema } from '@poi/shared';
import { Router } from 'express';
import { sendData } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { getPlatformSettings, publicSettings, updatePlatformSettings } from './settings.service.js';

export const settingsRouter = Router();

settingsRouter.get('/', async (_req, res) => {
  sendData(res, publicSettings(await getPlatformSettings()));
});

export const adminSettingsRouter = Router();

adminSettingsRouter.use(requireAuth, requireRole('ADMIN'));

adminSettingsRouter.get('/', async (_req, res) => {
  sendData(res, await getPlatformSettings());
});

adminSettingsRouter.patch('/', validateBody(settingsUpdateSchema), async (req, res) => {
  sendData(res, await updatePlatformSettings(req.auth!.user, req.body));
});
