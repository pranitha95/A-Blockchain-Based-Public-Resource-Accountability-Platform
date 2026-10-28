import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { closePool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { getChainInfo, reconcilePendingAnchors } from './modules/blockchain/blockchain.service.js';

const env = getEnv();

if (env.NODE_ENV !== 'production') {
  try {
    const result = await runMigrations();
    if (result.applied.length > 0) {
      logger.info({ applied: result.applied }, 'Database migrations applied at startup');
    }
  } catch (error) {
    logger.fatal({ err: error }, 'Database migration failed; the API will not start');
    process.exit(1);
  }
}

const app = createApp();
const server = app.listen(env.PORT, () => {
  const chain = getChainInfo();
  logger.info(
    {
      port: env.PORT,
      environment: env.NODE_ENV,
      apiBase: `http://localhost:${env.PORT}/api/v1`,
      docs: `http://localhost:${env.PORT}/api/docs`,
      chainId: chain.chainId,
      anchoringAvailable: chain.anchoringAvailable,
    },
    'Proof of Impact API listening',
  );
  if (!chain.anchoringAvailable) {
    logger.warn(
      'Blockchain anchoring is not configured. Set RPC_URL and CONTRACT_ADDRESS after deploying the registry contract; preparation and verification will honestly report the unavailable state.',
    );
  }
});

let reconcileTimer: NodeJS.Timeout | null = null;
if (env.RPC_URL && env.CONTRACT_ADDRESS) {
  reconcileTimer = setInterval(() => {
    reconcilePendingAnchors()
      .then((result) => {
        if (result.checked > 0 || result.errors > 0) {
          logger.info(result, 'Blockchain anchor reconciliation completed');
        }
      })
      .catch((error) => logger.error({ err: error }, 'Blockchain anchor reconciliation failed'));
  }, env.RECONCILE_INTERVAL_MS);
  reconcileTimer.unref();
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  if (reconcileTimer) clearInterval(reconcileTimer);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
