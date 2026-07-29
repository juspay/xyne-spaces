/**
 * Tool integration manager that orchestrates MCP tool discovery, adaptation, and registration
 */

import type { MCPClient } from '../../core/base/mcp-client.js';
import type { ToolRegistry } from '../../../tools/core/tool-registry.js';
import type {
  ToolIntegrationManagerOptions,
  MCPToolCatalog,
  ToolIntegrationStats,
  MCPToolQuery,
  MCPToolCatalogEntry,
  MCPToolRouterEntry
} from '../types/index.js';
import { ToolDiscovery } from '../discovery/tool-discovery.js';
import { ToolRouter } from '../routing/tool-router.js';
import { MCPError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * Manages the complete integration of MCP tools with the framework tool system
 */
export class ToolIntegrationManager {
  private readonly discovery: ToolDiscovery;
  private readonly router: ToolRouter;
  
  private currentCatalog: MCPToolCatalog | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private initialized = false;

  constructor(
    private readonly mcpClient: MCPClient,
    private readonly frameworkRegistry: ToolRegistry,
    private readonly options: ToolIntegrationManagerOptions = {}
  ) {
    this.discovery = new ToolDiscovery(mcpClient);
    this.router = new ToolRouter(mcpClient, frameworkRegistry, options.integration);
  }

  /**
   * Initialize the tool integration manager
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Tool integration manager is already initialized');
      return;
    }

    logger.info('Initializing tool integration manager');

    if (!this.mcpClient.isInitialized()) {
      throw new MCPError({
        type: 'VALIDATION_ERROR',
        message: 'MCP client must be initialized before tool integration manager',
        severity: 'high',
        retryable: false,
        timestamp: new Date()
      });
    }

    try {
      // Discover all available tools
      await this.discoverAndIntegrateTools();

      // Set up auto-refresh if enabled
      if (this.options.autoRefresh) {
        this.setupAutoRefresh();
      }

      this.initialized = true;
      logger.info('Tool integration manager initialized successfully', {
        toolCount: this.currentCatalog?.totalCount || 0,
        serverCount: Object.keys(this.currentCatalog?.serverCounts || {}).length,
        autoRefresh: Boolean(this.options.autoRefresh)
      });
    } catch (error) {
      logger.error('Failed to initialize tool integration manager', error as Error);
      throw new MCPError({
        type: 'VALIDATION_ERROR',
        message: `Tool integration manager initialization failed: ${(error as Error).message}`,
        severity: 'high',
        retryable: true,
        timestamp: new Date(),
        originalError: error as Error
      });
    }
  }

  /**
   * Shutdown the tool integration manager
   */
  public shutdown(): void {
    logger.info('Shutting down tool integration manager');

    // Clear refresh timer
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    // Unregister all MCP tools
    try {
      this.router.unregisterMCPTools();
    } catch (error) {
      logger.warn('Error during tool unregistration on shutdown', { error: (error as Error).message });
    }

    this.initialized = false;
    this.currentCatalog = undefined;

    logger.info('Tool integration manager shutdown complete');
  }

  /**
   * Discover and integrate all MCP tools
   */
  public async discoverAndIntegrateTools(): Promise<MCPToolCatalog> {
    logger.info('Starting tool discovery and integration');

    try {
      // Discover all tools
      const catalog = await this.discovery.discoverAll(this.options.discovery);
      
      // Store current catalog
      this.currentCatalog = catalog;
      
      // Register tools in framework if auto-register is enabled
      if (this.options.integration?.autoRegister !== false) {
        this.router.registerMCPTools(catalog);
      }

      logger.info(`Tool discovery and integration complete: ${catalog.totalCount} tools from ${Object.keys(catalog.serverCounts).length} servers`);
      
      return catalog;
    } catch (error) {
      logger.error('Tool discovery and integration failed', error as Error);
      throw error;
    }
  }

  /**
   * Refresh tool integration
   */
  public async refresh(): Promise<void> {
    if (!this.initialized) {
      throw new MCPError({
        type: 'VALIDATION_ERROR',
        message: 'Tool integration manager must be initialized before refresh',
        severity: 'medium',
        retryable: true,
        timestamp: new Date()
      });
    }

    logger.info('Refreshing tool integration');

    try {
      // Discover current tools
      const newCatalog = await this.discovery.discoverAll(this.options.discovery);
      
      // Refresh tool availability in current catalog
      if (this.currentCatalog) {
        this.currentCatalog = this.discovery.refreshAvailability(this.currentCatalog);
      }
      
      // Update registrations
      this.router.refreshRegistrations(newCatalog);
      
      // Update current catalog
      this.currentCatalog = newCatalog;
      
      logger.info('Tool integration refresh complete');
    } catch (error) {
      logger.error('Tool integration refresh failed', error as Error);
      throw error;
    }
  }

  /**
   * Get the current tool catalog
   */
  public getCatalog(): MCPToolCatalog | undefined {
    return this.currentCatalog;
  }

  /**
   * Query tools with filtering
   */
  public queryTools(query: MCPToolQuery): MCPToolCatalogEntry[] {
    if (!this.currentCatalog) {
      throw new MCPError({
        type: 'VALIDATION_ERROR',
        message: 'No tools discovered yet. Call discoverAndIntegrateTools() first.',
        severity: 'medium',
        retryable: true,
        timestamp: new Date()
      });
    }

    return this.discovery.queryTools(this.currentCatalog, query);
  }

  /**
   * Get tools by server
   */
  public getToolsByServer(serverName: string): MCPToolCatalogEntry[] {
    return this.queryTools({ serverName });
  }

  /**
   * Get tools by category
   */
  public getToolsByCategory(category: string): MCPToolCatalogEntry[] {
    return this.queryTools({ category });
  }

  /**
   * Search tools by name pattern
   */
  public searchTools(namePattern: string): MCPToolCatalogEntry[] {
    return this.queryTools({ namePattern });
  }

  /**
   * Get available tools only
   */
  public getAvailableTools(): MCPToolCatalogEntry[] {
    return this.queryTools({ isAvailable: true });
  }

  /**
   * Get integration statistics
   */
  public getStats(): ToolIntegrationStats {
    const routerStats = this.router.getStats();
    
    return {
      totalMCPTools: this.currentCatalog?.totalCount || 0,
      registeredTools: routerStats.registeredTools,
      serverCount: Object.keys(this.currentCatalog?.serverCounts || {}).length,
      categoryCounts: routerStats.categoryCounts,
      lastDiscoveryTime: this.currentCatalog?.lastUpdated || new Date(),
      lastIntegrationTime: routerStats.lastIntegrationTime || new Date()
    };
  }

  /**
   * Check if a tool is an MCP tool
   */
  public isMCPTool(frameworkName: string): boolean {
    return this.router.isMCPTool(frameworkName);
  }

  /**
   * Get MCP tool routing information
   */
  public getToolRoute(frameworkName: string): MCPToolRouterEntry | undefined {
    return this.router.getToolRoute(frameworkName);
  }

  /**
   * Force re-registration of all tools
   */
  public reregisterAllTools(): void {
    if (!this.currentCatalog) {
      throw new MCPError({
        type: 'VALIDATION_ERROR',
        message: 'No tools to re-register. Discover tools first.',
        severity: 'medium',
        retryable: true,
        timestamp: new Date()
      });
    }

    logger.info('Re-registering all MCP tools');

    // Unregister all current tools
    this.router.unregisterMCPTools();

    // Re-register all tools
    this.router.registerMCPTools(this.currentCatalog);

    logger.info('All MCP tools re-registered successfully');
  }

  /**
   * Get framework registry instance
   */
  public getFrameworkRegistry(): ToolRegistry {
    return this.frameworkRegistry;
  }

  /**
   * Check if manager is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get failed tool registrations
   */
  public getFailedRegistrations(): MCPToolCatalogEntry[] {
    if (!this.currentCatalog) {
      return [];
    }

    return this.currentCatalog.entries.filter(entry => {
      // Check if tool should be registered but isn't
      if (entry.isAvailable && this.options.integration?.autoRegister !== false) {
        return !this.frameworkRegistry.hasTool(entry.frameworkName);
      }
      return false;
    });
  }

  /**
   * Retry failed registrations
   */
  public retryFailedRegistrations(): void {
    const failedRegistrations = this.getFailedRegistrations();
    
    if (failedRegistrations.length === 0) {
      logger.info('No failed registrations to retry');
      return;
    }

    logger.info(`Retrying ${failedRegistrations.length} failed tool registrations`);

    const failedCatalog: MCPToolCatalog = {
      entries: failedRegistrations,
      totalCount: failedRegistrations.length,
      serverCounts: {},
      lastUpdated: new Date()
    };

    this.router.registerMCPTools(failedCatalog);
  }

  /**
   * Setup automatic refresh
   */
  private setupAutoRefresh(): void {
    const interval = this.options.refreshInterval || 300000; // 5 minutes default
    
    logger.info(`Setting up auto-refresh every ${interval}ms`);
    
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((error) => {
        logger.error('Auto-refresh failed', error as Error);
      });
    }, interval);
  }
}
