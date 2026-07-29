/**
 * MCP server configuration for local processes
 */
export interface MCPLocalServerConfig {
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly timeout?: number;
  readonly retryCount?: number;
  readonly retryDelay?: number;
  readonly suppressLogs?: boolean;
}

/**
 * MCP server configuration for remote connections
 */
export interface MCPRemoteServerConfig {
  readonly transport: {
    readonly type: 'http' | 'websocket';
    readonly url: string;
    readonly headers?: Record<string, string>;
    readonly timeout?: number;
    readonly retryCount?: number;
    readonly retryDelay?: number;
  };
  readonly auth?: {
    readonly type: 'bearer' | 'basic' | 'api-key';
    readonly token?: string;
    readonly username?: string;
    readonly password?: string;
    readonly apiKey?: string;
    readonly header?: string;
  };
}

/**
 * MCP server configuration union type
 */
export type MCPServerConfig = MCPLocalServerConfig | MCPRemoteServerConfig;

/**
 * Configuration for MCP servers section
 */
export interface MCPServersConfig {
  readonly [serverName: string]: MCPServerConfig;
}

/**
 * Security configuration for MCP module
 */
export interface MCPSecurityConfig {
  readonly allowedHosts?: readonly string[];
  readonly maxResourceSize?: string;
  readonly timeout?: number;
  readonly enableSandbox?: boolean;
  readonly trustedServers?: readonly string[];
}

/**
 * Performance configuration for MCP module
 */
export interface MCPPerformanceConfig {
  readonly maxConcurrentConnections?: number;
  readonly connectionPoolSize?: number;
  readonly requestTimeout?: number;
  readonly retryAttempts?: number;
  readonly retryDelay?: number;
  readonly enableRequestBatching?: boolean;
}

/**
 * Feature configuration for MCP module
 */
export interface MCPFeatureConfig {
  readonly enableResourceCaching?: boolean;
  readonly enableToolIntegration?: boolean;
  readonly enablePromptTemplates?: boolean;
  readonly enableHealthMonitoring?: boolean;
  readonly enableMetrics?: boolean;
  readonly enableLogging?: boolean;
}

/**
 * Main MCP configuration interface
 */
export interface MCPConfig {
  readonly mcpServers: MCPServersConfig;
  readonly security?: MCPSecurityConfig;
  readonly performance?: MCPPerformanceConfig;
  readonly features?: MCPFeatureConfig;
}

/**
 * MCP configuration loading options
 */
export interface MCPConfigOptions {
  readonly localPath?: string;
  readonly globalPath?: string;
}

/**
 * Type guard to check if config is for local server
 */
export function isLocalServerConfig(config: MCPServerConfig): config is MCPLocalServerConfig {
  return 'command' in config;
}

/**
 * Type guard to check if config is for remote server
 */
export function isRemoteServerConfig(config: MCPServerConfig): config is MCPRemoteServerConfig {
  return 'transport' in config;
}