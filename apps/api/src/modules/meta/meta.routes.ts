import { Router } from 'express';
import { checkDatabase } from '../../db/pool.js';
import { sendData } from '../../lib/http.js';
import { capabilitiesForRole, type UserRole } from '@poi/shared';
import { getChainInfo } from '../blockchain/blockchain.service.js';
import { listCategories } from '../categories/categories.service.js';
import { getPlatformSettings, publicSettings } from '../settings/settings.service.js';

export const metaRouter = Router();

metaRouter.get('/', async (_req, res) => {
  const [categories, settings] = await Promise.all([listCategories(), getPlatformSettings()]);
  sendData(res, {
    apiVersion: 'v1',
    serverTime: new Date().toISOString(),
    platform: publicSettings(settings),
    chain: getChainInfo(),
    categories,
    capabilitiesByRole: {
      ADMIN: capabilitiesForRole('ADMIN'),
      PROJECT_OWNER: capabilitiesForRole('PROJECT_OWNER'),
      REVIEWER: capabilitiesForRole('REVIEWER'),
      OBSERVER: capabilitiesForRole('OBSERVER'),
    } satisfies Record<UserRole, unknown>,
    disclaimers: {
      anchoring:
        'A confirmed blockchain anchor proves that a specific commitment existed at a point in time. It does not prove that a project was completed, an invoice is genuine, an expenditure was justified, or a reviewer is trustworthy.',
      approvals: 'Approved expenditure claims are independent review decisions, not proof of payment.',
    },
  });
});

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const database = await checkDatabase();
  const chain = getChainInfo();
  res.status(database.ok ? 200 : 503).json({
    data: {
      status: database.ok ? 'ok' : 'degraded',
      database,
      chain: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        contractConfigured: Boolean(chain.contractAddress),
        rpcConfigured: chain.rpcConfigured,
        anchoringAvailable: chain.anchoringAvailable,
        requiredConfirmations: chain.requiredConfirmations,
      },
      timestamp: new Date().toISOString(),
    },
  });
});
