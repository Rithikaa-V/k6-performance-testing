import { check } from 'k6';
import { api } from './http.ts';
import { safeJson } from './utils.ts';
import type { User } from '../types.ts';

export function registerUser(username: string, password: string): boolean {
  const res = api('POST', '/api/users', {
    body: { username, password },
    name: 'user_register',
  });
  return check(res, { 'register: status 201': (r) => r.status === 201 });
}

// Return the session token or null if login fails.
export function login(user: User): string | null {
  const res = api('POST', '/api/users/token/login', {
    body: { username: user.username, password: user.password },
    name: 'user_login',
  });

  const body = safeJson<{ token?: string }>(res);
  const ok = check(res, {
    'login: status 200': (r) => r.status === 200,
    'login: token returned': () => Boolean(body && body.token),
  });

  return ok && body && body.token ? body.token : null;
}
