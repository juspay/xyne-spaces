/**
 * Tests for MCPManager
 */

import { MCPManager } from '../manager/mcp-manager.js';
import { MCPConfigLoader } from '../../config/config-loader.js';
import type { MCPConfig } from '../../core/types/config.js';

// Mock logger to avoid console output during tests
jest.mock('../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock the config loader
jest.mock('../../config/config-loader.js');
const MockMCPConfigLoader = MCPConfigLoader as jest.MockedClass<typeof MCPConfigLoader>;

describe('MCPManager', (): void => {
  let manager: MCPManager;
  let mockConfigLoader: jest.Mocked<MCPConfigLoader>;

  const mockConfig: MCPConfig = {
    mcpServers: {
      testServer: {
        command: 'echo',
        args: ['test']
      }
    },
    security: {
      enableSandbox: true,
      allowedHosts: ['localhost']
    },
    performance: {
      maxConcurrentConnections: 5
    },
    features: {
      enableResourceCaching: true
    }
  };

  beforeEach((): void => {
    // Reset mocks
    MockMCPConfigLoader.mockClear();
    
    // Create mock config loader instance with only public methods
    mockConfigLoader = {
      loadConfig: jest.fn().mockResolvedValue({
        success: true,
        config: mockConfig,
        configPath: '/test/config.json'
      }),
      loadConfigSync: jest.fn().mockReturnValue(mockConfig),
      configExists: jest.fn().mockResolvedValue(true),
      getConfigPath: jest.fn().mockReturnValue('/test/config.json')
    } as Partial<MCPConfigLoader> as jest.Mocked<MCPConfigLoader>;

    // Mock the constructor to return our mock instance
    MockMCPConfigLoader.mockImplementation(() => mockConfigLoader);

    manager = new MCPManager({
      localConfigPath: '/test/config.json',
      autoConnect: false,
      enableHealthMonitoring: false
    });
  });

  afterEach(async (): Promise<void> => {
    try {
      // Force stop the manager to clean up all resources
      if (manager) {
        await manager.stop();
      }
    } catch {
      // Ignore cleanup errors in tests
    }
  });

  describe('Lifecycle Management', (): void => {
    it('should start in stopped state', (): void => {
      expect(manager.getStatus()).toBe('stopped');
    });

    it('should start successfully with valid configuration', async (): Promise<void> => {
      await manager.start();
      
      expect(manager.getStatus()).toBe('running');
      expect(manager.getConfig()).toEqual(mockConfig);
    });

    it('should handle configuration loading errors', async (): Promise<void> => {
      mockConfigLoader.loadConfig.mockResolvedValue({
        success: false,
        errors: ['Configuration error']
      });

      await expect(manager.start()).rejects.toThrow();
      expect(manager.getStatus()).toBe('stopped');
    });

    it('should stop successfully', async (): Promise<void> => {
      await manager.start();
      expect(manager.getStatus()).toBe('running');

      await manager.stop();
      expect(manager.getStatus()).toBe('stopped');
    });

    it('should prevent starting when already running', async (): Promise<void> => {
      await manager.start();
      
      await expect(manager.start()).rejects.toThrow();
    });

    it('should handle stop when already stopped', async (): Promise<void> => {
      expect(manager.getStatus()).toBe('stopped');
      
      await expect(manager.stop()).resolves.not.toThrow();
      expect(manager.getStatus()).toBe('stopped');
    });
  });

  describe('Configuration Management', (): void => {
    it('should load configuration successfully', async (): Promise<void> => {
      await manager.start();
      
      const config = manager.getConfig();
      expect(config).toEqual(mockConfig);
      expect(mockConfigLoader.loadConfig).toHaveBeenCalledTimes(1);
    });

    it('should reload configuration', async (): Promise<void> => {
      await manager.start();
      
      const newConfig: MCPConfig = {
        ...mockConfig,
        mcpServers: {
          newServer: {
            transport: {
              type: 'http',
              url: 'http://localhost:3000'
            }
          }
        }
      };

      mockConfigLoader.loadConfig.mockResolvedValue({
        success: true,
        config: newConfig
      });

      await manager.reload();
      
      expect(manager.getConfig()).toEqual(newConfig);
      expect(mockConfigLoader.loadConfig).toHaveBeenCalledTimes(2);
    });

    it('should handle configuration warnings', async (): Promise<void> => {
      mockConfigLoader.loadConfig.mockResolvedValue({
        success: true,
        config: mockConfig,
        warnings: ['Test warning']
      });

      await expect(manager.start()).resolves.not.toThrow();
      expect(manager.getConfig()).toEqual(mockConfig);
    });
  });

  describe('Server Management', (): void => {
    beforeEach(async (): Promise<void> => {
      await manager.start();
    });

    it('should register servers from configuration', (): void => {
      const servers = manager.getAllServers();
      expect(servers).toHaveLength(1);
      expect(servers[0]?.name).toBe('testServer');
    });

    it('should get server by name', (): void => {
      const server = manager.getServer('testServer');
      expect(server).toBeDefined();
      expect(server!.getServerInfo().name).toBe('testServer');
    });

    it('should get servers by status', (): void => {
      const disconnectedServers = manager.getServersByStatus('disconnected');
      expect(disconnectedServers).toHaveLength(1);

      const connectedServers = manager.getServersByStatus('connected');
      expect(connectedServers).toHaveLength(0);
    });

    it('should register new server manually', async (): Promise<void> => {
      const newServerConfig = {
        command: 'node',
        args: ['--version']
      };

      const server = await manager.registerServer('manual-server', newServerConfig);
      
      expect(server).toBeDefined();
      expect(server.getServerInfo().name).toBe('manual-server');
      
      const allServers = manager.getAllServers();
      expect(allServers).toHaveLength(2);
    });

    it('should unregister server', async (): Promise<void> => {
      expect(manager.getServer('testServer')).toBeDefined();
      
      await manager.unregisterServer('testServer');
      
      expect(manager.getServer('testServer')).toBeUndefined();
      expect(manager.getAllServers()).toHaveLength(0);
    });
  });

  describe('Health Monitoring', (): void => {
    it('should get health summary', async (): Promise<void> => {
      await manager.start();
      
      const health = manager.getHealthSummary();
      
      expect(health.totalServers).toBe(1);
      expect(health.connectedServers).toBe(0);
      expect(health.healthScore).toBe(0);
    });

    // Note: Health monitoring interval tests skipped because monitoring 
    // is disabled in test environment to prevent hanging
  });

  describe('Event Handling', (): void => {
    it('should emit status change events', (done): void => {
      manager.on('status-changed', (data: { currentStatus: string; previousStatus: string }) => {
        // Only check when we reach running status
        if (data.currentStatus === 'running') {
          expect(data.currentStatus).toBe('running');
          expect(data.previousStatus).toBe('starting');
          done();
        }
      });

      manager.start().catch(done);
    });

    it('should forward server events', (done): void => {
      // Set up event listener before starting
      manager.on('server-status-changed', (data: { serverName: string; event: string }) => {
        if (data.event === 'connecting' && data.serverName === 'testServer') {
          expect(data.serverName).toBe('testServer');
          done();
        }
      });

      manager.start().then(() => {
        // Trigger a server connection
        const server = manager.getServer('testServer');
        if (server) {
          server.connect().catch(() => {
            // Ignore connection errors for this test
          });
        } else {
          done(new Error('Server not found'));
        }
      }).catch(done);
    });
  });

  describe('Error Handling', (): void => {
    it('should handle configuration loading errors gracefully', async (): Promise<void> => {
      mockConfigLoader.loadConfig.mockRejectedValue(new Error('Config load error'));

      await expect(manager.start()).rejects.toThrow('Failed to start MCP manager');
      expect(manager.getStatus()).toBe('stopped');
    });

    it('should handle server registration errors during start', async (): Promise<void> => {
      const invalidConfig: MCPConfig = {
        mcpServers: {
          invalidServer: {
            // Invalid config - missing required fields
            command: '' // Invalid empty command to trigger validation error
          }
        }
      };

      mockConfigLoader.loadConfig.mockResolvedValue({
        success: true,
        config: invalidConfig
      });

      // Should not throw, but should log errors for invalid servers
      await expect(manager.start()).resolves.not.toThrow();
      expect(manager.getStatus()).toBe('running');
    });

    it('should prevent operations when not running', async (): Promise<void> => {
      expect(manager.getStatus()).toBe('stopped');

      await expect(manager.connectAll()).rejects.toThrow('not running');
    });
  });
});
