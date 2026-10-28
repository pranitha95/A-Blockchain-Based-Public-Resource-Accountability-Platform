import { closePool } from './pool.js';
import { runMigrations } from './migrate.js';
import { logger } from '../lib/logger.js';

try {
  const result = await runMigrations();
  if (result.applied.length === 0) {
    logger.info({ skipped: result.skipped.length }, 'Database schema is up to date');
  } else {
    logger.info({ applied: result.applied }, 'Database migrations applied');
  }
} catch (error) {
  logger.error({ err: error }, 'Database migration failed');
  process.exitCode = 1;
} finally {
  await closePool();
}
