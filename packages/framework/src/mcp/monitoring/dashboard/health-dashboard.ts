/**
 * Health monitoring dashboard - real-time status display and metrics visualization
 */

import type { MCPClient } from '../../core/base/mcp-client.js';
import { ServerHealthMonitor } from '../health/server-health-monitor.js';
import { ErrorReporter } from '../errors/error-reporter.js';
import { ReconnectionManager } from '../reconnection/reconnection-manager.js';
import { logger } from '../../../utils/logger.js';
import type {
  SystemHealthReport,
  ServerHealthMetrics,
  DashboardConfig,
  MonitoringEvent,
  HealthMonitorOptions
} from '../types/index.js';

export interface DashboardUpdate {
  type: 'full' | 'incremental';
  timestamp: Date;
  data: {
    systemHealth?: SystemHealthReport;
    serverMetrics?: Record<string, ServerHealthMetrics>;
    errorSummary?: {
      recentErrors: number;
      criticalErrors: number;
      errorsByCategory: Record<string, number>;
    };
    reconnectionStatus?: {
      activeReconnections: number;
      successfulReconnections: number;
      circuitBreakerOpenCount: number;
    };
  };
}

export interface DashboardAlert {
  id: string;
  type: 'error' | 'warning' | 'info' | 'success';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  timestamp: Date;
  serverId?: string;
  autoHide?: boolean;
  actions?: Array<{
    label: string;
    action: () => void;
  }>;
}

export type DashboardUpdateHandler = (update: DashboardUpdate) => void;
export type DashboardAlertHandler = (alert: DashboardAlert) => void;

export class HealthDashboard {
  private mcpClient: MCPClient;
  private healthMonitor: ServerHealthMonitor;
  private errorReporter: ErrorReporter;
  private reconnectionManager: ReconnectionManager;
  private config: DashboardConfig;
  
  private updateHandlers: Set<DashboardUpdateHandler> = new Set();
  private alertHandlers: Set<DashboardAlertHandler> = new Set();
  private updateInterval: NodeJS.Timeout | null = null;
  private alerts: Map<string, DashboardAlert> = new Map();
  private isActive = false;

  constructor(
    mcpClient: MCPClient,
    healthMonitor: ServerHealthMonitor,
    errorReporter: ErrorReporter,
    reconnectionManager: ReconnectionManager,
    config: Partial<DashboardConfig> = {}
  ) {
    this.mcpClient = mcpClient;
    this.healthMonitor = healthMonitor;
    this.errorReporter = errorReporter;
    this.reconnectionManager = reconnectionManager;
    
    this.config = {
      refreshInterval: 5000, // 5 seconds
      theme: 'auto',
      layout: {
        showMetrics: true,
        showErrors: true,
        showReconnections: true,
        compactMode: false
      },
      alerts: {
        showNotifications: true,
        soundEnabled: false,
        autoHide: true,
        autoHideDelay: 10000 // 10 seconds
      },
      ...config
    };
  }

  /**
   * Start the dashboard monitoring
   */
  public start(): void {
    if (this.isActive) {
      logger.warn('Health dashboard is already active');
      return;
    }

    logger.info('Starting health monitoring dashboard', {
      refreshInterval: this.config.refreshInterval,
      theme: this.config.theme
    });

    this.isActive = true;
    this.setupEventListeners();
    this.scheduleUpdates();
    
    // Send initial full update
    this.sendUpdate('full');
  }

  /**
   * Stop the dashboard monitoring
   */
  public stop(): void {
    if (!this.isActive) {
      return;
    }

    logger.info('Stopping health monitoring dashboard');

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.cleanup();
    this.isActive = false;
  }

  /**
   * Add update handler for dashboard data changes
   */
  public addUpdateHandler(handler: DashboardUpdateHandler): void {
    this.updateHandlers.add(handler);
  }

  /**
   * Remove update handler
   */
  public removeUpdateHandler(handler: DashboardUpdateHandler): void {
    this.updateHandlers.delete(handler);
  }

  /**
   * Add alert handler for dashboard alerts
   */
  public addAlertHandler(handler: DashboardAlertHandler): void {
    this.alertHandlers.add(handler);
  }

  /**
   * Remove alert handler
   */
  public removeAlertHandler(handler: DashboardAlertHandler): void {
    this.alertHandlers.delete(handler);
  }

  /**
   * Get current system health snapshot
   */
  public getHealthSnapshot(): SystemHealthReport {
    return this.healthMonitor.getSystemHealthReport();
  }

  /**
   * Get connected servers count
   */
  public getConnectedServersCount(): number {
    return this.mcpClient.getConnectedServers().length;
  }

  /**
   * Get error statistics
   */
  public getErrorStatistics(): ReturnType<ErrorReporter['getErrorStatistics']> {
    return this.errorReporter.getErrorStatistics();
  }

  /**
   * Get reconnection statistics for all servers
   */
  public getReconnectionStatistics(): Record<string, ReturnType<ReconnectionManager['getReconnectionStats']>> {
    const stats = this.reconnectionManager.getAllReconnectionStats();
    const result: Record<string, ReturnType<ReconnectionManager['getReconnectionStats']>> = {};
    
    for (const [serverId, stat] of Object.entries(stats)) {
      result[serverId] = stat;
    }
    
    return result;
  }

  /**
   * Manually refresh dashboard data
   */
  public async refresh(): Promise<void> {
    if (!this.isActive) {
      throw new Error('Dashboard must be started before refresh');
    }

    logger.debug('Manually refreshing dashboard data');
    
    // Trigger health check
    await this.healthMonitor.performHealthCheck();
    
    // Send full update
    this.sendUpdate('full');
  }

  /**
   * Update dashboard configuration
   */
  public updateConfig(config: Partial<DashboardConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart updates if interval changed
    if (this.isActive && config.refreshInterval) {
      this.stop();
      this.start();
    }

    logger.debug('Dashboard configuration updated', { config });
  }

  /**
   * Get current configuration
   */
  public getConfig(): DashboardConfig {
    return { ...this.config };
  }

  /**
   * Dismiss an alert
   */
  public dismissAlert(alertId: string): boolean {
    const dismissed = this.alerts.delete(alertId);
    if (dismissed) {
      logger.debug('Alert dismissed', { alertId });
    }
    return dismissed;
  }

  /**
   * Clear all alerts
   */
  public clearAllAlerts(): void {
    const count = this.alerts.size;
    this.alerts.clear();
    logger.debug('All alerts cleared', { count });
  }

  /**
   * Get all active alerts
   */
  public getActiveAlerts(): DashboardAlert[] {
    return Array.from(this.alerts.values()).sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Check if dashboard is active
   */
  public isDashboardActive(): boolean {
    return this.isActive;
  }

  /**
   * Setup event listeners for monitoring components
   */
  private setupEventListeners(): void {
    // Health monitoring events
    this.healthMonitor.addEventHandler(this.handleHealthEvent.bind(this));
    
    // Error reporting events
    this.errorReporter.addErrorHandler(this.handleErrorEvent.bind(this));
    
    // Reconnection events
    this.reconnectionManager.addReconnectionHandler(this.handleReconnectionEvent.bind(this));
  }

  /**
   * Handle health monitoring events
   */
  private handleHealthEvent(event: MonitoringEvent): void {
    if (event.type === 'health_check') {
      this.sendUpdate('incremental');
      
      // Create alert for unhealthy servers
      if (event.severity === 'error' || event.severity === 'critical') {
        this.createAlert({
          type: 'error',
          severity: event.severity === 'error' ? 'high' : 'critical',
          title: 'Server Health Issue',
          message: `Server ${event.serverId} is ${event.severity === 'critical' ? 'critical' : 'unhealthy'}`,
          serverId: event.serverId,
          autoHide: false
        });
      }
    }
  }

  /**
   * Handle error reporting events
   */
  private handleErrorEvent(error: Error, context: Record<string, unknown>): void {
    const severity = (context['severity'] as DashboardAlert['severity']) || 'medium';
    
    if (severity === 'critical' || severity === 'high') {
      this.createAlert({
        type: 'error',
        severity,
        title: 'Critical Error Detected',
        message: error.message,
        serverId: context['serverId'] as string,
        autoHide: severity === 'high'
      });
    }
    
    this.sendUpdate('incremental');
  }

  /**
   * Handle reconnection events
   */
  private handleReconnectionEvent(serverId: string, attempt: number, success: boolean): void {
    if (success) {
      this.createAlert({
        type: 'success',
        severity: 'low',
        title: 'Reconnection Successful',
        message: `Successfully reconnected to server ${serverId} after ${attempt} attempts`,
        serverId,
        autoHide: true
      });
    } else if (attempt >= 3) {
      this.createAlert({
        type: 'warning',
        severity: 'medium',
        title: 'Reconnection Struggling',
        message: `Failed to reconnect to server ${serverId} after ${attempt} attempts`,
        serverId,
        autoHide: false,
        actions: [{
          label: 'Reset Circuit Breaker',
          action: (): void => {
            try {
              this.reconnectionManager.resetCircuitBreaker(serverId);
            } catch (error) {
              logger.error('Failed to reset circuit breaker', error as Error, { serverId });
            }
          }
        }]
      });
    }
    
    this.sendUpdate('incremental');
  }

  /**
   * Create and dispatch a dashboard alert
   */
  private createAlert(alertInfo: Omit<DashboardAlert, 'id' | 'timestamp'>): void {
    const alert: DashboardAlert = {
      id: this.generateAlertId(),
      timestamp: new Date(),
      ...alertInfo
    };

    this.alerts.set(alert.id, alert);
    
    // Notify alert handlers
    for (const handler of this.alertHandlers) {
      try {
        handler(alert);
      } catch (error) {
        logger.error('Error in dashboard alert handler', error as Error);
      }
    }

    // Auto-hide if configured
    if (alert.autoHide && this.config.alerts.autoHide) {
      setTimeout(() => {
        this.dismissAlert(alert.id);
      }, this.config.alerts.autoHideDelay);
    }

    logger.debug('Dashboard alert created', {
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity
    });
  }

  /**
   * Generate unique alert ID
   */
  private generateAlertId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `alert_${timestamp}_${random}`;
  }

  /**
   * Schedule periodic dashboard updates
   */
  private scheduleUpdates(): void {
    this.updateInterval = setInterval(() => {
      if (this.isActive) {
        this.sendUpdate('incremental');
      }
    }, this.config.refreshInterval);
  }

  /**
   * Send dashboard update to all handlers
   */
  private sendUpdate(type: DashboardUpdate['type']): void {
    try {
      const update: DashboardUpdate = {
        type,
        timestamp: new Date(),
        data: this.gatherUpdateData(type)
      };

      for (const handler of this.updateHandlers) {
        try {
          handler(update);
        } catch (error) {
          logger.error('Error in dashboard update handler', error as Error);
        }
      }

      logger.debug('Dashboard update sent', { type, dataKeys: Object.keys(update.data) });
      
    } catch (error) {
      logger.error('Failed to send dashboard update', error as Error);
    }
  }

  /**
   * Gather update data based on type and configuration
   */
  private gatherUpdateData(type: DashboardUpdate['type']): DashboardUpdate['data'] {
    const data: DashboardUpdate['data'] = {};

    try {
      // Always include system health for full updates
      if (type === 'full' || this.config.layout.showMetrics) {
        data.systemHealth = this.healthMonitor.getSystemHealthReport();
        
        if (this.config.layout.showMetrics) {
          data.serverMetrics = data.systemHealth.servers;
        }
      }

      // Include error summary if enabled
      if (this.config.layout.showErrors) {
        const errorStats = this.errorReporter.getErrorStatistics();
        data.errorSummary = {
          recentErrors: errorStats.recentErrors.length,
          criticalErrors: errorStats.errorsBySeverity.critical,
          errorsByCategory: errorStats.errorsByCategory
        };
      }

      // Include reconnection status if enabled
      if (this.config.layout.showReconnections) {
        const reconnectionStats = this.reconnectionManager.getAllReconnectionStats();
        let activeReconnections = 0;
        let successfulReconnections = 0;
        let circuitBreakerOpenCount = 0;

        for (const stats of Object.values(reconnectionStats)) {
          successfulReconnections += stats.successfulReconnections;
          if (stats.circuitBreakerState === 'open') {
            circuitBreakerOpenCount++;
          }
          // Count as active if last attempt was recent and failed
          if (stats.lastAttempt && 
              stats.lastSuccess && 
              stats.lastAttempt > stats.lastSuccess &&
              Date.now() - stats.lastAttempt.getTime() < 60000) { // Within last minute
            activeReconnections++;
          }
        }

        data.reconnectionStatus = {
          activeReconnections,
          successfulReconnections,
          circuitBreakerOpenCount
        };
      }

    } catch (error) {
      logger.error('Error gathering dashboard update data', error as Error);
    }

    return data;
  }

  /**
   * Clean up resources and event listeners
   */
  private cleanup(): void {
    try {
      this.healthMonitor.removeEventHandler(this.handleHealthEvent.bind(this));
      this.errorReporter.removeErrorHandler(this.handleErrorEvent.bind(this));
      this.reconnectionManager.removeReconnectionHandler(this.handleReconnectionEvent.bind(this));
    } catch (error) {
      logger.error('Error during dashboard cleanup', error as Error);
    }
  }
}

/**
 * Create a health dashboard with monitoring components
 */
export function createHealthDashboard(
  mcpClient: MCPClient,
  options: HealthMonitorOptions = {}
): HealthDashboard {
  const healthMonitor = new ServerHealthMonitor(mcpClient, options.healthConfig);
  const errorReporter = new ErrorReporter(options.errorConfig);
  const reconnectionManager = new ReconnectionManager(mcpClient, options.reconnectionConfig);
  
  const dashboard = new HealthDashboard(
    mcpClient,
    healthMonitor,
    errorReporter,
    reconnectionManager,
    options.dashboardConfig
  );

  // Setup default event handlers if provided
  if (options.eventHandlers?.onHealthChange) {
    healthMonitor.addEventHandler(options.eventHandlers.onHealthChange);
  }
  
  if (options.eventHandlers?.onError) {
    errorReporter.addErrorHandler(options.eventHandlers.onError);
  }
  
  if (options.eventHandlers?.onReconnection) {
    reconnectionManager.addReconnectionHandler(options.eventHandlers.onReconnection);
  }

  return dashboard;
}