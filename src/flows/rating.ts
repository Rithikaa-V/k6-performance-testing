import { check, group } from 'k6';
import { api } from '../lib/http.ts';
import { randomInt, safeJson } from '../lib/utils.ts';
import { ratingsSubmitted } from '../lib/metrics.ts';
import type { Rating } from '../types.ts';

// Create, read, update, and delete one rating, then clean up after itself so repeat runs stay tidy.
export function ratePizza(token: string, pizzaId: number): void {
  group('rate pizza', () => {
    const stars = randomInt(1, 5);

    const created = api('POST', '/api/ratings', {
      token,
      body: { stars, pizza_id: pizzaId },
      name: 'rating_create',
    });
    const rating = safeJson<Rating>(created);

    const ok = check(created, {
      'rating create: status 201': (r) => r.status === 201,
      'rating create: id returned': () => Boolean(rating && rating.id),
    });
    if (!ok || !rating) return;

    ratingsSubmitted.add(1);
    const id = rating.id;

    // The name tag keeps all rating ids grouped under one label.
    const fetched = api('GET', `/api/ratings/${id}`, { token, name: 'rating_get' });
    check(fetched, {
      'rating get: status 200': (r) => r.status === 200,
      'rating get: stars match': (r) => {
        const b = safeJson<Rating>(r);
        return Boolean(b) && b!.stars === stars;
      },
    });

    const newStars = stars === 5 ? 4 : stars + 1;
    const updated = api('PUT', `/api/ratings/${id}`, {
      token,
      body: { stars: newStars, pizza_id: pizzaId },
      name: 'rating_update',
    });
    check(updated, {
      'rating update: status 200': (r) => r.status === 200,
      'rating update: stars changed': (r) => {
        const b = safeJson<Rating>(r);
        return Boolean(b) && b!.stars === newStars;
      },
    });

    const removed = api('DELETE', `/api/ratings/${id}`, { token, name: 'rating_delete' });
    check(removed, { 'rating delete: status 204': (r) => r.status === 204 });
  });
}
