import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { REQUEST_TYPES } from './types';

// OYO_DATA_DIR lets the test suite point at an isolated, disposable data directory
// instead of the real demo database under the project root.
const DATA_DIR = process.env.OYO_DATA_DIR
  ? path.resolve(process.env.OYO_DATA_DIR)
  : path.join(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'app.db');

// Ensure the data + uploads directories exist before opening/creating the DB file.
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

declare global {
  // eslint-disable-next-line no-var
  var __oyoDb: Database.Database | undefined;
}

function initSchema(db: Database.Database) {
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_types (
      type TEXT PRIMARY KEY,
      required_levels INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      requester TEXT NOT NULL,
      status TEXT NOT NULL,
      current_level INTEGER NOT NULL DEFAULT 1,
      evidence_path TEXT,
      evidence_original_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES requests(id),
      level INTEGER NOT NULL,
      decision TEXT NOT NULL,
      approver_role TEXT NOT NULL,
      approver_name TEXT NOT NULL,
      decided_at TEXT NOT NULL
    );
  `);
}

function seed(db: Database.Database) {
  const typeCountRow = db.prepare('SELECT COUNT(*) AS c FROM request_types').get() as { c: number };
  if (typeCountRow.c === 0) {
    const insertType = db.prepare(
      'INSERT INTO request_types (type, required_levels) VALUES (?, 1)'
    );
    const insertAll = db.transaction(() => {
      for (const type of REQUEST_TYPES) {
        insertType.run(type);
      }
    });
    insertAll();
  }

  const requestCountRow = db.prepare('SELECT COUNT(*) AS c FROM requests').get() as { c: number };
  if (requestCountRow.c === 0) {
    const now = new Date();
    const iso = (offsetMinutes: number) =>
      new Date(now.getTime() - offsetMinutes * 60_000).toISOString();

    const insertRequest = db.prepare(`
      INSERT INTO requests
        (type, title, description, amount, requester, status, current_level,
         evidence_path, evidence_original_name, created_at, updated_at)
      VALUES (@type, @title, @description, @amount, @requester, @status, @current_level,
              @evidence_path, @evidence_original_name, @created_at, @updated_at)
    `);
    const insertApproval = db.prepare(`
      INSERT INTO approvals (request_id, level, decision, approver_role, approver_name, decided_at)
      VALUES (@request_id, @level, @decision, @approver_role, @approver_name, @decided_at)
    `);

    const seedTx = db.transaction(() => {
      // 1) A fully closed Purchasing request, with a real evidence file on disk.
      const evidenceFileName = 'seed-purchasing-evidence.txt';
      const evidenceFullPath = path.join(UPLOADS_DIR, evidenceFileName);
      if (!fs.existsSync(evidenceFullPath)) {
        fs.writeFileSync(
          evidenceFullPath,
          'Sample evidence: purchase receipt confirmed for office supplies restock.\n'
        );
      }
      const closedInfo = insertRequest.run({
        type: 'Purchasing',
        title: 'Restock front-desk office supplies',
        description: 'Paper, pens, and printer toner for the front desk.',
        amount: 120.5,
        requester: 'Minh Tran',
        status: 'Closed',
        current_level: 1,
        evidence_path: evidenceFileName,
        evidence_original_name: 'purchase-receipt.txt',
        created_at: iso(60 * 24 * 3),
        updated_at: iso(60 * 24 * 1),
      });
      insertApproval.run({
        request_id: closedInfo.lastInsertRowid,
        level: 1,
        decision: 'Approved',
        approver_role: 'Approver',
        approver_name: 'Approver',
        decided_at: iso(60 * 24 * 2),
      });

      // 2) A rejected Maintenance request.
      const rejectedInfo = insertRequest.run({
        type: 'Maintenance',
        title: 'Replace lobby AC unit',
        description: 'Lobby AC unit is leaking and needs replacement.',
        amount: 850,
        requester: 'Lan Pham',
        status: 'Rejected',
        current_level: 1,
        evidence_path: null,
        evidence_original_name: null,
        created_at: iso(60 * 24 * 2),
        updated_at: iso(60 * 20),
      });
      insertApproval.run({
        request_id: rejectedInfo.lastInsertRowid,
        level: 1,
        decision: 'Rejected',
        approver_role: 'Approver',
        approver_name: 'Approver',
        decided_at: iso(60 * 20),
      });

      // 3) A freshly submitted / mid-approval Security request (no decisions yet).
      insertRequest.run({
        type: 'Security',
        title: 'Additional CCTV camera for parking area',
        description: 'Install one extra CCTV camera covering the rear parking area.',
        amount: 300,
        requester: 'Duc Nguyen',
        status: 'Submitted',
        current_level: 1,
        evidence_path: null,
        evidence_original_name: null,
        created_at: iso(30),
        updated_at: iso(30),
      });
    });

    seedTx();
  }
}

export function getDb(): Database.Database {
  if (!global.__oyoDb) {
    const db = new Database(DB_PATH);
    initSchema(db);
    seed(db);
    global.__oyoDb = db;
  }
  return global.__oyoDb;
}

export { UPLOADS_DIR, DATA_DIR };
