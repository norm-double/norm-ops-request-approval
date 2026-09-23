import Link from 'next/link';
import { listRequests } from '@/lib/requests';
import { formatDate, formatUsd, statusBadgeClass, statusLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function StatusListPage() {
  const requests = listRequests();

  return (
    <div className="card">
      <h1>Request Status List</h1>
      <p className="muted">
        Every operational request submitted for this outlet, with its current lifecycle state.
      </p>

      {requests.length === 0 ? (
        <p>No requests yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Title</th>
              <th>Requester</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Level</th>
              <th>Created</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/requests/${r.id}`}>#{r.id}</Link>
                </td>
                <td>{r.type}</td>
                <td>
                  <Link href={`/requests/${r.id}`}>{r.title}</Link>
                </td>
                <td>{r.requester}</td>
                <td>{formatUsd(r.amount)}</td>
                <td>
                  <span className={statusBadgeClass(r.status)}>{statusLabel(r)}</span>
                </td>
                <td>{r.currentLevel}</td>
                <td>{formatDate(r.createdAt)}</td>
                <td>{formatDate(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
