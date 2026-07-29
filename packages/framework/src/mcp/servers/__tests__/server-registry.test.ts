/**
 * Tests for MCPServerRegistry
 */

import { MCPServerRegistryImpl } from '../registry/server-registry.js';
import type { MCPLocalServerConfig, MCPRemoteServerConfig } from '../../core/types/config.js';

// Mock logger to avoid console output during tests
jest.mock('../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('MCPServerRegistry', (): void => {
  let registry: MCPServerRegistryImpl;

  const mockLocalConfig: MCPLocalServerConfig = {
    command: 'echo',
    args: ['test']
  };

  const mockRemoteConfig: MCPRemoteServerConfig = {
    transport: {
      type: 'http',
      url: 'http://localhost:3000/mcp'
    }
  };

  beforeEach((): void => {
    registry = new MCPServerRegistryImpl();
  });

  afterEach(async (): Promise<void> => {
    try {
      // Force cleanup without timeout to prevent hanging
      await registry.cleanup();
    } catch {
      // Ignore cleanup errors in tests
    }
  });

  describe('Server Registration', (): void => {
    it('should register a local server successfully', async (): Promise<void> => {
      const manager = await registry.register('test-local', mockLocalConfig);
      
      expect(manager).toBeDefined();
      expect(manager.getServerInfo().name).toBe('test-local');
      expect(manager.getServerInfo().config).toEqual(mockLocalConfig);
    });

    it('should register a remote server successfully', async (): Promise<void> => {
      const manager = await registry.register('test-remote', mockRemoteConfig);
      
      expect(manager).toBeDefined();
      expect(manager.getServerInfo().name).toBe('test-remote');
      expect(manager.getServerInfo().config).toEqual(mockRemoteConfig);
    });

    it('should reject duplicate server names', async (): Promise<void> => {
      await registry.register('duplicate', mockLocalConfig);
      
      await expect(registry.register('duplicate', mockLocalConfig))
        .rejects.toThrow('already registered');
    });

    it('should emit server-added event', (done): void => {
      registry.on('server-added', (data: { serverName: string; event: string }) => {
        expect(data.serverName).toBe('test-server');
        expect(data.event).toBe('connected');
        done();
      });

      registry.register('test-server', mockLocalConfig).catch(done);
    });
  });

  describe('Server Unregistration', (): void => {
    it('should unregister an existing server', async (): Promise<void> => {
      await registry.register('to-remove', mockLocalConfig);
      expect(registry.getServer('to-remove')).toBeDefined();

      await registry.unregister('to-remove');
      expect(registry.getServer('to-remove')).toBeUndefined();
    });

    it('should handle unregistering non-existent server gracefully', async (): Promise<void> => {
      await expect(registry.unregister('non-existent')).resolves.not.toThrow();
    });

    it('should emit server-removed event', (done): void => {
      registry.register('to-remove', mockLocalConfig).then(() => {
        registry.on('server-removed', (data: { serverName: string }) => {
          expect(data.serverName).toBe('to-remove');
          done();
        });

        registry.unregister('to-remove').catch(done);
      }).catch(done);
    });
  });

  describe('Server Retrieval', (): void => {
    beforeEach(async (): Promise<void> => {
      await registry.register('server1', mockLocalConfig);
      await registry.register('server2', mockRemoteConfig);
    });

    it('should get server by name', (): void => {
      const server = registry.getServer('server1');
      expect(server).toBeDefined();
      expect(server!.getServerInfo().name).toBe('server1');
    });

    it('should return undefined for non-existent server', (): void => {
      const server = registry.getServer('non-existent');
      expect(server).toBeUndefined();
    });

    it('should get all servers', (): void => {
      const servers = registry.getAllServers();
      expect(servers).toHaveLength(2);
      expect(servers.map(s => s.name)).toContain('server1');
      expect(servers.map(s => s.name)).toContain('server2');
    });

    it('should get servers by status', (): void => {
      const disconnectedServers = registry.getServersByStatus('disconnected');
      expect(disconnectedServers).toHaveLength(2);

      const connectedServers = registry.getServersByStatus('connected');
      expect(connectedServers).toHaveLength(0);
    });
  });

  describe('Bulk Operations', (): void => {
    beforeEach(async (): Promise<void> => {
      await registry.register('bulk1', mockLocalConfig);
      await registry.register('bulk2', mockLocalConfig);
    });

    it('should connect to all servers', async (): Promise<void> => {
      // connectAll should not throw even if individual connections fail
      await expect(registry.connectAll()).resolves.not.toThrow();
    });

    it('should disconnect from all servers', async (): Promise<void> => {
      await expect(registry.disconnectAll()).resolves.not.toThrow();
    });
  });

  describe('Health Summary', (): void => {
    it('should return correct health summary for empty registry', (): void => {
      const health = registry.getHealthSummary();
      
      expect(health.totalServers).toBe(0);
      expect(health.connectedServers).toBe(0);
      expect(health.errorServers).toBe(0);
      expect(health.totalErrors).toBe(0);
      expect(health.healthScore).toBe(100);
    });

    it('should return correct health summary with servers', async (): Promise<void> => {
      await registry.register('health1', mockLocalConfig);
      await registry.register('health2', mockRemoteConfig);

      const health = registry.getHealthSummary();
      
      expect(health.totalServers).toBe(2);
      expect(health.connectedServers).toBe(0); // None connected by default
      expect(health.healthScore).toBe(0); // 0% since none connected
    });
  });

  describe('Event Handling', (): void => {
    it('should forward server events', (done): void => {
      // Set up event listener first
      registry.on('server-status-changed', (data: { serverName: string; event: string }) => {
        if (data.event === 'connecting' && data.serverName === 'event-test') {
          expect(data.serverName).toBe('event-test');
          done();
        }
      });

      registry.register('event-test', mockLocalConfig).then((manager) => {
        // Trigger an event
        manager.connect().catch(() => {
          // Ignore connection errors for this test
        });
      }).catch(done);
    });

    it('should handle multiple event listeners', async (): Promise<void> => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      registry.on('server-added', listener1);
      registry.on('server-added', listener2);

      await registry.register('multi-listener', mockLocalConfig);

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe('Cleanup', (): void => {
    it('should clean up all resources', async (): Promise<void> => {
      await registry.register('cleanup1', mockLocalConfig);
      await registry.register('cleanup2', mockRemoteConfig);

      expect(registry.getAllServers()).toHaveLength(2);

      await registry.cleanup();

      expect(registry.getAllServers()).toHaveLength(0);
    });

    it('should handle cleanup errors gracefully', async (): Promise<void> => {
      await registry.register('cleanup-error', mockLocalConfig);

      // Mock a cleanup error
      const server = registry.getServer('cleanup-error')!;
      jest.spyOn(server, 'cleanup').mockRejectedValue(new Error('Cleanup error'));

      await expect(registry.cleanup()).resolves.not.toThrow();
    });
  });
});