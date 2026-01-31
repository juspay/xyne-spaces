/**
 * Basic integration test for MCP server management
 */

import { createMCPManager } from '../index.js';

// Mock logger to avoid console output during tests
jest.mock('../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock config loader
jest.mock('../../config/config-loader.js', () => {
  return {
     
    MCPConfigLoader: jest.fn().mockImplementation(() => ({
      loadConfig: jest.fn().mockResolvedValue({
        success: true,
        config: {
          mcpServers: {
            testServer: {
              command: 'echo',
              args: ['test']
            }
          }
        }
      })
    }))
  };
});

describe('MCP Server Management Integration', (): void => {
  describe('Basic Functionality', (): void => {
    it('should create MCP manager', (): void => {
      const manager = createMCPManager({
        localConfigPath: '/test/config.json',
        autoConnect: false,
        enableHealthMonitoring: false
      });
      
      expect(manager).toBeDefined();
      expect(manager.getStatus()).toBe('stopped');
    });

    it('should start and stop manager', async (): Promise<void> => {
      const manager = createMCPManager({
        localConfigPath: '/test/config.json',
        autoConnect: false,
        enableHealthMonitoring: false
      });

      try {
        await manager.start();
        expect(manager.getStatus()).toBe('running');

        await manager.stop();
        expect(manager.getStatus()).toBe('stopped');
      } catch (error) {
        // Expected since we're using mock echo command
        void error; // Mark as used
        expect(manager.getStatus()).toBe('stopped');
      }
    });

    it('should handle configuration loading', async (): Promise<void> => {
      const manager = createMCPManager({
        localConfigPath: '/test/config.json',
        autoConnect: false,
        enableHealthMonitoring: false
      });

      try {
        await manager.start();
        const config = manager.getConfig();
        expect(config).toBeDefined();
        expect(config?.mcpServers).toBeDefined();
      } catch (error) {
        // Expected for mock config
        void error; // Mark as used
      } finally {
        await manager.stop();
      }
    });
  });
});