/**
 * MCP integration types for Agent module
 */

/**
 * Detailed MCP server information
 */
export interface MCPServerDetails {
  name: string;
  status: 'connecting' | 'connected' | 'failed' | 'disconnected';
  
  // Configuration details
  config: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    timeout?: number;
    retryCount?: number;
    retryDelay?: number;
  };
  
  // Source information
  configSource: 'local' | 'global';
  configPath: string;
  
  // Connection details
  connectedAt?: Date;
  lastError?: string;
  lastPingAt?: Date;
  
  // Available tools
  tools: Array<{
    name: string;
    frameworkName: string;  // How it appears in agent tool list
    description: string;
  }>;
}

/**
 * Detailed MCP tool description
 */
export interface MCPToolDescription {
  // Basic info
  name: string;
  frameworkName: string;
  description: string;
  
  // Server context
  serverName: string;
  serverStatus: 'connecting' | 'connected' | 'failed' | 'disconnected';
  
  // Tool schema
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  
  // Integration info
  isAvailable: boolean;
  category?: string;
  tags?: string[];
  
  // Runtime info
  lastExecuted?: Date;
  executionCount?: number;
}

/**
 * MCP server status summary
 */
export interface MCPServerStatus {
  name: string;
  status: 'connecting' | 'connected' | 'failed' | 'disconnected';
  connectedAt?: Date;
  lastError?: string;
  lastPingAt?: Date;
}

/**
 * MCP configuration for Agent
 */
export interface AgentMCPConfig {
  localPath?: string;
  globalPath?: string;
  connectionTimeout?: number;
}