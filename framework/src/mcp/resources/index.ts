/**
 * MCP Resource Management Module
 * 
 * This module provides resource discovery, access, and validation
 * for MCP servers without caching (as requested).
 */

export { ResourceDiscovery } from './discovery/resource-discovery.js';
export { ResourceAccessor } from './access/resource-accessor.js';
export { ResourceValidator } from './validation/resource-validator.js';
export { ResourceManager } from './manager/resource-manager.js';

export type {
  ResourceDiscoveryOptions,
  ResourceCatalog,
  ResourceMetadata,
  ResourceQuery
} from './types/index.js';