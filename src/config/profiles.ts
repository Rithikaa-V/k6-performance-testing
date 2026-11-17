import type { Options, Scenario } from 'k6/options';
import { PEAK_VUS, SOAK_DURATION } from './env.ts';
import { standardThresholds, stressThresholds, spikeThresholds } from './thresholds.ts';

// This is the single source for each test profile, so load shapes do not live in the journey code.

type Thresholds = NonNullable<Options['thresholds']>;

function build(testType: string, scenario: Scenario, thresholds: Thresholds): Options {
  return {
    scenarios: { [testType]: scenario },
    thresholds,
    tags: { testType },
    // p(99) is not part of the default summary, so add it explicitly.
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    userAgent: 'quickpizza-k6-perf/1.0',
  };
}

const peak = PEAK_VUS;

export const profiles = {
  // Smoke test: quick check that the script and target environment still work.
  smoke: build(
    'smoke',
    { executor: 'constant-vus', vus: 1, duration: '30s' },
    standardThresholds,
  ),

  // Load test: expected day-to-day traffic with a steady ramp and cool-down.
  load: build(
    'load',
    {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: peak },
        { duration: '5m', target: peak },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    standardThresholds,
  ),

  // Stress test: push past normal load to find the breaking point.
  stress: build(
    'stress',
    {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: peak },
        { duration: '3m', target: peak },
        { duration: '2m', target: peak * 2 },
        { duration: '3m', target: peak * 2 },
        { duration: '2m', target: peak * 3 },
        { duration: '3m', target: peak * 3 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    stressThresholds,
  ),

  // Spike test: sudden surge followed by recovery to normal load.
  spike: build(
    'spike',
    {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 2 },
        { duration: '20s', target: peak * 4 },
        { duration: '1m', target: peak * 4 },
        { duration: '20s', target: 2 },
        { duration: '2m', target: 2 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '20s',
    },
    spikeThresholds,
  ),

  // Soak test: moderate load for a long time to catch leaks and slow decay.
  soak: build(
    'soak',
    {
      executor: 'constant-vus',
      vus: Math.max(1, Math.round(peak / 2)),
      duration: SOAK_DURATION,
    },
    standardThresholds,
  ),
};
