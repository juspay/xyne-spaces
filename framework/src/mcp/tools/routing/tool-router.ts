/**
 * Tool router that manages routing between framework and MCP tools
 */

import type { MCPClient } from '../../core/base/mcp-client.js';
import type { ToolRegistry } from '../../../tools/core/tool-registry.js';
import type { ToolMetadata, ToolSchemas } from '../../../tools/core/types/tool.js';
import type { JSONSchema } from '../../core/types/framework.js';
import type {
  MCPToolCatalog,
  MCPToolCatalogEntry,
  MCPToolRouterEntry,
  ToolIntegrationOptions,
  ToolIntegrationStats
} from '../types/index.js';
import { MCPToolAdapter } from '../adapters/tool-adapter.js';
import { ParameterMapper } from '../adapters/parameter-mapper.js';
import { logger } from '../../../utils/logger.js';

/**
 * Routes tool calls between framework and MCP tools
 */
export class ToolRouter {
  private readonly routingTable = new Map<string, MCPToolRouterEntry>();
  private readonly parameterMapper: ParameterMapper;
  
  constructor(
    private readonly mcpClient: MCPClient,
    private readonly frameworkRegistry: ToolRegistry,
    private readonly options: ToolIntegrationOptions = {}
  ) {
    this.parameterMapper = new ParameterMapper();
  }

  /**
   * Register MCP tools in the framework registry
   */
  public registerMCPTools(catalog: MCPToolCatalog): void {
    logger.info(`Registering ${catalog.totalCount} MCP tools in framework registry`);
    
    let registeredCount = 0;
    const errors: string[] = [];

    for (const entry of catalog.entries) {
      try {
        this.registerSingleTool(entry);
        registeredCount++;
      } catch (error) {
        const errorMsg = `Failed to register tool ${entry.tool.name}: ${(error as Error).message}`;
        errors.push(errorMsg);
        logger.warn(errorMsg);
      }
    }

    logger.info(`Successfully registered ${registeredCount}/${catalog.totalCount} MCP tools`);
    
    if (errors.length > 0) {
      logger.warn(`Registration errors encountered:`, { errors });
    }
  }

  /**
   * Register a single MCP tool in the framework
   */
  private registerSingleTool(catalogEntry: MCPToolCatalogEntry): void {
    const { tool, frameworkName, serverName } = catalogEntry;
    
    // Skip if tool is not available
    if (!catalogEntry.isAvailable) {
      throw new Error(`Tool '${tool.name}' is not available on server '${serverName}'`);
    }

    // Check if already registered
    if (this.frameworkRegistry.hasTool(frameworkName)) {
      if (this.options.autoRegister === false) {
        throw new Error(`Tool '${frameworkName}' is already registered in framework`);
      }
      // Unregister existing tool if auto-register is enabled
      this.frameworkRegistry.unregisterTool(frameworkName);
    }

    // Create tool metadata for framework
    const metadata: ToolMetadata = {
      name: frameworkName,
      description: tool.description || `MCP tool: ${tool.name}`,
      version: '1.0.0',
      tags: ['mcp', serverName, ...(this.extractTags(tool) || [])],
      category: this.mapCategory(tool, serverName)
    };

    // Adapt schemas
    const schemaResult = this.parameterMapper.adaptSchema(
      tool.inputSchema as JSONSchema | undefined,
      undefined // MCP tools don't typically define output schemas
    );

    if (!schemaResult.success) {
      throw new Error(`Schema adaptation failed: ${schemaResult.errors.join(', ')}`);
    }

    const schemas: ToolSchemas = {
      input: schemaResult.inputSchema,
      output: schemaResult.outputSchema
    };

    // Create tool adapter class
    const mcpClient = this.mcpClient;
    const options = this.options;
    const ToolAdapterClass = class extends MCPToolAdapter {
      constructor() {
        super(mcpClient, catalogEntry, {
          ...(options.enableParameterValidation && { timeout: 30000 }),
          retryCount: 3
        });
      }
    };

    // Register in framework
    this.frameworkRegistry.registerTool(metadata, schemas, ToolAdapterClass);

    // Add to routing table
    const routerEntry: MCPToolRouterEntry = {
      frameworkName,
      mcpToolName: tool.name,
      serverName,
      catalogEntry
    };
    
    this.routingTable.set(frameworkName, routerEntry);

    logger.debug(`Registered MCP tool: ${tool.name} -> ${frameworkName}`, {
      serverName,
      category: metadata.category,
      tags: metadata.tags
    });
  }

  /**
   * Unregister MCP tools from framework
   */
  public unregisterMCPTools(toolNames?: string[]): void {
    const toUnregister = toolNames || Array.from(this.routingTable.keys());
    
    for (const frameworkName of toUnregister) {
      try {
        const entry = this.routingTable.get(frameworkName);
        if (entry) {
          this.frameworkRegistry.unregisterTool(frameworkName);
          this.routingTable.delete(frameworkName);
          
          logger.debug(`Unregistered MCP tool: ${entry.mcpToolName} (${frameworkName})`);
        }
      } catch (error) {
        logger.warn(`Failed to unregister tool ${frameworkName}: ${(error as Error).message}`);
      }
    }
    
    logger.info(`Unregistered ${toUnregister.length} MCP tools from framework`);
  }

  /**
   * Refresh tool registrations
   */
  public refreshRegistrations(catalog: MCPToolCatalog): void {
    logger.info('Refreshing MCP tool registrations');
    
    // Get currently registered MCP tools
    const currentTools = new Set(this.routingTable.keys());
    
    // Get tools from new catalog
    const newTools = new Set(catalog.entries.map(entry => entry.frameworkName));
    
    // Find tools to unregister (no longer in catalog)
    const toUnregister = Array.from(currentTools).filter(name => !newTools.has(name));
    
    // Find tools to register (new in catalog)
    const toRegister = catalog.entries.filter(entry => !currentTools.has(entry.frameworkName));
    
    // Unregister removed tools
    if (toUnregister.length > 0) {
      this.unregisterMCPTools(toUnregister);
    }
    
    // Register new tools
    if (toRegister.length > 0) {
      const newCatalog: MCPToolCatalog = {
        entries: toRegister,
        totalCount: toRegister.length,
        serverCounts: {},
        lastUpdated: catalog.lastUpdated
      };
      this.registerMCPTools(newCatalog);
    }
    
    logger.info(`Tool registration refresh complete: ${toUnregister.length} removed, ${toRegister.length} added`);
  }

  /**
   * Get tool routing information
   */
  public getToolRoute(frameworkName: string): MCPToolRouterEntry | undefined {
    return this.routingTable.get(frameworkName);
  }

  /**
   * Get all registered MCP tools
   */
  public getMCPTools(): ReadonlyMap<string, MCPToolRouterEntry> {
    return new Map(this.routingTable);
  }

  /**
   * Get tools by server
   */
  public getToolsByServer(serverName: string): MCPToolRouterEntry[] {
    return Array.from(this.routingTable.values()).filter(
      entry => entry.serverName === serverName
    );
  }

  /**
   * Get integration statistics
   */
  public getStats(): ToolIntegrationStats {
    const categoryCounts: Record<string, number> = {};
    const servers = new Set<string>();
    
    for (const entry of this.routingTable.values()) {
      // Count by category
      const category = this.mapCategory(entry.catalogEntry.tool, entry.serverName);
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      
      // Count servers
      servers.add(entry.serverName);
    }
    
    return {
      totalMCPTools: this.routingTable.size,
      registeredTools: this.routingTable.size, // All routed tools are registered
      serverCount: servers.size,
      categoryCounts,
      lastIntegrationTime: new Date() // Would track actual integration time in real implementation
    };
  }

  /**
   * Check if a tool is an MCP tool
   */
  public isMCPTool(frameworkName: string): boolean {
    return this.routingTable.has(frameworkName);
  }

  /**
   * Extract tags from MCP tool
   */
  private extractTags(tool: MCPToolCatalogEntry['tool']): string[] | undefined {
    const tags: string[] = [];
    
    // Extract from description
    if (tool.description) {
      const tagMatches = tool.description.match(/#(\w+)/g);
      if (tagMatches) {
        tags.push(...tagMatches.map(tag => tag.substring(1).toLowerCase()));
      }
    }
    
    // Extract from tool name
    if (tool.name.includes('_')) {
      const nameParts = tool.name.split('_');
      if (nameParts.length > 1) {
        tags.push(...nameParts.slice(0, -1));
      }
    }
    
    return tags.length > 0 ? tags : undefined;
  }

  /**
   * Map MCP tool category to framework category
   */
  private mapCategory(tool: MCPToolCatalogEntry['tool'], serverName: string): string {
    // Check category mapping options
    if (this.options.categoryMapping) {
      for (const [mcpCategory, frameworkCategory] of Object.entries(this.options.categoryMapping)) {
        if (tool.description?.toLowerCase().includes(mcpCategory.toLowerCase()) ||
            tool.name.toLowerCase().includes(mcpCategory.toLowerCase())) {
          return frameworkCategory;
        }
      }
    }
    
    // Try to extract category from tool description
    if (tool.description) {
      const categoryKeywords = {
        'data': ['data', 'database', 'sql', 'json'],
        'api': ['api', 'http', 'request', 'client'],
        'system': ['system', 'terminal', 'command', 'process'],
        'file': ['file', 'read', 'write', 'directory'],
        'text': ['text', 'string', 'parse', 'format'],
        'search': ['search', 'find', 'query', 'grep']
      };
      
      const lowerDesc = tool.description.toLowerCase();
      for (const [category, keywords] of Object.entries(categoryKeywords)) {
        if (keywords.some(keyword => lowerDesc.includes(keyword))) {
          return category;
        }
      }
    }
    
    // Default to server-based category
    return `mcp-${serverName}`;
  }
}