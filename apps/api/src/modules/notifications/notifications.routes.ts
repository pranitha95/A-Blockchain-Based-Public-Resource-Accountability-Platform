import { Router } from 'express';
import { sendData, sendPaginated } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications.service.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  const result = await listNotifications(req.auth!.user.id, {
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 20),
    unreadOnly: req.query.unreadOnly === 'true',
  });
  const { unreadCount, ...page } = result;
  sendPaginated(res, page, { unreadCount });
});

notificationsRouter.patch('/:notificationId/read', async (req, res) => {
  sendData(res, await markNotificationRead(req.auth!.user.id, String(req.params.notificationId)));
});

notificationsRouter.post('/read-all', async (req, res) => {
  const updated = await markAllNotificationsRead(req.auth!.user.id);
  sendData(res, { updated });
});
