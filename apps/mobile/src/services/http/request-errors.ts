export class RequestAbortedError extends Error {
  constructor(message = 'Request aborted') {
    super(message);
    this.name = 'RequestAbortedError';
  }
}

export class RequestTimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}
