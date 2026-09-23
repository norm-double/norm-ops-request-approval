import { RequestRecord, RequestStatus } from './types';

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Human-readable status label, folding in the current approval level while pending. */
export function statusLabel(request: Pick<RequestRecord, 'status' | 'currentLevel'>): string {
  if (request.status === 'Submitted' || request.status === 'PendingApproval') {
    return `Pending Approval (Level ${request.currentLevel})`;
  }
  return request.status;
}

export function statusBadgeClass(status: RequestStatus): string {
  return `badge badge-${status.toLowerCase()}`;
}
