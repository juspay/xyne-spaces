import { PlanModeRespondTool } from '../plan-mode-respond-tool.js';
import type { PlanModeRespondInput, PlanModeRespondOutput } from '../schemas.js';

describe('PlanModeRespondTool', () => {
  let planModeRespondTool: PlanModeRespondTool;

  beforeEach(() => {
    planModeRespondTool = new PlanModeRespondTool();
  });

  describe('Basic functionality', () => {
    it('should accept plan when content is provided', async () => {
      const input: PlanModeRespondInput = {
        content: 'This is my detailed plan to implement the feature step by step'
      };

      const result = await planModeRespondTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        const data = result.data as PlanModeRespondOutput;
        expect(data.success).toBe(true);
        expect(data.planAccepted).toBe(true);
        expect(data.message).toContain('Plan accepted');
        expect(data.message).toContain('Begin implementation');
      }
    });

    it('should reject plan when content is empty', async () => {
      const input: PlanModeRespondInput = {
        content: ''
      };

      const result = await planModeRespondTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        const data = result.data as PlanModeRespondOutput;
        expect(data.success).toBe(true);
        expect(data.planAccepted).toBe(false);
        expect(data.message).toContain('No plan content provided');
      }
    });

    it('should reject plan when content is only whitespace', async () => {
      const input: PlanModeRespondInput = {
        content: '   \n\t  '
      };

      const result = await planModeRespondTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        const data = result.data as PlanModeRespondOutput;
        expect(data.success).toBe(true);
        expect(data.planAccepted).toBe(false);
        expect(data.message).toContain('No plan content provided');
      }
    });

    it('should accept plan when content has meaningful text after trimming', async () => {
      const input: PlanModeRespondInput = {
        content: '  \n  My detailed implementation plan  \t\n  '
      };

      const result = await planModeRespondTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        const data = result.data as PlanModeRespondOutput;
        expect(data.success).toBe(true);
        expect(data.planAccepted).toBe(true);
        expect(data.message).toContain('Plan accepted');
      }
    });
  });

  describe('Input validation', () => {
    it('should accept valid input with content parameter', async () => {
      const input: PlanModeRespondInput = {
        content: 'Valid plan content'
      };
      
      const result = await planModeRespondTool.execute(input);
      
      expect(result.success).toBe(true);
    });

    it('should reject input without content parameter', async () => {
      // @ts-expect-error Testing invalid input
      const result = await planModeRespondTool.execute({});
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_VALIDATION_ERROR');
    });

    it('should reject input with non-string content', async () => {
      // @ts-expect-error Testing invalid input
      const result = await planModeRespondTool.execute({ content: 123 });
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_VALIDATION_ERROR');
    });
  });

  describe('LLM output', () => {
    it('should return implementation guidance for accepted plan', async () => {
      const input: PlanModeRespondInput = {
        content: 'Detailed implementation plan'
      };

      const result = await planModeRespondTool.execute(input);
      const llmOutput = planModeRespondTool.getLLMOutput(result);

      expect(llmOutput.message).toContain('Plan accepted');
      expect(llmOutput.message).toContain('Begin implementation');
    });

    it('should return guidance message for rejected plan', async () => {
      const input: PlanModeRespondInput = {
        content: ''
      };

      const result = await planModeRespondTool.execute(input);
      const llmOutput = planModeRespondTool.getLLMOutput(result);

      expect(llmOutput.message).toContain('No plan content provided');
    });

    it('should return error message for failed execution', () => {
      const mockResult = {
        success: false,
        error: {
          name: 'ToolExecutionError' as const,
          code: 'TOOL_EXECUTION_ERROR' as const,
          message: 'Something went wrong',
          timestamp: new Date().toISOString()
        },
        metadata: {
          toolName: 'plan-mode-respond',
          executionId: 'test-id',
          startTime: new Date()
        }
      };

      const llmOutput = planModeRespondTool.getLLMOutput(mockResult);

      expect(llmOutput.message).toBe('Something went wrong');
    });

    it('should return default error message when no error details provided', () => {
      const mockResult = {
        success: false,
        metadata: {
          toolName: 'plan-mode-respond',
          executionId: 'test-id',
          startTime: new Date()
        }
      };

      const llmOutput = planModeRespondTool.getLLMOutput(mockResult);

      expect(llmOutput.message).toBe('Plan response processing failed');
    });
  });

  describe('Edge cases', () => {
    it('should handle very long plan content', async () => {
      const longContent = 'A'.repeat(10000);
      const input: PlanModeRespondInput = {
        content: longContent
      };

      const result = await planModeRespondTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as PlanModeRespondOutput;
        expect(data.planAccepted).toBe(true);
      }
    });

    it('should handle plan content with special characters', async () => {
      const input: PlanModeRespondInput = {
        content: 'Plan with "quotes", symbols: @#$%^&*(), and unicode: 🚀 ✅ 📝'
      };

      const result = await planModeRespondTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as PlanModeRespondOutput;
        expect(data.planAccepted).toBe(true);
      }
    });

    it('should handle multiline plan content', async () => {
      const input: PlanModeRespondInput = {
        content: `Step 1: Analyze requirements
Step 2: Design architecture
Step 3: Implement features
Step 4: Test thoroughly
Step 5: Deploy to production`
      };

      const result = await planModeRespondTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as PlanModeRespondOutput;
        expect(data.planAccepted).toBe(true);
        expect(data.message).toContain('Plan accepted');
      }
    });

    it('should handle content with only newlines and tabs', async () => {
      const input: PlanModeRespondInput = {
        content: '\n\n\t\t\n\t\n'
      };

      const result = await planModeRespondTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as PlanModeRespondOutput;
        expect(data.planAccepted).toBe(false);
        expect(data.message).toContain('No plan content provided');
      }
    });
  });

  describe('Message content validation', () => {
    it('should provide clear acceptance message', async () => {
      const input: PlanModeRespondInput = {
        content: 'My plan'
      };

      const result = await planModeRespondTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as PlanModeRespondOutput;
        expect(data.message).toBe('Plan accepted. Begin implementation according to the proposed plan. Stay focused on the plan objectives and follow the outlined steps systematically.');
      }
    });

    it('should provide clear rejection message', async () => {
      const input: PlanModeRespondInput = {
        content: ''
      };

      const result = await planModeRespondTool.execute(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as PlanModeRespondOutput;
        expect(data.message).toBe('No plan content provided. Please provide a plan or clarify requirements before proceeding.');
      }
    });
  });
});