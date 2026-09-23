// One-time schema/seed runner for a fresh Vercel Postgres (or Neon, or any
// standard Postgres) database. Run with `npm run db:migrate` after setting
// POSTGRES_URL or DATABASE_URL. Safe to re-run: schema creation is idempotent
// (`CREATE TABLE IF NOT EXISTS`) and the request_types seed uses
// `ON CONFLICT DO NOTHING`, so running this twice never duplicates or errors.
import { getPool, initSchema, seed } from '../lib/db';

async function main() {
  const pool = getPool();
  console.log('Initializing schema...');
  await initSchema(pool);
  console.log('Seeding request types and sample data (idempotent)...');
  await seed(pool);
  console.log('Migration complete.');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
