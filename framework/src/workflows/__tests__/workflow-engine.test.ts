/**
 * Tests for Workflow Engine
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createWorkflow } from '../index.js';
import type { AgenticStepConfig, WorkflowState } from '../index.js';
import { AgentBuilder } from '../../agents/core/builder.js';

// Type alias for cleaner test code
type TestWorkflowState = WorkflowState<TestContext>;

// Mock the Agent import
jest.mock('../../agents/core/agent.js', () => ({
  Agent: {
    create: jest.fn(() => ({
      execute: jest.fn().mockImplementation(() => Promise.resolve({
        messages: [
          { id: '1', type: 'user', content: 'test input', timestamp: new Date().toISOString() },
          { id: '2', type: 'assistant', content: 'test response', timestamp: new Date().toISOString() }
        ],
        status: 'completed'
      })),
      dispose: jest.fn().mockImplementation(() => Promise.resolve())
    }))
  }
}));

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn()
  },
  LogLevel: {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
    OFF: 'off'
  }
}));

interface TestContext {
  value: number;
  result?: string;
  processed?: boolean;
}

// Helper function to create initial workflow state
function createInitialState(stage: string, context: TestContext): WorkflowState<TestContext> {
  return {
    messages: [],
    stage,
    context,
    metadata: {
      workflowId: 'test-' + Date.now(),
      startTime: new Date(),
      totalIterations: 0,
      currentIteration: 0
    }
  };
}

describe('Workflow Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('WorkFlow Builder', () => {
    it('should create a workflow with function steps', async () => {
      const workflow = createWorkflow<TestContext>()
        .addFunctionStep({
          name: 'increment',
          handler: (state: TestWorkflowState) => {
            state.context.value += 1;
            return Promise.resolve(state);
          }
        })
        .addFunctionStep({
          name: 'multiply',
          handler: (state: TestWorkflowState) => {
            state.context.value *= 2;
            return Promise.resolve(state);
          }
        })
        .createGraph()
        .execute('increment')
        .execute('multiply')
        .build();

      const result = await workflow.start(createInitialState('increment', { value: 5 }));

      expect(result.status).toBe('completed');
      expect(result.state.context.value).toBe(12); // (5 + 1) * 2
      expect(result.metadata.totalIterations).toBe(2);
      expect(result.metadata.nodesExecuted).toEqual(['increment', 'multiply']);
    });

    it('should handle conditional execution', async () => {
      const workflow = createWorkflow<TestContext>()
        .addFunctionStep({
          name: 'check',
          handler: (state: TestWorkflowState) => {
            state.context.processed = true;
            return Promise.resolve(state);
          }
        })
        .addFunctionStep({
          name: 'process_high',
          handler: (state: TestWorkflowState) => {
            state.context.result = 'high';
            return Promise.resolve(state);
          }
        })
        .addFunctionStep({
          name: 'process_low',
          handler: (state: TestWorkflowState) => {
            state.context.result = 'low';
            return Promise.resolve(state);
          }
        })
        .createGraph()
        .execute('check')
        .conditionalExecute({
          handler: (state: TestWorkflowState) => {
            return Promise.resolve(state.context.value > 10 ? 'high' : 'low');
          },
          paths: {
            'high': 'process_high',
            'low': 'process_low'
          }
        })
        .execute('process_high')
        .conditionalExecute({
          handler: (_state: TestWorkflowState) => Promise.resolve('exit'),
          paths: { 'exit': 'exit' }
        })
        .execute('process_low')
        .build();

      // Test high value path
      const highResult = await workflow.start(createInitialState('check', { value: 15 }));
      expect(highResult.status).toBe('completed');
      expect(highResult.state.context.result).toBe('high');

      // Test low value path
      const lowResult = await workflow.start(createInitialState('check', { value: 5 }));
      expect(lowResult.status).toBe('completed');
      expect(lowResult.state.context.result).toBe('low');
    });

    it('should handle exit paths in conditional execution', async () => {
      const workflow = createWorkflow<TestContext>()
        .addFunctionStep({
          name: 'start',
          handler: (state: TestWorkflowState) => {
            state.context.processed = true;
            return Promise.resolve(state);
          }
        })
        .addFunctionStep({
          name: 'should_not_execute',
          handler: (state: TestWorkflowState) => {
            state.context.result = 'should not reach here';
            return Promise.resolve(state);
          }
        })
        .createGraph()
        .execute('start')
        .conditionalExecute({
          handler: (state: TestWorkflowState) => {
            return Promise.resolve(state.context.value > 10 ? 'exit' : 'continue');
          },
          paths: {
            'exit': 'exit',
            'continue': 'should_not_execute'
          }
        })
        .execute('should_not_execute')
        .build();

      const result = await workflow.start(createInitialState('start', { value: 15 }));

      expect(result.status).toBe('completed');
      expect(result.state.context.processed).toBe(true);
      expect(result.state.context.result).toBeUndefined();
      expect(result.metadata.nodesExecuted).toEqual(['start']);
    });

    it('should handle workflow loops through conditional paths', async () => {
      const workflow = createWorkflow<TestContext>()
        .addFunctionStep({
          name: 'increment',
          handler: (state: TestWorkflowState) => {
            state.context.value += 1;
            return Promise.resolve(state);
          }
        })
        .addFunctionStep({
          name: 'finish',
          handler: (state: TestWorkflowState) => {
            state.context.result = 'finished';
            return Promise.resolve(state);
          }
        })
        .createGraph()
        .execute('increment')
        .conditionalExecute({
          handler: (state: TestWorkflowState) => {
            return Promise.resolve(state.context.value >= 10 ? 'done' : 'continue');
          },
          paths: {
            'done': 'finish',
            'continue': 'increment'
          }
        })
        .execute('finish')
        .build();

      const result = await workflow.start(createInitialState('increment', { value: 7 }));

      expect(result.status).toBe('completed');
      expect(result.state.context.value).toBe(10); // Should loop 3 times: 7->8->9->10
      expect(result.state.context.result).toBe('finished');
      expect(result.metadata.totalIterations).toBeGreaterThan(3); // Multiple increments + finish
    });

    it('should track node history for resumption', async () => {
      const workflow = createWorkflow<TestContext>()
        .addFunctionStep({
          name: 'step1',
          handler: (state: TestWorkflowState) => {
            state.context.value += 1;
            return Promise.resolve(state);
          }
        })
        .addFunctionStep({
          name: 'step2',
          handler: (state: TestWorkflowState) => {
            state.context.value *= 2;
            return Promise.resolve(state);
          }
        })
        .createGraph()
        .execute('step1')
        .execute('step2')
        .build();

      const result = await workflow.start(createInitialState('step1', { value: 5 }));

      expect(result.nodeHistory).toBeDefined();
      expect(result.nodeHistory['step1']).toHaveLength(1);
      expect(result.nodeHistory['step2']).toHaveLength(1);

      // Check that we can resume from history
      const resumeResult = await workflow.resumeFromHistory(
        result.nodeHistory,
        'step2',
        0 // Use first (and only) history entry
      );

      expect(resumeResult.status).toBe('completed');
    });

    it('should validate workflow configuration', () => {
      expect(() => {
        createWorkflow<TestContext>()
          .addFunctionStep({
            name: 'step1',
            handler: (state: TestWorkflowState) => Promise.resolve(state)
          })
          .createGraph()
          .execute('nonexistent_step') // Reference non-existent step
          .build();
      }).toThrow(/Step 'nonexistent_step' referenced in execution order but not defined/);
    });

    it('should handle agentic steps', async () => {
      const agenticStep: AgenticStepConfig<TestContext> = {
        name: 'agent_step',
        agenticConfig: (_state: TestWorkflowState) => {
          return Promise.resolve(new AgentBuilder()
            .vertexModel('claude-sonnet-4@20250514', 'test-project')
            .maxTurns(1)
            .getConfig());
        },
        after: (state: TestWorkflowState, _result) => {
          state.context.result = 'agent completed';
          return Promise.resolve(state);
        }
      };

      const workflow = createWorkflow<TestContext>()
        .addAgenticStep(agenticStep)
        .createGraph()
        .execute('agent_step')
        .build();

      const result = await workflow.start(createInitialState('agent_step', { value: 5 }));

      expect(result.status).toBe('completed');
      expect(result.state.context.result).toBe('agent completed');
    });

    it('should handle errors gracefully', async () => {
      const workflow = createWorkflow<TestContext>()
        .addFunctionStep({
          name: 'failing_step',
          handler: (_state: TestWorkflowState) => {
            return Promise.reject(new Error('Test error'));
          }
        })
        .createGraph()
        .execute('failing_step')
        .build();

      const result = await workflow.start(createInitialState('failing_step', { value: 5 }));

      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Test error');
    });

    it('should allow starting from any node', async () => {
      const workflow = createWorkflow<TestContext>()
        .addFunctionStep({
          name: 'step1',
          handler: (state: TestWorkflowState) => {
            state.context.value = 1;
            return Promise.resolve(state);
          }
        })
        .addFunctionStep({
          name: 'step2',
          handler: (state: TestWorkflowState) => {
            state.context.value = 2;
            return Promise.resolve(state);
          }
        })
        .addFunctionStep({
          name: 'step3',
          handler: (state: TestWorkflowState) => {
            state.context.value = 3;
            return Promise.resolve(state);
          }
        })
        .createGraph()
        .execute('step1')
        .execute('step2')
        .execute('step3')
        .build();

      // Start from step2, should skip step1
      const result = await workflow.start(createInitialState('step2', { value: 0 }));

      expect(result.status).toBe('completed');
      expect(result.state.context.value).toBe(3); // step2 sets to 2, step3 sets to 3
      expect(result.metadata.nodesExecuted).toEqual(['step2', 'step3']);
    });
  });
});