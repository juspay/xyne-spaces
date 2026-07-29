/**
 * Tests for MCPToolAdapter - wraps MCP tools to work with framework tool interface
 */

import { MCPToolAdapter } from '../tool-adapter.js';
import type { MCPClient } from '../../../core/base/mcp-client.js';
import type { MCPToolCatalogEntry } from '../../types/index.js';

// Mock the logger
jest.mock('../../../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-execution-id')
}));

describe('MCPToolAdapter', () => {
  let mockMcpClient: jest.Mocked<MCPClient>;
  let mockCatalogEntry: MCPToolCatalogEntry;
  let adapter: MCPToolAdapter;

  beforeEach(() => {
    // Create mock MCP client with only the required methods for testing
    mockMcpClient = {
      callTool: jest.fn(),
      isInitialized: jest.fn().mockReturnValue(true)
    } as jest.Mocked<Pick<MCPClient, 'callTool' | 'isInitialized'>> as jest.Mocked<MCPClient>;

    // Create mock catalog entry
    mockCatalogEntry = {
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
      frameworkName: 'mcp_test_server_test_tool'
    };

    adapter = new MCPToolAdapter(mockMcpClient, mockCatalogEntry);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('basic properties', () => {
    it('should expose MCP tool name', () => {
      expect(adapter.mcpToolName).toBe('test-tool');
    });

    it('should expose server name', () => {
      expect(adapter.serverName).toBe('test-server');
    });
  });

  describe('execute', () => {
    it('should execute tool successfully', async () => {
      const mockResult = {
        content: [{ type: 'text' as const, text: 'Tool executed successfully' }]
      };
      mockMcpClient.callTool.mockResolvedValue(mockResult);

      const input = { message: 'Hello, world!' };
      const result = await adapter.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toBe('Tool executed successfully');
      expect(result.metadata.toolName).toBe('mcp_test_server_test_tool');
      expect(result.metadata.executionId).toBe('test-execution-id');
      expect(result.metadata.duration).toBeGreaterThan(0);

      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        'test-server',
        'test-tool',
        { message: 'Hello, world!' }
      );
    });

    it('should handle tool execution with content as string', async () => {
      const mockResult = {
        content: [{ type: 'text' as const, text: 'Simple string result' }]
      };
      mockMcpClient.callTool.mockResolvedValue(mockResult);

      const input = { message: 'Hello' };
      const result = await adapter.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toBe('Simple string result');
    });

    it('should handle tool execution with null content', async () => {
      const mockResult = {
        content: []
      };
      mockMcpClient.callTool.mockResolvedValue(mockResult);

      const input = { message: 'Hello' };
      const result = await adapter.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toBe('');
    });

    it('should fail when tool is not available', async () => {
      const unavailableCatalogEntry = { ...mockCatalogEntry, isAvailable: false };
      const unavailableAdapter = new MCPToolAdapter(mockMcpClient , unavailableCatalogEntry);

      const input = { message: 'Hello' };
      const result = await unavailableAdapter.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_EXECUTION_ERROR');
      expect(result.error?.message).toContain('is not available');
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
    });

    it('should fail when parameter mapping fails', async () => {
      // Missing required parameter
      const input = {};
      const result = await adapter.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_EXECUTION_ERROR');
      expect(result.error?.message).toContain('Parameter mapping failed');
      expect(mockMcpClient.callTool).not.toHaveBeenCalled();
    });

    it('should handle MCP client errors', async () => {
      mockMcpClient.callTool.mockRejectedValue(new Error('Connection failed'));

      const input = { message: 'Hello' };
      const result = await adapter.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_EXECUTION_ERROR');
      expect(result.error?.message).toBe('Connection failed');
      expect(result.error?.details?.['mcpToolName']).toBe('test-tool');
      expect(result.error?.details?.['serverName']).toBe('test-server');
    });

    it('should retry on retryable errors', async () => {
      const retryableError = new Error('Connection timeout');
      mockMcpClient.callTool
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue({ content: [{ type: 'text' as const, text: 'Success after retry' }] });

      const input = { message: 'Hello' };
      const result = await adapter.execute(input);

      expect(result.success).toBe(true);
      expect(result.data).toBe('Success after retry');
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const nonRetryableError = new Error('Invalid parameters');
      mockMcpClient.callTool.mockRejectedValue(nonRetryableError);

      const input = { message: 'Hello' };
      const result = await adapter.execute(input);

      expect(result.success).toBe(false);
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
    });

    it('should respect timeout configuration', async () => {
      const slowAdapter = new MCPToolAdapter(mockMcpClient , mockCatalogEntry, {
        timeout: 100,
        retryCount: 1
      });

      // Mock a slow response
      mockMcpClient.callTool.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 200))
      );

      const input = { message: 'Hello' };
      const result = await slowAdapter.execute(input);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('timeout');
    });

    it('should handle parameter mapping warnings', async () => {
      // Tool with flexible parameter that will generate warnings
      const flexibleCatalogEntry: MCPToolCatalogEntry = {
        ...mockCatalogEntry,
        tool: {
          name: 'flexible-tool',
          description: 'Flexible tool',
          inputSchema: {
            type: 'object',
            properties: {
              value: { type: 'string' }
            }
          }
        }
      };

      const flexibleAdapter = new MCPToolAdapter(mockMcpClient , flexibleCatalogEntry);
      mockMcpClient.callTool.mockResolvedValue({ content: [{ type: 'text' as const, text: 'Success' }] });

      // Pass a number that will be converted to string (generating warning)
      const input = { value: 123 };
      const result = await flexibleAdapter.execute(input);

      expect(result.success).toBe(true);
      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        'test-server',
        'flexible-tool',
        { value: '123' }
      );
    });

    it('should sanitize sensitive input data in logs', async () => {
      // Access the mocked logger module that was set up at the top of the file
      const mockLoggerModule = jest.mocked(jest.requireMock('../../../../utils/logger.js')) as {
        logger: {
          debug: jest.Mock;
          error: jest.Mock;
          warn: jest.Mock;
        };
      };
      mockMcpClient.callTool.mockResolvedValue({ content: [{ type: 'text' as const, text: 'Success' }] });

      const input = { 
        message: 'Hello',
        password: 'secret123',
        apiKey: 'key123',
        token: 'token123'
      };

      await adapter.execute(input);

      // Check that logger was called with sanitized input
      expect(mockLoggerModule.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Executing MCP tool'),
        expect.objectContaining({
          input: expect.objectContaining({
            message: 'Hello',
            password: '[REDACTED]',
            apiKey: '[REDACTED]',
            token: '[REDACTED]'
          }) as Record<string, string>
        }) as Record<string, unknown>
      );
    });
  });

  describe('error classification', () => {
    const testCases = [
      { error: 'Connection timeout', shouldRetry: true },
      { error: 'Network connection failed', shouldRetry: true },
      { error: 'Temporary server error', shouldRetry: true },
      { error: 'Server is busy', shouldRetry: true },
      { error: 'Rate limit exceeded', shouldRetry: true },
      { error: 'Invalid parameters', shouldRetry: false },
      { error: 'Authentication failed', shouldRetry: false },
      { error: 'Tool not found', shouldRetry: false }
    ];

    testCases.forEach(({ error, shouldRetry }) => {
      it(`should ${shouldRetry ? 'retry' : 'not retry'} on: ${error}`, async () => {
        const testError = new Error(error);
        mockMcpClient.callTool.mockRejectedValue(testError);

        const input = { message: 'Hello' };
        await adapter.execute(input);

        if (shouldRetry) {
          expect(mockMcpClient.callTool).toHaveBeenCalledTimes(3); // Default retry count
        } else {
          expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
        }
      });
    });
  });

  describe('metadata tracking', () => {
    it('should track execution metadata correctly', async () => {
      mockMcpClient.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'Success' }] });

      const input = { message: 'Hello' };
      const startTime = Date.now();
      const result = await adapter.execute(input);
      const endTime = Date.now();

      expect(result.metadata.toolName).toBe('mcp_test_server_test_tool');
      expect(result.metadata.executionId).toBe('test-execution-id');
      expect(result.metadata.startTime.getTime()).toBeGreaterThanOrEqual(startTime);
      expect(result.metadata.duration).toBeGreaterThan(0);
      expect(result.metadata.duration).toBeLessThan(endTime - startTime + 10); // Small buffer
      expect(result.metadata.inputSize).toBeGreaterThan(0);
      expect(result.metadata.outputSize).toBeGreaterThan(0);
    });

    it('should handle metadata calculation errors gracefully', async () => {
      mockMcpClient.callTool.mockResolvedValue({ 
        content: [{ type: 'text' as const, text: 'Success' }]
      });

      // Create input that will cause JSON.stringify to fail
      const circularInput: Record<string, unknown> = { message: 'Hello' };
      circularInput['circular'] = circularInput;

      const result = await adapter.execute(circularInput);

      expect(result.success).toBe(true);
      expect(result.metadata.inputSize).toBe(0); // Should handle error gracefully
    });
  });

  describe('tool without schema', () => {
    it('should handle tools without input schema', async () => {
      const noSchemaCatalogEntry: MCPToolCatalogEntry = {
        ...mockCatalogEntry,
        tool: {
          name: 'no-schema-tool',
          description: 'Tool without schema',
          inputSchema: { type: 'object', properties: {} }
        }
      };

      const noSchemaAdapter = new MCPToolAdapter(mockMcpClient , noSchemaCatalogEntry);
      mockMcpClient.callTool.mockResolvedValue({ content: [{ type: 'text' as const, text: 'Success' }] });

      const input = { anyParam: 'value' };
      const result = await noSchemaAdapter.execute(input);

      expect(result.success).toBe(true);
      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        'test-server',
        'no-schema-tool',
        input
      );
    });
  });

  describe('execution options', () => {
    it('should use custom timeout and retry settings', async () => {
      const customAdapter = new MCPToolAdapter(mockMcpClient , mockCatalogEntry, {
        timeout: 5000,
        retryCount: 5,
        retryDelay: 500
      });

      const timeoutError = new Error('Connection timeout');
      mockMcpClient.callTool.mockRejectedValue(timeoutError);

      const input = { message: 'Hello' };
      await customAdapter.execute(input);

      // Should retry 5 times based on custom settings
      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(5);
    });

    it('should handle zero retry count', async () => {
      const noRetryAdapter = new MCPToolAdapter(mockMcpClient , mockCatalogEntry, {
        retryCount: 0
      });

      mockMcpClient.callTool.mockRejectedValue(new Error('Connection failed'));

      const input = { message: 'Hello' };
      await noRetryAdapter.execute(input);

      expect(mockMcpClient.callTool).toHaveBeenCalledTimes(1);
    });
  });
});