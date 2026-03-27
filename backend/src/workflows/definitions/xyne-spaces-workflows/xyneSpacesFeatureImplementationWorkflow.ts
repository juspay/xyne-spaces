/**
 * Xyne Spaces Feature Implementation Workflow
 *
 * A guideline-aware fullstack feature implementation workflow for the Xyne Spaces platform.
 * This workflow creates a comprehensive plan with full context, then implements it precisely.
 *
 * 🚀 Workflow Architecture:
 * ┌─────────────────────────────────────────────────────────────────────────────────┐
 * │ Phase 1: Planning with Guidelines → Create comprehensive implementation plan   │
 * │           - Load frontend & backend guidelines                                  │
 * │           - Analyze requirement with full codebase context                      │
 * │           - Create detailed plan following all conventions                      │
 * │                                                                                 │
 * │ Phase 2: Implementation → Execute the plan precisely                           │
 * │           - Follow plan and guidelines strictly                                 │
 * │           - Create/modify files at correct paths                                │
 * │           - Make atomic commits with clear messages                             │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ✨ Key Features:
 * - Guideline-aware planning (frontend + backend guidelines loaded)
 * - Context-rich implementation (codebase patterns understood)
 * - Type-safe with comprehensive error handling
 * - Git integration with branch and commit tracking
 * - Production-ready code following established patterns
 *
 * @author Xyne Engineering Team
 * @version 2.0.0
 */

import {
  WorkflowEngine,
  BaseWorkflowContext,
  AgenticCheckpointResult,
  GitInfo,
  LoopControl,
} from '../../workflow-types';
import { WorkflowDefinition, EmptyPreExecuteResult } from '../../registry/workflowRegistry';
import { WorkflowType, ImageAttachment } from '../../types/workflow-enums';
import { BaseWorkflowContextSchema, baseContextMapper } from '../../schemas/workflow-schema';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs/promises';

import {
  extractLastMessageContent,
  validateRepoUrl,
  XyneSpacesWorkflowSteps,
  getPlanningConfig,
  getImplementationConfig,
  getReviewConfig,
  parseReviewComments,
  loadRootGuidelines,
  getValidationConfig,
  getImplementationPrompt,
  formatReviewFeedback,
  filterReviewCommentsBySeverity,
  getTestFixConfig,
} from './utils';
import { runDeterministicValidation, getGitDiffForReview, runTestCases, commitPostTestChanges, findScreenshotDirectory, copyScreenshotsToTempDir, uploadScreenshotsToGCS, uploadTestReportsToGCS, type TestExecutionResult } from '../validation-helpers';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface XyneSpacesFeatureContext extends BaseWorkflowContext {
  title: string;
  description: string;
  baseBranch?: string;
  repoBranch?: string;
  checkoutCommit?: string;
  imageAttachments?: ImageAttachment[];
  taskType?: 'feature' | 'bug' | 'refactor' | 'performance' | 'security' | 'documentation';
}

export interface XyneSpacesFeatureOutput {
  ticketId: string;
  status: 'completed' | 'failed';
  implementationDetails: {
    filesChanged: string[];
    commitHash?: string;
    branch: string;
    verificationPassed: boolean;
    iterationsCompleted: number;
  };
  summary: string;
  gitInfo: GitInfo;
}

// =============================================================================
// WORKFLOW IMPLEMENTATION
// =============================================================================

const XyneSpacesFeatureInputSchema = BaseWorkflowContextSchema.extend({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  baseBranch: z.string().optional(),
  repoBranch: z.string().optional(),
  checkoutCommit: z.string().optional(),
  imageAttachments: z.array(z.object({
    id: z.string(),
    type: z.literal('image'),
    data: z.string(),
    mimeType: z.string(),
    name: z.string(),
  })).optional(),
});

const xyneSpacesFeatureContextMapper = (
  payload: z.infer<typeof XyneSpacesFeatureInputSchema> & { ticketId: string; title: string; description: string; baseBranch?: string; repoBranch?: string; checkoutCommit?: string; imageAttachments?: ImageAttachment[] }
): XyneSpacesFeatureContext => ({
  ...baseContextMapper(payload),
  title: payload.title,
  description: payload.description,
  baseBranch: payload.baseBranch,
  repoBranch: payload.repoBranch,
  checkoutCommit: payload.checkoutCommit,
  imageAttachments: payload.imageAttachments,
});

export const xyneSpacesFeatureImplementationWorkflow: WorkflowDefinition<
  XyneSpacesFeatureContext,
  XyneSpacesFeatureOutput,
  typeof XyneSpacesWorkflowSteps
> = {
  type: WorkflowType.XYNE_SPACES_FEATURE_IMPLEMENTATION,
  name: 'Xyne Spaces Feature Implementation',
  description: 'Comprehensive fullstack feature implementation workflow for Xyne Spaces platform',
  inputSchema: XyneSpacesFeatureInputSchema,
  contextMapper: xyneSpacesFeatureContextMapper,

  async execute(
    workflow: WorkflowEngine<XyneSpacesFeatureContext, typeof XyneSpacesWorkflowSteps>,
    _preExecuteResult: EmptyPreExecuteResult
  ): Promise<XyneSpacesFeatureOutput> {
    const context = workflow.getContext();
    const { ticketId, title, description, imageAttachments } = context;

    const repoUrl = "ssh://git@github.com/example-org/xyne-spaces.git";

    const validRepoUrl = validateRepoUrl(repoUrl);
    let gitInfo: GitInfo = {
      branch: 'main',
      repoUrl: validRepoUrl,
      hasCommits: false,
    };

    // =========================================================================
    // LOAD USER INFO FOR CO-AUTHOR
    // =========================================================================

    let coAuthor: { name: string; email: string } | undefined;
    const executionId = workflow.getWorkflowExecutionId();
    const execution = await repositories.workflowExecutions.findById(executionId);
    const createdBy = execution?.createdBy;
    if (createdBy) {
      const user = await repositories.users.findById(createdBy);
      if (user) {
        coAuthor = { name: user.name, email: user.email };
        logger.info(`Found co-author info for user ${createdBy}`);
      } else {
        logger.warn(`User ${createdBy} not found, commits will not have co-author`);
      }
    }

    // =========================================================================
    // LOAD GUIDELINES
    // =========================================================================

    const rootPath = path.resolve(process.cwd());
    const projectGuidelines = await loadRootGuidelines(rootPath);


    // =========================================================================
    // PHASE 1: PLANNING WITH GUIDELINES
    // =========================================================================

    const questioningMode = context.useQuestioningMode ?? false;
    logger.info(`Starting planning phase with guidelines context... useQuestioningMode=${questioningMode}, executorType=${context.executorType}`);
    const planningResult: AgenticCheckpointResult = await workflow.createAgenticCheckpoint(
      XyneSpacesWorkflowSteps.PLANNING,
      'xyne-cli-planner',
      getPlanningConfig(
        title,
        description,
        validRepoUrl,
        imageAttachments,
        context.repoBranch || undefined, // repoBranch
        context.baseBranch || 'main',     // baseBranch
        context.checkoutCommit,
        projectGuidelines,
        context.executorType,
        questioningMode,
        context.taskType,
        coAuthor
      )
    );

    const implementationPlan = extractLastMessageContent(planningResult.result);
    gitInfo = { ...gitInfo, ...planningResult.gitInfo };

    // Get the branch created by planning step to reuse in implementation
    const workflowBranch = planningResult.gitInfo?.branch;

    // Log the implementation plan for debugging
    logger.info('Planning phase completed. Starting implementation...');
    logger.info(`Using branch from planning: ${workflowBranch}`);
    logger.info(`Implementation plan length: ${implementationPlan.length} characters`);
    if (implementationPlan.length < 500) {
      logger.warn(`⚠️ WARNING: Implementation plan is very short (${implementationPlan.length} chars)!`);
      logger.warn(`Plan content: ${implementationPlan}`);
    } else {
      logger.info(`Plan preview: ${implementationPlan.substring(0, 300)}...`);
    }

    // =========================================================================
    // PHASE 2: IMPLEMENTATION AND REVIEW LOOP
    // =========================================================================

    const MAX_ITERATIONS = 5;
    let reviewComments: Record<string, unknown>[] = [];
    let previousFeedbackContext = '';
    let iterationsCompleted = 0;

    const workspaceName = workflow.getWorkflowExecutionId();
    const repoPath = `/tmp/${workspaceName}`;
    const baseCommit = context.checkoutCommit || (context.baseBranch || 'main');

    // Implementation loop: handles review feedback only
    await workflow.createWhileLoop(
      XyneSpacesWorkflowSteps.IMPLEMENTATION_LOOP,
      MAX_ITERATIONS,
      async (iteration, scopedEngine) => {
        iterationsCompleted = iteration + 1;
        logger.info(`🔄 Starting implementation iteration ${iterationsCompleted}/${MAX_ITERATIONS}`);

        const implementationPrompt = getImplementationPrompt(implementationPlan, previousFeedbackContext || undefined);

        const agentConfig = getImplementationConfig(
          implementationPrompt,
          validRepoUrl,
          workflowBranch,
          context.baseBranch || 'main',
          context.checkoutCommit,
          projectGuidelines,
          context.executorType,
          false,
          context.taskType,
          coAuthor
        );

        const implementationResult: AgenticCheckpointResult = await scopedEngine.createAgenticCheckpoint(
          XyneSpacesWorkflowSteps.IMPLEMENTATION,
          'xyne-cli-implementer',
          agentConfig
        );

        gitInfo = { ...gitInfo, ...implementationResult.gitInfo };
        logger.info(`Implementation iteration ${iterationsCompleted} completed`);

        // =========================================================================
        // GIT DIFF GATHERING PHASE (Deterministic - visible in frontend)
        // =========================================================================
        const diffResult = await scopedEngine.createCheckpoint(
          XyneSpacesWorkflowSteps.GIT_DIFF_GATHERING,
          async () => {
            logger.info(`[Review] Getting diff from base commit: ${baseCommit}`);
            const result = await getGitDiffForReview(repoPath, baseCommit);

            if (!result.success) {
              logger.error('Failed to get git diff for review:', result.error);
            } else {
              logger.info(`Got git diff for review: ${result.changedFiles.length} files, ${result.diffOutput.length} chars`);
            }

            return result;
          }
        );

        // =========================================================================
        // CODE REVIEW PHASE (Agentic)
        // =========================================================================

        logger.info('Starting code review phase...');

        const reviewResult: AgenticCheckpointResult = await scopedEngine.createAgenticCheckpoint(
          XyneSpacesWorkflowSteps.REVIEW,
          'xyne-cli-reviewer',
          getReviewConfig(
            validRepoUrl,
            gitInfo.branch,
            context.baseBranch || 'main',
            context.checkoutCommit,
            projectGuidelines,
            context.executorType,
            diffResult.changedFiles,
            diffResult.diffOutput
          )
        );

        gitInfo = { ...gitInfo, ...reviewResult.gitInfo };

        // Parse review comments from the result
        const allReviewComments = parseReviewComments(reviewResult.result);

        // Filter by severity: keep error, warning, high, medium; ignore info, low, suggestion, nit
        reviewComments = filterReviewCommentsBySeverity(allReviewComments);

        logger.info(`Review: ${allReviewComments.length} total comments, ${reviewComments.length} after severity filter`);

        if (reviewComments.length === 0) {
          logger.info('✅ Code review passed! No issues found.');
          return LoopControl.BREAK;
        }

        // Format review comments for the next iteration
        previousFeedbackContext = formatReviewFeedback(reviewComments);

        logger.warn(`⚠️ Code review found ${reviewComments.length} issues.`);
        logger.info(`Review comments:\n${JSON.stringify(reviewComments, null, 2)}`);

        return LoopControl.CONTINUE;
      }
    );

    // =========================================================================
    // PHASE 3: VALIDATION PHASE
    // =========================================================================

    logger.info('Starting deterministic validation phase...');

    let validationPassed = false;
    const deterministicResult = await workflow.createCheckpoint(
      XyneSpacesWorkflowSteps.DETERMINISTIC_VALIDATION,
      async () => {
        return await runDeterministicValidation(repoPath, gitInfo, coAuthor);
      }
    );

    if (deterministicResult.formatCommitHash) {
      gitInfo = { ...gitInfo, commitHash: deterministicResult.formatCommitHash };
    }

    validationPassed = deterministicResult.passed ?? false;

    if (!validationPassed) {
      logger.warn('Validation failed with errors, starting agentic error fixing...');

      const validationErrors = deterministicResult.errorLines?.length
        ? deterministicResult.errorLines!.join('\n')
        : deterministicResult.validationOutput?.stderr || deterministicResult.validationOutput?.stdout || '';

      logger.warn(`Validation failed with errors. Running validation fixer...`);

      const validationConfig = getValidationConfig(
        validationErrors,
        workspaceName,
        validRepoUrl,
        gitInfo.branch,
        context.baseBranch || 'main',
        context.checkoutCommit,
        projectGuidelines,
        context.executorType,
        false,
        coAuthor
      );

      const validationResult: AgenticCheckpointResult = await workflow.createAgenticCheckpoint(
        XyneSpacesWorkflowSteps.VALIDATION,
        'xyne-cli-validator',
        validationConfig
      );

      gitInfo = { ...gitInfo, ...validationResult.gitInfo };
      logger.info('Validation fixer completed');
    } else {
      logger.info('✅ Validation passed!');
    }

    // =========================================================================
    // PHASE 4: TEST EXECUTION (3 steps: test → fix → commit)
    // =========================================================================

    let testsPassed = false;
    let testIterationsCompleted = 0;
    let currentTestFailures = '';

    logger.info('Starting test execution phase...');

    // Test execution loop: run tests → if failed, fix with LLM → retry (max 3)
    await workflow.createWhileLoop(
      XyneSpacesWorkflowSteps.AUTOMATION_TEST_EXECUTION,
      3,
      async (iteration: number, scopedEngine: typeof workflow) => {
        testIterationsCompleted = iteration + 1;
        logger.info(`🔄 Test execution iteration ${testIterationsCompleted}/3`);

        // Step 1: Automation Test Execution
        const testResult: TestExecutionResult = await scopedEngine.createCheckpoint(
          XyneSpacesWorkflowSteps.AUTOMATION_TEST_EXECUTION,
          async () => runTestCases(repoPath)
        );

        if (testResult.passed) {
          logger.info('✅ All tests passed!');
          testsPassed = true;
          return LoopControl.BREAK;
        }

        // Tests failed
        logger.warn(`⚠️ Tests failed on iteration ${testIterationsCompleted}. Fixing with LLM...`);
        currentTestFailures = testResult.failureDetails.length > 0
          ? testResult.failureDetails
          : testResult.testOutput;

        // Step 2: Test Fix with LLM
        const fixResult: AgenticCheckpointResult = await scopedEngine.createAgenticCheckpoint(
          XyneSpacesWorkflowSteps.AUTOMATION_TEST_FIX,
          'xyne-cli-test-fixer',
          getTestFixConfig(
            currentTestFailures,
            validRepoUrl,
            gitInfo,
            context.baseBranch || 'main',
            context.checkoutCommit,
            projectGuidelines,
            context.executorType,
            coAuthor
          )
        );

        gitInfo = { ...gitInfo, ...fixResult.gitInfo };

        // Loop back to Step 1 for re-test
        return LoopControl.CONTINUE;
      }
    );

    // Step 3: Commit Changes (if any exist after test fixes)
    const postTestCommitResult = await workflow.createCheckpoint(
      XyneSpacesWorkflowSteps.POST_AUTOMATION_COMMIT,
      async () => commitPostTestChanges(repoPath, gitInfo, coAuthor)
    );

    if (postTestCommitResult.commitHash) {
      gitInfo = { ...gitInfo, commitHash: postTestCommitResult.commitHash };
    }

    // =========================================================================
    // PHASE 5: COPY FEATURE SCREENSHOTS TO TEMP DIR
    // =========================================================================

    const currDir = `/tmp/${executionId}-vr-curr`;

    await workflow.createCheckpoint(
      XyneSpacesWorkflowSteps.STORE_FEATURE_SCREENSHOTS,
      async () => {
        logger.info('[VR] Phase 5: Copying feature branch screenshots to temp dir...');

        const screenshotsDir = findScreenshotDirectory(repoPath);
        if (!screenshotsDir) {
          logger.warn('[VR] No screenshots found after feature branch tests');
          return { screenshotCount: 0 };
        }

        // Copy to temp dir
        const count = await copyScreenshotsToTempDir(screenshotsDir, currDir);

        logger.info(`[VR] Phase 5 complete: ${count} feature screenshots saved to temp dir`);
        return { screenshotCount: count };
      }
    );

    // =========================================================================
    // PHASE 6: UPLOAD TEST ARTIFACTS TO GCS FOR PREVIEW CHANGES TAB
    // =========================================================================

    await workflow.createCheckpoint(
      XyneSpacesWorkflowSteps.UPLOAD_TO_GCS,
      async () => {
        logger.info('[VR] Phase 6: Uploading test artifacts to GCS...');

        // Upload screenshots from temp dir to GCS
        const screenshotCount = await uploadScreenshotsToGCS(
          currDir,
          `workflow-artifacts/${executionId}/screenshots/`,
          executionId
        );

        // Also upload any available test reports
        const reportDir = path.join(repoPath, 'xyne-automation', 'report');
        const reportCount = await uploadTestReportsToGCS(reportDir, executionId);

        logger.info(`[VR] Phase 6 complete: ${screenshotCount} screenshots, ${reportCount} reports uploaded`);

        // Cleanup temp dir
        await fs.rm(currDir, { recursive: true, force: true }).catch(() => {});

        return { screenshotCount, reportCount };
      }
    );

    // =========================================================================
    // FINAL STATUS
    // =========================================================================

    const overallPassed = validationPassed && testsPassed && reviewComments.length === 0;

    if (iterationsCompleted >= MAX_ITERATIONS && !overallPassed) {
      logger.warn(`Max iterations (${MAX_ITERATIONS}) reached. Some issues may still be unresolved.`);
    }

    // Add preview configuration for live preview in dashboard
    const previewConfig = gitInfo.branch ? {
      type: 'loadUrlWithUserAgent' as const,
      userAgent: gitInfo.branch,
      url: 'https://app.spaces.xyne.juspay.net/'
    } : undefined;

    return {
      ticketId,
      status: overallPassed ? 'completed' : 'failed' as const,
      implementationDetails: {
        filesChanged: [],
        commitHash: gitInfo.commitHash,
        branch: gitInfo.branch,
        verificationPassed: overallPassed,
        iterationsCompleted,
      },
      summary: overallPassed
        ? `Feature implementation completed, validated, and all tests passed after ${iterationsCompleted} iteration(s)`
        : testsPassed
          ? `Feature implementation completed but validation encountered issues after ${iterationsCompleted} iteration(s)`
          : `Feature implementation completed but test cases are failing after ${testIterationsCompleted} iteration(s)`,
      gitInfo: {
        ...gitInfo,
        preview: previewConfig
      },
    };
  },
};

