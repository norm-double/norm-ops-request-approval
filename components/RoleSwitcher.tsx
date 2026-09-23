'use client';

import { useRouter } from 'next/navigation';
import { ROLES, ROLE_COOKIE, Role } from '@/lib/types';

export default function RoleSwitcher({ currentRole }: { currentRole: Role }) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Role;
    // Demo-only "auth": a plain browser cookie, no server round-trip needed.
    document.cookie = `${ROLE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="role-switcher">
      <label htmlFor="role-select" className="muted" style={{ fontWeight: 500 }}>
        Acting as
      </label>
      <select id="role-select" value={currentRole} onChange={handleChange}>
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </div>
  );
}
