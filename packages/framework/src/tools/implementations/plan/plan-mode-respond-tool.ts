import type { ToolExecutionContext, ToolExecutionResult } from '../../core/types/tool.js';
import { BaseTool } from '../../core/base-tool.js';
import { Tool } from '../../core/decorators.js';
import { logger } from '../../../utils/logger.js';
import { 
  PlanModeRespondInputSchema, 
  PlanModeRespondOutputSchema,
  PlanModeRespondLLMOutputSchema,
  type PlanModeRespondInput,
  type PlanModeRespondOutput,
  type PlanModeRespondLLMOutput
} from './schemas.js';

/**
 * PlanModeRespond tool for handling plan acceptance and implementation guidance
 * Used by AI agents to propose plans to users and handle their responses
 */
@Tool({
  name: 'plan-mode-respond',
  description: 'Tool for AI agents to propose plans to users and handle plan acceptance. Takes plan content and returns guidance for implementation.',
  inputSchema: PlanModeRespondInputSchema,
  outputSchema: PlanModeRespondOutputSchema,
  llmOutputSchema: PlanModeRespondLLMOutputSchema,
  version: '1.0.0',
  tags: ['planning', 'workflow', 'user-interaction'],
  category: 'system'
})
export class PlanModeRespondTool extends BaseTool<PlanModeRespondInput, PlanModeRespondOutput, PlanModeRespondLLMOutput> {
  protected readonly inputSchema = PlanModeRespondInputSchema;
  protected readonly outputSchema = PlanModeRespondOutputSchema;
  protected readonly toolName = 'plan-mode-respond';

  /**
   * Extract minimal content for LLM - implementation guidance message
   */
  public getLLMOutput(result: ToolExecutionResult<PlanModeRespondOutput>): PlanModeRespondLLMOutput {
    if (!result.success) {
      return {
        message: result.error?.message || 'Plan response processing failed'
      };
    }

    if (!result.data) {
      return {
        message: 'Plan response processing failed: No data returned'
      };
    }

    return {
      message: result.data.message
    };
  }

  /**
   * Execute plan mode response processing
   */
  protected executeInternal(
    input: PlanModeRespondInput,
    context: ToolExecutionContext
  ): Promise<PlanModeRespondOutput> {
    
    logger.debug('Starting plan mode response processing', {
      hasContent: input.content.length > 0,
      contentLength: input.content.length,
      executionId: context.executionId
    });

    try {
      const planAccepted = input.content.trim().length > 0;
      
      let message: string;
      
      if (planAccepted) {
        message = 'Plan accepted. Begin implementation according to the proposed plan. Stay focused on the plan objectives and follow the outlined steps systematically.';
      } else {
        message = 'No plan content provided. Please provide a plan or clarify requirements before proceeding.';
      }

      logger.info('Plan mode response processed successfully', {
        planAccepted,
        executionId: context.executionId
      });

      return Promise.resolve({
        success: true,
        message,
        planAccepted
      });

    } catch (error) {
      logger.error('Plan mode response processing failed', error as Error, {
        contentLength: input.content.length,
        executionId: context.executionId
      });

      throw error;
    }
  }
}