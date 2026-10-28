import { createCategorySchema, updateCategorySchema } from '@poi/shared';
import { Router } from 'express';
import { sendData } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { createCategory, listCategories, updateCategory } from './categories.service.js';

export const categoriesRouter = Router();

categoriesRouter.get('/', async (req, res) => {
  const includeInactive = req.auth?.user.role === 'ADMIN' && req.query.includeInactive === 'true';
  sendData(res, await listCategories({ includeInactive }));
});

categoriesRouter.post('/', requireAuth, requireRole('ADMIN'), validateBody(createCategorySchema), async (req, res) => {
  const category = await createCategory(req.body, { id: req.auth!.user.id, role: req.auth!.user.role });
  sendData(res, category, undefined, 201);
});

categoriesRouter.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  validateBody(updateCategorySchema),
  async (req, res) => {
    const category = await updateCategory(String(req.params.id), req.body, {
      id: req.auth!.user.id,
      role: req.auth!.user.role,
    });
    sendData(res, category);
  },
);
