/**
 * Resource management types for MCP
 */

import type { MCPResource } from '../../core/types/framework.js';

/**
 * Extended resource metadata for discovery and management
 */
export interface ResourceMetadata {
  readonly uri: string;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly serverName: string;
  readonly discoveredAt: Date;
  readonly size?: number | undefined;
  readonly lastModified?: Date | undefined;
  readonly permissions?: ResourcePermissions | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly annotations?: Readonly<Record<string, string>> | undefined;
}

/**
 * Resource permissions
 */
export interface ResourcePermissions {
  readonly read: boolean;
  readonly write?: boolean | undefined;
  readonly execute?: boolean | undefined;
}

/**
 * Resource catalog entry combining MCP resource with metadata
 */
export interface CatalogEntry {
  readonly resource: MCPResource;
  readonly metadata: ResourceMetadata;
}

/**
 * Resource catalog containing all discovered resources
 */
export interface ResourceCatalog {
  readonly entries: readonly CatalogEntry[];
  readonly totalCount: number;
  readonly serverCounts: Readonly<Record<string, number>>;
  readonly lastUpdated: Date;
}

/**
 * Resource query for filtering and searching
 */
export interface ResourceQuery {
  readonly serverName?: string | undefined;
  readonly uriPattern?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly namePattern?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

/**
 * Resource discovery options
 */
export interface ResourceDiscoveryOptions {
  readonly includeMetadata?: boolean | undefined;
  readonly timeout?: number | undefined;
  readonly concurrency?: number | undefined;
  readonly retryCount?: number | undefined;
}

// Re-export access types
export type {
  ResourceAccessOptions,
  ResourceAccessResult,
  UriResolutionResult
} from '../access/resource-accessor.js';

// Re-export validation types  
export type {
  ValidationRule,
  ValidationResult,
  ValidationOptions,
  ResourceValidationResult
} from '../validation/resource-validator.js';

// Re-export manager types
export type {
  ResourceManagerOptions,
  ResourceManagerStats,
  ManagedResourceResult
} from '../manager/resource-manager.js';