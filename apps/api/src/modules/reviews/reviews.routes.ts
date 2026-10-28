import { createReviewSchema } from '@poi/shared';
import { Router } from 'express';
import { sendData } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { createReview, listReviewQueue } from './reviews.service.js';

export const reviewsRouter = Router();

reviewsRouter.get('/queue', requireAuth, requireRole('REVIEWER', 'ADMIN'), async (req, res) => {
  sendData(res, await listReviewQueue(req.auth!.user));
});

reviewsRouter.post('/', requireAuth, validateBody(createReviewSchema), async (req, res) => {
  const review = await createReview(
    req.auth!.user,
    req.body.targetType,
    req.body.targetId,
    { decision: req.body.decision, rationale: req.body.rationale },
  );
  sendData(res, review, undefined, 201);
});
