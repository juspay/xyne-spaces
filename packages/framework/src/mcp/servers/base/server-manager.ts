/**
 * Base server manager implementation with common functionality
 */

import { EventEmitter } from 'events';
import type {
  MCPServerManager,
  MCPServerConnection,
  MCPServerHealth,
  MCPServerStatus,
  MCPServerEvent,
  MCPServerEventData,
  MCPConnectionOptions
} from '../types/index.js';
import { DEFAULT_CONNECTION_OPTIONS } from '../types/index.js';
import type { MCPServerConfig } from '../../core/types/config.js';
import { createMCPConnectionError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';

/**
 * Abstract base class for MCP server managers
 */
export abstract class BaseMCPServerManager extends EventEmitter implements MCPServerManager {
  protected readonly serverId: string;
  protected readonly serverName: string;
  protected readonly config: MCPServerConfig;
  protected readonly options: Required<MCPConnectionOptions>;

  protected status: MCPServerStatus = 'disconnected';
  protected connectedAt: Date | undefined;
  protected lastHeartbeat: Date | undefined;
  protected errorCount = 0;
  protected lastError: Error | undefined;
  protected responseTime: number | undefined;
  protected reconnectAttempts = 0;

  private healthMonitoringInterval: NodeJS.Timeout | undefined;
  private heartbeatInterval: NodeJS.Timeout | undefined;
  private cleanupHandlers: Array<() => Promise<void>> = [];

  constructor(
    serverId: string,
    serverName: string,
    config: MCPServerConfig,
    options?: MCPConnectionOptions
  ) {
    super();
    this.serverId = serverId;
    this.serverName = serverName;
    this.config = config;
    this.options = {
      ...DEFAULT_CONNECTION_OPTIONS,
      ...options
    };

    // Note: Error handling is done manually, not through event listeners to avoid recursion
  }

  /**
   * Get server information
   */
  public getServerInfo(): MCPServerConnection {
    return {
      id: this.serverId,
      name: this.serverName,
      config: this.config,
      health: this.getHealth(),
      connectedAt: this.connectedAt || undefined,
      version: this.getServerVersion() || undefined,
      capabilities: this.getServerCapabilities() || undefined
    };
  }

  /**
   * Connect to the server
   */
  public async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    logger.info(`Connecting to MCP server: ${this.serverName}`);
    this.setStatus('connecting');

    try {
      await this.doConnect();
      this.connectedAt = new Date();
      this.setStatus('connected');
      this.resetErrorState();
      
      if (this.options.autoReconnect) {
        this.startHealthMonitoring();
      }

      logger.info(`Successfully connected to MCP server: ${this.serverName}`);
    } catch (error) {
      this.handleConnectionError(error);
      throw error;
    }
  }

  /**
   * Disconnect from the server
   */
  public async disconnect(): Promise<void> {
    if (this.status === 'disconnected') {
      return;
    }

    logger.info(`Disconnecting from MCP server: ${this.serverName}`);
    
    this.stopHealthMonitoring();
    
    try {
      await this.doDisconnect();
    } catch (error) {
      logger.error(`Error during disconnect from ${this.serverName}`, error as Error);
    }

    this.setStatus('disconnected');
    this.connectedAt = undefined;
    
    logger.info(`Disconnected from MCP server: ${this.serverName}`);
  }

  /**
   * Check if server is connected
   */
  public isConnected(): boolean {
    return this.status === 'connected';
  }

  /**
   * Send message to server
   */
  public async sendMessage(message: unknown): Promise<unknown> {
    if (!this.isConnected()) {
      throw createMCPConnectionError(
        this.serverName,
        `Cannot send message to disconnected server: ${this.serverName}`
      );
    }

    const startTime = Date.now();
    
    try {
      const response = await this.doSendMessage(message);
      this.responseTime = Date.now() - startTime;
      return response;
    } catch (error) {
      this.handleError(error as Error);
      throw error;
    }
  }

  /**
   * Get current health status
   */
  public getHealth(): MCPServerHealth {
    return {
      status: this.status,
      lastHeartbeat: this.lastHeartbeat,
      uptime: this.connectedAt ? Date.now() - this.connectedAt.getTime() : undefined,
      errorCount: this.errorCount,
      lastError: this.lastError,
      responseTime: this.responseTime,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Start health monitoring
   */
  public startHealthMonitoring(): void {
    this.stopHealthMonitoring();

    // Skip health monitoring in test environment to prevent hanging
    if (process.env['NODE_ENV'] === 'test') {
      return;
    }

    // Start heartbeat monitoring
    const heartbeatInterval = this.options.heartbeatInterval!; // Safe because options is Required<MCPConnectionOptions>
    if (heartbeatInterval > 0) {
      this.heartbeatInterval = setInterval(
        () => {
          this.performHeartbeat().catch(() => {});
        },
        heartbeatInterval
      );
      // Ensure timer doesn't keep process alive in tests
      this.heartbeatInterval.unref();
    }

    // Start health check monitoring
    const healthCheckInterval = this.options.healthCheckInterval!; // Safe because options is Required<MCPConnectionOptions>
    if (healthCheckInterval > 0) {
      this.healthMonitoringInterval = setInterval(
        () => {
          this.performHealthCheck().catch(() => {});
        },
        healthCheckInterval
      );
      // Ensure timer doesn't keep process alive in tests
      this.healthMonitoringInterval.unref();
    }

    logger.debug(`Started health monitoring for server: ${this.serverName}`);
  }

  /**
   * Stop health monitoring
   */
  public stopHealthMonitoring(): void {
    if (this.heartbeatInterval !== undefined) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    if (this.healthMonitoringInterval !== undefined) {
      clearInterval(this.healthMonitoringInterval);
      this.healthMonitoringInterval = undefined;
    }

    logger.debug(`Stopped health monitoring for server: ${this.serverName}`);
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    logger.debug(`Cleaning up server manager: ${this.serverName}`);
    
    this.stopHealthMonitoring();
    
    try {
      await this.disconnect();
    } catch (error) {
      logger.error(`Error during cleanup disconnect for ${this.serverName}`, error as Error);
    }

    // Run custom cleanup handlers
    for (const handler of this.cleanupHandlers) {
      try {
        await handler();
      } catch (error) {
        logger.error(`Error in cleanup handler for ${this.serverName}`, error as Error);
      }
    }

    this.removeAllListeners();
    logger.debug(`Cleanup completed for server manager: ${this.serverName}`);
  }

  /**
   * Abstract methods to be implemented by subclasses
   */
  protected abstract doConnect(): Promise<void>;
  protected abstract doDisconnect(): Promise<void>;
  protected abstract doSendMessage(message: unknown): Promise<unknown>;
  protected abstract performHeartbeat(): Promise<void>;
  protected abstract getServerVersion(): string | undefined;
  protected abstract getServerCapabilities(): string[] | undefined;

  /**
   * Set server status and emit event
   */
  protected setStatus(status: MCPServerStatus): void {
    if (this.status === status) {
      return;
    }

    const previousStatus = this.status;
    this.status = status;

    const eventData: MCPServerEventData = {
      serverId: this.serverId,
      serverName: this.serverName,
      event: status as MCPServerEvent,
      timestamp: new Date(),
      data: { previousStatus, currentStatus: status },
      error: undefined
    };

    this.emit(status, eventData);
    this.emit('status-changed', eventData);

    logger.debug(`Server ${this.serverName} status changed: ${previousStatus} -> ${status}`);
  }

  /**
   * Emit server event
   */
  protected emitEvent(event: MCPServerEvent, data?: Record<string, unknown>, error?: Error): void {
    const eventData: MCPServerEventData = {
      serverId: this.serverId,
      serverName: this.serverName,
      event,
      timestamp: new Date(),
      data,
      error
    };

    this.emit(event, eventData);
  }

  /**
   * Handle connection errors
   */
  protected handleConnectionError(error: unknown): void {
    const connectionError = error instanceof Error 
      ? error 
      : new Error(`Connection failed: ${String(error)}`);

    this.handleError(connectionError);
    this.setStatus('error');

    if (this.options.autoReconnect && this.reconnectAttempts < (this.options.retryAttempts ?? 0)) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle general errors
   */
  public handleError(error: Error): void {
    this.errorCount++;
    this.lastError = error;

    logger.error(`Error in server ${this.serverName}`, error);
    
    // Emit error event safely without potential recursion
    try {
      const eventData: MCPServerEventData = {
        serverId: this.serverId,
        serverName: this.serverName,
        event: 'error',
        timestamp: new Date(),
        data: undefined,
        error
      };
      this.emit('error', eventData);
    } catch (emitError) {
      // Prevent infinite recursion - just log emit errors
      logger.error(`Failed to emit error event for server ${this.serverName}`, emitError as Error);
    }
  }

  /**
   * Reset error state
   */
  protected resetErrorState(): void {
    this.errorCount = 0;
    this.lastError = undefined;
    this.reconnectAttempts = 0;
  }

  /**
   * Schedule reconnection attempt
   */
  protected scheduleReconnect(): void {
    if (!this.options.autoReconnect) {
      return;
    }

    this.reconnectAttempts++;
    const delay = this.calculateRetryDelay();

    logger.info(`Scheduling reconnect for ${this.serverName} in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.setStatus('reconnecting');

    setTimeout(() => {
      void this.connect().catch((error) => {
        logger.error(`Reconnection attempt ${this.reconnectAttempts} failed for ${this.serverName}`, error as Error);
      });
    }, delay);
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  protected calculateRetryDelay(): number {
    const baseDelay = this.options.retryDelay ?? 1000;
    const exponentialDelay = baseDelay * Math.pow(2, this.reconnectAttempts - 1);
    const maxDelay = 30000; // 30 seconds max
    const jitter = Math.random() * 1000; // Add some jitter
    
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  /**
   * Perform health check
   */
  protected async performHealthCheck(): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      await this.performHeartbeat();
    } catch (error) {
      logger.error(`Health check failed for ${this.serverName}`, error as Error);
      this.handleConnectionError(error);
    }
  }

  /**
   * Add cleanup handler
   */
  protected addCleanupHandler(handler: () => Promise<void>): void {
    this.cleanupHandlers.push(handler);
  }
}