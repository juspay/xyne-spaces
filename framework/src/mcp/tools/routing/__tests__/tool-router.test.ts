/**
 * Tests for ToolRouter - manages routing between framework and MCP tools
 */

import { ToolRouter } from '../tool-router.js';
import type { MCPClient } from '../../../core/base/mcp-client.js';
import type { ToolRegistry } from '../../../../tools/core/tool-registry.js';
import type { MCPToolCatalog, MCPToolCatalogEntry } from '../../types/index.js';

// Mock the logger
jest.mock('../../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock the adapters
jest.mock('../../adapters/parameter-mapper.js', () => ({
  ParameterMapper: jest.fn().mockImplementation(() => ({
    adaptSchema: jest.fn().mockReturnValue({
      success: true,
      inputSchema: { parse: jest.fn() },
      outputSchema: { parse: jest.fn() },
      warnings: [],
      errors: []
    })
  }))
}));

jest.mock('../../adapters/tool-adapter.js', () => ({
  MCPToolAdapter: jest.fn().mockImplementation(() => ({
    execute: jest.fn()
  }))
}));

describe('ToolRouter', () => {
  let mockMcpClient: jest.Mocked<MCPClient>;
  let mockFrameworkRegistry: jest.Mocked<ToolRegistry>;
  let router: ToolRouter;

  beforeEach(() => {
    mockMcpClient = {
      isInitialized: jest.fn().mockReturnValue(true),
      getConnectedServers: jest.fn(),
      listTools: jest.fn(),
      callTool: jest.fn(),
      initialize: jest.fn(),
      shutdown: jest.fn(),
      getServerStatus: jest.fn(),
      getAllServerConnections: jest.fn(),
      listResources: jest.fn(),
      readResource: jest.fn(),
      ping: jest.fn(),
      listPrompts: jest.fn(),
      getPrompt: jest.fn()
    } as jest.Mocked<Pick<MCPClient, 'isInitialized' | 'getConnectedServers' | 'listTools' | 'callTool' | 'initialize' | 'shutdown' | 'getServerStatus' | 'getAllServerConnections' | 'listResources' | 'readResource' | 'ping' | 'listPrompts' | 'getPrompt'>> as jest.Mocked<MCPClient>;

    mockFrameworkRegistry = {
      registerTool: jest.fn(),
      unregisterTool: jest.fn(),
      hasTool: jest.fn(),
      getTool: jest.fn(),
      listTools: jest.fn(),
      createToolInstance: jest.fn(),
      getToolNames: jest.fn(),
      getAllTools: jest.fn(),
      getToolsByCategory: jest.fn(),
      getToolsByTag: jest.fn(),
      findTools: jest.fn(),
      getStats: jest.fn(),
      clear: jest.fn()
    } as jest.Mocked<Omit<ToolRegistry, 'tools'>> as jest.Mocked<ToolRegistry>;

    router = new ToolRouter(mockMcpClient, mockFrameworkRegistry);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockCatalogEntry = (overrides: Partial<MCPToolCatalogEntry> = {}): MCPToolCatalogEntry => ({
    tool: {
      name: 'test-tool',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' }
        },
        required: ['message']
      }
    },
    serverName: 'test-server',
    discoveredAt: new Date(),
    isAvailable: true,
    frameworkName: 'mcp_test_server_test_tool',
    ...overrides
  });

  const createMockCatalog = (entries: MCPToolCatalogEntry[]): MCPToolCatalog => ({
    entries,
    totalCount: entries.length,
    serverCounts: entries.reduce((acc, entry) => {
      acc[entry.serverName] = (acc[entry.serverName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    lastUpdated: new Date()
  });

  describe('registerMCPTools', () => {
    it('should register all available tools successfully', () => {
      const entries = [
        createMockCatalogEntry(),
        createMockCatalogEntry({
          tool: { name: 'tool2', description: 'Another tool', inputSchema: { type: 'object', properties: {} } },
          frameworkName: 'mcp_test_server_tool2'
        })
      ];
      const catalog = createMockCatalog(entries);

      router.registerMCPTools(catalog);

      expect(mockFrameworkRegistry.registerTool).toHaveBeenCalledTimes(2);
      
      // Check that tools were registered with correct metadata
      const firstCall = mockFrameworkRegistry.registerTool.mock.calls[0];
      expect(firstCall?.[0]).toMatchObject({
        name: 'mcp_test_server_test_tool',
        description: 'A test tool',
        tags: expect.arrayContaining(['mcp', 'test-server']) as string[]
      });
    });

    it('should skip unavailable tools', () => {
      const entries = [
        createMockCatalogEntry(),
        createMockCatalogEntry({
          isAvailable: false,
          frameworkName: 'mcp_test_server_unavailable_tool'
        })
      ];
      const catalog = createMockCatalog(entries);

      router.registerMCPTools(catalog);

      expect(mockFrameworkRegistry.registerTool).toHaveBeenCalledTimes(1);
    });

    it('should handle registration failures gracefully', () => {
      mockFrameworkRegistry.registerTool.mockImplementation((metadata) => {
        if (metadata?.name === 'mcp_test_server_test_tool') {
          throw new Error('Registration failed');
        }
      });

      const entries = [
        createMockCatalogEntry(),
        createMockCatalogEntry({
          tool: { name: 'tool2', description: 'Another tool', inputSchema: { type: 'object', properties: {} } },
          frameworkName: 'mcp_test_server_tool2'
        })
      ];
      const catalog = createMockCatalog(entries);

      // Should not throw, but handle errors gracefully
      expect(() => router.registerMCPTools(catalog)).not.toThrow();
      
      expect(mockFrameworkRegistry.registerTool).toHaveBeenCalledTimes(2);
    });

    it('should handle already registered tools when auto-register is enabled', () => {
      mockFrameworkRegistry.hasTool.mockReturnValue(true);
      
      const entries = [createMockCatalogEntry()];
      const catalog = createMockCatalog(entries);

      router.registerMCPTools(catalog);

      expect(mockFrameworkRegistry.unregisterTool).toHaveBeenCalledWith('mcp_test_server_test_tool');
      expect(mockFrameworkRegistry.registerTool).toHaveBeenCalled();
    });

    it('should fail when tool already exists and auto-register is disabled', () => {
      const routerWithOptions = new ToolRouter(mockMcpClient, mockFrameworkRegistry, {
        autoRegister: false
      });
      
      mockFrameworkRegistry.hasTool.mockReturnValue(true);
      
      const entries = [createMockCatalogEntry()];
      const catalog = createMockCatalog(entries);

      routerWithOptions.registerMCPTools(catalog);

      expect(mockFrameworkRegistry.unregisterTool).not.toHaveBeenCalled();
      expect(mockFrameworkRegistry.registerTool).not.toHaveBeenCalled();
    });

    it('should handle schema adaptation failures', () => {
      const mockParameterMapperModule = jest.mocked(jest.requireMock('../../adapters/parameter-mapper.js')) as {
        ParameterMapper: jest.MockedClass<typeof import('../../adapters/parameter-mapper.js').ParameterMapper>;
      };
      mockParameterMapperModule.ParameterMapper.mockImplementation(() => 
        // Return a partial mock that includes all required ParameterMapper methods
        ({
          adaptSchema: jest.fn().mockReturnValue({
            success: false,
            errors: ['Schema conversion failed'],
            warnings: []
          }),
          mapParameters: jest.fn(),
          mapParameterValue: jest.fn(),
          mapStringValue: jest.fn(),
          mapNumberValue: jest.fn(),
          mapBooleanValue: jest.fn(),
          mapArrayValue: jest.fn(),
          mapObjectValue: jest.fn(),
          validateValue: jest.fn(),
          sanitizeValue: jest.fn(),
          generateFrameworkName: jest.fn(),
          extractCategory: jest.fn(),
          extractTags: jest.fn()
        }) as never
      );

      const routerWithFailingMapper = new ToolRouter(mockMcpClient, mockFrameworkRegistry);
      const entries = [createMockCatalogEntry()];
      const catalog = createMockCatalog(entries);

      routerWithFailingMapper.registerMCPTools(catalog);

      expect(mockFrameworkRegistry.registerTool).not.toHaveBeenCalled();
      
      // Restore the original mock implementation for subsequent tests
      mockParameterMapperModule.ParameterMapper.mockImplementation(() => ({
        adaptSchema: jest.fn().mockReturnValue({
          success: true,
          inputSchema: { parse: jest.fn() },
          outputSchema: { parse: jest.fn() },
          warnings: [],
          errors: []
        }),
        mapParameters: jest.fn(),
        mapParameterValue: jest.fn(),
        mapStringValue: jest.fn(),
        mapNumberValue: jest.fn(),
        mapBooleanValue: jest.fn(),
        mapArrayValue: jest.fn(),
        mapObjectValue: jest.fn(),
        validateValue: jest.fn(),
        sanitizeValue: jest.fn(),
        generateFrameworkName: jest.fn(),
        extractCategory: jest.fn(),
        extractTags: jest.fn()
      }) as never);
    });

    it('should extract and map categories correctly', () => {
      const entries = [
        createMockCatalogEntry({
          tool: {
            name: 'file-tool',
            description: 'File operations tool for reading files',
            inputSchema: { type: 'object', properties: {} }
          }
        })
      ];
      const catalog = createMockCatalog(entries);

      router.registerMCPTools(catalog);

      const metadata = mockFrameworkRegistry.registerTool.mock.calls[0]?.[0];
      expect(metadata?.category).toBe('file'); // Should map to 'file' category
    });

    it('should extract tags from tool names and descriptions', () => {
      const entries = [
        createMockCatalogEntry({
          tool: {
            name: 'file_read_tool',
            description: 'Tool for file operations #filesystem #utility',
            inputSchema: { type: 'object', properties: {} }
          }
        })
      ];
      const catalog = createMockCatalog(entries);

      router.registerMCPTools(catalog);

      const metadata = mockFrameworkRegistry.registerTool.mock.calls[0]?.[0];
      expect(metadata?.tags).toEqual(
        expect.arrayContaining(['mcp', 'test-server', 'file', 'filesystem', 'utility']) as string[]
      );
    });
  });

  describe('unregisterMCPTools', () => {
    beforeEach(() => {
      // Setup some registered tools first
      const entries = [
        createMockCatalogEntry(),
        createMockCatalogEntry({
          tool: { name: 'tool2', description: 'Another tool', inputSchema: { type: 'object', properties: {} } },
          frameworkName: 'mcp_test_server_tool2'
        })
      ];
      const catalog = createMockCatalog(entries);
      router.registerMCPTools(catalog);
    });

    it('should unregister all MCP tools when no names specified', () => {
      router.unregisterMCPTools();

      expect(mockFrameworkRegistry.unregisterTool).toHaveBeenCalledTimes(2);
      expect(mockFrameworkRegistry.unregisterTool).toHaveBeenCalledWith('mcp_test_server_test_tool');
      expect(mockFrameworkRegistry.unregisterTool).toHaveBeenCalledWith('mcp_test_server_tool2');
    });

    it('should unregister specific tools when names provided', () => {
      router.unregisterMCPTools(['mcp_test_server_test_tool']);

      expect(mockFrameworkRegistry.unregisterTool).toHaveBeenCalledTimes(1);
      expect(mockFrameworkRegistry.unregisterTool).toHaveBeenCalledWith('mcp_test_server_test_tool');
    });

    it('should handle unregistration failures gracefully', () => {
      mockFrameworkRegistry.unregisterTool.mockImplementation((name) => {
        if (name === 'mcp_test_server_test_tool') {
          throw new Error('Unregistration failed');
        }
        return true;
      });

      expect(() => router.unregisterMCPTools()).not.toThrow();
      expect(mockFrameworkRegistry.unregisterTool).toHaveBeenCalledTimes(2);
    });
  });

  describe('refreshRegistrations', () => {
    beforeEach(() => {
      // Setup initial registrations
      const entries = [
        createMockCatalogEntry(),
        createMockCatalogEntry({
          tool: { name: 'tool2', description: 'Tool 2', inputSchema: { type: 'object', properties: {} } },
          frameworkName: 'mcp_test_server_tool2'
        })
      ];
      const catalog = createMockCatalog(entries);
      router.registerMCPTools(catalog);
      jest.clearAllMocks();
    });

    it('should add new tools and remove old ones', () => {
      const newEntries = [
        createMockCatalogEntry(), // Keep existing
        createMockCatalogEntry({
          tool: { name: 'tool3', description: 'New tool', inputSchema: { type: 'object', properties: {} } },
          frameworkName: 'mcp_test_server_tool3'
        }) // Add new
        // tool2 is removed
      ];
      const newCatalog = createMockCatalog(newEntries);

      router.refreshRegistrations(newCatalog);

      // Should unregister removed tool
      expect(mockFrameworkRegistry.unregisterTool).toHaveBeenCalledWith('mcp_test_server_tool2');
      
      // Should register new tool
      expect(mockFrameworkRegistry.registerTool).toHaveBeenCalledTimes(1);
    });

    it('should handle no changes', () => {
      const sameEntries = [
        createMockCatalogEntry(),
        createMockCatalogEntry({
          tool: { name: 'tool2', description: 'Tool 2', inputSchema: { type: 'object', properties: {} } },
          frameworkName: 'mcp_test_server_tool2'
        })
      ];
      const sameCatalog = createMockCatalog(sameEntries);

      router.refreshRegistrations(sameCatalog);

      expect(mockFrameworkRegistry.unregisterTool).not.toHaveBeenCalled();
      expect(mockFrameworkRegistry.registerTool).not.toHaveBeenCalled();
    });
  });

  describe('routing table management', () => {
    beforeEach(() => {
      const entries = [createMockCatalogEntry()];
      const catalog = createMockCatalog(entries);
      router.registerMCPTools(catalog);
    });

    it('should get tool route information', () => {
      const route = router.getToolRoute('mcp_test_server_test_tool');

      expect(route).toBeDefined();
      expect(route?.frameworkName).toBe('mcp_test_server_test_tool');
      expect(route?.mcpToolName).toBe('test-tool');
      expect(route?.serverName).toBe('test-server');
    });

    it('should return undefined for unknown tools', () => {
      const route = router.getToolRoute('unknown-tool');
      expect(route).toBeUndefined();
    });

    it('should get all MCP tools', () => {
      const mcpTools = router.getMCPTools();

      expect(mcpTools.size).toBe(1);
      expect(mcpTools.has('mcp_test_server_test_tool')).toBe(true);
    });

    it('should get tools by server', () => {
      const serverTools = router.getToolsByServer('test-server');

      expect(serverTools).toHaveLength(1);
      expect(serverTools[0]?.serverName).toBe('test-server');
    });

    it('should check if tool is MCP tool', () => {
      expect(router.isMCPTool('mcp_test_server_test_tool')).toBe(true);
      expect(router.isMCPTool('regular-framework-tool')).toBe(false);
    });
  });

  describe('statistics', () => {
    it('should provide integration statistics', () => {
      const entries = [
        createMockCatalogEntry(),
        createMockCatalogEntry({
          tool: { name: 'file-tool', description: 'File operations', inputSchema: { type: 'object', properties: {} } },
          frameworkName: 'mcp_test_server_file_tool',
          serverName: 'file-server'
        }),
        createMockCatalogEntry({
          tool: { name: 'search-tool', description: 'Search operations', inputSchema: { type: 'object', properties: {} } },
          frameworkName: 'mcp_test_server_search_tool'
        })
      ];
      const catalog = createMockCatalog(entries);
      router.registerMCPTools(catalog);

      const stats = router.getStats();

      expect(stats.totalMCPTools).toBe(3);
      expect(stats.registeredTools).toBe(3);
      expect(stats.serverCount).toBe(2); // test-server and file-server
      expect(stats.categoryCounts).toBeDefined();
      expect(stats.lastIntegrationTime).toBeInstanceOf(Date);
    });
  });

  describe('category mapping', () => {
    it('should map based on custom category mapping', () => {
      const routerWithMapping = new ToolRouter(mockMcpClient, mockFrameworkRegistry, {
        categoryMapping: {
          'custom': 'mapped-category'
        }
      });

      const entries = [
        createMockCatalogEntry({
          tool: {
            name: 'custom-tool',
            description: 'Custom tool for special operations',
            inputSchema: { type: 'object', properties: {} }
          }
        })
      ];
      const catalog = createMockCatalog(entries);

      routerWithMapping.registerMCPTools(catalog);

      const metadata = mockFrameworkRegistry.registerTool.mock.calls[0]?.[0];
      expect(metadata?.category).toBe('mapped-category');
    });

    it('should use server-based category as fallback', () => {
      const entries = [
        createMockCatalogEntry({
          tool: {
            name: 'unknown-tool',
            description: 'Tool with unknown category',
            inputSchema: { type: 'object', properties: {} }
          }
        })
      ];
      const catalog = createMockCatalog(entries);

      router.registerMCPTools(catalog);

      const metadata = mockFrameworkRegistry.registerTool.mock.calls[0]?.[0];
      expect(metadata?.category).toBe('mcp-test-server');
    });

    it('should extract category from description keywords', () => {
      const testCases = [
        { description: 'Database query tool', expectedCategory: 'data' },
        { description: 'HTTP API client', expectedCategory: 'api' },
        { description: 'File system operations', expectedCategory: 'system' },
        { description: 'Text parsing utility', expectedCategory: 'text' },
        { description: 'Search and find tool', expectedCategory: 'search' }
      ];

      testCases.forEach(({ description, expectedCategory }) => {
        jest.clearAllMocks();
        
        const entries = [
          createMockCatalogEntry({
            tool: {
              name: 'test-tool',
              description,
              inputSchema: { type: 'object', properties: {} }
            }
          })
        ];
        const catalog = createMockCatalog(entries);

        router.registerMCPTools(catalog);

        const metadata = mockFrameworkRegistry.registerTool.mock.calls[0]?.[0];
        expect(metadata?.category).toBe(expectedCategory);
      });
    });
  });

  describe('tool adapter creation', () => {
    it('should create tool adapters with correct configuration', () => {
      const routerWithOptions = new ToolRouter(mockMcpClient, mockFrameworkRegistry, {
        enableParameterValidation: true
      });

      const entries = [createMockCatalogEntry()];
      const catalog = createMockCatalog(entries);

      routerWithOptions.registerMCPTools(catalog);

      expect(mockFrameworkRegistry.registerTool).toHaveBeenCalled();
      
      // Verify that the tool class was registered (third parameter)
      const toolClass = mockFrameworkRegistry?.registerTool.mock.calls[0]?.[2];
      expect(toolClass).toBeDefined();
    });

    it('should handle tools without input schema', () => {
      const mockParameterMapperModule2 = jest.mocked(jest.requireMock('../../adapters/parameter-mapper.js')) as {
        ParameterMapper: jest.MockedClass<typeof import('../../adapters/parameter-mapper.js').ParameterMapper>;
      };
      mockParameterMapperModule2.ParameterMapper.mockImplementation(() => 
        // Return a partial mock that includes all required ParameterMapper methods
        ({
          adaptSchema: jest.fn().mockReturnValue({
            success: true,
            inputSchema: { parse: jest.fn() },
            outputSchema: { parse: jest.fn() },
            warnings: ['No input schema provided'],
            errors: []
          }),
          mapParameters: jest.fn(),
          mapParameterValue: jest.fn(),
          mapStringValue: jest.fn(),
          mapNumberValue: jest.fn(),
          mapBooleanValue: jest.fn(),
          mapArrayValue: jest.fn(),
          mapObjectValue: jest.fn(),
          validateValue: jest.fn(),
          sanitizeValue: jest.fn(),
          generateFrameworkName: jest.fn(),
          extractCategory: jest.fn(),
          extractTags: jest.fn()
        }) as never
      );

      const routerWithMapper = new ToolRouter(mockMcpClient, mockFrameworkRegistry);
      
      const entries = [
        createMockCatalogEntry({
          tool: {
            name: 'no-schema-tool',
            description: 'Tool without schema',
            inputSchema: { type: 'object', properties: {} }
          }
        })
      ];
      const catalog = createMockCatalog(entries);

      routerWithMapper.registerMCPTools(catalog);

      expect(mockFrameworkRegistry.registerTool).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty catalog', () => {
      const emptyCatalog = createMockCatalog([]);

      expect(() => router.registerMCPTools(emptyCatalog)).not.toThrow();
      expect(mockFrameworkRegistry.registerTool).not.toHaveBeenCalled();
    });

    it('should handle tools with special characters in names', () => {
      const entries = [
        createMockCatalogEntry({
          tool: {
            name: 'tool-with-@special#chars!',
            description: 'Special tool',
            inputSchema: { type: 'object', properties: {} }
          },
          frameworkName: 'mcp_test_server_tool_with__special_chars_'
        })
      ];
      const catalog = createMockCatalog(entries);

      expect(() => router.registerMCPTools(catalog)).not.toThrow();
      expect(mockFrameworkRegistry.registerTool).toHaveBeenCalled();
    });

    it('should handle tools without descriptions', () => {
      const entries = [
        createMockCatalogEntry({
          tool: {
            name: 'no-desc-tool',
            description: '',
            inputSchema: { type: 'object', properties: {} }
          }
        })
      ];
      const catalog = createMockCatalog(entries);

      router.registerMCPTools(catalog);

      const metadata = mockFrameworkRegistry.registerTool.mock.calls[0]?.[0];
      expect(metadata?.description).toBe('MCP tool: no-desc-tool');
    });
  });
});
