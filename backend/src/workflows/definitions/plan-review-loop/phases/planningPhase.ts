/**
 * Planning Phase - Handles the planning loop with review
 */

import { WorkflowEngine, AgenticCheckpointResult, LoopControl } from '../../../workflow-types';
import { getPlanningConfig, extractLastMessageContent } from '../../xyne-spaces-workflows/utils';
import {
  XyneSpacesPlanReviewLoopSteps,
  getPlanReviewConfig,
  parseReviewResult,
  formatFeedbackForRetry,
  ReviewMetrics,
} from '../utils';
import { logger } from '@/utils/logger';
import { WorkflowContext, ExecutionState, PhaseResult } from '../types';

interface PlanningPhaseDeps {
  workflow: WorkflowEngine<any, typeof XyneSpacesPlanReviewLoopSteps>;
  context: WorkflowContext;
  state: ExecutionState;
  projectGuidelines: string;
}

export async function runPlanningPhase(
  deps: PlanningPhaseDeps,
  maxIterations: number,
  threshold: number
): Promise<PhaseResult<{ approvedPlan: string; planReviewMetrics: ReviewMetrics['planReview'] }>> {
  const { workflow, context, state, projectGuidelines } = deps;

  logger.info(`Starting Loop 1: Planning with Review (max ${maxIterations} iterations, threshold ${threshold})`);

  let planningFeedback = '';
  let previousReviewFeedback = ''; // Track reviewer's last feedback to pass back to reviewer
  const scoreHistory: number[] = []; // Track score history for degradation detection
  const planReviewMetrics: ReviewMetrics['planReview'] = {
    score: 0,
    feedback: '',
    iterations: 0,
    approvedAt: '',
  };

  await workflow.createWhileLoop(
    XyneSpacesPlanReviewLoopSteps.PLANNING,
    maxIterations,
    async (iteration, scopedEngine) => {
      planReviewMetrics.iterations = iteration + 1;
      logger.info(`Planning iteration ${iteration + 1}/${maxIterations}`);

      // Step 1: Planning
      // On iteration 2+, planningFeedback contains the full revision context
      // (original task, previous plan, reviewer feedback) — use it as the description
      const planDescription = planningFeedback || context.description;
      const planningResult: AgenticCheckpointResult = await scopedEngine.createAgenticCheckpoint(
        XyneSpacesPlanReviewLoopSteps.PLANNING,
        'xyne-planner',
        getPlanningConfig(
          context.title,
          planDescription,
          state.gitInfo.repoUrl,
          context.imageAttachments,
          context.repoBranch,
          context.baseBranch,
          context.checkoutCommit,
          projectGuidelines,
          context.executorType,
          context.useQuestioningMode,
          context.taskType,
          state.coAuthor
        )
      );

      // Capture base commit after planning (for diff calculation later)
      if (!state.baseCommitHash) {
        state.baseCommitHash = planningResult.gitInfo?.baseCommitHash || planningResult.gitInfo?.commitHash;
      }

      // Capture branch for reuse
      if (!state.workflowBranch && planningResult.gitInfo?.branch) {
        state.workflowBranch = planningResult.gitInfo.branch;
      }

      const plan = extractLastMessageContent(planningResult.result);
      state.gitInfo = { ...state.gitInfo, ...planningResult.gitInfo };

      // Step 2: Plan Review
      logger.info('Running Plan Review...');
      const reviewResult: AgenticCheckpointResult = await scopedEngine.createAgenticCheckpoint(
        XyneSpacesPlanReviewLoopSteps.PLAN_REVIEW,
        'xyne-plan-reviewer',
        getPlanReviewConfig(
          context.title,
          context.description,
          context.imageAttachments,
          plan,
          state.gitInfo.repoUrl,
          state.workflowBranch,
          context.baseBranch,
          'xyne-code',
          context.taskType,
          state.coAuthor,
          previousReviewFeedback || undefined
        )
      );

      const review = parseReviewResult(reviewResult.result);
      planReviewMetrics.score = review.score;
      planReviewMetrics.feedback = review.feedback;
      previousReviewFeedback = review.feedback; // Pass to reviewer on next iteration

      // Track score history for degradation detection
      scoreHistory.push(review.score);

      logger.info(`Plan Review Score: ${review.score}/${10} (threshold: ${threshold})`);

      if (review.score > threshold) {
        state.approvedPlan = plan;
        planReviewMetrics.approvedAt = new Date().toISOString();
        logger.info(`Plan approved with score ${review.score}!`);
        return LoopControl.BREAK;
      }

      // Check for score degradation or stagnation
      if (scoreHistory.length >= 2) {
        const previousScore = scoreHistory[scoreHistory.length - 2];

        if (review.score < previousScore) {
          // Score degraded - add HARD FEEDBACK
          planningFeedback = formatFeedbackForRetry(review.score, review.issues,
            `⚠️ HARD FEEDBACK: Your changes made things worse! Previous score: ${previousScore}/10, Current score: ${review.score}/10. REVERT your changes and try a DIFFERENT approach.\n\n${review.feedback}`,
            plan, context.description);
          logger.warn(`Score degraded from ${previousScore} to ${review.score} - providing hard feedback`);
          return LoopControl.CONTINUE;
        } else if (
          scoreHistory.length >= 3 &&
          !scoreHistory.slice(-3).some((s, i, arr) => i > 0 && s > arr[i - 1])
        ) {
          // No improvement for 3 consecutive iterations
          planningFeedback = `🛑 STOP! Score has not improved for 3 iterations.

FORGET ALL PREVIOUS CONTEXT.
Start completely fresh without referencing previous attempts.

Begin again from the original requirement.`;
          logger.warn('Score stagnated for 3 iterations - requesting fresh start');
          return LoopControl.CONTINUE;
        }
      }

      // Prepare feedback for next iteration (structured format with previous plan)
      planningFeedback = formatFeedbackForRetry(review.score, review.issues, review.feedback, plan, context.description);
      logger.warn(`Plan not approved. Issues: ${review.issues.join(', ')}`);
      return LoopControl.CONTINUE;
    }
  );

  if (!state.approvedPlan) {
    return {
      success: false,
      failureReason: `Planning failed after ${planReviewMetrics.iterations} iterations. Last score: ${planReviewMetrics.score}/10`,
    };
  }

  return {
    success: true,
    data: {
      approvedPlan: state.approvedPlan,
      planReviewMetrics,
    },
  };
}
