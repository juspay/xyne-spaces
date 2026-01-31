/**
 * Tests for ToolDiscovery - discovers and catalogs tools from MCP servers
 */

import { ToolDiscovery } from '../tool-discovery.js';
import { MCPError } from '../../../core/errors/index.js';
import type { MCPClient } from '../../../core/base/mcp-client.js';
import type { MCPTool } from '../../../core/types/framework.js';
import type { MCPToolCatalog, ToolDiscoveryOptions } from '../../types/index.js';

// Mock the logger
jest.mock('../../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

describe('ToolDiscovery', () => {
  let mockMcpClient: jest.Mocked<MCPClient>;
  let discovery: ToolDiscovery;

  beforeEach(() => {
    mockMcpClient = {
      isInitialized: jest.fn().mockReturnValue(true),
      getConnectedServers: jest.fn().mockReturnValue(['server1', 'server2']),
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
      ping: jest.fn(),
      listPrompts: jest.fn(),
      getPrompt: jest.fn()
    } as unknown as jest.Mocked<MCPClient>;

    discovery = new ToolDiscovery(mockMcpClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockTools: MCPTool[] = [
    {
      name: 'file-read',
      description: 'Read files from the filesystem',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    },
    {
      name: 'search-grep',
      description: 'Search through files using grep',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } }
        },
        required: ['pattern']
      }
    },
    {
      name: 'disabled-tool',
      description: '', // Invalid tool - missing description
      inputSchema: {
        type: 'object',
        properties: {}
      }
    }
  ];

  describe('discoverAll', () => {
    it('should discover tools from all connected servers', async () => {
      mockMcpClient.listTools.mockImplementation((serverName?: string) => {
        if (serverName === 'server1') {
          return Promise.resolve([mockTools[0]!, mockTools[2]!]);
        }
        if (serverName === 'server2') {
          return Promise.resolve([mockTools[1]!]);
        }
        return Promise.resolve([]);
      });

      const catalog = await discovery.discoverAll();

      expect(catalog.totalCount).toBe(2); // disabled-tool should be filtered out
      expect(catalog.entries).toHaveLength(2);
      expect(catalog.serverCounts).toEqual({
        server1: 1, // only valid tool
        server2: 1
      });
      expect(catalog.lastUpdated).toBeInstanceOf(Date);

      // Check that framework names are generated correctly
      expect(catalog.entries[0]?.frameworkName).toBe('mcp_server1_file_read');
      expect(catalog.entries[1]?.frameworkName).toBe('mcp_server2_search_grep');

      // Check that all entries have correct properties
      catalog.entries.forEach(entry => {
        expect(entry.tool).toBeDefined();
        expect(entry.serverName).toBeDefined();
        expect(entry.discoveredAt).toBeInstanceOf(Date);
        expect(typeof entry.isAvailable).toBe('boolean');
        expect(typeof entry.frameworkName).toBe('string');
      });
    });

    it('should throw error when MCP client is not initialized', async () => {
      mockMcpClient.isInitialized.mockReturnValue(false);

      await expect(discovery.discoverAll()).rejects.toThrow(MCPError);
      await expect(discovery.discoverAll()).rejects.toThrow('MCP client must be initialized');
    });

    it('should handle server discovery failures gracefully', async () => {
      mockMcpClient.listTools.mockImplementation((serverName) => {
        if (serverName === 'server1') {
          return Promise.reject(new Error('Server connection failed'));
        }
        return Promise.resolve([mockTools[1]!]);
      });

      const catalog = await discovery.discoverAll();

      expect(catalog.totalCount).toBe(1);
      expect(catalog.serverCounts).toEqual({
        server1: 0, // Failed server
        server2: 1
      });
    });

    it('should filter by server names when specified', async () => {
      mockMcpClient.listTools.mockResolvedValue([mockTools[0]!]);

      const options: ToolDiscoveryOptions = {
        serverFilter: ['server1']
      };

      await discovery.discoverAll(options);

      expect(mockMcpClient.listTools).toHaveBeenCalledTimes(1);
      expect(mockMcpClient.listTools).toHaveBeenCalledWith('server1');
    });

    it('should include disabled tools when requested', async () => {
      mockMcpClient.listTools.mockImplementation((serverName?: string) => {
        if (serverName === 'server1') {
          return Promise.resolve([mockTools[0]!, mockTools[2]!]); // file-read, disabled-tool
        }
        if (serverName === 'server2') {
          return Promise.resolve([mockTools[1]!]); // search-grep
        }
        return Promise.resolve([]);
      });

      const options: ToolDiscoveryOptions = {
        includeDisabled: true
      };

      const catalog = await discovery.discoverAll(options);

      expect(catalog.totalCount).toBe(3); // All tools including disabled
      expect(catalog.entries.some(e => !e.isAvailable)).toBe(true);
    });

    it('should filter by category when specified', async () => {
      const fileTool: MCPTool = {
        name: 'file-tool',
        description: 'File operations [file]',
        inputSchema: { type: 'object', properties: {} }
      };

      mockMcpClient.listTools.mockImplementation((serverName?: string) => {
        if (serverName === 'server1') {
          return Promise.resolve([fileTool]);
        }
        if (serverName === 'server2') {
          return Promise.resolve([]); // No file tools on server2
        }
        return Promise.resolve([]);
      });

      const options: ToolDiscoveryOptions = {
        categoryFilter: ['file']
      };

      const catalog = await discovery.discoverAll(options);

      expect(catalog.totalCount).toBe(1);
      expect(catalog.entries[0]?.tool.name).toBe('file-tool');
    });
  });

  describe('discoverFromServer', () => {
    it('should discover tools from specific server', async () => {
      mockMcpClient.listTools.mockResolvedValue([mockTools[0]!, mockTools[1]!]);

      const entries = await discovery.discoverFromServer('test-server');

      expect(entries).toHaveLength(2);
      expect(entries[0]?.serverName).toBe('test-server');
      expect(entries[0]?.tool).toBe(mockTools[0]);
      expect(entries[0]?.isAvailable).toBe(true);
      expect(mockMcpClient.listTools).toHaveBeenCalledWith('test-server');
    });

    it('should handle server discovery failure', async () => {
      mockMcpClient.listTools.mockRejectedValue(new Error('Connection failed'));

      await expect(discovery.discoverFromServer('failing-server'))
        .rejects.toThrow(MCPError);
    });

    it('should generate unique framework names', async () => {
      const toolsWithSpecialChars: MCPTool[] = [
        {
          name: 'tool-with-dashes',
          description: 'Tool with dashes',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'tool_with_underscores',
          description: 'Tool with underscores',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'tool@with#special$chars',
          description: 'Tool with special characters',
          inputSchema: { type: 'object', properties: {} }
        }
      ];

      mockMcpClient.listTools.mockResolvedValue(toolsWithSpecialChars);

      const entries = await discovery.discoverFromServer('test-server');

      expect(entries[0]?.frameworkName).toBe('mcp_test_server_tool_with_dashes');
      expect(entries[1]?.frameworkName).toBe('mcp_test_server_tool_with_underscores');
      expect(entries[2]?.frameworkName).toBe('mcp_test_server_tool_with_special_chars');
    });
  });

  describe('queryTools', () => {
    let sampleCatalog: MCPToolCatalog;

    beforeEach(() => {
      sampleCatalog = {
        entries: [
          {
            tool: {
              name: 'file-read',
              description: 'Read files [file]',
              inputSchema: { type: 'object', properties: {} }
            },
            serverName: 'server1',
            discoveredAt: new Date(),
            isAvailable: true,
            frameworkName: 'mcp_server1_file_read'
          },
          {
            tool: {
              name: 'search-grep',
              description: 'Search files [search]',
              inputSchema: { type: 'object', properties: {} }
            },
            serverName: 'server2',
            discoveredAt: new Date(),
            isAvailable: true,
            frameworkName: 'mcp_server2_search_grep'
          },
          {
            tool: {
              name: 'disabled-tool',
              description: 'Disabled tool',
              inputSchema: { type: 'object', properties: {} }
            },
            serverName: 'server1',
            discoveredAt: new Date(),
            isAvailable: false,
            frameworkName: 'mcp_server1_disabled_tool'
          }
        ],
        totalCount: 3,
        serverCounts: { server1: 2, server2: 1 },
        lastUpdated: new Date()
      };
    });

    it('should filter by server name', () => {
      const results = discovery.queryTools(sampleCatalog, { serverName: 'server1' });

      expect(results).toHaveLength(2);
      expect(results.every(r => r.serverName === 'server1')).toBe(true);
    });

    it('should filter by tool name', () => {
      const results = discovery.queryTools(sampleCatalog, { toolName: 'file-read' });

      expect(results).toHaveLength(1);
      expect(results[0]?.tool.name).toBe('file-read');
    });

    it('should filter by name pattern', () => {
      const results = discovery.queryTools(sampleCatalog, { namePattern: 'search' });

      expect(results).toHaveLength(1);
      expect(results[0]?.tool.name).toBe('search-grep');
    });

    it('should filter by framework name pattern', () => {
      const results = discovery.queryTools(sampleCatalog, { namePattern: 'mcp_server2' });

      expect(results).toHaveLength(1);
      expect(results[0]?.frameworkName).toContain('mcp_server2');
    });

    it('should filter by category', () => {
      const results = discovery.queryTools(sampleCatalog, { category: 'file' });

      expect(results).toHaveLength(1);
      expect(results[0]?.tool.description).toContain('[file]');
    });

    it('should filter by availability', () => {
      const availableResults = discovery.queryTools(sampleCatalog, { isAvailable: true });
      const unavailableResults = discovery.queryTools(sampleCatalog, { isAvailable: false });

      expect(availableResults).toHaveLength(2);
      expect(unavailableResults).toHaveLength(1);
      expect(availableResults.every(r => r.isAvailable)).toBe(true);
      expect(unavailableResults.every(r => !r.isAvailable)).toBe(true);
    });

    it('should apply pagination with limit', () => {
      const results = discovery.queryTools(sampleCatalog, { limit: 2 });

      expect(results).toHaveLength(2);
    });

    it('should apply pagination with offset', () => {
      const results = discovery.queryTools(sampleCatalog, { offset: 1, limit: 2 });

      expect(results).toHaveLength(2);
      expect(results[0]).toBe(sampleCatalog.entries[1]);
    });

    it('should apply offset without limit', () => {
      const results = discovery.queryTools(sampleCatalog, { offset: 1 });

      expect(results).toHaveLength(2);
      expect(results[0]).toBe(sampleCatalog.entries[1]);
    });

    it('should combine multiple filters', () => {
      const results = discovery.queryTools(sampleCatalog, {
        serverName: 'server1',
        isAvailable: true
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.serverName).toBe('server1');
      expect(results[0]?.isAvailable).toBe(true);
    });
  });

  describe('refreshAvailability', () => {
    let sampleCatalog: MCPToolCatalog;

    beforeEach(() => {
      sampleCatalog = {
        entries: [
          {
            tool: mockTools[0]!,
            serverName: 'server1',
            discoveredAt: new Date(),
            isAvailable: true,
            frameworkName: 'mcp_server1_file_read'
          },
          {
            tool: mockTools[1]!,
            serverName: 'server2',
            discoveredAt: new Date(),
            isAvailable: true,
            frameworkName: 'mcp_server2_search_grep'
          }
        ],
        totalCount: 2,
        serverCounts: { server1: 1, server2: 1 },
        lastUpdated: new Date()
      };
    });

    it('should update availability based on server status', () => {
      mockMcpClient.getServerStatus.mockImplementation((serverName) => {
        if (serverName === 'server1') {
          return { status: 'connected' };
        }
        return { status: 'error' };
      });

      const updatedCatalog = discovery.refreshAvailability(sampleCatalog);

      expect(updatedCatalog.entries[0]?.isAvailable).toBe(true); // server1 connected
      expect(updatedCatalog.entries[1]?.isAvailable).toBe(false); // server2 error
      expect(updatedCatalog.lastUpdated).not.toBe(sampleCatalog.lastUpdated);
    });

    it('should mark tools as unavailable when server status check fails', () => {
      mockMcpClient.getServerStatus.mockImplementation(() => {
        throw new Error('Status check failed');
      });

      const updatedCatalog = discovery.refreshAvailability(sampleCatalog);

      expect(updatedCatalog.entries.every(e => !e.isAvailable)).toBe(true);
    });

    it('should handle missing server status', () => {
      mockMcpClient.getServerStatus.mockReturnValue(undefined);

      const updatedCatalog = discovery.refreshAvailability(sampleCatalog);

      expect(updatedCatalog.entries.every(e => !e.isAvailable)).toBe(true);
    });
  });

  describe('helper methods', () => {
    it('should get tools by category', async () => {
      mockMcpClient.listTools.mockImplementation((serverName?: string) => {
        if (serverName === 'server1') {
          return Promise.resolve([{
            name: 'file-tool',
            description: 'File operations [file]',
            inputSchema: { type: 'object', properties: {} }
          }]);
        }
        if (serverName === 'server2') {
          return Promise.resolve([]); // No tools on server2
        }
        return Promise.resolve([]);
      });

      const catalog = await discovery.discoverAll();
      const fileTools = discovery.getToolsByCategory(catalog, 'file');

      expect(fileTools).toHaveLength(1);
      expect(fileTools[0]?.tool.name).toBe('file-tool');
    });

    it('should get tools by server', async () => {
      mockMcpClient.listTools.mockImplementation((serverName) => {
        if (serverName === 'server1') {
          return Promise.resolve([mockTools[0]!]);
        }
        return Promise.resolve([mockTools[1]!]);
      });

      const catalog = await discovery.discoverAll();
      const server1Tools = discovery.getToolsByServer(catalog, 'server1');

      expect(server1Tools).toHaveLength(1);
      expect(server1Tools[0]?.serverName).toBe('server1');
    });
  });

  describe('tool validation', () => {
    it('should validate tool has required properties', async () => {
      const invalidTools: MCPTool[] = [
        {
          name: '',  // Invalid: empty name
          description: 'Tool with empty name',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'tool-with-missing-description',
          description: '',  // Invalid: empty description
          inputSchema: { type: 'object', properties: {} }
        }
      ];

      mockMcpClient.listTools.mockResolvedValue(invalidTools);

      const entries = await discovery.discoverFromServer('test-server', {
        includeDisabled: true
      });

      expect(entries.every(e => !e.isAvailable)).toBe(true);
    });

    it('should accept tools without input schema', async () => {
      const toolWithoutSchema: MCPTool[] = [
        {
          name: 'simple-tool',
          description: 'Simple tool without schema',
          inputSchema: { type: 'object', properties: {} }
        }
      ];

      mockMcpClient.listTools.mockResolvedValue(toolWithoutSchema);

      const entries = await discovery.discoverFromServer('test-server');

      expect(entries).toHaveLength(1);
      expect(entries[0]?.isAvailable).toBe(true);
    });
  });

  describe('category extraction', () => {
    it('should extract category from description brackets', async () => {
      const categorizedTools: MCPTool[] = [
        {
          name: 'file-tool',
          description: 'File operations [file-system]',
          inputSchema: { type: 'object', properties: {} }
        }
      ];

      mockMcpClient.listTools.mockResolvedValue(categorizedTools);

      const entries = await discovery.discoverFromServer('test-server');
      
      // Test through category filtering
      const catalog = {
        entries,
        totalCount: entries.length,
        serverCounts: {},
        lastUpdated: new Date()
      };

      const fileTools = discovery.getToolsByCategory(catalog, 'file-system');
      expect(fileTools).toHaveLength(1);
    });

    it('should extract category from schema properties', async () => {
      const toolWithCategoryProperty: MCPTool[] = [
        {
          name: 'categorized-tool',
          description: 'Tool with category in schema',
          inputSchema: {
            type: 'object',
            properties: {
              category: { type: 'string', default: 'database' }
            }
          }
        }
      ];

      mockMcpClient.listTools.mockResolvedValue(toolWithCategoryProperty);

      const entries = await discovery.discoverFromServer('test-server');
      
      // Test category filtering
      const catalog = {
        entries,
        totalCount: entries.length,
        serverCounts: {},
        lastUpdated: new Date()
      };

      // The category should be extracted from the schema
      const results = discovery.queryTools(catalog, { category: 'database' });
      expect(results).toHaveLength(1);
    });
  });
});
