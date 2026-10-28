import fs from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { getPool } from './pool.js';
import { findRepoRoot } from './repo-root.js';
import { sha256Hex } from '../lib/crypto.js';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(): Promise<MigrationResult> {
  const migrationsDirectory = path.join(findRepoRoot(), 'database', 'migrations');
  const files = (await fs.readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort();
  if (files.length === 0) {
    throw new Error(`No migration files found in ${migrationsDirectory}`);
  }

  const client: pg.PoolClient = await getPool().connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['proof_of_impact_migrations']);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const fullPath = path.join(migrationsDirectory, file);
      const sql = await fs.readFile(fullPath, 'utf8');
      const checksum = sha256Hex(sql);
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE filename = $1',
        [file],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        const recorded = existing.rows[0]?.checksum;
        if (recorded !== checksum) {
          throw new Error(
            `Migration ${file} has changed after being applied. Create a new migration instead of editing history.`,
          );
        }
        skipped.push(file);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['proof_of_impact_migrations']).catch(() => undefined);
    client.release();
  }

  return { applied, skipped };
}
