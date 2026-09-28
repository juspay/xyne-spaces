/** Thrown by the service-account domain; each caller maps `code` to its own response. */
export type ServiceAccountErrorCode = 'validation_failed' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict';

export class ServiceAccountError extends Error {
  readonly code: ServiceAccountErrorCode;
  readonly reason?: string;

  constructor(code: ServiceAccountErrorCode, message: string, opts: { reason?: string } = {}) {
    super(message);
    this.name = 'ServiceAccountError';
    this.code = code;
    this.reason = opts.reason;
  }
}

export const HTTP_STATUS: Record<ServiceAccountErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};
