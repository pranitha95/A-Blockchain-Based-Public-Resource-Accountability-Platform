import pg from 'pg';
import { getEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';

const { Pool, types } = pg;

// Keep calendar dates as strings to avoid timezone drift in JSON responses.
types.setTypeParser(1082, (value) => value);

let poolInstance: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (poolInstance) return poolInstance;
  const env = getEnv();
  poolInstance = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.NODE_ENV === 'test' ? 8 : 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    application_name: 'proof-of-impact-api',
  });
  poolInstance.on('error', (error) => {
    logger.error({ err: error }, 'Unexpected PostgreSQL pool error');
  });
  return poolInstance;
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}

export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, 'Failed to roll back transaction');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[]);
}

export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: (error as Error).message };
  }
}
