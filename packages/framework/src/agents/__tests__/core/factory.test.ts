import {
  createModelClient,
  createToolManager,
  resolveTools,
  createExecutionConfig,
  FactoryError,
  safeFactory
} from '../../core/factory.js';
import { createDefaultAgentConfig, type AgentConfig } from '../../core/config.js';
import { LLMClient } from '../../../llm/client/llm-client.js';
import { ToolExecutor } from '../../../tools/core/tool-executor.js';

describe('Factory Functions', (): void => {
  const createTestConfig = (): AgentConfig => {
    const baseConfig = createDefaultAgentConfig();
    
    // Create a new config with proper structure
    return {
      ...baseConfig,
      model: {
        provider: {
          type: 'vertex',
          config: {
            auth: {
              type: 'adc',
              projectId: 'test-project',
              region: 'us-central1'
            },
            apiVersion: 'v1',
            timeout: 30000,
            retries: 3,
            rateLimiting: true,
            enableLogging: true
          }
        },
        defaultModel: 'gemini-2.5-pro',
        features: {
          healthMonitoring: true,
          autoTemperature: true,
          enableLogging: true
        }
      }
    };
  };

  describe('createModelClient', (): void => {
    it('should create LLM client with valid config', (): void => {
      const config = createTestConfig();
      const client = createModelClient(config);

      expect(client).toBeInstanceOf(LLMClient);
    });

    it('should handle different provider types', (): void => {
      const baseConfig = createTestConfig();
      
      // Test with LiteLLM provider
      const config = {
        ...baseConfig,
        model: {
          ...baseConfig.model,
          provider: {
            type: 'litellm' as const,
            config: {
              apiKey: 'test-key',
              timeout: 30000,
              retries: 3,
              rateLimiting: true,
              enableLogging: false
            }
          }
        }
      };

      const client = createModelClient(config);
      expect(client).toBeInstanceOf(LLMClient);
    });
  });

  describe('createToolManager', (): void => {
    it('should create tool executor', (): void => {
      const config = createTestConfig();
      const toolManager = createToolManager(config);

      expect(toolManager).toBeInstanceOf(ToolExecutor);
    });

    it('should work with minimal config', (): void => {
      const baseConfig = createTestConfig();
      const config = {
        ...baseConfig,
        tools: {
          ...baseConfig.tools,
          enabled: []
        }
      };

      const toolManager = createToolManager(config);
      expect(toolManager).toBeInstanceOf(ToolExecutor);
    });
  });

  describe('resolveTools', (): void => {
    it('should resolve tools from config', (): void => {
      const baseConfig = createTestConfig();
      const config = {
        ...baseConfig,
        tools: {
          ...baseConfig.tools,
          enabled: ['testTool1', 'testTool2']
        }
      };

      const toolDefinitions = resolveTools(config);

      expect(Array.isArray(toolDefinitions)).toBe(true);
    });

    it('should handle empty tools list', (): void => {
      const baseConfig = createTestConfig();
      const config = {
        ...baseConfig,
        tools: {
          ...baseConfig.tools,
          enabled: []
        }
      };

      const toolDefinitions = resolveTools(config);

      expect(Array.isArray(toolDefinitions)).toBe(true);
      expect(toolDefinitions).toHaveLength(0);
    });

    it('should include tool configuration', (): void => {
      const baseConfig = createTestConfig();
      const config = {
        ...baseConfig,
        tools: {
          ...baseConfig.tools,
          enabled: ['testTool'],
          config: { testTool: { apiKey: 'test' } },
          execution: {
            ...baseConfig.tools.execution,
            timeout: 10000
          }
        }
      };

      expect(() => resolveTools(config)).not.toThrow();
    });
  });

  describe('createExecutionConfig', (): void => {
    it('should create execution config from agent config', (): void => {
      const baseConfig = createTestConfig();
      const config = {
        ...baseConfig,
        execution: {
          ...baseConfig.execution,
          maxTurns: 10,
          limits: { toolsPerTurn: 5, requestsPerTurn: 3 },
          errorHandling: { continueOnToolError: true, maxRetries: 2 }
        }
      };

      const executionConfig = createExecutionConfig(config);

      expect(executionConfig.mode).toBeDefined();
      expect(executionConfig.maxTurns).toBe(10);
      expect(executionConfig.limits['toolsPerTurn']).toBe(5);
      expect(executionConfig.limits['requestsPerTurn']).toBe(3);
      expect(executionConfig.errorHandling['continueOnToolError']).toBe(true);
      expect(executionConfig.errorHandling['maxRetries']).toBe(2);
    });

    it('should handle single mode execution', (): void => {
      const baseConfig = createTestConfig();
      const config = {
        ...baseConfig,
        execution: {
          ...baseConfig.execution,
          mode: 'single' as const
        }
      };

      const executionConfig = createExecutionConfig(config);

      expect(executionConfig.mode).toBe('single');
    });

    it('should apply defaults for missing values', (): void => {
      const baseConfig = createTestConfig();
      const config = {
        ...baseConfig,
        execution: {
          ...baseConfig.execution,
          mode: 'continuous' as const
        }
      };

      const executionConfig = createExecutionConfig(config);

      expect(executionConfig.mode).toBe('continuous');
      expect(executionConfig.limits['toolsPerTurn']).toBeGreaterThan(0);
      expect(executionConfig.limits['requestsPerTurn']).toBeGreaterThan(0);
      expect(executionConfig.errorHandling['continueOnToolError']).toBeDefined();
      expect(executionConfig.errorHandling['maxRetries']).toBeGreaterThanOrEqual(0);
    });
  });

  describe('FactoryError', (): void => {
    it('should create factory error with component name', (): void => {
      const error = new FactoryError('Test error', 'TestComponent');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(FactoryError);
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('FactoryError');
      expect(error.component).toBe('TestComponent');
      expect(error.cause).toBeUndefined();
    });

    it('should create factory error with cause', (): void => {
      const originalError = new Error('Original error');
      const factoryError = new FactoryError('Factory error', 'TestComponent', originalError);

      expect(factoryError.message).toBe('Factory error');
      expect(factoryError.component).toBe('TestComponent');
      expect(factoryError.cause).toBe(originalError);
    });

    it('should handle undefined cause', (): void => {
      const error = new FactoryError('Test error', 'TestComponent', undefined);

      expect(error.cause).toBeUndefined();
    });
  });

  describe('safeFactory', (): void => {
    it('should execute factory function successfully', (): void => {
      const mockFactory = jest.fn<string, []>().mockReturnValue('success');
      
      const result = safeFactory(mockFactory, 'TestComponent');

      expect(result).toBe('success');
      expect(mockFactory).toHaveBeenCalledTimes(1);
    });

    it('should wrap factory errors in FactoryError', (): void => {
      const originalError = new Error('Factory failed');
      const mockFactory = jest.fn<string, []>().mockImplementation(() => {
        throw originalError;
      });

      expect(() => safeFactory(mockFactory, 'TestComponent')).toThrow(FactoryError);
      
      try {
        safeFactory(mockFactory, 'TestComponent');
      } catch (error) {
        if (error instanceof FactoryError) {
          expect(error.message).toContain('Failed to create TestComponent');
          expect(error.message).toContain('Factory failed');
          expect(error.component).toBe('TestComponent');
          expect(error.cause).toBe(originalError);
        }
      }
    });

    it('should handle non-Error exceptions', (): void => {
      const mockFactory = jest.fn<string, []>().mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'String error';
      });

      expect(() => safeFactory(mockFactory, 'TestComponent')).toThrow(FactoryError);
      
      try {
        safeFactory(mockFactory, 'TestComponent');
      } catch (error) {
        if (error instanceof FactoryError) {
          expect(error.message).toContain('Failed to create TestComponent');
          expect(error.component).toBe('TestComponent');
          expect(error.cause).toBeUndefined();
        }
      }
    });

    it('should preserve factory return types', (): void => {
      const objectFactory = (): { value: number } => ({ value: 42 });
      const stringFactory = (): string => 'test';
      const numberFactory = (): number => 123;

      const objectResult = safeFactory(objectFactory, 'Object');
      const stringResult = safeFactory(stringFactory, 'String');
      const numberResult = safeFactory(numberFactory, 'Number');

      expect(objectResult).toEqual({ value: 42 });
      expect(stringResult).toBe('test');
      expect(numberResult).toBe(123);
    });
  });

  describe('Factory integration', (): void => {
    it('should create all components from same config', (): void => {
      const config = createTestConfig();

      const modelClient = createModelClient(config);
      const toolManager = createToolManager(config);
      const toolDefinitions = resolveTools(config);
      const executionConfig = createExecutionConfig(config);

      expect(modelClient).toBeInstanceOf(LLMClient);
      expect(toolManager).toBeInstanceOf(ToolExecutor);
      expect(Array.isArray(toolDefinitions)).toBe(true);
      expect(executionConfig).toBeDefined();
      expect(executionConfig.mode).toBeDefined();
    });

    it('should handle factory errors gracefully with safeFactory', (): void => {
      const baseConfig = createTestConfig();
      // Make config invalid by removing required fields
      const invalidConfig = {
        ...baseConfig,
        model: {
          ...baseConfig.model,
          provider: {} as AgentConfig['model']['provider']
        }
      };

      expect(() => {
        safeFactory(() => createModelClient(invalidConfig), 'ModelClient');
      }).toThrow(FactoryError);
    });

    it('should create components with different configurations', (): void => {
      const baseConfig = createTestConfig();
      
      const config1 = {
        ...baseConfig,
        tools: {
          ...baseConfig.tools,
          enabled: ['tool1']
        }
      };
      
      const config2 = {
        ...baseConfig,
        tools: {
          ...baseConfig.tools,
          enabled: ['tool1', 'tool2']
        },
        execution: {
          ...baseConfig.execution,
          mode: 'interactive' as const
        }
      };

      const client1 = createModelClient(config1);
      const client2 = createModelClient(config2);
      const tools1 = resolveTools(config1);
      const tools2 = resolveTools(config2);

      expect(client1).toBeInstanceOf(LLMClient);
      expect(client2).toBeInstanceOf(LLMClient);
      expect(tools1.length).toBeLessThanOrEqual(tools2.length);
    });
  });
});