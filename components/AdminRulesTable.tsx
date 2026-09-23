'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApprovalRule } from '@/lib/types';

export default function AdminRulesTable({ initialRules }: { initialRules: ApprovalRule[] }) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialRules.map((r) => [r.requestType, String(r.requiredLevels)]))
  );
  const [error, setError] = useState<string | null>(null);
  const [savedType, setSavedType] = useState<string | null>(null);
  const [busyType, setBusyType] = useState<string | null>(null);

  async function handleSave(type: string) {
    setError(null);
    setSavedType(null);
    const requiredLevels = Number(drafts[type]);
    if (!Number.isInteger(requiredLevels) || requiredLevels < 1) {
      setError('Required levels must be a whole number of 1 or more');
      return;
    }
    setBusyType(type);
    try {
      const res = await fetch('/api/admin/approval-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, requiredLevels }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to save rule');
        return;
      }
      setRules(data.rules);
      setSavedType(type);
      router.refresh();
    } catch {
      setError('Failed to save rule');
    } finally {
      setBusyType(null);
    }
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>Request type</th>
            <th>Required approval levels</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.requestType}>
              <td>{rule.requestType}</td>
              <td>
                <input
                  type="number"
                  min="1"
                  step="1"
                  style={{ width: 90 }}
                  value={drafts[rule.requestType] ?? ''}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [rule.requestType]: e.target.value }))
                  }
                />
              </td>
              <td>
                <button
                  disabled={busyType === rule.requestType}
                  onClick={() => handleSave(rule.requestType)}
                >
                  Save
                </button>
                {savedType === rule.requestType && (
                  <span className="muted" style={{ marginLeft: 8 }}>
                    Saved
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
