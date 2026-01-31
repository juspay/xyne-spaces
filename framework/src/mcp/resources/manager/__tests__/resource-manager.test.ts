/**
 * Tests for ResourceManager
 */

import { ResourceManager } from '../resource-manager.js';
import { ResourceDiscovery } from '../../discovery/resource-discovery.js';
import { ResourceAccessor } from '../../access/resource-accessor.js';
import { ResourceValidator } from '../../validation/resource-validator.js';
import type { MCPClient } from '../../../core/base/mcp-client.js';
import type { MCPResource, MCPResourceResult } from '../../../core/types/framework.js';
import type { ResourceCatalog, CatalogEntry } from '../../types/index.js';
import { MCPError } from '../../../core/errors/index.js';

// Mock dependencies
jest.mock('../../discovery/resource-discovery.js');
jest.mock('../../access/resource-accessor.js');
jest.mock('../../validation/resource-validator.js');

// Mock logger
jest.mock('../../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('ResourceManager', () => {
  let mockMcpClient: jest.Mocked<MCPClient>;
  let mockDiscovery: jest.Mocked<ResourceDiscovery>;
  let mockAccessor: jest.Mocked<ResourceAccessor>;
  let mockValidator: jest.Mocked<ResourceValidator>;
  let resourceManager: ResourceManager;

  const mockResource: MCPResource = {
    uri: 'file:///test.txt',
    name: 'test.txt',
    description: 'A test file',
    mimeType: 'text/plain'
  };

  const mockCatalogEntry: CatalogEntry = {
    resource: mockResource,
    metadata: {
      uri: 'file:///test.txt',
      name: 'test.txt',
      serverName: 'server1',
      discoveredAt: new Date()
    }
  };

  const mockCatalog: ResourceCatalog = {
    entries: [mockCatalogEntry],
    totalCount: 1,
    serverCounts: { server1: 1 },
    lastUpdated: new Date()
  };

  const mockResourceResult: MCPResourceResult = {
    contents: [{ uri: 'text', text: 'test content' }],
    mimeType: 'text/plain'
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

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

    // Setup mock implementations
    mockDiscovery = new ResourceDiscovery(mockMcpClient) as jest.Mocked<ResourceDiscovery>;
    mockAccessor = new ResourceAccessor(mockMcpClient) as jest.Mocked<ResourceAccessor>;
    mockValidator = new ResourceValidator() as jest.Mocked<ResourceValidator>;

    mockDiscovery.discoverAll = jest.fn();
    mockDiscovery.discoverFromServer = jest.fn();
    mockDiscovery.queryResources = jest.fn();

    mockAccessor.accessResource = jest.fn();
    mockAccessor.batchAccess = jest.fn();
    mockAccessor.exists = jest.fn();
    mockAccessor.resolveUri = jest.fn();

    mockValidator.validateResource = jest.fn();
    mockValidator.validateBatch = jest.fn();
    mockValidator.validateMetadata = jest.fn();

    // Mock constructors
    (ResourceDiscovery as jest.MockedClass<typeof ResourceDiscovery>).mockImplementation(() => mockDiscovery);
    (ResourceAccessor as jest.MockedClass<typeof ResourceAccessor>).mockImplementation(() => mockAccessor);
    (ResourceValidator as jest.MockedClass<typeof ResourceValidator>).mockImplementation(() => mockValidator);

    resourceManager = new ResourceManager(mockMcpClient);
  });

  describe('initialize', () => {
    it('should initialize successfully with auto-validation', async () => {
      mockMcpClient.isInitialized.mockReturnValue(true);
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      mockValidator.validateBatch.mockReturnValue(new Map([
        ['file:///test.txt', {
          uri: 'file:///test.txt',
          valid: true,
          errors: [],
          warnings: [],
          validatedAt: new Date(),
          rulePassed: 5,
          rulesFailed: 0
        }]
      ]));

      const manager = new ResourceManager(mockMcpClient, { autoValidate: true });
      await manager.initialize();

      expect(mockDiscovery.discoverAll).toHaveBeenCalled();
      expect(mockValidator.validateBatch).toHaveBeenCalledWith(mockCatalog.entries, undefined);
    });

    it('should throw error if MCP client is not initialized', async () => {
      mockMcpClient.isInitialized.mockReturnValue(false);

      await expect(resourceManager.initialize()).rejects.toThrow(MCPError);
      await expect(resourceManager.initialize()).rejects.toThrow('MCP client must be initialized');
    });

    it('should handle discovery failures', async () => {
      mockMcpClient.isInitialized.mockReturnValue(true);
      mockDiscovery.discoverAll.mockRejectedValue(new Error('Discovery failed'));

      await expect(resourceManager.initialize()).rejects.toThrow(MCPError);
      await expect(resourceManager.initialize()).rejects.toThrow('Resource manager initialization failed');
    });

    it('should initialize without auto-validation', async () => {
      mockMcpClient.isInitialized.mockReturnValue(true);
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);

      await resourceManager.initialize();

      expect(mockDiscovery.discoverAll).toHaveBeenCalled();
      expect(mockValidator.validateBatch).not.toHaveBeenCalled();
    });
  });

  describe('discoverResources', () => {
    it('should discover and return resource catalog', async () => {
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);

      const catalog = await resourceManager.discoverResources();

      expect(catalog).toEqual(mockCatalog);
      expect(mockDiscovery.discoverAll).toHaveBeenCalledWith(undefined);
    });

    it('should pass discovery options', async () => {
      const options = { includeMetadata: true };
      const manager = new ResourceManager(mockMcpClient, { discovery: options });
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);

      await manager.discoverResources();

      expect(mockDiscovery.discoverAll).toHaveBeenCalledWith(options);
    });
  });

  describe('getCatalog', () => {
    it('should return current catalog', async () => {
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      await resourceManager.discoverResources();

      const catalog = resourceManager.getCatalog();

      expect(catalog).toEqual(mockCatalog);
    });

    it('should return undefined if no catalog discovered', () => {
      const catalog = resourceManager.getCatalog();

      expect(catalog).toBeUndefined();
    });
  });

  describe('queryResources', () => {
    it('should query resources from current catalog', async () => {
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      mockDiscovery.queryResources.mockReturnValue([mockCatalogEntry]);
      
      await resourceManager.discoverResources();
      const results = resourceManager.queryResources({ serverName: 'server1' });

      expect(results).toEqual([mockCatalogEntry]);
      expect(mockDiscovery.queryResources).toHaveBeenCalledWith(mockCatalog, { serverName: 'server1' });
    });

    it('should throw error if no catalog exists', () => {
      expect(() => resourceManager.queryResources({})).toThrow(MCPError);
      expect(() => resourceManager.queryResources({})).toThrow('No resources discovered yet');
    });
  });

  describe('accessResource', () => {
    beforeEach(async () => {
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      await resourceManager.discoverResources();
    });

    it('should access resource without validation', async () => {
      mockAccessor.accessResource.mockResolvedValue({
        content: mockResourceResult,
        serverName: 'server1',
        accessedAt: new Date()
      });

      const result = await resourceManager.accessResource('file:///test.txt', { validate: false });

      expect(result.accessResult.content).toEqual(mockResourceResult);
      expect(result.validationResult).toBeUndefined();
      expect(result.catalogEntry).toEqual(mockCatalogEntry);
    });

    it('should access resource with validation', async () => {
      mockAccessor.accessResource.mockResolvedValue({
        content: mockResourceResult,
        serverName: 'server1',
        accessedAt: new Date()
      });

      mockValidator.validateResource.mockReturnValue({
        uri: 'file:///test.txt',
        valid: true,
        errors: [],
        warnings: [],
        validatedAt: new Date(),
        rulePassed: 5,
        rulesFailed: 0
      });

      const result = await resourceManager.accessResource('file:///test.txt', { validate: true });

      expect(result.accessResult.content).toEqual(mockResourceResult);
      expect(result.validationResult?.valid).toBe(true);
      expect(mockValidator.validateResource).toHaveBeenCalledWith(
        mockCatalogEntry,
        mockResourceResult,
        undefined
      );
    });

    it('should auto-validate when enabled', async () => {
      const manager = new ResourceManager(mockMcpClient, { autoValidate: true });
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      await manager.discoverResources();

      mockAccessor.accessResource.mockResolvedValue({
        content: mockResourceResult,
        serverName: 'server1',
        accessedAt: new Date()
      });

      mockValidator.validateResource.mockReturnValue({
        uri: 'file:///test.txt',
        valid: true,
        errors: [],
        warnings: [],
        validatedAt: new Date(),
        rulePassed: 5,
        rulesFailed: 0
      });

      const result = await manager.accessResource('file:///test.txt');

      expect(result.validationResult?.valid).toBe(true);
    });

    it('should handle resource not in catalog', async () => {
      mockAccessor.accessResource.mockResolvedValue({
        content: mockResourceResult,
        serverName: 'server1',
        accessedAt: new Date()
      });

      const result = await resourceManager.accessResource('file:///unknown.txt');

      expect(result.accessResult.content).toEqual(mockResourceResult);
      expect(result.catalogEntry).toBeUndefined();
      expect(result.validationResult).toBeUndefined();
    });
  });

  describe('batchAccessResources', () => {
    beforeEach(async () => {
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      await resourceManager.discoverResources();
    });

    it('should batch access multiple resources', async () => {
      const uris = ['file:///test1.txt', 'file:///test2.txt'];
      
      // Mock individual accessResource calls
      jest.spyOn(resourceManager, 'accessResource')
        .mockResolvedValueOnce({
          accessResult: {
            content: mockResourceResult,
            serverName: 'server1',
            accessedAt: new Date()
          }
        })
        .mockResolvedValueOnce({
          accessResult: {
            content: mockResourceResult,
            serverName: 'server1',
            accessedAt: new Date()
          }
        });

      const results = await resourceManager.batchAccessResources(uris);

      expect(results.size).toBe(2);
      expect(results.get('file:///test1.txt')).toBeDefined();
      expect(results.get('file:///test2.txt')).toBeDefined();
    });

    it('should handle mixed success and failure', async () => {
      const uris = ['file:///test1.txt', 'file:///test2.txt'];
      
      jest.spyOn(resourceManager, 'accessResource')
        .mockResolvedValueOnce({
          accessResult: {
            content: mockResourceResult,
            serverName: 'server1',
            accessedAt: new Date()
          }
        })
        .mockRejectedValueOnce(new Error('Access failed'));

      const results = await resourceManager.batchAccessResources(uris);

      expect(results.size).toBe(2);
      expect(results.get('file:///test1.txt')).not.toBeInstanceOf(Error);
      expect(results.get('file:///test2.txt')).toBeInstanceOf(Error);
    });
  });

  describe('validateCatalog', () => {
    it('should validate all resources in catalog', async () => {
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      await resourceManager.discoverResources();

      const validationResults = new Map([
        ['file:///test.txt', {
          uri: 'file:///test.txt',
          valid: true,
          errors: [],
          warnings: [],
          validatedAt: new Date(),
          rulePassed: 5,
          rulesFailed: 0
        }]
      ]);

      mockValidator.validateBatch.mockReturnValue(validationResults);

      const results = resourceManager.validateCatalog();

      expect(results).toEqual(validationResults);
      expect(mockValidator.validateBatch).toHaveBeenCalledWith(mockCatalog.entries, undefined);
    });

    it('should throw error if no catalog exists', () => {
      expect(() => resourceManager.validateCatalog()).toThrow(MCPError);
      expect(() => resourceManager.validateCatalog()).toThrow('No catalog available for validation');
    });
  });

  describe('getValidationResult', () => {
    it('should return cached validation result', async () => {
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      await resourceManager.discoverResources();

      const validationResult = {
        uri: 'file:///test.txt',
        valid: true,
        errors: [],
        warnings: [],
        validatedAt: new Date(),
        rulePassed: 5,
        rulesFailed: 0
      };

      mockValidator.validateBatch.mockReturnValue(new Map([
        ['file:///test.txt', validationResult]
      ]));

      resourceManager.validateCatalog();
      const result = resourceManager.getValidationResult('file:///test.txt');

      expect(result).toEqual(validationResult);
    });

    it('should return undefined for unknown resource', () => {
      const result = resourceManager.getValidationResult('file:///unknown.txt');

      expect(result).toBeUndefined();
    });
  });

  describe('resourceExists', () => {
    it('should check if resource exists', async () => {
      mockAccessor.exists.mockResolvedValue(true);

      const exists = await resourceManager.resourceExists('file:///test.txt', 'server1');

      expect(exists).toBe(true);
      expect(mockAccessor.exists).toHaveBeenCalledWith('file:///test.txt', 'server1');
    });
  });

  describe('resolveUri', () => {
    it('should resolve URI using accessor', async () => {
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      await resourceManager.discoverResources();

      const resolutions = [
        { uri: 'file:///test.txt', serverName: 'server1', exists: true }
      ];
      mockAccessor.resolveUri.mockResolvedValue(resolutions);

      const results = await resourceManager.resolveUri('file:///test.txt');

      expect(results).toEqual(resolutions);
      expect(mockAccessor.resolveUri).toHaveBeenCalledWith('file:///test.txt', mockCatalog);
    });
  });

  describe('getStats', () => {
    it('should return resource manager statistics', async () => {
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      await resourceManager.discoverResources();

      const validationResults = new Map([
        ['file:///test.txt', {
          uri: 'file:///test.txt',
          valid: true,
          errors: [],
          warnings: [],
          validatedAt: new Date(),
          rulePassed: 5,
          rulesFailed: 0
        }]
      ]);
      mockValidator.validateBatch.mockReturnValue(validationResults);
      resourceManager.validateCatalog();

      const stats = resourceManager.getStats();

      expect(stats.totalResources).toBe(1);
      expect(stats.serverCount).toBe(1);
      expect(stats.validatedResources).toBe(1);
      expect(stats.failedValidations).toBe(0);
      expect(stats.lastDiscoveryTime).toBeInstanceOf(Date);
      expect(stats.lastValidationTime).toBeInstanceOf(Date);
    });

    it('should return empty stats when no catalog exists', () => {
      const stats = resourceManager.getStats();

      expect(stats.totalResources).toBe(0);
      expect(stats.serverCount).toBe(0);
      expect(stats.validatedResources).toBe(0);
      expect(stats.failedValidations).toBe(0);
      expect(stats.lastDiscoveryTime).toBeUndefined();
      expect(stats.lastValidationTime).toBeUndefined();
    });
  });

  describe('refresh', () => {
    it('should refresh catalog and re-validate', async () => {
      const manager = new ResourceManager(mockMcpClient, { autoValidate: true });
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      mockValidator.validateBatch.mockReturnValue(new Map());

      await manager.refresh();

      expect(mockDiscovery.discoverAll).toHaveBeenCalled();
      expect(mockValidator.validateBatch).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should clear all cached data', async () => {
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      await resourceManager.discoverResources();

      resourceManager.clear();

      expect(resourceManager.getCatalog()).toBeUndefined();
      expect(resourceManager.getValidationResult('file:///test.txt')).toBeUndefined();
    });
  });

  describe('convenience methods', () => {
    beforeEach(async () => {
      mockDiscovery.discoverAll.mockResolvedValue(mockCatalog);
      mockDiscovery.queryResources.mockReturnValue([mockCatalogEntry]);
      await resourceManager.discoverResources();
    });

    it('should get resources by server', () => {
      const results = resourceManager.getResourcesByServer('server1');

      expect(results).toEqual([mockCatalogEntry]);
      expect(mockDiscovery.queryResources).toHaveBeenCalledWith(mockCatalog, { serverName: 'server1' });
    });

    it('should get resources by MIME type', () => {
      const results = resourceManager.getResourcesByMimeType('text/plain');

      expect(results).toEqual([mockCatalogEntry]);
      expect(mockDiscovery.queryResources).toHaveBeenCalledWith(mockCatalog, { mimeType: 'text/plain' });
    });

    it('should search resources by name pattern', () => {
      const results = resourceManager.searchResources('test');

      expect(results).toEqual([mockCatalogEntry]);
      expect(mockDiscovery.queryResources).toHaveBeenCalledWith(mockCatalog, { namePattern: 'test' });
    });

    it('should get failed validations', () => {
      const validationResults = new Map([
        ['file:///test.txt', {
          uri: 'file:///test.txt',
          valid: false,
          errors: [{ valid: false, message: 'Error', severity: 'high' as const }],
          warnings: [],
          validatedAt: new Date(),
          rulePassed: 0,
          rulesFailed: 1
        }]
      ]);
      mockValidator.validateBatch.mockReturnValue(validationResults);
      resourceManager.validateCatalog();

      const failed = resourceManager.getFailedValidations();

      expect(failed).toHaveLength(1);
      expect(failed[0]?.valid).toBe(false);
    });

    it('should get validation warnings', () => {
      const validationResults = new Map([
        ['file:///test.txt', {
          uri: 'file:///test.txt',
          valid: true,
          errors: [],
          warnings: [{ valid: false, message: 'Warning', severity: 'low' as const }],
          validatedAt: new Date(),
          rulePassed: 4,
          rulesFailed: 0
        }]
      ]);
      mockValidator.validateBatch.mockReturnValue(validationResults);
      resourceManager.validateCatalog();

      const warnings = resourceManager.getValidationWarnings();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.warnings).toHaveLength(1);
    });
  });
});