import { check, group } from 'k6';
import { api } from '../lib/http.ts';
import { safeJson } from '../lib/utils.ts';
import {
  recommendationDuration,
  recommendationValid,
  pizzasRecommended,
  lastCalories,
} from '../lib/metrics.ts';
import type { Recommendation, Restrictions } from '../types.ts';

// Ask for a pizza under the given restrictions and return a valid recommendation or null.
export function recommendPizza(token: string, restrictions: Restrictions): Recommendation | null {
  let result: Recommendation | null = null;

  group('get recommendation', () => {
    const res = api('POST', '/api/pizza', {
      token,
      body: restrictions,
      name: 'pizza_recommend',
    });
    recommendationDuration.add(res.timings.duration);

    const body = safeJson<Recommendation>(res);

    // A 200 only proves the server answered; the result still needs to match the request.
    const valid = check(res, {
      'recommend: status 200': (r) => r.status === 200,
      'recommend: pizza id present': () => Boolean(body && body.pizza && body.pizza.id > 0),
      'recommend: within calorie limit': () =>
        Boolean(body) && body!.calories <= restrictions.maxCaloriesPerSlice,
      'recommend: vegetarian when requested': () =>
        Boolean(body) && (!restrictions.mustBeVegetarian || body!.vegetarian === true),
    });

    recommendationValid.add(valid);

    if (valid && body) {
      pizzasRecommended.add(1);
      lastCalories.add(body.calories);
      result = body;
    }
  });

  return result;
}
