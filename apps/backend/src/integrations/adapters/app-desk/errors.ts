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
