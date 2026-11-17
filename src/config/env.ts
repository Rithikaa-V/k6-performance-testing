// All command-line settings live here so the rest of the code never touches __ENV directly.
// Example: k6 run -e BASE_URL=http://localhost:3333 -e PEAK_VUS=20 tests/load.test.ts

function num(name: string, fallback: number): number {
  const raw = __ENV[name];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const BASE_URL: string = (__ENV.BASE_URL || 'http://localhost:3333').replace(/\/+$/, '');

// print one warning line for every unexpected 4xx/5xx/network error
// (method, path, status, start of the body). Handy when a threshold fails and
// you need to know which request caused it: -e LOG_FAILURES=1
export const LOG_FAILURES: boolean = __ENV.LOG_FAILURES === '1';

// Load shape.
export const PEAK_VUS = num('PEAK_VUS', 10);
export const SOAK_DURATION: string = __ENV.SOAK_DURATION || '30m';

// Number of users setup() registers; VUs share them round-robin.
export const USER_POOL_SIZE = num('USER_POOL_SIZE', 10);

// Think time between user actions, in seconds.
export const THINK_MIN_S = num('THINK_MIN_S', 1);
export const THINK_MAX_S = num('THINK_MAX_S', 3);

// Latency budget in ms; the public demo is far away, so these defaults are intentionally loose.
export const P95_MS = num('P95_MS', 1000);
export const P99_MS = num('P99_MS', 2000);
