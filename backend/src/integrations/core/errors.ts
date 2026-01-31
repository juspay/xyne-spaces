/**
 * Custom error classes for webhook integrations
 */

export class WebhookError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'WebhookError';
  }
}

export class ValidationError extends WebhookError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class SignatureError extends WebhookError {
  constructor(message: string) {
    super(message, 'SIGNATURE_ERROR');
    this.name = 'SignatureError';
  }
}

export class ParseError extends WebhookError {
  constructor(message: string) {
    super(message, 'PARSE_ERROR');
    this.name = 'ParseError';
  }
}

export class SourceNotFoundError extends WebhookError {
  constructor(sourceName: string) {
    super(`External source not found: ${sourceName}`, 'SOURCE_NOT_FOUND');
    this.name = 'SourceNotFoundError';
  }
}
