import type { ToolExecutionContext, ToolExecutionResult } from '../../core/types/tool.js';
import { BaseTool } from '../../core/base-tool.js';
import { Tool } from '../../core/decorators.js';
import { logger } from '../../../utils/logger.js';
import {
  AskQuestionInputSchema,
  AskQuestionOutputSchema,
  AskQuestionLLMOutputSchema,
  type AskQuestionInput,
  type AskQuestionOutput,
  type AskQuestionLLMOutput,
  type QuestionAnswer,
  type QuestionGroup,
  type SingleSelectQuestion,
  type MultiSelectQuestion,
} from './schemas.js';

/**
 * Input for answering questions (second call)
 */
interface AnswerInput extends AskQuestionInput {
  answers: QuestionAnswer[];
}

/**
 * Type guard to check if input has answers (second call)
 */
function hasAnswers(input: AskQuestionInput | AnswerInput): input is AnswerInput {
  return 'answers' in input && Array.isArray(input.answers);
}

/**
 * Type guard for single select question
 */
function isSingleSelectQuestion(question: QuestionGroup['questions'][number]): question is SingleSelectQuestion {
  return question.type === 'single_select';
}

/**
 * Type guard for multi select question
 */
function isMultiSelectQuestion(question: QuestionGroup['questions'][number]): question is MultiSelectQuestion {
  return question.type === 'multi_select';
}

/**
 * Ask Question tool - allows LLM to ask user questions
 * First call: returns questions for frontend display (_requiresUserInput: true)
 * Second call (with answers): validates and returns completed result
 */
@Tool({
  name: 'ask_question',
  description: 'Ask the user one or more questions to gather information. Supports open-ended text questions, as well as single-select and multi-select questions organized in groups with headings. All select questions include an "Other" option for custom text input. First call returns questions for display, second call (with answers) returns validated results.',
  inputSchema: AskQuestionInputSchema,
  outputSchema: AskQuestionOutputSchema,
  llmOutputSchema: AskQuestionLLMOutputSchema,
  version: '1.0.0',
  tags: ['interaction', 'user-input', 'questions'],
  category: 'system'
})
export class AskQuestionTool extends BaseTool<AskQuestionInput, AskQuestionOutput, AskQuestionLLMOutput> {
  protected readonly inputSchema = AskQuestionInputSchema;
  protected readonly outputSchema = AskQuestionOutputSchema;
  protected readonly toolName = 'ask_question';

  /**
   * Extract minimal content for LLM
   */
  public getLLMOutput(result: ToolExecutionResult<AskQuestionOutput>): AskQuestionLLMOutput {
    if (!result.success) {
      return {
        message: result.error?.message || 'Failed to ask questions'
      };
    }

    const data = result.data;
    if (!data) {
      return {
        message: 'No data returned'
      };
    }

    // Handle pending state (shouldn't happen for LLM output but just in case)
    if ('_requiresUserInput' in data) {
      return {
        message: `Waiting for user to answer ${data.questionGroups.length} question groups`
      };
    }

    // Handle failed state
    if (!data.success) {
      return {
        message: data.error.message,
        error: data.error.message
      };
    }

    // Handle completed state - format answers for LLM
    const answers = data.answers.map(answer => {
      let answerValue: string | string[];
      switch (answer.type) {
        case 'single_select':
          answerValue = answer.customText || answer.selectedOptionId;
          break;
        case 'multi_select':
          answerValue = answer.customText || answer.selectedOptionIds;
          break;
        case 'text':
          answerValue = answer.text;
          break;
      }
      return {
        questionId: answer.questionId,
        answer: answerValue
      };
    });

    return {
      message: `Received ${answers.length} answers from user`,
      answers
    };
  }

  /**
   * Execute the tool
   * First call: returns questions for frontend (_requiresUserInput: true)
   * Second call (with answers): validates and returns completed result
   */
  protected async executeInternal(
    input: AskQuestionInput,
    context: ToolExecutionContext
  ): Promise<AskQuestionOutput> {
    logger.debug('Ask question tool executing', {
      hasAnswers: hasAnswers(input),
      groupCount: input.groups?.length,
      executionId: context.executionId
    });

    // Validate question groups
    this.validateQuestionGroups(input.groups);

    // First call - no answers yet, return questions for frontend
    if (!hasAnswers(input)) {
      logger.debug('First call - returning questions for frontend', {
        groupCount: input.groups.length
      });

      return {
        _requiresUserInput: true,
        _toolName: 'ask_question',
        questionGroups: input.groups
      };
    }

    // Second call - validate answers and return result
    logger.debug('Second call - validating answers', {
      answerCount: input.answers.length
    });

    const validation = this.validateAnswers(input.groups, input.answers);

    if (!validation.valid) {
      logger.warn('Answer validation failed', {
        error: validation.error,
        details: validation.details
      });

      return {
        success: false,
        error: {
          code: validation.code || 'validation_failed',
          message: validation.error || 'Invalid answers provided',
          details: validation.details
        }
      };
    }

    logger.info('Questions answered successfully', {
      answerCount: input.answers.length
    });

    return Promise.resolve({
      success: true,
      answers: input.answers,
      completedAt: new Date().toISOString()
    });
  }

  /**
   * Validate question groups for duplicates
   */
  private validateQuestionGroups(groups: QuestionGroup[]): void {
    const questionIds = new Set<string>();

    for (const group of groups) {
      for (const question of group.questions) {
        // Check for duplicate question IDs
        if (questionIds.has(question.id)) {
          throw new Error(`Duplicate question ID: ${question.id}`);
        }
        questionIds.add(question.id);

        // Validate options have unique IDs for select questions
        if (isSingleSelectQuestion(question) || isMultiSelectQuestion(question)) {
          const optionIds = new Set<string>();
          for (const option of question.options) {
            if (optionIds.has(option.id)) {
              throw new Error(`Duplicate option ID: ${option.id} in question ${question.id}`);
            }
            optionIds.add(option.id);
          }
        }
      }
    }
  }

  /**
   * Validate answers against questions
   */
  private validateAnswers(
    groups: QuestionGroup[],
    answers: QuestionAnswer[]
  ): { valid: boolean; code?: 'validation_failed' | 'invalid_answers'; error?: string; details?: string[] } {
    const details: string[] = [];

    // Build map of all questions
    const questionMap = new Map<string, QuestionGroup['questions'][number]>();

    for (const group of groups) {
      for (const question of group.questions) {
        questionMap.set(question.id, question);
      }
    }

    // Check all answers reference valid questions
    for (const answer of answers) {
      const question = questionMap.get(answer.questionId);
      if (!question) {
        details.push(`Invalid question ID: ${answer.questionId}`);
        continue;
      }

      // Validate answer type matches question type
      if (answer.type !== question.type) {
        details.push(`Answer type mismatch for question ${answer.questionId}: expected ${question.type}, got ${answer.type}`);
        continue;
      }

      // Validate single select answer
      if (answer.type === 'single_select' && isSingleSelectQuestion(question)) {
        const validOptionIds = new Set(question.options.map(o => o.id));
        // Allow __custom__ option ID for custom text input (added by frontend)
        if (!validOptionIds.has(answer.selectedOptionId) && answer.selectedOptionId !== '__custom__') {
          details.push(`Invalid option ID: ${answer.selectedOptionId} for question ${answer.questionId}`);
        }
      }

      // Validate multi select answer
      if (answer.type === 'multi_select' && isMultiSelectQuestion(question)) {
        const validOptionIds = new Set(question.options.map(o => o.id));
        for (const optionId of answer.selectedOptionIds) {
          // Allow __custom__ option ID for custom text input (added by frontend)
          if (!validOptionIds.has(optionId) && optionId !== '__custom__') {
            details.push(`Invalid option ID: ${optionId} for question ${answer.questionId}`);
          }
        }
      }
    }

    if (details.length > 0) {
      return {
        valid: false,
        code: 'invalid_answers',
        error: 'Some answers are invalid',
        details
      };
    }

    return { valid: true };
  }
}
