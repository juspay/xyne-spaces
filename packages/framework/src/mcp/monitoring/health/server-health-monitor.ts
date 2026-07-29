/**
 * Server health monitor - tracks individual server status, connection health, and performance metrics
 */

import type { MCPClient } from '../../core/base/mcp-client.js';
import { MCPError } from '../../core/errors/index.js';
import { logger } from '../../../utils/logger.js';
import type {
  HealthStatus,
  ServerHealthMetrics,
  SystemHealthReport,
  HealthMonitorConfig,
  HealthCheckResult,
  MonitoringEvent,
  HealthEventHandler
} from '../types/index.js';

export class ServerHealthMonitor {
  private mcpClient: MCPClient;
  private config: HealthMonitorConfig;
  private metrics: Map<string, ServerHealthMetrics> = new Map();
  private responseTimeHistory: Map<string, number[]> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private eventHandlers: Set<HealthEventHandler> = new Set();
  private isMonitoring = false;

  constructor(mcpClient: MCPClient, config: Partial<HealthMonitorConfig> = {}) {
    this.mcpClient = mcpClient;
    this.config = {
      healthCheckInterval: 30000, // 30 seconds
      responseTimeThreshold: 5000, // 5 seconds
      errorRateThreshold: 10, // 10%
      enableDetailedMetrics: true,
      alerting: {
        enabled: false
      },
      retention: {
        metricsRetentionDays: 7,
        detailedLogsRetentionDays: 3
      },
      ...config
    };
  }

  /**
   * Start health monitoring
   */
  public startMonitoring(): void {
    if (this.isMonitoring) {
      logger.warn('Health monitoring is already active');
      return;
    }

    logger.info('Starting server health monitoring', {
      interval: this.config.healthCheckInterval,
      responseTimeThreshold: this.config.responseTimeThreshold
    });

    this.isMonitoring = true;
    this.scheduleHealthCheck();
  }

  /**
   * Stop health monitoring
   */
  public stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    logger.info('Stopping server health monitoring');
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    this.isMonitoring = false;
  }

  /**
   * Add event handler for monitoring events
   */
  public addEventHandler(handler: HealthEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Remove event handler
   */
  public removeEventHandler(handler: HealthEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Get current system health report
   */
  public getSystemHealthReport(): SystemHealthReport {
    const servers: Record<string, ServerHealthMetrics> = {};
    let healthyCount = 0;
    let unhealthyCount = 0;
    let degradedCount = 0;

    for (const [serverId, metrics] of this.metrics) {
      servers[serverId] = { ...metrics };
      
      switch (metrics.connectionStatus.status) {
        case 'healthy':
          healthyCount++;
          break;
        case 'unhealthy':
          unhealthyCount++;
          break;
        case 'degraded':
          degradedCount++;
          break;
      }
    }

    const overall: HealthStatus = this.calculateOverallHealth(
      healthyCount,
      unhealthyCount,
      degradedCount
    );

    return {
      overall,
      servers,
      summary: {
        totalServers: this.metrics.size,
        healthyServers: healthyCount,
        unhealthyServers: unhealthyCount,
        degradedServers: degradedCount
      },
      generatedAt: new Date()
    };
  }

  /**
   * Get health metrics for a specific server
   */
  public getServerHealth(serverId: string): ServerHealthMetrics | null {
    return this.metrics.get(serverId) || null;
  }

  /**
   * Manually trigger health check for all servers
   */
  public async performHealthCheck(): Promise<HealthCheckResult[]> {
    const connectedServers = this.mcpClient.getConnectedServers();
    const results: HealthCheckResult[] = [];

    logger.debug('Performing health check for all servers', {
      serverCount: connectedServers.length
    });

    for (const serverId of connectedServers) {
      try {
        const result = await this.checkServerHealth(serverId);
        results.push(result);
        this.updateServerMetrics(result);
      } catch (error) {
        logger.error('Health check failed for server', error as Error, { serverId });
        
        const errorResult: HealthCheckResult = {
          serverId,
          status: {
            status: 'unhealthy',
            timestamp: new Date(),
            details: (error as Error).message
          },
          metrics: {
            responseTime: -1
          },
          errors: [error as Error]
        };
        
        results.push(errorResult);
        this.updateServerMetrics(errorResult);
      }
    }

    // Clean up metrics for disconnected servers
    this.cleanupDisconnectedServers([...connectedServers]);

    return results;
  }

  /**
   * Schedule next health check
   */
  private scheduleHealthCheck(): void {
    this.monitoringInterval = setInterval(() => {
      if (this.isMonitoring) {
        void this.performHealthCheck();
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Check health of a specific server
   */
  private async checkServerHealth(serverId: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Perform ping to check server responsiveness
      await this.mcpClient.ping(serverId);
      
      const responseTime = Date.now() - startTime;
      const status = this.determineHealthStatus(serverId, responseTime);

      return {
        serverId,
        status,
        metrics: {
          responseTime,
          connectionCount: 1 // Would be more complex in real implementation
        }
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        serverId,
        status: {
          status: 'unhealthy',
          timestamp: new Date(),
          details: (error as Error).message
        },
        metrics: {
          responseTime
        },
        errors: [error as Error]
      };
    }
  }

  /**
   * Determine health status based on response time and error rate
   */
  private determineHealthStatus(serverId: string, responseTime: number): HealthStatus {
    const existingMetrics = this.metrics.get(serverId);
    const errorRate = existingMetrics ? 
      (existingMetrics.operationCounts.failed / existingMetrics.operationCounts.total) * 100 : 0;

    if (responseTime > this.config.responseTimeThreshold || errorRate > this.config.errorRateThreshold) {
      return {
        status: responseTime > this.config.responseTimeThreshold * 2 ? 'unhealthy' : 'degraded',
        timestamp: new Date(),
        details: `Response time: ${responseTime}ms, Error rate: ${errorRate.toFixed(1)}%`
      };
    }

    return {
      status: 'healthy',
      timestamp: new Date()
    };
  }

  /**
   * Update server metrics with health check result
   */
  private updateServerMetrics(result: HealthCheckResult): void {
    const { serverId, status, metrics: checkMetrics, errors = [] } = result;
    const now = new Date();
    
    let existing = this.metrics.get(serverId);
    if (!existing) {
      existing = {
        serverId,
        connectionStatus: status,
        responseTime: {
          current: checkMetrics.responseTime,
          average: checkMetrics.responseTime,
          percentile95: checkMetrics.responseTime
        },
        operationCounts: {
          successful: 0,
          failed: 0,
          total: 0
        },
        lastActivity: now,
        uptime: 0,
        errors: []
      };
    }

    // Update response time metrics
    this.updateResponseTimeMetrics(serverId, checkMetrics.responseTime);
    const responseTimeStats = this.calculateResponseTimeStats(serverId);
    
    // Update operation counts
    const isSuccess = status.status === 'healthy';
    existing.operationCounts.total++;
    if (isSuccess) {
      existing.operationCounts.successful++;
    } else {
      existing.operationCounts.failed++;
    }

    // Update error summary
    if (errors.length > 0) {
      this.updateErrorSummary(existing, errors);
    }

    // Update metrics
    existing.connectionStatus = status;
    existing.responseTime = responseTimeStats;
    existing.lastActivity = now;
    
    this.metrics.set(serverId, existing);

    // Emit monitoring event
    this.emitEvent({
      type: 'health_check',
      serverId,
      timestamp: now,
      data: result,
      severity: status.status === 'healthy' ? 'info' : 
               status.status === 'degraded' ? 'warning' : 'error'
    });
  }

  /**
   * Update response time history and calculate statistics
   */
  private updateResponseTimeMetrics(serverId: string, responseTime: number): void {
    if (responseTime < 0) return; // Skip invalid response times

    let history = this.responseTimeHistory.get(serverId) || [];
    history.push(responseTime);
    
    // Keep only last 100 measurements
    if (history.length > 100) {
      history = history.slice(-100);
    }
    
    this.responseTimeHistory.set(serverId, history);
  }

  /**
   * Calculate response time statistics
   */
  private calculateResponseTimeStats(serverId: string): ServerHealthMetrics['responseTime'] {
    const history = this.responseTimeHistory.get(serverId) || [];
    
    if (history.length === 0) {
      return { current: 0, average: 0, percentile95: 0 };
    }

    const current = history[history.length - 1] || 0;
    const average = history.reduce((sum, time) => sum + time, 0) / history.length;
    
    const sorted = [...history].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const percentile95 = sorted[p95Index] || 0;

    return { current, average, percentile95 };
  }

  /**
   * Update error summary with new errors
   */
  private updateErrorSummary(metrics: ServerHealthMetrics, errors: Error[]): void {
    for (const error of errors) {
      const errorType = error.constructor.name;
      const existing = metrics.errors.find(e => e.type === errorType);
      
      if (existing) {
        existing.count++;
        existing.lastOccurrence = new Date();
      } else {
        metrics.errors.push({
          type: errorType,
          count: 1,
          lastOccurrence: new Date(),
          severity: error instanceof MCPError ? 'high' : 'medium'
        });
      }
    }

    // Keep only last 10 error types
    if (metrics.errors.length > 10) {
      metrics.errors.sort((a, b) => b.lastOccurrence.getTime() - a.lastOccurrence.getTime());
      metrics.errors = metrics.errors.slice(0, 10);
    }
  }

  /**
   * Calculate overall system health
   */
  private calculateOverallHealth(
    healthy: number,
    unhealthy: number,
    degraded: number
  ): HealthStatus {
    const total = healthy + unhealthy + degraded;
    
    if (total === 0) {
      return {
        status: 'unknown',
        timestamp: new Date(),
        details: 'No servers connected'
      };
    }

    const unhealthyPercentage = (unhealthy / total) * 100;

    if (unhealthyPercentage > 50) {
      return {
        status: 'unhealthy',
        timestamp: new Date(),
        details: `${unhealthyPercentage.toFixed(1)}% of servers are unhealthy`
      };
    }

    if (unhealthyPercentage > 20 || degraded > 0) {
      return {
        status: 'degraded',
        timestamp: new Date(),
        details: `${unhealthyPercentage.toFixed(1)}% unhealthy, ${degraded} degraded`
      };
    }

    return {
      status: 'healthy',
      timestamp: new Date(),
      details: `All ${total} servers are healthy`
    };
  }

  /**
   * Clean up metrics for servers that are no longer connected
   */
  private cleanupDisconnectedServers(connectedServers: string[]): void {
    const connectedSet = new Set(connectedServers);
    
    for (const serverId of this.metrics.keys()) {
      if (!connectedSet.has(serverId)) {
        this.metrics.delete(serverId);
        this.responseTimeHistory.delete(serverId);
        
        logger.debug('Cleaned up metrics for disconnected server', { serverId });
      }
    }
  }

  /**
   * Emit monitoring event to all handlers
   */
  private emitEvent(event: MonitoringEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        logger.error('Error in monitoring event handler', error as Error);
      }
    }
  }

  /**
   * Get monitoring status
   */
  public isActive(): boolean {
    return this.isMonitoring;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<HealthMonitorConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart monitoring if interval changed
    if (this.isMonitoring && config.healthCheckInterval) {
      this.stopMonitoring();
      this.startMonitoring();
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): HealthMonitorConfig {
    return { ...this.config };
  }
}