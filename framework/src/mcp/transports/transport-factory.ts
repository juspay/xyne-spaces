import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { 
  MCPLocalServerConfig, 
  MCPRemoteServerConfig, 
  MCPServerConfig
} from '../core/types/config.js';
import { isLocalServerConfig, isRemoteServerConfig } from '../core/types/config.js';
import { MCPError } from '../core/errors/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Transport factory for creating MCP client transports
 */
export class McpTransportFactory {
  
  /**
   * Create a client and transport for the given server configuration
   */
  static async createClientWithTransport(
    serverName: string,
    config: MCPServerConfig
  ): Promise<{ client: Client; transport: StdioClientTransport | StreamableHTTPClientTransport }> {
    
    const clientInfo = {
      name: 'ai-framework-mcp-client',
      version: '1.0.0'
    };

    if (isLocalServerConfig(config)) {
      return await this.createStdioClientTransport(serverName, config, clientInfo);
    } 
    if (isRemoteServerConfig(config)) {
      return await this.createHTTPClientTransport(serverName, config, clientInfo);
    }
    
    throw new MCPError({
        type: 'CONFIG_ERROR',
        severity: 'high',
        message: `Invalid server configuration for ${serverName}`,
        serverName,
        timestamp: new Date(),
        retryable: false
      });
    
  }

  /**
   * Create stdio client transport for local servers
   */
  private static async createStdioClientTransport(
    serverName: string,
    config: MCPLocalServerConfig,
    clientInfo: { name: string; version: string }
  ): Promise<{ client: Client; transport: StdioClientTransport }> {
    
    try {
      logger.debug(`Creating stdio transport for server ${serverName}`, {
        command: config.command,
        args: config.args
      });

      // Type assertion needed: process.env has values of type 'string | undefined' 
      // but StdioClientTransport expects Record<string, string>. We filter out undefined values.
      const envVars = config.env ? { 
        ...Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => v !== undefined)
        ) as Record<string, string>,
        ...config.env 
      } : Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined)
      ) as Record<string, string>;

      const transport = new StdioClientTransport({
        command: config.command,
        // Type assertion needed: config.args is readonly string[] but transport expects string[]
        args: (config.args || []) as string[],
        env: envVars,
        // Type assertion needed: config.cwd can be undefined but transport expects string
        // We only pass cwd if it's defined, otherwise omit the property
        ...(config.cwd && { cwd: config.cwd })
      });

      const client = new Client(clientInfo);
      await client.connect(transport);

      logger.info(`Successfully connected to stdio server ${serverName}`);
      return { client, transport };

    } catch (error) {
      logger.error(`Failed to create stdio transport for server ${serverName}`, error as Error);
      throw new MCPError({
        type: 'CONNECTION_ERROR',
        severity: 'high',
        message: `Failed to connect to local server ${serverName}: ${(error as Error).message}`,
        serverName,
        timestamp: new Date(),
        retryable: true,
        originalError: error as Error
      });
    }
  }

  /**
   * Create HTTP client transport for remote servers
   */
  private static async createHTTPClientTransport(
    serverName: string,
    config: MCPRemoteServerConfig,
    clientInfo: { name: string; version: string }
  ): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
    
    try {
      logger.debug(`Creating HTTP transport for server ${serverName}`, {
        url: config.transport.url,
        type: config.transport.type
      });

      const url = new URL(config.transport.url);
      
      const transport = new StreamableHTTPClientTransport(url);


      const client = new Client(clientInfo);
      // Type assertion needed: SDK has a bug where StreamableHTTPClientTransport.sessionId 
      // can be undefined initially, but Transport interface expects string. The transport 
      // works correctly at runtime - this is purely a TypeScript definition issue.
      // We cast to the expected interface since we know the runtime behavior is correct.
      await client.connect(transport as StreamableHTTPClientTransport & { sessionId: string });

      logger.info(`Successfully connected to HTTP server ${serverName}`);
      return { client, transport };

    } catch (error) {
      logger.error(`Failed to create HTTP transport for server ${serverName}`, error as Error);
      throw new MCPError({
        type: 'CONNECTION_ERROR',
        severity: 'high',
        message: `Failed to connect to remote server ${serverName}: ${(error as Error).message}`,
        serverName,
        timestamp: new Date(),
        retryable: true,
        originalError: error as Error
      });
    }
  }

  /**
   * Test connection to a server without establishing persistent connection
   */
  static async testConnection(
    serverName: string,
    config: MCPServerConfig
  ): Promise<boolean> {
    try {
      const { client } = await this.createClientWithTransport(serverName, config);
      
      // Test with a simple operation
      await client.listResources();
      
      // Clean up
      await client.close();
      
      return true;
    } catch (error) {
      logger.warn(`Connection test failed for server ${serverName}`, {
        serverName,
        error: (error as Error).message
      });
      return false;
    }
  }
}
