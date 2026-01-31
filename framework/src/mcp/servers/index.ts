/**
 * MCP Server Management
 * 
 * This module provides comprehensive MCP server connection management including:
 * - Local server spawning and process management
 * - Remote server HTTP/WebSocket connections
 * - Server registry for managing multiple connections
 * - Health monitoring and reconnection logic
 * - Configuration-driven server setup
 */

// Types and interfaces
export type {
  MCPServerStatus,
  MCPServerHealth,
  MCPServerConnection,
  MCPServerEvent,
  MCPServerEventData,
  MCPConnectionOptions,
  MCPServerManager,
  MCPProcessInfo,
  MCPTransportInfo,
  MCPRegistryHealth,
  MCPRetryStrategy
} from './types/index.js';

// Export interface separately for use in functions
export type { MCPServerRegistry } from './types/index.js';

export {
  DEFAULT_CONNECTION_OPTIONS,
  DEFAULT_RETRY_STRATEGY
} from './types/index.js';

// Server managers
export { BaseMCPServerManager } from './base/server-manager.js';
export { LocalMCPServerManager } from './local/local-server-manager.js';
export { RemoteMCPServerManager } from './remote/remote-server-manager.js';

// Registry
export { MCPServerRegistryImpl } from './registry/server-registry.js';

// Main manager
export { MCPManager } from './manager/mcp-manager.js';
export type { MCPManagerOptions, MCPManagerStatus } from './manager/mcp-manager.js';

// Import types for internal use
import type { MCPManagerOptions } from './manager/mcp-manager.js';
import { MCPManager } from './manager/mcp-manager.js';
import type { MCPServerRegistry } from './types/index.js';
import { MCPServerRegistryImpl } from './registry/server-registry.js';

/**
 * Create a new MCP manager instance
 * 
 * @param options - Configuration options for the manager
 * @returns A new MCPManager instance
 * 
 * @example
 * ```typescript
 * import { createMCPManager } from './mcp/servers';
 * 
 * const manager = createMCPManager({
 *   configPath: './config/mcp/mcp.config.json',
 *   autoConnect: true,
 *   enableHealthMonitoring: true
 * });
 * 
 * await manager.start();
 * ```
 */
export function createMCPManager(options?: MCPManagerOptions): MCPManager {
  return new MCPManager(options);
}

/**
 * Create a new MCP server registry
 * 
 * @returns A new MCPServerRegistry instance
 * 
 * @example
 * ```typescript
 * import { createMCPRegistry } from './mcp/servers';
 * 
 * const registry = createMCPRegistry();
 * 
 * await registry.register('my-server', {
 *   command: 'node',
 *   args: ['server.js']
 * });
 * ```
 */
export function createMCPRegistry(): MCPServerRegistry {
  return new MCPServerRegistryImpl();
}