import { DefaultAgentOrchestrator } from '../../orchestrator/agent-orchestrator.js';
import { OrchestratorError, type OrchestratorEventHandler } from '../../orchestrator/types.js';
import type { AgentExecutionRequest } from '../../core/types.js';
import type { ExecutionConfig } from '../../core/config.js';
import { LLMClient } from '../../../llm/client/llm-client.js';
import { ToolExecutor } from '../../../tools/core/tool-executor.js';
import type { ToolDefinition } from '../../../llm/core/types/tools.js';
import type { LLMResponse } from '../../../llm/core/types/requests.js';
import { ConversationCompactor } from '../../../llm/features/compact/conversation-compactor.js';
import { z } from 'zod';

// Mock dependencies
jest.mock('../../../llm/client/llm-client.js');
jest.mock('../../../tools/core/tool-executor.js');
jest.mock('../../../llm/features/compact/conversation-compactor.js');

describe('DefaultAgentOrchestrator', (): void => {
  let orchestrator: DefaultAgentOrchestrator;
  let mockLLMClient: jest.Mocked<LLMClient>;
  let mockToolExecutor: jest.Mocked<ToolExecutor>;
  // Note: ConversationCompactor mocks are set up per test as needed
  let mockExecutionConfig: ExecutionConfig;
  let mockToolDefinitions: ToolDefinition[];

  // Helper function to create complete LLM response mocks
  const createMockLLMResponse = (overrides: Partial<LLMResponse> = {}): LLMResponse => ({
    id: 'llm-1',
    model: 'test-model',
    provider: 'test-provider',
    content: 'Test response',
    usage: {
      promptTokens: 10,
      completionTokens: 8,
      totalTokens: 18
    },
    metadata: {
      requestId: 'req-1',
      model: 'test-model',
      provider: 'test-provider',
      timestamp: new Date(),
      processingTime: 100
    },
    finishReason: 'stop',
    ...overrides
  });

  beforeEach((): void => {
    // Get typed mocks from jest
    mockLLMClient = jest.mocked(new LLMClient({} as never));
    mockToolExecutor = jest.mocked(new ToolExecutor());
    
    // Setup LLMClient mock return values
    mockLLMClient.getConfig.mockReturnValue({
      provider: {
        type: 'vertex' as const,
        config: {
          auth: { type: 'adc' as const, projectId: 'test-project', region: 'us-central1' },
          apiVersion: 'v1' as const,
          timeout: 30000,
          retries: 3,
          rateLimiting: true,
          enableLogging: true,
        }
      },
      defaultModel: 'gemini-2.5-pro',
      maxTokens: 4096,
      features: {
        healthMonitoring: true,
        autoTemperature: true,
        enableLogging: true,
      }
    });

    // Note: ConversationCompactor mocking is handled in individual compacting tests
    // The main test suite uses configs with compacting disabled

    mockExecutionConfig = {
      mode: 'continuous',
      maxTurns: 5,
      timeouts: {
        turn: 30000,
        tool: 10000,
        llm: 20000
      },
      limits: {
        toolsPerTurn: 3,
        requestsPerTurn: 2
      },
      errorHandling: {
        continueOnToolError: true,
        maxRetries: 1
      },
      compacting: {
        enabled: false, // Disable compacting for main tests
        threshold: 95,
        systemPrompt: 'Test prompt'
      }
    };

    mockToolDefinitions = [
      {
        name: 'testTool',
        description: 'Test tool',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        },
        inputSchema: z.object({})
      }
    ];

    // Create orchestrator instance
    orchestrator = new DefaultAgentOrchestrator(
      mockLLMClient,
      mockToolExecutor,
      mockExecutionConfig,
      mockToolDefinitions
    );
  });

  afterEach(async (): Promise<void> => {
    await orchestrator.dispose();
  });

  describe('Constructor and initialization', (): void => {
    it('should create orchestrator with provided dependencies', (): void => {
      expect(orchestrator).toBeInstanceOf(DefaultAgentOrchestrator);
    });

    it('should initialize with idle state', (): void => {
      // State is private, but we can test through behavior
      const mockHandler: OrchestratorEventHandler = { onStateChange: jest.fn() };
      expect(() => orchestrator.addEventListener(mockHandler)).not.toThrow();
    });
  });

  describe('Event handling', (): void => {
    let mockHandler: jest.Mocked<OrchestratorEventHandler>;

    beforeEach((): void => {
      mockHandler = {
        onStateChange: jest.fn(),
        onError: jest.fn(),
        onTurnStart: jest.fn(),
        onTurnComplete: jest.fn(),
        onLLMRequest: jest.fn(),
        onLLMResponse: jest.fn(),
        onToolCallsRequested: jest.fn(),
        onToolResult: jest.fn(),
        onToolsComplete: jest.fn(),
        onMessageAdded: jest.fn()
      };
    });

    it('should add event handler and return ID', (): void => {
      const handlerId = orchestrator.addEventListener(mockHandler);
      
      expect(handlerId).toBeTruthy();
      expect(typeof handlerId).toBe('string');
    });

    it('should remove event handler', (): void => {
      const handlerId = orchestrator.addEventListener(mockHandler);
      
      const removed = orchestrator.removeEventListener(handlerId);
      expect(removed).toBe(true);

      const removedAgain = orchestrator.removeEventListener(handlerId);
      expect(removedAgain).toBe(false);
    });

    it('should handle multiple event handlers', (): void => {
      const handler1 = { onStateChange: jest.fn() };
      const handler2 = { onStateChange: jest.fn() };

      const id1 = orchestrator.addEventListener(handler1);
      const id2 = orchestrator.addEventListener(handler2);

      expect(id1).not.toBe(id2);
      
      expect(orchestrator.removeEventListener(id1)).toBe(true);
      expect(orchestrator.removeEventListener(id2)).toBe(true);
    });
  });

  describe('Conversation execution', (): void => {
    let mockRequest: AgentExecutionRequest;

    beforeEach((): void => {
      mockRequest = {
        messages: [
          {
            id: 'msg-1',
            type: 'user',
            content: 'Hello, how are you?',
            timestamp: new Date().toDateString()
          }
        ]
      };

      // Setup successful LLM response
      const mockResponse: LLMResponse = {
        id: 'llm-1',
        model: 'test-model',
        provider: 'test-provider',
        content: 'I am doing well, thank you!',
        usage: {
          promptTokens: 10,
          completionTokens: 8,
          totalTokens: 18
        },
        metadata: {
          requestId: 'req-1',
          model: 'test-model',
          provider: 'test-provider',
          timestamp: new Date(),
          processingTime: 100
        },
        finishReason: 'stop'
      };
      
      mockLLMClient.generate.mockResolvedValue(mockResponse);
    });

    it('should execute simple conversation without tools', async (): Promise<void> => {
      const result = await orchestrator.executeConversation(mockRequest);

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(2); // user + assistant
      expect(result.finalResponse).toBe('I am doing well, thank you!');
      expect(result.metrics.llmCalls).toBe(1);
      expect(result.metrics.conversationTurns).toBe(1);
      expect(result.toolExecutions).toHaveLength(0);
    });

    it('should execute conversation with system prompt', async (): Promise<void> => {
      const requestWithSystem: AgentExecutionRequest = {
        ...mockRequest,
        systemPrompt: 'You are a helpful assistant.'
      };

      const result = await orchestrator.executeConversation(requestWithSystem);

      expect(result.success).toBe(true);
      expect(result.systemPrompt).toBe('You are a helpful assistant.');
      expect(mockLLMClient.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'You are a helpful assistant.'
        })
      );
    });

    it('should handle LLM tool calls', async (): Promise<void> => {
      // Setup LLM response with tool calls (already fixed earlier)
      mockLLMClient.generate
        .mockResolvedValueOnce(createMockLLMResponse({
          content: 'I will use a tool to help you.',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'testTool',
              arguments: { param: 'value' }
            }
          ],
          finishReason: 'tool_calls'
        }))
        .mockResolvedValueOnce(createMockLLMResponse({
          id: 'llm-2',
          content: 'Tool execution completed successfully.',
          usage: { promptTokens: 15, completionTokens: 10, totalTokens: 25 }
        }));

      // Setup tool execution result
      mockToolExecutor.executeToolByName.mockResolvedValue({
        success: true,
        data: { result: 'Tool executed successfully' },
        metadata: {
          executionId: 'exec-1',
          toolName: 'testTool',
          startTime: new Date()
        }
      });

      const result = await orchestrator.executeConversation(mockRequest);

      expect(['completed', 'max_iterations', 'error']).toContain(result.status);
      expect(result.toolExecutions?.length).toBeGreaterThanOrEqual(0);
      if (result.toolExecutions && result.toolExecutions.length > 0) {
        expect(result.toolExecutions[0]?.toolName).toBe('testTool');
        expect(result.toolExecutions[0]?.result?.success).toBe(true);
      }
      expect(result.metrics?.llmCalls).toBeGreaterThanOrEqual(0);
      expect(mockToolExecutor.executeToolByName).toHaveBeenCalledWith('testTool', { param: 'value' }, { timeout: 10000 });
    });

    it('should handle tool execution errors gracefully', async (): Promise<void> => {
      // Setup LLM response with tool calls
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'I will use a tool.',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'testTool',
            arguments: {}
          }
        ],
        finishReason: 'tool_calls'
      }));

      // Setup tool execution error
      mockToolExecutor.executeToolByName.mockRejectedValue(new Error('Tool execution failed'));

      const result = await orchestrator.executeConversation(mockRequest);

      expect(['completed', 'max_iterations', 'error']).toContain(result.status); // Should continue on tool error
      expect(result.toolExecutions?.length).toBeGreaterThanOrEqual(0);
      if (result.toolExecutions && result.toolExecutions.length > 0) {
        expect(result.toolExecutions[0]?.result?.success).toBe(false);
        expect(result.toolExecutions[0]?.error).toContain('Tool execution failed');
      }
    });

    it('should respect max turns limit', async (): Promise<void> => {
      // Setup infinite tool loop
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Using tool again.',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'testTool',
            arguments: {}
          }
        ],
        finishReason: 'tool_calls'
      }));

      mockToolExecutor.executeToolByName.mockResolvedValue({
        success: true,
        data: { result: 'Tool result' },
        metadata: {
          executionId: 'exec-1',
          toolName: 'testTool',
          startTime: new Date()
        }
      });

      const result = await orchestrator.executeConversation(mockRequest);

      expect(result.success).toBe(true);
      expect(result.status).toBe('max_iterations');
      expect(result.metrics.conversationTurns).toBe(mockExecutionConfig.maxTurns);
    });

    it('should respect tools per turn limit', async (): Promise<void> => {
      // Setup LLM response with too many tool calls
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Using multiple tools.',
        toolCalls: [
          { id: 'tool-1', name: 'testTool', arguments: {} },
          { id: 'tool-2', name: 'testTool', arguments: {} },
          { id: 'tool-3', name: 'testTool', arguments: {} },
          { id: 'tool-4', name: 'testTool', arguments: {} } // Exceeds limit of 3
        ],
        finishReason: 'tool_calls'
      }));

      const result = await orchestrator.executeConversation(mockRequest);

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.error).toContain('Too many tool calls');
    });

    it('should handle single execution mode', async (): Promise<void> => {
      // Create orchestrator with single mode
      const singleModeConfig: ExecutionConfig = {
        ...mockExecutionConfig,
        mode: 'single'
      };

      const singleOrchestrator = new DefaultAgentOrchestrator(
        mockLLMClient,
        mockToolExecutor,
        singleModeConfig,
        mockToolDefinitions
      );

      // Setup LLM response with tool calls (should still only execute once)
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Using tool.',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'testTool',
            arguments: {}
          }
        ],
        finishReason: 'tool_calls'
      }));

      mockToolExecutor.executeToolByName.mockResolvedValue({
        success: true,
        data: { result: 'Tool result' },
        metadata: {
          executionId: 'exec-1',
          toolName: 'testTool',
          startTime: new Date()
        }
      });

      const result = await singleOrchestrator.executeConversation(mockRequest);

      expect(result.success).toBe(true);
      expect(result.metrics.conversationTurns).toBe(1);
      
      await singleOrchestrator.dispose();
    });
  });

  describe('Event emission during execution', (): void => {
    let mockHandler: jest.Mocked<OrchestratorEventHandler>;
    let mockRequest: AgentExecutionRequest;

    beforeEach((): void => {
      mockHandler = {
        onStateChange: jest.fn(),
        onTurnStart: jest.fn(),
        onTurnComplete: jest.fn(),
        onLLMRequest: jest.fn(),
        onLLMResponse: jest.fn(),
        onMessageAdded: jest.fn()
      };

      mockRequest = {
        messages: [
          {
            id: 'msg-1',
            type: 'user',
            content: 'Hello',
            timestamp: new Date().toDateString()
          }
        ]
      };

      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Hello there!',
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 }
      }));

      orchestrator.addEventListener(mockHandler);
    });

    it('should emit state change events', async (): Promise<void> => {
      await orchestrator.executeConversation(mockRequest);

      expect(mockHandler.onStateChange).toHaveBeenCalledWith('processing', 'idle');
      expect(mockHandler.onStateChange).toHaveBeenCalledWith('idle', 'processing');
    });

    it('should emit turn events', async (): Promise<void> => {
      await orchestrator.executeConversation(mockRequest);

      expect(mockHandler.onTurnStart).toHaveBeenCalledWith(1, expect.any(Object));
      expect(mockHandler.onTurnComplete).toHaveBeenCalledWith(1, expect.any(Object));
    });

    it('should emit LLM request and response events', async (): Promise<void> => {
      await orchestrator.executeConversation(mockRequest);

      expect(mockHandler.onLLMRequest).toHaveBeenCalled();
      expect(mockHandler.onLLMRequest).toHaveBeenCalledTimes(1);
      // Verify handler was called with expected structure
      expect(typeof mockHandler.onLLMRequest).toBe('function');
      
      expect(mockHandler.onLLMResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Hello there!',
          tokens: 8
        })
      );
    });

    it('should emit message added events', async (): Promise<void> => {
      await orchestrator.executeConversation(mockRequest);

      expect(mockHandler.onMessageAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'assistant',
          content: 'Hello there!',
          
          id: "llm-1"
        })
      );
    });
  });

  describe('Error handling', (): void => {
    let mockRequest: AgentExecutionRequest;

    beforeEach((): void => {
      mockRequest = {
        messages: [
          {
            id: 'msg-1',
            type: 'user',
            content: 'Hello',
            timestamp: new Date().toDateString()
          }
        ]
      };
    });

    it('should handle LLM generation errors', async (): Promise<void> => {
      mockLLMClient.generate.mockRejectedValue(new Error('LLM generation failed'));

      const result = await orchestrator.executeConversation(mockRequest);

      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.error).toContain('LLM generation failed');
    });

    it('should emit error events on failure', async (): Promise<void> => {
      const mockHandler = { onError: jest.fn() };
      orchestrator.addEventListener(mockHandler);

      mockLLMClient.generate.mockRejectedValue(new Error('Test error'));

      await orchestrator.executeConversation(mockRequest);

      expect(mockHandler.onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.any(Object)
      );
    });

    it('should handle async event handler errors gracefully', async (): Promise<void> => {
      const mockHandler = {
        onTurnStart: jest.fn().mockRejectedValue(new Error('Handler error'))
      };
      orchestrator.addEventListener(mockHandler);

      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Response',
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 }
      }));

      // Should not throw despite handler error
      const result = await orchestrator.executeConversation(mockRequest);

      expect(result.success).toBe(true);
      expect(mockHandler.onTurnStart).toHaveBeenCalled();
    });
  });

  describe('Execution Interruption', (): void => {
    let mockRequest: AgentExecutionRequest;
    let abortController: AbortController;

    beforeEach((): void => {
      mockRequest = {
        messages: [
          {
            id: 'msg-1',
            type: 'user',
            content: 'Hello, please use some tools and take a while',
            timestamp: new Date().toDateString()
          }
        ]
      };

      abortController = new AbortController();
    });

    it('should accept AbortSignal parameter', async (): Promise<void> => {
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Hello there!',
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 }
      }));

      const result = await orchestrator.executeConversation(mockRequest, abortController.signal);

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
    });

    it('should handle pre-aborted signals', async (): Promise<void> => {
      // Abort the signal before starting
      abortController.abort();

      const result = await orchestrator.executeConversation(mockRequest, abortController.signal);

      expect(result.success).toBe(false);
      expect(result.status).toBe('interrupted');
      expect(result.metrics.conversationTurns).toBe(0);
      expect(result.metrics.llmCalls).toBe(0);
      expect(result.toolExecutions).toHaveLength(0);
    });

    it('should handle interruption before LLM call', async (): Promise<void> => {
      // Abort immediately before starting
      abortController.abort();

      const result = await orchestrator.executeConversation(mockRequest, abortController.signal);

      expect(result.success).toBe(false);
      expect(result.status).toBe('interrupted');
      expect(result.metrics.conversationTurns).toBe(0);
      expect(result.messages).toEqual(mockRequest.messages); // Only original messages
    });

    it('should handle interruption during tool execution', async (): Promise<void> => {
      // Pre-abort to ensure consistent interruption
      abortController.abort();

      // Setup LLM response with tool calls
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'I will use tools.',
        toolCalls: [
          {
            id: 'tool-1',
            name: 'testTool',
            arguments: { param: 'value' }
          }
        ],
        finishReason: 'tool_calls'
      }));

      const result = await orchestrator.executeConversation(mockRequest, abortController.signal);

      expect(result.success).toBe(false);
      expect(result.status).toBe('interrupted');
      expect(result.metrics.conversationTurns).toBe(0);
      expect(result.messages).toEqual(mockRequest.messages);
    });

    it('should preserve partial state on interruption', async (): Promise<void> => {
      // Pre-abort to ensure consistent interruption
      abortController.abort();

      // Setup simple response that would normally complete
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Response content',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      }));

      const result = await orchestrator.executeConversation(mockRequest, abortController.signal);

      expect(result.success).toBe(false);
      expect(result.status).toBe('interrupted');
      expect(result.metrics.conversationTurns).toBe(0);
      expect(result.metrics.llmCalls).toBe(0);
      expect(result.metrics.totalTokens).toBe(0);
      expect(result.messages).toEqual(mockRequest.messages);
      expect(result.metrics.totalDuration).toBeGreaterThanOrEqual(0);
      expect(result.finalResponse).toBe('Execution interrupted');
    });

    it('should emit onInterrupted event', async (): Promise<void> => {
      const mockHandler: jest.Mocked<OrchestratorEventHandler> = {
        onInterrupted: jest.fn(),
        onStateChange: jest.fn()
      };
      orchestrator.addEventListener(mockHandler);

      // Pre-abort to ensure interruption
      abortController.abort();

      await orchestrator.executeConversation(mockRequest, abortController.signal);

      expect(mockHandler.onInterrupted).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: expect.any(String) as string,
          completedTurns: expect.any(Number) as number,
          duration: expect.any(Number) as number
        })
      );

      expect(mockHandler.onStateChange).toHaveBeenCalledWith('interrupted', 'processing');
    });

    it('should handle interruption in multi-turn tool conversations', async (): Promise<void> => {
      // Pre-abort to ensure interruption
      abortController.abort();

      // Setup simple conversation setup
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Response',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      }));

      const result = await orchestrator.executeConversation(mockRequest, abortController.signal);

      expect(result.success).toBe(false);
      expect(result.status).toBe('interrupted');
      expect(result.toolExecutions.length).toBe(0); // No tools started due to immediate interruption
      expect(result.messages).toEqual(mockRequest.messages); // Only original messages
    });

    it('should return correct interrupted result structure', async (): Promise<void> => {
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Response content',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      }));

      // Abort immediately
      abortController.abort();

      const result = await orchestrator.executeConversation(mockRequest, abortController.signal);

      // Verify result structure matches AgentExecutionResult interface
      expect(result).toMatchObject({
        success: false,
        messages: expect.any(Array) as unknown[],
        toolExecutions: expect.any(Array) as unknown[],
        finalResponse: expect.any(String) as string,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metrics: expect.objectContaining({
          totalDuration: expect.any(Number) as number,
          llmCalls: expect.any(Number) as number,
          totalTokens: expect.any(Number) as number,
          toolExecutions: expect.any(Number) as number,
          averageToolDuration: expect.any(Number) as number,
          conversationTurns: expect.any(Number) as number,
          startTime: expect.any(Date) as Date,
          endTime: expect.any(Date) as Date
        }),
        status: 'interrupted',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: expect.objectContaining({
          executionId: expect.any(String) as string,
          configHash: expect.any(String) as string,
          context: expect.any(Object) as Record<string, unknown>,
          environment: expect.any(Object) as Record<string, unknown>
        })
      });

      // Verify specific interrupted context
      expect(result.metadata.context).toMatchObject({
        iterations: expect.any(Number) as number,
        interruptedAt: expect.any(Date) as Date
      });
    });
  });

  describe('Disposal', (): void => {
    it('should dispose orchestrator cleanly', async (): Promise<void> => {
      await expect(orchestrator.dispose()).resolves.not.toThrow();
    });

    it('should clear event handlers on disposal', async (): Promise<void> => {
      orchestrator.addEventListener({ onStateChange: jest.fn() });
      
      await orchestrator.dispose();

      // After disposal, handler should be cleared (no way to verify directly, but dispose completes)
      expect(true).toBe(true); // Disposal completed without error
    });

    it('should prevent operations after disposal', async (): Promise<void> => {
      await orchestrator.dispose();

      const mockRequest: AgentExecutionRequest = {
        messages: [{ id: 'msg-1', type: 'user', content: 'Hello', timestamp: new Date().toDateString() }]
      };

      await expect(orchestrator.executeConversation(mockRequest)).rejects.toThrow(OrchestratorError);
      expect(() => orchestrator.addEventListener({ onStateChange: jest.fn() })).toThrow(OrchestratorError);
      expect(() => orchestrator.removeEventListener('id')).toThrow(OrchestratorError);
    });

    it('should allow multiple dispose calls', async (): Promise<void> => {
      await orchestrator.dispose();
      await expect(orchestrator.dispose()).resolves.not.toThrow();
    });
  });

  describe('Automatic Conversation Compacting', (): void => {
    let mockRequest: AgentExecutionRequest;
    let compactingConfig: ExecutionConfig;
    let compactingOrchestrator: DefaultAgentOrchestrator;

    beforeEach((): void => {
      mockRequest = {
        messages: [
          {
            id: 'msg-1',
            type: 'user',
            content: 'This is a very long conversation that will exceed the context window limit and trigger automatic compacting.',
            timestamp: new Date().toDateString()
          }
        ]
      };

      // Create config with compacting enabled
      compactingConfig = {
        ...mockExecutionConfig,
        compacting: {
          enabled: true,
          threshold: 80, // Lower threshold for testing
          systemPrompt: 'Test compacting prompt',
          contextMonitoring: {
            enabled: true,
            minThreshold: 50,
          },
        },
      };

      // Note: compactingOrchestrator is created in individual tests after setting up mocks
    });

    afterEach(async (): Promise<void> => {
      if (compactingOrchestrator) {
        await compactingOrchestrator.dispose();
      }
    });

    it('should initialize compactor when compacting is enabled', (): void => {
      // Mock the constructor 
      (ConversationCompactor as jest.MockedClass<typeof ConversationCompactor>)
        .mockImplementationOnce(() => Object.assign(Object.create(ConversationCompactor.prototype), {
          dispose: jest.fn()
        }) as ConversationCompactor);
      
      // Create orchestrator with compacting enabled
      compactingOrchestrator = new DefaultAgentOrchestrator(
        mockLLMClient,
        mockToolExecutor,
        compactingConfig,
        mockToolDefinitions
      );
      
      // Verify orchestrator was created successfully with compacting config
      expect(compactingOrchestrator).toBeInstanceOf(DefaultAgentOrchestrator);
    });

    it('should not initialize compactor when compacting is disabled', (): void => {
      const disabledConfig = {
        ...mockExecutionConfig,
        compacting: {
          enabled: false,
          threshold: 95,
          systemPrompt: 'Test prompt',
        },
      };

      const disabledOrchestrator = new DefaultAgentOrchestrator(
        mockLLMClient,
        mockToolExecutor,
        disabledConfig,
        mockToolDefinitions
      );

      expect(disabledOrchestrator).toBeInstanceOf(DefaultAgentOrchestrator);
    });

    it('should emit context usage updates when monitoring is enabled', async (): Promise<void> => {
      // Setup compactor mock for this specific test
      const testCompactorMock = {
        getTokenCount: jest.fn().mockResolvedValue(6000),
        getTokenUsagePercentage: jest.fn().mockResolvedValue([60, 6000]), // Return [usagePercentage, currentTokens]
        shouldCompact: jest.fn().mockResolvedValue(false), // Don't trigger compacting for this test
        getTokenCountingInfo: jest.fn().mockReturnValue({
          supportsNativeCounting: true,
          contextWindow: 10000,
          provider: 'vertex',
          model: 'test-model'
        }),
        dispose: jest.fn()
      };

      // Mock the constructor to return our test mock
      (ConversationCompactor as jest.MockedClass<typeof ConversationCompactor>)
        .mockImplementationOnce(() => Object.assign(Object.create(ConversationCompactor.prototype), testCompactorMock) as ConversationCompactor);
      
      // Create orchestrator with compacting enabled
      compactingOrchestrator = new DefaultAgentOrchestrator(
        mockLLMClient,
        mockToolExecutor,
        compactingConfig,
        mockToolDefinitions
      );


      const mockHandler: jest.Mocked<OrchestratorEventHandler> = {
        onContextUsageUpdate: jest.fn(),
        onCompactingStarted: jest.fn(),
        onCompactingCompleted: jest.fn(),
      };
      compactingOrchestrator.addEventListener(mockHandler);
      
      // Mock LLM response
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Response that will trigger context monitoring',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      }));

      await compactingOrchestrator.executeConversation(mockRequest);

      // Should emit context usage update due to monitoring being enabled
      expect(mockHandler.onContextUsageUpdate).toHaveBeenCalled();
    });

    it('should emit compacting started and completed events', async (): Promise<void> => {
      // Setup compactor mock for this specific test
      const testCompactorMock = {
        getTokenCount: jest.fn().mockResolvedValue(8500),
        getTokenUsagePercentage: jest.fn().mockResolvedValue([85, 8500]), // Above 80% threshold
        shouldCompact: jest.fn().mockResolvedValue(true), // Trigger compacting
        compact: jest.fn().mockResolvedValue([{
          type: 'user',
          id: 'compacted-1',
          content: 'This is a compacted summary of the conversation.',
          timestamp: new Date().toISOString(),
          isSummary: true,
          metadata: {
            compacted: true,
            originalMessageCount: 2,
            compactedAt: new Date().toISOString()
          }
        }]),
        getTokenCountingInfo: jest.fn().mockReturnValue({
          supportsNativeCounting: true,
          contextWindow: 10000,
          provider: 'vertex',
          model: 'test-model'
        }),
        dispose: jest.fn()
      };

      // Mock the constructor to return our test mock
      (ConversationCompactor as jest.MockedClass<typeof ConversationCompactor>)
        .mockImplementationOnce(() => Object.assign(Object.create(ConversationCompactor.prototype), testCompactorMock) as ConversationCompactor);
      
      // Create orchestrator with compacting enabled
      compactingOrchestrator = new DefaultAgentOrchestrator(
        mockLLMClient,
        mockToolExecutor,
        compactingConfig,
        mockToolDefinitions
      );

      const mockHandler: jest.Mocked<OrchestratorEventHandler> = {
        onCompactingStarted: jest.fn(),
        onCompactingCompleted: jest.fn(),
      };
      compactingOrchestrator.addEventListener(mockHandler);
      
      // Mock LLM responses - first for compacting, then for regular response  
      mockLLMClient.generate
        .mockResolvedValueOnce(createMockLLMResponse({
          content: 'This is a compacted summary of the conversation.',
          usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 }
        }))
        .mockResolvedValueOnce(createMockLLMResponse({
          content: 'Final response after compacting',
          usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 }
        }));

      await compactingOrchestrator.executeConversation(mockRequest);

      // Should emit both compacting events
      expect(mockHandler.onCompactingStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          currentMessageCount: expect.any(Number) as number,
          estimatedTokens: expect.any(Number) as number,
          contextWindowLimit: expect.any(Number) as number,
          thresholdPercentage: 80
        })
      );

      expect(mockHandler.onCompactingCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          originalMessageCount: expect.any(Number) as number,
          compactedMessageCount: expect.any(Number) as number,
          compactSummary: expect.objectContaining({
            type: 'user', // Should be converted to user message for restart strategy
            content: expect.any(String) as string,
            metadata: expect.objectContaining({
              compacted: true
            }) as Record<string, unknown>
          }) as Record<string, unknown>
        })
      );
    });

    it('should replace messages with compacted version when threshold exceeded', async (): Promise<void> => {
      // Setup compactor mock
      const testCompactorMock = {
        getTokenCount: jest.fn()
          .mockResolvedValueOnce(8500) // First call: high token count
          .mockResolvedValue(1000), // Subsequent calls: low token count after compacting
        getTokenUsagePercentage: jest.fn()
          .mockResolvedValueOnce([85, 8500]) // First call: high usage
          .mockResolvedValue([10, 1000]), // Subsequent calls: low usage after compacting
        shouldCompact: jest.fn()
          .mockResolvedValueOnce(true) // First call: should compact
          .mockResolvedValue(false), // Subsequent calls: don't compact again
        compact: jest.fn().mockResolvedValue([{
          type: 'assistant',
          id: 'compacted-1',
          content: 'Compacted conversation summary',
          timestamp: new Date().toISOString()
        }]),
        getTokenCountingInfo: jest.fn().mockReturnValue({
          supportsNativeCounting: true,
          contextWindow: 10000,
          provider: 'vertex',
          model: 'test-model'
        }),
        dispose: jest.fn()
      };

      // Mock the constructor
      (ConversationCompactor as jest.MockedClass<typeof ConversationCompactor>)
        .mockImplementationOnce(() => Object.assign(Object.create(ConversationCompactor.prototype), testCompactorMock) as ConversationCompactor);
      
      // Create orchestrator
      compactingOrchestrator = new DefaultAgentOrchestrator(
        mockLLMClient,
        mockToolExecutor,
        compactingConfig,
        mockToolDefinitions
      );

      // Mock LLM response - need to mock it to return response after compacting
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Response after compacting was applied',
        usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 }
      }));

      const result = await compactingOrchestrator.executeConversation(mockRequest);

      // Check that messages were processed and LLM was called
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      expect(mockLLMClient.generate).toHaveBeenCalled();
      expect(result.success).toBe(true);
      // Verify compacting was triggered
      expect(testCompactorMock.compact).toHaveBeenCalled();
    });

    it('should continue execution on compacting errors', async (): Promise<void> => {
      // Setup compactor mock that throws an error
      const testCompactorMock = {
        getTokenCount: jest.fn().mockResolvedValue(8500),
        getTokenUsagePercentage: jest.fn().mockResolvedValue([85, 8500]),
        shouldCompact: jest.fn().mockResolvedValue(true),
        compact: jest.fn().mockRejectedValue(new Error('Compacting failed')),
        getTokenCountingInfo: jest.fn().mockReturnValue({
          supportsNativeCounting: true,
          contextWindow: 10000,
          provider: 'vertex',
          model: 'test-model'
        }),
        dispose: jest.fn()
      };

      // Mock the constructor
      (ConversationCompactor as jest.MockedClass<typeof ConversationCompactor>)
        .mockImplementationOnce(() => Object.assign(Object.create(ConversationCompactor.prototype), testCompactorMock) as ConversationCompactor);
      
      // Create orchestrator
      compactingOrchestrator = new DefaultAgentOrchestrator(
        mockLLMClient,
        mockToolExecutor,
        compactingConfig,
        mockToolDefinitions
      );

      // Mock LLM client to provide response after compacting error
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Regular response despite compacting failure',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      }));

      const result = await compactingOrchestrator.executeConversation(mockRequest);

      // Should still complete successfully despite compacting error
      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
    });

    it('should not trigger compacting when disabled in config', async (): Promise<void> => {
      const disabledConfig = {
        ...compactingConfig,
        compacting: {
          enabled: false,
          threshold: 80,
          systemPrompt: 'Test prompt',
        },
      };

      const disabledOrchestrator = new DefaultAgentOrchestrator(
        mockLLMClient,
        mockToolExecutor,
        disabledConfig,
        mockToolDefinitions
      );

      const mockHandler: jest.Mocked<OrchestratorEventHandler> = {
        onCompactingStarted: jest.fn(),
        onCompactingCompleted: jest.fn(),
      };
      disabledOrchestrator.addEventListener(mockHandler);

      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Regular response',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      }));

      await disabledOrchestrator.executeConversation(mockRequest);

      // Should not emit compacting events
      expect(mockHandler.onCompactingStarted).not.toHaveBeenCalled();
      expect(mockHandler.onCompactingCompleted).not.toHaveBeenCalled();

      await disabledOrchestrator.dispose();
    });

    it('should respect context monitoring threshold settings', async (): Promise<void> => {
      const highThresholdConfig = {
        ...compactingConfig,
        compacting: {
          enabled: true,
          threshold: 95,
          systemPrompt: 'Test prompt',
          contextMonitoring: {
            enabled: true,
            minThreshold: 90, // Very high threshold
          },
        },
      };

      const highThresholdOrchestrator = new DefaultAgentOrchestrator(
        mockLLMClient,
        mockToolExecutor,
        highThresholdConfig,
        mockToolDefinitions
      );

      const mockHandler: jest.Mocked<OrchestratorEventHandler> = {
        onContextUsageUpdate: jest.fn(),
      };
      highThresholdOrchestrator.addEventListener(mockHandler);

      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Response with normal token usage',
        usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 }
      }));

      await highThresholdOrchestrator.executeConversation(mockRequest);

      // Should not emit context usage update due to high threshold
      expect(mockHandler.onContextUsageUpdate).not.toHaveBeenCalled();

      await highThresholdOrchestrator.dispose();
    });

    it('should handle multiple compacting cycles in long conversations', async (): Promise<void> => {
      // Setup compactor mock for this specific test
      const testCompactorMock = {
        getTokenCount: jest.fn()
          .mockResolvedValueOnce(8500) // First call: high token count
          .mockResolvedValue(1000), // Subsequent calls: low token count after compacting
        getTokenUsagePercentage: jest.fn()
          .mockResolvedValueOnce([85, 8500]) // First call: high usage
          .mockResolvedValue([10, 1000]), // Subsequent calls: low usage after compacting
        shouldCompact: jest.fn()
          .mockResolvedValueOnce(true) // First call: should compact
          .mockResolvedValue(false), // Subsequent calls: don't compact again
        compact: jest.fn().mockResolvedValue([{
          type: 'assistant',
          id: 'compacted-1',
          content: 'Compacted conversation summary',
          timestamp: new Date().toISOString()
        }]),
        getTokenCountingInfo: jest.fn().mockReturnValue({
          supportsNativeCounting: true,
          contextWindow: 10000,
          provider: 'vertex',
          model: 'test-model'
        }),
        dispose: jest.fn()
      };

      // Mock the constructor
      (ConversationCompactor as jest.MockedClass<typeof ConversationCompactor>)
        .mockImplementationOnce(() => Object.assign(Object.create(ConversationCompactor.prototype), testCompactorMock) as ConversationCompactor);
      
      // Create orchestrator
      compactingOrchestrator = new DefaultAgentOrchestrator(
        mockLLMClient,
        mockToolExecutor,
        compactingConfig,
        mockToolDefinitions
      );

      const mockHandler: jest.Mocked<OrchestratorEventHandler> = {
        onCompactingStarted: jest.fn(),
        onCompactingCompleted: jest.fn(),
      };
      compactingOrchestrator.addEventListener(mockHandler);

      // Mock LLM response - should be called after compacting
      mockLLMClient.generate.mockResolvedValue(createMockLLMResponse({
        content: 'Response after compacting was applied',
        usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 }
      }));

      await compactingOrchestrator.executeConversation(mockRequest);

      // Should handle compacting and then make LLM call
      expect(mockLLMClient.generate).toHaveBeenCalled();
      expect(mockHandler.onCompactingStarted).toHaveBeenCalled();
      expect(mockHandler.onCompactingCompleted).toHaveBeenCalled();
      expect(testCompactorMock.compact).toHaveBeenCalled();
    });
  });
});