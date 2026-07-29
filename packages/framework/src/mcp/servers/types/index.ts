/**
 * Server connection types and interfaces for MCP server management
 */

import type { MCPServerConfig } from '../../core/types/config.js';

/**
 * Server connection status
 */
export type MCPServerStatus = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'reconnecting';

/**
 * Server connection health metrics
 */
export interface MCPServerHealth {
  readonly status: MCPServerStatus;
  readonly lastHeartbeat: Date | undefined;
  readonly uptime: number | undefined;
  readonly errorCount: number;
  readonly lastError: Error | undefined;
  readonly responseTime: number | undefined;
  readonly reconnectAttempts: number;
}

/**
 * Server connection information
 */
export interface MCPServerConnection {
  readonly id: string;
  readonly name: string;
  readonly config: MCPServerConfig;
  readonly health: MCPServerHealth;
  readonly connectedAt: Date | undefined;
  readonly version: string | undefined;
  readonly capabilities: string[] | undefined;
}

/**
 * Server connection events
 */
export type MCPServerEvent = 
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'message'
  | 'heartbeat'
  | 'reconnecting';

/**
 * Server event data
 */
export interface MCPServerEventData {
  readonly serverId: string;
  readonly serverName: string;
  readonly event: MCPServerEvent;
  readonly timestamp: Date;
  readonly data: Record<string, unknown> | undefined;
  readonly error: Error | undefined;
}

/**
 * Connection options for server managers
 */
export interface MCPConnectionOptions {
  readonly timeout: number | undefined;
  readonly retryAttempts: number | undefined;
  readonly retryDelay: number | undefined;
  readonly heartbeatInterval: number | undefined;
  readonly healthCheckInterval: number | undefined;
  readonly autoReconnect: boolean | undefined;
}

/**
 * Server manager interface for managing individual server connections
 */
export interface MCPServerManager {
  /**
   * Get server information
   */
  getServerInfo(): MCPServerConnection;

  /**
   * Connect to the server
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the server
   */
  disconnect(): Promise<void>;

  /**
   * Check if server is connected
   */
  isConnected(): boolean;

  /**
   * Send message to server
   */
  sendMessage(message: unknown): Promise<unknown>;

  /**
   * Get current health status
   */
  getHealth(): MCPServerHealth;

  /**
   * Start health monitoring
   */
  startHealthMonitoring(): void;

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void;

  /**
   * Add event listener
   */
  on(event: MCPServerEvent, listener: (data: MCPServerEventData) => void): void;

  /**
   * Remove event listener
   */
  off(event: MCPServerEvent, listener: (data: MCPServerEventData) => void): void;

  /**
   * Clean up resources
   */
  cleanup(): Promise<void>;
}

/**
 * Process information for local servers
 */
export interface MCPProcessInfo {
  readonly pid: number | undefined;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: Record<string, string> | undefined;
  readonly startTime: Date | undefined;
}

/**
 * Transport information for remote servers
 */
export interface MCPTransportInfo {
  readonly type: 'http' | 'websocket';
  readonly url: string;
  readonly headers: Record<string, string> | undefined;
  readonly connected: boolean;
}

/**
 * Registry for managing multiple server connections
 */
export interface MCPServerRegistry {
  /**
   * Register a new server
   */
  register(name: string, config: MCPServerConfig, options?: MCPConnectionOptions): Promise<MCPServerManager>;

  /**
   * Unregister a server
   */
  unregister(name: string): Promise<void>;

  /**
   * Get server manager by name
   */
  getServer(name: string): MCPServerManager | undefined;

  /**
   * Get all registered servers
   */
  getAllServers(): readonly MCPServerConnection[];

  /**
   * Get servers by status
   */
  getServersByStatus(status: MCPServerStatus): readonly MCPServerConnection[];

  /**
   * Connect to all servers
   */
  connectAll(): Promise<void>;

  /**
   * Disconnect from all servers
   */
  disconnectAll(): Promise<void>;

  /**
   * Get registry health summary
   */
  getHealthSummary(): MCPRegistryHealth;

  /**
   * Add registry event listener
   */
  on(event: 'server-added' | 'server-removed' | 'server-status-changed', 
     listener: (data: MCPServerEventData) => void): void;

  /**
   * Remove registry event listener
   */
  off(event: 'server-added' | 'server-removed' | 'server-status-changed', 
      listener: (data: MCPServerEventData) => void): void;

  /**
   * Clean up all resources
   */
  cleanup(): Promise<void>;
}

/**
 * Registry health summary
 */
export interface MCPRegistryHealth {
  readonly totalServers: number;
  readonly connectedServers: number;
  readonly errorServers: number;
  readonly averageResponseTime: number | undefined;
  readonly totalErrors: number;
  readonly healthScore: number; // 0-100
}

/**
 * Connection retry strategy
 */
export interface MCPRetryStrategy {
  readonly maxAttempts: number;
  readonly initialDelay: number;
  readonly maxDelay: number;
  readonly backoffMultiplier: number;
  readonly jitter: boolean;
}

/**
 * Default connection options
 */
export const DEFAULT_CONNECTION_OPTIONS: Required<MCPConnectionOptions> = {
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
  heartbeatInterval: 30000,
  healthCheckInterval: 60000,
  autoReconnect: true
};

/**
 * Default retry strategy
 */
export const DEFAULT_RETRY_STRATEGY: MCPRetryStrategy = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true
};