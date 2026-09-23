import { notFound } from 'next/navigation';
import { getRequest, getRequiredLevels } from '@/lib/requests';
import { getCurrentRole } from '@/lib/role';
import { formatDate, formatUsd, statusBadgeClass, statusLabel } from '@/lib/format';
import RequestActions from '@/components/RequestActions';

export const dynamic = 'force-dynamic';

export default function RequestDetailPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const request = getRequest(id);
  if (!request) {
    notFound();
  }

  const role = getCurrentRole();
  const requiredLevels = getRequiredLevels(request.type);

  return (
    <div className="card">
      <h1>
        Request #{request.id}: {request.title}
      </h1>
      <span className={statusBadgeClass(request.status)}>{statusLabel(request)}</span>

      <div className="detail-grid" style={{ marginTop: 20 }}>
        <div className="detail-item">
          <div className="label">Type</div>
          <div className="value">{request.type}</div>
        </div>
        <div className="detail-item">
          <div className="label">Requester</div>
          <div className="value">{request.requester}</div>
        </div>
        <div className="detail-item">
          <div className="label">Amount</div>
          <div className="value">{formatUsd(request.amount)}</div>
        </div>
        <div className="detail-item">
          <div className="label">Required approval levels</div>
          <div className="value">{requiredLevels}</div>
        </div>
        <div className="detail-item">
          <div className="label">Created</div>
          <div className="value">{formatDate(request.createdAt)}</div>
        </div>
        <div className="detail-item">
          <div className="label">Last updated</div>
          <div className="value">{formatDate(request.updatedAt)}</div>
        </div>
      </div>

      <div className="detail-item" style={{ marginBottom: 20 }}>
        <div className="label">Description</div>
        <div className="value">{request.description || <span className="muted">—</span>}</div>
      </div>

      {request.evidencePath && (
        <div className="detail-item" style={{ marginBottom: 20 }}>
          <div className="label">Evidence</div>
          <div className="value">
            <a href={`/api/uploads/${encodeURIComponent(request.evidencePath)}`} target="_blank" rel="noreferrer">
              {request.evidenceOriginalName ?? 'View evidence'}
            </a>
          </div>
        </div>
      )}

      <h2>Approval history</h2>
      {request.approvals.length === 0 ? (
        <p className="muted">No approval decisions recorded yet.</p>
      ) : (
        <ul className="timeline">
          {request.approvals.map((a) => (
            <li key={a.id}>
              Level {a.level}: <strong>{a.decision}</strong> by {a.approverName} ({a.approverRole})
              on {formatDate(a.decidedAt)}
            </li>
          ))}
        </ul>
      )}

      <h2>Actions</h2>
      <RequestActions request={request} role={role} requiredLevels={requiredLevels} />
    </div>
  );
}
