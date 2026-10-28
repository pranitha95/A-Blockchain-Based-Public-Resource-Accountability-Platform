import {
  anchorPrepareSchema,
  anchorTransactionSchema,
  verificationRequestSchema,
} from '@poi/shared';
import { Router } from 'express';
import { sendData, sendPaginated } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { assertCanAnchor, getProjectAccess, sessionActor } from '../projects/project-access.js';
import {
  getAnchorDetail,
  getChainInfo,
  listAnchors,
  prepareAnchor,
  reconcileAnchor,
  submitAnchorTransaction,
  verifyRecord,
} from './blockchain.service.js';

export const anchorsRouter = Router();

anchorsRouter.get('/chain-info', (_req, res) => {
  sendData(res, getChainInfo());
});

anchorsRouter.get('/', async (req, res) => {
  const options = {
    projectId: typeof req.query.projectId === 'string' && req.query.projectId.trim() !== '' ? req.query.projectId.trim() : undefined,
    recordType: typeof req.query.recordType === 'string' ? (req.query.recordType as never) : undefined,
    status: typeof req.query.status === 'string' ? (req.query.status as never) : undefined,
    page: Number(req.query.page ?? 1),
    pageSize: Number(req.query.pageSize ?? 20),
  };
  sendPaginated(res, await listAnchors(req.auth?.user ?? null, options));
});

anchorsRouter.get('/:anchorId', async (req, res) => {
  sendData(res, await getAnchorDetail(req.auth?.user ?? null, String(req.params.anchorId)));
});

anchorsRouter.post('/prepare', requireAuth, validateBody(anchorPrepareSchema), async (req, res) => {
  const anchor = await prepareAnchor(req.auth!.user, {
    recordType: req.body.recordType,
    recordId: req.body.recordId,
  });
  sendData(res, anchor, undefined, 201);
});

anchorsRouter.post(
  '/:anchorId/transaction',
  requireAuth,
  validateBody(anchorTransactionSchema),
  async (req, res) => {
    sendData(
      res,
      await submitAnchorTransaction(req.auth!.user, String(req.params.anchorId), req.body.txHash),
    );
  },
);

anchorsRouter.post('/:anchorId/reconcile', requireAuth, async (req, res) => {
  const anchor = await getAnchorDetail(req.auth!.user, String(req.params.anchorId));
  const access = await getProjectAccess(sessionActor(req.auth!.user), anchor.projectId);
  assertCanAnchor(access);
  const status = await reconcileAnchor(anchor.id);
  sendData(res, await getAnchorDetail(req.auth!.user, anchor.id), { previousStatus: status ?? undefined });
});

export const verificationRouter = Router();

verificationRouter.post('/', validateBody(verificationRequestSchema), async (req, res) => {
  sendData(res, await verifyRecord(req.auth?.user ?? null, req.body));
});

verificationRouter.get('/:anchorId', async (req, res) => {
  sendData(res, await verifyRecord(req.auth?.user ?? null, { anchorId: String(req.params.anchorId) }));
});
