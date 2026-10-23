export const QueryCacheLogEvent = {
  ZERO_RUN_ERROR: 'ZERO_RUN_ERROR',
  APP_REFRESH: 'APP_REFRESH',
} as const;

/** Serializable details for caught rejections (avoids useless `{}` / `[]` in logs). */
export function formatUnknownError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { kind: 'Error', name: err.name, message: err.message, stack: err.stack };
  }
  if (err === null || err === undefined) {
    return { kind: 'nil', value: String(err) };
  }
  if (typeof err === 'object') {
    try {
      return { kind: 'json', value: JSON.stringify(err) };
    } catch {
      return { kind: 'object', value: Object.prototype.toString.call(err) };
    }
  }
  return { kind: typeof err, value: String(err) };
}

export function queryCacheLogError(event: string, meta: Record<string, unknown>): void {
  console.error(`[${event}]`, meta);
}
