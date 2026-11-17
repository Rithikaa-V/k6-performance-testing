import type { Options } from 'k6/options';
import { P95_MS, P99_MS } from './env.ts';

type Thresholds = NonNullable<Options['thresholds']>;

// This is the run pass/fail contract; any breach exits k6 with code 99 and turns the CI job red.
export const standardThresholds: Thresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: [`p(95)<${P95_MS}`, `p(99)<${P99_MS}`],

  // Per-endpoint budgets use the name tag set in lib/http.ts.
  'http_req_duration{name:user_login}': [`p(95)<${P95_MS}`],
  'http_req_duration{name:pizza_recommend}': [`p(95)<${Math.round(P95_MS * 1.5)}`],

  checks: ['rate>0.99'],
  recommendation_valid: ['rate>0.98'],
};

// Stress runs are expected to degrade, so latency is relaxed; the important signal is the failure point.
export const stressThresholds: Thresholds = {
  http_req_failed: [{ threshold: 'rate<0.10', abortOnFail: true, delayAbortEval: '30s' }],
  http_req_duration: [`p(95)<${P95_MS * 3}`],
  checks: ['rate>0.90'],
};

export const spikeThresholds: Thresholds = {
  http_req_failed: ['rate<0.05'],
  http_req_duration: [`p(95)<${P95_MS * 3}`],
  checks: ['rate>0.95'],
};
