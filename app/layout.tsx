import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import RoleSwitcher from '@/components/RoleSwitcher';
import { getCurrentRole } from '@/lib/role';

export const metadata: Metadata = {
  title: 'OYO Operational Requests — Demo',
  description: 'Demo of the OYO operational requests lifecycle (create, approve, execute, close).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const role = getCurrentRole();

  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <div className="app-brand">OYO Operational Requests — Demo</div>
          <nav className="app-nav">
            <Link href="/">Status List</Link>
            {role === 'Requester' && <Link href="/requests/new">New Request</Link>}
            {role === 'Admin' && <Link href="/admin">Admin</Link>}
          </nav>
          <RoleSwitcher currentRole={role} />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
