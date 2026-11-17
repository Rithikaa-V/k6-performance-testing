---
title: "Learning k6 with the QuickPizza performance project"
subtitle: "A walkthrough of performance testing concepts, k6, and every file in this repository"
---

# 1. How to use this guide

This guide has two jobs. Parts 2 to 12 teach performance testing and k6 from scratch, using small snippets taken from the project. Parts 13 to 17 walk through the project itself file by file, show how to run it, and explain how to read the results. The last parts cover common mistakes, exercises, and how to talk about the project in an interview.

If you have never used k6, read it in order. If you already know k6 and just want to understand the repo, jump to part 13.

Every code snippet refers to a real file in the repository, so you can open the file next to this guide and follow along.

# 2. Performance testing in one page

Performance testing answers one question: **does the system behave acceptably under the load we expect, and what happens when the load goes beyond that?**

## 2.1 Vocabulary you need

| Term | Meaning |
| --- | --- |
| Virtual user (VU) | A simulated user. In k6 each VU is an independent copy of your script running in a loop. |
| Iteration | One pass through the script's main function, for example one "browse, recommend, rate" story. |
| Latency / response time | How long a request takes from sending to the last byte received. |
| Throughput | How much work is done per unit of time, usually requests per second. |
| Error rate | Share of requests that failed (network errors or unexpected status codes). |
| Percentile (p95, p99) | The value below which 95% (or 99%) of samples fall. p95 = 800 ms means 95 out of 100 requests were faster than 800 ms. |
| Think time | The pause a real person takes between actions. |
| SLO / SLA | A target (objective) or contractual promise (agreement) such as "p95 under 500 ms and under 1% errors". |
| Threshold | k6's way of expressing an SLO as a pass/fail rule. |
| Saturation | The point where adding load stops adding throughput and only adds latency or errors. |

## 2.2 Why percentiles and not averages

An average hides the slow tail. If 99 requests take 100 ms and one takes 10 seconds, the average is about 200 ms and looks fine, but one user in a hundred waited ten seconds. Percentiles show that. In practice you look at the median for the typical experience, p95 and p99 for the tail, and max for the worst case. Never judge a run on the average alone.

## 2.3 The relationship between users, time and rate

A simple rule (Little's law) helps when sizing a test:

> concurrent users ≈ arrival rate × time each user spends in the system

If visitors arrive at 2 per second and each visit lasts 10 seconds, about 20 users are active at any moment. This is why "100 VUs" and "100 requests per second" are very different loads. It also explains the two workload models in part 6.

## 2.4 Types of performance test

| Type | Question | Typical shape |
| --- | --- | --- |
| Smoke | Does the script work, and is the system alive? | 1 to 2 VUs, under a minute |
| Load | Does it meet its targets at expected traffic? | Ramp up, hold for several minutes, ramp down |
| Stress | Where does it break, and how does it fail? | Keep stepping the load up past normal |
| Spike | Can it absorb a sudden burst and recover? | Jump to a high load quickly, drop back |
| Soak (endurance) | Does it stay healthy over hours? Memory leaks, connection exhaustion, log growth. | Moderate constant load for a long time |
| Breakpoint | What is the maximum capacity? | Ramp until something fails, then stop |

This project implements smoke, load, stress, spike and soak, plus a mixed-workload test.

# 3. What k6 is

k6 is an open-source load testing tool from Grafana Labs. You write tests as JavaScript, but the engine is written in Go.

Things worth knowing, because they surprise people coming from Node:

- **It runs TypeScript, but does not type-check it.** From k6 1.0 you can run `.ts` files directly; the types are simply stripped. See part 3.1.
- **It is not Node.js.** Your script runs inside a Go-based JavaScript interpreter (goja). There is no `npm install` for runtime libraries, no `fs`, no `require('axios')`. You use k6's own modules (`k6/http`, `k6/metrics`, `k6/data`, `k6/execution`, `k6/crypto`, and so on).
- **Modules are ES modules.** `import` and `export` work, and relative imports are how this project splits code across files.
- **Each VU has its own JavaScript runtime.** Module-level variables are per VU, not shared. This is why the project can keep one login token per VU in a plain variable.
- **It is efficient.** One machine can usually drive thousands of VUs because the heavy work (networking, timing, metrics) happens in Go.
- **Thresholds make it CI-friendly.** A failed threshold makes k6 exit with code 99.
- **Remote imports exist** (`import ... from 'https://jslib.k6.io/...'`), but this project avoids them so it runs offline.

Installation instructions for every platform are at https://grafana.com/docs/k6/latest/set-up/install-k6/. Check with `k6 version`.

## 3.1 TypeScript with k6

This project is written in TypeScript, which is convenient if you also use it for Playwright.

- `k6 run tests/smoke.test.ts` works directly. k6 removes the type annotations before running, so there is no build step.
- k6 does **not** check types. Mistakes only show up if you run `npx tsc --noEmit`, which is why the repo has an `npm run typecheck` script and runs it in CI.
- Type definitions for k6's modules come from the `@types/k6` package. `tsconfig.json` loads them with `"types": ["k6"]`, which also types globals such as `__ENV` and `open()`.
- Relative imports must include the `.ts` extension (`import { x } from './lib/http.ts'`), because k6 resolves files literally. `allowImportingTsExtensions` in `tsconfig.json` lets the compiler accept this.
- Stick to syntax that is only type annotation (interfaces, type aliases, generics, `import type`). Features that generate code, such as `enum`, are better avoided in k6 scripts.
- Types are erased at runtime, so `safeJson<Recommendation>(res)` is a promise about the shape, not a validation. The checks in the flows are what actually verify the response.

The extra types the project defines (payloads and the data passed from `setup()`) live in `src/types.ts`.

# 4. Your first script

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 5,
  duration: '30s',
};

export default function () {
  const res = http.get('https://quickpizza.grafana.com/api/quotes');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
```

Run it with `k6 run script.js`. k6 starts 5 VUs, each executes the default function in a loop for 30 seconds, and prints a summary. That is the whole model: **options describe the load, the default function describes one user's iteration.**

# 5. The test lifecycle

Every k6 script has four stages. This is the most important structural idea in k6 and a favourite interview question.

| Stage | Runs | How often | Typical use |
| --- | --- | --- | --- |
| Init | Top level of the file | Once per VU | Imports, reading data files, declaring metrics |
| `setup()` | Before the test | Once | Create test data, log in once, check the target is up |
| `default` (or scenario `exec`) | The load | Over and over, per VU | The user journey |
| `teardown(data)` | After the test | Once | Delete test data |
| `handleSummary(data)` | At the very end | Once | Custom report output |

Rules to remember:

- Init code can read files with `open()`, but VU code cannot. Anything that needs a file must load it at the top level.
- `setup()` can return data. k6 serialises it to JSON and hands a copy to each VU and to `teardown`. Functions and large objects do not survive this trip, so return plain data only.
- Metrics generated in `setup` and `teardown` count in the totals, so keep those stages lean.

In this project, `src/journey.ts` holds `setup`, `teardown` and the journeys, and `src/lib/summary.ts` holds `handleSummary`.

# 6. Controlling load: options, scenarios and executors

## 6.1 The shortcuts

The simplest options are `vus` and `duration`, or `iterations`. A slightly richer form is `stages`:

```javascript
export const options = {
  stages: [
    { duration: '1m', target: 10 },   // ramp from 0 to 10 VUs
    { duration: '5m', target: 10 },   // hold
    { duration: '1m', target: 0 },    // ramp down
  ],
};
```

These shortcuts are fine for a quick test. Behind the scenes k6 turns them into a single scenario.

## 6.2 Scenarios

A **scenario** is a named workload with its own executor, schedule and function. Several scenarios can run at the same time or at different offsets. That is how you model "browsing traffic plus purchasing traffic plus a monitoring probe" in one test.

```javascript
scenarios: {
  catalog_traffic: {
    executor: 'constant-arrival-rate',
    rate: 2, timeUnit: '1s', duration: '4m',
    preAllocatedVUs: 5, maxVUs: 20,
    exec: 'browseOnly',          // which exported function to run
  },
  late_rush: {
    executor: 'per-vu-iterations',
    vus: 3, iterations: 5,
    startTime: '2m',             // begin two minutes into the test
    exec: 'fullJourney',
  },
}
```

Each scenario's samples automatically carry a `scenario` tag, which lets you set thresholds per scenario.

## 6.3 Closed and open workload models

This is a key concept and the reason k6 has two families of executors.

- **Closed model.** A fixed number of users. A new iteration only starts when the previous one finishes. If the system slows down, users take longer and the *request rate drops*. This hides problems: the slower the server, the less load it gets.
- **Open model.** Iterations start at a fixed rate regardless of how the system is doing, like real visitors arriving at a website. If the system slows down, work piles up. This is the better model for public-facing traffic and avoids the "coordinated omission" trap where a struggling server accidentally throttles the test.

## 6.4 The executors

| Executor | Model | What it does | Use it for |
| --- | --- | --- | --- |
| `shared-iterations` | closed | A fixed total number of iterations split across VUs | Run a script exactly N times |
| `per-vu-iterations` | closed | Each VU runs a fixed number of iterations | Each user does a set number of runs |
| `constant-vus` | closed | A fixed number of VUs for a duration | Steady load, soak tests |
| `ramping-vus` | closed | VU count follows stages | Load, stress, spike shapes |
| `constant-arrival-rate` | open | Start N iterations per time unit | Fixed requests per second goal |
| `ramping-arrival-rate` | open | Arrival rate follows stages | Rate-based stress and breakpoint tests |
| `externally-controlled` | either | Scale VUs live through the k6 REST API | Manual experiments |

For the arrival-rate executors you give `preAllocatedVUs` (VUs created up front) and `maxVUs` (the ceiling k6 may grow to). If k6 runs out of VUs it cannot start the iterations on time and records them in the `dropped_iterations` metric. A non-zero count there means the *test* ran out of capacity, not necessarily the system under test, and it is worth a threshold (the mixed-workload test has one).

## 6.5 Graceful stop

`gracefulRampDown` and `gracefulStop` give running iterations time to finish when VUs are removed or the scenario ends, so you do not get requests cut off halfway. Default is 30 seconds.

# 7. Making HTTP requests

## 7.1 The basics

```javascript
import http from 'k6/http';

const res = http.get(url, params);
const res = http.post(url, body, params);
const res = http.request('PUT', url, body, params);   // generic form
```

`params` can carry `headers`, `tags`, `timeout`, `cookies`, `redirects`, `responseType` and more. Request bodies are strings, so JSON bodies need `JSON.stringify` and a `Content-Type: application/json` header.

## 7.2 The response object

| Property | Meaning |
| --- | --- |
| `res.status` | HTTP status code |
| `res.body` | Body as a string |
| `res.json()` | Parsed JSON body (throws if it is not valid JSON) |
| `res.headers` | Response headers |
| `res.timings.duration` | Total request time in ms (sending + waiting + receiving) |
| `res.timings.waiting` | Time to first byte |
| `res.error` | Network-level error text, if any |

## 7.3 Parallel requests with `http.batch`

A browser loads many resources at the same time. `http.batch` models that:

```javascript
const [doughs, tools, quotes] = http.batch([
  ['GET', `${BASE_URL}/api/doughs`, null, params],
  ['GET', `${BASE_URL}/api/tools`,  null, params],
  ['GET', `${BASE_URL}/api/quotes`, null, params],
]);
```

The requests run concurrently inside one VU. See `src/flows/browse.ts`.

## 7.4 What counts as a failed request

By default k6 treats status codes 200 to 399 as successes. Anything else, and any network error, is counted in `http_req_failed`. When a test deliberately expects a 401 or 404, that would pollute the failure rate. Declare the expected codes for that request:

```javascript
params.responseCallback = http.expectedStatuses(401);
```

`src/lib/http.ts` exposes this as the `expected` option, and `src/flows/contract.ts` uses it.

# 8. Checks and thresholds

These two are constantly confused, and the difference matters.

| | Check | Threshold |
| --- | --- | --- |
| Question it answers | Did this particular response look right? | Did the whole test meet its goals? |
| Effect when failing | Nothing. The script continues, the failure is recorded as a metric. | The test is marked failed and k6 exits with code 99. |
| Scope | One assertion on one response | An aggregate over all samples of a metric |
| Written as | `check(res, { 'name': fn })` | An entry in `options.thresholds` |

## 8.1 Checks

```javascript
const ok = check(res, {
  'status is 200': (r) => r.status === 200,
  'has pizza id':  () => body && body.pizza && body.pizza.id > 0,
});
```

`check` returns true only when all assertions pass. Every check feeds the built-in `checks` rate metric, and the summary lists each by name.

A check never stops the iteration. If later steps depend on the response (like needing an id), test the return value and bail out yourself, as `src/flows/rating.ts` does.

Checking only the status code is a common beginner mistake. A server can return 200 with an empty or wrong body very quickly, so also verify content. `src/flows/recommend.ts` verifies the pizza id, the calorie limit and the vegetarian flag.

## 8.2 Thresholds

```javascript
thresholds: {
  http_req_failed:   ['rate<0.01'],                 // under 1% errors
  http_req_duration: ['p(95)<1000', 'p(99)<2000'],  // latency budget
  checks:            ['rate>0.99'],
  'http_req_duration{name:pizza_recommend}': ['p(95)<1500'],   // per endpoint
}
```

The aggregation methods depend on the metric type (see part 9): `rate`, `count`, `value` for counters, rates and gauges, and `avg`, `min`, `max`, `med`, `p(N)` for trends.

A threshold can also abort a running test:

```javascript
http_req_failed: [{ threshold: 'rate<0.10', abortOnFail: true, delayAbortEval: '30s' }]
```

`delayAbortEval` waits before judging, because the first seconds of any test are noisy. The stress profile uses this so a collapsing system stops the run early.

All profiles' thresholds live in `src/config/thresholds.ts`.

# 9. Metrics, tags and groups

## 9.1 Built-in metrics

| Metric | Type | Meaning |
| --- | --- | --- |
| `http_reqs` | counter | Total requests |
| `http_req_duration` | trend | Total request time (sending + waiting + receiving) |
| `http_req_waiting` | trend | Time to first byte, mostly server processing time |
| `http_req_connecting` | trend | TCP connection time |
| `http_req_tls_handshaking` | trend | TLS handshake time |
| `http_req_blocked` | trend | Time waiting for a free connection |
| `http_req_sending` / `http_req_receiving` | trend | Upload / download time |
| `http_req_failed` | rate | Share of failed requests |
| `iterations` | counter | Completed iterations |
| `iteration_duration` | trend | Time for a full iteration, including think time |
| `vus`, `vus_max` | gauge | Active and allocated VUs |
| `checks` | rate | Share of passing checks |
| `data_sent`, `data_received` | counter | Bytes |
| `dropped_iterations` | counter | Iterations that could not start (arrival-rate executors) |

Reading tip: when `http_req_duration` is high, look at `http_req_waiting` first. If waiting dominates, the server is slow. If `http_req_blocked` or `http_req_connecting` dominate, the problem is connections, often the load generator or network.

## 9.2 The four metric types

| Type | Records | Aggregations | Example in this project |
| --- | --- | --- | --- |
| `Counter` | A running total | `count`, `rate` | `ratings_submitted`, `pizzas_recommended` |
| `Gauge` | The last value, with min and max | `value` | `last_recommended_calories` |
| `Rate` | Share of non-zero values | `rate` | `recommendation_valid` |
| `Trend` | A distribution | `avg`, `min`, `max`, `med`, `p(N)` | `pizza_recommendation_duration` |

They are declared at the top level in `src/lib/metrics.ts` and fed with `.add(value)` inside the flows.

Why add custom metrics at all? Built-in metrics describe HTTP. Custom ones describe the *business*: how many pizzas were recommended, what share of answers were valid.

## 9.3 Tags and sub-metrics

Every sample carries tags (key and value pairs). Built-in ones include `method`, `status`, `url`, `name`, `scenario` and `group`. You can add your own in `params.tags`, at scenario level, or globally in `options.tags` (this project adds `testType`).

A threshold written with braces, such as `http_req_duration{name:user_login}`, creates a sub-metric that only aggregates matching samples. That is how per-endpoint and per-scenario budgets work.

### The `name` tag matters

By default k6 tags a request with its full URL. A URL like `/api/ratings/4821` produces a new series for every id, which clutters results and can overload external databases (a "high cardinality" problem). Setting `tags: { name: 'rating_get' }` collapses them into one label. Every request in this project sets a name, through the wrapper in `src/lib/http.ts`.

Keep names free of spaces, braces and other special characters so they can be used safely inside threshold selectors.

## 9.4 Groups

`group('name', fn)` wraps related steps. It adds a `group` tag and gives a group duration metric. Use it for logical business steps, not for every request, and avoid nesting async code inside (k6 groups are synchronous).

# 10. Test data and parameterisation

## 10.1 Environment variables

Pass values with `-e NAME=value` and read them through `__ENV.NAME`. In this project `src/config/env.ts` is the only file that reads `__ENV`, with defaults, so the rest of the code imports constants.

## 10.2 Data files and `SharedArray`

```javascript
import { SharedArray } from 'k6/data';

export const restrictionSets = new SharedArray('restriction sets', function () {
  return JSON.parse(open('../../data/restrictions.json'));
});
```

`open()` is only legal in the init context. Without `SharedArray`, every VU would hold its own copy of the parsed data, so 1000 VUs and a 50 MB file would use 50 GB. `SharedArray` keeps one read-only copy in memory that all VUs index into.

## 10.3 Per-VU and per-iteration information

| Value | Meaning |
| --- | --- |
| `__VU` | The VU's id (1-based) |
| `__ITER` | The iteration number for this VU (0-based) |
| `exec.vu.idInTest` | Unique VU id across the whole test (from `k6/execution`) |
| `exec.scenario.iterationInTest` | Global iteration counter for the scenario |

`src/journey.ts` uses `exec.vu.idInTest` to map each VU to a user from the pool created in `setup()`.

## 10.4 Randomness

Real traffic is not uniform. The project picks a random restriction set per iteration, a random star rating, random think times, and rates only 70% of pizzas. Seeding data like this prevents caching from flattering the results.

# 11. Correlation, authentication and state

**Correlation** means taking a value from one response and using it in a later request. This is what separates a realistic script from a pile of unrelated calls.

In this project:

1. `POST /api/users/token/login` returns `{ "token": "..." }`. The token is sent as `Authorization: Token <token>` on later calls.
2. `POST /api/pizza` returns a pizza with an `id`. That id becomes `pizza_id` in the rating request.
3. `POST /api/ratings` returns the new rating's `id`, which is used in the GET, PUT and DELETE URLs.

Two design decisions are worth noticing:

- **Log in once per VU, not once per iteration.** Real users do not log in before every click. Logging in every iteration would flood the login endpoint with traffic that real users never generate. The token is kept in a module-level variable, which is safe because modules are per VU.
- **Create users in `setup()`.** The test does not depend on pre-existing accounts, and every run uses new usernames, so parallel runs do not collide.

# 12. Think time and pacing

`sleep(seconds)` simulates a person reading, deciding or typing. Without it, every VU hammers the server as fast as it can, which tests something no real user does and drastically overstates the load per VU.

A fixed sleep makes all VUs act in lockstep. `think()` in `src/lib/utils.ts` sleeps a random time between a minimum and maximum, which spreads requests out.

Arrival-rate scenarios (open model) usually have little or no think time inside the iteration, because the rate is controlled by the executor. That is why `browseOnly` in the mixed test has none.

# 13. The project, file by file

## 13.1 Repository map

```
k6-quickpizza-perf/
├── tests/                      entry points, one per test type
│   ├── smoke.test.ts
│   ├── load.test.ts
│   ├── stress.test.ts
│   ├── spike.test.ts
│   ├── soak.test.ts
│   └── mixed-workload.test.ts
├── tsconfig.json               type-check settings (no emit)
├── src/
│   ├── types.ts                payload and setup-data types
│   ├── journey.ts              setup, teardown, user journeys
│   ├── config/
│   │   ├── env.ts              command-line configuration
│   │   ├── profiles.ts         load shapes (smoke, load, ...)
│   │   └── thresholds.ts       pass/fail rules
│   ├── flows/
│   │   ├── browse.ts           parallel catalogue calls
│   │   ├── recommend.ts        pizza recommendation + validation
│   │   ├── rating.ts           create/read/update/delete a rating
│   │   └── contract.ts         negative checks
│   └── lib/
│       ├── http.ts             request wrapper
│       ├── auth.ts             register and login
│       ├── metrics.ts          custom metrics
│       ├── data.ts             SharedArray data loader
│       ├── utils.ts            random, think time, safe JSON
│       └── summary.ts          handleSummary
├── data/restrictions.json      parameterisation data
├── docker-compose.yml          run the app locally
├── .github/workflows/k6.yml    CI pipeline
└── docs/K6_GUIDE.md            this document
```

The separation follows one rule: **what to run** (tests), **how much load** (config), **what a user does** (flows), and **shared plumbing** (lib) live in different places. Changing the load shape never requires touching the user story, and vice versa.

## 13.2 The system under test

QuickPizza is a demo REST API made by Grafana for k6 practice. The endpoints this project uses:

| Method and path | Purpose | Auth |
| --- | --- | --- |
| `GET /ready` | Readiness probe | none |
| `POST /api/users` | Register a user | none |
| `POST /api/users/token/login` | Log in, returns a token | none |
| `GET /api/doughs`, `/api/tools`, `/api/quotes` | Catalogue data | token |
| `POST /api/pizza` | Get a recommendation for a set of restrictions | token |
| `GET /api/pizza/{id}` | Fetch a pizza by id | token |
| `POST /api/ratings` | Rate a pizza (stars 1 to 5, pizza_id) | token |
| `GET/PUT/PATCH/DELETE /api/ratings/{id}` | Manage a rating | token |
| `DELETE /api/ratings` | Remove all of the user's ratings | token |

The API specification is published in the QuickPizza repository (`quickpizza-openapi.yaml`). If the service changes its behaviour, check there first.

## 13.3 The test files

Each file in `tests/` is only a few lines. It picks options and wires up exports:

```javascript
import { profiles } from '../src/config/profiles.ts';
import { setup, teardown, journey } from '../src/journey.ts';
import { handleSummary } from '../src/lib/summary.ts';

export const options = profiles.load;

export { setup, teardown, handleSummary };
export default journey;
```

k6 looks for the exports `options`, `setup`, `default`, `teardown` and `handleSummary` in the file it is given, so re-exporting functions that live elsewhere works.

`smoke.test.ts` uses `smokeJourney` (the normal journey plus the negative checks). `mixed-workload.test.ts` defines its own options and exports several functions that scenarios select with `exec`.

## 13.4 `src/config/env.ts`

Reads every tunable from `__ENV` once, converts numbers safely and applies defaults. The latency thresholds default to 1000 ms (p95) and 2000 ms (p99). They are loose on purpose, because the public demo is a shared, remote server. For a local run, tighten them with `-e P95_MS=300`.

## 13.5 `src/config/profiles.ts`

One object per test type. A tiny `build()` helper adds what they all share:

- `scenarios`: one scenario named after the test type.
- `thresholds`: the pass/fail rules.
- `tags: { testType }`: every metric sample gets the test type, useful when results from several runs go into the same dashboard.
- `summaryTrendStats`: adds `p(99)`, which k6 omits by default.
- `userAgent`: identifies the traffic in server logs.

| Profile | Executor | Shape |
| --- | --- | --- |
| smoke | `constant-vus` | 1 VU for 30 s |
| load | `ramping-vus` | 0 to peak over 1 min, hold 5 min, down over 1 min |
| stress | `ramping-vus` | steps to 1x, 2x and 3x peak, holding at each step |
| spike | `ramping-vus` | 2 VUs, jump to 4x peak in 20 s, hold, drop, watch recovery |
| soak | `constant-vus` | half of peak for `SOAK_DURATION` (default 30 min) |

The peak comes from `PEAK_VUS` (default 10), so the whole suite can be scaled from one setting.

## 13.6 `src/config/thresholds.ts`

Three sets of rules:

- `standardThresholds`: under 1% failed requests, p95 and p99 latency budgets, per-endpoint budgets for login and recommendation (the recommendation endpoint gets 1.5x because it does real work), 99% of checks passing, and 98% of recommendations valid.
- `stressThresholds`: failures up to 10% are tolerated, but crossing that aborts the test after a 30 s grace period. Latency gets 3x the budget, since stress is meant to degrade the system.
- `spikeThresholds`: slightly relaxed in the same way.

## 13.7 `src/lib/http.ts`

The only place that calls `k6/http` directly for single requests. It guarantees consistent headers, builds the `Authorization: Token ...` header from a token, stamps each request with a `name` tag, and supports `expected` status codes. `batchRequest` returns the array form that `http.batch` needs.

## 13.8 `src/lib/auth.ts`

`registerUser` and `login`, each wrapped in a `check`. `login` returns the token or `null`, so callers can handle failure without throwing.

## 13.9 `src/lib/metrics.ts`

Declares the four custom metric types (see 9.2). Keeping them in one module avoids declaring the same metric twice, which k6 does not allow.

## 13.10 `src/lib/data.ts`

The `SharedArray` described in 10.2.

## 13.11 `src/lib/utils.ts`

Small helpers: `randomInt`, `randomItem`, `think`, and `safeJson`. The last one wraps `res.json()` in a try/catch. When a server under stress returns an HTML error page, `res.json()` throws, which would terminate the iteration with an exception. `safeJson` returns `null`, and the checks then record a clean failure.

## 13.12 `src/lib/summary.ts`

Implements `handleSummary`. When this function exists, k6 stops printing its default summary and prints whatever you return instead. This version:

- prints run time, iteration and request counts, failure and check percentages,
- shows a latency table with avg, median, p90, p95, p99 and max for the overall, login and recommendation timings,
- lists every threshold with PASS or FAIL,
- writes the complete raw data to `results/summary.json`.

The data format assumes k6 1.x. `handleSummary` does not change the exit code; thresholds do that.

## 13.13 `src/flows/`

Each file is one slice of the user story, written as a function that takes a token.

- **`browse.ts`** sends three independent GETs in one `http.batch` and checks each for status 200.
- **`recommend.ts`** posts the restriction set, records `pizza_recommendation_duration`, validates status, pizza id, calorie limit and vegetarian flag, and feeds the `recommendation_valid`, `pizzas_recommended` and `last_recommended_calories` metrics. It returns the parsed recommendation only when it is valid.
- **`rating.ts`** runs create, read, update, delete for one rating, using the id from the create response. Deleting at the end keeps server state clean across thousands of iterations.
- **`contract.ts`** sends three requests that should be rejected (no token, invalid stars, unknown pizza) and checks the exact error codes, with `expected` set so they are not counted as failures.

## 13.14 `src/journey.ts`

The centre of the project.

**`setup()`**
1. Calls `/ready`. If the target is down, `exec.test.abort()` stops the run immediately with a clear reason instead of producing 100% errors.
2. Registers `USER_POOL_SIZE` users with run-specific names (`k6_<runId>_<n>`).
3. Returns the user list.

**`journey(data)`**, the default function
1. Ensure the VU has a session (login on first use only).
2. Browse the catalogue, then think.
3. Pick a random restriction set and request a recommendation, then think.
4. 70% of the time, rate the pizza, then think.

**`teardown(data)`** logs in as each user and calls `DELETE /api/ratings`, clearing anything an interrupted iteration left behind.

**Extra entry points** for the mixed test: `browseOnly` (catalogue only, no think time), `healthProbe` (poll `/ready`).

## 13.15 The mixed-workload test

Four scenarios run side by side for about four minutes:

| Scenario | Executor | Behaviour | Why |
| --- | --- | --- | --- |
| `catalog_traffic` | `constant-arrival-rate` | 2 visitors per second, open model | Anonymous-style browsing that does not slow down when the server does |
| `pizza_buyers` | `ramping-vus` | 0 to 6 users, hold, down | The core purchase story |
| `late_rush` | `per-vu-iterations` | 3 users x 5 runs, starting at minute 2 | Shows `startTime` and a fixed amount of work |
| `health_probe` | `constant-vus` | 1 VU polling `/ready` | Must never fail, so its threshold is `rate==0` |

Thresholds target each one with the built-in tag, for example `http_req_duration{scenario:pizza_buyers}`. There is also a threshold on `dropped_iterations` to detect when the test itself ran short of VUs.

## 13.16 CI: `.github/workflows/k6.yml`

On every push to `main` and every pull request the workflow:

1. checks out the code,
2. installs Node and k6, then runs `tsc --noEmit` to type-check,
3. runs `k6 inspect` on every test file, which parses scripts and options without generating load (catches typos and broken imports quickly),
4. runs the smoke test (or, when started by hand, any test against any URL),
5. uploads `results/` as an artifact, even when the run fails.

The pass/fail signal comes from k6's exit code. A breached threshold returns 99, the step fails, and the pull request check turns red. That is what "performance as a quality gate" means.

# 14. Running the project

## 14.1 Prerequisites

Install k6 (1.0 or newer). Run `npm install` once to get TypeScript and the k6 type definitions (needed for `npm run typecheck` and editor autocompletion, not for running tests). Docker is optional and only needed for a local instance of the app.

## 14.2 Commands

```bash
# smoke test against the public demo
k6 run tests/smoke.test.ts

# load test with more users and a stricter budget
k6 run -e PEAK_VUS=20 -e P95_MS=600 tests/load.test.ts

# check the types, then validate every script without running them
npm run typecheck
for f in tests/*.test.ts; do k6 inspect "$f" > /dev/null && echo "ok $f"; done

# HTML report (k6's built-in web dashboard)
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=results/load-report.html \
  k6 run tests/load.test.ts

# stress against a local copy of the app
docker compose up -d
k6 run -e BASE_URL=http://localhost:3333 tests/stress.test.ts
docker compose down
```

The same commands are available as npm scripts (`npm run smoke`, `npm run report:load`, and so on).

## 14.3 Where to run what

The project runs against a local QuickPizza container (`docker compose up -d`, then `BASE_URL=http://localhost:3333`). The public instance is shared, and during development it rejected rating updates and deletes with a 403, so it is not a dependable target for tests that write per-user data. The CI workflow starts the same image as a service container. In real work the same rule applies: test an environment you control, and never run a heavy test against a system you do not own or have permission to test.

## 14.4 If the first run fails

| Symptom | Likely cause |
| --- | --- |
| `target is not ready` abort | The URL is wrong or the service is down. Open `BASE_URL/ready` in a browser. |
| Many `login` or `register` failures | The server rate-limits or rejected the generated credentials. Lower `USER_POOL_SIZE`, check the response body with `--http-debug=full`. |
| `recommend` checks failing but status is 200 | The API's behaviour differs from the assertions in `recommend.ts`. Inspect a real response and adjust the check. |
| `thresholds on metrics ... have no data` warnings | A tag selector does not match any request. Check the `name` value in the code against the threshold string. |
| Latency threshold failures from the start | Network distance to the target. Raise `P95_MS`, or test a local instance. |
| `open()` file not found | `open` paths are relative to the file that calls it (`src/lib/data.ts`). Run `k6` from the repo root as in the examples. |

Useful debugging flags: `--http-debug` prints requests and responses, `--iterations 1 --vus 1` runs a single pass, and `console.log()` writes to the terminal (use sparingly in real runs).

| 403 `operation not permitted for default user` on rating PUT/DELETE | You are on the public demo. Use the local container. |

# 15. Reading the results

A typical end-of-test output from this project looks like this (values are illustrative):

```
run time        8m00s
iterations      612  (1.28/s)
http requests   3640  (7.58/s)
failed requests 0.08%
checks passed   99.71%
pizzas / ratings  590 / 412

latency (ms)             avg     med   p(90)   p(95)   p(99)     max
all requests             312     281     455     538     910    1840
login                    340     310     470     520     640     702
recommend                395     362     590     701    1120    1650

thresholds
  pass  http_req_failed  rate<0.01
  pass  http_req_duration  p(95)<1000
  ...
```

How to interpret a run, in order:

1. **Did thresholds pass?** That is the verdict. A red threshold line names the exact metric and rule.
2. **Failed requests and checks.** A few failures can be noise, a rising percentage is a finding. Differences between `http_req_failed` and `checks` are informative: errors with passing checks mean the server returned acceptable codes with wrong content, or the reverse.
3. **Latency shape.** Compare median with p95 and p99. A small gap means consistent behaviour. A large gap means a tail problem such as queueing, GC pauses or a slow dependency.
4. **Latency over time.** Look at the HTML report. During a load test, latency should be flat once the VU count is flat. A rising line at constant load suggests a leak or growing queue (the thing soak tests exist to find). A cliff when VUs step up is the saturation point in a stress test.
5. **Throughput versus VUs.** If you double the VUs and the requests per second does not increase, the system has saturated.
6. **Check the test itself.** `dropped_iterations` above zero, or high `http_req_blocked`, can mean the load generator was the bottleneck.

Also remember that one run proves little. Repeat runs, compare against a baseline, and record the environment (target, VU count, k6 version, time of day).

## 15.1 Output options beyond the console

- The web dashboard and HTML export used above.
- `--out json=results/raw.json` writes every data point (large files).
- `--summary-export=results/summary-export.json` writes the end summary as JSON.
- k6 can stream metrics to Prometheus, InfluxDB, Grafana Cloud and other backends for long-running dashboards. See the k6 documentation, "Results output".

# 16. Common mistakes

1. **Judging by average latency.** Use percentiles.
2. **No think time.** Overstates the load per user.
3. **Only checking status codes.** Verify the response content.
4. **Logging in on every iteration** when real users do not.
5. **Unnamed dynamic URLs.** Always set the `name` tag.
6. **Running the load generator on a weak machine or a slow link.** It becomes the bottleneck and you measure your laptop.
7. **Testing the wrong environment** (production, or a tiny dev box that says nothing about production).
8. **Ignoring warm-up.** Caches, JIT and connection pools need time. Ramp up instead of starting at full load, and discard the first minute when comparing.
9. **Closed-model tests for open-model traffic.** If real users arrive independently of your response times, use an arrival-rate executor.
10. **Reading data inside the iteration function.** `open()` only works in init, and parsing files in every iteration is slow.
11. **No cleanup.** Tests that create data should delete it, otherwise the environment drifts between runs.
12. **Treating a single green run as proof.**

# 17. Exercises

Work through these to be sure you understand both k6 and the project.

1. **Tighten the budget.** Run the smoke test with `-e P95_MS=100`. Which thresholds fail, and what does the summary look like when they do? Check the exit code with `echo $?` (it should be 99).
2. **Add a custom metric.** Count how many iterations end without a rating. Add a `Counter` in `src/lib/metrics.ts` and update `journey()`.
3. **Add an endpoint.** Add a `GET /api/ratings` call to `rating.ts` with its own `name` tag and a per-endpoint threshold.
4. **Switch the model.** Copy `load.test.ts` and replace the executor with `ramping-arrival-rate`. Compare what happens to the iteration rate when the server slows down.
5. **Break it on purpose.** Add `sleep(5)` inside `recommendPizza` and watch which metrics move (iteration duration, but not request latency). Why?
6. **Data variety.** Add three more restriction sets to `data/restrictions.json`, including one that is impossible to satisfy. What does the API return, and how should the flow handle it?
7. **Custom report.** Extend `summary.ts` to also print the share of iterations that reached the rating step.
8. **CI gate.** Make the workflow run the load test nightly on a schedule, with `PEAK_VUS=5`.
9. **Prove saturation.** Run the stress test against the local container and find the VU level where requests per second stops growing.

# 18. Talking about this project

Suggested resume lines (adjust the numbers to what you actually measured):

- Built a modular, strictly typed TypeScript k6 performance suite for a REST API covering smoke, load, stress, spike, soak and mixed-workload tests, with pass/fail SLO thresholds on latency percentiles, error rate and functional checks.
- Modelled realistic traffic with correlated multi-step user journeys (register, login, recommend, rate), parameterised data via SharedArray, randomised think time, and open and closed workload executors.
- Added custom Trend, Counter, Rate and Gauge metrics and per-endpoint and per-scenario thresholds using tags.
- Integrated the suite into GitHub Actions as a performance gate, publishing HTML reports and JSON summaries as build artifacts.

Questions you should be ready for, with the short answers this project gives you:

- **Check versus threshold?** Checks assert on individual responses and never stop the test. Thresholds judge aggregate metrics and decide pass or fail.
- **Open versus closed workload?** Closed fixes the number of users, so slowdowns reduce the load. Open fixes the arrival rate, so slowdowns build up work. See `mixed-workload.test.ts`.
- **Why `SharedArray`?** One read-only copy of data in memory rather than one per VU.
- **How do you avoid high-cardinality metrics?** Set the `name` tag on requests with dynamic URLs.
- **How do you handle authentication?** Register users in `setup()`, log in once per VU, keep the token in per-VU module state.
- **How do you stop a test that is clearly failing?** `abortOnFail` thresholds (stress profile) and `exec.test.abort()` (setup readiness check).
- **How would you scale this up?** More VUs per machine first, then distributed execution (the k6 Operator on Kubernetes or k6 Cloud), streaming results to Prometheus or InfluxDB and Grafana.
- **What would you improve?** Add a ramping-arrival-rate breakpoint test, token refresh handling, baseline comparison between runs, and trend dashboards across builds.

# 19. Glossary

| Term | Meaning |
| --- | --- |
| Arrival rate | Number of new iterations started per unit of time |
| Baseline | A reference result from a known-good build, used for comparison |
| Cardinality | Number of distinct tag-value combinations; too many hurts metric backends |
| Coordinated omission | A measurement error where a slow server reduces the load the test applies, hiding the slowness |
| Correlation | Reusing a value from one response in a later request |
| Executor | The algorithm that decides how VUs and iterations are scheduled |
| Init context | The top level of a script module, executed once per VU before the test |
| Iteration | One execution of a scenario's function |
| Percentile | Value under which a given share of samples fall |
| Scenario | A named workload with its own executor and function |
| Sub-metric | A metric filtered by tags, such as `http_req_duration{name:user_login}` |
| Think time | Simulated pause between user actions |
| Threshold | A pass/fail rule on an aggregated metric |
| VU | Virtual user, one independent copy of the script running in a loop |

# 20. Further reading

- k6 documentation: https://grafana.com/docs/k6/latest/
- k6 scenarios and executors: https://grafana.com/docs/k6/latest/using-k6/scenarios/
- Thresholds: https://grafana.com/docs/k6/latest/using-k6/thresholds/
- QuickPizza source and API spec: https://github.com/grafana/quickpizza
