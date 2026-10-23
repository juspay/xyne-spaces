import { GatewayError } from '../../core/errors';

const STATUS = {
  NOT_CHANNEL_MEMBER: 403,
  NOT_CHANNEL_ADMIN: 403,
  LINK_NOT_FOUND: 404,
  REQUEST_NOT_FOUND: 404,
  REQUEST_CLOSED: 409,
  CHANNEL_TAKEN: 409,
} as const;

export type MirrorErrorCode = keyof typeof STATUS;

export class MirrorError extends GatewayError {
  constructor(code: MirrorErrorCode, message: string) {
    super(code, message, {}, STATUS[code]);
    this.name = 'MirrorError';
  }
}

/** Errors that pause a link instead of being retried. */
export function isPausingError(error: unknown): error is GatewayError {
  return (
    error instanceof GatewayError &&
    (error.code === 'PROVIDER_AUTH' || error.code === 'CHANNEL_GONE')
  );
}
