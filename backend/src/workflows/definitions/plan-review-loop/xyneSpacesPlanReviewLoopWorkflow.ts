/**
 * Xyne Spaces Plan Review Loop Workflow
 *
 * A feature implementation workflow with built-in review loops for both planning
 * and implementation phases. Each phase has an adversarial reviewer that scores
 * the output and provides feedback for iteration.
 *
 * 🚀 Workflow Architecture:
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │ LOOP 1: Planning with Review (max 5 iterations)                               │
 * │   Planner Agent → Plan Review Agent → Score > 7?                              │
 * │        ↑                    ↓ (No)                                             │
 * │        └────────────────────┘                                                  │
 * │                              ↓ (Yes)                                           │
 * │                     Save Plan to File                                          │
 * │                              ↓                                                 │
 * │ LOOP 2: Implementation with Review (max 5 iterations)                         │
 * │   Implementation Agent → Implementation Review Agent → Score > 7?             │
 * │        ↑                         ↓ (No)                                        │
 * │        └─────────────────────────┘                                             │
 * │                                   ↓ (Yes)                                      │
 * │                          Validation                                            │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * @author Xyne Engineering Team
 * @version 1.0.0
 */

import {
  WorkflowEngine,
  GitInfo,
} from '../../workflow-types';
import { WorkflowDefinition, EmptyPreExecuteResult } from '../../registry/workflowRegistry';
import { WorkflowType } from '../../types/workflow-enums';
import * as path from 'path';

import {
  validateRepoUrl,
  loadRootGuidelines,
} from '../xyne-spaces-workflows/utils';
import {
  XyneSpacesPlanReviewLoopSteps,
  savePlanToFile,
  ReviewMetrics,
} from './utils';
import { logger } from '@/utils/logger';
import { commitAllChanges } from '@framework';

import { XyneSpacesPlanReviewLoopInputSchema, xyneSpacesPlanReviewLoopContextMapper } from './schema';
import { XyneSpacesPlanReviewLoopContext, XyneSpacesPlanReviewLoopOutput, WorkflowContext, ExecutionState } from './types';
import { runPlanningPhase, runImplementationPhase, runValidationPhase } from './phases';

// =============================================================================
// WORKFLOW DEFINITION
// =============================================================================

export const xyneSpacesPlanReviewLoopWorkflow: WorkflowDefinition<
  XyneSpacesPlanReviewLoopContext,
  XyneSpacesPlanReviewLoopOutput,
  typeof XyneSpacesPlanReviewLoopSteps
> = {
  type: WorkflowType.XYNE_SPACES_PLAN_REVIEW_LOOP,
  name: 'Xyne Spaces Plan Review Loop',
  description: 'Feature implementation workflow with adversarial review loops for planning and implementation',
  inputSchema: XyneSpacesPlanReviewLoopInputSchema,
  contextMapper: xyneSpacesPlanReviewLoopContextMapper,

  async execute(
    workflow: WorkflowEngine<XyneSpacesPlanReviewLoopContext, typeof XyneSpacesPlanReviewLoopSteps>,
    _preExecuteResult: EmptyPreExecuteResult
  ): Promise<XyneSpacesPlanReviewLoopOutput> {
    const context = workflow.getContext();
    const { ticketId, title, description, imageAttachments } = context;
    const maxIterations = context.maxLoopIterations ?? 5;
    const threshold = context.approvalThreshold ?? 7;

    // =========================================================================
    // INITIALIZE CONTEXT AND STATE
    // =========================================================================

    const repoUrl = "ssh://git@github.com/example-org/xyne-spaces.git";
    const validRepoUrl = validateRepoUrl(repoUrl);

    const workflowContext: WorkflowContext = {
      ticketId,
      title,
      description,
      imageAttachments,
      repoBranch: context.repoBranch,
      baseBranch: context.baseBranch || 'main',
      checkoutCommit: context.checkoutCommit,
      executorType: context.executorType,
      useQuestioningMode: context.useQuestioningMode ?? false,
      taskType: context.taskType ?? 'feature',
      maxIterations,
      approvalThreshold: threshold,
    };

    let executionState: ExecutionState = {
      gitInfo: {
        branch: 'main',
        repoUrl: validRepoUrl,
        hasCommits: false,
      },
      changedFiles: [],
    };

    // Co-author info (would be passed via context.metadata in future)
    let coAuthor: { name: string; email: string } | undefined;
    logger.info('Skipping co-author for this workflow');
    executionState.coAuthor = coAuthor;

    // =========================================================================
    // LOAD GUIDELINES
    // =========================================================================

    const rootPath = path.resolve(process.cwd());
    const projectGuidelines = await loadRootGuidelines(rootPath);

    // Initialize metrics
    let planReviewMetrics: ReviewMetrics['planReview'] = {
      score: 0,
      feedback: '',
      iterations: 0,
      approvedAt: '',
    };
    let implReviewMetrics: ReviewMetrics['implementationReview'] = {
      score: 0,
      feedback: '',
      iterations: 0,
      approvedAt: '',
    };

    const workspaceName = workflow.getWorkflowExecutionId();
    const repoPath = `/tmp/${workspaceName}`;

    // =========================================================================
    // PHASE 1: PLANNING WITH REVIEW
    // =========================================================================

    const planningResult = await runPlanningPhase(
      { workflow, context: workflowContext, state: executionState, projectGuidelines },
      maxIterations,
      threshold
    );

    if (!planningResult.success) {
      logger.error('Planning loop exhausted without approval');
      return buildFailureOutput(ticketId, executionState.gitInfo, planReviewMetrics, implReviewMetrics, planningResult.failureReason);
    }

    planReviewMetrics = planningResult.data!.planReviewMetrics;

    // =========================================================================
    // SAVE PLAN TO FILE
    // =========================================================================

    logger.info('Saving approved plan to file...');
    const planPath = await savePlanToFile(executionState.approvedPlan!, ticketId, title, repoPath);

    // Commit the plan file
    await commitAllChanges(repoPath, `docs: add implementation plan for ${ticketId}`);
    logger.info(`Plan saved to: ${planPath}`);

    // =========================================================================
    // PHASE 2: IMPLEMENTATION WITH REVIEW
    // =========================================================================

    const implementationResult = await runImplementationPhase(
      { workflow, context: workflowContext, state: executionState, projectGuidelines, repoPath },
      maxIterations,
      threshold
    );

    if (!implementationResult.success) {
      logger.error('Implementation loop exhausted without approval');
      return buildFailureOutput(ticketId, executionState.gitInfo, planReviewMetrics, implReviewMetrics, implementationResult.failureReason);
    }

    implReviewMetrics = implementationResult.data!.implReviewMetrics;

    // =========================================================================
    // PHASE 3: VALIDATION
    // =========================================================================

    const validationResult = await runValidationPhase(
      { workflow, context: workflowContext, state: executionState, projectGuidelines, repoPath }
    );

    if (!validationResult.success) {
      logger.error('Validation phase failed');
      return buildFailureOutput(
        ticketId,
        executionState.gitInfo,
        planReviewMetrics,
        implReviewMetrics,
        validationResult.failureReason,
        planPath
      );
    }

    const { validationPassed, gitInfo: finalGitInfo } = validationResult.data!;

    // Add preview configuration for live preview in dashboard
    const previewConfig = finalGitInfo.branch ? {
      type: 'loadUrlWithUserAgent' as const,
      userAgent: finalGitInfo.branch,
      url: 'https://app.spaces.xyne.juspay.net/'
    } : undefined;

    const totalIterations = planReviewMetrics.iterations + implReviewMetrics.iterations;

    return {
      ticketId,
      status: validationPassed ? 'completed' : 'failed',
      planPath,
      implementationDetails: {
        filesChanged: executionState.changedFiles,
        commitHash: finalGitInfo.commitHash,
        branch: finalGitInfo.branch,
        verificationPassed: validationPassed,
        iterationsCompleted: totalIterations,
      },
      reviewMetrics: {
        planReview: planReviewMetrics,
        implementationReview: implReviewMetrics,
      },
      summary: validationPassed
        ? `Feature implementation completed successfully. Plan score: ${planReviewMetrics.score}/10, Implementation score: ${implReviewMetrics.score}/10. Total iterations: ${totalIterations}`
        : `Feature implementation completed but validation encountered issues. Plan score: ${planReviewMetrics.score}/10, Implementation score: ${implReviewMetrics.score}/10`,
      gitInfo: {
        ...finalGitInfo,
        preview: previewConfig
      },
    };
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function buildFailureOutput(
  ticketId: string,
  gitInfo: GitInfo,
  planReviewMetrics: ReviewMetrics['planReview'],
  implReviewMetrics: ReviewMetrics['implementationReview'],
  failureReason?: string,
  planPath?: string
): XyneSpacesPlanReviewLoopOutput {
  return {
    ticketId,
    status: 'failed',
    planPath,
    implementationDetails: {
      filesChanged: [],
      commitHash: gitInfo.commitHash,
      branch: gitInfo.branch,
      verificationPassed: false,
      iterationsCompleted: planReviewMetrics.iterations + implReviewMetrics.iterations,
    },
    reviewMetrics: {
      planReview: planReviewMetrics,
      implementationReview: implReviewMetrics,
    },
    summary: failureReason || 'Workflow failed',
    gitInfo,
    failureReason,
  };
}
