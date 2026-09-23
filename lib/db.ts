import type { Pool as PgPool, PoolClient } from 'pg';
import { REQUEST_TYPES } from './types';

// A minimal shape covering both a real `pg` Pool/PoolClient and the pg-mem
// polyfills used in tests -- both expose an async `.query()` with this signature.
export type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

// OYO_TEST_DB swaps the real `pg` Pool for an in-memory pg-mem-backed one, so
// `npm test` never makes a real network Postgres connection.
const isTestDb = () => !!process.env.OYO_TEST_DB;

declare global {
  // eslint-disable-next-line no-var
  var __oyoPool: PgPool | undefined;
  // eslint-disable-next-line no-var
  var __oyoPoolReady: Promise<void> | undefined;
}

export function resolveConnectionString(): string {
  const conn = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!conn) {
    throw new Error(
      'Missing database configuration: set the POSTGRES_URL or DATABASE_URL environment ' +
        'variable to a Postgres connection string before starting the app.'
    );
  }
  return conn;
}

function createPool(): PgPool {
  if (isTestDb()) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { newDb } = require('pg-mem');
    const memDb = newDb();
    const adapter = memDb.adapters.createPg();
    return new adapter.Pool();
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require('pg');
  const connectionString = resolveConnectionString();
  return new Pool({ connectionString });
}

export function getPool(): PgPool {
  if (!global.__oyoPool) {
    global.__oyoPool = createPool();
  }
  return global.__oyoPool;
}

export async function initSchema(pool: Queryable): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS request_types (
      type TEXT PRIMARY KEY,
      required_levels INTEGER NOT NULL DEFAULT 1
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      requester TEXT NOT NULL,
      status TEXT NOT NULL,
      current_level INTEGER NOT NULL DEFAULT 1,
      evidence_url TEXT,
      evidence_original_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS approvals (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES requests(id),
      level INTEGER NOT NULL,
      decision TEXT NOT NULL,
      approver_role TEXT NOT NULL,
      approver_name TEXT NOT NULL,
      decided_at TEXT NOT NULL
    )
  `);
}

/**
 * Explicit BEGIN/COMMIT/ROLLBACK transaction helper around a pooled client --
 * the async equivalent of a synchronous single-connection transaction wrapper.
 */
export async function withTransaction<T>(
  pool: PgPool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed after an earlier error; original error follows:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function seed(pool: PgPool): Promise<void> {
  // Idempotent: ON CONFLICT DO NOTHING means re-running this (migration re-run,
  // or racing cold starts) can never duplicate or corrupt the five fixed types.
  for (const type of REQUEST_TYPES) {
    await pool.query(
      'INSERT INTO request_types (type, required_levels) VALUES ($1, 1) ON CONFLICT (type) DO NOTHING',
      [type]
    );
  }

  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM requests');
  if (rows[0].c > 0) {
    return;
  }

  const now = new Date();
  const iso = (offsetMinutes: number) => new Date(now.getTime() - offsetMinutes * 60_000).toISOString();

  await withTransaction(pool, async (client) => {
    const insertRequest = async (params: {
      type: string;
      title: string;
      description: string;
      amount: number;
      requester: string;
      status: string;
      current_level: number;
      evidence_url: string | null;
      evidence_original_name: string | null;
      created_at: string;
      updated_at: string;
    }) => {
      const { rows: inserted } = await client.query(
        `INSERT INTO requests
           (type, title, description, amount, requester, status, current_level,
            evidence_url, evidence_original_name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          params.type,
          params.title,
          params.description,
          params.amount,
          params.requester,
          params.status,
          params.current_level,
          params.evidence_url,
          params.evidence_original_name,
          params.created_at,
          params.updated_at,
        ]
      );
      return inserted[0].id as number;
    };

    const insertApproval = (params: {
      request_id: number;
      level: number;
      decision: string;
      approver_role: string;
      approver_name: string;
      decided_at: string;
    }) =>
      client.query(
        `INSERT INTO approvals (request_id, level, decision, approver_role, approver_name, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          params.request_id,
          params.level,
          params.decision,
          params.approver_role,
          params.approver_name,
          params.decided_at,
        ]
      );

    // 1) A fully closed Purchasing request. There's no local disk to seed a real
    // file onto anymore (no migration of local demo data is in scope), so this
    // links to a placeholder URL purely for display purposes.
    const closedId = await insertRequest({
      type: 'Purchasing',
      title: 'Restock front-desk office supplies',
      description: 'Paper, pens, and printer toner for the front desk.',
      amount: 120.5,
      requester: 'Minh Tran',
      status: 'Closed',
      current_level: 1,
      evidence_url: 'https://example.com/seed-evidence/purchase-receipt.txt',
      evidence_original_name: 'purchase-receipt.txt',
      created_at: iso(60 * 24 * 3),
      updated_at: iso(60 * 24 * 1),
    });
    await insertApproval({
      request_id: closedId,
      level: 1,
      decision: 'Approved',
      approver_role: 'Approver',
      approver_name: 'Approver',
      decided_at: iso(60 * 24 * 2),
    });

    // 2) A rejected Maintenance request.
    const rejectedId = await insertRequest({
      type: 'Maintenance',
      title: 'Replace lobby AC unit',
      description: 'Lobby AC unit is leaking and needs replacement.',
      amount: 850,
      requester: 'Lan Pham',
      status: 'Rejected',
      current_level: 1,
      evidence_url: null,
      evidence_original_name: null,
      created_at: iso(60 * 24 * 2),
      updated_at: iso(60 * 20),
    });
    await insertApproval({
      request_id: rejectedId,
      level: 1,
      decision: 'Rejected',
      approver_role: 'Approver',
      approver_name: 'Approver',
      decided_at: iso(60 * 20),
    });

    // 3) A freshly submitted / mid-approval Security request (no decisions yet).
    await insertRequest({
      type: 'Security',
      title: 'Additional CCTV camera for parking area',
      description: 'Install one extra CCTV camera covering the rear parking area.',
      amount: 300,
      requester: 'Duc Nguyen',
      status: 'Submitted',
      current_level: 1,
      evidence_url: null,
      evidence_original_name: null,
      created_at: iso(30),
      updated_at: iso(30),
    });
  });
}

/**
 * Returns the ready-to-query connection pool, lazily running schema init +
 * seed exactly once per process (mirrors the previous synchronous `getDb()`).
 */
export async function getDb(): Promise<PgPool> {
  const pool = getPool();
  if (!global.__oyoPoolReady) {
    global.__oyoPoolReady = (async () => {
      await initSchema(pool);
      await seed(pool);
    })().catch((err) => {
      // Don't permanently cache a failed init -- a transient cold-start error
      // (e.g. the DB was briefly unreachable) shouldn't fail every request
      // forever in this warm process; let the next call retry from scratch.
      global.__oyoPoolReady = undefined;
      throw err;
    });
  }
  await global.__oyoPoolReady;
  return pool;
}
