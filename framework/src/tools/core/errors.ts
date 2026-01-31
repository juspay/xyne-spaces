import type { 
  ToolError,
  ToolValidationError,
  ToolExecutionError,
  ToolRegistrationError,
  ToolNotFoundError 
} from '../../types/errors.js';

/**
 * Tool error factory functions for creating strongly-typed errors
 */

export function createToolValidationError(
  toolName: string,
  validationErrors: readonly string[],
  details?: Record<string, unknown>
): ToolValidationError {
  return {
    name: 'ToolValidationError',
    code: 'TOOL_VALIDATION_ERROR',
    message: `Tool validation failed for '${toolName}': ${validationErrors.join(', ')}`,
    timestamp: new Date().toDateString(),
    validationErrors,
    ...(details && { details })
  };
}

export function createToolExecutionError(
  toolName: string,
  message: string,
  originalError?: Error,
  details?: Record<string, unknown>
): ToolExecutionError {
  return {
    name: 'ToolExecutionError',
    code: 'TOOL_EXECUTION_ERROR',
    message: `Tool execution failed for '${toolName}': ${message}`,
    timestamp: new Date().toDateString(),
    ...(originalError && { originalError }),
    ...(details && { details })
  };
}

export function createToolRegistrationError(
  toolName: string,
  message: string,
  details?: Record<string, unknown>
): ToolRegistrationError {
  return {
    name: 'ToolRegistrationError',
    code: 'TOOL_REGISTRATION_ERROR',
    message: `Tool registration failed for '${toolName}': ${message}`,
    timestamp: new Date().toDateString(),
    toolName,
    ...(details && { details })
  };
}

export function createToolNotFoundError(
  toolName: string,
  details?: Record<string, unknown>
): ToolNotFoundError {
  return {
    name: 'ToolNotFoundError',
    code: 'TOOL_NOT_FOUND',
    message: `Tool '${toolName}' not found in registry`,
    timestamp: new Date().toDateString(),
    toolName,
    ...(details && { details })
  };
}

/**
 * Custom Error classes that extend Error but carry ToolError data
 */
export class ToolValidationErrorClass extends Error {
  public readonly toolError: ToolValidationError;

  constructor(toolError: ToolValidationError) {
    super(toolError.message);
    this.name = 'ToolValidationError';
    this.toolError = toolError;
  }
}

export class ToolExecutionErrorClass extends Error {
  public readonly toolError: ToolExecutionError;
  public readonly cause?: Error;

  constructor(toolError: ToolExecutionError) {
    super(toolError.message);
    this.name = 'ToolExecutionError';
    this.toolError = toolError;
    if (toolError.originalError) {
      this.cause = toolError.originalError;
    }
  }
}

export class ToolRegistrationErrorClass extends Error {
  public readonly toolError: ToolRegistrationError;

  constructor(toolError: ToolRegistrationError) {
    super(toolError.message);
    this.name = 'ToolRegistrationError';
    this.toolError = toolError;
  }
}

export class ToolNotFoundErrorClass extends Error {
  public readonly toolError: ToolNotFoundError;

  constructor(toolError: ToolNotFoundError) {
    super(toolError.message);
    this.name = 'ToolNotFoundError';
    this.toolError = toolError;
  }
}

/**
 * Type guard to check if an error is a ToolError
 */
export function isToolError(error: unknown): error is ToolError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    'code' in error &&
    'message' in error &&
    'timestamp' in error
  );
}

/**
 * Type guard to check if an error is a tool error class
 */
export function isToolErrorClass(error: unknown): error is 
  ToolValidationErrorClass | ToolExecutionErrorClass | ToolRegistrationErrorClass | ToolNotFoundErrorClass {
  return error instanceof ToolValidationErrorClass ||
         error instanceof ToolExecutionErrorClass ||
         error instanceof ToolRegistrationErrorClass ||
         error instanceof ToolNotFoundErrorClass;
}