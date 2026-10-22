export class HttpRequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`HTTP request exceeded its ${timeoutMs} ms timeout`);

    this.name = 'HttpRequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}
