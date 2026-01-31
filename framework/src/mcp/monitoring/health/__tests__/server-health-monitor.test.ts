/**
 * Tests for ServerHealthMonitor - tracks individual server status, connection health, and performance metrics
 */

import { ServerHealthMonitor } from '../server-health-monitor.js';
import type { MCPClient } from '../../../core/base/mcp-client.js';
import type { HealthMonitorConfig, MonitoringEvent } from '../../types/index.js';

// Mock the logger
jest.mock('../../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Type-safe helper for accessing mock calls
function getMockCall<T>(mockFn: { mock: { calls: unknown[][] } }, callIndex: number, argIndex: number): T | undefined {
  const call = mockFn.mock?.calls?.[callIndex];
  return call?.[argIndex] as T | undefined;
}

describe('ServerHealthMonitor', () => {
  let mockMcpClient: jest.Mocked<MCPClient>;
  let monitor: ServerHealthMonitor;

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

    monitor = new ServerHealthMonitor(mockMcpClient);
  });

  afterEach(() => {
    if (monitor.isActive()) {
      monitor.stopMonitoring();
    }
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('initialization', () => {
    it('should create monitor with default configuration', () => {
      const config = monitor.getConfig();
      
      expect(config.healthCheckInterval).toBe(30000);
      expect(config.responseTimeThreshold).toBe(5000);
      expect(config.errorRateThreshold).toBe(10);
      expect(config.enableDetailedMetrics).toBe(true);
    });

    it('should create monitor with custom configuration', () => {
      const customConfig: Partial<HealthMonitorConfig> = {
        healthCheckInterval: 10000,
        responseTimeThreshold: 3000,
        errorRateThreshold: 5
      };

      const customMonitor = new ServerHealthMonitor(mockMcpClient, customConfig);
      const config = customMonitor.getConfig();

      expect(config.healthCheckInterval).toBe(10000);
      expect(config.responseTimeThreshold).toBe(3000);
      expect(config.errorRateThreshold).toBe(5);
    });

    it('should not be active initially', () => {
      expect(monitor.isActive()).toBe(false);
    });
  });

  describe('monitoring lifecycle', () => {
    it('should start monitoring successfully', () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      monitor.startMonitoring();

      expect(monitor.isActive()).toBe(true);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);

      setIntervalSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should not start monitoring twice', () => {
      monitor.startMonitoring();
      
      // Second start should be ignored
      monitor.startMonitoring();
      
      expect(monitor.isActive()).toBe(true);
    });

    it('should stop monitoring successfully', () => {
      jest.useFakeTimers();
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      monitor.startMonitoring();
      monitor.stopMonitoring();

      expect(monitor.isActive()).toBe(false);
      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should handle stop when not active', () => {
      expect(() => monitor.stopMonitoring()).not.toThrow();
      expect(monitor.isActive()).toBe(false);
    });
  });

  describe('health checks', () => {
    beforeEach(() => {
      monitor.startMonitoring();
    });

    it('should perform health check for all connected servers', async () => {
      mockMcpClient.ping.mockResolvedValue(undefined);

      const results = await monitor.performHealthCheck();

      expect(results).toHaveLength(2);
      expect(mockMcpClient.ping).toHaveBeenCalledWith('server1');
      expect(mockMcpClient.ping).toHaveBeenCalledWith('server2');
      
      for (const result of results) {
        expect(result.serverId).toMatch(/^server[12]$/);
        expect(result.status.status).toBe('healthy');
        expect(result.metrics.responseTime).toBeGreaterThanOrEqual(0);
      }
    });

    it('should handle server ping failures', async () => {
      mockMcpClient.ping
        .mockResolvedValueOnce(undefined) // server1 succeeds
        .mockRejectedValueOnce(new Error('Connection failed')); // server2 fails

      const results = await monitor.performHealthCheck();

      expect(results).toHaveLength(2);
      
      const server1Result = results.find(r => r.serverId === 'server1');
      const server2Result = results.find(r => r.serverId === 'server2');

      expect(server1Result?.status.status).toBe('healthy');
      expect(server2Result?.status.status).toBe('unhealthy');
      expect(server2Result?.errors).toHaveLength(1);
    });

    it('should determine degraded status for slow responses', async () => {
      // Mock a slow response by delaying the ping
      mockMcpClient.ping.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 6000)); // Exceeds 5000ms threshold
      });

      const results = await monitor.performHealthCheck();
      const result = results[0];

      expect(result?.status.status).toBe('degraded');
      expect(result?.metrics.responseTime).toBeGreaterThan(5000);
    });

    it('should determine unhealthy status for very slow responses', async () => {
      // Mock a very slow response
      mockMcpClient.ping.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 11000)); // Exceeds 2x threshold
      });

      const results = await monitor.performHealthCheck();
      const result = results[0];

      expect(result?.status.status).toBe('unhealthy');
      expect(result?.metrics.responseTime).toBeGreaterThan(10000);
    });

    it('should clean up metrics for disconnected servers', async () => {
      // Initial health check with 2 servers
      mockMcpClient.ping.mockResolvedValue(undefined);
      await monitor.performHealthCheck();

      // One server disconnects
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);
      
      await monitor.performHealthCheck();

      // Server2 metrics should be cleaned up
      const server2Health = monitor.getServerHealth('server2');
      expect(server2Health).toBeNull();
    });
  });

  describe('event handlers', () => {
    it('should add and remove event handlers', () => {
      const handler = jest.fn();

      monitor.addEventHandler(handler);
      expect(() => monitor.removeEventHandler(handler)).not.toThrow();
    });

    it('should emit events during health checks', async () => {
      const handler = jest.fn();
      monitor.addEventHandler(handler);
      monitor.startMonitoring();

      mockMcpClient.ping.mockResolvedValue(undefined);
      await monitor.performHealthCheck();

      expect(handler).toHaveBeenCalledTimes(2); // One for each server
      
      const eventCall = getMockCall<MonitoringEvent>(handler, 0, 0);
      expect(eventCall).toBeDefined();
      if (eventCall) {
        expect(eventCall.type).toBe('health_check');
        expect(eventCall.serverId).toMatch(/^server[12]$/);
        expect(eventCall.severity).toBe('info');
      }
    });

    it('should emit error events for unhealthy servers', async () => {
      const handler = jest.fn();
      monitor.addEventHandler(handler);
      monitor.startMonitoring();

      mockMcpClient.ping.mockRejectedValue(new Error('Connection failed'));
      await monitor.performHealthCheck();

      const errorEvents = handler.mock.calls.filter(call => {
        const args = call as unknown[];
        const event = args?.[0] as MonitoringEvent | undefined;
        return event && typeof event === 'object' && 'severity' in event && event.severity === 'error';
      });
      expect(errorEvents).toHaveLength(2); // Both servers failed
    });

    it('should handle errors in event handlers gracefully', async () => {
      const faultyHandler = jest.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      
      monitor.addEventHandler(faultyHandler);
      monitor.startMonitoring();

      mockMcpClient.ping.mockResolvedValue(undefined);
      
      // Should not throw despite handler error
      await expect(monitor.performHealthCheck()).resolves.not.toThrow();
    });
  });

  describe('system health reporting', () => {
    beforeEach(() => {
      monitor.startMonitoring();
    });

    it('should generate system health report with all healthy servers', async () => {
      mockMcpClient.ping.mockResolvedValue(undefined);
      await monitor.performHealthCheck();

      const report = monitor.getSystemHealthReport();

      expect(report.overall.status).toBe('healthy');
      expect(report.summary.totalServers).toBe(2);
      expect(report.summary.healthyServers).toBe(2);
      expect(report.summary.unhealthyServers).toBe(0);
      expect(report.summary.degradedServers).toBe(0);
    });

    it('should generate system health report with mixed server states', async () => {
      mockMcpClient.ping
        .mockResolvedValueOnce(undefined) // server1 healthy
        .mockRejectedValueOnce(new Error('Failed')); // server2 unhealthy

      await monitor.performHealthCheck();

      const report = monitor.getSystemHealthReport();

      expect(report.overall.status).toBe('degraded');
      expect(report.summary.totalServers).toBe(2);
      expect(report.summary.healthyServers).toBe(1);
      expect(report.summary.unhealthyServers).toBe(1);
    });

    it('should report unknown status when no servers connected', () => {
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      const report = monitor.getSystemHealthReport();

      expect(report.overall.status).toBe('unknown');
      expect(report.summary.totalServers).toBe(0);
    });

    it('should report unhealthy when majority of servers are unhealthy', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue(['server1', 'server2', 'server3']);
      mockMcpClient.ping
        .mockResolvedValueOnce(undefined) // server1 healthy
        .mockRejectedValueOnce(new Error('Failed')) // server2 unhealthy
        .mockRejectedValueOnce(new Error('Failed')); // server3 unhealthy

      await monitor.performHealthCheck();

      const report = monitor.getSystemHealthReport();

      expect(report.overall.status).toBe('unhealthy');
      expect(report.summary.unhealthyServers).toBe(2);
    });
  });

  describe('response time metrics', () => {
    beforeEach(() => {
      monitor.startMonitoring();
    });

    it('should track response time statistics', async () => {
      // Mock multiple pings with different response times
      let callCount = 0;
      mockMcpClient.ping.mockImplementation(async () => {
        const delays = [100, 200, 150, 300, 250];
        await new Promise(resolve => setTimeout(resolve, delays[callCount++ % delays.length] || 100));
      });

      // Perform multiple health checks
      for (let i = 0; i < 5; i++) {
        await monitor.performHealthCheck();
      }

      const serverHealth = monitor.getServerHealth('server1');
      expect(serverHealth).toBeDefined();
      expect(serverHealth?.responseTime.current).toBeGreaterThan(0);
      expect(serverHealth?.responseTime.average).toBeGreaterThan(0);
      expect(serverHealth?.responseTime.percentile95).toBeGreaterThan(0);
    });

    it('should calculate correct percentile values', async () => {
      // Create predictable response times
      const responseTimes = Array.from({ length: 100 }, (_, i) => i + 1); // 1-100ms
      let callIndex = 0;

      mockMcpClient.ping.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, responseTimes[callIndex++ % responseTimes.length] || 1));
      });

      // Perform enough checks to fill history
      for (let i = 0; i < 100; i++) {
        await monitor.performHealthCheck();
      }

      const serverHealth = monitor.getServerHealth('server1');
      expect(serverHealth?.responseTime.percentile95).toBeGreaterThan(90); // Should be around 95
    });
  });

  describe('error tracking', () => {
    beforeEach(() => {
      monitor.startMonitoring();
    });

    it('should track error summaries', async () => {
      mockMcpClient.ping.mockRejectedValue(new Error('Connection timeout'));
      await monitor.performHealthCheck();

      const serverHealth = monitor.getServerHealth('server1');
      expect(serverHealth?.errors).toHaveLength(1);
      expect(serverHealth?.errors[0]?.type).toBe('Error');
      expect(serverHealth?.errors[0]?.count).toBe(1);
    });

    it('should aggregate error counts', async () => {
      mockMcpClient.ping.mockRejectedValue(new Error('Connection timeout'));
      
      // Multiple failed health checks
      await monitor.performHealthCheck();
      await monitor.performHealthCheck();
      await monitor.performHealthCheck();

      const serverHealth = monitor.getServerHealth('server1');
      expect(serverHealth?.errors[0]?.count).toBe(3);
    });

    it('should limit error history', async () => {
      // Generate many different error types
      for (let i = 0; i < 15; i++) {
        const errorName = `Error${i}`;
        const CustomError = class extends Error {
          constructor(message: string) {
            super(message);
            this.name = errorName;
          }
        };
        
        mockMcpClient.ping.mockRejectedValueOnce(new CustomError(`Error ${i}`));
        await monitor.performHealthCheck();
      }

      const serverHealth = monitor.getServerHealth('server1');
      expect(serverHealth?.errors.length).toBeLessThanOrEqual(10);
    });
  });

  describe('configuration updates', () => {
    it('should update configuration', () => {
      const newConfig: Partial<HealthMonitorConfig> = {
        healthCheckInterval: 15000,
        responseTimeThreshold: 2000
      };

      monitor.updateConfig(newConfig);
      const config = monitor.getConfig();

      expect(config.healthCheckInterval).toBe(15000);
      expect(config.responseTimeThreshold).toBe(2000);
    });

    it('should restart monitoring when interval changes', () => {
      jest.useFakeTimers();
      
      monitor.startMonitoring();
      expect(monitor.isActive()).toBe(true);

      monitor.updateConfig({ healthCheckInterval: 15000 });
      
      expect(monitor.isActive()).toBe(true);
      
      jest.useRealTimers();
    });
  });

  describe('operation counts', () => {
    beforeEach(() => {
      monitor.startMonitoring();
    });

    it('should track successful operations', async () => {
      mockMcpClient.ping.mockResolvedValue(undefined);
      await monitor.performHealthCheck();

      const serverHealth = monitor.getServerHealth('server1');
      expect(serverHealth?.operationCounts.successful).toBe(1);
      expect(serverHealth?.operationCounts.total).toBe(1);
      expect(serverHealth?.operationCounts.failed).toBe(0);
    });

    it('should track failed operations', async () => {
      mockMcpClient.ping.mockRejectedValue(new Error('Failed'));
      await monitor.performHealthCheck();

      const serverHealth = monitor.getServerHealth('server1');
      expect(serverHealth?.operationCounts.successful).toBe(0);
      expect(serverHealth?.operationCounts.total).toBe(1);
      expect(serverHealth?.operationCounts.failed).toBe(1);
    });

    it('should calculate error rate correctly', async () => {
      // 2 successes, 3 failures - but remember we have 2 servers, so each health check calls ping twice
      mockMcpClient.ping
        .mockResolvedValueOnce(undefined)  // server1 success
        .mockResolvedValueOnce(undefined)  // server2 success
        .mockResolvedValueOnce(undefined)  // server1 success 
        .mockResolvedValueOnce(undefined)  // server2 success
        .mockRejectedValueOnce(new Error('Failed'))  // server1 failure
        .mockRejectedValueOnce(new Error('Failed'))  // server2 failure
        .mockRejectedValueOnce(new Error('Failed'))  // server1 failure
        .mockRejectedValueOnce(new Error('Failed'))  // server2 failure
        .mockRejectedValueOnce(new Error('Failed'))  // server1 failure
        .mockRejectedValueOnce(new Error('Failed')); // server2 failure

      for (let i = 0; i < 5; i++) {
        await monitor.performHealthCheck();
      }

      const serverHealth = monitor.getServerHealth('server1');
      const errorRate = (serverHealth!.operationCounts.failed / serverHealth!.operationCounts.total) * 100;
      expect(errorRate).toBe(60); // 3/5 = 60%
    });
  });

  describe('edge cases', () => {
    it('should handle server health queries for non-existent servers', () => {
      const health = monitor.getServerHealth('non-existent');
      expect(health).toBeNull();
    });

    it('should handle empty server list gracefully', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue([]);
      
      const results = await monitor.performHealthCheck();
      expect(results).toHaveLength(0);
    });

    it('should handle ping method throwing synchronously', async () => {
      mockMcpClient.ping.mockImplementation(() => {
        throw new Error('Immediate failure');
      });

      const results = await monitor.performHealthCheck();
      expect(results[0]?.status.status).toBe('unhealthy');
    });
  });
});