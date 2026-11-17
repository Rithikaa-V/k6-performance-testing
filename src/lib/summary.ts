// Custom end-of-test output; handleSummary replaces k6's default output and writes raw data to results/summary.json.

interface MetricData {
  values?: Record<string, number>;
  thresholds?: Record<string, { ok: boolean }>;
}

interface Group {
  checks?: Array<{ name: string; passes: number; fails: number }>;
  groups?: Group[];
}

export interface SummaryData {
  metrics: Record<string, MetricData>;
  state: { testRunDurationMs: number };
  root_group?: Group;
}

// every check that failed at least once, from the nested group tree
function failedChecks(group: Group | undefined): string[] {
  if (!group) return [];
  const lines: string[] = [];
  for (const c of group.checks || []) {
    if (c.fails > 0) lines.push(`  ${c.fails}/${c.passes + c.fails} failed  ${c.name}`);
  }
  for (const g of group.groups || []) lines.push(...failedChecks(g));
  return lines;
}

const LATENCY_ROWS: Array<[string, string]> = [
  ['all requests', 'http_req_duration'],
  ['login', 'http_req_duration{name:user_login}'],
  ['recommend', 'http_req_duration{name:pizza_recommend}'],
  ['recommend (custom)', 'pizza_recommendation_duration'],
];

function stat(data: SummaryData, metric: string, key: string): number | undefined {
  const m = data.metrics[metric];
  return m && m.values ? m.values[key] : undefined;
}

function ms(v: number | undefined): string {
  return v === undefined ? '-' : `${v.toFixed(0)}`;
}

function pct(v: number | undefined): string {
  return v === undefined ? '-' : `${(v * 100).toFixed(2)}%`;
}

function secs(totalMs: number): string {
  const s = Math.round(totalMs / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

function render(data: SummaryData): string {
  const out: string[] = [];
  const iters = data.metrics.iterations ? data.metrics.iterations.values || {} : {};
  const reqs = data.metrics.http_reqs ? data.metrics.http_reqs.values || {} : {};

  out.push('');
  out.push(`run time        ${secs(data.state.testRunDurationMs)}`);
  out.push(`iterations      ${iters.count || 0}  (${(iters.rate || 0).toFixed(2)}/s)`);
  out.push(`http requests   ${reqs.count || 0}  (${(reqs.rate || 0).toFixed(2)}/s)`);
  out.push(`failed requests ${pct(stat(data, 'http_req_failed', 'rate'))}`);
  out.push(`checks passed   ${pct(stat(data, 'checks', 'rate'))}`);
  out.push(`pizzas / ratings  ${stat(data, 'pizzas_recommended', 'count') || 0} / ${stat(data, 'ratings_submitted', 'count') || 0}`);
  out.push('');

  const cols = ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];
  out.push('latency (ms)'.padEnd(22) + cols.map((c) => c.padStart(8)).join(''));
  for (const [label, metric] of LATENCY_ROWS) {
    if (!data.metrics[metric]) continue;
    const cells = cols.map((c) => ms(stat(data, metric, c)).padStart(8));
    out.push(label.padEnd(22) + cells.join(''));

    const failed = failedChecks(data.root_group);
    if (failed.length > 0) {
      out.push('');
      out.push('failed checks');
      out.push(...failed);
    }
  }

  out.push('');
  out.push('thresholds');
  let any = false;
  for (const name of Object.keys(data.metrics)) {
    const thresholds = data.metrics[name].thresholds;
    if (!thresholds) continue;
    for (const expr of Object.keys(thresholds)) {
      any = true;
      const status = thresholds[expr].ok ? 'pass' : 'FAIL';
      out.push(`  ${status}  ${name}  ${expr}`);
    }
  }
  if (!any) out.push('  (none defined)');
  out.push('');

  return out.join('\n');
}

export function handleSummary(data: SummaryData): Record<string, string> {
  return {
    stdout: render(data),
    'results/summary.json': JSON.stringify(data, null, 2),
  };
}
