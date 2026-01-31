/**
 * Server registry for managing multiple MCP server connections
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type {
  MCPServerRegistry,
  MCPServerManager,
  MCPServerConnection,
  MCPServerStatus,
  MCPServerEvent,
  MCPServerEventData,
  MCPConnectionOptions,
  MCPRegistryHealth
} from '../types/index.js';
import type { MCPServerConfig } from '../../core/types/config.js';
import { isLocalServerConfig, isRemoteServerConfig } from '../../config/config-validator.js';
import { LocalMCPServerManager } from '../local/local-server-manager.js';
import { RemoteMCPServerManager } from '../remote/remote-server-manager.js';
import { createMCPConnectionError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * Registry for managing multiple MCP server connections
 */
export class MCPServerRegistryImpl extends EventEmitter implements MCPServerRegistry {
  private readonly servers = new Map<string, MCPServerManager>();
  private readonly serverConfigs = new Map<string, MCPServerConfig>();
  private readonly serverOptions = new Map<string, MCPConnectionOptions>();
  
  private isCleaningUp = false;

  constructor() {
    super();
    this.setupCleanupHandlers();
  }

  /**
   * Register a new server
   */
  public async register(
    name: string, 
    config: MCPServerConfig, 
    options?: MCPConnectionOptions
  ): Promise<MCPServerManager> {
    if (this.isCleaningUp) {
      throw createMCPConnectionError(
        name,
        'Cannot register server during cleanup'
      );
    }

    if (this.servers.has(name)) {
      throw createMCPConnectionError(
        name,
        `Server with name '${name}' is already registered`
      );
    }

    logger.info(`Registering MCP server: ${name}`);

    try {
      const serverId = randomUUID();
      const manager = this.createServerManager(serverId, name, config, options);

      // Store server information
      this.servers.set(name, manager);
      this.serverConfigs.set(name, config);
      if (options) {
        this.serverOptions.set(name, options);
      }

      // Set up event forwarding
      this.setupServerEventForwarding(manager);

      // Emit registry event
      this.emitRegistryEvent('server-added', {
        serverId,
        serverName: name,
        event: 'connected',
        timestamp: new Date(),
        data: { config },
        error: undefined
      });

      logger.info(`Successfully registered MCP server: ${name}`);
      await Promise.resolve(); // Satisfy @typescript-eslint/require-await
      return manager;

    } catch (error) {
      logger.error(`Failed to register MCP server ${name}`, error as Error);
      throw createMCPConnectionError(
        name,
        `Failed to register server '${name}'`,
        {
          originalError: error as Error
        }
      );
    }
  }

  /**
   * Unregister a server
   */
  public async unregister(name: string): Promise<void> {
    const manager = this.servers.get(name);
    if (!manager) {
      logger.warn(`Attempted to unregister non-existent server: ${name}`);
      return;
    }

    logger.info(`Unregistering MCP server: ${name}`);

    try {
      // Clean up the server manager
      await manager.cleanup();

      // Remove from registry
      this.servers.delete(name);
      this.serverConfigs.delete(name);
      this.serverOptions.delete(name);

      // Emit registry event
      const serverInfo = manager.getServerInfo();
      this.emitRegistryEvent('server-removed', {
        serverId: serverInfo.id,
        serverName: name,
        event: 'disconnected',
        timestamp: new Date(),
        data: undefined,
        error: undefined
      });

      logger.info(`Successfully unregistered MCP server: ${name}`);

    } catch (error) {
      logger.error(`Error unregistering MCP server ${name}`, error as Error);
      throw createMCPConnectionError(
        name,
        `Failed to unregister server '${name}'`,
        {
          originalError: error as Error
        }
      );
    }
  }

  /**
   * Get server manager by name
   */
  public getServer(name: string): MCPServerManager | undefined {
    return this.servers.get(name);
  }

  /**
   * Get all registered servers
   */
  public getAllServers(): readonly MCPServerConnection[] {
    return Array.from(this.servers.values()).map(manager => manager.getServerInfo());
  }

  /**
   * Get servers by status
   */
  public getServersByStatus(status: MCPServerStatus): readonly MCPServerConnection[] {
    return this.getAllServers().filter(server => server.health.status === status);
  }

  /**
   * Connect to all servers
   */
  public async connectAll(): Promise<void> {
    logger.info('Connecting to all registered MCP servers');
    
    const connectionPromises = Array.from(this.servers.entries()).map(
      async ([name, manager]) => {
        try {
          await manager.connect();
          logger.debug(`Connected to server: ${name}`);
        } catch (error) {
          logger.error(`Failed to connect to server ${name}`, error as Error);
          // Don't throw here, let other connections continue
        }
      }
    );

    await Promise.allSettled(connectionPromises);
    
    const connectedServers = this.getServersByStatus('connected');
    const errorServers = this.getServersByStatus('error');
    
    logger.info(`Connection summary: ${connectedServers.length} connected, ${errorServers.length} failed`);
  }

  /**
   * Disconnect from all servers
   */
  public async disconnectAll(): Promise<void> {
    logger.info('Disconnecting from all MCP servers');
    
    const disconnectionPromises = Array.from(this.servers.entries()).map(
      async ([name, manager]) => {
        try {
          await manager.disconnect();
          logger.debug(`Disconnected from server: ${name}`);
        } catch (error) {
          logger.error(`Error disconnecting from server ${name}`, error as Error);
          // Don't throw here, let other disconnections continue
        }
      }
    );

    await Promise.allSettled(disconnectionPromises);
    logger.info('Disconnection from all servers completed');
  }

  /**
   * Get registry health summary
   */
  public getHealthSummary(): MCPRegistryHealth {
    const allServers = this.getAllServers();
    const connectedServers = this.getServersByStatus('connected');
    const errorServers = this.getServersByStatus('error');
    
    const totalErrors = allServers.reduce((sum, server) => sum + server.health.errorCount, 0);
    const responseTimes = connectedServers
      .map(server => server.health.responseTime)
      .filter((time): time is number => typeof time === 'number');
    
    const averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
      : undefined;

    // Calculate health score (0-100)
    const totalServers = allServers.length;
    const healthScore = totalServers > 0
      ? Math.round((connectedServers.length / totalServers) * 100)
      : 100;

    return {
      totalServers,
      connectedServers: connectedServers.length,
      errorServers: errorServers.length,
      averageResponseTime,
      totalErrors,
      healthScore
    };
  }

  /**
   * Clean up all resources
   */
  public async cleanup(): Promise<void> {
    if (this.isCleaningUp) {
      return;
    }

    this.isCleaningUp = true;
    logger.info('Cleaning up MCP server registry');

    try {
      // Disconnect and cleanup all servers
      const cleanupPromises = Array.from(this.servers.entries()).map(
        async ([name, manager]) => {
          try {
            await manager.cleanup();
            logger.debug(`Cleaned up server: ${name}`);
          } catch (error) {
            logger.error(`Error cleaning up server ${name}`, error as Error);
          }
        }
      );

      await Promise.allSettled(cleanupPromises);

      // Clear all registrations
      this.servers.clear();
      this.serverConfigs.clear();
      this.serverOptions.clear();

      // Remove all listeners
      this.removeAllListeners();

      logger.info('MCP server registry cleanup completed');

    } catch (error) {
      logger.error('Error during registry cleanup', error as Error);
    } finally {
      this.isCleaningUp = false;
    }
  }

  /**
   * Create appropriate server manager based on configuration
   */
  private createServerManager(
    serverId: string,
    name: string,
    config: MCPServerConfig,
    options?: MCPConnectionOptions
  ): MCPServerManager {
    if (isLocalServerConfig(config)) {
      return new LocalMCPServerManager(serverId, name, config, options);
    } else if (isRemoteServerConfig(config)) {
      return new RemoteMCPServerManager(serverId, name, config, options);
    } 
      throw new Error(`Invalid server configuration for ${name}`);
    
  }

  /**
   * Set up event forwarding from server manager to registry
   */
  private setupServerEventForwarding(manager: MCPServerManager): void {
    // Forward all server events through the registry
    const events: Array<MCPServerEvent> = ['connecting', 'connected', 'disconnected', 'error', 'message', 'heartbeat', 'reconnecting'];
    
    events.forEach(event => {
      manager.on(event, (eventData: MCPServerEventData) => {
        // Forward server events as registry events
        this.emitRegistryEvent('server-status-changed', eventData);
      });
    });
  }

  /**
   * Emit registry-level events
   */
  private emitRegistryEvent(event: string, data: MCPServerEventData): void {
    this.emit(event, data);
    logger.debug(`Registry event: ${event}`, { 
      server: data.serverName, 
      event: data.event 
    });
  }

  /**
   * Set up cleanup handlers for graceful shutdown
   */
  private setupCleanupHandlers(): void {
    // Skip process event listeners in test environment to prevent memory leaks
    if (process.env['NODE_ENV'] === 'test') {
      return;
    }

    const cleanup = async (): Promise<void> => {
      logger.info('Received shutdown signal, cleaning up MCP servers...');
      try {
        await this.cleanup();
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown cleanup', error as Error);
        process.exit(1);
      }
    };

    // Handle various shutdown signals
    process.once('SIGINT', () => { void cleanup(); });
    process.once('SIGTERM', () => { void cleanup(); });
    process.once('SIGHUP', () => { void cleanup(); });

    // Handle uncaught exceptions
    process.once('uncaughtException', (error) => {
      logger.error('Uncaught exception, cleaning up MCP servers', error);
      void this.cleanup().then(() => {
        process.exit(1);
      }).catch((cleanupError) => {
        logger.error('Error during exception cleanup', cleanupError as Error);
        process.exit(1);
      });
    });

    // Handle unhandled promise rejections
    process.once('unhandledRejection', (reason) => {
      logger.error('Unhandled promise rejection, cleaning up MCP servers', reason as Error);
      void this.cleanup().then(() => {
        process.exit(1);
      }).catch((cleanupError) => {
        logger.error('Error during rejection cleanup', cleanupError as Error);
        process.exit(1);
      });
    });
  }
}