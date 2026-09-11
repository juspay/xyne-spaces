/**
 * Error for the app export API client. Bull retries any throw, so the only
 * meaningful signal carried here is the HTTP status, for logs.
 */
export class AppDeskExportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AppDeskExportError';
  }
}

/**
 * The app is throttling us and asked for a wait this run's budget cannot
 * absorb. Distinct from a plain AppDeskExportError so the page loop can stop
 * the export *cleanly* — park the resume cursor, report `partial` — instead of
 * failing the job and letting Bull retry straight back into the same limit.
 */
export class AppDeskExportThrottledError extends AppDeskExportError {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message, 429);
    this.name = 'AppDeskExportThrottledError';
  }
}
