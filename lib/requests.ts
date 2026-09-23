import type { Pool, PoolClient } from 'pg';
import { getDb, withTransaction, Queryable } from './db';
import { BlobConfigError, uploadEvidence } from './blob';
import {
  ApprovalRecord,
  ApprovalRule,
  REQUEST_TYPES,
  RequestRecord,
  RequestType,
  RequestWithApprovals,
  Role,
} from './types';

/** Error thrown for expected/validated failures (bad input, wrong state, wrong role). */
export class RequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowToRequest(row: any): RequestRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    amount: row.amount,
    requester: row.requester,
    status: row.status,
    currentLevel: row.current_level,
    evidenceUrl: row.evidence_url,
    evidenceOriginalName: row.evidence_original_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToApproval(row: any): ApprovalRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    level: row.level,
    decision: row.decision,
    approverRole: row.approver_role,
    approverName: row.approver_name,
    decidedAt: row.decided_at,
  };
}

export function isValidRequestType(value: string): value is RequestType {
  return (REQUEST_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Approval rules (CAP-6) — read live at every approval decision, never cached.
// ---------------------------------------------------------------------------

export async function getApprovalRules(): Promise<ApprovalRule[]> {
  const db = await getDb();
  const { rows } = await db.query('SELECT type, required_levels FROM request_types ORDER BY type');
  return (rows as { type: RequestType; required_levels: number }[]).map((r) => ({
    requestType: r.type,
    requiredLevels: r.required_levels,
  }));
}

async function fetchRequiredLevels(queryable: Queryable, type: RequestType): Promise<number> {
  const { rows } = await queryable.query('SELECT required_levels FROM request_types WHERE type = $1', [
    type,
  ]);
  if (rows.length === 0) {
    throw new RequestError(`Unknown request type: ${type}`, 400);
  }
  return rows[0].required_levels;
}

export async function getRequiredLevels(type: RequestType): Promise<number> {
  const db = await getDb();
  return fetchRequiredLevels(db, type);
}

export async function setApprovalRule(type: string, requiredLevels: number): Promise<ApprovalRule[]> {
  if (!isValidRequestType(type)) {
    throw new RequestError(`Unknown request type: ${type}`, 400);
  }
  if (!Number.isInteger(requiredLevels) || requiredLevels < 1) {
    throw new RequestError('Required levels must be a whole number of 1 or more', 400);
  }
  const db = await getDb();
  await db.query('UPDATE request_types SET required_levels = $1 WHERE type = $2', [
    requiredLevels,
    type,
  ]);
  return getApprovalRules();
}

// ---------------------------------------------------------------------------
// Requests (CAP-1, CAP-5)
// ---------------------------------------------------------------------------

export interface CreateRequestInput {
  type: string;
  title: string;
  description: string;
  amount: number;
  requester: string;
}

export async function createRequest(input: CreateRequestInput): Promise<RequestRecord> {
  const { type, title, requester } = input;
  const description = input.description ?? '';
  const amount = Number(input.amount);

  if (!isValidRequestType(type)) {
    throw new RequestError('Please select a valid request type', 400);
  }
  if (!title || !title.trim()) {
    throw new RequestError('Title is required', 400);
  }
  if (!requester || !requester.trim()) {
    throw new RequestError('Requester name is required', 400);
  }
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RequestError('Amount must be a non-negative number', 400);
  }

  const db = await getDb();
  const ts = nowIso();
  const { rows } = await db.query(
    `INSERT INTO requests
       (type, title, description, amount, requester, status, current_level,
        evidence_url, evidence_original_name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'Submitted', 1, NULL, NULL, $6, $7)
     RETURNING id`,
    [type, title.trim(), description, amount, requester.trim(), ts, ts]
  );

  return (await getRequest(Number(rows[0].id)))!;
}

export async function listRequests(): Promise<RequestRecord[]> {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM requests ORDER BY id DESC');
  return rows.map(rowToRequest);
}

export async function getRequest(id: number): Promise<RequestWithApprovals | null> {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM requests WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  const { rows: approvalRows } = await db.query(
    'SELECT * FROM approvals WHERE request_id = $1 ORDER BY id ASC',
    [id]
  );
  return { ...rowToRequest(rows[0]), approvals: approvalRows.map(rowToApproval) };
}

async function requireRequest(id: number): Promise<RequestWithApprovals> {
  const req = await getRequest(id);
  if (!req) {
    throw new RequestError(`Request ${id} not found`, 404);
  }
  return req;
}

// ---------------------------------------------------------------------------
// Role gating helpers — used by both UI (to hide controls) and API routes
// (to enforce, defense-in-depth) since there is no real auth.
// ---------------------------------------------------------------------------

export function canCreate(role: Role): boolean {
  return role === 'Requester';
}
export function canApprove(role: Role): boolean {
  return role === 'Approver';
}
export function canExecute(role: Role): boolean {
  return role === 'Requester';
}
export function canClose(role: Role): boolean {
  return role === 'Closer';
}
export function canAdmin(role: Role): boolean {
  return role === 'Admin';
}

const PENDING_STATUSES = ['Submitted', 'PendingApproval'];

// ---------------------------------------------------------------------------
// CAP-2: sequential multi-level approve/reject, with a *live* read of the
// required-level count for the request's type at the moment of the decision.
// ---------------------------------------------------------------------------

export async function approveOrReject(
  requestId: number,
  role: Role,
  decision: 'Approved' | 'Rejected'
): Promise<RequestWithApprovals> {
  if (!canApprove(role)) {
    throw new RequestError('Only the Approver role can approve or reject requests', 403);
  }

  const request = await requireRequest(requestId);

  if (!PENDING_STATUSES.includes(request.status)) {
    throw new RequestError(`Request is ${request.status} and is not awaiting approval`, 409);
  }

  const pool = (await getDb()) as Pool;
  const ts = nowIso();
  const level = request.currentLevel;

  await withTransaction(pool, async (client: PoolClient) => {
    let nextStatus: string;
    let nextLevel = level;

    if (decision === 'Rejected') {
      nextStatus = 'Rejected';
    } else {
      // Approved at this level — read the CURRENT (live) required level count,
      // not anything cached/snapshotted on the request.
      const requiredLevels = await fetchRequiredLevels(client, request.type);
      if (level >= requiredLevels) {
        nextStatus = 'Approved';
      } else {
        nextStatus = 'PendingApproval';
        nextLevel = level + 1;
      }
    }

    // Guarded, conditional update: only applies if the request is still at the
    // exact pending status/level we read above. If a concurrent decision (e.g.
    // a double-click race) already moved it, this affects 0 rows and we treat
    // it as a conflict instead of silently recording a second decision.
    const { rows } = await client.query(
      `UPDATE requests
       SET status = $1, current_level = $2, updated_at = $3
       WHERE id = $4 AND status = ANY($5) AND current_level = $6
       RETURNING id`,
      [nextStatus, nextLevel, ts, requestId, PENDING_STATUSES, level]
    );
    if (rows.length === 0) {
      throw new RequestError('Request was already decided by a concurrent action', 409);
    }

    await client.query(
      `INSERT INTO approvals (request_id, level, decision, approver_role, approver_name, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [requestId, level, decision, role, role, ts]
    );
  });

  return requireRequest(requestId);
}

// ---------------------------------------------------------------------------
// CAP-3: execute an approved request with a required evidence file upload.
// ---------------------------------------------------------------------------

export interface EvidenceFile {
  buffer: Buffer;
  originalName: string;
}

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024; // 10MB

export async function executeRequest(
  requestId: number,
  role: Role,
  file: EvidenceFile | null
): Promise<RequestWithApprovals> {
  if (!canExecute(role)) {
    throw new RequestError('Only the Requester role can execute requests', 403);
  }

  const request = await requireRequest(requestId);

  if (request.status !== 'Approved') {
    throw new RequestError(`Request is ${request.status} and cannot be executed`, 409);
  }

  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new RequestError('Evidence file is required', 400);
  }
  if (file.buffer.length > MAX_EVIDENCE_BYTES) {
    throw new RequestError('Evidence file exceeds the 10MB limit', 400);
  }

  let evidenceUrl: string;
  try {
    evidenceUrl = await uploadEvidence(file.buffer, file.originalName);
  } catch (err) {
    if (err instanceof BlobConfigError) {
      throw new RequestError(err.message, 500);
    }
    throw err;
  }

  const db = await getDb();
  const ts = nowIso();
  // Guarded conditional update: if a concurrent action already moved this
  // request away from 'Approved' (e.g. a double-submit race during the
  // upload above), this affects 0 rows and we reject rather than silently
  // overwriting whatever the other action already did.
  const { rows } = await db.query(
    `UPDATE requests
     SET status = 'Executed', evidence_url = $1, evidence_original_name = $2, updated_at = $3
     WHERE id = $4 AND status = 'Approved'
     RETURNING id`,
    [evidenceUrl, file.originalName, ts, requestId]
  );
  if (rows.length === 0) {
    throw new RequestError('Request was already modified by a concurrent action', 409);
  }

  return requireRequest(requestId);
}

// ---------------------------------------------------------------------------
// CAP-4: close an executed request — terminal, read-only afterwards.
// ---------------------------------------------------------------------------

export async function closeRequest(requestId: number, role: Role): Promise<RequestWithApprovals> {
  if (!canClose(role)) {
    throw new RequestError('Only the Closer role can close requests', 403);
  }

  const request = await requireRequest(requestId);

  if (request.status !== 'Executed') {
    throw new RequestError(`Request is ${request.status} and cannot be closed`, 409);
  }

  const db = await getDb();
  const ts = nowIso();
  const { rows } = await db.query(
    `UPDATE requests SET status = $1, updated_at = $2 WHERE id = $3 AND status = 'Executed' RETURNING id`,
    ['Closed', ts, requestId]
  );
  if (rows.length === 0) {
    throw new RequestError('Request was already modified by a concurrent action', 409);
  }

  return requireRequest(requestId);
}
