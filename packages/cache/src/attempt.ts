import type { Clock } from './clock.js';

/** Result of one timed attempt. The only try/catch in the package lives here. */
export type Outcome<T> =
  | { ok: true; value: T; durationMs: number }
  | { ok: false; error: unknown; durationMs: number };

export async function attempt<T>(clock: Clock, fn: () => Promise<T>): Promise<Outcome<T>> {
  const startedAt = clock.now();
  try {
    const value = await fn();
    return { ok: true, value, durationMs: clock.now() - startedAt };
  } catch (error) {
    return { ok: false, error, durationMs: clock.now() - startedAt };
  }
}
