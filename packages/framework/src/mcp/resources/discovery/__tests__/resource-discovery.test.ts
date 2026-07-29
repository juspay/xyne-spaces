/**
 * Tests for ResourceDiscovery
 */

import { ResourceDiscovery } from '../resource-discovery.js';
import type { MCPClient } from '../../../core/base/mcp-client.js';
import type { MCPResource } from '../../../core/types/framework.js';
import { MCPError } from '../../../core/errors/index.js';

// Mock logger
jest.mock('../../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('ResourceDiscovery', () => {
  let mockMcpClient: jest.Mocked<MCPClient>;
  let discovery: ResourceDiscovery;

  const mockResources: MCPResource[] = [
    {
      uri: 'file:///test1.txt',
      name: 'Test File 1',
      description: 'A test file',
      mimeType: 'text/plain'
    },
    {
      uri: 'file:///test2.json',
      name: 'Test File 2',
      description: 'JSON config file',
      mimeType: 'application/json'
    }
  ];

  beforeEach(() => {
    mockMcpClient = {
      isInitialized: jest.fn(),
      getConnectedServers: jest.fn(),
      listResources: jest.fn(),
      readResource: jest.fn(),
      initialize: jest.fn(),
      shutdown: jest.fn(),
      getServerStatus: jest.fn(),
      getAllServerConnections: jest.fn(),
      listTools: jest.fn(),
      callTool: jest.fn(),
      listPrompts: jest.fn(),
      getPrompt: jest.fn(),
      ping: jest.fn()
    } as Partial<MCPClient> as jest.Mocked<MCPClient>;

    discovery = new ResourceDiscovery(mockMcpClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('discoverAll', () => {
    it('should discover resources from all connected servers', async () => {
      mockMcpClient.isInitialized.mockReturnValue(true);
      mockMcpClient.getConnectedServers.mockReturnValue(['server1', 'server2']);
      mockMcpClient.listResources.mockResolvedValue(mockResources);

      const catalog = await discovery.discoverAll();

      expect(catalog.entries).toHaveLength(4); // 2 resources from 2 servers
      expect(catalog.totalCount).toBe(4);
      expect(catalog.serverCounts).toEqual({
        server1: 2,
        server2: 2
      });
      expect(catalog.lastUpdated).toBeInstanceOf(Date);
    });

    it('should throw error if MCP client is not initialized', async () => {
      mockMcpClient.isInitialized.mockReturnValue(false);

      await expect(discovery.discoverAll()).rejects.toThrow(MCPError);
      await expect(discovery.discoverAll()).rejects.toThrow('MCP client must be initialized');
    });

    it('should handle server failures gracefully', async () => {
      mockMcpClient.isInitialized.mockReturnValue(true);
      mockMcpClient.getConnectedServers.mockReturnValue(['server1', 'server2']);
      mockMcpClient.listResources
        .mockResolvedValueOnce(mockResources)
        .mockRejectedValueOnce(new Error('Server unavailable'));

      const catalog = await discovery.discoverAll();

      expect(catalog.entries).toHaveLength(2); // Only from server1
      expect(catalog.serverCounts).toEqual({
        server1: 2,
        server2: 0
      });
    });

    it('should include extended metadata when requested', async () => {
      mockMcpClient.isInitialized.mockReturnValue(true);
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);
      mockMcpClient.listResources.mockResolvedValue([mockResources[0]!]);
      mockMcpClient.readResource.mockResolvedValue({
        contents: [{ uri: 'text', text: 'test content' }],
        mimeType: 'text/plain'
      });

      const catalog = await discovery.discoverAll({ includeMetadata: true });

      expect(catalog.entries).toHaveLength(1);
      expect(catalog.entries[0]?.metadata.size).toBeGreaterThan(0);
    });
  });

  describe('discoverFromServer', () => {
    it('should discover resources from a specific server', async () => {
      mockMcpClient.listResources.mockResolvedValue(mockResources);

      const entries = await discovery.discoverFromServer('test-server');

      expect(entries).toHaveLength(2);
      expect(entries[0]?.metadata.serverName).toBe('test-server');
      expect(entries[0]?.metadata.uri).toBe('file:///test1.txt');
      expect(mockMcpClient.listResources).toHaveBeenCalledWith('test-server');
    });

    it('should handle resource metadata creation failures', async () => {
      mockMcpClient.listResources.mockResolvedValue(mockResources);
      mockMcpClient.readResource.mockRejectedValue(new Error('Access denied'));

      const entries = await discovery.discoverFromServer('test-server', { includeMetadata: true });

      expect(entries).toHaveLength(2);
      // Should still create entries with basic metadata
      expect(entries[0]?.metadata.serverName).toBe('test-server');
    });

    it('should throw MCPError when server fails', async () => {
      mockMcpClient.listResources.mockRejectedValue(new Error('Connection failed'));

      await expect(discovery.discoverFromServer('test-server')).rejects.toThrow(MCPError);
      await expect(discovery.discoverFromServer('test-server')).rejects.toThrow('Failed to discover resources from server');
    });
  });

  describe('queryResources', () => {
    const mockCatalog = {
      entries: [
        {
          resource: mockResources[0]!,
          metadata: {
            uri: 'file:///test1.txt',
            name: 'Test File 1',
            serverName: 'server1',
            discoveredAt: new Date(),
            mimeType: 'text/plain',
            tags: ['txt', 'data']
          }
        },
        {
          resource: mockResources[1]!,
          metadata: {
            uri: 'file:///test2.json',
            name: 'Test File 2',
            serverName: 'server2',
            discoveredAt: new Date(),
            mimeType: 'application/json',
            tags: ['json', 'config']
          }
        }
      ],
      totalCount: 2,
      serverCounts: { server1: 1, server2: 1 },
      lastUpdated: new Date()
    };

    it('should filter by server name', () => {
      const results = discovery.queryResources(mockCatalog, { serverName: 'server1' });
      
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata.serverName).toBe('server1');
    });

    it('should filter by URI pattern', () => {
      const results = discovery.queryResources(mockCatalog, { uriPattern: '.*\\.json$' });
      
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata.uri).toBe('file:///test2.json');
    });

    it('should filter by MIME type', () => {
      const results = discovery.queryResources(mockCatalog, { mimeType: 'text/plain' });
      
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata.mimeType).toBe('text/plain');
    });

    it('should filter by name pattern', () => {
      const results = discovery.queryResources(mockCatalog, { namePattern: 'File 1' });
      
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata.name).toBe('Test File 1');
    });

    it('should filter by tags', () => {
      const results = discovery.queryResources(mockCatalog, { tags: ['config'] });
      
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata.tags).toContain('config');
    });

    it('should apply pagination', () => {
      const results = discovery.queryResources(mockCatalog, { limit: 1, offset: 1 });
      
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata.uri).toBe('file:///test2.json');
    });

    it('should handle empty query', () => {
      const results = discovery.queryResources(mockCatalog, {});
      
      expect(results).toHaveLength(2);
    });
  });

  describe('tag extraction', () => {
    it('should extract hashtags from description', async () => {
      mockMcpClient.isInitialized.mockReturnValue(true);
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);
      
      const resourceWithTags: MCPResource = {
        uri: 'file:///tagged.txt',
        name: 'tagged.txt',
        description: 'A file with #important #data tags',
        mimeType: 'text/plain'
      };
      
      mockMcpClient.listResources.mockResolvedValue([resourceWithTags]);
      mockMcpClient.readResource.mockResolvedValue({
        contents: [{ uri: 'text', text: 'content' }],
        mimeType: 'text/plain'
      });

      const catalog = await discovery.discoverAll({ includeMetadata: true });

      expect(catalog.entries[0]?.metadata.tags).toContain('important');
      expect(catalog.entries[0]?.metadata.tags).toContain('data');
    });

    it('should extract file extension as tag', async () => {
      mockMcpClient.isInitialized.mockReturnValue(true);
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);
      
      const resource: MCPResource = {
        uri: 'file:///test.py',
        name: 'test.py',
        mimeType: 'text/x-python'
      };
      
      mockMcpClient.listResources.mockResolvedValue([resource]);
      mockMcpClient.readResource.mockResolvedValue({
        contents: [{ uri: 'text', text: 'print("hello")' }],
        mimeType: 'text/x-python'
      });

      const catalog = await discovery.discoverAll({ includeMetadata: true });

      expect(catalog.entries[0]?.metadata.tags).toContain('py');
    });

    it('should extract common keywords as tags', async () => {
      mockMcpClient.isInitialized.mockReturnValue(true);
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);
      
      const resource: MCPResource = {
        uri: 'file:///config.json',
        name: 'config.json',
        description: 'Configuration data for the app',
        mimeType: 'application/json'
      };
      
      mockMcpClient.listResources.mockResolvedValue([resource]);
      mockMcpClient.readResource.mockResolvedValue({
        contents: [{ uri: 'text', text: '{}' }],
        mimeType: 'application/json'
      });

      const catalog = await discovery.discoverAll({ includeMetadata: true });

      expect(catalog.entries[0]?.metadata.tags).toContain('config');
      expect(catalog.entries[0]?.metadata.tags).toContain('data');
      expect(catalog.entries[0]?.metadata.tags).toContain('json');
    });
  });
});