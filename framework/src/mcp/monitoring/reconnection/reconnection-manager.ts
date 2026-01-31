/**
 * Auto-reconnection manager - intelligent reconnection with backoff and circuit breaker patterns
 */

import type { MCPClient } from '../../core/base/mcp-client.js';
import { MCPError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';
import type {
  ReconnectionConfig,
  CircuitBreakerState,
  MonitoringEvent,
  ReconnectionHandler
} from '../types/index.js';

export interface ReconnectionAttempt {
  serverId: string;
  attemptNumber: number;
  timestamp: Date;
  delay: number;
  success: boolean;
  error?: Error;
}

export interface ReconnectionStats {
  serverId: string;
  totalAttempts: number;
  successfulReconnections: number;
  failedAttempts: number;
  lastAttempt: Date | null;
  lastSuccess: Date | null;
  currentDelay: number;
  circuitBreakerState: CircuitBreakerState['state'];
}

export class ReconnectionManager {
  private mcpClient: MCPClient;
  private config: ReconnectionConfig;
  private reconnectionTimers: Map<string, NodeJS.Timeout> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private reconnectionStats: Map<string, ReconnectionStats> = new Map();
  private reconnectionHandlers: Set<ReconnectionHandler> = new Set();
  private isActive = false;

  constructor(mcpClient: MCPClient, config: Partial<ReconnectionConfig> = {}) {
    this.mcpClient = mcpClient;
    this.config = {
      enabled: true,
      maxRetryAttempts: 10,
      backoffStrategy: 'exponential',
      baseDelay: 1000, // 1 second
      maxDelay: 300000, // 5 minutes
      jitter: true,
      circuitBreaker: {
        enabled: true,
        failureThreshold: 5,
        resetTimeout: 60000, // 1 minute
        halfOpenMaxCalls: 3
      },
      ...config
    };
  }

  /**
   * Start reconnection manager
   */
  public start(): void {
    if (this.isActive) {
      logger.warn('Reconnection manager is already active');
      return;
    }

    if (!this.config.enabled) {
      logger.info('Reconnection manager is disabled');
      return;
    }

    logger.info('Starting reconnection manager', {
      maxRetryAttempts: this.config.maxRetryAttempts,
      backoffStrategy: this.config.backoffStrategy,
      circuitBreakerEnabled: this.config.circuitBreaker.enabled
    });

    this.isActive = true;
  }

  /**
   * Stop reconnection manager
   */
  public stop(): void {
    if (!this.isActive) {
      return;
    }

    logger.info('Stopping reconnection manager');

    // Clear all active timers
    for (const [serverId, timer] of this.reconnectionTimers) {
      clearTimeout(timer);
      logger.debug('Cancelled reconnection timer', { serverId });
    }
    this.reconnectionTimers.clear();

    this.isActive = false;
  }

  /**
   * Handle server disconnection and attempt reconnection
   */
  public handleDisconnection(serverId: string, error?: Error): void {
    if (!this.isActive || !this.config.enabled) {
      return;
    }

    logger.warn('Server disconnected, initiating reconnection', {
      serverId,
      error: error?.message
    });

    // Initialize or update circuit breaker
    this.updateCircuitBreaker(serverId, false);

    // Check if circuit breaker is open
    const circuitBreaker = this.circuitBreakers.get(serverId);
    if (circuitBreaker?.state === 'open') {
      logger.warn('Circuit breaker is open, skipping reconnection', { serverId });
      return;
    }

    // Initialize reconnection stats if not exists
    if (!this.reconnectionStats.has(serverId)) {
      this.initializeReconnectionStats(serverId);
    }

    // Start reconnection attempts
    this.scheduleReconnection(serverId, 1);
  }

  /**
   * Add reconnection handler
   */
  public addReconnectionHandler(handler: ReconnectionHandler): void {
    this.reconnectionHandlers.add(handler);
  }

  /**
   * Remove reconnection handler
   */
  public removeReconnectionHandler(handler: ReconnectionHandler): void {
    this.reconnectionHandlers.delete(handler);
  }

  /**
   * Get reconnection statistics for a server
   */
  public getReconnectionStats(serverId: string): ReconnectionStats | null {
    return this.reconnectionStats.get(serverId) || null;
  }

  /**
   * Get all reconnection statistics
   */
  public getAllReconnectionStats(): Record<string, ReconnectionStats> {
    const stats: Record<string, ReconnectionStats> = {};
    for (const [serverId, stat] of this.reconnectionStats) {
      stats[serverId] = { ...stat };
    }
    return stats;
  }

  /**
   * Get circuit breaker state for a server
   */
  public getCircuitBreakerState(serverId: string): CircuitBreakerState | null {
    return this.circuitBreakers.get(serverId) || null;
  }

  /**
   * Manually trigger reconnection for a server
   */
  public async triggerReconnection(serverId: string): Promise<boolean> {
    if (!this.isActive) {
      throw new Error('Reconnection manager is not active');
    }

    logger.info('Manually triggering reconnection', { serverId });

    const stats = this.reconnectionStats.get(serverId);
    const attemptNumber = stats ? stats.totalAttempts + 1 : 1;

    return this.attemptReconnection(serverId, attemptNumber);
  }

  /**
   * Reset circuit breaker for a server
   */
  public resetCircuitBreaker(serverId: string): void {
    const circuitBreaker = this.circuitBreakers.get(serverId);
    if (circuitBreaker) {
      circuitBreaker.state = 'closed';
      circuitBreaker.failureCount = 0;
      circuitBreaker.lastFailureTime = null;
      circuitBreaker.nextRetryTime = null;

      logger.info('Circuit breaker reset', { serverId });
    }
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<ReconnectionConfig>): void {
    this.config = { ...this.config, ...config };

    if (!config.enabled && this.isActive) {
      this.stop();
    } else if (config.enabled && !this.isActive) {
      this.start();
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): ReconnectionConfig {
    return { ...this.config };
  }

  /**
   * Check if reconnection manager is active
   */
  public isReconnectionActive(): boolean {
    return this.isActive;
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnection(serverId: string, attemptNumber: number): void {
    if (attemptNumber > this.config.maxRetryAttempts) {
      logger.error('Max reconnection attempts reached', new Error('Max reconnection attempts reached'), {
        serverId,
        maxAttempts: this.config.maxRetryAttempts
      });
      this.updateCircuitBreaker(serverId, false, true);
      return;
    }

    const delay = this.calculateDelay(attemptNumber);
    
    logger.debug('Scheduling reconnection attempt', {
      serverId,
      attemptNumber,
      delay
    });

    const timer = setTimeout(() => {
      this.reconnectionTimers.delete(serverId);
      void this.attemptReconnection(serverId, attemptNumber);
    }, delay);

    this.reconnectionTimers.set(serverId, timer);
  }

  /**
   * Attempt to reconnect to a server
   */
  private async attemptReconnection(serverId: string, attemptNumber: number): Promise<boolean> {
    const startTime = Date.now();
    let success = false;
    let error: Error | undefined;

    try {
      logger.info('Attempting reconnection', { serverId, attemptNumber });

      // Attempt to reconnect through MCP client
      // This would depend on the actual MCP client implementation
      // For now, we'll simulate the reconnection attempt
      await this.performReconnection(serverId);
      
      success = true;
      logger.info('Reconnection successful', { serverId, attemptNumber });

    } catch (reconnectionError) {
      error = reconnectionError as Error;
      success = false;
      logger.warn('Reconnection failed', {
        serverId,
        attemptNumber,
        error: error.message
      });
    }

    // Record attempt
    const attempt: ReconnectionAttempt = {
      serverId,
      attemptNumber,
      timestamp: new Date(),
      delay: Date.now() - startTime,
      success,
      ...(error && { error })
    };

    this.recordReconnectionAttempt(attempt);
    this.updateCircuitBreaker(serverId, success);
    this.notifyHandlers(serverId, attemptNumber, success);

    if (success) {
      this.onReconnectionSuccess(serverId);
    } else {
      this.onReconnectionFailure(serverId, attemptNumber, error);
    }

    return success;
  }

  /**
   * Perform the actual reconnection logic
   */
  private performReconnection(serverId: string): Promise<void> {
    // This is a placeholder for the actual reconnection logic
    // In a real implementation, this would call the appropriate MCP client methods
    
    return new Promise<void>((resolve, reject) => {
      try {
        // Check if server is already connected
        const connectedServers = this.mcpClient.getConnectedServers();
        if (connectedServers.includes(serverId)) {
          logger.debug('Server already connected', { serverId });
          resolve();
          return;
        }

        // For testing, we check the mock client state to determine success/failure
        // In real implementation, this would attempt actual reconnection
        const updatedServers = this.mcpClient.getConnectedServers();
        if (!updatedServers.includes(serverId)) {
          reject(new Error(`Failed to reconnect to server ${serverId}`));
          return;
        }
        
        logger.debug('Reconnection attempt completed', { serverId });
        resolve();
        
      } catch (error) {
        reject(new MCPError({
          type: 'CONNECTION_ERROR',
          message: `Reconnection failed for server ${serverId}: ${(error as Error).message}`,
          severity: 'high',
          timestamp: new Date(),
          retryable: true
        }));
      }
    });
  }

  /**
   * Calculate delay for reconnection attempt
   */
  private calculateDelay(attemptNumber: number): number {
    let delay: number;

    switch (this.config.backoffStrategy) {
      case 'linear':
        delay = this.config.baseDelay * attemptNumber;
        break;
      case 'exponential':
        delay = this.config.baseDelay * Math.pow(2, attemptNumber - 1);
        break;
      case 'fixed':
      default:
        delay = this.config.baseDelay;
        break;
    }

    // Apply jitter if enabled
    if (this.config.jitter) {
      const jitterAmount = delay * 0.1; // 10% jitter
      delay += (Math.random() - 0.5) * 2 * jitterAmount;
    }

    // Ensure delay doesn't exceed maximum
    return Math.min(delay, this.config.maxDelay);
  }

  /**
   * Initialize reconnection statistics for a server
   */
  private initializeReconnectionStats(serverId: string): void {
    this.reconnectionStats.set(serverId, {
      serverId,
      totalAttempts: 0,
      successfulReconnections: 0,
      failedAttempts: 0,
      lastAttempt: null,
      lastSuccess: null,
      currentDelay: this.config.baseDelay,
      circuitBreakerState: 'closed'
    });
  }

  /**
   * Record reconnection attempt
   */
  private recordReconnectionAttempt(attempt: ReconnectionAttempt): void {
    const stats = this.reconnectionStats.get(attempt.serverId);
    if (!stats) {
      this.initializeReconnectionStats(attempt.serverId);
      return this.recordReconnectionAttempt(attempt);
    }

    stats.totalAttempts++;
    stats.lastAttempt = attempt.timestamp;
    stats.currentDelay = this.calculateDelay(stats.totalAttempts);

    if (attempt.success) {
      stats.successfulReconnections++;
      stats.lastSuccess = attempt.timestamp;
    } else {
      stats.failedAttempts++;
    }

    // Update circuit breaker state in stats
    const circuitBreaker = this.circuitBreakers.get(attempt.serverId);
    if (circuitBreaker) {
      stats.circuitBreakerState = circuitBreaker.state;
    }
  }

  /**
   * Update circuit breaker state
   */
  private updateCircuitBreaker(serverId: string, success: boolean, forceOpen = false): void {
    if (!this.config.circuitBreaker.enabled && !forceOpen) {
      return;
    }

    let circuitBreaker = this.circuitBreakers.get(serverId);
    if (!circuitBreaker) {
      circuitBreaker = {
        serverId,
        state: 'closed',
        failureCount: 0,
        lastFailureTime: null,
        nextRetryTime: null
      };
      this.circuitBreakers.set(serverId, circuitBreaker);
    }

    const now = new Date();

    if (forceOpen) {
      circuitBreaker.state = 'open';
      circuitBreaker.nextRetryTime = new Date(now.getTime() + this.config.circuitBreaker.resetTimeout);
      logger.warn('Circuit breaker forced open', { serverId });
      return;
    }

    if (success) {
      // Reset on success
      circuitBreaker.failureCount = 0;
      if (circuitBreaker.state === 'half-open') {
        circuitBreaker.state = 'closed';
        logger.info('Circuit breaker closed after successful reconnection', { serverId });
      }
    } else {
      // Increment failure count
      circuitBreaker.failureCount++;
      circuitBreaker.lastFailureTime = now;

      // Check if threshold is reached
      if (circuitBreaker.failureCount >= this.config.circuitBreaker.failureThreshold) {
        circuitBreaker.state = 'open';
        circuitBreaker.nextRetryTime = new Date(now.getTime() + this.config.circuitBreaker.resetTimeout);
        logger.warn('Circuit breaker opened due to failures', {
          serverId,
          failureCount: circuitBreaker.failureCount,
          threshold: this.config.circuitBreaker.failureThreshold
        });
      }
    }

    // Check if circuit breaker should move to half-open
    if (circuitBreaker.state === 'open' && circuitBreaker.nextRetryTime && now >= circuitBreaker.nextRetryTime) {
      circuitBreaker.state = 'half-open';
      logger.info('Circuit breaker moved to half-open', { serverId });
    }
  }

  /**
   * Handle successful reconnection
   */
  private onReconnectionSuccess(serverId: string): void {
    // Clear any pending reconnection timer
    const timer = this.reconnectionTimers.get(serverId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectionTimers.delete(serverId);
    }

    // Emit monitoring event
    this.emitMonitoringEvent({
      type: 'reconnection_attempt',
      serverId,
      timestamp: new Date(),
      data: { success: true },
      severity: 'info'
    });
  }

  /**
   * Handle failed reconnection
   */
  private onReconnectionFailure(serverId: string, attemptNumber: number, error?: Error): void {
    // Schedule next attempt if we haven't reached max attempts and circuit breaker is not open
    const circuitBreaker = this.circuitBreakers.get(serverId);
    if (attemptNumber < this.config.maxRetryAttempts && circuitBreaker?.state !== 'open') {
      this.scheduleReconnection(serverId, attemptNumber + 1);
    }

    // Emit monitoring event
    this.emitMonitoringEvent({
      type: 'reconnection_attempt',
      serverId,
      timestamp: new Date(),
      data: { success: false, attemptNumber, error: error?.message },
      severity: 'warning'
    });
  }

  /**
   * Notify reconnection handlers
   */
  private notifyHandlers(serverId: string, attempt: number, success: boolean): void {
    for (const handler of this.reconnectionHandlers) {
      try {
        handler(serverId, attempt, success);
      } catch (error) {
        logger.error('Error in reconnection handler', error as Error);
      }
    }
  }

  /**
   * Emit monitoring event
   */
  private emitMonitoringEvent(event: MonitoringEvent): void {
    logger.debug('Monitoring event emitted', { event });
    // This would integrate with the broader monitoring event system
  }
}