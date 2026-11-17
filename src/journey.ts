import { check } from 'k6';
import exec from 'k6/execution';
import { api } from './lib/http.ts';
import { registerUser, login } from './lib/auth.ts';
import { restrictionSets } from './lib/data.ts';
import { randomItem, think } from './lib/utils.ts';
import { USER_POOL_SIZE } from './config/env.ts';
import { browseCatalog } from './flows/browse.ts';
import { recommendPizza } from './flows/recommend.ts';
import { ratePizza } from './flows/rating.ts';
import { contractChecks } from './flows/contract.ts';
import type { SetupData, User } from './types.ts';

// k6 runs lifecycle hooks in this order: init, setup, default, teardown, and handleSummary.

export function setup(): SetupData {
  const ready = api('GET', '/ready', { name: 'ready' });
  if (ready.status !== 200) {
    exec.test.abort(`target is not ready, GET /ready returned ${ready.status}`);
  }

  // Fresh users for each run so parallel runs do not clash with each other.
  const runId = Date.now().toString(36);
  const users: User[] = [];
  for (let i = 0; i < USER_POOL_SIZE; i++) {
    const user: User = { username: `k6_${runId}_${i}`, password: `Perf-${runId}-${i}!` };
    if (!registerUser(user.username, user.password)) {
      exec.test.abort(`could not register ${user.username}`);
    }
    users.push(user);
  }

  // Whatever is returned here is copied to every VU and to teardown().
  return { users };
}

export function teardown(data: SetupData): void {
  // Ratings are usually deleted in the flow; this cleans up anything left behind by an aborted iteration.
  for (const user of data.users) {
    const token = login(user);
    if (!token) continue;
    api('DELETE', '/api/ratings', { token, name: 'ratings_clear', expected: [204] });
  }
}

interface Session {
  user: User;
  token: string;
}

// Module state is per VU, and each VU keeps its login token for the whole run.
let session: Session | null = null;

function ensureSession(data: SetupData): Session | null {
  if (session) return session;

  // idInTest is 1-based and unique across the whole run.
  const user = data.users[(exec.vu.idInTest - 1) % data.users.length];
  const token = login(user);
  if (token) session = { user, token };
  return session;
}

// The main flow is to browse, request a pizza, and leave a rating.
export function journey(data: SetupData): void {
  const s = ensureSession(data);
  if (!s) {
    think();
    return;
  }

  browseCatalog(s.token);
  think();

  const restrictions = randomItem(restrictionSets);
  const recommendation = recommendPizza(s.token, restrictions);
  think();

  // Not everyone leaves a rating.
  if (recommendation && Math.random() < 0.7) {
    ratePizza(s.token, recommendation.pizza.id);
    think();
  }
}

// This is the same journey plus negative checks for the smoke test.
export function smokeJourney(data: SetupData): void {
  journey(data);
  if (session) contractChecks(session.token);
}

// These entry points are used by the mixed-workload scenarios through their exec setting.
export function browseOnly(data: SetupData): void {
  const s = ensureSession(data);
  if (s) browseCatalog(s.token);
}

export function healthProbe(): void {
  const res = api('GET', '/ready', { name: 'ready' });
  check(res, { 'ready: status 200': (r) => r.status === 200 });
  think(4, 6);
}
