/**
 * Base error type for all tool-related errors
 */
export interface ToolErrorBase {
  readonly name: string;
  readonly message: string;
  readonly code: string;
  readonly timestamp: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Tool validation error - occurs when input/output validation fails
 */
export interface ToolValidationError extends ToolErrorBase {
  readonly name: 'ToolValidationError';
  readonly code: 'TOOL_VALIDATION_ERROR';
  readonly validationErrors: readonly string[];
}

/**
 * Tool execution error - occurs during tool execution
 */
export interface ToolExecutionError extends ToolErrorBase {
  readonly name: 'ToolExecutionError';
  readonly code: 'TOOL_EXECUTION_ERROR';
  readonly originalError?: Error;
}

/**
 * Tool registration error - occurs during tool registration
 */
export interface ToolRegistrationError extends ToolErrorBase {
  readonly name: 'ToolRegistrationError';
  readonly code: 'TOOL_REGISTRATION_ERROR';
  readonly toolName: string;
}

/**
 * Tool not found error - occurs when a tool is not found in registry
 */
export interface ToolNotFoundError extends ToolErrorBase {
  readonly name: 'ToolNotFoundError';
  readonly code: 'TOOL_NOT_FOUND';
  readonly toolName: string;
}

/**
 * Tool authorization error - occurs when tool execution is denied by authorization hook
 */
export interface ToolAuthorizationError extends ToolErrorBase {
  readonly name: 'ToolAuthorizationError';
  readonly code: 'TOOL_AUTHORIZATION_DENIED' | 'AUTHORIZATION_HOOK_ERROR';
  readonly originalError?: Error;
}

/**
 * Union type of all possible tool errors
 */
export type ToolError = 
  | ToolValidationError 
  | ToolExecutionError 
  | ToolRegistrationError 
  | ToolNotFoundError
  | ToolAuthorizationError;

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}