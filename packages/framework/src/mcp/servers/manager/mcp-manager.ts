/**
 * Main MCP manager that integrates configuration and server management
 */

import { EventEmitter } from 'events';
import type {
  MCPServerRegistry,
  MCPServerManager,
  MCPServerConnection,
  MCPServerStatus,
  MCPServerEventData,
  MCPRegistryHealth,
  MCPConnectionOptions
} from '../types/index.js';
import type { MCPConfig, MCPServerConfig } from '../../core/types/config.js';
import { MCPConfigLoader } from '../../config/config-loader.js';
import { MCPServerRegistryImpl } from '../registry/server-registry.js';
import { createMCPConnectionError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * Main MCP manager options
 */
export interface MCPManagerOptions {
  readonly localConfigPath?: string;
  readonly globalConfigPath?: string;
  readonly autoConnect?: boolean;
  readonly connectionDefaults?: MCPConnectionOptions;
  readonly enableHealthMonitoring?: boolean;
  readonly healthCheckInterval?: number;
}

/**
 * Internal required options type
 */
interface RequiredMCPManagerOptions {
  readonly localConfigPath: string | undefined;
  readonly globalConfigPath: string | undefined;
  readonly autoConnect: boolean;
  readonly connectionDefaults: Required<MCPConnectionOptions>;
  readonly enableHealthMonitoring: boolean;
  readonly healthCheckInterval: number;
}

/**
 * MCP manager status
 */
export type MCPManagerStatus = 'stopped' | 'starting' | 'running' | 'stopping';

/**
 * Main MCP manager that coordinates configuration loading and server management
 */
export class MCPManager extends EventEmitter {
  private readonly options: RequiredMCPManagerOptions;
  private readonly registry: MCPServerRegistry;
  private readonly configLoader: MCPConfigLoader;

  private status: MCPManagerStatus = 'stopped';
  private config: MCPConfig | undefined;
  private healthMonitoringInterval: NodeJS.Timeout | undefined;

  constructor(options: MCPManagerOptions = {}) {
    super();
    
    // Validate that at least one config path is provided
    if (!options.localConfigPath && !options.globalConfigPath) {
      throw createMCPConnectionError(
        'At least one configuration path must be provided (localConfigPath or globalConfigPath)',
        'MCPManager'
      );
    }
    
    this.options = {
      localConfigPath: options.localConfigPath,
      globalConfigPath: options.globalConfigPath,
      autoConnect: options.autoConnect ?? true,
      enableHealthMonitoring: options.enableHealthMonitoring ?? true,
      healthCheckInterval: options.healthCheckInterval ?? 60000, // 1 minute
      connectionDefaults: {
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
        heartbeatInterval: 30000,
        healthCheckInterval: 60000,
        autoReconnect: true,
        ...options.connectionDefaults
      }
    };

    this.registry = new MCPServerRegistryImpl();
    
    // Build config loader options, only including defined paths
    const configOptions: { localPath?: string; globalPath?: string } = {};
    if (this.options.localConfigPath) {
      configOptions.localPath = this.options.localConfigPath;
    }
    if (this.options.globalConfigPath) {
      configOptions.globalPath = this.options.globalConfigPath;
    }
    
    this.configLoader = new MCPConfigLoader(configOptions);

    this.setupRegistryEventForwarding();
  }

  /**
   * Initialize and start the MCP manager
   */
  public async start(): Promise<void> {
    if (this.status !== 'stopped') {
      throw createMCPConnectionError(
        'MCPManager',
        `Cannot start MCP manager in status: ${this.status}`
      );
    }

    logger.info('Starting MCP manager');
    this.setStatus('starting');

    try {
      // Load configuration
      await this.loadConfiguration();

      // Register all servers from configuration
      await this.registerServersFromConfig();

      // Auto-connect if enabled
      if (this.options.autoConnect) {
        await this.connectAll();
      }

      // Start health monitoring if enabled
      if (this.options.enableHealthMonitoring) {
        this.startHealthMonitoring();
      }

      this.setStatus('running');
      logger.info('MCP manager started successfully');

    } catch (error) {
      this.setStatus('stopped');
      logger.error('Failed to start MCP manager', error as Error);
      throw createMCPConnectionError(
        'MCPManager',
        'Failed to start MCP manager',
        { originalError: error as Error }
      );
    }
  }

  /**
   * Stop the MCP manager and clean up resources
   */
  public async stop(): Promise<void> {
    if (this.status === 'stopped' || this.status === 'stopping') {
      return;
    }

    logger.info('Stopping MCP manager');
    this.setStatus('stopping');

    try {
      // Stop health monitoring
      this.stopHealthMonitoring();

      // Disconnect from all servers
      await this.disconnectAll();

      // Clean up registry
      await this.registry.cleanup();

      this.setStatus('stopped');
      logger.info('MCP manager stopped successfully');

    } catch (error) {
      logger.error('Error stopping MCP manager', error as Error);
      this.setStatus('stopped');
      throw createMCPConnectionError(
        'MCPManager',
        'Error stopping MCP manager',
        { originalError: error as Error }
      );
    }
  }

  /**
   * Reload configuration and restart servers
   */
  public async reload(): Promise<void> {
    logger.info('Reloading MCP manager configuration');

    try {
      // Disconnect all current servers
      await this.disconnectAll();

      // Load new configuration
      await this.loadConfiguration();

      // Register servers from new configuration
      await this.registerServersFromConfig();

      // Auto-connect if enabled
      if (this.options.autoConnect && this.status === 'running') {
        await this.connectAll();
      }

      logger.info('MCP manager configuration reloaded successfully');

    } catch (error) {
      logger.error('Failed to reload MCP manager configuration', error as Error);
      throw createMCPConnectionError(
        'MCPManager',
        'Failed to reload configuration',
        { originalError: error as Error }
      );
    }
  }

  /**
   * Get current status
   */
  public getStatus(): MCPManagerStatus {
    return this.status;
  }

  /**
   * Get loaded configuration
   */
  public getConfig(): MCPConfig | undefined {
    return this.config;
  }

  /**
   * Get server by name
   */
  public getServer(name: string): MCPServerManager | undefined {
    return this.registry.getServer(name);
  }

  /**
   * Get all servers
   */
  public getAllServers(): readonly MCPServerConnection[] {
    return this.registry.getAllServers();
  }

  /**
   * Get servers by status
   */
  public getServersByStatus(status: MCPServerStatus): readonly MCPServerConnection[] {
    return this.registry.getServersByStatus(status);
  }

  /**
   * Connect to all servers
   */
  public async connectAll(): Promise<void> {
    if (this.status !== 'running') {
      throw createMCPConnectionError(
        'MCPManager',
        'Cannot connect servers when manager is not running'
      );
    }

    await this.registry.connectAll();
  }

  /**
   * Disconnect from all servers
   */
  public async disconnectAll(): Promise<void> {
    await this.registry.disconnectAll();
  }

  /**
   * Get health summary
   */
  public getHealthSummary(): MCPRegistryHealth {
    return this.registry.getHealthSummary();
  }

  /**
   * Register a new server manually
   */
  public async registerServer(
    name: string,
    config: unknown,
    options?: MCPConnectionOptions
  ): Promise<MCPServerManager> {
    const finalOptions = {
      ...this.options.connectionDefaults,
      ...options
    };

    return await this.registry.register(name, config as MCPServerConfig, finalOptions);
  }

  /**
   * Unregister a server
   */
  public async unregisterServer(name: string): Promise<void> {
    await this.registry.unregister(name);
  }

  /**
   * Load configuration from file system
   */
  private async loadConfiguration(): Promise<void> {
    logger.debug('Loading MCP configuration');

    try {
      const configResult = await this.configLoader.loadConfig();
      
      if (!configResult.success) {
        throw new Error(`Configuration validation failed: ${configResult.errors?.join(', ')}`);
      }

      this.config = configResult.config!;
      
      if (configResult.warnings && configResult.warnings.length > 0) {
        logger.warn('Configuration warnings', { warnings: configResult.warnings });
      }

      logger.info(`Configuration loaded successfully with ${Object.keys(this.config.mcpServers).length} servers`);

    } catch (error) {
      throw createMCPConnectionError(
        'MCPManager',
        'Failed to load configuration',
        { originalError: error as Error }
      );
    }
  }

  /**
   * Register all servers from configuration
   */
  private async registerServersFromConfig(): Promise<void> {
    if (!this.config) {
      throw new Error('No configuration loaded');
    }

    logger.info('Registering servers from configuration');

    const registrationPromises = Object.entries(this.config.mcpServers).map(
      async ([serverName, serverConfig]) => {
        try {
          // Build connection options from config
          const connectionOptions = { ...this.options.connectionDefaults };

          // Apply server-specific options based on server type
          if ('command' in serverConfig) {
            // Local server config
            if (serverConfig.timeout !== undefined) {
              connectionOptions.timeout = serverConfig.timeout;
            }
            if (serverConfig.retryCount !== undefined) {
              connectionOptions.retryAttempts = serverConfig.retryCount;
            }
            if (serverConfig.retryDelay !== undefined) {
              connectionOptions.retryDelay = serverConfig.retryDelay;
            }
          } else if ('transport' in serverConfig) {
            // Remote server config
            if (serverConfig.transport.timeout !== undefined) {
              connectionOptions.timeout = serverConfig.transport.timeout;
            }
            if (serverConfig.transport.retryCount !== undefined) {
              connectionOptions.retryAttempts = serverConfig.transport.retryCount;
            }
            if (serverConfig.transport.retryDelay !== undefined) {
              connectionOptions.retryDelay = serverConfig.transport.retryDelay;
            }
          }

          const options = connectionOptions;

          await this.registry.register(serverName, serverConfig, options);
          logger.debug(`Registered server: ${serverName}`);
        } catch (error) {
          logger.error(`Failed to register server ${serverName}`, error as Error);
          // Don't throw here, let other registrations continue
        }
      }
    );

    await Promise.allSettled(registrationPromises);

    const totalServers = Object.keys(this.config.mcpServers).length;
    const registeredServers = this.registry.getAllServers().length;
    
    logger.info(`Registered ${registeredServers}/${totalServers} servers from configuration`);
  }

  /**
   * Set manager status and emit event
   */
  private setStatus(status: MCPManagerStatus): void {
    if (this.status === status) {
      return;
    }

    const previousStatus = this.status;
    this.status = status;

    this.emit('status-changed', {
      previousStatus,
      currentStatus: status,
      timestamp: new Date()
    });

    logger.debug(`MCP manager status changed: ${previousStatus} -> ${status}`);
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.stopHealthMonitoring();

    // Skip health monitoring in test environment to prevent hanging
    if (process.env['NODE_ENV'] === 'test') {
      logger.debug('Skipping health monitoring in test environment');
      return;
    }

    if (this.options.healthCheckInterval > 0) {
      this.healthMonitoringInterval = setInterval(
        () => this.performHealthCheck(),
        this.options.healthCheckInterval
      );
      
      // Ensure timer doesn't keep process alive in tests
      this.healthMonitoringInterval.unref();

      logger.debug('Started MCP manager health monitoring');
    }
  }

  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthMonitoringInterval) {
      clearInterval(this.healthMonitoringInterval);
      this.healthMonitoringInterval = undefined;
      logger.debug('Stopped MCP manager health monitoring');
    }
  }

  /**
   * Perform health check
   */
  private performHealthCheck(): void {
    const health = this.getHealthSummary();
    
    this.emit('health-check', {
      timestamp: new Date(),
      health
    });

    // Log health issues
    if (health.errorServers > 0) {
      logger.warn(`Health check: ${health.errorServers} servers in error state`);
    }

    if (health.healthScore < 80) {
      logger.warn(`Health check: Low health score ${health.healthScore}%`);
    }
  }

  /**
   * Set up event forwarding from registry
   */
  private setupRegistryEventForwarding(): void {
    // Forward registry events
    const registryEvents: Array<'server-added' | 'server-removed' | 'server-status-changed'> = [
      'server-added', 
      'server-removed', 
      'server-status-changed'
    ];
    
    registryEvents.forEach(event => {
      this.registry.on(event, (data: MCPServerEventData) => {
        this.emit(event, data);
      });
    });
  }
}