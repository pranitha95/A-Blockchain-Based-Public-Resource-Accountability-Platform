import type { AccountStatus, UserRole } from '@poi/shared';
import { createUserSchema, updateUserSchema } from '@poi/shared';
import { Router } from 'express';
import { z } from 'zod';
import { sendData, sendPaginated } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { createUserByAdmin, listReviewers, listUsers, updateUserByAdmin } from './users.service.js';

export const usersRouter = Router();

usersRouter.use(requireAuth, requireRole('ADMIN'));

usersRouter.get('/', async (req, res) => {
  const querySchema = z.object({
    search: z.string().trim().max(120).optional(),
    role: z.enum(['ADMIN', 'PROJECT_OWNER', 'REVIEWER', 'OBSERVER']).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  });
  const parsed = querySchema.parse(req.query);
  const result = await listUsers({
    search: parsed.search,
    role: parsed.role as UserRole | undefined,
    status: parsed.status as AccountStatus | undefined,
    page: parsed.page,
    pageSize: parsed.pageSize,
  });
  sendPaginated(res, result);
});

usersRouter.get('/reviewers', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
  sendData(res, await listReviewers(search));
});

usersRouter.post('/', validateBody(createUserSchema), async (req, res) => {
  const user = await createUserByAdmin(req.body, { id: req.auth!.user.id, role: req.auth!.user.role });
  sendData(res, user, undefined, 201);
});

usersRouter.patch('/:id', validateBody(updateUserSchema), async (req, res) => {
  const user = await updateUserByAdmin(String(req.params.id), req.body, {
    id: req.auth!.user.id,
    role: req.auth!.user.role,
  });
  sendData(res, user);
});
