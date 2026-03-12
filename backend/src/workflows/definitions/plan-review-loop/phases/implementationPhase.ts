/**
 * Implementation Phase - Handles the implementation loop with review and early validation
 */

import { WorkflowEngine, AgenticCheckpointResult, LoopControl } from '../../../workflow-types';
import { getImplementationConfig } from '../../xyne-spaces-workflows/utils';
import {
  XyneSpacesPlanReviewLoopSteps,
  getImplementationReviewConfig,
  parseReviewResult,
  formatFeedbackForRetry,
  ReviewMetrics,
} from '../utils';
import { getChangedFiles, getGitDiff, getLocalChangedFiles, getLocalGitDiff } from '../../validation-helpers';
import { logger } from '@/utils/logger';
import { WorkflowContext, ExecutionState, PhaseResult } from '../types';

interface ImplementationPhaseDeps {
  workflow: WorkflowEngine<any, typeof XyneSpacesPlanReviewLoopSteps>;
  context: WorkflowContext;
  state: ExecutionState;
  projectGuidelines: string;
  repoPath: string;
}

export async function runImplementationPhase(
  deps: ImplementationPhaseDeps,
  maxIterations: number,
  threshold: number
): Promise<PhaseResult<{ implReviewMetrics: ReviewMetrics['implementationReview'] }>> {
  const { workflow, context, state, projectGuidelines, repoPath } = deps;

  logger.info(`Starting Loop 2: Implementation with Review (max ${maxIterations} iterations, threshold ${threshold})`);

  let implFeedback = '';
  let previousReviewFeedback = ''; // Track reviewer's last feedback to pass back to reviewer
  const scoreHistory: number[] = []; // Track score history for degradation detection
  const implReviewMetrics: ReviewMetrics['implementationReview'] = {
    score: 0,
    feedback: '',
    iterations: 0,
    approvedAt: '',
  };

  await workflow.createWhileLoop(
    XyneSpacesPlanReviewLoopSteps.IMPLEMENTATION,
    maxIterations,
    async (iteration, scopedEngine) => {
      implReviewMetrics.iterations = iteration + 1;
      logger.info(`Implementation iteration ${iteration + 1}/${maxIterations}`);

      // Step 4: Implementation
      const implResult: AgenticCheckpointResult = await scopedEngine.createAgenticCheckpoint(
        XyneSpacesPlanReviewLoopSteps.IMPLEMENTATION,
        'xyne-implementer',
        getImplementationConfig(
          state.approvedPlan! + (implFeedback ? `\n\n${implFeedback}` : ''),
          state.gitInfo.repoUrl,
          state.workflowBranch,
          context.baseBranch,
          context.checkoutCommit,
          projectGuidelines,
          context.executorType,
          false,
          context.taskType,
          state.coAuthor
        )
      );

      state.gitInfo = { ...state.gitInfo, ...implResult.gitInfo };

      // Early Validation: Run TypeScript and ESLint checks before Implementation Review
      // SOFT GATE: Proceed with review even if validation fails - pass errors as context
      const earlyValidation = await runEarlyValidation(repoPath);
      if (!earlyValidation.passed) {
        logger.warn('Early validation failed - proceeding with Implementation Review (soft gate)');
        // Continue to Implementation Review with validation errors as context
      }

      // Get changed files and diff
      const { changedFiles, gitDiff } = await getChangedFilesAndDiff(
        repoPath,
        state.baseCommitHash,
        context.baseBranch,
        state.gitInfo
      );
      state.changedFiles = changedFiles;

      // Step 5: Implementation Review - run with diff for proper review
      logger.info('Running Implementation Review...');
      const reviewResult: AgenticCheckpointResult = await scopedEngine.createAgenticCheckpoint(
        XyneSpacesPlanReviewLoopSteps.IMPLEMENTATION_REVIEW,
        'xyne-implementation-reviewer',
        getImplementationReviewConfig(
          state.approvedPlan!,
          changedFiles,
          gitDiff,
          state.gitInfo.repoUrl,
          state.workflowBranch,
          context.baseBranch,
          'xyne-code',
          context.taskType,
          state.coAuthor,
          previousReviewFeedback || undefined,
          earlyValidation.passed ? undefined : earlyValidation.errors
        )
      );

      const review = parseReviewResult(reviewResult.result);
      implReviewMetrics.score = review.score;

      // If early validation failed, combine validation errors with review feedback
      if (!earlyValidation.passed) {
        implReviewMetrics.feedback = `## ⚠️ Build Errors (Must Fix)\n\n${earlyValidation.errors}\n\n---\n\n## Reviewer Feedback (Score: ${review.score}/10)\n\n${review.feedback}`;
        implFeedback = `## ⚠️ Build Errors (Must Fix)\n\n${earlyValidation.errors}\n\n---\n\n## Reviewer Feedback (Score: ${review.score}/10)\n\n${review.feedback}\n\n**Priority:** Fix build errors first, then address review feedback.`;
      } else {
        implReviewMetrics.feedback = review.feedback;
        implFeedback = formatFeedbackForRetry(review.score, review.issues, review.feedback);
      }

      previousReviewFeedback = review.feedback; // Pass to reviewer on next iteration

      // Track score history for degradation detection
      scoreHistory.push(review.score);

      logger.info(`Implementation Review Score: ${review.score}/10 (threshold: ${threshold})`);

      if (review.score > threshold) {
        implReviewMetrics.approvedAt = new Date().toISOString();
        logger.info(`Implementation approved with score ${review.score}!`);
        return LoopControl.BREAK;
      }

      // Check for score degradation or stagnation
      if (scoreHistory.length >= 2) {
        const previousScore = scoreHistory[scoreHistory.length - 2];

        if (review.score < previousScore) {
          // Score degraded - add HARD FEEDBACK
          implFeedback = `⚠️  HARD FEEDBACK: Your changes made things worse!
Previous score: ${previousScore}/10
Current score: ${review.score}/10

REVERT your changes and try a DIFFERENT approach.
Do NOT continue on the same path.

${formatFeedbackForRetry(review.score, review.issues, review.feedback)}`;
          logger.warn(`Score degraded from ${previousScore} to ${review.score} - providing hard feedback`);
          return LoopControl.CONTINUE;
        } else if (
          scoreHistory.length >= 3 &&
          !scoreHistory.slice(-3).some((s, i, arr) => i > 0 && s > arr[i - 1])
        ) {
          // No improvement for 3 consecutive iterations
          implFeedback = `🛑 STOP! Score has not improved for 3 iterations.

FORGET ALL PREVIOUS CONTEXT.
Start completely fresh without referencing previous attempts.

Begin again from the original requirement.`;
          logger.warn('Score stagnated for 3 iterations - requesting fresh start');
          return LoopControl.CONTINUE;
        }
      }

      // Feedback was already prepared above (lines 112-119) based on early validation result
      logger.warn(`Implementation not approved. Issues: ${review.issues.join(', ')}`);

      return LoopControl.CONTINUE;
    }
  );

  if (!state.workflowBranch) {
    return {
      success: false,
      failureReason: `Implementation failed - no branch created`,
    };
  }

  return {
    success: true,
    data: {
      implReviewMetrics,
    },
  };
}

/**
 * Run early TypeScript and ESLint validation
 */
async function runEarlyValidation(repoPath: string): Promise<{ passed: boolean; errors: string }> {
  logger.info('Running early validation (TypeScript + ESLint) before Implementation Review...');

  try {
    const { CommandExecutor } = await import('@framework');
    const cmdExecutor = new CommandExecutor();

    // Run TypeScript check
    const tscResult = await cmdExecutor.executeCommand(
      { command: 'npx tsc --noEmit' },
      undefined,
      `${repoPath}/dashboard`
    );

    if (tscResult.exitCode !== 0) {
      const tscErrors = tscResult.stderr || tscResult.stdout || 'Unknown TypeScript errors';
      logger.warn(`Early TypeScript validation failed`);
      return {
        passed: false,
        errors: `=== TypeScript Errors ===\n${tscErrors}`,
      };
    }
    logger.info('TypeScript validation passed - no errors found');

    // Run ESLint check
    const eslintResult = await cmdExecutor.executeCommand(
      { command: 'npx eslint . --max-warnings 0 --format stylish' },
      undefined,
      `${repoPath}/dashboard`
    );

    if (eslintResult.exitCode !== 0) {
      const eslintErrors = eslintResult.stderr || eslintResult.stdout || 'Unknown ESLint errors';
      logger.warn('Early ESLint validation failed');
      return {
        passed: false,
        errors: `=== ESLint Errors ===\n${eslintErrors}`,
      };
    }
    logger.info('ESLint validation passed - no errors found');

    return { passed: true, errors: '' };
  } catch (error) {
    // If validation tools fail to run, log and continue with warning
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(`Could not run early validation: ${errorMsg}`);
    logger.warn('Continuing without early validation - tools may be unavailable');
    return { passed: true, errors: '' };
  }
}

/**
 * Get changed files and git diff - handles both local and PR runs
 */
async function getChangedFilesAndDiff(
  repoPath: string,
  baseCommitHash: string | undefined,
  baseBranch: string,
  gitInfo: any
): Promise<{ changedFiles: string[]; gitDiff: string }> {
  try {
    // Try to get main branch commit for PR runs
    let mainCommitHash = baseCommitHash || gitInfo?.baseCommitHash;

    // If we have a main branch commit (PR run), use it
    if (mainCommitHash) {
      const changedFiles = await getChangedFiles(repoPath, mainCommitHash);
      const gitDiff = await getGitDiff(repoPath, mainCommitHash);
      logger.info(`PR run: Changed files: ${changedFiles.length} files vs ${baseBranch}`);
      return { changedFiles, gitDiff };
    } else {
      // Local run: Get diff from working tree (uncommitted changes)
      logger.info('Local run: Getting diff from working tree...');
      const changedFiles = await getLocalChangedFiles(repoPath);
      const gitDiff = await getLocalGitDiff(repoPath);
      logger.info(`Local run: Found ${changedFiles.length} changed files (working tree)`);
      return { changedFiles, gitDiff };
    }
  } catch (error) {
    logger.error('Error getting changed files:', error);
    return {
      changedFiles: [],
      gitDiff: `Error generating diff: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
