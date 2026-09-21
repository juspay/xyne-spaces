/**
 * Collapse concurrent calls into one in-flight promise. Callers that arrive
 * while a call is running receive that call's result (and its arguments win).
 * The slot clears when the promise settles, success or failure.
 */
export function singleFlight<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return (...args) => {
    inFlight ??= fn(...args).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
