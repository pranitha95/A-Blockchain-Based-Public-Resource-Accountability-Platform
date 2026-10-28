import { createOrganizationSchema, uuidSchema } from '@poi/shared';
import { Router } from 'express';
import { z } from 'zod';
import { sendData } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import {
  addOrganizationMember,
  createOrganization,
  listOrganizationMembers,
  listOrganizations,
  removeOrganizationMember,
  updateOrganization,
} from './organizations.service.js';

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth, requireRole('ADMIN'));

organizationsRouter.get('/', async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
  sendData(res, await listOrganizations(search));
});

organizationsRouter.post('/', validateBody(createOrganizationSchema), async (req, res) => {
  const organization = await createOrganization(req.body, { id: req.auth!.user.id, role: req.auth!.user.role });
  sendData(res, organization, undefined, 201);
});

organizationsRouter.patch('/:id', validateBody(createOrganizationSchema.partial()), async (req, res) => {
  const organization = await updateOrganization(String(req.params.id), req.body, {
    id: req.auth!.user.id,
    role: req.auth!.user.role,
  });
  sendData(res, organization);
});

organizationsRouter.get('/:id/members', async (req, res) => {
  sendData(res, await listOrganizationMembers(String(req.params.id)));
});

organizationsRouter.post(
  '/:id/members',
  validateBody(z.object({ userId: uuidSchema, role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER') })),
  async (req, res) => {
    await addOrganizationMember(String(req.params.id), req.body.userId, req.body.role, {
      id: req.auth!.user.id,
      role: req.auth!.user.role,
    });
    sendData(res, { added: true }, undefined, 201);
  },
);

organizationsRouter.delete('/:id/members/:userId', async (req, res) => {
  await removeOrganizationMember(String(req.params.id), String(req.params.userId), {
    id: req.auth!.user.id,
    role: req.auth!.user.role,
  });
  sendData(res, { removed: true });
});
