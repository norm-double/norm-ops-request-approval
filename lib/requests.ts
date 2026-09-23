import fs from 'node:fs';
import path from 'node:path';
import { getDb, UPLOADS_DIR } from './db';
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
    evidencePath: row.evidence_path,
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

export function getApprovalRules(): ApprovalRule[] {
  const db = getDb();
  const rows = db.prepare('SELECT type, required_levels FROM request_types ORDER BY type').all() as {
    type: RequestType;
    required_levels: number;
  }[];
  return rows.map((r) => ({ requestType: r.type, requiredLevels: r.required_levels }));
}

export function getRequiredLevels(type: RequestType): number {
  const db = getDb();
  const row = db
    .prepare('SELECT required_levels FROM request_types WHERE type = ?')
    .get(type) as { required_levels: number } | undefined;
  if (!row) {
    throw new RequestError(`Unknown request type: ${type}`, 400);
  }
  return row.required_levels;
}

export function setApprovalRule(type: string, requiredLevels: number): ApprovalRule[] {
  if (!isValidRequestType(type)) {
    throw new RequestError(`Unknown request type: ${type}`, 400);
  }
  if (!Number.isInteger(requiredLevels) || requiredLevels < 1) {
    throw new RequestError('Required levels must be a whole number of 1 or more', 400);
  }
  const db = getDb();
  db.prepare('UPDATE request_types SET required_levels = ? WHERE type = ?').run(requiredLevels, type);
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

export function createRequest(input: CreateRequestInput): RequestRecord {
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

  const db = getDb();
  const ts = nowIso();
  const info = db
    .prepare(
      `INSERT INTO requests
        (type, title, description, amount, requester, status, current_level,
         evidence_path, evidence_original_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Submitted', 1, NULL, NULL, ?, ?)`
    )
    .run(type, title.trim(), description, amount, requester.trim(), ts, ts);

  return getRequest(Number(info.lastInsertRowid))!;
}

export function listRequests(): RequestRecord[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM requests ORDER BY id DESC').all();
  return rows.map(rowToRequest);
}

export function getRequest(id: number): RequestWithApprovals | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (!row) return null;
  const approvalRows = db
    .prepare('SELECT * FROM approvals WHERE request_id = ? ORDER BY id ASC')
    .all(id);
  return { ...rowToRequest(row), approvals: approvalRows.map(rowToApproval) };
}

function requireRequest(id: number): RequestWithApprovals {
  const req = getRequest(id);
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

export function approveOrReject(
  requestId: number,
  role: Role,
  decision: 'Approved' | 'Rejected'
): RequestWithApprovals {
  if (!canApprove(role)) {
    throw new RequestError('Only the Approver role can approve or reject requests', 403);
  }

  const request = requireRequest(requestId);

  if (!PENDING_STATUSES.includes(request.status)) {
    throw new RequestError(
      `Request is ${request.status} and is not awaiting approval`,
      409
    );
  }

  const db = getDb();
  const ts = nowIso();
  const level = request.currentLevel;

  const applyDecision = db.transaction(() => {
    db.prepare(
      `INSERT INTO approvals (request_id, level, decision, approver_role, approver_name, decided_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(requestId, level, decision, role, role, ts);

    if (decision === 'Rejected') {
      db.prepare('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?').run(
        'Rejected',
        ts,
        requestId
      );
      return;
    }

    // Approved at this level — read the CURRENT (live) required level count,
    // not anything cached/snapshotted on the request.
    const requiredLevels = getRequiredLevels(request.type);

    if (level >= requiredLevels) {
      db.prepare('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?').run(
        'Approved',
        ts,
        requestId
      );
    } else {
      db.prepare(
        'UPDATE requests SET status = ?, current_level = ?, updated_at = ? WHERE id = ?'
      ).run('PendingApproval', level + 1, ts, requestId);
    }
  });

  applyDecision();

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

export function executeRequest(
  requestId: number,
  role: Role,
  file: EvidenceFile | null
): RequestWithApprovals {
  if (!canExecute(role)) {
    throw new RequestError('Only the Requester role can execute requests', 403);
  }

  const request = requireRequest(requestId);

  if (request.status !== 'Approved') {
    throw new RequestError(`Request is ${request.status} and cannot be executed`, 409);
  }

  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new RequestError('Evidence file is required', 400);
  }
  if (file.buffer.length > MAX_EVIDENCE_BYTES) {
    throw new RequestError('Evidence file exceeds the 10MB limit', 400);
  }

  const safeOriginalName = path.basename(file.originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedName = `${requestId}-${Date.now()}-${safeOriginalName || 'evidence'}`;
  const fullPath = path.join(UPLOADS_DIR, storedName);
  fs.writeFileSync(fullPath, file.buffer);

  const db = getDb();
  const ts = nowIso();
  db.prepare(
    `UPDATE requests
     SET status = 'Executed', evidence_path = ?, evidence_original_name = ?, updated_at = ?
     WHERE id = ?`
  ).run(storedName, file.originalName, ts, requestId);

  return requireRequest(requestId);
}

// ---------------------------------------------------------------------------
// CAP-4: close an executed request — terminal, read-only afterwards.
// ---------------------------------------------------------------------------

export function closeRequest(requestId: number, role: Role): RequestWithApprovals {
  if (!canClose(role)) {
    throw new RequestError('Only the Closer role can close requests', 403);
  }

  const request = requireRequest(requestId);

  if (request.status !== 'Executed') {
    throw new RequestError(`Request is ${request.status} and cannot be closed`, 409);
  }

  const db = getDb();
  const ts = nowIso();
  db.prepare('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?').run(
    'Closed',
    ts,
    requestId
  );

  return requireRequest(requestId);
}
