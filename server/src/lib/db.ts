import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

// numeric -> string by default; we keep money as strings at the DB edge and
// convert with toPaise()/fromPaise() to avoid float errors.
pg.types.setTypeParser(1082, (v) => v); // date -> 'YYYY-MM-DD' string, never shifted by TZ

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Db = pg.Pool | pg.PoolClient;

export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool) {
  return db.query<T>(text, params);
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  const r = await db.query<T>(text, params);
  return r.rows[0];
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function migrate(log = true) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await one(`SELECT 1 FROM schema_migrations WHERE name=$1`, [f]);
    if (done) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    await tx(async (c) => {
      await c.query(sql);
      await c.query(`INSERT INTO schema_migrations(name) VALUES ($1)`, [f]);
    });
    if (log) console.log(`[migrate] applied ${f}`);
  }
}
