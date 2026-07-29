/**
 * Resource access patterns for MCP resources
 */

import type { MCPClient } from '../../core/base/mcp-client.js';
import type { MCPResourceResult } from '../../core/types/framework.js';
import type { ResourceCatalog, CatalogEntry } from '../types/index.js';
import { MCPError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * Options for resource access
 */
export interface ResourceAccessOptions {
  readonly timeout?: number;
  readonly retryCount?: number;
  readonly retryDelay?: number;
  readonly preferredServer?: string;
}

/**
 * Result of resource access attempt
 */
export interface ResourceAccessResult {
  readonly content: MCPResourceResult;
  readonly serverName: string;
  readonly accessedAt: Date;
  readonly fromCache?: boolean;
}

/**
 * URI resolution result
 */
export interface UriResolutionResult {
  readonly uri: string;
  readonly serverName: string;
  readonly catalogEntry?: CatalogEntry;
  readonly exists: boolean;
}

/**
 * Provides efficient access to MCP resources with URI resolution and error handling
 */
export class ResourceAccessor {
  constructor(private readonly mcpClient: MCPClient) {}

  /**
   * Access a resource by URI with automatic server resolution
   */
  public async accessResource(
    uri: string, 
    options: ResourceAccessOptions = {}
  ): Promise<ResourceAccessResult> {
    logger.debug(`Accessing resource: ${uri}`);

    // Try preferred server first if specified
    if (options.preferredServer) {
      try {
        const result = await this.accessFromServer(uri, options.preferredServer, options);
        return {
          ...result,
          serverName: options.preferredServer
        };
      } catch (error) {
        logger.warn(`Failed to access resource from preferred server ${options.preferredServer}`, { error: (error as Error).message });
        // Fall through to try other servers
      }
    }

    // Try all connected servers
    const connectedServers = this.mcpClient.getConnectedServers();
    let lastError: Error | undefined;

    for (const serverName of connectedServers) {
      if (serverName === options.preferredServer) {
        continue; // Already tried above
      }

      try {
        const result = await this.accessFromServer(uri, serverName, options);
        return {
          ...result,
          serverName
        };
      } catch (error) {
        lastError = error as Error;
        logger.debug(`Failed to access resource from server ${serverName}`, { error: (error as Error).message });
        // Continue trying other servers
      }
    }

    // All servers failed
    throw new MCPError({
      type: 'RESOURCE_ERROR',
      message: `Resource not found or inaccessible: ${uri}`,
      severity: 'medium',
      retryable: true,
      timestamp: new Date(),
      ...(lastError && { originalError: lastError })
    });
  }

  /**
   * Access resource from a specific server
   */
  public async accessFromServer(
    uri: string, 
    serverName: string, 
    options: ResourceAccessOptions = {}
  ): Promise<Omit<ResourceAccessResult, 'serverName'>> {
    const retryCount = options.retryCount || 3;
    const retryDelay = options.retryDelay || 1000;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        logger.debug(`Accessing resource ${uri} from server ${serverName} (attempt ${attempt}/${retryCount})`);
        
        const content = await this.mcpClient.readResource(uri, serverName);
        
        return {
          content,
          accessedAt: new Date()
        };
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < retryCount) {
          logger.debug(`Retrying resource access in ${retryDelay}ms`, { error: (error as Error).message });
          await this.delay(retryDelay);
        }
      }
    }

    throw new MCPError({
      type: 'RESOURCE_ERROR',
      message: `Failed to access resource ${uri} from server ${serverName} after ${retryCount} attempts`,
      severity: 'medium',
      retryable: false,
      serverName,
      timestamp: new Date(),
      ...(lastError && { originalError: lastError })
    });
  }

  /**
   * Resolve URI to determine which server(s) can provide it
   */
  public async resolveUri(
    uri: string, 
    catalog?: ResourceCatalog
  ): Promise<UriResolutionResult[]> {
    const results: UriResolutionResult[] = [];

    // If catalog is provided, check it first (faster)
    if (catalog) {
      const matchingEntries = catalog.entries.filter(entry => entry.resource.uri === uri);
      
      for (const entry of matchingEntries) {
        results.push({
          uri,
          serverName: entry.metadata.serverName,
          catalogEntry: entry,
          exists: true
        });
      }

      // If found in catalog, return those results
      if (results.length > 0) {
        return results;
      }
    }

    // Check each connected server for the resource
    const connectedServers = this.mcpClient.getConnectedServers();
    
    for (const serverName of connectedServers) {
      try {
        // Try to list resources and check if URI exists
        const resources = await this.mcpClient.listResources(serverName);
        const exists = resources.some(resource => resource.uri === uri);
        
        results.push({
          uri,
          serverName,
          exists
        });
      } catch (error) {
        logger.debug(`Failed to check URI existence on server ${serverName}`, { error: (error as Error).message });
        results.push({
          uri,
          serverName,
          exists: false
        });
      }
    }

    return results;
  }

  /**
   * Batch access multiple resources
   */
  public async batchAccess(
    uris: readonly string[], 
    options: ResourceAccessOptions = {}
  ): Promise<Map<string, ResourceAccessResult | Error>> {
    const results = new Map<string, ResourceAccessResult | Error>();
    
    // Process in parallel with concurrency limit
    const concurrency = Math.min(uris.length, 5); // Limit concurrent requests
    const chunks = this.chunkArray([...uris], concurrency);
    
    for (const chunk of chunks) {
      const promises = chunk.map(async (uri) => {
        try {
          const result = await this.accessResource(uri, options);
          results.set(uri, result);
        } catch (error) {
          results.set(uri, error as Error);
        }
      });
      
      await Promise.all(promises);
    }
    
    return results;
  }

  /**
   * Check if a resource exists without fetching content
   */
  public async exists(uri: string, serverName?: string): Promise<boolean> {
    try {
      if (serverName) {
        const resources = await this.mcpClient.listResources(serverName);
        return resources.some(resource => resource.uri === uri);
      }
      const resolutions = await this.resolveUri(uri);
      return resolutions.some(resolution => resolution.exists);
    } catch (error) {
      logger.debug(`Error checking resource existence: ${uri}`, { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Get resource metadata without fetching full content
   */
  public async getMetadata(uri: string, catalog?: ResourceCatalog): Promise<CatalogEntry | undefined> {
    if (catalog) {
      return catalog.entries.find(entry => entry.resource.uri === uri);
    }

    // If no catalog, try to find the resource by listing from servers
    const connectedServers = this.mcpClient.getConnectedServers();
    
    for (const serverName of connectedServers) {
      try {
        const resources = await this.mcpClient.listResources(serverName);
        const resource = resources.find(r => r.uri === uri);
        
        if (resource) {
          return {
            resource,
            metadata: {
              uri: resource.uri,
              name: resource.name || undefined,
              description: resource.description || undefined,
              mimeType: resource.mimeType || undefined,
              serverName,
              discoveredAt: new Date(),
              permissions: { read: true, write: false, execute: false }
            }
          };
        }
      } catch (error) {
        logger.debug(`Failed to list resources from server ${serverName}`, { error: (error as Error).message });
      }
    }

    return undefined;
  }

  /**
   * Utility to add delay between retries
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Utility to chunk array for batch processing
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}