import { Agent } from '../../core/agent.js';
import { AgentBuilder } from '../../core/builder.js';
import { createDefaultAgentConfig, type AgentConfig } from '../../core/config.js';

// Set longer timeout for integration tests
jest.setTimeout(120000); // 2 minutes

describe('Agent End-to-End Integration', (): void => {
  describe('Agent lifecycle', (): void => {
    it('should create, execute, and dispose agent successfully', async (): Promise<void> => {
      const config: AgentConfig = {
        ...createDefaultAgentConfig(),
        model: {
          provider: {
            type: 'vertex',
            config: {
              auth: {
                type: 'adc',
                projectId: process.env['VERTEX_PROJECT_ID'] || 'test-project',
                region: process.env['VERTEX_REGION'] || 'us-central1'
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
        },
        execution: {
          ...createDefaultAgentConfig().execution,
          mode: 'continuous',
          maxTurns: 3,
          limits: {
            toolsPerTurn: 2,
            requestsPerTurn: 1
          },
          errorHandling: {
            continueOnToolError: true,
            maxRetries: 1
          }
        },
        metadata: {
          name: 'e2e-test-agent'
        }
      };

      // Create agent
      const agent = Agent.create(config);
      expect(agent).toBeInstanceOf(Agent);
      
      const status = agent.getStatus();
      expect(status.config.metadata?.name).toBe('e2e-test-agent');

      try {
        // Execute conversation
        const result = await agent.execute({
          systemPrompt: 'You are a helpful assistant for testing.',
          messages: [
            {
              id: 'msg-1',
              type: 'user',
              content: 'Hello! Please respond with a short greeting.',
              timestamp: new Date().toDateString()
            }
          ]
        });

        // Verify execution result
        expect(result.status).toMatch(/completed|max_turns|error/);
        expect(result.messages.length).toBeGreaterThanOrEqual(1); // At least user message
        expect(result.metrics.conversationTurns).toBeGreaterThan(0);
        expect(result.metrics.llmCalls).toBeGreaterThanOrEqual(0);

        // Verify message structure
        const userMessage = result.messages.find(m => m.type === 'user');
        expect(userMessage).toBeDefined();
        expect(userMessage!.type).toBe('user');
        expect(userMessage!.content).toContain('Hello');

        const assistantMessage = result.messages.find(m => m.type === 'assistant');
        expect(assistantMessage).toBeDefined();
        expect(assistantMessage!.type).toBe('assistant');
        expect(assistantMessage!.content).toBeTruthy();

        // Verify metrics
        expect(result.metrics.startTime).toBeInstanceOf(Date);
        expect(result.metrics.endTime).toBeInstanceOf(Date);
        expect(result.metrics.totalDuration).toBeGreaterThanOrEqual(0);

      } finally {
        // Always dispose agent
        await agent.dispose();
      }
    }, 60000); // 30 second timeout for integration test

    it('should handle multiple conversations in sequence', async (): Promise<void> => {
      const config = {
        ...createDefaultAgentConfig(),
        model: {
          provider: {
            type: 'vertex' as const,
            config: {
              auth: {
                type: 'adc' as const,
                projectId: process.env['VERTEX_PROJECT_ID'] || 'test-project',
                region: process.env['VERTEX_REGION'] || 'us-central1'
              },
              apiVersion: 'v1',
              timeout: 30000,
              retries: 3,
              rateLimiting: true,
              enableLogging: true
            }
          },
          defaultModel: 'gemini-2.5-pro'
        },
        execution: {
          ...createDefaultAgentConfig().execution,
          mode: 'single' as const
        },
        metadata: {
          name: 'multi-conversation-agent'
        }
      };
      
      const agent = Agent.create(config);

      try {
        // First conversation
        const result1 = await agent.execute({
          messages: [
            {
              id: 'msg-1',
              type: 'user',
              content: 'What is 2 + 2?',
              timestamp: new Date().toDateString()
            }
          ]
        });

        expect(['completed', 'max_turns', 'error']).toContain(result1.status);
        expect(result1.messages.length).toBeGreaterThanOrEqual(1);

        // Second conversation (independent)
        const result2 = await agent.execute({
          messages: [
            {
              id: 'msg-2',
              type: 'user',
              content: 'What is the capital of France?',
              timestamp: new Date().toDateString()
            }
          ]
        });

        expect(['completed', 'max_turns', 'error']).toContain(result2.status);
        expect(result2.messages.length).toBeGreaterThanOrEqual(1);

        // Verify conversations are independent
        const user1 = result1.messages.find(m => m.type === 'user');
        const user2 = result2.messages.find(m => m.type === 'user');
        expect(user1?.content).toContain('2 + 2');
        expect(user2?.content).toContain('France');

      } finally {
        await agent.dispose();
      }
    }, 60000); // 60 second timeout for multiple conversations

    it('should work with AgentBuilder workflow', async (): Promise<void> => {
      const agent = new AgentBuilder()
        .vertexModel('gemini-2.5-pro', process.env['VERTEX_PROJECT_ID'] || 'test-project')
        .maxTurns(2)
        .mode('continuous')
        .build();

      try {
        const result = await agent.execute({
          systemPrompt: 'Be concise in your responses.',
          messages: [
            {
              id: 'msg-1',
              type: 'user',
              content: 'Tell me a very short joke.',
              timestamp: new Date().toDateString()
            }
          ]
        });

        expect(['completed', 'max_turns', 'error']).toContain(result.status);
        expect(result.messages.length).toBeGreaterThanOrEqual(1);

        // Verify agent was created successfully
        expect(agent).toBeInstanceOf(Agent);

      } finally {
        await agent.dispose();
      }
    }, 60000);
  });

  describe('Event handling integration', (): void => {
    it('should emit events during execution', async (): Promise<void> => {
      const config = {
        ...createDefaultAgentConfig(),
        model: {
          provider: {
            type: 'vertex' as const,
            config: {
              auth: {
                type: 'adc' as const,
                projectId: process.env['VERTEX_PROJECT_ID'] || 'test-project',
                region: process.env['VERTEX_REGION'] || 'us-central1'
              },
              apiVersion: 'v1',
              timeout: 30000,
              retries: 3,
              rateLimiting: true,
              enableLogging: true
            }
          },
          defaultModel: 'gemini-2.5-pro'
        },
        execution: {
          ...createDefaultAgentConfig().execution,
          mode: 'single' as const
        },
        metadata: {
          name: 'event-test-agent'
        }
      };
      
      const agent = Agent.create(config);

      const events: string[] = [];
      
      // Add event handler to capture events
      agent.addEventListener({
        onStateChange: (newState, _previousState) => {
          events.push(`state:${newState}`);
        },
        onTurnStart: (turn) => {
          events.push(`turn-start:${turn}`);
        },
        onTurnComplete: (turn) => {
          events.push(`turn-complete:${turn}`);
        },
        onLLMRequest: () => {
          events.push('llm-request');
        },
        onLLMResponse: () => {
          events.push('llm-response');
        },
        onMessageAdded: (message) => {
          events.push(`message:${message.type}`);
        }
      });

      try {
        await agent.execute({
          messages: [
            {
              id: 'msg-1',
              type: 'user',
              content: 'Simple test message.',
              timestamp: new Date().toDateString()
            }
          ]
        });

        // Verify events were emitted
        expect(events).toContain('state:processing');
        expect(events).toContain('state:idle');
        expect(events).toContain('turn-start:1');
        expect(events).toContain('turn-complete:1');
        expect(events).toContain('llm-request');
        expect(events).toContain('llm-response');
        expect(events).toContain('message:assistant');

      } finally {
        await agent.dispose();
      }
    }, 60000);

    it('should handle async event handlers', async (): Promise<void> => {
      const config = {
        ...createDefaultAgentConfig(),
        model: {
          provider: {
            type: 'vertex' as const,
            config: {
              auth: {
                type: 'adc' as const,
                projectId: process.env['VERTEX_PROJECT_ID'] || 'test-project',
                region: process.env['VERTEX_REGION'] || 'us-central1'
              },
              apiVersion: 'v1',
              timeout: 30000,
              retries: 3,
              rateLimiting: true,
              enableLogging: true
            }
          },
          defaultModel: 'gemini-2.5-pro'
        },
        execution: {
          ...createDefaultAgentConfig().execution,
          mode: 'single' as const
        },
        metadata: {
          name: 'async-event-agent'
        }
      };
      
      const agent = Agent.create(config);

      const asyncResults: string[] = [];

      // Add async event handlers
      agent.addEventListener({
        onTurnStart: async (turn) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          asyncResults.push(`async-turn-start:${turn}`);
        },
        onLLMResponse: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          asyncResults.push('async-llm-response');
        }
      });

      try {
        await agent.execute({
          messages: [
            {
              id: 'msg-1',
              type: 'user',
              content: 'Test async handlers.',
              timestamp: new Date().toDateString()
            }
          ]
        });

        // Wait for async handlers to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Verify async handlers completed
        expect(asyncResults).toContain('async-turn-start:1');
        expect(asyncResults).toContain('async-llm-response');

      } finally {
        await agent.dispose();
      }
    }, 60000);
  });

  describe('Error scenarios', (): void => {
    it('should handle invalid model gracefully', async (): Promise<void> => {
      const config = {
        ...createDefaultAgentConfig(),
        model: {
          provider: {
            type: 'vertex' as const,
            config: {
              auth: {
                type: 'adc' as const,
                projectId: process.env['VERTEX_PROJECT_ID'] || 'test-project',
                region: process.env['VERTEX_REGION'] || 'us-central1'
              },
              apiVersion: 'v1',
              timeout: 30000,
              retries: 3,
              rateLimiting: true,
              enableLogging: true
            }
          },
          defaultModel: 'non-existent-model'
        },
        execution: {
          ...createDefaultAgentConfig().execution,
          mode: 'single' as const
        },
        metadata: {
          name: 'error-test-agent'
        }
      };
      
      const agent = Agent.create(config);

      try {
        const result = await agent.execute({
          messages: [
            {
              id: 'msg-1',
              type: 'user',
              content: 'This should fail.',
              timestamp: new Date().toDateString()
            }
          ]
        });

        // Should handle gracefully, check status
        expect(['completed', 'max_turns', 'error']).toContain(result.status);
        if (result.status === 'error') {
          expect(result.error).toBeTruthy();
        }

      } finally {
        await agent.dispose();
      }
    }, 15000);

    it('should handle disposal after error', async (): Promise<void> => {
      const config = {
        ...createDefaultAgentConfig(),
        model: {
          provider: {
            type: 'vertex' as const,
            config: {
              auth: {
                type: 'adc' as const,
                projectId: process.env['VERTEX_PROJECT_ID'] || 'test-project',
                region: process.env['VERTEX_REGION'] || 'us-central1'
              },
              apiVersion: 'v1',
              timeout: 30000,
              retries: 3,
              rateLimiting: true,
              enableLogging: true
            }
          },
          defaultModel: 'gemini-2.5-pro'
        },
        execution: {
          ...createDefaultAgentConfig().execution,
          mode: 'single' as const
        },
        metadata: {
          name: 'disposal-test-agent'
        }
      };
      
      const agent = Agent.create(config);

      // Execute and expect it might fail
      await agent.execute({
        messages: [
          {
            id: 'msg-1',
            type: 'user',
            content: 'Test message.',
            timestamp: new Date().toDateString()
          }
        ]
      });

      // Disposal should work regardless of execution success/failure
      await expect(agent.dispose()).resolves.not.toThrow();

      // Operations after disposal should fail
      await expect(agent.execute({
        messages: [
          {
            id: 'msg-2',
            type: 'user',
            content: 'This should fail.',
            timestamp: new Date().toDateString()
          }
        ]
      })).rejects.toThrow('disposed');
    }, 60000);
  });

  describe('Configuration edge cases', (): void => {
    it('should work with minimal configuration', async (): Promise<void> => {
      const config = {
        ...createDefaultAgentConfig(),
        model: {
          provider: {
            type: 'vertex' as const,
            config: {
              auth: {
                type: 'adc' as const,
                projectId: process.env['VERTEX_PROJECT_ID'] || 'test-project',
                region: process.env['VERTEX_REGION'] || 'us-central1'
              },
              apiVersion: 'v1',
              timeout: 30000,
              retries: 3,
              rateLimiting: true,
              enableLogging: true
            }
          },
          defaultModel: 'gemini-2.5-pro'
        },
        execution: {
          ...createDefaultAgentConfig().execution,
          mode: 'single' as const
        },
        metadata: {
          name: 'minimal-agent'
        }
      };
      
      const agent = Agent.create(config);

      try {
        const result = await agent.execute({
          messages: [
            {
              id: 'msg-1',
              type: 'user',
              content: 'Minimal test.',
              timestamp: new Date().toDateString()
            }
          ]
        });

        expect(['completed', 'max_turns', 'error']).toContain(result.status);
        expect(result.metrics.conversationTurns).toBeGreaterThanOrEqual(0);

      } finally {
        await agent.dispose();
      }
    }, 60000);

    it('should handle complex message history', async (): Promise<void> => {
      const config = {
        ...createDefaultAgentConfig(),
        model: {
          provider: {
            type: 'vertex' as const,
            config: {
              auth: {
                type: 'adc' as const,
                projectId: process.env['VERTEX_PROJECT_ID'] || 'test-project',
                region: process.env['VERTEX_REGION'] || 'us-central1'
              },
              apiVersion: 'v1',
              timeout: 30000,
              retries: 3,
              rateLimiting: true,
              enableLogging: true
            }
          },
          defaultModel: 'gemini-2.5-pro'
        },
        execution: {
          ...createDefaultAgentConfig().execution,
          mode: 'continuous' as const,
          maxTurns: 2
        },
        metadata: {
          name: 'history-agent'
        }
      };
      
      const agent = Agent.create(config);

      try {
        const result = await agent.execute({
          systemPrompt: 'You are continuing a conversation.',
          messages: [
            {
              id: 'msg-1',
              type: 'user',
              content: 'I asked about the weather earlier.',
              timestamp: new Date(Date.now() - 60000).toDateString()
            },
            {
              id: 'msg-2',
              type: 'assistant',
              content: 'Yes, you asked about the weather. It was sunny.',
              timestamp: new Date(Date.now() - 30000).toDateString()
            },
            {
              id: 'msg-3',
              type: 'user',
              content: 'What about tomorrow?',
              timestamp: new Date().toDateString()
            }
          ]
        });

        expect(['completed', 'max_turns', 'error']).toContain(result.status);
        expect(result.messages.length).toBeGreaterThan(3); // Original + new responses
        
        // Should have processed the context
        const lastMessage = result.messages[result.messages.length - 1];
        expect(lastMessage).toBeDefined();
        expect(['user', 'assistant']).toContain(lastMessage!.type);

      } finally {
        await agent.dispose();
      }
    }, 60000);
  });
});