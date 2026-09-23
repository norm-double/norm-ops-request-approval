'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Role, RequestWithApprovals } from '@/lib/types';

export default function RequestActions({
  request,
  role,
  requiredLevels,
}: {
  request: RequestWithApprovals;
  role: Role;
  requiredLevels: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const isPending = request.status === 'Submitted' || request.status === 'PendingApproval';
  const canApproveHere = role === 'Approver' && isPending;
  const canExecuteHere = role === 'Requester' && request.status === 'Approved';
  const canCloseHere = role === 'Closer' && request.status === 'Executed';
  const isTerminal = request.status === 'Closed' || request.status === 'Rejected';

  async function submitDecision(decision: 'Approved' | 'Rejected') {
    if (decision === 'Rejected' && !window.confirm('Reject this request? This cannot be undone.')) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/requests/${request.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to record decision');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to record decision');
    } finally {
      setBusy(false);
    }
  }

  async function submitExecute(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError('Evidence file is required');
      return;
    }
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('evidence', file);
      const res = await fetch(`/api/requests/${request.id}/execute`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to execute request');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to execute request');
    } finally {
      setBusy(false);
    }
  }

  async function submitClose() {
    if (!window.confirm('Close this request? This cannot be undone.')) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/requests/${request.id}/close`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to close request');
        return;
      }
      router.refresh();
    } catch {
      setError('Failed to close request');
    } finally {
      setBusy(false);
    }
  }

  if (isTerminal) {
    return (
      <div className="info-banner">
        This request is {request.status.toLowerCase()} and is read-only. No further actions are
        available.
      </div>
    );
  }

  if (!canApproveHere && !canExecuteHere && !canCloseHere) {
    return (
      <p className="muted">
        No actions available for the &quot;{role}&quot; role at this request&apos;s current
        status ({request.status}).
      </p>
    );
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}

      {canApproveHere && (
        <div>
          <p className="muted">
            Awaiting approval at level {request.currentLevel} of {requiredLevels}.
          </p>
          <div className="actions-row">
            <button disabled={busy} onClick={() => submitDecision('Approved')}>
              Approve
            </button>
            <button
              disabled={busy}
              className="btn-danger"
              onClick={() => submitDecision('Rejected')}
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {canExecuteHere && (
        <form onSubmit={submitExecute}>
          <div className="form-field">
            <label htmlFor="evidence">Evidence file</label>
            <input
              id="evidence"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <button type="submit" disabled={busy}>
            Execute &amp; Upload Evidence
          </button>
        </form>
      )}

      {canCloseHere && (
        <div className="actions-row">
          <button disabled={busy} onClick={submitClose}>
            Close Request
          </button>
        </div>
      )}
    </div>
  );
}
