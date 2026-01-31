import type { BotError } from './types/bot.js';

/**
 * Bot validation error class
 */
export class BotValidationErrorClass extends Error {
  public readonly botError: BotError;

  constructor(botError: BotError) {
    super(botError.message);
    this.name = 'BotValidationError';
    this.botError = botError;
  }
}

/**
 * Bot execution error class
 */
export class BotExecutionErrorClass extends Error {
  public readonly botError: BotError;

  constructor(botError: BotError) {
    super(botError.message);
    this.name = 'BotExecutionError';
    this.botError = botError;
  }
}

/**
 * Bot registration error class
 */
export class BotRegistrationErrorClass extends Error {
  public readonly botError: BotError;

  constructor(botError: BotError) {
    super(botError.message);
    this.name = 'BotRegistrationError';
    this.botError = botError;
  }
}

/**
 * Bot timeout error class
 */
export class BotTimeoutErrorClass extends Error {
  public readonly botError: BotError;

  constructor(botError: BotError) {
    super(botError.message);
    this.name = 'BotTimeoutError';
    this.botError = botError;
  }
}

/**
 * Bot abort error class
 */
export class BotAbortErrorClass extends Error {
  public readonly botError: BotError;

  constructor(botError: BotError) {
    super(botError.message);
    this.name = 'BotAbortError';
    this.botError = botError;
  }
}

/**
 * Create a validation error
 */
export function createBotValidationError(
  botName: string,
  errors: string[],
  details?: Record<string, unknown>
): BotError {
  return {
    type: 'validation',
    message: `Bot validation failed: ${errors.join(', ')}`,
    botName,
    details: {
      validationErrors: errors,
      ...details
    }
  };
}

/**
 * Create an execution error
 */
export function createBotExecutionError(
  botName: string,
  message: string,
  originalError?: Error,
  details?: Record<string, unknown>
): BotError {
  return {
    type: 'execution',
    message: `Bot execution failed: ${message}`,
    botName,
    originalError,
    details
  };
}

/**
 * Create a registration error
 */
export function createBotRegistrationError(
  botName: string,
  message: string,
  details?: Record<string, unknown>
): BotError {
  return {
    type: 'registration',
    message: `Bot registration failed: ${message}`,
    botName,
    details
  };
}

/**
 * Create a timeout error
 */
export function createBotTimeoutError(
  botName: string,
  timeout: number,
  details?: Record<string, unknown>
): BotError {
  return {
    type: 'timeout',
    message: `Bot execution timed out after ${timeout}ms`,
    botName,
    details: {
      timeout,
      ...details
    }
  };
}

/**
 * Create an abort error
 */
export function createBotAbortError(
  botName: string,
  details?: Record<string, unknown>
): BotError {
  return {
    type: 'abort',
    message: 'Bot execution was aborted',
    botName,
    details
  };
}

/**
 * Check if an error is a bot error class
 */
export function isBotErrorClass(error: unknown): error is 
  | BotValidationErrorClass 
  | BotExecutionErrorClass 
  | BotRegistrationErrorClass 
  | BotTimeoutErrorClass 
  | BotAbortErrorClass {
  return error instanceof BotValidationErrorClass ||
         error instanceof BotExecutionErrorClass ||
         error instanceof BotRegistrationErrorClass ||
         error instanceof BotTimeoutErrorClass ||
         error instanceof BotAbortErrorClass;
}

/**
 * Extract bot error from error class
 */
export function extractBotError(error: unknown): BotError | null {
  if (isBotErrorClass(error)) {
    return error.botError;
  }
  return null;
}