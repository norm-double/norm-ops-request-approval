// Shared domain types — single source of truth for enums used across the app.

export const REQUEST_TYPES = [
  'Purchasing',
  'Maintenance',
  'Marketing Spend',
  'Security',
  'Other',
] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_STATUSES = [
  'Submitted',
  'PendingApproval',
  'Approved',
  'Rejected',
  'Executed',
  'Closed',
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const ROLES = ['Requester', 'Approver', 'Closer', 'Admin'] as const;

export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE: Role = 'Requester';

/** Name of the browser cookie used to persist the demo role (no real auth/session). */
export const ROLE_COOKIE = 'demoRole';

export interface ApprovalRule {
  requestType: RequestType;
  requiredLevels: number;
}

export interface RequestRecord {
  id: number;
  type: RequestType;
  title: string;
  description: string;
  amount: number;
  requester: string;
  status: RequestStatus;
  currentLevel: number;
  evidencePath: string | null;
  evidenceOriginalName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: number;
  requestId: number;
  level: number;
  decision: 'Approved' | 'Rejected';
  approverRole: Role;
  approverName: string;
  decidedAt: string;
}

export interface RequestWithApprovals extends RequestRecord {
  approvals: ApprovalRecord[];
}
