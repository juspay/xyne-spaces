/**
 * Tests for ToolIntegrationManager - orchestrates MCP tool discovery, adaptation, and registration
 */

import { ToolIntegrationManager } from '../tool-integration-manager.js';
import { MCPError } from '../../../core/errors/index.js';
import type { MCPClient } from '../../../core/base/mcp-client.js';
import type { ToolRegistry } from '../../../../tools/core/tool-registry.js';
import type { MCPToolCatalog, MCPToolCatalogEntry, ToolIntegrationManagerOptions } from '../../types/index.js';

// Mock the logger
jest.mock('../../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock the dependencies
jest.mock('../../discovery/tool-discovery.js', () => ({
  ToolDiscovery: jest.fn().mockImplementation(() => ({
    discoverAll: jest.fn(),
    refreshAvailability: jest.fn(),
    queryTools: jest.fn()
  }))
}));

jest.mock('../../routing/tool-router.js', () => ({
  ToolRouter: jest.fn().mockImplementation(() => ({
    registerMCPTools: jest.fn(),
    unregisterMCPTools: jest.fn(),
    refreshRegistrations: jest.fn(),
    getStats: jest.fn().mockReturnValue({
      registeredTools: 5,
      categoryCounts: { file: 2, search: 3 },
      lastIntegrationTime: new Date()
    }),
    isMCPTool: jest.fn(),
    getToolRoute: jest.fn()
  }))
}));

describe('ToolIntegrationManager', () => {
  let mockMcpClient: jest.Mocked<MCPClient>;
  let mockFrameworkRegistry: jest.Mocked<ToolRegistry>;
  let mockDiscovery: {
    discoverAll: jest.Mock;
    refreshAvailability: jest.Mock;
    queryTools: jest.Mock;
    mcpClient: jest.Mocked<MCPClient>;
    discoverFromServer: jest.Mock;
    getToolsByCategory: jest.Mock;
    getToolsByServer: jest.Mock;
    getAvailableTools: jest.Mock;
    getUnavailableTools: jest.Mock;
    getLastDiscoveryTime: jest.Mock;
  };
  let mockRouter: {
    registerMCPTools: jest.Mock;
    unregisterMCPTools: jest.Mock;
    refreshRegistrations: jest.Mock;
    getStats: jest.Mock;
    isMCPTool: jest.Mock;
    getToolRoute: jest.Mock;
    routingTable: Map<string, unknown>;
    parameterMapper: { adaptSchema: jest.Mock };
    mcpClient: jest.Mocked<MCPClient>;
    frameworkRegistry: jest.Mocked<ToolRegistry>;
    options: Record<string, unknown>;
    getAllMCPTools: jest.Mock;
    getToolsByServer: jest.Mock;
    getMCPToolNames: jest.Mock;
    getRegistrationStats: jest.Mock;
  };
  let manager: ToolIntegrationManager;

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

    mockFrameworkRegistry = {
      registerTool: jest.fn(),
      unregisterTool: jest.fn(),
      hasTool: jest.fn().mockReturnValue(false),
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

    // Create mock instances with only the methods we need for testing
    mockDiscovery = {
      discoverAll: jest.fn(),
      refreshAvailability: jest.fn(),
      queryTools: jest.fn(),
      mcpClient: mockMcpClient,
      discoverFromServer: jest.fn(),
      getToolsByCategory: jest.fn(),
      getToolsByServer: jest.fn(),
      getAvailableTools: jest.fn(),
      getUnavailableTools: jest.fn(),
      getLastDiscoveryTime: jest.fn()
    };
    
    mockRouter = {
      registerMCPTools: jest.fn(),
      unregisterMCPTools: jest.fn(),
      refreshRegistrations: jest.fn(),
      getStats: jest.fn().mockReturnValue({
        registeredTools: 5,
        categoryCounts: { file: 2, search: 3 },
        lastIntegrationTime: new Date()
      }),
      isMCPTool: jest.fn(),
      getToolRoute: jest.fn(),
      routingTable: new Map(),
      parameterMapper: {
        adaptSchema: jest.fn()
      },
      mcpClient: mockMcpClient,
      frameworkRegistry: mockFrameworkRegistry,
      options: {},
      getAllMCPTools: jest.fn(),
      getToolsByServer: jest.fn(),
      getMCPToolNames: jest.fn(),
      getRegistrationStats: jest.fn()
    };

    // Configure the mocked constructors using properly typed approach
    const mockDiscoveryModule = jest.mocked(jest.requireMock('../../discovery/tool-discovery.js')) as {
      ToolDiscovery: jest.MockedClass<typeof import('../../discovery/tool-discovery.js').ToolDiscovery>;
    };
    const mockRouterModule = jest.mocked(jest.requireMock('../../routing/tool-router.js')) as {
      ToolRouter: jest.MockedClass<typeof import('../../routing/tool-router.js').ToolRouter>;
    };
    
    // Use type assertion that's safe for test context
    mockDiscoveryModule.ToolDiscovery.mockImplementation(() => mockDiscovery as never);
    mockRouterModule.ToolRouter.mockImplementation(() => mockRouter as never);

    manager = new ToolIntegrationManager(mockMcpClient, mockFrameworkRegistry);
  });

  afterEach(() => {
    // Clean up any running timers from the manager
    if (manager && manager.isInitialized()) {
      manager.shutdown();
    }
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  afterAll(() => {
    // Force cleanup of any lingering timers
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const createMockCatalog = (toolCount = 3): MCPToolCatalog => ({
    entries: Array.from({ length: toolCount }, (_, i) => ({
      tool: {
        name: `tool-${i + 1}`,
        description: `Test tool ${i + 1}`,
        inputSchema: { type: 'object', properties: {} }
      },
      serverName: `server${(i % 2) + 1}`,
      discoveredAt: new Date(),
      isAvailable: true,
      frameworkName: `mcp_server${(i % 2) + 1}_tool_${i + 1}`
    } as MCPToolCatalogEntry)),
    totalCount: toolCount,
    serverCounts: { server1: Math.ceil(toolCount / 2), server2: Math.floor(toolCount / 2) },
    lastUpdated: new Date()
  });

  describe('initialization', () => {
    beforeEach(() => {
      mockDiscovery.discoverAll.mockResolvedValue(createMockCatalog());
    });

    it('should initialize successfully', async () => {
      await manager.initialize();

      expect(manager.isInitialized()).toBe(true);
      expect(mockDiscovery.discoverAll).toHaveBeenCalled();
      expect(mockRouter.registerMCPTools).toHaveBeenCalled();
    });

    it('should not initialize twice', async () => {
      await manager.initialize();
      
      // Second initialization should be ignored
      await manager.initialize();

      expect(mockDiscovery.discoverAll).toHaveBeenCalledTimes(1);
    });

    it('should fail if MCP client is not initialized', async () => {
      mockMcpClient.isInitialized.mockReturnValue(false);

      await expect(manager.initialize()).rejects.toThrow(MCPError);
      await expect(manager.initialize()).rejects.toThrow('MCP client must be initialized');
    });

    it('should handle discovery failures gracefully', async () => {
      mockDiscovery.discoverAll.mockRejectedValue(new Error('Discovery failed'));

      await expect(manager.initialize()).rejects.toThrow(MCPError);
      expect(manager.isInitialized()).toBe(false);
    });

    it('should setup auto-refresh when enabled', async () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      
      const managerWithOptions = new ToolIntegrationManager(
        mockMcpClient,
        mockFrameworkRegistry,
        {
          autoRefresh: true,
          refreshInterval: 5000
        }
      );

      await managerWithOptions.initialize();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
      
      // Clean up
      managerWithOptions.shutdown();
      setIntervalSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should not register tools when auto-register is disabled', async () => {
      const managerWithOptions = new ToolIntegrationManager(
        mockMcpClient,
        mockFrameworkRegistry,
        {
          integration: { autoRegister: false }
        }
      );

      await managerWithOptions.initialize();

      expect(mockRouter.registerMCPTools).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      mockDiscovery.discoverAll.mockResolvedValue(createMockCatalog());
      await manager.initialize();
    });

    it('should shutdown gracefully', () => {
      manager.shutdown();

      expect(manager.isInitialized()).toBe(false);
      expect(mockRouter.unregisterMCPTools).toHaveBeenCalled();
    });

    it('should clear refresh timer on shutdown', async () => {
      jest.useFakeTimers();
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      
      const managerWithRefresh = new ToolIntegrationManager(
        mockMcpClient,
        mockFrameworkRegistry,
        {
          autoRefresh: true,
          refreshInterval: 5000
        }
      );

      await managerWithRefresh.initialize();
      managerWithRefresh.shutdown();

      expect(clearIntervalSpy).toHaveBeenCalled();
      
      clearIntervalSpy.mockRestore();
      jest.useRealTimers();
    });

    it('should handle unregistration errors gracefully', () => {
      mockRouter.unregisterMCPTools.mockImplementation(() => {
        throw new Error('Unregistration failed');
      });

      expect(() => manager.shutdown()).not.toThrow();
    });
  });

  describe('discoverAndIntegrateTools', () => {
    it('should discover and integrate tools', async () => {
      const mockCatalog = createMockCatalog();
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);

      const result = await manager.discoverAndIntegrateTools();

      expect(result).toBe(mockCatalog);
      expect(mockDiscovery.discoverAll).toHaveBeenCalled();
      expect(mockRouter.registerMCPTools).toHaveBeenCalledWith(mockCatalog);
    });

    it('should pass discovery options', async () => {
      const managerWithOptions = new ToolIntegrationManager(
        mockMcpClient,
        mockFrameworkRegistry,
        {
          discovery: {
            serverFilter: ['server1'],
            includeDisabled: true
          }
        }
      );

      const mockCatalog = createMockCatalog();
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);

      await managerWithOptions.discoverAndIntegrateTools();

      expect(mockDiscovery.discoverAll).toHaveBeenCalledWith({
        serverFilter: ['server1'],
        includeDisabled: true
      });
    });

    it('should handle discovery errors', async () => {
      mockDiscovery.discoverAll.mockRejectedValue(new Error('Discovery failed'));

      await expect(manager.discoverAndIntegrateTools()).rejects.toThrow('Discovery failed');
    });
  });

  describe('refresh', () => {
    beforeEach(async () => {
      mockDiscovery.discoverAll.mockResolvedValue(createMockCatalog());
      await manager.initialize();
    });

    it('should refresh tool integration', async () => {
      const newCatalog = createMockCatalog(5);
      mockDiscovery.discoverAll.mockResolvedValue(newCatalog);
      mockDiscovery.refreshAvailability.mockReturnValue(createMockCatalog());

      await manager.refresh();

      expect(mockDiscovery.discoverAll).toHaveBeenCalled();
      expect(mockDiscovery.refreshAvailability).toHaveBeenCalled();
      expect(mockRouter.refreshRegistrations).toHaveBeenCalledWith(newCatalog);
    });

    it('should fail if not initialized', async () => {
      const uninitializedManager = new ToolIntegrationManager(mockMcpClient, mockFrameworkRegistry);

      await expect(uninitializedManager.refresh()).rejects.toThrow(MCPError);
      await expect(uninitializedManager.refresh()).rejects.toThrow('must be initialized before refresh');
    });

    it('should handle refresh errors', async () => {
      mockDiscovery.discoverAll.mockRejectedValue(new Error('Refresh failed'));

      await expect(manager.refresh()).rejects.toThrow('Refresh failed');
    });
  });

  describe('auto-refresh', () => {
    it('should handle auto-refresh errors gracefully', async () => {
      jest.useFakeTimers();
      
      const managerWithRefresh = new ToolIntegrationManager(
        mockMcpClient,
        mockFrameworkRegistry,
        {
          autoRefresh: true,
          refreshInterval: 1000
        }
      );

      mockDiscovery.discoverAll.mockResolvedValue(createMockCatalog());
      await managerWithRefresh.initialize();

      // Mock refresh to fail on subsequent calls
      mockDiscovery.discoverAll.mockRejectedValue(new Error('Auto-refresh failed'));

      // Simply advance timers once to trigger refresh
      jest.advanceTimersByTime(1000);

      // Should not throw, just log error
      expect(jest.getTimerCount()).toBe(1); // Timer should still be running
      
      // Clean up
      managerWithRefresh.shutdown();
      jest.useRealTimers();
    });

    it('should use default refresh interval', async () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      
      const managerWithRefresh = new ToolIntegrationManager(
        mockMcpClient,
        mockFrameworkRegistry,
        {
          autoRefresh: true
          // No refreshInterval specified
        }
      );

      mockDiscovery.discoverAll.mockResolvedValue(createMockCatalog());
      await managerWithRefresh.initialize();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300000); // 5 minutes default
      
      // Clean up
      managerWithRefresh.shutdown();
      setIntervalSpy.mockRestore();
      jest.useRealTimers();
    });
  });

  describe('query methods', () => {
    beforeEach(async () => {
      const mockCatalog = createMockCatalog();
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      mockDiscovery.queryTools.mockReturnValue([mockCatalog.entries[0]]);
      await manager.initialize();
    });

    it('should query tools', () => {
      const query = { serverName: 'server1' };
      const result = manager.queryTools(query);

      expect(mockDiscovery.queryTools).toHaveBeenCalledWith(
        expect.objectContaining({ totalCount: 3 }),
        query
      );
      expect(result).toHaveLength(1);
    });

    it('should fail to query before initialization', () => {
      const uninitializedManager = new ToolIntegrationManager(mockMcpClient, mockFrameworkRegistry);

      expect(() => uninitializedManager.queryTools({})).toThrow(MCPError);
    });

    it('should get tools by server', () => {
      manager.getToolsByServer('server1');

      expect(mockDiscovery.queryTools).toHaveBeenCalledWith(
        expect.anything(),
        { serverName: 'server1' }
      );
    });

    it('should get tools by category', () => {
      manager.getToolsByCategory('file');

      expect(mockDiscovery.queryTools).toHaveBeenCalledWith(
        expect.anything(),
        { category: 'file' }
      );
    });

    it('should search tools by name pattern', () => {
      manager.searchTools('search-*');

      expect(mockDiscovery.queryTools).toHaveBeenCalledWith(
        expect.anything(),
        { namePattern: 'search-*' }
      );
    });

    it('should get available tools only', () => {
      manager.getAvailableTools();

      expect(mockDiscovery.queryTools).toHaveBeenCalledWith(
        expect.anything(),
        { isAvailable: true }
      );
    });
  });

  describe('statistics', () => {
    beforeEach(async () => {
      mockDiscovery.discoverAll.mockResolvedValue(createMockCatalog());
      await manager.initialize();
    });

    it('should provide integration statistics', () => {
      const stats = manager.getStats();

      expect(stats).toMatchObject({
        totalMCPTools: 3,
        registeredTools: 5,
        serverCount: 2,
        categoryCounts: { file: 2, search: 3 },
        lastDiscoveryTime: expect.any(Date) as Date,
        lastIntegrationTime: expect.any(Date) as Date
      });
    });

    it('should handle missing catalog gracefully in stats', () => {
      const uninitializedManager = new ToolIntegrationManager(mockMcpClient, mockFrameworkRegistry);
      
      const stats = uninitializedManager.getStats();

      expect(stats.totalMCPTools).toBe(0);
      expect(stats.serverCount).toBe(0);
    });
  });

  describe('tool management', () => {
    beforeEach(async () => {
      mockDiscovery.discoverAll.mockResolvedValue(createMockCatalog());
      await manager.initialize();
    });

    it('should check if tool is MCP tool', () => {
      mockRouter.isMCPTool.mockReturnValue(true);

      const result = manager.isMCPTool('mcp_server1_tool1');

      expect(mockRouter.isMCPTool).toHaveBeenCalledWith('mcp_server1_tool1');
      expect(result).toBe(true);
    });

    it('should get tool route information', () => {
      const mockRoute = {
        frameworkName: 'mcp_server1_tool1',
        mcpToolName: 'tool1',
        serverName: 'server1',
        catalogEntry: expect.any(Object) as Record<string, unknown>
      };
      mockRouter.getToolRoute.mockReturnValue(mockRoute);

      const result = manager.getToolRoute('mcp_server1_tool1');

      expect(mockRouter.getToolRoute).toHaveBeenCalledWith('mcp_server1_tool1');
      expect(result).toBe(mockRoute);
    });

    it('should get framework registry instance', () => {
      const registry = manager.getFrameworkRegistry();
      expect(registry).toBe(mockFrameworkRegistry);
    });

    it('should get current catalog', () => {
      const catalog = manager.getCatalog();
      expect(catalog).toBeDefined();
      expect(catalog?.totalCount).toBe(3);
    });
  });

  describe('tool re-registration', () => {
    beforeEach(async () => {
      mockDiscovery.discoverAll.mockResolvedValue(createMockCatalog());
      await manager.initialize();
    });

    it('should re-register all tools', () => {
      manager.reregisterAllTools();

      expect(mockRouter.unregisterMCPTools).toHaveBeenCalled();
      expect(mockRouter.registerMCPTools).toHaveBeenCalled();
    });

    it('should fail to re-register without catalog', () => {
      const uninitializedManager = new ToolIntegrationManager(mockMcpClient, mockFrameworkRegistry);

      expect(() => uninitializedManager.reregisterAllTools()).toThrow(MCPError);
    });
  });

  describe('failed registration handling', () => {
    beforeEach(async () => {
      const mockCatalog = createMockCatalog();
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      await manager.initialize();
    });

    it('should identify failed registrations', () => {
      // Mock some tools as not registered in framework
      mockFrameworkRegistry.hasTool.mockImplementation((name) => {
        return name !== 'mcp_server1_tool_1'; // This tool failed to register
      });

      const failedRegistrations = manager.getFailedRegistrations();

      expect(failedRegistrations).toHaveLength(1);
      expect(failedRegistrations?.[0]?.frameworkName).toBe('mcp_server1_tool_1');
    });

    it('should return empty array when no catalog exists', () => {
      const uninitializedManager = new ToolIntegrationManager(mockMcpClient, mockFrameworkRegistry);
      
      const failedRegistrations = uninitializedManager.getFailedRegistrations();
      expect(failedRegistrations).toEqual([]);
    });

    it('should retry failed registrations', () => {
      mockFrameworkRegistry.hasTool.mockImplementation((name) => {
        return name !== 'mcp_server1_tool_1'; // This tool failed to register
      });

      manager.retryFailedRegistrations();

      expect(mockRouter.registerMCPTools).toHaveBeenCalledWith(
        expect.objectContaining({
          totalCount: 1,
          entries: expect.arrayContaining([
            expect.objectContaining({
              frameworkName: 'mcp_server1_tool_1'
            })
          ]) as MCPToolCatalogEntry[]
        })
      );
    });

    it('should handle no failed registrations gracefully', () => {
      mockFrameworkRegistry.hasTool.mockReturnValue(true); // All tools registered

      // Clear previous calls from beforeEach setup
      jest.clearAllMocks();

      expect(() => manager.retryFailedRegistrations()).not.toThrow();
      
      // Should not call registerMCPTools when no failed registrations  
      expect(mockRouter.registerMCPTools).not.toHaveBeenCalled();
    });
  });

  describe('configuration options', () => {
    it('should accept and use various configuration options', async () => {
      const options: ToolIntegrationManagerOptions = {
        autoRefresh: true,
        refreshInterval: 10000,
        discovery: {
          serverFilter: ['server1'],
          categoryFilter: ['file'],
          includeDisabled: false,
          timeout: 5000
        },
        integration: {
          autoRegister: true,
          enableParameterValidation: true,
          categoryMapping: {
            'custom': 'mapped'
          }
        }
      };

      const managerWithOptions = new ToolIntegrationManager(
        mockMcpClient,
        mockFrameworkRegistry,
        options
      );

      mockDiscovery.discoverAll.mockResolvedValue(createMockCatalog());
      
      await managerWithOptions.initialize();

      expect(mockDiscovery.discoverAll).toHaveBeenCalledWith(options.discovery);
    });

    it('should use default options when none provided', async () => {
      const defaultManager = new ToolIntegrationManager(mockMcpClient, mockFrameworkRegistry);
      
      mockDiscovery.discoverAll.mockResolvedValue(createMockCatalog());
      
      await defaultManager.initialize();

      expect(mockDiscovery.discoverAll).toHaveBeenCalledWith(undefined);
    });
  });

  describe('error handling', () => {
    it('should handle all types of errors during initialization', async () => {
      const errorTypes = [
        new MCPError({
          type: 'CONNECTION_ERROR',
          message: 'Connection failed',
          severity: 'high',
          timestamp: new Date(),
          retryable: true
        }),
        new Error('Generic error'),
        'String error'
      ];

      for (const error of errorTypes) {
        jest.clearAllMocks();
        
        const testManager = new ToolIntegrationManager(mockMcpClient, mockFrameworkRegistry);
        mockDiscovery.discoverAll.mockRejectedValue(error);

        await expect(testManager.initialize()).rejects.toThrow(MCPError);
      }
    });

    it('should wrap non-MCP errors in MCPError during initialization', async () => {
      const testManager = new ToolIntegrationManager(mockMcpClient, mockFrameworkRegistry);
      mockDiscovery.discoverAll.mockRejectedValue(new Error('Generic error'));

      try {
        await testManager.initialize();
      } catch (error) {
        expect(error).toBeInstanceOf(MCPError);
        expect((error as MCPError).message).toContain('Generic error');
      }
    });
  });
});
