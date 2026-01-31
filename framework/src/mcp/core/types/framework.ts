/**
 * Framework-specific MCP types that complement the official SDK
 */

/**
 * JSON Schema definition
 */
export interface JSONSchema {
  readonly type?: string;
  readonly properties?: Record<string, JSONSchema | boolean>;
  readonly required?: readonly string[];
  readonly items?: JSONSchema | boolean;
  readonly enum?: readonly unknown[];
  readonly pattern?: string;
  readonly default?: unknown;
  readonly description?: string;
  readonly title?: string;
  readonly [key: string]: unknown;
}

/**
 * MCP server connection status
 */
export interface MCPServerStatus {
  readonly status: 'disconnected' | 'connecting' | 'connected' | 'error' | 'disabled';
  readonly lastError?: string;
  readonly connectedAt?: Date;
  readonly lastPingAt?: Date;
}

/**
 * MCP transport types supported by the framework
 */
export type MCPTransportType = 'stdio' | 'http' | 'websocket';

/**
 * MCP transport configuration for framework integration
 */
export interface MCPTransportConfig {
  readonly type: MCPTransportType;
  readonly timeout?: number;
  readonly retryCount?: number;
  readonly retryDelay?: number;
}

/**
 * MCP server connection info for framework monitoring
 */
export interface MCPServerConnection {
  readonly name: string;
  readonly status: MCPServerStatus['status'];
  readonly capabilities?: Record<string, unknown>;
  readonly lastError?: string;
  readonly connectedAt?: Date;
  readonly lastPingAt?: Date;
  readonly transport: MCPTransportConfig;
}

/**
 * Re-export official SDK types for convenience
 */
export type {
  Resource as MCPResource,
  Tool as MCPTool,
  Prompt as MCPPrompt,
  CallToolResult as MCPToolCallResult,
  GetPromptResult as MCPPromptResult,
  ReadResourceResult as MCPResourceResult
} from '@modelcontextprotocol/sdk/types.js';