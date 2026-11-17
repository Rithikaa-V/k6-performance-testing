import http from 'k6/http';
import { check, group } from 'k6';
import { batchGet } from '../lib/http.ts';

// This simulates a landing page where a browser fires several requests at once.
export function browseCatalog(token: string): void {
  group('browse catalog', () => {
    const [doughs, tools, quotes] = http.batch([
      batchGet('/api/doughs', { token, name: 'doughs_list' }),
      batchGet('/api/tools', { token, name: 'tools_list' }),
      batchGet('/api/quotes', { token, name: 'quotes_list' }),
    ]);

    check(doughs, { 'doughs: status 200': (r) => r.status === 200 });
    check(tools, { 'tools: status 200': (r) => r.status === 200 });
    check(quotes, { 'quotes: status 200': (r) => r.status === 200 });
  });
}
