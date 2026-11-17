import { sleep } from 'k6';
import { THINK_MIN_S, THINK_MAX_S } from '../config/env.ts';

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomItem<T>(list: ArrayLike<T>): T {
  return list[Math.floor(Math.random() * list.length)];
}

// Pause like a person would; fixed sleeps create unrealistic traffic waves.
export function think(min: number = THINK_MIN_S, max: number = THINK_MAX_S): void {
  sleep(min + Math.random() * (max - min));
}

// res.json() throws on empty or non-JSON bodies; we swallow that so checks can report the failure instead.
export function safeJson<T>(res: { json(): unknown }): T | null {
  try {
    return res.json() as T;
  } catch (e) {
    return null;
  }
}
