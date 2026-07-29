/**
 * Tests for MCPClient using official SDK
 */

import { MCPClient } from '../mcp-client.js';
import { McpTransportFactory } from '../../../transports/transport-factory.js';
import type { MCPConfig } from '../../types/config.js';

// Mock the official SDK
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
   
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    close: jest.fn(),
    listResources: jest.fn().mockResolvedValue({ resources: [] }),
    readResource: jest.fn(),
    listTools: jest.fn().mockResolvedValue({ tools: [] }),
    callTool: jest.fn(),
    listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
    getPrompt: jest.fn()
  }))
}));

// Mock transport factory
jest.mock('../../../transports/transport-factory.js', () => ({
  McpTransportFactory: {
    createClientWithTransport: jest.fn()
  }
}));

// Mock logger
jest.mock('../../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('MCPClient', () => {
  const mockConfig: MCPConfig = {
    mcpServers: {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'test-server': {
        command: 'node',
        args: ['test-server.js']
      }
    }
  };

  let client: MCPClient;
  let mockClient: {
    connect: jest.Mock;
    close: jest.Mock;
    listResources: jest.Mock;
    readResource: jest.Mock;
    listTools: jest.Mock;
    callTool: jest.Mock;
    listPrompts: jest.Mock;
    getPrompt: jest.Mock;
  };
  let mockTransport: {
    sessionId: string;
  };
  let mockTransportFactory: jest.MockedFunction<typeof McpTransportFactory.createClientWithTransport>;

  beforeEach(() => {
    // Reset all mocks first
    jest.clearAllMocks();
    
    client = new MCPClient(mockConfig);
    
    mockClient = {
      connect: jest.fn(),
      close: jest.fn(),
      listResources: jest.fn().mockResolvedValue({ resources: [] }),
      readResource: jest.fn(),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      callTool: jest.fn(),
      listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
      getPrompt: jest.fn()
    };
    
    mockTransport = {
      sessionId: 'test-session'
    };

    mockTransportFactory = McpTransportFactory.createClientWithTransport as jest.MockedFunction<typeof McpTransportFactory.createClientWithTransport>;
    // Mock implementation matches what we need for testing
    (mockTransportFactory as jest.Mock).mockResolvedValue({
      client: mockClient,
      transport: mockTransport
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully with valid config', async () => {
      await client.initialize();
      
      expect(client.isInitialized()).toBe(true);
      expect(mockTransportFactory).toHaveBeenCalledWith(
        'test-server',
        mockConfig.mcpServers['test-server']
      );
    });

    it('should handle initialization failure gracefully', async () => {
      const error = new Error('Connection failed');
      mockTransportFactory.mockRejectedValueOnce(error);

      // The client should still initialize (mark as initialized) even if individual servers fail
      // This is by design - one server failure shouldn't break the entire client
      await client.initialize();
      expect(client.isInitialized()).toBe(true);
      
      // But the server should be marked as error status
      const status = client.getServerStatus('test-server');
      expect(status?.status).toBe('error');
    });

    it('should track server connection status', async () => {
      await client.initialize();
      
      const connections = client.getAllServerConnections();
      expect(connections).toHaveLength(1);
      expect(connections[0]?.name).toBe('test-server');
      expect(connections[0]?.status).toBe('connected');
    });
  });

  describe('Server Management', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should list connected servers', () => {
      const connectedServers = client.getConnectedServers();
      expect(connectedServers).toEqual(['test-server']);
    });

    it('should get server status', () => {
      const status = client.getServerStatus('test-server');
      expect(status?.status).toBe('connected');
    });

    it('should return undefined for unknown server status', () => {
      const status = client.getServerStatus('unknown-server');
      expect(status).toBeUndefined();
    });
  });

  describe('Resource Operations', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should list resources from specific server', async () => {
      const mockResources = [{ uri: 'test://resource', name: 'Test Resource' }];
      mockClient.listResources.mockResolvedValue({ resources: mockResources });

      const resources = await client.listResources('test-server');
      
      expect(mockClient.listResources).toHaveBeenCalled();
      expect(resources).toEqual(mockResources);
    });

    it('should aggregate resources from all servers when no server specified', async () => {
      const mockResources = [{ uri: 'test://resource', name: 'Test Resource' }];
      mockClient.listResources.mockResolvedValue({ resources: mockResources });

      const resources = await client.listResources();
      
      expect(mockClient.listResources).toHaveBeenCalled();
      expect(resources).toEqual(mockResources);
    });

    it('should read resource from specific server', async () => {
      const mockContent = { uri: 'test://resource', text: 'content' };
      mockClient.readResource.mockResolvedValue(mockContent);

      const content = await client.readResource('test://resource', 'test-server');
      
      expect(mockClient.readResource).toHaveBeenCalledWith({ uri: 'test://resource' });
      expect(content).toEqual(mockContent);
    });

    it('should try all servers when reading resource without server specified', async () => {
      const mockContent = { uri: 'test://resource', text: 'content' };
      mockClient.readResource.mockResolvedValue(mockContent);

      const content = await client.readResource('test://resource');
      
      expect(mockClient.readResource).toHaveBeenCalledWith({ uri: 'test://resource' });
      expect(content).toEqual(mockContent);
    });
  });

  describe('Tool Operations', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should list tools from specific server', async () => {
      const mockTools = [{ name: 'test-tool', description: 'Test tool' }];
      mockClient.listTools.mockResolvedValue({ tools: mockTools });

      const tools = await client.listTools('test-server');
      
      expect(mockClient.listTools).toHaveBeenCalled();
      expect(tools).toEqual(mockTools);
    });

    it('should call tool on specific server', async () => {
      const mockResult = { content: [{ type: 'text', text: 'result' }] };
      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await client.callTool('test-server', 'test-tool', { arg: 'value' });
      
      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'test-tool',
        arguments: { arg: 'value' }
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe('Prompt Operations', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should list prompts from specific server', async () => {
      const mockPrompts = [{ name: 'test-prompt', description: 'Test prompt' }];
      mockClient.listPrompts.mockResolvedValue({ prompts: mockPrompts });

      const prompts = await client.listPrompts('test-server');
      
      expect(mockClient.listPrompts).toHaveBeenCalled();
      expect(prompts).toEqual(mockPrompts);
    });

    it('should get prompt from specific server', async () => {
      const mockPrompt = { 
        description: 'Test prompt',
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }]
      };
      mockClient.getPrompt.mockResolvedValue(mockPrompt);

      const prompt = await client.getPrompt('test-server', 'test-prompt', { arg: 'value' });
      
      expect(mockClient.getPrompt).toHaveBeenCalledWith({
        name: 'test-prompt',
        arguments: { arg: 'value' }
      });
      expect(prompt).toEqual(mockPrompt);
    });
  });

  describe('Health Check', () => {
    beforeEach(async () => {
      await client.initialize();
    });

    it('should ping server successfully', async () => {
      await expect(client.ping('test-server')).resolves.not.toThrow();
      expect(mockClient.listResources).toHaveBeenCalled();
    });

    it('should throw error when pinging disconnected server', async () => {
      // Simulate disconnected server by accessing protected method
      (client as MCPClient & { updateServerConnection: (name: string, updates: { status: string }) => void })
        .updateServerConnection('test-server', { status: 'disconnected' });

      await expect(client.ping('test-server')).rejects.toThrow();
    });
  });

  describe('Shutdown', () => {
    it('should shutdown gracefully', async () => {
      await client.initialize();
      await client.shutdown();
      
      expect(mockClient.close).toHaveBeenCalled();
      expect(client.isInitialized()).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when calling methods before initialization', async () => {
      await expect(client.listResources()).rejects.toThrow('MCP client is not initialized');
      await expect(client.listTools()).rejects.toThrow('MCP client is not initialized');
      await expect(client.callTool('test', 'tool', {})).rejects.toThrow('MCP client is not initialized');
    });

    it('should throw error when accessing non-existent server', async () => {
      await client.initialize();
      
      await expect(client.callTool('unknown-server', 'tool', {})).rejects.toThrow();
      await expect(client.getPrompt('unknown-server', 'prompt', {})).rejects.toThrow();
    });
  });
});