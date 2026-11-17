import type { Options } from 'k6/options';
import { setup, teardown, journey, browseOnly, healthProbe } from '../src/journey.ts';
import type { SetupData } from '../src/types.ts';
import { handleSummary } from '../src/lib/summary.ts';
import { standardThresholds } from '../src/config/thresholds.ts';
import { P95_MS } from '../src/config/env.ts';

// This mixes several traffic patterns, each with its own executor.
// The built-in scenario tag lets thresholds target each group separately.

export const options: Options = {
  scenarios: {
    catalog_traffic: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: '4m',
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: 'browseOnly',
    },
    pizza_buyers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 6 },
        { duration: '2m', target: 6 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '20s',
      exec: 'fullJourney',
    },
    late_rush: {
      executor: 'per-vu-iterations',
      vus: 3,
      iterations: 5,
      startTime: '2m',
      maxDuration: '2m',
      exec: 'fullJourney',
    },
    health_probe: {
      executor: 'constant-vus',
      vus: 1,
      duration: '4m',
      exec: 'healthProbe',
    },
  },
  thresholds: {
    ...standardThresholds,
    'http_req_duration{scenario:catalog_traffic}': [`p(95)<${P95_MS}`],
    'http_req_duration{scenario:pizza_buyers}': [`p(95)<${P95_MS * 1.5}`],
    'http_req_failed{scenario:health_probe}': ['rate==0'],
    // Arrival-rate executors drop iterations when the VU pool runs out.
    dropped_iterations: ['count<10'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  userAgent: 'quickpizza-k6-perf/1.0',
};

export { setup, teardown, handleSummary, browseOnly, healthProbe };

// Scenarios reference functions by name, so the journey needs an exported entry point.
export function fullJourney(data: SetupData): void {
  journey(data);
}
