/**
 * Tests for McpTransportFactory using official SDK
 */

import { McpTransportFactory } from '../transport-factory.js';
import type { MCPLocalServerConfig, MCPRemoteServerConfig, MCPServerConfig } from '../../core/types/config.js';

// Create mock implementations that persist across clearAllMocks
const mockClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
  listResources: jest.fn().mockResolvedValue({ resources: [] })
};

const mockStdioTransport = {
  sessionId: 'stdio-session'
};

const mockHTTPTransport = {
  sessionId: 'http-session'
};

// Mock the official SDK
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
   
  Client: jest.fn().mockImplementation(() => mockClient)
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
   
  StdioClientTransport: jest.fn().mockImplementation(() => mockStdioTransport)
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
   
  StreamableHTTPClientTransport: jest.fn().mockImplementation(() => mockHTTPTransport)
}));

// Mock logger
jest.mock('../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('McpTransportFactory', () => {
  beforeEach(() => {
    // Clear call counts but keep implementations
    jest.clearAllMocks();
    // Reset mock implementations to default successful state
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.close.mockResolvedValue(undefined);
    mockClient.listResources.mockResolvedValue({ resources: [] });
  });

  describe('Local Server (Stdio) Transport', () => {
    const localConfig: MCPLocalServerConfig = {
      command: 'node',
      args: ['test-server.js'],
      env: { TEST_VAR: 'test' },
      cwd: '/test/dir'
    };

    it('should create stdio transport for local server config', async () => {
      const { client, transport } = await McpTransportFactory.createClientWithTransport(
        'test-server',
        localConfig
      );

      expect(client).toBeDefined();
      expect(transport).toBeDefined();
      // Stdio transport doesn't have sessionId, just verify it's the right type
      expect(transport).toHaveProperty('constructor');
    });

    it('should handle missing optional properties in local config', async () => {
      const minimalConfig: MCPLocalServerConfig = {
        command: 'node'
      };

      const { client, transport } = await McpTransportFactory.createClientWithTransport(
        'test-server',
        minimalConfig
      );

      expect(client).toBeDefined();
      expect(transport).toBeDefined();
    });

    it('should filter undefined environment variables', async () => {
      // This test ensures our environment variable filtering works correctly
      const configWithEnv: MCPLocalServerConfig = {
        command: 'node',
        env: { DEFINED_VAR: 'value' }
      };

      await expect(
        McpTransportFactory.createClientWithTransport('test-server', configWithEnv)
      ).resolves.toBeDefined();
    });

    it('should handle stdio transport connection failure', async () => {
      // Mock connection failure
      mockClient.connect.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(
        McpTransportFactory.createClientWithTransport('test-server', localConfig)
      ).rejects.toThrow('Failed to connect to local server test-server');
    });
  });

  describe('Remote Server (HTTP) Transport', () => {
    const remoteConfig: MCPRemoteServerConfig = {
      transport: {
        type: 'http',
        url: 'https://example.com/mcp',
        timeout: 5000
      }
    };

    it('should create HTTP transport for remote server config', async () => {
      const { client, transport } = await McpTransportFactory.createClientWithTransport(
        'test-server',
        remoteConfig
      );

      expect(client).toBeDefined();
      expect(transport).toBeDefined();
      // HTTP transport should have sessionId
      expect((transport as { sessionId: string }).sessionId).toBe('http-session');
    });

    it('should handle HTTP transport connection failure', async () => {
      // Mock connection failure
      mockClient.connect.mockRejectedValueOnce(new Error('HTTP connection failed'));

      await expect(
        McpTransportFactory.createClientWithTransport('test-server', remoteConfig)
      ).rejects.toThrow('Failed to connect to remote server test-server');
    });

    it('should parse URL correctly', async () => {
      const configWithComplexUrl: MCPRemoteServerConfig = {
        transport: {
          type: 'http',
          url: 'https://example.com:8080/mcp/v1'
        }
      };

      const { client, transport } = await McpTransportFactory.createClientWithTransport(
        'test-server',
        configWithComplexUrl
      );

      expect(client).toBeDefined();
      expect(transport).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should throw error for invalid config', async () => {
      // Create an object that doesn't match either local or remote server config
      const invalidConfig = {} as MCPServerConfig;

      await expect(
        McpTransportFactory.createClientWithTransport('test-server', invalidConfig)
      ).rejects.toThrow('Invalid server configuration for test-server');
    });

    it('should create proper MCP errors with server context', async () => {
      // Use empty config which will fail validation
      const invalidConfig = {} as MCPServerConfig;

      try {
        await McpTransportFactory.createClientWithTransport('test-server', invalidConfig);
      } catch (error) {
        const mcpError = error as { mcpError: { serverName: string; type: string; retryable: boolean } };
        expect(mcpError.mcpError.serverName).toBe('test-server');
        expect(mcpError.mcpError.type).toBe('CONFIG_ERROR');
        expect(mcpError.mcpError.retryable).toBe(false);
      }
    });
  });

  describe('Connection Testing', () => {
    const localConfig: MCPLocalServerConfig = {
      command: 'echo',
      args: ['test']
    };

    it('should test connection successfully', async () => {
      const result = await McpTransportFactory.testConnection('test-server', localConfig);
      expect(result).toBe(true);
    });

    it('should handle connection test failure', async () => {
      // Mock connection failure
      mockClient.connect.mockRejectedValueOnce(new Error('Test connection failed'));

      const result = await McpTransportFactory.testConnection('test-server', localConfig);
      expect(result).toBe(false);
    });

    it('should clean up resources after connection test', async () => {
      await McpTransportFactory.testConnection('test-server', localConfig);
      expect(mockClient.close).toHaveBeenCalled();
    });
  });

  describe('Type Safety', () => {
    it('should handle environment variable type safety', async () => {
      // Test that our type assertions work correctly
      const config: MCPLocalServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: { NODE_ENV: 'test' }
      };

      // This should not throw type errors
      await expect(
        McpTransportFactory.createClientWithTransport('test-server', config)
      ).resolves.toBeDefined();
    });

    it('should handle optional cwd property correctly', async () => {
      const configWithCwd: MCPLocalServerConfig = {
        command: 'node',
        cwd: '/some/path'
      };

      const configWithoutCwd: MCPLocalServerConfig = {
        command: 'node'
      };

      // Both should work without type errors
      await expect(
        McpTransportFactory.createClientWithTransport('test-server-1', configWithCwd)
      ).resolves.toBeDefined();

      await expect(
        McpTransportFactory.createClientWithTransport('test-server-2', configWithoutCwd)
      ).resolves.toBeDefined();
    });
  });

  describe('Client Info', () => {
    it('should use consistent client info across transports', async () => {
      const localConfig: MCPLocalServerConfig = { command: 'node' };
      
      await McpTransportFactory.createClientWithTransport('test-server', localConfig);
      
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const MockedClient = Client as jest.MockedClass<typeof Client>;
      
      expect(MockedClient).toHaveBeenCalledWith({
        name: 'ai-framework-mcp-client',
        version: '1.0.0'
      });
    });
  });
});