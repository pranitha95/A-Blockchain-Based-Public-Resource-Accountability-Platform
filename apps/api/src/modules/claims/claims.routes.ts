import { expenditureClaimSchema } from '@poi/shared';
import { Router } from 'express';
import { sendData } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import {
  amendExpenditureClaim,
  createExpenditureClaim,
  getClaimDetail,
  listClaimVersions,
} from './claims.service.js';

export const claimsRouter = Router();

claimsRouter.get('/:claimId', async (req, res) => {
  sendData(res, await getClaimDetail(req.auth?.user ?? null, String(req.params.claimId)));
});

claimsRouter.get('/:claimId/versions', async (req, res) => {
  sendData(res, await listClaimVersions(req.auth?.user ?? null, String(req.params.claimId)));
});

claimsRouter.post('/:claimId/amend', requireAuth, validateBody(expenditureClaimSchema), async (req, res) => {
  sendData(res, await amendExpenditureClaim(req.auth!.user, String(req.params.claimId), req.body), undefined, 201);
});

export const projectClaimsRouter = Router({ mergeParams: true });

projectClaimsRouter.post('/', requireAuth, validateBody(expenditureClaimSchema), async (req, res) => {
  sendData(
    res,
    await createExpenditureClaim(req.auth!.user, String(req.params.projectId), req.body),
    undefined,
    201,
  );
});
