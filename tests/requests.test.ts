import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// OYO_TEST_DB selects the pg-mem in-memory Postgres-compatible adapter in
// lib/db.ts (instead of a real `pg` Pool) and the in-memory fake in
// lib/blob.ts (instead of a real @vercel/blob call), so this whole suite
// runs fully offline -- no network Postgres or Blob call is ever made.
process.env.OYO_TEST_DB = '1';

type RequestsModule = typeof import('../lib/requests');
let mod: RequestsModule;

before(async () => {
  // Dynamic import (inside an async hook, not top-level await) so the
  // OYO_TEST_DB assignment above happens before lib/db.ts is first loaded.
  mod = await import('../lib/requests');
});

async function makeRequest(type: string, requester = 'Test Requester') {
  return mod.createRequest({
    type,
    title: `${type} request`,
    description: 'A test request',
    amount: 100,
    requester,
  });
}

async function assertRejects(fn: () => Promise<unknown>, messageIncludes?: string) {
  try {
    await fn();
    assert.fail('expected function to throw');
  } catch (err) {
    assert.ok(err instanceof mod.RequestError, `expected RequestError, got ${err}`);
    if (messageIncludes) {
      assert.match((err as InstanceType<typeof mod.RequestError>).message, new RegExp(messageIncludes));
    }
  }
}

test('CAP-6: admin can set and read back a required-level rule', async () => {
  const rules = await mod.setApprovalRule('Purchasing', 2);
  const purchasing = rules.find((r) => r.requestType === 'Purchasing');
  assert.equal(purchasing?.requiredLevels, 2);

  const reread = (await mod.getApprovalRules()).find((r) => r.requestType === 'Purchasing');
  assert.equal(reread?.requiredLevels, 2);
});

test('HAPPY_PATH: 2-level purchasing goes submit -> approve L1 -> approve L2 -> execute -> close', async () => {
  await mod.setApprovalRule('Purchasing', 2);
  const created = await makeRequest('Purchasing');
  assert.equal(created.status, 'Submitted');
  assert.equal(created.currentLevel, 1);

  const afterL1 = await mod.approveOrReject(created.id, 'Approver', 'Approved');
  assert.equal(afterL1.status, 'PendingApproval');
  assert.equal(afterL1.currentLevel, 2);

  const afterL2 = await mod.approveOrReject(created.id, 'Approver', 'Approved');
  assert.equal(afterL2.status, 'Approved');
  assert.equal(afterL2.approvals.length, 2);
  assert.ok(afterL2.approvals.every((a) => a.approverName && a.decidedAt));

  const executed = await mod.executeRequest(created.id, 'Requester', {
    buffer: Buffer.from('evidence contents'),
    originalName: 'proof.txt',
  });
  assert.equal(executed.status, 'Executed');
  assert.ok(executed.evidenceUrl);

  const closed = await mod.closeRequest(created.id, 'Closer');
  assert.equal(closed.status, 'Closed');
});

test('REJECT_AT_ANY_LEVEL: a reject terminates the request immediately', async () => {
  await mod.setApprovalRule('Maintenance', 1);
  const created = await makeRequest('Maintenance');

  const rejected = await mod.approveOrReject(created.id, 'Approver', 'Rejected');
  assert.equal(rejected.status, 'Rejected');

  // Terminal: no further approval decisions are accepted.
  await assertRejects(
    () => mod.approveOrReject(created.id, 'Approver', 'Approved'),
    'not awaiting approval'
  );
});

test('SINGLE_LEVEL_DEFAULT: one approval is enough when only 1 level is required', async () => {
  await mod.setApprovalRule('Marketing Spend', 1);
  const created = await makeRequest('Marketing Spend');

  const afterApproval = await mod.approveOrReject(created.id, 'Approver', 'Approved');
  assert.equal(afterApproval.status, 'Approved');
});

test('CONFIG_CHANGE_MID_FLIGHT: a live admin change applies to a pending request immediately', async () => {
  await mod.setApprovalRule('Security', 1);
  const created = await makeRequest('Security');
  assert.equal(created.currentLevel, 1);

  // Admin raises the requirement to 2 levels while this request is still pending at level 1.
  await mod.setApprovalRule('Security', 2);

  const afterL1 = await mod.approveOrReject(created.id, 'Approver', 'Approved');
  // Because the level count is read live (not snapshotted at submit time), one approval
  // is no longer enough to finalize this request.
  assert.equal(afterL1.status, 'PendingApproval');
  assert.equal(afterL1.currentLevel, 2);

  const afterL2 = await mod.approveOrReject(created.id, 'Approver', 'Approved');
  assert.equal(afterL2.status, 'Approved');
});

test('EXECUTE_WITHOUT_EVIDENCE: blocked with a validation error', async () => {
  await mod.setApprovalRule('Other', 1);
  const created = await makeRequest('Other');
  await mod.approveOrReject(created.id, 'Approver', 'Approved');

  await assertRejects(() => mod.executeRequest(created.id, 'Requester', null), 'Evidence file is required');

  // Still Approved, not advanced.
  const fetched = await mod.getRequest(created.id);
  assert.equal(fetched?.status, 'Approved');
});

test('CLOSE_LOCKS_REQUEST: no further approve/execute/close once Closed', async () => {
  await mod.setApprovalRule('Purchasing', 1);
  const created = await makeRequest('Purchasing');
  await mod.approveOrReject(created.id, 'Approver', 'Approved');
  await mod.executeRequest(created.id, 'Requester', {
    buffer: Buffer.from('proof'),
    originalName: 'proof.txt',
  });
  await mod.closeRequest(created.id, 'Closer');

  await assertRejects(() => mod.approveOrReject(created.id, 'Approver', 'Approved'));
  await assertRejects(() =>
    mod.executeRequest(created.id, 'Requester', { buffer: Buffer.from('x'), originalName: 'x.txt' })
  );
  await assertRejects(() => mod.closeRequest(created.id, 'Closer'));
});

test('ROLE_GATES: canCreate and canAdmin only allow their own role', () => {
  assert.equal(mod.canCreate('Requester'), true);
  for (const role of ['Approver', 'Closer', 'Admin'] as const) {
    assert.equal(mod.canCreate(role), false);
  }

  assert.equal(mod.canAdmin('Admin'), true);
  for (const role of ['Requester', 'Approver', 'Closer'] as const) {
    assert.equal(mod.canAdmin(role), false);
  }
});

test('WRONG_ROLE_ACTION: actions are rejected for roles that cannot perform them', async () => {
  await mod.setApprovalRule('Maintenance', 1);
  const created = await makeRequest('Maintenance');

  await assertRejects(() => mod.approveOrReject(created.id, 'Requester', 'Approved'));
  await assertRejects(() => mod.approveOrReject(created.id, 'Closer', 'Approved'));
  await assertRejects(() =>
    mod.executeRequest(created.id, 'Approver', { buffer: Buffer.from('x'), originalName: 'x.txt' })
  );
  await assertRejects(() =>
    mod.executeRequest(created.id, 'Closer', { buffer: Buffer.from('x'), originalName: 'x.txt' })
  );
  await assertRejects(() => mod.closeRequest(created.id, 'Requester'));
  await assertRejects(() => mod.closeRequest(created.id, 'Approver'));
});

test('EVIDENCE_URL_ROUNDTRIP: executing with a file returns a URL, not a local path', async () => {
  await mod.setApprovalRule('Purchasing', 1);
  const created = await makeRequest('Purchasing');
  await mod.approveOrReject(created.id, 'Approver', 'Approved');

  const executed = await mod.executeRequest(created.id, 'Requester', {
    buffer: Buffer.from('evidence bytes'),
    originalName: 'receipt.pdf',
  });
  assert.ok(executed.evidenceUrl, 'expected evidenceUrl to be set');
  assert.equal(executed.evidenceOriginalName, 'receipt.pdf');
});

test('SEED_IDEMPOTENT: seeding twice against the same pool leaves exactly 5 request_types', async () => {
  // Schema init already ran once (via getDb() in `before`); re-running seed()
  // alone here is what exercises the ON CONFLICT DO NOTHING idempotency the
  // scenario cares about, without duplicate-key errors on the second pass.
  // (Re-running CREATE TABLE IF NOT EXISTS a second time in the same pg-mem
  // process hits an unrelated pg-mem AST-coverage limitation on an
  // already-existing table -- not something a real Postgres server does --
  // so this test doesn't re-invoke initSchema(); the full db:migrate script
  // re-run is covered by the manual check against real Postgres instead.)
  const dbMod = await import('../lib/db');
  const pool = dbMod.getPool();
  await dbMod.seed(pool);
  await dbMod.seed(pool);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM request_types');
  assert.equal(rows[0].c, 5);
});

test('DB_ENV_MISSING: a clear, actionable error names the missing env var (not a raw driver stack)', async () => {
  // getPool() itself is memoized process-wide (and already initialized against
  // pg-mem by earlier tests), so it can't be re-exercised here. Instead this
  // calls the same pure connection-string resolver getPool() relies on when
  // OYO_TEST_DB is unset -- it reads process.env fresh on every call, with no
  // caching of its own, so unsetting the env vars for the duration is enough.
  const dbMod = await import('../lib/db');
  const savedPostgresUrl = process.env.POSTGRES_URL;
  const savedDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.DATABASE_URL;

  try {
    assert.throws(
      () => dbMod.resolveConnectionString(),
      /POSTGRES_URL or DATABASE_URL/,
      'expected a clear error naming the missing env var'
    );
  } finally {
    if (savedPostgresUrl !== undefined) process.env.POSTGRES_URL = savedPostgresUrl;
    if (savedDatabaseUrl !== undefined) process.env.DATABASE_URL = savedDatabaseUrl;
  }
});

test('BLOB_TOKEN_MISSING: execute fails cleanly with a clear "not configured" error', async () => {
  // uploadEvidence() reads OYO_TEST_DB/BLOB_READ_WRITE_TOKEN fresh on every
  // call (no top-level caching), so temporarily unsetting them around a
  // direct call is enough to exercise the real (non-test) branch.
  const blobMod = await import('../lib/blob');
  const savedTestDb = process.env.OYO_TEST_DB;
  const savedToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.OYO_TEST_DB;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  try {
    await assert.rejects(
      () => blobMod.uploadEvidence(Buffer.from('x'), 'x.txt'),
      /Blob storage is not configured/
    );
  } finally {
    if (savedTestDb !== undefined) process.env.OYO_TEST_DB = savedTestDb;
    if (savedToken !== undefined) process.env.BLOB_READ_WRITE_TOKEN = savedToken;
  }
});

test('BLOB_TOKEN_MISSING via executeRequest: the BlobConfigError->RequestError mapping actually fires', async () => {
  // Build the Approved request first, while OYO_TEST_DB is still set (so this
  // uses the already-memoized pg-mem pool, not a real Postgres connection).
  await mod.setApprovalRule('Other', 1);
  const created = await makeRequest('Other');
  await mod.approveOrReject(created.id, 'Approver', 'Approved');

  // getDb()'s pool is memoized process-wide by now, so unsetting OYO_TEST_DB
  // here only flips uploadEvidence()'s branch (it reads the env var fresh on
  // every call) -- it does not attempt a real Postgres connection.
  const savedTestDb = process.env.OYO_TEST_DB;
  const savedToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.OYO_TEST_DB;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  try {
    await assert.rejects(
      () => mod.executeRequest(created.id, 'Requester', { buffer: Buffer.from('x'), originalName: 'x.txt' }),
      (err: unknown) => {
        assert.ok(err instanceof mod.RequestError, `expected RequestError, got ${err}`);
        assert.equal((err as InstanceType<typeof mod.RequestError>).status, 500);
        assert.match((err as Error).message, /Blob storage is not configured/);
        return true;
      }
    );
  } finally {
    if (savedTestDb !== undefined) process.env.OYO_TEST_DB = savedTestDb;
    if (savedToken !== undefined) process.env.BLOB_READ_WRITE_TOKEN = savedToken;
  }

  // Still Approved -- the failed execute must not have partially applied.
  const fetched = await mod.getRequest(created.id);
  assert.equal(fetched?.status, 'Approved');
});
