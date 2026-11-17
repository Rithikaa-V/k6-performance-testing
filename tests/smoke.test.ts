import type { Options } from 'k6/options';
import { profiles } from '../src/config/profiles.ts';
import { setup, teardown, smokeJourney } from '../src/journey.ts';
import { handleSummary } from '../src/lib/summary.ts';

export const options: Options = profiles.smoke;

export { setup, teardown, handleSummary };
export default smokeJourney;
