import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { openDatabase } from './client.ts';

/** Versioned, checksum-locked forward migrations, only against the dedicated DB. */
export async function migrate(pool: Pool) {
  const client = await pool.connect();
  try {
    const actual = await client.query<{ name: string; role: string }>(
      'SELECT current_database() AS name,current_user AS role',
    );
    if (
      !/^wanwu_sound(?:_test_[a-f0-9]{8})?$/.test(actual.rows[0]!.name) ||
      actual.rows[0]!.role !== 'wanwu_owner'
    )
      throw new Error('Refusing migration outside the dedicated Wanwu owner connection');
    await client.query('SELECT pg_advisory_lock(728091,1)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS _wanwu_migrations (name text PRIMARY KEY,sha256 char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const folder = new URL('../../migrations/', import.meta.url);
    for (const name of (await readdir(folder))
      .filter((name) => /^\d{4}_[a-z_]+\.sql$/.test(name))
      .sort()) {
      const source = await readFile(new URL(name, folder), 'utf8'),
        checksum = createHash('sha256').update(source).digest('hex');
      const existing = await client.query<{ sha256: string }>(
        'SELECT sha256 FROM _wanwu_migrations WHERE name=$1',
        [name],
      );
      if (existing.rows.length) {
        if (existing.rows[0]!.sha256 !== checksum)
          throw new Error('An applied migration was changed');
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(source);
        await client.query('INSERT INTO _wanwu_migrations(name,sha256) VALUES($1,$2)', [
          name,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(728091,1)');
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const database = openDatabase(process.env.WANWU_MIGRATION_DATABASE_URL ?? '', 'owner');
  try {
    await migrate(database.pool);
    console.log('Wanwu database migrations applied.');
  } catch {
    console.error('Wanwu migration failed; no credentials are logged.');
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}
