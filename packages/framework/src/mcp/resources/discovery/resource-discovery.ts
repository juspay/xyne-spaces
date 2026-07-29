/**
 * Resource discovery for MCP servers
 */

import type { MCPClient } from '../../core/base/mcp-client.js';
import type { MCPResource } from '../../core/types/framework.js';
import type { 
  ResourceCatalog, 
  ResourceMetadata, 
  CatalogEntry, 
  ResourceDiscoveryOptions, 
  ResourceQuery 
} from '../types/index.js';
import { MCPError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * Discovers and catalogs resources from MCP servers
 */
export class ResourceDiscovery {
  constructor(private readonly mcpClient: MCPClient) {}

  /**
   * Discover all resources from all connected servers
   */
  public async discoverAll(options: ResourceDiscoveryOptions = {}): Promise<ResourceCatalog> {
    if (!this.mcpClient.isInitialized()) {
      throw new MCPError({
        type: 'VALIDATION_ERROR',
        message: 'MCP client must be initialized before discovering resources',
        severity: 'high',
        retryable: false,
        timestamp: new Date()
      });
    }

    const connectedServers = this.mcpClient.getConnectedServers();
    logger.info(`Discovering resources from ${connectedServers.length} servers`);

    const entries: CatalogEntry[] = [];
    const serverCounts: Record<string, number> = {};

    // Discover resources from each server
    for (const serverName of connectedServers) {
      try {
        const serverEntries = await this.discoverFromServer(serverName, options);
        entries.push(...serverEntries);
        serverCounts[serverName] = serverEntries.length;
        
        logger.debug(`Discovered ${serverEntries.length} resources from server: ${serverName}`);
      } catch (error) {
        logger.error(`Failed to discover resources from server ${serverName}`, error as Error);
        serverCounts[serverName] = 0;
        // Continue with other servers even if one fails
      }
    }

    const catalog: ResourceCatalog = {
      entries,
      totalCount: entries.length,
      serverCounts,
      lastUpdated: new Date()
    };

    logger.info(`Resource discovery complete: ${catalog.totalCount} resources from ${connectedServers.length} servers`);
    return catalog;
  }

  /**
   * Discover resources from a specific server
   */
  public async discoverFromServer(
    serverName: string, 
    options: ResourceDiscoveryOptions = {}
  ): Promise<CatalogEntry[]> {
    try {
      // Get resources from the server
      const resources = await this.mcpClient.listResources(serverName);
      
      // Create catalog entries with metadata
      const entries: CatalogEntry[] = [];
      
      for (const resource of resources) {
        try {
          const metadata = await this.createResourceMetadata(resource, serverName, options);
          entries.push({
            resource,
            metadata
          });
        } catch (error) {
          logger.warn(`Failed to create metadata for resource ${resource.uri}`, { error: (error as Error).message });
          // Include resource without extended metadata
          entries.push({
            resource,
            metadata: {
              uri: resource.uri,
              name: resource.name || undefined,
              description: resource.description || undefined,
              mimeType: resource.mimeType || undefined,
              serverName,
              discoveredAt: new Date()
            }
          });
        }
      }

      return entries;
    } catch (error) {
      throw new MCPError({
        type: 'SERVER_ERROR',
        message: `Failed to discover resources from server ${serverName}: ${(error as Error).message}`,
        severity: 'medium',
        retryable: true,
        serverName,
        timestamp: new Date(),
        originalError: error as Error
      });
    }
  }

  /**
   * Query resources with filtering
   */
  public queryResources(catalog: ResourceCatalog, query: ResourceQuery): CatalogEntry[] {
    let results = [...catalog.entries];

    // Filter by server name
    if (query.serverName) {
      results = results.filter(entry => 
        entry.metadata.serverName === query.serverName
      );
    }

    // Filter by URI pattern
    if (query.uriPattern) {
      const pattern = new RegExp(query.uriPattern, 'i');
      results = results.filter(entry => 
        pattern.test(entry.metadata.uri)
      );
    }

    // Filter by MIME type
    if (query.mimeType) {
      results = results.filter(entry => 
        entry.metadata.mimeType === query.mimeType
      );
    }

    // Filter by name pattern
    if (query.namePattern && query.namePattern.length > 0) {
      const pattern = new RegExp(query.namePattern, 'i');
      results = results.filter(entry => {
        const name = entry.metadata.name || entry.resource.name || '';
        return pattern.test(name);
      });
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      results = results.filter(entry => {
        const resourceTags = entry.metadata.tags || [];
        return query.tags!.some(tag => resourceTags.includes(tag));
      });
    }

    // Apply pagination
    const offset = query.offset || 0;
    const limit = query.limit;

    if (limit !== undefined) {
      results = results.slice(offset, offset + limit);
    } else if (offset > 0) {
      results = results.slice(offset);
    }

    return results;
  }

  /**
   * Create enhanced metadata for a resource
   */
  private async createResourceMetadata(
    resource: MCPResource, 
    serverName: string,
    options: ResourceDiscoveryOptions
  ): Promise<ResourceMetadata> {
    let metadata: Partial<ResourceMetadata> = {
      uri: resource.uri,
      name: resource.name || undefined,
      description: resource.description || undefined,
      mimeType: resource.mimeType || undefined,
      serverName,
      discoveredAt: new Date(),
      permissions: {
        read: true, // Assume readable if listed
        write: false, // Conservative default
        execute: false
      }
    };

    // Add extended metadata if requested
    if (options.includeMetadata) {
      try {
        // Try to get additional metadata by reading the resource
        // This is optional and may fail for some resource types
        const resourceContent = await this.mcpClient.readResource(resource.uri, serverName);
        
        // Extract size if available
        if (typeof resourceContent.contents === 'string') {
          metadata = { ...metadata, size: new TextEncoder().encode(resourceContent.contents).length };
        } else if (Array.isArray(resourceContent.contents)) {
          // For multi-part content, sum up sizes
          let totalSize = 0;
          for (const content of resourceContent.contents) {
            if ('text' in content && typeof content.text === 'string') {
              totalSize += new TextEncoder().encode(content.text).length;
            }
          }
          if (totalSize > 0) {
            metadata = { ...metadata, size: totalSize };
          }
        }

        // Parse tags from description or name
        const description = resource.description || '';
        const name = resource.name || '';
        const tags = this.extractTags(description, name);
        if (tags && tags.length > 0) {
          metadata = { ...metadata, tags };
        }

      } catch (error) {
        // Extended metadata is optional, continue without it
        logger.debug(`Could not retrieve extended metadata for ${resource.uri}`, { error: (error as Error).message });
      }
    }

    return metadata as ResourceMetadata;
  }

  /**
   * Extract tags from text content
   */
  private extractTags(description: string, name: string): string[] {
    const tags = new Set<string>();
    
    // Extract hashtags from description
    const hashtagMatches = description.match(/#\w+/g);
    if (hashtagMatches) {
      hashtagMatches.forEach(tag => tags.add(tag.substring(1).toLowerCase()));
    }

    // Extract file extension as tag
    const extensionMatch = name.match(/\.(\w+)$/);
    if (extensionMatch && extensionMatch[1]) {
      tags.add(extensionMatch[1].toLowerCase());
    }

    // Extract common keywords
    const keywords = ['config', 'data', 'log', 'temp', 'cache', 'backup'];
    const lowerName = name.toLowerCase();
    const lowerDesc = description.toLowerCase();
    
    keywords.forEach(keyword => {
      if (lowerName.includes(keyword) || lowerDesc.includes(keyword)) {
        tags.add(keyword);
      }
    });

    return Array.from(tags);
  }
}