/**
 * Tests for ResourceAccessor
 */

import { ResourceAccessor } from '../resource-accessor.js';
import type { MCPClient } from '../../../core/base/mcp-client.js';
import type { MCPResource, MCPResourceResult } from '../../../core/types/framework.js';
import type { ResourceCatalog } from '../../types/index.js';
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

describe('ResourceAccessor', () => {
  let mockMcpClient: jest.Mocked<MCPClient>;
  let accessor: ResourceAccessor;

  const mockResourceResult: MCPResourceResult = {
    contents: [{ uri: 'text', text: 'test content' }],
    mimeType: 'text/plain'
  };

  const mockCatalog: ResourceCatalog = {
    entries: [
      {
        resource: {
          uri: 'file:///test.txt',
          name: 'test.txt',
          mimeType: 'text/plain'
        },
        metadata: {
          uri: 'file:///test.txt',
          serverName: 'server1',
          discoveredAt: new Date()
        }
      }
    ],
    totalCount: 1,
    serverCounts: { server1: 1 },
    lastUpdated: new Date()
  };

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

    accessor = new ResourceAccessor(mockMcpClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('accessResource', () => {
    it('should access resource from preferred server first', async () => {
      mockMcpClient.readResource.mockResolvedValue(mockResourceResult);

      const result = await accessor.accessResource('file:///test.txt', {
        preferredServer: 'server1'
      });

      expect(result.content).toEqual(mockResourceResult);
      expect(result.serverName).toBe('server1');
      expect(result.accessedAt).toBeInstanceOf(Date);
      expect(mockMcpClient.readResource).toHaveBeenCalledWith('file:///test.txt', 'server1');
    });

    it('should fallback to other servers if preferred server fails', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue(['server1', 'server2']);
      
      // Mock the accessFromServer method calls
      jest.spyOn(accessor, 'accessFromServer')
        .mockRejectedValueOnce(new Error('Server 1 failed'))
        .mockResolvedValueOnce({
          content: mockResourceResult,
          accessedAt: new Date()
        });

      const result = await accessor.accessResource('file:///test.txt', {
        preferredServer: 'server1'
      });

      expect(result.content).toEqual(mockResourceResult);
      expect(result.serverName).toBe('server2');
    });

    it('should try all connected servers if no preferred server', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue(['server1', 'server2']);
      
      // Mock the accessFromServer method calls
      jest.spyOn(accessor, 'accessFromServer')
        .mockRejectedValueOnce(new Error('Server 1 failed'))
        .mockResolvedValueOnce({
          content: mockResourceResult,
          accessedAt: new Date()
        });

      const result = await accessor.accessResource('file:///test.txt');

      expect(result.serverName).toBe('server2');
    });

    it('should throw MCPError if all servers fail', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue(['server1', 'server2']);
      mockMcpClient.readResource.mockRejectedValue(new Error('Server failed'));

      await expect(accessor.accessResource('file:///test.txt')).rejects.toThrow(MCPError);
      await expect(accessor.accessResource('file:///test.txt')).rejects.toThrow('Resource not found or inaccessible');
    });
  });

  describe('accessFromServer', () => {
    it('should access resource from specific server successfully', async () => {
      mockMcpClient.readResource.mockResolvedValue(mockResourceResult);

      const result = await accessor.accessFromServer('file:///test.txt', 'server1');

      expect(result.content).toEqual(mockResourceResult);
      expect(result.accessedAt).toBeInstanceOf(Date);
      expect(mockMcpClient.readResource).toHaveBeenCalledWith('file:///test.txt', 'server1');
    });

    it('should retry on failure with configurable delay', async () => {
      mockMcpClient.readResource
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce(mockResourceResult);

      const result = await accessor.accessFromServer('file:///test.txt', 'server1', {
        retryCount: 2,
        retryDelay: 10 // Short delay for tests
      });

      expect(result.content).toEqual(mockResourceResult);
      expect(mockMcpClient.readResource).toHaveBeenCalledTimes(2);
    });

    it('should throw MCPError after max retries', async () => {
      mockMcpClient.readResource.mockRejectedValue(new Error('Persistent failure'));

      await expect(
        accessor.accessFromServer('file:///test.txt', 'server1', { retryCount: 2 })
      ).rejects.toThrow(MCPError);
      
      expect(mockMcpClient.readResource).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolveUri', () => {
    it('should resolve URI using catalog if provided', async () => {
      const results = await accessor.resolveUri('file:///test.txt', mockCatalog);

      expect(results).toHaveLength(1);
      expect(results[0]?.uri).toBe('file:///test.txt');
      expect(results[0]?.serverName).toBe('server1');
      expect(results[0]?.exists).toBe(true);
      expect(results[0]?.catalogEntry).toBeDefined();
    });

    it('should check all servers if not found in catalog', async () => {
      const emptyCatalog: ResourceCatalog = {
        entries: [],
        totalCount: 0,
        serverCounts: {},
        lastUpdated: new Date()
      };

      mockMcpClient.getConnectedServers.mockReturnValue(['server1', 'server2']);
      mockMcpClient.listResources
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          uri: 'file:///test.txt',
          name: 'test.txt',
          mimeType: 'text/plain'
        }]);

      const results = await accessor.resolveUri('file:///test.txt', emptyCatalog);

      expect(results).toHaveLength(2);
      expect(results[0]?.exists).toBe(false);
      expect(results[1]?.exists).toBe(true);
    });

    it('should handle server failures during resolution', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue(['server1', 'server2']);
      mockMcpClient.listResources
        .mockRejectedValueOnce(new Error('Server failed'))
        .mockResolvedValueOnce([]);

      const results = await accessor.resolveUri('file:///test.txt');

      expect(results).toHaveLength(2);
      expect(results[0]?.exists).toBe(false);
      expect(results[1]?.exists).toBe(false);
    });
  });

  describe('batchAccess', () => {
    it('should access multiple resources in parallel', async () => {
      const uris = ['file:///test1.txt', 'file:///test2.txt'];
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);
      mockMcpClient.readResource.mockResolvedValue(mockResourceResult);

      const results = await accessor.batchAccess(uris);

      expect(results.size).toBe(2);
      expect(results.get('file:///test1.txt')).toBeDefined();
      expect(results.get('file:///test2.txt')).toBeDefined();
      
      // Check successful results
      const result1 = results.get('file:///test1.txt');
      if (!(result1 instanceof Error)) {
        expect(result1?.content).toEqual(mockResourceResult);
      }
    });

    it('should handle mixed success and failure in batch', async () => {
      const uris = ['file:///test1.txt', 'file:///test2.txt'];
      
      // Mock accessResource calls directly
      jest.spyOn(accessor, 'accessResource')
        .mockResolvedValueOnce({
          content: mockResourceResult,
          serverName: 'server1',
          accessedAt: new Date()
        })
        .mockRejectedValueOnce(new Error('Access denied'));

      const results = await accessor.batchAccess(uris);

      expect(results.size).toBe(2);
      
      const result1 = results.get('file:///test1.txt');
      const result2 = results.get('file:///test2.txt');
      
      expect(result1).not.toBeInstanceOf(Error);
      expect(result2).toBeInstanceOf(Error);
    });

    it('should process in chunks to limit concurrency', async () => {
      const uris = Array.from({ length: 10 }, (_, i) => `file:///test${i}.txt`);
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);
      mockMcpClient.readResource.mockResolvedValue(mockResourceResult);

      const results = await accessor.batchAccess(uris);

      expect(results.size).toBe(10);
      expect(mockMcpClient.readResource).toHaveBeenCalledTimes(10);
    });
  });

  describe('exists', () => {
    it('should check resource existence on specific server', async () => {
      const resource: MCPResource = {
        uri: 'file:///test.txt',
        name: 'test.txt',
        mimeType: 'text/plain'
      };
      
      mockMcpClient.listResources.mockResolvedValue([resource]);

      const exists = await accessor.exists('file:///test.txt', 'server1');

      expect(exists).toBe(true);
      expect(mockMcpClient.listResources).toHaveBeenCalledWith('server1');
    });

    it('should return false if resource not found', async () => {
      mockMcpClient.listResources.mockResolvedValue([]);

      const exists = await accessor.exists('file:///nonexistent.txt', 'server1');

      expect(exists).toBe(false);
    });

    it('should check all servers if no server specified', async () => {
      // Mock resolveUri method behavior
      const resolveUriSpy = jest.spyOn(accessor, 'resolveUri').mockResolvedValue([
        { uri: 'file:///test.txt', serverName: 'server1', exists: true }
      ]);

      const exists = await accessor.exists('file:///test.txt');

      expect(exists).toBe(true);
      expect(resolveUriSpy).toHaveBeenCalledWith('file:///test.txt');
      
      resolveUriSpy.mockRestore();
    });

    it('should return false on error', async () => {
      mockMcpClient.listResources.mockRejectedValue(new Error('Server error'));

      const exists = await accessor.exists('file:///test.txt', 'server1');

      expect(exists).toBe(false);
    });
  });

  describe('getMetadata', () => {
    it('should return metadata from catalog if available', async () => {
      const metadata = await accessor.getMetadata('file:///test.txt', mockCatalog);

      expect(metadata).toBeDefined();
      expect(metadata?.resource.uri).toBe('file:///test.txt');
      expect(metadata?.metadata.serverName).toBe('server1');
    });

    it('should search servers if no catalog provided', async () => {
      const resource: MCPResource = {
        uri: 'file:///test.txt',
        name: 'test.txt',
        mimeType: 'text/plain'
      };
      
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);
      mockMcpClient.listResources.mockResolvedValue([resource]);

      const metadata = await accessor.getMetadata('file:///test.txt');

      expect(metadata).toBeDefined();
      expect(metadata?.resource).toEqual(resource);
      expect(metadata?.metadata.serverName).toBe('server1');
    });

    it('should return undefined if resource not found', async () => {
      const emptyCatalog: ResourceCatalog = {
        entries: [],
        totalCount: 0,
        serverCounts: {},
        lastUpdated: new Date()
      };

      const metadata = await accessor.getMetadata('file:///nonexistent.txt', emptyCatalog);

      expect(metadata).toBeUndefined();
    });

    it('should handle server errors gracefully', async () => {
      mockMcpClient.getConnectedServers.mockReturnValue(['server1']);
      mockMcpClient.listResources.mockRejectedValue(new Error('Server error'));

      const metadata = await accessor.getMetadata('file:///test.txt');

      expect(metadata).toBeUndefined();
    });
  });
});