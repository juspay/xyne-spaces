import type { 
  MCPErrorDetails,
  MCPErrorType,
  MCPErrorSeverity,
  MCPConfigErrorDetails,
  MCPConnectionErrorDetails,
  MCPProtocolErrorDetails,
  MCPTimeoutErrorDetails,
  MCPAuthenticationErrorDetails,
  MCPValidationErrorDetails,
  MCPServerErrorDetails,
  MCPResourceErrorDetails,
  MCPToolErrorDetails
} from '../types/errors.js';

/**
 * Base MCP error class
 */
export class MCPError extends Error {
  public readonly mcpError: MCPErrorDetails;

  constructor(details: MCPErrorDetails) {
    super(details.message);
    this.name = 'MCPError';
    this.mcpError = details;
    
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MCPError);
    }
  }

  /**
   * Check if error is retryable
   */
  public isRetryable(): boolean {
    return this.mcpError.retryable ?? false;
  }

  /**
   * Get error severity
   */
  public getSeverity(): MCPErrorSeverity {
    return this.mcpError.severity;
  }

  /**
   * Get error type
   */
  public getType(): MCPErrorType {
    return this.mcpError.type;
  }

  /**
   * Get server name if applicable
   */
  public getServerName(): string | undefined {
    return this.mcpError.serverName;
  }

  /**
   * Serialize error for logging
   */
  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      stack: this.stack,
      mcpError: this.mcpError
    };
  }
}

/**
 * Configuration error class
 */
export class MCPConfigError extends MCPError {
  public readonly configError: MCPConfigErrorDetails;

  constructor(details: Omit<MCPConfigErrorDetails, 'type' | 'timestamp'>) {
    const errorDetails: MCPConfigErrorDetails = {
      ...details,
      type: 'CONFIG_ERROR',
      timestamp: new Date()
    };
    super(errorDetails);
    this.name = 'MCPConfigError';
    this.configError = errorDetails;
  }

  public getConfigPath(): string | undefined {
    return this.configError.configPath;
  }

  public getValidationErrors(): readonly string[] | undefined {
    return this.configError.validationErrors;
  }
}

/**
 * Connection error class
 */
export class MCPConnectionError extends MCPError {
  public readonly connectionError: MCPConnectionErrorDetails;

  constructor(details: Omit<MCPConnectionErrorDetails, 'type' | 'timestamp'>) {
    const errorDetails: MCPConnectionErrorDetails = {
      ...details,
      type: 'CONNECTION_ERROR',
      timestamp: new Date()
    };
    super(errorDetails);
    this.name = 'MCPConnectionError';
    this.connectionError = errorDetails;
  }

  public getConnectionAttempts(): number | undefined {
    return this.connectionError.connectionAttempts;
  }

  public getLastAttemptAt(): Date | undefined {
    return this.connectionError.lastAttemptAt;
  }

  public getEndpoint(): string | undefined {
    return this.connectionError.endpoint;
  }
}

/**
 * Protocol error class
 */
export class MCPProtocolError extends MCPError {
  constructor(details: Omit<MCPProtocolErrorDetails, 'type' | 'timestamp'>) {
    super({
      ...details,
      type: 'PROTOCOL_ERROR',
      timestamp: new Date()
    });
    this.name = 'MCPProtocolError';
  }
}

/**
 * Timeout error class
 */
export class MCPTimeoutError extends MCPError {
  public readonly timeoutError: MCPTimeoutErrorDetails;

  constructor(details: Omit<MCPTimeoutErrorDetails, 'type' | 'timestamp'>) {
    const errorDetails: MCPTimeoutErrorDetails = {
      ...details,
      type: 'TIMEOUT_ERROR',
      timestamp: new Date()
    };
    super(errorDetails);
    this.name = 'MCPTimeoutError';
    this.timeoutError = errorDetails;
  }

  public getTimeoutMs(): number {
    return this.timeoutError.timeoutMs;
  }

  public getOperation(): string {
    return this.timeoutError.operation;
  }
}

/**
 * Authentication error class
 */
export class MCPAuthenticationError extends MCPError {
  constructor(details: Omit<MCPAuthenticationErrorDetails, 'type' | 'timestamp'>) {
    super({
      ...details,
      type: 'AUTHENTICATION_ERROR',
      timestamp: new Date()
    });
    this.name = 'MCPAuthenticationError';
  }
}

/**
 * Validation error class
 */
export class MCPValidationError extends MCPError {
  public readonly validationError: MCPValidationErrorDetails;

  constructor(details: Omit<MCPValidationErrorDetails, 'type' | 'timestamp'>) {
    const errorDetails: MCPValidationErrorDetails = {
      ...details,
      type: 'VALIDATION_ERROR',
      timestamp: new Date()
    };
    super(errorDetails);
    this.name = 'MCPValidationError';
    this.validationError = errorDetails;
  }

  public getValidationErrors(): readonly string[] {
    return this.validationError.validationErrors;
  }

  public getSchema(): string | undefined {
    return this.validationError.schema;
  }
}

/**
 * Server error class
 */
export class MCPServerError extends MCPError {
  constructor(details: Omit<MCPServerErrorDetails, 'type' | 'timestamp'>) {
    super({
      ...details,
      type: 'SERVER_ERROR',
      timestamp: new Date()
    });
    this.name = 'MCPServerError';
  }
}

/**
 * Resource error class
 */
export class MCPResourceError extends MCPError {
  constructor(details: Omit<MCPResourceErrorDetails, 'type' | 'timestamp'>) {
    super({
      ...details,
      type: 'RESOURCE_ERROR',
      timestamp: new Date()
    });
    this.name = 'MCPResourceError';
  }
}

/**
 * Tool error class
 */
export class MCPToolError extends MCPError {
  constructor(details: Omit<MCPToolErrorDetails, 'type' | 'timestamp'>) {
    super({
      ...details,
      type: 'TOOL_ERROR',
      timestamp: new Date()
    });
    this.name = 'MCPToolError';
  }
}

/**
 * Type guard to check if error is an MCP error
 */
export function isMCPError(error: unknown): error is MCPError {
  return error instanceof Error && 'mcpError' in error;
}

/**
 * Type guard to check if error is a specific MCP error type
 */
export function isMCPErrorType<T extends MCPErrorType>(
  error: unknown, 
  type: T
): error is MCPError {
  return isMCPError(error) && error.getType() === type;
}


/**
 * Helper functions to create specific error types
 */
export const createMCPConfigError = (
  message: string,
  options: {
    configPath?: string;
    validationErrors?: readonly string[];
    severity?: MCPErrorSeverity;
    originalError?: Error;
  } = {}
): MCPConfigError => {
  const errorDetails: Omit<MCPConfigErrorDetails, 'type' | 'timestamp'> = {
    message,
    severity: options.severity ?? 'high',
    retryable: false,
    ...(options.configPath !== undefined && { configPath: options.configPath }),
    ...(options.validationErrors !== undefined && { validationErrors: options.validationErrors }),
    ...(options.originalError !== undefined && { originalError: options.originalError })
  };

  return new MCPConfigError(errorDetails);
};

export const createMCPConnectionError = (
  serverName: string,
  message: string,
  options: {
    connectionAttempts?: number;
    lastAttemptAt?: Date;
    endpoint?: string;
    severity?: MCPErrorSeverity;
    retryable?: boolean;
    originalError?: Error;
  } = {}
): MCPConnectionError => {
  const errorDetails: Omit<MCPConnectionErrorDetails, 'type' | 'timestamp'> = {
    serverName,
    message,
    severity: options.severity ?? 'high',
    retryable: options.retryable ?? true,
    ...(options.connectionAttempts !== undefined && { connectionAttempts: options.connectionAttempts }),
    ...(options.lastAttemptAt !== undefined && { lastAttemptAt: options.lastAttemptAt }),
    ...(options.endpoint !== undefined && { endpoint: options.endpoint }),
    ...(options.originalError !== undefined && { originalError: options.originalError })
  };

  return new MCPConnectionError(errorDetails);
};

export const createMCPTimeoutError = (
  operation: string,
  timeoutMs: number,
  options: {
    serverName?: string;
    severity?: MCPErrorSeverity;
    originalError?: Error;
  } = {}
): MCPTimeoutError => {
  const errorDetails: Omit<MCPTimeoutErrorDetails, 'type' | 'timestamp'> = {
    message: `Operation '${operation}' timed out after ${timeoutMs}ms`,
    severity: options.severity ?? 'medium',
    timeoutMs,
    operation,
    retryable: true,
    ...(options.serverName !== undefined && { serverName: options.serverName }),
    ...(options.originalError !== undefined && { originalError: options.originalError })
  };

  return new MCPTimeoutError(errorDetails);
};

export const createMCPValidationError = (
  validationErrors: readonly string[],
  options: {
    serverName?: string;
    schema?: string;
    severity?: MCPErrorSeverity;
    originalError?: Error;
  } = {}
): MCPValidationError => {
  const errorDetails: Omit<MCPValidationErrorDetails, 'type' | 'timestamp'> = {
    message: `Validation failed: ${validationErrors.join(', ')}`,
    severity: options.severity ?? 'medium',
    validationErrors,
    retryable: false,
    ...(options.serverName !== undefined && { serverName: options.serverName }),
    ...(options.schema !== undefined && { schema: options.schema }),
    ...(options.originalError !== undefined && { originalError: options.originalError })
  };

  return new MCPValidationError(errorDetails);
};