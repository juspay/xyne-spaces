/**
 * Tool discovery for MCP servers
 */

import type { MCPClient } from '../../core/base/mcp-client.js';
import type { MCPTool } from '../../core/types/framework.js';
import type {
  ToolDiscoveryOptions,
  MCPToolCatalog,
  MCPToolCatalogEntry,
  MCPToolQuery
} from '../types/index.js';
import { MCPError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * Discovers and catalogs tools from MCP servers
 */
export class ToolDiscovery {
  constructor(private readonly mcpClient: MCPClient) {}

  /**
   * Discover all tools from all connected servers
   */
  public async discoverAll(options: ToolDiscoveryOptions = {}): Promise<MCPToolCatalog> {
    if (!this.mcpClient.isInitialized()) {
      throw new MCPError({
        type: 'VALIDATION_ERROR',
        message: 'MCP client must be initialized before discovering tools',
        severity: 'high',
        retryable: false,
        timestamp: new Date()
      });
    }

    const connectedServers = this.mcpClient.getConnectedServers();
    logger.info(`Discovering tools from ${connectedServers.length} servers`);

    const entries: MCPToolCatalogEntry[] = [];
    const serverCounts: Record<string, number> = {};

    // Apply server filter if specified
    const serversToQuery = options.serverFilter 
      ? connectedServers.filter(server => options.serverFilter!.includes(server))
      : connectedServers;

    // Discover tools from each server
    for (const serverName of serversToQuery) {
      try {
        const serverEntries = await this.discoverFromServer(serverName, options);
        entries.push(...serverEntries);
        serverCounts[serverName] = serverEntries.length;
        
        logger.debug(`Discovered ${serverEntries.length} tools from server: ${serverName}`);
      } catch (error) {
        logger.error(`Failed to discover tools from server ${serverName}`, error as Error);
        serverCounts[serverName] = 0;
        // Continue with other servers even if one fails
      }
    }

    const catalog: MCPToolCatalog = {
      entries,
      totalCount: entries.length,
      serverCounts,
      lastUpdated: new Date()
    };

    logger.info(`Tool discovery complete: ${catalog.totalCount} tools from ${serversToQuery.length} servers`);
    return catalog;
  }

  /**
   * Discover tools from a specific server
   */
  public async discoverFromServer(
    serverName: string,
    options: ToolDiscoveryOptions = {}
  ): Promise<MCPToolCatalogEntry[]> {
    try {
      logger.debug(`Discovering tools from server: ${serverName}`);
      
      // Get tools from the server
      const tools = await this.mcpClient.listTools(serverName);
      
      // Create catalog entries
      const entries: MCPToolCatalogEntry[] = [];
      const now = new Date();
      
      for (const tool of tools) {
        // Apply category filter if specified
        if (options.categoryFilter && tool.inputSchema?.properties?.['category']) {
          const toolCategory = this.extractCategory(tool);
          if (toolCategory && !options.categoryFilter.includes(toolCategory)) {
            continue;
          }
        }

        // Check if tool is available (basic validation)
        const isAvailable = this.isToolAvailable(tool);
        
        // Skip disabled tools unless explicitly requested
        if (!isAvailable && !options.includeDisabled) {
          continue;
        }

        const frameworkName = this.generateFrameworkName(tool, serverName);
        
        entries.push({
          tool,
          serverName,
          discoveredAt: now,
          isAvailable,
          frameworkName
        });
      }

      return entries;
    } catch (error) {
      throw new MCPError({
        type: 'SERVER_ERROR',
        message: `Failed to discover tools from server ${serverName}: ${(error as Error).message}`,
        severity: 'medium',
        retryable: true,
        serverName,
        timestamp: new Date(),
        originalError: error as Error
      });
    }
  }

  /**
   * Query tools with filtering
   */
  public queryTools(catalog: MCPToolCatalog, query: MCPToolQuery): MCPToolCatalogEntry[] {
    let results = [...catalog.entries];

    // Filter by server name
    if (query.serverName) {
      results = results.filter(entry => entry.serverName === query.serverName);
    }

    // Filter by tool name (exact match)
    if (query.toolName) {
      results = results.filter(entry => entry.tool.name === query.toolName);
    }

    // Filter by name pattern
    if (query.namePattern) {
      const pattern = new RegExp(query.namePattern, 'i');
      results = results.filter(entry => 
        pattern.test(entry.tool.name) || 
        pattern.test(entry.frameworkName)
      );
    }

    // Filter by category
    if (query.category) {
      results = results.filter(entry => {
        const toolCategory = this.extractCategory(entry.tool);
        return toolCategory === query.category;
      });
    }

    // Filter by availability
    if (query.isAvailable !== undefined) {
      results = results.filter(entry => entry.isAvailable === query.isAvailable);
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
   * Refresh tool availability status
   */
  public refreshAvailability(catalog: MCPToolCatalog): MCPToolCatalog {
    logger.info('Refreshing tool availability status');

    const updatedEntries: MCPToolCatalogEntry[] = [];

    for (const entry of catalog.entries) {
      try {
        // Check if server is still connected
        const serverStatus = this.mcpClient.getServerStatus(entry.serverName);
        const isServerHealthy = serverStatus && 'status' in serverStatus && serverStatus.status === 'connected';
        
        // Update availability based on server status
        const isAvailable = isServerHealthy && this.isToolAvailable(entry.tool);
        
        updatedEntries.push({
          ...entry,
          isAvailable: isAvailable ?? false
        });
      } catch (error) {
        logger.warn(`Failed to check availability for tool ${entry.tool.name} on server ${entry.serverName}`, 
          { error: (error as Error).message });
        
        // Mark as unavailable if we can't check
        updatedEntries.push({
          ...entry,
          isAvailable: false
        });
      }
    }

    return {
      ...catalog,
      entries: updatedEntries,
      lastUpdated: new Date()
    };
  }

  /**
   * Get tools by category
   */
  public getToolsByCategory(catalog: MCPToolCatalog, category: string): MCPToolCatalogEntry[] {
    return this.queryTools(catalog, { category });
  }

  /**
   * Get tools by server
   */
  public getToolsByServer(catalog: MCPToolCatalog, serverName: string): MCPToolCatalogEntry[] {
    return this.queryTools(catalog, { serverName });
  }

  /**
   * Check if a tool is available
   */
  private isToolAvailable(tool: MCPTool): boolean {
    // Basic validation - tool must have name and description
    if (!tool.name || !tool.description) {
      return false;
    }

    // Check if input schema is valid (if present)
    if (tool.inputSchema) {
      try {
        // Basic schema validation - must be an object
        if (typeof tool.inputSchema !== 'object' || tool.inputSchema === null) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Generate framework-compatible tool name
   */
  private generateFrameworkName(tool: MCPTool, serverName: string): string {
    // Create a unique name by combining server and tool name
    const cleanServerName = serverName.replace(/[^a-zA-Z0-9]/g, '_');
    const cleanToolName = tool.name.replace(/[^a-zA-Z0-9]/g, '_');
    
    return `mcp_${cleanServerName}_${cleanToolName}`;
  }

  /**
   * Extract category from tool schema
   */
  private extractCategory(tool: MCPTool): string | undefined {
    // Try to extract category from input schema properties
    if (tool.inputSchema?.properties?.['category']) {
      const categoryProp = tool.inputSchema.properties['category'];
      if (typeof categoryProp === 'object' && categoryProp !== null && 'default' in categoryProp) {
        return String(categoryProp.default);
      }
    }

    // Try to extract from description
    if (tool.description) {
      const categoryMatch = tool.description.match(/\[([^\]]+)\]/);
      if (categoryMatch?.[1]) {
        return categoryMatch[1].toLowerCase();
      }
    }

    return undefined;
  }
}