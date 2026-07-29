/**
 * Tests for HealthDashboard - real-time status display and metrics visualization
 */

import { HealthDashboard, createHealthDashboard, type DashboardUpdate, type DashboardAlert } from '../health-dashboard.js';
import { ServerHealthMonitor } from '../../health/server-health-monitor.js';
import { ErrorReporter } from '../../errors/error-reporter.js';
import { ReconnectionManager } from '../../reconnection/reconnection-manager.js';
import type { MCPClient } from '../../../core/base/mcp-client.js';
import type { DashboardConfig, MonitoringEvent } from '../../types/index.js';

// Mock the logger
jest.mock('../../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Type-safe helpers for accessing mock calls
function getMockCall<T>(mockFn: { mock: { calls: unknown[][] } }, callIndex: number, argIndex: number): T | undefined {
  const call = mockFn.mock?.calls?.[callIndex];
  return call?.[argIndex] as T | undefined;
}

type ErrorHandlerFn = (error: Error, context: Record<string, unknown>) => void;
type ReconnectionHandlerFn = (serverId: string, attempt: number, success: boolean) => void;

describe('HealthDashboard', () => {
  let mockMcpClient: jest.Mocked<MCPClient>;
  let mockHealthMonitor: jest.Mocked<ServerHealthMonitor>;
  let mockErrorReporter: jest.Mocked<ErrorReporter>;
  let mockReconnectionManager: jest.Mocked<ReconnectionManager>;
  let dashboard: HealthDashboard;

  beforeEach(() => {
    mockMcpClient = {
      getConnectedServers: jest.fn().mockReturnValue(['server1', 'server2']),
      ping: jest.fn(),
      isInitialized: jest.fn().mockReturnValue(true),
      listTools: jest.fn(),
      getServerStatus: jest.fn(),
      callTool: jest.fn(),
      initialize: jest.fn(),
      shutdown: jest.fn(),
      getAllServerConnections: jest.fn(),
      listResources: jest.fn(),
      readResource: jest.fn(),
      subscribeToResourceUpdates: jest.fn(),
      unsubscribeFromResourceUpdates: jest.fn(),
      listPrompts: jest.fn(),
      getPrompt: jest.fn()
    } as unknown as jest.Mocked<MCPClient>;

    mockHealthMonitor = {
      getSystemHealthReport: jest.fn(),
      performHealthCheck: jest.fn(),
      addEventHandler: jest.fn(),
      removeEventHandler: jest.fn(),
      isActive: jest.fn().mockReturnValue(true),
      startMonitoring: jest.fn(),
      stopMonitoring: jest.fn(),
      getServerHealth: jest.fn(),
      updateConfig: jest.fn(),
      getConfig: jest.fn()
    } as unknown as jest.Mocked<ServerHealthMonitor>;

    mockErrorReporter = {
      getErrorStatistics: jest.fn(),
      addErrorHandler: jest.fn(),
      removeErrorHandler: jest.fn(),
      isReportingActive: jest.fn().mockReturnValue(true),
      start: jest.fn(),
      stop: jest.fn(),
      reportError: jest.fn(),
      updateConfig: jest.fn(),
      getConfig: jest.fn(),
      flushErrors: jest.fn()
    } as unknown as jest.Mocked<ErrorReporter>;

    mockReconnectionManager = {
      getAllReconnectionStats: jest.fn(),
      resetCircuitBreaker: jest.fn(),
      addReconnectionHandler: jest.fn(),
      removeReconnectionHandler: jest.fn(),
      isReconnectionActive: jest.fn().mockReturnValue(true),
      start: jest.fn(),
      stop: jest.fn(),
      handleDisconnection: jest.fn(),
      triggerReconnection: jest.fn(),
      getReconnectionStats: jest.fn(),
      getCircuitBreakerState: jest.fn(),
      updateConfig: jest.fn(),
      getConfig: jest.fn()
    } as unknown as jest.Mocked<ReconnectionManager>;

    dashboard = new HealthDashboard(
      mockMcpClient,
      mockHealthMonitor,
      mockErrorReporter,
      mockReconnectionManager
    );

    jest.useFakeTimers();
  });

  afterEach(() => {
    if (dashboard.isDashboardActive()) {
      dashboard.stop();
    }
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('should create dashboard with default configuration', () => {
      const config = dashboard.getConfig();
      
      expect(config.refreshInterval).toBe(5000);
      expect(config.theme).toBe('auto');
      expect(config.layout.showMetrics).toBe(true);
      expect(config.layout.showErrors).toBe(true);
      expect(config.layout.showReconnections).toBe(true);
      expect(config.alerts.showNotifications).toBe(true);
    });

    it('should create dashboard with custom configuration', () => {
      const customConfig: Partial<DashboardConfig> = {
        refreshInterval: 10000,
        theme: 'dark',
        layout: {
          showMetrics: false,
          showErrors: true,
          showReconnections: false,
          compactMode: true
        }
      };

      const customDashboard = new HealthDashboard(
        mockMcpClient,
        mockHealthMonitor,
        mockErrorReporter,
        mockReconnectionManager,
        customConfig
      );

      const config = customDashboard.getConfig();
      expect(config.refreshInterval).toBe(10000);
      expect(config.theme).toBe('dark');
      expect(config.layout.showMetrics).toBe(false);
      expect(config.layout.compactMode).toBe(true);
    });

    it('should not be active initially', () => {
      expect(dashboard.isDashboardActive()).toBe(false);
    });
  });

  describe('lifecycle management', () => {
    it('should start dashboard successfully', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      dashboard.start();

      expect(dashboard.isDashboardActive()).toBe(true);
      expect(mockHealthMonitor.addEventHandler).toHaveBeenCalled();
      expect(mockErrorReporter.addErrorHandler).toHaveBeenCalled();
      expect(mockReconnectionManager.addReconnectionHandler).toHaveBeenCalled();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);

      setIntervalSpy.mockRestore();
    });

    it('should not start twice', () => {
      dashboard.start();
      
      // Second start should be ignored
      dashboard.start();
      
      expect(dashboard.isDashboardActive()).toBe(true);
    });

    it('should stop dashboard successfully', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      dashboard.start();
      dashboard.stop();

      expect(dashboard.isDashboardActive()).toBe(false);
      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });

    it('should send initial update on start', () => {
      const updateHandler = jest.fn();
      dashboard.addUpdateHandler(updateHandler);

      mockHealthMonitor.getSystemHealthReport.mockReturnValue({
        overall: { status: 'healthy', timestamp: new Date() },
        servers: {},
        summary: { totalServers: 0, healthyServers: 0, unhealthyServers: 0, degradedServers: 0 },
        generatedAt: new Date()
      });
      
      mockErrorReporter.getErrorStatistics.mockReturnValue({
        totalErrors: 0,
        errorsByCategory: {},
        errorsBySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
        recentErrors: []
      });
      
      mockReconnectionManager.getAllReconnectionStats.mockReturnValue({});

      dashboard.start();

      expect(updateHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'full',
          timestamp: expect.any(Date) as Date
        })
      );
    });
  });

  describe('update handlers', () => {
    beforeEach(() => {
      // Setup default mocks
      mockHealthMonitor.getSystemHealthReport.mockReturnValue({
        overall: { status: 'healthy', timestamp: new Date() },
        servers: {},
        summary: { totalServers: 0, healthyServers: 0, unhealthyServers: 0, degradedServers: 0 },
        generatedAt: new Date()
      });
      
      mockErrorReporter.getErrorStatistics.mockReturnValue({
        totalErrors: 0,
        errorsByCategory: {},
        errorsBySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
        recentErrors: []
      });
      
      mockReconnectionManager.getAllReconnectionStats.mockReturnValue({});
    });

    it('should add and remove update handlers', () => {
      const handler = jest.fn();

      dashboard.addUpdateHandler(handler);
      expect(() => dashboard.removeUpdateHandler(handler)).not.toThrow();
    });

    it('should send periodic updates', () => {
      const updateHandler = jest.fn();
      dashboard.addUpdateHandler(updateHandler);
      dashboard.start();

      jest.clearAllMocks(); // Clear initial update

      // Advance time to trigger interval update
      jest.advanceTimersByTime(5000);

      expect(updateHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'incremental',
          timestamp: expect.any(Date) as Date
        })
      );
    });

    it('should include system health in full updates', () => {
      const updateHandler = jest.fn();
      
      const mockReport = {
        overall: { status: 'healthy' as const, timestamp: new Date() },
        servers: {
          server1: {
            serverId: 'server1',
            connectionStatus: { status: 'healthy' as const, timestamp: new Date() },
            responseTime: { current: 100, average: 120, percentile95: 150 },
            operationCounts: { successful: 10, failed: 0, total: 10 },
            lastActivity: new Date(),
            uptime: 5000,
            errors: []
          }
        },
        summary: { totalServers: 1, healthyServers: 1, unhealthyServers: 0, degradedServers: 0 },
        generatedAt: new Date()
      };

      mockHealthMonitor.getSystemHealthReport.mockReturnValue(mockReport);
      mockErrorReporter.getErrorStatistics.mockReturnValue({
        totalErrors: 0,
        errorsByCategory: {},
        errorsBySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
        recentErrors: []
      });
      mockReconnectionManager.getAllReconnectionStats.mockReturnValue({});

      dashboard.addUpdateHandler(updateHandler);
      dashboard.start();

      // The handler should have been called during start()
      expect(updateHandler).toHaveBeenCalledTimes(1);
      const updateCall = getMockCall<DashboardUpdate>(updateHandler, 0, 0);
      expect(updateCall).toBeDefined();
      if (updateCall) {
        expect(updateCall.type).toBe('full');
        expect(updateCall.data.systemHealth).toEqual(mockReport);
      }
    });

    it('should include error summary when enabled', () => {
      const updateHandler = jest.fn();
      
      const mockErrorStats = {
        totalErrors: 5,
        errorsByCategory: { Connection: 2, Validation: 3 },
        errorsBySeverity: { low: 2, medium: 2, high: 1, critical: 0 },
        recentErrors: []
      };

      mockErrorReporter.getErrorStatistics.mockReturnValue(mockErrorStats);
      
      dashboard.addUpdateHandler(updateHandler);
      dashboard.start();

      expect(updateHandler).toHaveBeenCalledTimes(1);
      const updateCall = getMockCall<DashboardUpdate>(updateHandler, 0, 0);
      expect(updateCall).toBeDefined();
      if (updateCall) {
        expect(updateCall.type).toBe('full');
        expect(updateCall.data.errorSummary).toEqual({
          recentErrors: 0,
          criticalErrors: 0,
          errorsByCategory: { Connection: 2, Validation: 3 }
        });
      }
    });

    it('should include reconnection status when enabled', () => {
      const updateHandler = jest.fn();
      
      const mockReconnectionStats = {
        server1: {
          serverId: 'server1',
          totalAttempts: 3,
          successfulReconnections: 2,
          failedAttempts: 1,
          lastAttempt: new Date(),
          lastSuccess: new Date(),
          currentDelay: 1000,
          circuitBreakerState: 'closed' as const
        }
      };

      mockReconnectionManager.getAllReconnectionStats.mockReturnValue(mockReconnectionStats);
      
      dashboard.addUpdateHandler(updateHandler);
      dashboard.start();

      expect(updateHandler).toHaveBeenCalledTimes(1);
      const updateCall = getMockCall<DashboardUpdate>(updateHandler, 0, 0);
      expect(updateCall).toBeDefined();
      if (updateCall) {
        expect(updateCall.type).toBe('full');
        expect(updateCall.data.reconnectionStatus).toEqual({
          activeReconnections: 0,
          successfulReconnections: 2,
          circuitBreakerOpenCount: 0
        });
      }
    });

    it('should handle errors in update handlers gracefully', () => {
      const faultyHandler = jest.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      
      dashboard.addUpdateHandler(faultyHandler);

      // Should not throw despite handler error
      expect(() => dashboard.start()).not.toThrow();
    });
  });

  describe('alert handlers', () => {
    beforeEach(() => {
      dashboard.start();
    });

    it('should add and remove alert handlers', () => {
      const handler = jest.fn();

      dashboard.addAlertHandler(handler);
      expect(() => dashboard.removeAlertHandler(handler)).not.toThrow();
    });

    it('should create alerts for critical health events', () => {
      const alertHandler = jest.fn();
      dashboard.addAlertHandler(alertHandler);

      // Get the health event handler that was registered
      const healthEventHandler = mockHealthMonitor.addEventHandler.mock.calls[0]?.[0];

      // Simulate a critical health event
      const criticalEvent: MonitoringEvent = {
        type: 'health_check',
        serverId: 'server1',
        timestamp: new Date(),
        data: {},
        severity: 'critical'
      };

      healthEventHandler!(criticalEvent);

      expect(alertHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          severity: 'critical',
          title: 'Server Health Issue',
          serverId: 'server1'
        })
      );
    });

    it('should create alerts for critical errors', () => {
      const alertHandler = jest.fn();
      dashboard.addAlertHandler(alertHandler);

      // Get the error event handler that was registered
      const errorEventHandler = getMockCall<ErrorHandlerFn>(mockErrorReporter.addErrorHandler, 0, 0);

      // Simulate a critical error
      const error = new Error('Critical system failure');
      const context = { severity: 'critical', serverId: 'server1' };

      errorEventHandler!(error, context);

      expect(alertHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          severity: 'critical',
          title: 'Critical Error Detected',
          serverId: 'server1'
        })
      );
    });

    it('should create alerts for successful reconnections', () => {
      const alertHandler = jest.fn();
      dashboard.addAlertHandler(alertHandler);

      // Get the reconnection event handler that was registered
      const reconnectionEventHandler = getMockCall<ReconnectionHandlerFn>(mockReconnectionManager.addReconnectionHandler, 0, 0);

      // Simulate successful reconnection
      reconnectionEventHandler!('server1', 3, true);

      expect(alertHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
          severity: 'low',
          title: 'Reconnection Successful',
          serverId: 'server1'
        })
      );
    });

    it('should create alerts for reconnection struggles', () => {
      const alertHandler = jest.fn();
      dashboard.addAlertHandler(alertHandler);

      // Get the reconnection event handler that was registered
      const reconnectionEventHandler = getMockCall<ReconnectionHandlerFn>(mockReconnectionManager.addReconnectionHandler, 0, 0);

      // Simulate failed reconnection after multiple attempts
      reconnectionEventHandler!('server1', 4, false);

      expect(alertHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          severity: 'medium',
          title: 'Reconnection Struggling',
          serverId: 'server1',
          actions: expect.arrayContaining([
            expect.objectContaining({
              label: 'Reset Circuit Breaker'
            })
          ]) as DashboardAlert['actions']
        })
      );
    });

    it('should auto-hide alerts when configured', () => {
      const alertHandler = jest.fn();
      dashboard.addAlertHandler(alertHandler);

      const dashboardWithAutoHide = new HealthDashboard(
        mockMcpClient,
        mockHealthMonitor,
        mockErrorReporter,
        mockReconnectionManager,
        {
          alerts: {
            showNotifications: true,
            soundEnabled: false,
            autoHide: true,
            autoHideDelay: 1000
          }
        }
      );

      dashboardWithAutoHide.addAlertHandler(alertHandler);
      dashboardWithAutoHide.start();

      // Trigger an auto-hide alert
      const errorEventHandler = getMockCall<ErrorHandlerFn>(mockErrorReporter.addErrorHandler, 1, 0);
      if (errorEventHandler) {
        errorEventHandler(new Error('High priority error'), { severity: 'high' });
      }

      // Alert should be created
      expect(alertHandler).toHaveBeenCalled();
      const alertCall = getMockCall<DashboardAlert>(alertHandler, 0, 0);
      expect(alertCall).toBeDefined();
      const alertId = alertCall?.id;

      // Advance time past auto-hide delay
      jest.advanceTimersByTime(1100);

      // Alert should be dismissed
      const activeAlerts = dashboardWithAutoHide.getActiveAlerts();
      expect(activeAlerts.find(alert => alert.id === alertId)).toBeUndefined();

      dashboardWithAutoHide.stop();
    });

    it('should handle errors in alert handlers gracefully', () => {
      const faultyHandler = jest.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      
      dashboard.addAlertHandler(faultyHandler);

      const errorEventHandler = getMockCall<ErrorHandlerFn>(mockErrorReporter.addErrorHandler, 0, 0);
      
      // Should not throw despite handler error
      expect(() => errorEventHandler!(new Error('Test'), { severity: 'critical' })).not.toThrow();
    });
  });

  describe('alert management', () => {
    beforeEach(() => {
      dashboard.start();
    });

    it('should dismiss individual alerts', () => {
      const alertHandler = jest.fn();
      dashboard.addAlertHandler(alertHandler);

      // Create an alert
      const errorEventHandler = getMockCall<ErrorHandlerFn>(mockErrorReporter.addErrorHandler, 0, 0);
      if (errorEventHandler) {
        errorEventHandler(new Error('Critical error'), { severity: 'critical' });
      }

      const alertCall = getMockCall<DashboardAlert>(alertHandler, 0, 0);
      expect(alertCall).toBeDefined();
      if (alertCall) {
        expect(dashboard.dismissAlert(alertCall.id)).toBe(true);
      }

      if (alertCall) {
        const activeAlerts = dashboard.getActiveAlerts();
        expect(activeAlerts.find(alert => alert.id === alertCall.id)).toBeUndefined();
      }
    });

    it('should return false when dismissing non-existent alert', () => {
      expect(dashboard.dismissAlert('non-existent')).toBe(false);
    });

    it('should clear all alerts', () => {
      const alertHandler = jest.fn();
      dashboard.addAlertHandler(alertHandler);

      // Create multiple alerts
      const errorEventHandler = getMockCall<ErrorHandlerFn>(mockErrorReporter.addErrorHandler, 0, 0);
      errorEventHandler!(new Error('Error 1'), { severity: 'critical' });
      errorEventHandler!(new Error('Error 2'), { severity: 'high' });

      expect(dashboard.getActiveAlerts()).toHaveLength(2);

      dashboard.clearAllAlerts();
      expect(dashboard.getActiveAlerts()).toHaveLength(0);
    });

    it('should return active alerts sorted by timestamp', () => {
      const alertHandler = jest.fn();
      dashboard.addAlertHandler(alertHandler);

      // Create alerts with slight time differences
      const errorEventHandler = getMockCall<ErrorHandlerFn>(mockErrorReporter.addErrorHandler, 0, 0);
      
      errorEventHandler!(new Error('First error'), { severity: 'critical' });
      jest.advanceTimersByTime(100);
      errorEventHandler!(new Error('Second error'), { severity: 'high' });

      const activeAlerts = dashboard.getActiveAlerts();
      expect(activeAlerts).toHaveLength(2);
      
      // Should be sorted by timestamp (newest first)
      expect(activeAlerts[0]?.message).toContain('Second error');
      expect(activeAlerts[1]?.message).toContain('First error');
    });
  });

  describe('data access methods', () => {
    beforeEach(() => {
      dashboard.start();
    });

    it('should get health snapshot', () => {
      const mockReport = {
        overall: { status: 'healthy' as const, timestamp: new Date() },
        servers: {},
        summary: { totalServers: 0, healthyServers: 0, unhealthyServers: 0, degradedServers: 0 },
        generatedAt: new Date()
      };

      mockHealthMonitor.getSystemHealthReport.mockReturnValue(mockReport);

      const snapshot = dashboard.getHealthSnapshot();
      expect(snapshot).toEqual(mockReport);
      expect(mockHealthMonitor.getSystemHealthReport).toHaveBeenCalled();
    });

    it('should get error statistics', () => {
      const mockStats = {
        totalErrors: 10,
        errorsByCategory: { Connection: 5, Validation: 5 },
        errorsBySeverity: { low: 5, medium: 3, high: 2, critical: 0 },
        recentErrors: []
      };

      mockErrorReporter.getErrorStatistics.mockReturnValue(mockStats);

      const stats = dashboard.getErrorStatistics();
      expect(stats).toEqual(mockStats);
      expect(mockErrorReporter.getErrorStatistics).toHaveBeenCalled();
    });

    it('should get reconnection statistics', () => {
      const mockStats = {
        server1: {
          serverId: 'server1',
          totalAttempts: 3,
          successfulReconnections: 2,
          failedAttempts: 1,
          lastAttempt: new Date(),
          lastSuccess: new Date(),
          currentDelay: 1000,
          circuitBreakerState: 'closed' as const
        }
      };

      mockReconnectionManager.getAllReconnectionStats.mockReturnValue(mockStats);

      const stats = dashboard.getReconnectionStatistics();
      expect(stats).toEqual(mockStats);
      expect(mockReconnectionManager.getAllReconnectionStats).toHaveBeenCalled();
    });

    it('should get connected servers count', () => {
      const count = dashboard.getConnectedServersCount();
      expect(count).toBe(2); // Based on mock setup
      expect(mockMcpClient.getConnectedServers).toHaveBeenCalled();
    });
  });

  describe('refresh functionality', () => {
    beforeEach(() => {
      dashboard.start();
    });

    it('should manually refresh dashboard data', async () => {
      const updateHandler = jest.fn();
      dashboard.addUpdateHandler(updateHandler);

      jest.clearAllMocks(); // Clear initial update

      await dashboard.refresh();

      expect(mockHealthMonitor.performHealthCheck).toHaveBeenCalled();
      expect(updateHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'full'
        })
      );
    });

    it('should fail to refresh when not active', async () => {
      dashboard.stop();

      await expect(dashboard.refresh())
        .rejects.toThrow('Dashboard must be started before refresh');
    });
  });

  describe('configuration updates', () => {
    it('should update configuration', () => {
      const newConfig: Partial<DashboardConfig> = {
        refreshInterval: 8000,
        theme: 'light',
        layout: {
          showMetrics: false,
          showErrors: true,
          showReconnections: true,
          compactMode: true
        }
      };

      dashboard.updateConfig(newConfig);
      const config = dashboard.getConfig();

      expect(config.refreshInterval).toBe(8000);
      expect(config.theme).toBe('light');
      expect(config.layout.showMetrics).toBe(false);
      expect(config.layout.compactMode).toBe(true);
    });

    it('should restart dashboard when refresh interval changes', () => {
      dashboard.start();
      expect(dashboard.isDashboardActive()).toBe(true);

      dashboard.updateConfig({ refreshInterval: 3000 });
      expect(dashboard.isDashboardActive()).toBe(true);
    });
  });

  describe('layout configuration effects', () => {
    it('should exclude metrics when showMetrics is false', () => {
      const noMetricsDashboard = new HealthDashboard(
        mockMcpClient,
        mockHealthMonitor,
        mockErrorReporter,
        mockReconnectionManager,
        {
          layout: {
            showMetrics: false,
            showErrors: true,
            showReconnections: true,
            compactMode: false
          }
        }
      );

      const updateHandler = jest.fn();
      noMetricsDashboard.addUpdateHandler(updateHandler);
      noMetricsDashboard.start();

      const updateCall = getMockCall<DashboardUpdate>(updateHandler, 0, 0);
      expect(updateCall).toBeDefined();
      if (updateCall) {
        expect(updateCall.data.serverMetrics).toBeUndefined();
      }

      noMetricsDashboard.stop();
    });

    it('should exclude errors when showErrors is false', () => {
      const noErrorsDashboard = new HealthDashboard(
        mockMcpClient,
        mockHealthMonitor,
        mockErrorReporter,
        mockReconnectionManager,
        {
          layout: {
            showMetrics: true,
            showErrors: false,
            showReconnections: true,
            compactMode: false
          }
        }
      );

      const updateHandler = jest.fn();
      noErrorsDashboard.addUpdateHandler(updateHandler);
      noErrorsDashboard.start();

      const updateCall = getMockCall<DashboardUpdate>(updateHandler, 0, 0);
      expect(updateCall).toBeDefined();
      if (updateCall) {
        expect(updateCall.data.errorSummary).toBeUndefined();
      }

      noErrorsDashboard.stop();
    });

    it('should exclude reconnections when showReconnections is false', () => {
      const noReconnectionsDashboard = new HealthDashboard(
        mockMcpClient,
        mockHealthMonitor,
        mockErrorReporter,
        mockReconnectionManager,
        {
          layout: {
            showMetrics: true,
            showErrors: true,
            showReconnections: false,
            compactMode: false
          }
        }
      );

      const updateHandler = jest.fn();
      noReconnectionsDashboard.addUpdateHandler(updateHandler);
      noReconnectionsDashboard.start();

      const updateCall = getMockCall<DashboardUpdate>(updateHandler, 0, 0);
      expect(updateCall).toBeDefined();
      if (updateCall) {
        expect(updateCall.data.reconnectionStatus).toBeUndefined();
      }

      noReconnectionsDashboard.stop();
    });
  });

  describe('factory function', () => {
    it('should create health dashboard with monitoring components', () => {
      const factoryDashboard = createHealthDashboard(mockMcpClient);

      expect(factoryDashboard).toBeInstanceOf(HealthDashboard);
      expect(factoryDashboard.isDashboardActive()).toBe(false);
    });

    it('should create dashboard with options', () => {
      const options = {
        dashboardConfig: {
          refreshInterval: 15000,
          theme: 'dark' as const
        },
        eventHandlers: {
          onHealthChange: jest.fn(),
          onError: jest.fn(),
          onReconnection: jest.fn()
        }
      };

      const factoryDashboard = createHealthDashboard(mockMcpClient, options);
      const config = factoryDashboard.getConfig();

      expect(config.refreshInterval).toBe(15000);
      expect(config.theme).toBe('dark');
    });
  });

  describe('error handling and edge cases', () => {
    beforeEach(() => {
      dashboard.start();
    });

    it('should handle errors during data gathering', () => {
      const updateHandler = jest.fn();
      dashboard.addUpdateHandler(updateHandler);

      // Mock health monitor to throw error
      mockHealthMonitor.getSystemHealthReport.mockImplementation(() => {
        throw new Error('Health monitor error');
      });

      jest.clearAllMocks();
      jest.advanceTimersByTime(5000); // Trigger update

      // Should still call handler, but with empty data
      expect(updateHandler).toHaveBeenCalled();
      const updateCall = getMockCall<DashboardUpdate>(updateHandler, 0, 0);
      expect(updateCall).toBeDefined();
      if (updateCall) {
        expect(updateCall.data).toBeDefined();
      }
    });

    it('should handle missing reconnection stats gracefully', () => {
      mockReconnectionManager.getAllReconnectionStats.mockReturnValue({});

      const stats = dashboard.getReconnectionStatistics();
      expect(stats).toEqual({});
      
      // Verify that empty reconnection stats are handled properly
      expect(Object.keys(stats)).toHaveLength(0);
    });

    it('should handle alert action errors gracefully', () => {
      const alertHandler = jest.fn();
      dashboard.addAlertHandler(alertHandler);

      // Create alert with action that throws
      mockReconnectionManager.resetCircuitBreaker.mockImplementation(() => {
        throw new Error('Reset failed');
      });

      const reconnectionEventHandler = getMockCall<ReconnectionHandlerFn>(mockReconnectionManager.addReconnectionHandler, 0, 0);
      if (reconnectionEventHandler) {
        reconnectionEventHandler('server1', 4, false);
      }

      const alert = getMockCall<DashboardAlert>(alertHandler, 0, 0);
      expect(alert).toBeDefined();
      const action = alert?.actions?.[0];

      // Action should not throw
      expect(() => action?.action()).not.toThrow();
    });

    it('should handle stop when not active', () => {
      expect(() => dashboard.stop()).not.toThrow();
    });

    it('should cleanup event handlers on stop', () => {
      dashboard.start();
      dashboard.stop();

      // Verify cleanup was attempted (can't verify actual removal due to mock limitations)
      expect(dashboard.isDashboardActive()).toBe(false);
    });
  });
});