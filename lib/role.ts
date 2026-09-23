import { cookies } from 'next/headers';
import { DEFAULT_ROLE, ROLE_COOKIE, ROLES, Role } from './types';

export function isRole(value: string | undefined | null): value is Role {
  return !!value && (ROLES as readonly string[]).includes(value);
}

/** Reads the current demo role from the request cookie (server components / route handlers). */
export function getCurrentRole(): Role {
  const value = cookies().get(ROLE_COOKIE)?.value;
  return isRole(value) ? value : DEFAULT_ROLE;
}
