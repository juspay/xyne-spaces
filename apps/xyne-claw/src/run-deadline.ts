export const DEFAULT_MAX_RUN_MS = 3 * 60 * 60 * 1000;

export const RUN_TIMED_OUT = Symbol("run-timed-out");

export function maxRunMs(raw: string | undefined = process.env["RUN_QUEUE_MAX_RUN_MS"]): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_RUN_MS;
}

export async function raceRunDeadline<T>(run: Promise<T>, ms: number): Promise<T | typeof RUN_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof RUN_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(RUN_TIMED_OUT), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([run, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (!cause) return err.message;
  const c = cause as { code?: unknown; message?: unknown };
  const detail = [typeof c.code === "string" ? c.code : "", typeof c.message === "string" ? c.message : String(cause)]
    .filter(Boolean)
    .join(" ");
  return `${err.message} (cause: ${detail})`;
}
