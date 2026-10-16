export class RemoteLogDeliveryError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super(`Remote log request failed with HTTP ${statusCode}`);

    this.name = 'RemoteLogDeliveryError';
    this.statusCode = statusCode;
  }
}
