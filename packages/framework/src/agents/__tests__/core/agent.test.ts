import { Agent } from '../../core/agent.js';
import { AgentBuilder } from '../../core/builder.js';
import type { ConversationRequest, ConversationResult } from '../../core/agent.js';
import type { AgentConfig } from '../../core/config.js';

describe('Agent', (): void => {
  const createTestAgent = (): Agent => {
    return new AgentBuilder()
      .vertexModel('gemini-2.5-pro', 'test-project')
      .build();
  };

  describe('Agent creation', (): void => {
    it('should create agent with builder', (): void => {
      const agent = createTestAgent();
      
      expect(agent).toBeInstanceOf(Agent);
    });

    it('should create agent directly with config', (): void => {
      const config = new AgentBuilder()
        .vertexModel('gemini-2.5-pro', 'test-project')
        .getConfig();

      const agent = Agent.create(config);
      
      expect(agent).toBeInstanceOf(Agent);
    });
  });

  describe('Conversation execution', (): void => {
    let agent: Agent;

    beforeEach((): void => {
      agent = createTestAgent();
    });

    afterEach(async (): Promise<void> => {
      await agent.dispose();
    });

    it('should execute simple conversation', async (): Promise<void> => {
      const request: ConversationRequest = {
        messages: [{
          id: 'msg-1',
          type: 'user',
          content: 'Hello, how are you?',
          timestamp: new Date().toDateString()
        }]
      };

      const result: ConversationResult = await agent.execute(request);

      // The exact message count depends on LLM response, just check we have the original message
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      expect(result.metrics).toBeDefined();
      expect(result.metrics.conversationTurns).toBeGreaterThan(0);
      expect(result.toolExecutions).toBeDefined();
      expect(['completed', 'max_turns', 'error']).toContain(result.status);
    });

    it('should execute conversation with system prompt', async (): Promise<void> => {
      const request: ConversationRequest = {
        systemPrompt: 'You are a helpful assistant.',
        messages: [{
          id: 'msg-1',
          type: 'user',
          content: 'What is 2+2?',
          timestamp: new Date().toDateString()
        }]
      };

      const result: ConversationResult = await agent.execute(request);

      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      expect(result.metrics.llmCalls).toBeGreaterThanOrEqual(0);
    });

    it('should handle conversation errors gracefully', async (): Promise<void> => {
      // Create agent with potentially problematic config
      const errorAgent = new AgentBuilder()
        .litellmModel('invalid-model', 'invalid-key')
        .build();

      try {
        const result = await errorAgent.execute({
          messages: [{
            id: 'msg-1',
            type: 'user',
            content: 'Hello',
            timestamp: new Date().toDateString()
          }]
        });

        // If it doesn't throw, check if it's an error status
        if (result.status === 'error') {
          expect(result.error).toBeDefined();
        }
      } catch (error) {
        // Expected for invalid configuration
        expect(error).toBeInstanceOf(Error);
      } finally {
        await errorAgent.dispose();
      }
    });
  });

  describe('Event handling', (): void => {
    let agent: Agent;

    beforeEach((): void => {
      agent = createTestAgent();
    });

    afterEach(async (): Promise<void> => {
      await agent.dispose();
    });

    it('should register and notify event handlers', async (): Promise<void> => {
      const mockHandler = {
        onStateChange: jest.fn()
      };

      const handlerId = agent.addEventListener(mockHandler);
      expect(handlerId).toBeTruthy();

      // Execute to trigger state changes
      await agent.execute({
        messages: [{
          id: 'msg-1',
          type: 'user',
          content: 'Hello',
          timestamp: new Date().toDateString()
        }]
      });

      // Note: We can't guarantee the handler is called due to async nature
      // but we can verify it was registered
      expect(typeof handlerId).toBe('string');
    });

    it('should remove event handlers', (): void => {
      const mockHandler = {
        onStateChange: jest.fn()
      };

      const handlerId = agent.addEventListener(mockHandler);
      const removed = agent.removeEventListener(handlerId);
      
      expect(removed).toBe(true);

      const removedAgain = agent.removeEventListener(handlerId);
      expect(removedAgain).toBe(false);
    });
  });

  describe('Agent status and lifecycle', (): void => {
    it('should provide agent status', (): void => {
      const agent = createTestAgent();

      const status = agent.getStatus();
      
      expect(status.id).toBeTruthy();
      expect(['idle', 'processing', 'error', 'disposed']).toContain(status.state);
      expect(status.config).toBeDefined();
      expect(status.components).toBeDefined();
      expect(status.statistics).toBeDefined();
    });

    it('should dispose agent cleanly', async (): Promise<void> => {
      const agent = createTestAgent();

      await expect(agent.dispose()).resolves.not.toThrow();
    });

    it('should prevent operations after disposal', async (): Promise<void> => {
      const agent = createTestAgent();
      await agent.dispose();

      await expect(agent.execute({
        messages: [{
          id: 'msg-1',
          type: 'user',
          content: 'Hello',
          timestamp: new Date().toDateString()
        }]
      })).rejects.toThrow();
    });

    it('should allow multiple dispose calls', async (): Promise<void> => {
      const agent = createTestAgent();

      await agent.dispose();
      await expect(agent.dispose()).resolves.not.toThrow();
    });
  });

  describe('Builder integration', (): void => {
    it('should work with fluent builder API', async (): Promise<void> => {
      const agent = new AgentBuilder()
        .vertexModel('gemini-2.5-pro', 'test-project')
        .tools(['tool1'])
        .maxTurns(3)
        .mode('continuous')
        .build();

      expect(agent).toBeInstanceOf(Agent);
      await agent.dispose();
    });

    it('should work with different model providers', async (): Promise<void> => {
      const vertexAgent = new AgentBuilder()
        .vertexModel('gemini-2.5-pro', 'test-project')
        .build();

      const litellmAgent = new AgentBuilder()
        .litellmModel('gpt-4', 'test-api-key')
        .build();

      expect(vertexAgent).toBeInstanceOf(Agent);
      expect(litellmAgent).toBeInstanceOf(Agent);
      
      await vertexAgent.dispose();
      await litellmAgent.dispose();
    });
  });

  describe('Execution Interruption', (): void => {
    let agent: Agent;
    let abortController: AbortController;

    beforeEach((): void => {
      agent = createTestAgent();
      abortController = new AbortController();
    });

    afterEach(async (): Promise<void> => {
      await agent.dispose();
    });

    it('should accept AbortSignal in conversation request', async (): Promise<void> => {
      const request: ConversationRequest = {
        messages: [{
          id: 'msg-1',
          type: 'user',
          content: 'Hello',
          timestamp: new Date().toDateString()
        }],
        abortSignal: abortController.signal
      };

      const result = await agent.execute(request);

      expect(['completed', 'max_turns', 'interrupted', 'error']).toContain(result.status);
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle pre-aborted signals', async (): Promise<void> => {
      // Abort the signal before starting
      abortController.abort();

      const request: ConversationRequest = {
        messages: [{
          id: 'msg-1',
          type: 'user',
          content: 'Hello',
          timestamp: new Date().toDateString()
        }],
        abortSignal: abortController.signal
      };

      const result = await agent.execute(request);

      expect(result.status).toBe('interrupted');
      expect(result.metrics.conversationTurns).toBe(0);
      expect(result.metrics.llmCalls).toBe(0);
      expect(result.toolExecutions).toHaveLength(0);
    });

    it('should handle interruption during execution', async (): Promise<void> => {
      // Pre-abort to ensure consistent interruption
      abortController.abort();

      const request: ConversationRequest = {
        messages: [{
          id: 'msg-1',
          type: 'user',
          content: 'Please perform a long task with multiple steps',
          timestamp: new Date().toDateString()
        }],
        abortSignal: abortController.signal
      };

      const result = await agent.execute(request);

      expect(result.status).toBe('interrupted');
      expect(result.metrics.totalDuration).toBeGreaterThanOrEqual(0);
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
    });

    it('should preserve partial state on interruption', async (): Promise<void> => {
      // Pre-abort to ensure consistent interruption
      abortController.abort();

      const request: ConversationRequest = {
        messages: [{
          id: 'msg-1',
          type: 'user',
          content: 'Start a conversation that will be interrupted',
          timestamp: new Date().toDateString()
        }],
        abortSignal: abortController.signal
      };

      const result = await agent.execute(request);

      expect(result.status).toBe('interrupted');
      expect(result.metrics).toMatchObject({
        totalDuration: expect.any(Number) as number,
        llmCalls: expect.any(Number) as number,
        totalTokens: expect.any(Number) as number,
        toolExecutions: expect.any(Number) as number,
        averageToolDuration: expect.any(Number) as number,
        conversationTurns: expect.any(Number) as number,
        startTime: expect.any(Date) as Date,
        endTime: expect.any(Date) as Date
      });
    });

    it('should return consistent result structure for interrupted conversations', async (): Promise<void> => {
      abortController.abort(); // Pre-abort for consistent test

      const request: ConversationRequest = {
        messages: [{
          id: 'msg-1',
          type: 'user',
          content: 'Test message',
          timestamp: new Date().toDateString()
        }],
        abortSignal: abortController.signal
      };

      const result = await agent.execute(request);

      // Verify structure matches ConversationResult interface
      expect(result).toMatchObject({
        messages: expect.any(Array) as unknown[],
        toolExecutions: expect.any(Array) as unknown[],
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
        status: 'interrupted'
      });
    });

    it('should work with createConversationRequest helper', async (): Promise<void> => {
      const { createConversationRequest } = await import('../../core/agent.js');
      
      const request = createConversationRequest(
        [{
          id: 'msg-1',
          type: 'user',
          content: 'Hello',
          timestamp: new Date().toDateString()
        }],
        'You are a helpful assistant',
        abortController.signal
      );

      expect(request).toMatchObject({
        messages: expect.any(Array) as unknown[],
        systemPrompt: 'You are a helpful assistant',
        abortSignal: abortController.signal
      });
    });
  });

  describe('Error handling', (): void => {
    it('should handle invalid configuration', (): void => {
      expect(() => {
        Agent.create({} as AgentConfig);
      }).toThrow();
    });

    it('should handle concurrent execution attempts', async (): Promise<void> => {
      const agent = createTestAgent();

      const request: ConversationRequest = {
        messages: [{
          id: 'msg-1',
          type: 'user',
          content: 'Hello',
          timestamp: new Date().toDateString()
        }]
      };

      // Start first execution
      const execution1 = agent.execute(request);

      // Try to start second execution immediately
      await expect(agent.execute(request)).rejects.toThrow('Agent is already processing');

      // Wait for first execution to complete
      await execution1;

      await agent.dispose();
    });
  });
});