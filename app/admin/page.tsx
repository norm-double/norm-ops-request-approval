import { getApprovalRules } from '@/lib/requests';
import { getCurrentRole } from '@/lib/role';
import AdminRulesTable from '@/components/AdminRulesTable';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const role = getCurrentRole();

  if (role !== 'Admin') {
    return (
      <div className="card">
        <h1>Admin</h1>
        <p className="info-banner">
          Switch to the &quot;Admin&quot; role in the header to configure approval rules.
        </p>
      </div>
    );
  }

  const rules = await getApprovalRules();

  return (
    <div className="card">
      <h1>Approval Rule Configuration</h1>
      <p className="muted">
        Set how many sequential approval levels are required per request type. Changes take
        effect immediately, including for requests already pending.
      </p>
      <AdminRulesTable initialRules={rules} />
    </div>
  );
}
