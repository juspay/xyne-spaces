/**
 * Tool integration system - bridges MCP tools to framework tool system
 */

// Core types
export type {
  MCPToolCatalog,
  MCPToolCatalogEntry,
  MCPToolQuery,
  MCPToolRouterEntry,
  MCPFrameworkToolAdapter,
  MCPToolExecutionOptions,
  MCPToolExecutionResult,
  MCPToolExecutionError,
  ToolDiscoveryOptions,
  ToolIntegrationOptions,
  ToolIntegrationManagerOptions,
  ToolIntegrationStats,
  ParameterMappingResult,
  SchemaAdaptationResult
} from './types/index.js';

// Discovery
export { ToolDiscovery } from './discovery/tool-discovery.js';

// Adapters
export { ParameterMapper } from './adapters/parameter-mapper.js';
export { MCPToolAdapter } from './adapters/tool-adapter.js';

// Routing
export { ToolRouter } from './routing/tool-router.js';

// Manager
export { ToolIntegrationManager } from './manager/tool-integration-manager.js';