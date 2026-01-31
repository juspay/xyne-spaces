// Core types and interfaces
export * from './core/types/framework.js';
export * from './core/types/config.js';
export * from './core/types/errors.js';

// Error classes and utilities
export * from './core/errors/index.js';

// Base classes
export * from './core/base/mcp-client.js';

// Configuration management
export * from './config/index.js';

// Resource management
export * from './resources/index.js';

// Tool integration
export * from './tools/index.js';

// Re-export common types for convenience
export type {
  MCPConfig,
  MCPServerConfig,
  MCPLocalServerConfig,
  MCPRemoteServerConfig
} from './core/types/config.js';

export type {
  MCPResource,
  MCPTool,
  MCPPrompt,
  MCPServerConnection,
  MCPServerStatus
} from './core/types/framework.js';

export type {
  ResourceCatalog,
  ResourceMetadata,
  ResourceQuery,
  CatalogEntry,
  ResourceManagerOptions,
  ResourceAccessResult,
  ResourceValidationResult
} from './resources/types/index.js';

export type {
  MCPToolCatalog,
  MCPToolCatalogEntry,
  MCPToolQuery,
  ToolIntegrationManagerOptions,
  ToolIntegrationStats,
  MCPFrameworkToolAdapter
} from './tools/types/index.js';

export {
  MCPError,
  MCPConfigError,
  MCPConnectionError,
  MCPProtocolError,
  MCPTimeoutError,
  MCPAuthenticationError,
  MCPValidationError,
  MCPServerError,
  MCPResourceError,
  MCPToolError,
  isMCPError,
  isMCPErrorType
} from './core/errors/index.js';