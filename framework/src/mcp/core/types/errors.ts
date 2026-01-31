/**
 * MCP error categories
 */
export type MCPErrorType = 
  | 'CONFIG_ERROR'
  | 'CONNECTION_ERROR'
  | 'PROTOCOL_ERROR'
  | 'TIMEOUT_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'VALIDATION_ERROR'
  | 'SERVER_ERROR'
  | 'RESOURCE_ERROR'
  | 'TOOL_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * MCP error severity levels
 */
export type MCPErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Base MCP error interface
 */
export interface MCPErrorDetails {
  readonly type: MCPErrorType;
  readonly severity: MCPErrorSeverity;
  readonly message: string;
  readonly serverName?: string;
  readonly context?: Record<string, unknown>;
  readonly retryable?: boolean;
  readonly timestamp: Date;
  readonly originalError?: Error;
}

/**
 * Configuration-related error details
 */
export interface MCPConfigErrorDetails extends MCPErrorDetails {
  readonly type: 'CONFIG_ERROR';
  readonly configPath?: string;
  readonly validationErrors?: readonly string[];
}

/**
 * Connection-related error details
 */
export interface MCPConnectionErrorDetails extends MCPErrorDetails {
  readonly type: 'CONNECTION_ERROR';
  readonly serverName: string;
  readonly connectionAttempts?: number;
  readonly lastAttemptAt?: Date;
  readonly endpoint?: string;
}

/**
 * Protocol-related error details
 */
export interface MCPProtocolErrorDetails extends MCPErrorDetails {
  readonly type: 'PROTOCOL_ERROR';
  readonly protocolVersion?: string;
  readonly messageId?: string | number;
  readonly method?: string;
}

/**
 * Timeout-related error details
 */
export interface MCPTimeoutErrorDetails extends MCPErrorDetails {
  readonly type: 'TIMEOUT_ERROR';
  readonly timeoutMs: number;
  readonly operation: string;
}

/**
 * Authentication-related error details
 */
export interface MCPAuthenticationErrorDetails extends MCPErrorDetails {
  readonly type: 'AUTHENTICATION_ERROR';
  readonly authType?: string;
  readonly endpoint?: string;
}

/**
 * Validation-related error details
 */
export interface MCPValidationErrorDetails extends MCPErrorDetails {
  readonly type: 'VALIDATION_ERROR';
  readonly validationErrors: readonly string[];
  readonly schema?: string;
}

/**
 * Server-related error details
 */
export interface MCPServerErrorDetails extends MCPErrorDetails {
  readonly type: 'SERVER_ERROR';
  readonly serverName: string;
  readonly serverVersion?: string;
  readonly statusCode?: number;
}

/**
 * Resource-related error details
 */
export interface MCPResourceErrorDetails extends MCPErrorDetails {
  readonly type: 'RESOURCE_ERROR';
  readonly resourceUri: string;
  readonly operation: 'list' | 'read' | 'subscribe';
}

/**
 * Tool-related error details
 */
export interface MCPToolErrorDetails extends MCPErrorDetails {
  readonly type: 'TOOL_ERROR';
  readonly toolName: string;
  readonly operation: 'list' | 'call';
  readonly arguments?: Record<string, unknown>;
}

/**
 * Union type for all MCP error detail types
 */
export type MCPErrorDetailsUnion = 
  | MCPConfigErrorDetails
  | MCPConnectionErrorDetails
  | MCPProtocolErrorDetails
  | MCPTimeoutErrorDetails
  | MCPAuthenticationErrorDetails
  | MCPValidationErrorDetails
  | MCPServerErrorDetails
  | MCPResourceErrorDetails
  | MCPToolErrorDetails;