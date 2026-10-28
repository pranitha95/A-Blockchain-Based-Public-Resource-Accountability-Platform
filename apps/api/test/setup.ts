import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll } from 'vitest';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, '../../..');

dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error('DATABASE_URL is required. Start the development database with "npm run dev:db" first.');
}

const TEST_DATABASE_NAME = 'proof_of_impact_test';
const testDatabaseUrl = new URL(baseUrl);
testDatabaseUrl.pathname = `/${TEST_DATABASE_NAME}`;

const administrationUrl = new URL(baseUrl);
administrationUrl.pathname = '/postgres';

const administrationClient = new pg.Client({ connectionString: administrationUrl.toString() });
try {
  await administrationClient.connect();
  await administrationClient.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE_NAME} WITH (FORCE)`);
  await administrationClient.query(`CREATE DATABASE ${TEST_DATABASE_NAME}`);
} catch (error) {
  throw new Error(
    `Could not create the isolated test database "${TEST_DATABASE_NAME}". Is PostgreSQL running? Start it with "npm run dev:db".\n${(error as Error).message}`,
    { cause: error },
  );
} finally {
  await administrationClient.end().catch(() => undefined);
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: testDatabaseUrl.toString(),
  LOG_LEVEL: 'silent',
  RATE_LIMIT_ENABLED: 'false',
  COOKIE_SECURE: 'false',
  DEMO_MODE: 'true',
  SEED_DEMO: 'false',
  FILE_STORAGE_DIR: path.join(repoRoot, 'var', 'test-uploads'),
  SERVE_WEB: 'false',
  WEB_ORIGIN: 'http://localhost:5173',
  RPC_URL: '',
  CONTRACT_ADDRESS: '',
  TRUST_PROXY: 'false',
});
delete process.env.SEED_DEMO_PASSWORD;

await fs.rm(path.join(repoRoot, 'var', 'test-uploads'), { recursive: true, force: true });

const { runMigrations } = await import('../src/db/migrate.js');
await runMigrations();

afterAll(async () => {
  const { closePool } = await import('../src/db/pool.js');
  await closePool();
});
