import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { 
  CallToolResult,
  GetPromptResult,
  ReadResourceResult
} from '@modelcontextprotocol/sdk/types.js';
import type { MCPConfig, MCPServerConfig } from '../types/config.js';
import type { 
  MCPServerConnection, 
  MCPServerStatus, 
  MCPResource,
  MCPTool,
  MCPPrompt
} from '../types/framework.js';
import { MCPError } from '../errors/index.js';
import { McpTransportFactory } from '../../transports/transport-factory.js';
import { logger } from '../../../utils/logger.js';

/**
 * MCP client implementation using the official SDK
 */
export class MCPClient {
  protected config: MCPConfig;
  protected clients: Map<string, Client> = new Map();
  protected connections: Map<string, MCPServerConnection> = new Map();
  protected initialized = false;

  constructor(config: MCPConfig) {
    this.config = config;
  }

  /**
   * Initialize the MCP client and connect to configured servers
   */
  public async initialize(): Promise<void> {
    logger.info('Initializing MCP client');
    
    try {
      await this.connectToServers();
      this.initialized = true;
      
      logger.info('MCP client initialized successfully', {
        serverCount: this.connections.size
      });
    } catch (error) {
      logger.error('Failed to initialize MCP client', error as Error);
      throw error;
    }
  }

  /**
   * Shutdown the MCP client and disconnect from all servers
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down MCP client');
    
    try {
      await this.disconnectFromServers();
      this.initialized = false;
      
      logger.info('MCP client shutdown successfully');
    } catch (error) {
      logger.error('Error during MCP client shutdown', error as Error);
      throw error;
    }
  }

  /**
   * Check if client is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get list of connected servers
   */
  public getConnectedServers(): readonly string[] {
    return Array.from(this.connections.keys()).filter(name => 
      this.connections.get(name)?.status === 'connected'
    );
  }

  /**
   * Get server connection status
   */
  public getServerStatus(serverName: string): MCPServerStatus | undefined {
    const connection = this.connections.get(serverName);
    if (!connection) {
      return undefined;
    }
    return {
      status: connection.status,
      ...(connection.lastError && { lastError: connection.lastError }),
      ...(connection.connectedAt && { connectedAt: connection.connectedAt }),
      ...(connection.lastPingAt && { lastPingAt: connection.lastPingAt })
    };
  }

  /**
   * Get all server connections
   */
  public getAllServerConnections(): readonly MCPServerConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * List available resources from a server
   */
  public async listResources(serverName?: string): Promise<MCPResource[]> {
    this.ensureInitialized();
    
    try {
      if (serverName) {
        this.ensureServerConnected(serverName);
        const client = this.clients.get(serverName);
        if (!client) {
          throw new MCPError({
            type: 'CONNECTION_ERROR',
            severity: 'high',
            message: `No client found for server '${serverName}'`,
            serverName,
            timestamp: new Date(),
            retryable: false
          });
        }
        const result = await client.listResources();
        return result.resources;
      }
      
      // Aggregate resources from all connected servers
      const allResources: MCPResource[] = [];
      for (const [name, client] of this.clients) {
        if (this.connections.get(name)?.status === 'connected') {
          const result = await client.listResources();
          allResources.push(...result.resources);
        }
      }
      return allResources;
    } catch (error) {
      logger.error('Failed to list resources', error as Error, { serverName });
      throw error;
    }
  }

  /**
   * Read resource content from a server
   */
  public async readResource(uri: string, serverName?: string): Promise<ReadResourceResult> {
    this.ensureInitialized();
    
    try {
      if (serverName) {
        this.ensureServerConnected(serverName);
        const client = this.clients.get(serverName);
        if (!client) {
          throw new MCPError({
            type: 'CONNECTION_ERROR',
            severity: 'high',
            message: `No client found for server '${serverName}'`,
            serverName,
            timestamp: new Date(),
            retryable: false
          });
        }
        return await client.readResource({ uri });
      }
      
      // Try to find the resource on any connected server
      let lastError: Error | undefined;
      for (const [name, client] of this.clients) {
        if (this.connections.get(name)?.status === 'connected') {
          try {
            return await client.readResource({ uri });
          } catch (error) {
            lastError = error as Error;
            continue;
          }
        }
      }
      throw lastError || new MCPError({
          type: 'RESOURCE_ERROR',
          severity: 'medium',
          message: `Resource not found: ${uri}`,
          timestamp: new Date(),
          retryable: false
        });
      
    } catch (error) {
      logger.error('Failed to read resource', error as Error, { uri });
      throw error;
    }
  }

  /**
   * List available tools from a server
   */
  public async listTools(serverName?: string): Promise<MCPTool[]> {
    this.ensureInitialized();
    
    try {
      if (serverName) {
        this.ensureServerConnected(serverName);
        const client = this.clients.get(serverName);
        if (!client) {
          throw new MCPError({
            type: 'CONNECTION_ERROR',
            severity: 'high',
            message: `No client found for server '${serverName}'`,
            serverName,
            timestamp: new Date(),
            retryable: false
          });
        }
        const result = await client.listTools();
        return result.tools;
      }
      
      // Aggregate tools from all connected servers
      const allTools: MCPTool[] = [];
      for (const [name, client] of this.clients) {
        if (this.connections.get(name)?.status === 'connected') {
          const result = await client.listTools();
          allTools.push(...result.tools);
        }
      }
      return allTools;
      
    } catch (error) {
      logger.error('Failed to list tools', error as Error, { serverName });
      throw error;
    }
  }

  /**
   * Call a tool on a server
   */
  public async callTool(
    serverName: string, 
    name: string,
    args?: Record<string, unknown>
  ): Promise<CallToolResult> {
    this.ensureInitialized();
    this.ensureServerConnected(serverName);
    
    try {
      const client = this.clients.get(serverName);
      if (!client) {
        throw new MCPError({
          type: 'CONNECTION_ERROR',
          severity: 'high',
          message: `No client found for server '${serverName}'`,
          serverName,
          timestamp: new Date(),
          retryable: false
        });
      }
      
      const result = await client.callTool({ name, arguments: args as Record<string, string> });
      return result as CallToolResult;
    } catch (error) {
      logger.error('Failed to call tool', error as Error, { 
        serverName, 
        toolName: name 
      });
      throw error;
    }
  }

  /**
   * List available prompts from a server
   */
  public async listPrompts(serverName?: string): Promise<MCPPrompt[]> {
    this.ensureInitialized();
    
    try {
      if (serverName) {
        this.ensureServerConnected(serverName);
        const client = this.clients.get(serverName);
        if (!client) {
          throw new MCPError({
            type: 'CONNECTION_ERROR',
            severity: 'high',
            message: `No client found for server '${serverName}'`,
            serverName,
            timestamp: new Date(),
            retryable: false
          });
        }
        const result = await client.listPrompts();
        return result.prompts;
      }
      
      // Aggregate prompts from all connected servers
      const allPrompts: MCPPrompt[] = [];
      for (const [name, client] of this.clients) {
        if (this.connections.get(name)?.status === 'connected') {
          const result = await client.listPrompts();
          allPrompts.push(...result.prompts);
        }
      }
      return allPrompts;
      
    } catch (error) {
      logger.error('Failed to list prompts', error as Error, { serverName });
      throw error;
    }
  }

  /**
   * Get a prompt from a server
   */
  public async getPrompt(
    serverName: string, 
    name: string, 
    args?: Record<string, unknown>
  ): Promise<GetPromptResult> {
    this.ensureInitialized();
    this.ensureServerConnected(serverName);
    
    try {
      const client = this.clients.get(serverName);
      if (!client) {
        throw new MCPError({
          type: 'CONNECTION_ERROR',
          severity: 'high',
          message: `No client found for server '${serverName}'`,
          serverName,
          timestamp: new Date(),
          retryable: false
        });
      }
      
      return await client.getPrompt({ name, arguments: args as Record<string, string> });
    } catch (error) {
      logger.error('Failed to get prompt', error as Error, { 
        serverName, 
        promptName: name 
      });
      throw error;
    }
  }

  /**
   * Send a ping to a server to check connectivity
   */
  public async ping(serverName: string): Promise<void> {
    this.ensureInitialized();
    this.ensureServerConnected(serverName);
    
    try {
      const client = this.clients.get(serverName);
      if (!client) {
        throw new MCPError({
          type: 'CONNECTION_ERROR',
          severity: 'high',
          message: `No client found for server '${serverName}'`,
          serverName,
          timestamp: new Date(),
          retryable: false
        });
      }
      
      // The official SDK Client doesn't have a ping method,
      // so we'll use a simple listResources call as a health check
      await client.listResources();
    } catch (error) {
      logger.error('Failed to ping server', error as Error, { serverName });
      throw error;
    }
  }

  /**
   * Connect to all configured servers
   */
  protected async connectToServers(): Promise<void> {
    const servers = this.config.mcpServers || {};
    
    for (const [serverName, serverConfig] of Object.entries(servers)) {
      try {
        await this.connectToServer(serverName, serverConfig);
      } catch (error) {
        logger.error(`Failed to connect to server ${serverName}`, error as Error);
        // Continue with other servers
      }
    }
  }

  /**
   * Connect to a specific server
   */
  protected async connectToServer(serverName: string, serverConfig: MCPServerConfig): Promise<void> {
    // Update status to connecting
    this.connections.set(serverName, {
      name: serverName,
      status: 'connecting',
      transport: {
        type: 'command' in serverConfig ? 'stdio' : 'http',
        ...(('timeout' in serverConfig && serverConfig.timeout !== undefined) && { timeout: serverConfig.timeout }),
        ...(('retryCount' in serverConfig && serverConfig.retryCount !== undefined) && { retryCount: serverConfig.retryCount }),
        ...(('retryDelay' in serverConfig && serverConfig.retryDelay !== undefined) && { retryDelay: serverConfig.retryDelay })
      }
    });

    try {
      const { client } = await McpTransportFactory.createClientWithTransport(serverName, serverConfig);
      
      // Store the client
      this.clients.set(serverName, client);
      
      // Update connection status
      this.updateServerConnection(serverName, {
        status: 'connected',
        connectedAt: new Date()
      });
      
      logger.info(`Successfully connected to server ${serverName}`);
      
    } catch (error) {
      this.updateServerConnection(serverName, {
        status: 'error',
        lastError: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Disconnect from all servers
   */
  protected async disconnectFromServers(): Promise<void> {
    const disconnectPromises: Promise<void>[] = [];
    
    for (const [serverName, client] of this.clients) {
      disconnectPromises.push(
        this.disconnectFromServer(serverName, client)
      );
    }
    
    await Promise.allSettled(disconnectPromises);
  }

  /**
   * Disconnect from a specific server
   */
  protected async disconnectFromServer(serverName: string, client: Client): Promise<void> {
    try {
      await client.close();
      this.clients.delete(serverName);
      this.updateServerConnection(serverName, { 
        status: 'disconnected'
      });
    } catch (error) {
      logger.error(`Failed to disconnect from server ${serverName}`, error as Error);
    }
  }

  // Helper methods

  /**
   * Ensure the client is initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new MCPError({
        type: 'CONFIG_ERROR',
        severity: 'high',
        message: 'MCP client is not initialized. Call initialize() first.',
        timestamp: new Date(),
        retryable: false
      });
    }
  }

  /**
   * Ensure server is connected
   */
  protected ensureServerConnected(serverName: string): void {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new MCPError({
        type: 'CONNECTION_ERROR',
        severity: 'high',
        message: `Server '${serverName}' is not configured`,
        serverName,
        timestamp: new Date(),
        retryable: false
      });
    }

    if (connection.status !== 'connected') {
      throw new MCPError({
        type: 'CONNECTION_ERROR',
        severity: 'high',
        message: `Server '${serverName}' is not connected (status: ${connection.status})`,
        serverName,
        timestamp: new Date(),
        retryable: true
      });
    }
  }

  /**
   * Update server connection status
   */
  protected updateServerConnection(
    serverName: string, 
    updates: Partial<MCPServerConnection>
  ): void {
    const existing = this.connections.get(serverName);
    if (existing) {
      this.connections.set(serverName, { ...existing, ...updates });
    }
  }

  /**
   * Get client info for initialization
   */
  protected getClientInfo(): { name: string; version: string } {
    return {
      name: 'ai-framework-mcp-client',
      version: '1.0.0'
    };
  }

  /**
   * Add a client for a server
   */
  protected addClient(serverName: string, client: Client): void {
    this.clients.set(serverName, client);
  }

  /**
   * Get client for a server
   */
  protected getClient(serverName: string): Client | undefined {
    return this.clients.get(serverName);
  }
}