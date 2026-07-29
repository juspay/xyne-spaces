import { OrchestratorError } from '../../orchestrator/types.js';

describe('Orchestrator Types', (): void => {
  describe('OrchestratorError', (): void => {
    it('should create error with message and code', (): void => {
      const error = new OrchestratorError('Test error', 'TEST_CODE');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(OrchestratorError);
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('OrchestratorError');
      expect(error.code).toBe('TEST_CODE');
      expect(error.context).toBeUndefined();
    });

    it('should create error with context', (): void => {
      const context = { operation: 'test', attempt: 1 };
      const error = new OrchestratorError('Test error', 'TEST_CODE', context);

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.context).toBe(context);
    });

    it('should create error without context', (): void => {
      const error = new OrchestratorError('Test error', 'TEST_CODE', undefined);

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.context).toBeUndefined();
    });

    it('should have proper error inheritance', (): void => {
      const error = new OrchestratorError('Test error', 'TEST_CODE');

      expect(error instanceof Error).toBe(true);
      expect(error instanceof OrchestratorError).toBe(true);
      expect(error.message).toContain('Test error');
    });

    it('should preserve stack trace', (): void => {
      const error = new OrchestratorError('Test error', 'TEST_CODE');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('OrchestratorError');
    });

    describe('Common error codes', (): void => {
      it('should handle disposal error', (): void => {
        const error = new OrchestratorError(
          'Orchestrator has been disposed',
          'DISPOSED'
        );

        expect(error.code).toBe('DISPOSED');
        expect(error.message).toContain('disposed');
      });

      it('should handle request limit error', (): void => {
        const error = new OrchestratorError(
          'Exceeded LLM request limit',
          'REQUEST_LIMIT_EXCEEDED',
          { maxRequests: 3, currentRequests: 4 }
        );

        expect(error.code).toBe('REQUEST_LIMIT_EXCEEDED');
        expect(error.context?.['maxRequests']).toBe(3);
        expect(error.context?.['currentRequests']).toBe(4);
      });

      it('should handle tool limit error', (): void => {
        const error = new OrchestratorError(
          'Too many tool calls requested',
          'TOOL_LIMIT_EXCEEDED',
          { maxTools: 5, requestedTools: 7 }
        );

        expect(error.code).toBe('TOOL_LIMIT_EXCEEDED');
        expect(error.context?.['maxTools']).toBe(5);
        expect(error.context?.['requestedTools']).toBe(7);
      });

      it('should handle execution timeout error', (): void => {
        const error = new OrchestratorError(
          'Execution timeout exceeded',
          'EXECUTION_TIMEOUT',
          { timeout: 30000, elapsed: 35000 }
        );

        expect(error.code).toBe('EXECUTION_TIMEOUT');
        expect(error.context?.['timeout']).toBe(30000);
        expect(error.context?.['elapsed']).toBe(35000);
      });
    });

    describe('Context handling', (): void => {
      it('should handle empty context object', (): void => {
        const error = new OrchestratorError('Test error', 'TEST_CODE', {});

        expect(error.context).toEqual({});
      });

      it('should handle complex context', (): void => {
        const context = {
          operation: 'executeConversation',
          turn: 3,
          metadata: {
            executionId: 'exec-123',
            timestamp: new Date()
          },
          config: {
            maxTurns: 5,
            timeout: 30000
          },
          state: {
            currentIteration: 2,
            toolCalls: ['tool1', 'tool2']
          }
        };

        const error = new OrchestratorError('Complex error', 'COMPLEX_ERROR', context);

        expect(error.context).toBe(context);
        expect(error.context?.['operation']).toBe('executeConversation');
        expect(error.context?.['turn']).toBe(3);
        expect((error.context?.['metadata'] as Record<string, unknown>)?.['executionId']).toBe('exec-123');
        expect((error.context?.['config'] as Record<string, unknown>)?.['maxTurns']).toBe(5);
        expect((error.context?.['state'] as Record<string, unknown>)?.['toolCalls']).toEqual(['tool1', 'tool2']);
      });

      it('should handle null and undefined values in context', (): void => {
        const context = {
          validValue: 'test',
          nullValue: null,
          undefinedValue: undefined,
          emptyString: '',
          zeroNumber: 0,
          falseBoolean: false
        };

        const error = new OrchestratorError('Test error', 'TEST_CODE', context);

        expect(error.context?.['validValue']).toBe('test');
        expect(error.context?.['nullValue']).toBe(null);
        expect(error.context?.['undefinedValue']).toBe(undefined);
        expect(error.context?.['emptyString']).toBe('');
        expect(error.context?.['zeroNumber']).toBe(0);
        expect(error.context?.['falseBoolean']).toBe(false);
      });
    });

    describe('Error serialization', (): void => {
      it('should be JSON serializable', (): void => {
        const context = { operation: 'test', count: 5 };
        const error = new OrchestratorError('Test error', 'TEST_CODE', context);

        const serialized = JSON.stringify(error);
        const parsed = JSON.parse(serialized) as { message: string; code: string; context?: { operation: string; count: number } };

        expect(parsed.message).toBe('Test error');
        expect(parsed.code).toBe('TEST_CODE');
        expect(parsed.context?.operation).toBe('test');
        expect(parsed.context?.count).toBe(5);
      });

      it('should handle circular references in context', (): void => {
        const context = { operation: 'test' } as Record<string, unknown>;
        context['self'] = context; // Circular reference

        const error = new OrchestratorError('Test error', 'TEST_CODE', context);

        // Should not throw when creating the error
        expect(error.code).toBe('TEST_CODE');
        expect(error.context?.['operation']).toBe('test');
      });
    });

    describe('Error chaining', (): void => {
      it('should work with Error.cause when available', (): void => {
        const originalError = new Error('Original error');
        const orchestratorError = new OrchestratorError(
          'Wrapped error',
          'WRAPPED_ERROR',
          { originalError }
        );

        expect(orchestratorError.context?.['originalError']).toBe(originalError);
      });

      it('should maintain error chain information', (): void => {
        const rootError = new Error('Root cause');
        const midError = new OrchestratorError('Mid error', 'MID_ERROR', { cause: rootError });
        const topError = new OrchestratorError('Top error', 'TOP_ERROR', { cause: midError });

        expect(topError.context?.['cause']).toBe(midError);
        expect((topError.context?.['cause'] as OrchestratorError)?.context?.['cause']).toBe(rootError);
      });
    });

    describe('Error comparison', (): void => {
      it('should compare errors by code', (): void => {
        const error1 = new OrchestratorError('Error 1', 'SAME_CODE');
        const error2 = new OrchestratorError('Error 2', 'SAME_CODE');
        const error3 = new OrchestratorError('Error 3', 'DIFFERENT_CODE');

        expect(error1.code).toBe(error2.code);
        expect(error1.code).not.toBe(error3.code);
      });

      it('should maintain unique identity', (): void => {
        const error1 = new OrchestratorError('Test error', 'TEST_CODE');
        const error2 = new OrchestratorError('Test error', 'TEST_CODE');

        expect(error1).not.toBe(error2); // Different instances
        expect(error1.message).toBe(error2.message);
        expect(error1.code).toBe(error2.code);
      });
    });
  });
});
