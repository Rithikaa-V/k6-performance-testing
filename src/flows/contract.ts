import { check, group } from 'k6';
import { api } from '../lib/http.ts';

// Negative checks make sure the API rejects bad input the documented way.
// `expected` tells k6 these status codes are intentional and should not count against http_req_failed.
export function contractChecks(token: string): void {
  group('contract checks', () => {
    const noToken = api('POST', '/api/ratings', {
      body: { stars: 5, pizza_id: 1 },
      name: 'rating_create_noauth',
      expected: [401],
    });
    check(noToken, { 'no token is rejected with 401': (r) => r.status === 401 });

    const badStars = api('POST', '/api/ratings', {
      token,
      body: { stars: 9, pizza_id: 1 },
      name: 'rating_create_invalid',
      expected: [400],
    });
    check(badStars, { 'stars out of range is rejected with 400': (r) => r.status === 400 });

    const missing = api('GET', '/api/pizza/999999', {
      token,
      name: 'pizza_get_missing',
      expected: [404],
    });
    check(missing, { 'unknown pizza id returns 404': (r) => r.status === 404 });
  });
}
