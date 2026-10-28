/**
 * Starts a real PostgreSQL 17 development server with embedded binaries.
 * Production deployments should use a separately managed PostgreSQL instance
 * configured through DATABASE_URL.
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../src/db/repo-root.js';

const repoRoot = findRepoRoot();
const databaseDir = path.join(repoRoot, 'var', 'pgdata');
const port = Number(process.env.DEV_DB_PORT ?? 55432);
const databaseName = 'proof_of_impact';

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  onLog: () => undefined,
  onError: (error) => console.error('[embedded-postgres]', error),
});

const clusterInitialised = fs.existsSync(path.join(databaseDir, 'PG_VERSION'));

try {
  if (!clusterInitialised) {
    console.log(`Initialising PostgreSQL cluster in ${databaseDir} ...`);
    await pg.initialise();
  }
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  await client.end();
  if (!existing.rowCount) {
    await pg.createDatabase(databaseName);
    console.log(`Created database "${databaseName}".`);
  }
  console.log('');
  console.log('Embedded PostgreSQL is running.');
  console.log(`  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:${port}/${databaseName}`);
  console.log('');
  console.log('Leave this terminal open. Press Ctrl+C to stop the database.');
} catch (error) {
  console.error('Failed to start the development database:', (error as Error).message);
  process.exitCode = 1;
}

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`\nReceived ${signal}; stopping PostgreSQL ...`);
  try {
    await pg.stop();
  } catch (error) {
    console.error('Failed to stop PostgreSQL cleanly:', (error as Error).message);
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
