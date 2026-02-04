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
} from '../../workflow-types';
import { WorkflowDefinition, EmptyPreExecuteResult } from '../../registry/workflowRegistry';
import { WorkflowType, ImageAttachment } from '../../types/workflow-enums';
import { z } from 'zod';
import * as path from 'path';

import {
  extractLastMessageContent,
  validateRepoUrl,
  XyneSpacesWorkflowSteps,
  getPlanningConfig,
  getImplementationConfig,
  getValidationConfig,
  loadRootGuidelines,
} from './utils';
import { runDeterministicValidation } from './validation-helpers';
import {logger} from '@/utils/logger';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface XyneSpacesFeatureContext extends BaseWorkflowContext {
  ticketId: string;
  title: string;
  description: string;
  baseBranch?: string;
  repoBranch?: string;
  checkoutCommit?: string;
  imageAttachments?: ImageAttachment[];
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

const XyneSpacesFeatureInputSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  ticketId: z.string().min(1, 'Ticket ID is required'),
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
  payload: z.infer<typeof XyneSpacesFeatureInputSchema> & { ticketId: string ; title: string; description: string; baseBranch?: string; repoBranch?: string; checkoutCommit?: string; imageAttachments?: ImageAttachment[] }
): XyneSpacesFeatureContext => ({
  ticketId: payload.ticketId,
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
    // LOAD GUIDELINES
    // =========================================================================

    const rootPath = path.resolve(process.cwd());
    const projectGuidelines = await loadRootGuidelines(rootPath);


    // =========================================================================
    // PHASE 1: PLANNING WITH GUIDELINES
    // =========================================================================

    logger.info('Starting planning phase with guidelines context...');
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
        projectGuidelines
      )
    );

    const implementationPlan = extractLastMessageContent(planningResult.result);
    gitInfo = { ...gitInfo, ...planningResult.gitInfo };

    // Get the branch created by planning step to reuse in implementation
    const workflowBranch = planningResult.gitInfo?.branch;

    logger.info('Planning phase completed. Starting implementation...');
    logger.info(`Using branch from planning: ${workflowBranch}`);

    // =========================================================================
    // PHASE 2: IMPLEMENTATION
    // =========================================================================

    const implementationResult: AgenticCheckpointResult = await workflow.createAgenticCheckpoint(
      XyneSpacesWorkflowSteps.IMPLEMENTATION,
      'xyne-cli-implementer',
      getImplementationConfig(
        implementationPlan,
        validRepoUrl,
        workflowBranch,  // Pass the branch from planning step so implementation continues on same branch
        context.baseBranch || 'main', // baseBranch
        context.checkoutCommit,
        projectGuidelines
      )
    );

    gitInfo = { ...gitInfo, ...implementationResult.gitInfo };

    logger.info('Implementation completed successfully');

    // =========================================================================
    // PHASE 3: VALIDATION PHASE
    // =========================================================================

    const workspaceName = workflow.getWorkflowExecutionId();
    const repoPath = `/tmp/${workspaceName}`;
    const deterministicResult = await runDeterministicValidation(repoPath, gitInfo);
    
    if (deterministicResult.formatCommitHash) {
      gitInfo = { ...gitInfo, commitHash: deterministicResult.formatCommitHash };
    }

    let validationPassed = deterministicResult.passed;

    if (!validationPassed) {
      logger.warn('Validation failed with errors, starting agentic error fixing...');

      const validationErrors = deterministicResult.errorLines.length > 0 
        ? deterministicResult.errorLines.join('\n')
        : deterministicResult.validationOutput.stderr || deterministicResult.validationOutput.stdout || '';

      const validationConfig = getValidationConfig(
        validationErrors,
        workspaceName,
        validRepoUrl,
        gitInfo.branch,
        context.baseBranch || 'main',
        context.checkoutCommit,
        projectGuidelines
      );

      const validationResult: AgenticCheckpointResult = await workflow.createAgenticCheckpoint(
        XyneSpacesWorkflowSteps.VALIDATION,
        'xyne-cli-validator',
        validationConfig
      );

      gitInfo = { ...gitInfo, ...validationResult.gitInfo };

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

    // Add preview configuration for live preview in dashboard
    const previewConfig = gitInfo.branch ? {
      type: 'loadUrlWithUserAgent' as const,
      userAgent: gitInfo.branch,
      url: 'https://app.spaces.xyne.juspay.net/'
    } : undefined;

    return {
      ticketId,
      status: validationPassed ? 'completed' : 'failed' as const,
      implementationDetails: {
        filesChanged: [],
        commitHash: gitInfo.commitHash,
        branch: gitInfo.branch,
        verificationPassed: validationPassed,
        iterationsCompleted: 1,
      },
      summary: validationPassed
        ? 'Feature implementation completed and validated successfully'
        : 'Feature implementation completed but validation encountered issues',
      gitInfo: {
        ...gitInfo,
        preview: previewConfig
      },
    };
  },
};