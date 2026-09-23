import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the app at a disposable SQLite data dir before lib/db.ts is ever imported,
// so these tests never touch the real demo database under data/app.db.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oyo-ops-test-'));
process.env.OYO_DATA_DIR = tmpDir;

type RequestsModule = typeof import('../lib/requests');
type DbModule = typeof import('../lib/db');
let mod: RequestsModule;
let dbMod: DbModule;

before(async () => {
  // Dynamic import (inside an async hook, not top-level await) so the
  // OYO_DATA_DIR assignment above happens before lib/db.ts is first loaded.
  mod = await import('../lib/requests');
  dbMod = await import('../lib/db');
});

after(() => {
  // Release the SQLite file handle before deleting the temp dir, otherwise
  // Windows keeps the file locked and rmSync throws EBUSY.
  dbMod.getDb().close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeRequest(type: string, requester = 'Test Requester') {
  return mod.createRequest({
    type,
    title: `${type} request`,
    description: 'A test request',
    amount: 100,
    requester,
  });
}

function assertRejects(fn: () => unknown, messageIncludes?: string) {
  try {
    fn();
    assert.fail('expected function to throw');
  } catch (err) {
    assert.ok(err instanceof mod.RequestError, `expected RequestError, got ${err}`);
    if (messageIncludes) {
      assert.match((err as InstanceType<typeof mod.RequestError>).message, new RegExp(messageIncludes));
    }
  }
}

test('CAP-6: admin can set and read back a required-level rule', () => {
  const rules = mod.setApprovalRule('Purchasing', 2);
  const purchasing = rules.find((r) => r.requestType === 'Purchasing');
  assert.equal(purchasing?.requiredLevels, 2);

  const reread = mod.getApprovalRules().find((r) => r.requestType === 'Purchasing');
  assert.equal(reread?.requiredLevels, 2);
});

test('HAPPY_PATH: 2-level purchasing goes submit -> approve L1 -> approve L2 -> execute -> close', () => {
  mod.setApprovalRule('Purchasing', 2);
  const created = makeRequest('Purchasing');
  assert.equal(created.status, 'Submitted');
  assert.equal(created.currentLevel, 1);

  const afterL1 = mod.approveOrReject(created.id, 'Approver', 'Approved');
  assert.equal(afterL1.status, 'PendingApproval');
  assert.equal(afterL1.currentLevel, 2);

  const afterL2 = mod.approveOrReject(created.id, 'Approver', 'Approved');
  assert.equal(afterL2.status, 'Approved');
  assert.equal(afterL2.approvals.length, 2);
  assert.ok(afterL2.approvals.every((a) => a.approverName && a.decidedAt));

  const executed = mod.executeRequest(created.id, 'Requester', {
    buffer: Buffer.from('evidence contents'),
    originalName: 'proof.txt',
  });
  assert.equal(executed.status, 'Executed');
  assert.ok(executed.evidencePath);

  const closed = mod.closeRequest(created.id, 'Closer');
  assert.equal(closed.status, 'Closed');
});

test('REJECT_AT_ANY_LEVEL: a reject terminates the request immediately', () => {
  mod.setApprovalRule('Maintenance', 1);
  const created = makeRequest('Maintenance');

  const rejected = mod.approveOrReject(created.id, 'Approver', 'Rejected');
  assert.equal(rejected.status, 'Rejected');

  // Terminal: no further approval decisions are accepted.
  assertRejects(
    () => mod.approveOrReject(created.id, 'Approver', 'Approved'),
    'not awaiting approval'
  );
});

test('SINGLE_LEVEL_DEFAULT: one approval is enough when only 1 level is required', () => {
  mod.setApprovalRule('Marketing Spend', 1);
  const created = makeRequest('Marketing Spend');

  const afterApproval = mod.approveOrReject(created.id, 'Approver', 'Approved');
  assert.equal(afterApproval.status, 'Approved');
});

test('CONFIG_CHANGE_MID_FLIGHT: a live admin change applies to a pending request immediately', () => {
  mod.setApprovalRule('Security', 1);
  const created = makeRequest('Security');
  assert.equal(created.currentLevel, 1);

  // Admin raises the requirement to 2 levels while this request is still pending at level 1.
  mod.setApprovalRule('Security', 2);

  const afterL1 = mod.approveOrReject(created.id, 'Approver', 'Approved');
  // Because the level count is read live (not snapshotted at submit time), one approval
  // is no longer enough to finalize this request.
  assert.equal(afterL1.status, 'PendingApproval');
  assert.equal(afterL1.currentLevel, 2);

  const afterL2 = mod.approveOrReject(created.id, 'Approver', 'Approved');
  assert.equal(afterL2.status, 'Approved');
});

test('EXECUTE_WITHOUT_EVIDENCE: blocked with a validation error', () => {
  mod.setApprovalRule('Other', 1);
  const created = makeRequest('Other');
  mod.approveOrReject(created.id, 'Approver', 'Approved');

  assertRejects(
    () => mod.executeRequest(created.id, 'Requester', null),
    'Evidence file is required'
  );

  // Still Approved, not advanced.
  const fetched = mod.getRequest(created.id);
  assert.equal(fetched?.status, 'Approved');
});

test('CLOSE_LOCKS_REQUEST: no further approve/execute/close once Closed', () => {
  mod.setApprovalRule('Purchasing', 1);
  const created = makeRequest('Purchasing');
  mod.approveOrReject(created.id, 'Approver', 'Approved');
  mod.executeRequest(created.id, 'Requester', {
    buffer: Buffer.from('proof'),
    originalName: 'proof.txt',
  });
  mod.closeRequest(created.id, 'Closer');

  assertRejects(() => mod.approveOrReject(created.id, 'Approver', 'Approved'));
  assertRejects(() =>
    mod.executeRequest(created.id, 'Requester', { buffer: Buffer.from('x'), originalName: 'x.txt' })
  );
  assertRejects(() => mod.closeRequest(created.id, 'Closer'));
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

test('WRONG_ROLE_ACTION: actions are rejected for roles that cannot perform them', () => {
  mod.setApprovalRule('Maintenance', 1);
  const created = makeRequest('Maintenance');

  assertRejects(() => mod.approveOrReject(created.id, 'Requester', 'Approved'));
  assertRejects(() => mod.approveOrReject(created.id, 'Closer', 'Approved'));
  assertRejects(() =>
    mod.executeRequest(created.id, 'Approver', { buffer: Buffer.from('x'), originalName: 'x.txt' })
  );
  assertRejects(() =>
    mod.executeRequest(created.id, 'Closer', { buffer: Buffer.from('x'), originalName: 'x.txt' })
  );
  assertRejects(() => mod.closeRequest(created.id, 'Requester'));
  assertRejects(() => mod.closeRequest(created.id, 'Approver'));
});
