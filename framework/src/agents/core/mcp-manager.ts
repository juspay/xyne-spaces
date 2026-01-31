/**
 * Agent MCP Manager - handles MCP server connections and tool integration for Agent module
 */

import type { MCPClient } from '../../mcp/core/base/mcp-client.js';
import type { MCPConfig } from '../../mcp/core/types/config.js';
import type { ToolIntegrationManager } from '../../mcp/tools/manager/tool-integration-manager.js';
import type { ToolRegistry } from '../../tools/core/tool-registry.js';
import type { 
  MCPServerDetails, 
  MCPToolDescription, 
  MCPServerStatus,
  AgentMCPConfig 
} from './mcp-types.js';
import { MCPConfigLoader } from '../../mcp/config/config-loader.js';
import { MCPClient as MCPClientImpl } from '../../mcp/core/base/mcp-client.js';
import { ToolIntegrationManager as ToolIntegrationManagerImpl } from '../../mcp/tools/manager/tool-integration-manager.js';
import { logger } from '../../utils/logger.js';

/**
 * Manages MCP connections and tool integration for the Agent module
 */
export class AgentMCPManager {
  private mcpClient: MCPClient | undefined;
  private toolIntegrationManager: ToolIntegrationManager | undefined;
  private mcpConfig: MCPConfig | undefined;
  private initialized = false;

  constructor(
    private readonly frameworkRegistry: ToolRegistry,
    private readonly config: AgentMCPConfig
  ) {}

  /**
   * Initialize MCP manager with sync or async connection mode
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Agent MCP manager is already initialized');
      return;
    }

    logger.info('Initializing Agent MCP manager');

    try {
      // Load MCP configuration
      await this.loadMCPConfig();

      if (!this.mcpConfig || !this.mcpConfig.mcpServers || Object.keys(this.mcpConfig.mcpServers).length === 0) {
        logger.info('No MCP servers configured, skipping MCP initialization');
        this.initialized = true;
        return;
      }

      // Initialize MCP client
      this.mcpClient = new MCPClientImpl(this.mcpConfig);

      // Initialize tool integration manager
      this.toolIntegrationManager = new ToolIntegrationManagerImpl(
        this.mcpClient,
        this.frameworkRegistry,
        {
          integration: {
            autoRegister: true,
            namePrefix: 'mcp_'
          }
        }
      );

      // Initialize connections with timeout
      await this.initializeConnections();

      this.initialized = true;
      
      // Log MCP tool registration stats
      const toolStats = this.toolIntegrationManager?.getStats();
      logger.info('Agent MCP manager initialized successfully', {
        registeredTools: toolStats?.registeredTools || 0,
        serverCount: toolStats?.serverCount || 0,
        mcpToolsAvailable: this.hasMCPTools()
      });

    } catch (error) {
      logger.error('Failed to initialize Agent MCP manager', error as Error);
      throw error;
    }
  }

  /**
   * Shutdown MCP manager
   */
  public async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    logger.info('Shutting down Agent MCP manager');

    try {
      // Shutdown components
      if (this.toolIntegrationManager) {
        this.toolIntegrationManager.shutdown();
      }

      if (this.mcpClient) {
        await this.mcpClient.shutdown();
      }

      this.initialized = false;
      logger.info('Agent MCP manager shutdown complete');

    } catch (error) {
      logger.error('Error during Agent MCP manager shutdown', error as Error);
      throw error;
    }
  }

  /**
   * Get all MCP server status information
   */
  public getAllMCPStatus(): MCPServerStatus[] {
    if (!this.mcpClient || !this.mcpConfig) {
      return [];
    }

    const serverNames = Object.keys(this.mcpConfig.mcpServers || {});
    return serverNames.map(name => {
      const status = this.mcpClient!.getServerStatus(name);
      let mappedStatus: 'connecting' | 'connected' | 'failed' | 'disconnected' = 'disconnected';
      
      if (status?.status === 'error') {
        mappedStatus = 'failed';
      } else if (status?.status === 'connected') {
        mappedStatus = 'connected';
      } else if (status?.status === 'connecting') {
        mappedStatus = 'connecting';
      }
      
      return {
        name,
        status: mappedStatus,
        ...(status?.connectedAt && { connectedAt: status.connectedAt }),
        ...(status?.lastError && { lastError: status.lastError }),
        ...(status?.lastPingAt && { lastPingAt: status.lastPingAt })
      };
    });
  }

  /**
   * Get detailed information about a specific MCP server
   */
  public getMCPDetails(mcpName: string): MCPServerDetails | undefined {
    if (!this.mcpConfig || !this.mcpConfig.mcpServers) {
      return undefined;
    }

    const serverConfig = this.mcpConfig.mcpServers[mcpName];
    if (!serverConfig) {
      return undefined;
    }

    const status = this.mcpClient?.getServerStatus(mcpName);
    
    // Get tools for this server
    let tools: Array<{ name: string; frameworkName: string; description: string; }> = [];
    if (this.toolIntegrationManager && status?.status === 'connected') {
      try {
        const toolEntries = this.toolIntegrationManager.getToolsByServer(mcpName);
        tools = toolEntries.map(entry => ({
          name: entry.tool.name,
          frameworkName: entry.frameworkName,
          description: entry.tool.description || 'No description available'
        }));
      } catch (error) {
        logger.warn(`Failed to get tools for server ${mcpName}`, { error: (error as Error).message });
      }
    }

    // Determine config source
    const configSource = this.determineConfigSource(mcpName);

    let mappedStatus: 'connecting' | 'connected' | 'failed' | 'disconnected' = 'disconnected';
    
    if (status?.status === 'error') {
      mappedStatus = 'failed';
    } else if (status?.status === 'connected') {
      mappedStatus = 'connected';
    } else if (status?.status === 'connecting') {
      mappedStatus = 'connecting';
    }

    return {
      name: mcpName,
      status: mappedStatus,
      config: {
        command: 'command' in serverConfig ? serverConfig.command : '',
        ...(('args' in serverConfig && serverConfig.args) && { args: serverConfig.args as string[] }),
        ...(('env' in serverConfig && serverConfig.env) && { env: serverConfig.env }),
        ...(('cwd' in serverConfig && serverConfig.cwd) && { cwd: serverConfig.cwd }),
        ...(('timeout' in serverConfig && serverConfig.timeout) && { timeout: serverConfig.timeout }),
        ...(('retryCount' in serverConfig && serverConfig.retryCount) && { retryCount: serverConfig.retryCount }),
        ...(('retryDelay' in serverConfig && serverConfig.retryDelay) && { retryDelay: serverConfig.retryDelay })
      },
      configSource,
      configPath: this.getConfigPath(configSource),
      ...(status?.connectedAt && { connectedAt: status.connectedAt }),
      ...(status?.lastError && { lastError: status.lastError }),
      ...(status?.lastPingAt && { lastPingAt: status.lastPingAt }),
      tools
    };
  }

  /**
   * Get detailed tool description for a specific MCP tool
   */
  public getMCPToolDescription(mcpName: string, toolName: string): MCPToolDescription | undefined {
    if (!this.toolIntegrationManager || !this.mcpClient) {
      return undefined;
    }

    try {
      // Find the tool in the catalog
      const toolEntries = this.toolIntegrationManager.getToolsByServer(mcpName);
      const toolEntry = toolEntries.find(entry => 
        entry.tool.name === toolName || entry.frameworkName === toolName
      );

      if (!toolEntry) {
        return undefined;
      }

      const serverStatus = this.mcpClient.getServerStatus(mcpName);
      let mappedServerStatus: 'connecting' | 'connected' | 'failed' | 'disconnected' = 'disconnected';
      
      if (serverStatus?.status === 'error') {
        mappedServerStatus = 'failed';
      } else if (serverStatus?.status === 'connected') {
        mappedServerStatus = 'connected';
      } else if (serverStatus?.status === 'connecting') {
        mappedServerStatus = 'connecting';
      }

      const result: MCPToolDescription = {
        name: toolEntry.tool.name,
        frameworkName: toolEntry.frameworkName,
        description: toolEntry.tool.description || 'No description available',
        serverName: mcpName,
        serverStatus: mappedServerStatus,
        isAvailable: toolEntry.isAvailable
      };

      // Add optional properties only if they exist
      if (toolEntry.tool.inputSchema) {
        result.inputSchema = {
          type: toolEntry.tool.inputSchema.type,
          ...(toolEntry.tool.inputSchema.properties && { properties: toolEntry.tool.inputSchema.properties }),
          ...(toolEntry.tool.inputSchema.required && { required: toolEntry.tool.inputSchema.required }),
          ...(typeof toolEntry.tool.inputSchema['additionalProperties'] === 'boolean' && { additionalProperties: toolEntry.tool.inputSchema['additionalProperties'] })
        };
      }

      return result;

    } catch (error) {
      logger.error(`Failed to get tool description for ${mcpName}:${toolName}`, error as Error);
      return undefined;
    }
  }

  /**
   * Check if MCP manager is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if any MCP tools are available
   */
  public hasMCPTools(): boolean {
    if (!this.toolIntegrationManager) {
      return false;
    }

    const stats = this.toolIntegrationManager.getStats();
    return stats.registeredTools > 0;
  }

  /**
   * Wait for MCP connections to complete
   * This method is a no-op since connections are now handled synchronously in initialize()
   */
  public async waitForConnections(): Promise<void> {
    // No-op: connections are handled synchronously in initialize()
  }

  /**
   * Load MCP configuration from local/global paths
   */
  private async loadMCPConfig(): Promise<void> {
    const options: { localPath?: string; globalPath?: string } = {};
    if (this.config.localPath) {
      options.localPath = this.config.localPath;
    }
    if (this.config.globalPath) {
      options.globalPath = this.config.globalPath;
    }

    try {
      const configLoader = new MCPConfigLoader(options);
      const configResult = await configLoader.loadConfig();
      
      if (!configResult.success || !configResult.config) {
        // Check if the error is just missing config files or empty server config
        const isMissingFiles = configResult.errors?.some(error => 
          error.includes('Configuration file not found') || 
          error.includes('No configuration paths provided')
        );
        
        const isEmptyServerConfig = configResult.errors?.some(error => 
          error.includes('At least one MCP server must be configured')
        );
        
        if (isMissingFiles || isEmptyServerConfig) {
          logger.info('No MCP servers configured, skipping MCP setup', {
            localPath: this.config.localPath,
            globalPath: this.config.globalPath,
            reason: isMissingFiles ? 'missing config files' : 'no servers configured'
          });
          this.mcpConfig = undefined;
          return;
        }
        
        throw new Error(`Failed to load MCP configuration: ${configResult.errors?.join(', ') || 'Unknown error'}`);
      }
      
      this.mcpConfig = configResult.config;
      
      // Check if config loaded successfully but has no servers
      const serverCount = Object.keys(this.mcpConfig.mcpServers || {}).length;
      if (serverCount === 0) {
        logger.info('MCP configuration loaded but no servers configured, skipping MCP setup', {
          serverCount: 0,
          hasLocalPath: Boolean(this.config.localPath),
          hasGlobalPath: Boolean(this.config.globalPath)
        });
        this.mcpConfig = undefined;
        return;
      }
      
      logger.info('MCP configuration loaded', {
        serverCount,
        hasLocalPath: Boolean(this.config.localPath),
        hasGlobalPath: Boolean(this.config.globalPath)
      });
    } catch (error) {
      // Check if it's a file not found error
      if (error instanceof Error && error.message.includes('Configuration file not found')) {
        logger.info('MCP configuration file not found, skipping MCP setup', {
          error: error.message,
          localPath: this.config.localPath,
          globalPath: this.config.globalPath
        });
        this.mcpConfig = undefined;
        return;
      }
      
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Initialize MCP connections with timeout
   */
  private async initializeConnections(): Promise<void> {
    if (!this.mcpClient || !this.toolIntegrationManager) {
      throw new Error('MCP client or tool integration manager not initialized');
    }

    const timeout = this.config.connectionTimeout || 30000;
    
    logger.info('Starting MCP connections', { timeout });

    // Initialize MCP client and wait for connections
    await Promise.race([
      this.mcpClient.initialize(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('MCP initialization timeout')), timeout)
      )
    ]);

    // Initialize tool integration
    await this.toolIntegrationManager.initialize();

    logger.info('MCP connections established');
  }


  /**
   * Determine if server config came from local or global path
   */
  private determineConfigSource(_serverName: string): 'local' | 'global' {
    // This is a simplified implementation - in reality, we'd need to track
    // which config file each server came from during the merge process
    // For now, we'll return 'local' if local path is configured, otherwise 'global'
    return this.config.localPath ? 'local' : 'global';
  }

  /**
   * Get the config path based on source
   */
  private getConfigPath(source: 'local' | 'global'): string {
    if (source === 'local' && this.config.localPath) {
      return this.config.localPath;
    }
    if (source === 'global' && this.config.globalPath) {
      return this.config.globalPath;
    }
    return 'unknown';
  }
}