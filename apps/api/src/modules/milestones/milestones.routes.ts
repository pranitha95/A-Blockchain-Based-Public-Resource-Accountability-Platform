import { milestoneSubmissionSchema, milestoneUpdateSchema } from '@poi/shared';
import { Router } from 'express';
import { sendData } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import {
  getMilestoneDetail,
  listMilestoneSubmissions,
  startMilestone,
  submitMilestone,
  updateMilestone,
} from './milestones.service.js';

export const milestonesRouter = Router();

milestonesRouter.get('/:milestoneId', async (req, res) => {
  sendData(res, await getMilestoneDetail(req.auth?.user ?? null, String(req.params.milestoneId)));
});

milestonesRouter.patch('/:milestoneId', requireAuth, validateBody(milestoneUpdateSchema), async (req, res) => {
  sendData(res, await updateMilestone(req.auth!.user, String(req.params.milestoneId), req.body));
});

milestonesRouter.post('/:milestoneId/start', requireAuth, async (req, res) => {
  sendData(res, await startMilestone(req.auth!.user, String(req.params.milestoneId)));
});

milestonesRouter.post(
  '/:milestoneId/submit',
  requireAuth,
  validateBody(milestoneSubmissionSchema),
  async (req, res) => {
    sendData(
      res,
      await submitMilestone(req.auth!.user, String(req.params.milestoneId), {
        summary: req.body.summary,
        evidenceIds: req.body.evidenceIds,
      }),
    );
  },
);

milestonesRouter.get('/:milestoneId/submissions', async (req, res) => {
  sendData(res, await listMilestoneSubmissions(req.auth?.user ?? null, String(req.params.milestoneId)));
});
