import { SharedArray } from 'k6/data';
import type { Restrictions } from '../types.ts';

// This is parsed once and shared read-only across VUs, which keeps memory usage low at high concurrency.
export const restrictionSets = new SharedArray<Restrictions>('restriction sets', function () {
  return JSON.parse(open('../../data/restrictions.json')) as Restrictions[];
});
