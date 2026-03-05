/**
 * Validation Phase - Handles deterministic validation and agentic error fixing
 */

import { WorkflowEngine, AgenticCheckpointResult } from '../../../workflow-types';
import { getValidationConfig, extractLastMessageContent } from '../../xyne-spaces-workflows/utils';
import { XyneSpacesPlanReviewLoopSteps } from '../utils';
import { runDeterministicValidation } from '../../validation-helpers';
import { logger } from '@/utils/logger';
import { WorkflowContext, ExecutionState, PhaseResult } from '../types';

interface ValidationPhaseDeps {
  workflow: WorkflowEngine<any, typeof XyneSpacesPlanReviewLoopSteps>;
  context: WorkflowContext;
  state: ExecutionState;
  projectGuidelines: string;
  repoPath: string;
}

export async function runValidationPhase(
  deps: ValidationPhaseDeps
): Promise<PhaseResult<{ validationPassed: boolean; gitInfo: any }>> {
  const { workflow, context, state, projectGuidelines, repoPath } = deps;

  logger.info('Starting validation phase...');
  const deterministicResult = await runDeterministicValidation(repoPath, state.gitInfo, state.coAuthor);

  // Check if validation failed at the push step (e.g., non-fast-forward error)
  if (deterministicResult.success === false) {
    logger.error('Deterministic validation failed:', deterministicResult.failureReason);
    return {
      success: false,
      failureReason: deterministicResult.failureReason || 'Validation failed during git push',
    };
  }

  if (deterministicResult.formatCommitHash) {
    state.gitInfo = { ...state.gitInfo, commitHash: deterministicResult.formatCommitHash };
  }

  let validationPassed = deterministicResult.passed;

  if (!validationPassed) {
    logger.warn('Validation failed with errors, starting agentic error fixing...');

    const errorLines = deterministicResult.errorLines;
    const validationOutput = deterministicResult.validationOutput;

    const validationErrors = (errorLines && errorLines.length > 0)
      ? errorLines.join('\n')
      : (validationOutput?.stderr || validationOutput?.stdout || 'Validation failed');

    const validationConfig = getValidationConfig(
      validationErrors,
      repoPath.replace('/tmp/', ''),
      state.gitInfo.repoUrl,
      state.gitInfo.branch,
      context.baseBranch,
      context.checkoutCommit,
      projectGuidelines,
      context.executorType,
      false,
      state.coAuthor
    );

    const validationResult: AgenticCheckpointResult = await workflow.createAgenticCheckpoint(
      XyneSpacesPlanReviewLoopSteps.VALIDATION,
      'xyne-validator',
      validationConfig
    );

    state.gitInfo = { ...state.gitInfo, ...validationResult.gitInfo };

    const lastMessageContent = extractLastMessageContent(validationResult.result).toLowerCase();
    validationPassed = lastMessageContent.includes('validation passed');

    if (validationPassed) {
      logger.info('Validation errors fixed by agent!');
    } else {
      logger.warn('Agent could not fix all validation errors. Manual intervention required.');
    }
  } else {
    logger.info('Validation passed on first try!');
  }

  return {
    success: true,
    data: {
      validationPassed,
      gitInfo: state.gitInfo,
    },
  };
}
