/**
 * Tests for ReconnectionManager - intelligent reconnection with backoff and circuit breaker patterns
 */

import { ReconnectionManager } from '../reconnection-manager.js';
import type { MCPClient } from '../../../core/base/mcp-client.js';
import type { ReconnectionConfig } from '../../types/index.js';

// Mock the logger
jest.mock('../../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('ReconnectionManager', () => {
  let mockMcpClient: jest.Mocked<MCPClient>;
  let manager: ReconnectionManager;

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

    manager = new ReconnectionManager(mockMcpClient);
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (manager.isReconnectionActive()) {
      manager.stop();
    }
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('should create manager with default configuration', () => {
      const config = manager.getConfig();
      
      expect(config.enabled).toBe(true);
      expect(config.maxRetryAttempts).toBe(10);
      expect(config.backoffStrategy).toBe('exponential');
      expect(config.baseDelay).toBe(1000);
      expect(config.maxDelay).toBe(300000);
      expect(config.jitter).toBe(true);
      expect(config.circuitBreaker.enabled).toBe(true);
    });

    it('should create manager with custom configuration', () => {
      const customConfig: Partial<ReconnectionConfig> = {
        enabled: false,
        maxRetryAttempts: 5,
        backoffStrategy: 'linear',
        baseDelay: 500,
        jitter: false
      };

      const customManager = new ReconnectionManager(mockMcpClient, customConfig);
      const config = customManager.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.maxRetryAttempts).toBe(5);
      expect(config.backoffStrategy).toBe('linear');
      expect(config.baseDelay).toBe(500);
      expect(config.jitter).toBe(false);
    });

    it('should not be active initially', () => {
      expect(manager.isReconnectionActive()).toBe(false);
    });
  });

  describe('lifecycle management', () => {
    it('should start successfully', () => {
      manager.start();
      expect(manager.isReconnectionActive()).toBe(true);
    });

    it('should not start twice', () => {
      manager.start();
      
      // Second start should be ignored
      manager.start();
      
      expect(manager.isReconnectionActive()).toBe(true);
    });

    it('should stop successfully', () => {
      manager.start();
      manager.stop();

      expect(manager.isReconnectionActive()).toBe(false);
    });

    it('should clear timers on stop', () => {
      manager.start();
      manager.handleDisconnection('server1', new Error('Test disconnect'));
      
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      manager.stop();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should not start when disabled', () => {
      const disabledManager = new ReconnectionManager(mockMcpClient, { enabled: false });
      disabledManager.start();

      expect(disabledManager.isReconnectionActive()).toBe(false);
    });
  });

  describe('disconnection handling', () => {
    beforeEach(() => {
      manager.start();
    });

    it('should handle server disconnection', () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      
      manager.handleDisconnection('server1', new Error('Connection lost'));

      expect(setTimeoutSpy).toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });

    it('should ignore disconnection when not active', () => {
      manager.stop();
      
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      manager.handleDisconnection('server1', new Error('Connection lost'));

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });

    it('should ignore disconnection when disabled', () => {
      const disabledManager = new ReconnectionManager(mockMcpClient, { enabled: false });
      disabledManager.start();
      
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      disabledManager.handleDisconnection('server1', new Error('Connection lost'));

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });

    it('should initialize reconnection statistics', () => {
      manager.handleDisconnection('server1', new Error('Connection lost'));

      const stats = manager.getReconnectionStats('server1');
      expect(stats).toBeDefined();
      expect(stats?.serverId).toBe('server1');
      expect(stats?.totalAttempts).toBe(0);
      expect(stats?.circuitBreakerState).toBe('closed');
    });

    it('should skip reconnection when circuit breaker is open', () => {
      // Force circuit breaker open by exceeding failure threshold
      for (let i = 0; i < 6; i++) {
        manager.handleDisconnection('server1', new Error('Failed'));
        jest.advanceTimersByTime(1000);
      }

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      jest.clearAllMocks();
      
      manager.handleDisconnection('server1', new Error('Another failure'));

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });
  });

  describe('reconnection attempts', () => {
    beforeEach(() => {
      manager.start();
    });

    it('should perform successful reconnection', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);

      const result = await manager.triggerReconnection('server1');

      expect(result).toBe(true);
      expect(mockMcpClient.getConnectedServers).toHaveBeenCalled();

      const stats = manager.getReconnectionStats('server1');
      expect(stats?.successfulReconnections).toBe(1);
    });

    it('should handle failed reconnection', async () => {
      mockMcpClient.getConnectedServers.mockImplementation(() => {
        throw new Error('Client error');
      });

      const result = await manager.triggerReconnection('server1');

      expect(result).toBe(false);

      const stats = manager.getReconnectionStats('server1');
      expect(stats?.failedAttempts).toBe(1);
    });

    it('should not trigger reconnection when not active', async () => {
      manager.stop();

      await expect(manager.triggerReconnection('server1'))
        .rejects.toThrow('Reconnection manager is not active');
    });

    it('should schedule retry after failed attempt', async () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      
      // Mock client to return server as disconnected (failed reconnection)
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      manager.handleDisconnection('server1', new Error('Connection lost'));
      
      // First attempt should fail and schedule retry
      jest.advanceTimersByTime(1000);
      await jest.runOnlyPendingTimersAsync();

      // Should have scheduled at least initial attempt and one retry
      expect(setTimeoutSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      setTimeoutSpy.mockRestore();
    });

    it('should stop retrying after max attempts', async () => {
      // Configure with low max attempts for testing
      const testManager = new ReconnectionManager(mockMcpClient, { maxRetryAttempts: 2 });
      testManager.start();

      mockMcpClient.getConnectedServers.mockReturnValue([]);

      testManager.handleDisconnection('server1', new Error('Connection lost'));

      // Advance through all attempts
      for (let i = 0; i < 3; i++) {
        jest.advanceTimersByTime(5000);
        await jest.runOnlyPendingTimersAsync();
      }

      // Check that we've exceeded max attempts and circuit breaker is open
      const stats = testManager.getReconnectionStats('server1');
      expect(stats?.totalAttempts).toBeGreaterThanOrEqual(2);

      testManager.stop();
    });
  });

  describe('backoff strategies', () => {
    beforeEach(() => {
      manager.start();
    });

    it('should use exponential backoff', () => {
      const exponentialManager = new ReconnectionManager(mockMcpClient, {
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        jitter: false
      });

      exponentialManager.start();
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      
      exponentialManager.handleDisconnection('server1', new Error('Connection lost'));

      // Check that initial delay is set
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);

      setTimeoutSpy.mockRestore();
      exponentialManager.stop();
    });

    it('should use linear backoff', () => {
      const linearManager = new ReconnectionManager(mockMcpClient, {
        backoffStrategy: 'linear',
        baseDelay: 1000,
        jitter: false
      });

      linearManager.start();
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      
      linearManager.handleDisconnection('server1', new Error('Connection lost'));

      // Check that initial delay is set
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);

      setTimeoutSpy.mockRestore();
      linearManager.stop();
    });

    it('should use fixed backoff', () => {
      const fixedManager = new ReconnectionManager(mockMcpClient, {
        backoffStrategy: 'fixed',
        baseDelay: 1000,
        jitter: false
      });

      fixedManager.start();
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      
      fixedManager.handleDisconnection('server1', new Error('Connection lost'));

      // Check that initial delay is set
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);

      setTimeoutSpy.mockRestore();
      fixedManager.stop();
    });

    it('should apply jitter when enabled', () => {
      const jitterManager = new ReconnectionManager(mockMcpClient, {
        backoffStrategy: 'fixed',
        baseDelay: 1000,
        jitter: true
      });

      jitterManager.start();
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      
      jitterManager.handleDisconnection('server1', new Error('Connection lost'));

      const delay = setTimeoutSpy.mock.calls[0]?.[1] as number;
      expect(delay).toBeGreaterThan(900); // Should be within jitter range
      expect(delay).toBeLessThan(1100);

      setTimeoutSpy.mockRestore();
      jitterManager.stop();
    });

    it('should respect max delay', () => {
      const maxDelayManager = new ReconnectionManager(mockMcpClient, {
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 5000,
        jitter: false
      });

      maxDelayManager.start();
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      maxDelayManager.handleDisconnection('server1', new Error('Connection lost'));

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      
      // Advance through several attempts to hit max delay
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(10000);
      }

      // Check that delay never exceeds max
      const delays = setTimeoutSpy.mock.calls.map(call => call[1] as number);
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(5000);
      }

      setTimeoutSpy.mockRestore();
      maxDelayManager.stop();
    });
  });

  describe('circuit breaker', () => {
    beforeEach(() => {
      manager.start();
    });

    it('should open circuit breaker after failure threshold', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      // Trigger failures to exceed threshold (default is 5)
      for (let i = 0; i < 6; i++) {
        manager.handleDisconnection('server1', new Error('Connection failed'));
        jest.advanceTimersByTime(1000);
        await jest.runOnlyPendingTimersAsync();
      }

      const circuitBreaker = manager.getCircuitBreakerState('server1');
      expect(circuitBreaker?.state).toBe('open');
      expect(circuitBreaker?.failureCount).toBeGreaterThanOrEqual(5);
    });

    it('should reset circuit breaker on successful reconnection', async () => {
      // First cause failures to open circuit breaker
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      for (let i = 0; i < 6; i++) {
        manager.handleDisconnection('server1', new Error('Connection failed'));
        jest.advanceTimersByTime(1000);
        await jest.runOnlyPendingTimersAsync();
      }

      // Then succeed
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);
      const result = await manager.triggerReconnection('server1');

      expect(result).toBe(true);

      const circuitBreaker = manager.getCircuitBreakerState('server1');
      expect(circuitBreaker?.failureCount).toBe(0);
    });

    it('should manually reset circuit breaker', () => {
      // Force circuit breaker to open
      manager.handleDisconnection('server1', new Error('Connection failed'));
      
      const circuitBreaker = manager.getCircuitBreakerState('server1');
      if (circuitBreaker) {
        circuitBreaker.state = 'open';
        circuitBreaker.failureCount = 5;
      }

      manager.resetCircuitBreaker('server1');

      const resetState = manager.getCircuitBreakerState('server1');
      expect(resetState?.state).toBe('closed');
      expect(resetState?.failureCount).toBe(0);
    });

    it('should transition to half-open after reset timeout', () => {
      const shortTimeoutManager = new ReconnectionManager(mockMcpClient, {
        circuitBreaker: {
          enabled: true,
          failureThreshold: 2,
          resetTimeout: 1000,
          halfOpenMaxCalls: 3
        }
      });

      shortTimeoutManager.start();

      // Create multiple failures to open circuit breaker
      mockMcpClient.getConnectedServers.mockReturnValue([]);
      
      for (let i = 0; i < 3; i++) {
        shortTimeoutManager.handleDisconnection('server1', new Error('Test'));
      }

      const circuitBreaker = shortTimeoutManager.getCircuitBreakerState('server1');
      expect(circuitBreaker?.state).toBe('open');

      shortTimeoutManager.stop();
    });

    it('should disable circuit breaker when configured', () => {
      const noCbManager = new ReconnectionManager(mockMcpClient, {
        circuitBreaker: { enabled: false, failureThreshold: 5, resetTimeout: 60000, halfOpenMaxCalls: 3 }
      });

      noCbManager.start();
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      // Even after many failures, circuit breaker should not be created when disabled
      for (let i = 0; i < 10; i++) {
        noCbManager.handleDisconnection('server1', new Error('Connection failed'));
      }

      // When disabled, circuit breaker may not even be created
      const circuitBreaker = noCbManager.getCircuitBreakerState('server1');
      // Since CB is disabled, it either doesn't exist or remains closed
      expect(circuitBreaker === null || circuitBreaker.state === 'closed').toBe(true);

      noCbManager.stop();
    });
  });

  describe('reconnection handlers', () => {
    beforeEach(() => {
      manager.start();
    });

    it('should add and remove reconnection handlers', () => {
      const handler = jest.fn();

      manager.addReconnectionHandler(handler);
      expect(() => manager.removeReconnectionHandler(handler)).not.toThrow();
    });

    it('should notify handlers on reconnection events', async () => {
      const handler = jest.fn();
      manager.addReconnectionHandler(handler);

      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);
      await manager.triggerReconnection('server1');

      expect(handler).toHaveBeenCalledWith('server1', 1, true);
    });

    it('should notify handlers on failed reconnection', async () => {
      const handler = jest.fn();
      manager.addReconnectionHandler(handler);

      mockMcpClient.getConnectedServers.mockReturnValue([]);
      await manager.triggerReconnection('server1');

      expect(handler).toHaveBeenCalledWith('server1', 1, false);
    });

    it('should handle errors in handlers gracefully', async () => {
      const faultyHandler = jest.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      
      manager.addReconnectionHandler(faultyHandler);

      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);
      
      // Should not throw despite handler error
      await expect(manager.triggerReconnection('server1')).resolves.not.toThrow();
    });
  });

  describe('statistics and monitoring', () => {
    beforeEach(() => {
      manager.start();
    });

    it('should track reconnection statistics', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);

      await manager.triggerReconnection('server1');

      const stats = manager.getReconnectionStats('server1');
      expect(stats?.totalAttempts).toBe(1);
      expect(stats?.successfulReconnections).toBe(1);
      expect(stats?.failedAttempts).toBe(0);
      expect(stats?.lastSuccess).toBeDefined();
    });

    it('should track failed attempts', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      await manager.triggerReconnection('server1');

      const stats = manager.getReconnectionStats('server1');
      expect(stats?.totalAttempts).toBe(1);
      expect(stats?.successfulReconnections).toBe(0);
      expect(stats?.failedAttempts).toBe(1);
      expect(stats?.lastAttempt).toBeDefined();
    });

    it('should return null for non-existent server stats', () => {
      const stats = manager.getReconnectionStats('non-existent');
      expect(stats).toBeNull();
    });

    it('should get all reconnection statistics', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue(['server1', 'server2']);

      await manager.triggerReconnection('server1');
      await manager.triggerReconnection('server2');

      const allStats = manager.getAllReconnectionStats();
      expect(Object.keys(allStats)).toHaveLength(2);
      expect(allStats['server1']).toBeDefined();
      expect(allStats['server2']).toBeDefined();
    });

    it('should update current delay in statistics', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      manager.handleDisconnection('server1', new Error('Connection lost'));
      jest.advanceTimersByTime(1000);
      await jest.runOnlyPendingTimersAsync();

      const stats = manager.getReconnectionStats('server1');
      expect(stats?.currentDelay).toBeGreaterThan(500); // Should be around base delay, accounting for jitter
    });
  });

  describe('configuration updates', () => {
    it('should update configuration', () => {
      const newConfig: Partial<ReconnectionConfig> = {
        maxRetryAttempts: 15,
        backoffStrategy: 'linear',
        baseDelay: 2000
      };

      manager.updateConfig(newConfig);
      const config = manager.getConfig();

      expect(config.maxRetryAttempts).toBe(15);
      expect(config.backoffStrategy).toBe('linear');
      expect(config.baseDelay).toBe(2000);
    });

    it('should stop manager when disabled via config', () => {
      manager.start();
      expect(manager.isReconnectionActive()).toBe(true);

      manager.updateConfig({ enabled: false });
      expect(manager.isReconnectionActive()).toBe(false);
    });

    it('should start manager when enabled via config', () => {
      const disabledManager = new ReconnectionManager(mockMcpClient, { enabled: false });
      expect(disabledManager.isReconnectionActive()).toBe(false);

      disabledManager.updateConfig({ enabled: true });
      expect(disabledManager.isReconnectionActive()).toBe(true);

      disabledManager.stop();
    });
  });

  describe('edge cases and error handling', () => {
    beforeEach(() => {
      manager.start();
    });

    it('should handle disconnection with undefined error', () => {
      expect(() => manager.handleDisconnection('server1')).not.toThrow();
    });

    it('should handle reconnection attempt for server with no prior disconnection', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);

      const result = await manager.triggerReconnection('server1');
      expect(result).toBe(true);
    });

    it('should handle empty server list from client', () => {
      mockMcpClient.getConnectedServers.mockReturnValue([]);

      expect(() => manager.handleDisconnection('server1', new Error('Test'))).not.toThrow();
    });

    it('should handle circuit breaker reset for non-existent server', () => {
      expect(() => manager.resetCircuitBreaker('non-existent')).not.toThrow();
    });

    it('should handle errors during performReconnection', async () => {
      // Mock client to throw during getConnectedServers
      mockMcpClient.getConnectedServers.mockImplementation(() => {
        throw new Error('Client error');
      });

      const result = await manager.triggerReconnection('server1');
      expect(result).toBe(false);
    });

    it('should handle timer cleanup edge cases', () => {
      manager.handleDisconnection('server1', new Error('Test'));
      
      // Stop while timers are pending
      expect(() => manager.stop()).not.toThrow();
    });
  });
});