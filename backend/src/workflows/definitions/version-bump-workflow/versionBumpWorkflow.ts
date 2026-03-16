import { 
  WorkflowEngine, 
} from '../../workflow-types';
import { WorkflowDefinition } from '../../registry/workflowRegistry';
import { WorkflowType } from '../../types/workflow-enums';
import { BaseWorkflowContextSchema } from '../../schemas/workflow-schema';
import { z } from 'zod';
import { logger } from '@/utils/logger';

import {
  VersionBumpWorkflowContext,
  VersionBumpWorkflowOutput,
  VersionBumpStepsEnum,
  VersionBumpStepsEnumType,
  VersionBumpResult,
  JiraTicketResult,
} from './types';

import {
  REPOSITORY_URL_MAP,
  createJiraTicket,
  cloneAndCheckoutStaging,
  createBranch,
  updateFlakeNix,
  updateFlakeLock,
  commitAndPush,
  raisePullRequest,
} from './utils';
import * as path from 'path';
import * as fs from 'fs';

// =============================================================================
// WORKFLOW IMPLEMENTATION
// =============================================================================

const versionBumpInputSchema = BaseWorkflowContextSchema.extend({
  repositoryNames: z.array(z.enum([
    'euler-api-cards',
    'euler-api-txns',
    'euler-api-order',
    'euler-api-gateway',
    'euler-api-token',
    'euler-api-pre-txn',
    'euler-api-customer',
    'euler-api-dashboard'
  ])),
  dependencyName: z.string(),
  version: z.string(),
  email: z.string(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

const VersionBumpContextMapper = (
  payload: z.infer<typeof versionBumpInputSchema> & { ticketId: string }
): VersionBumpWorkflowContext => {
  return {
    ...payload,
  };
};

export const versionBumpWorkflow: WorkflowDefinition<
  VersionBumpWorkflowContext,
  VersionBumpWorkflowOutput,
  VersionBumpStepsEnumType
> = {
  type: WorkflowType.VERSION_BUMP_WORKFLOW,
  name: 'Multi-Repository Version Bump',
  description: 'Triggers version bump across multiple repositories',
  category: 'Infrastructure',
  experimental: true,
  tags: ['bump', 'version', 'nix', 'flake', 'jira'],
  inputSchema: versionBumpInputSchema,
  contextMapper: VersionBumpContextMapper,

  async execute(
    workflow: WorkflowEngine<VersionBumpWorkflowContext, VersionBumpStepsEnumType>
  ): Promise<VersionBumpWorkflowOutput> {
    const context = workflow.getContext();
    const { repositoryNames, dependencyName, version, email } = context;

    logger.info(`Starting Parallel Version Bump Workflow for dependency ${dependencyName} -> ${version}`);

    // Validate inputs
    if (!repositoryNames || repositoryNames.length === 0) {
      throw new Error('No repository names provided for version bump workflow');
    }
    if (!dependencyName || !version) {
      throw new Error('Dependency name and version are required');
    }

    // STEP: Parallel Execution of Version Bumps
    logger.info(`Starting parallel version bumps for: ${repositoryNames.join(', ')}`);

    const results: VersionBumpResult[] = await Promise.all(
      repositoryNames.map(async (repoName) => {
        logger.info(`[versionBumpWorkflow] Starting bump for repo: ${repoName}`);

        const repoUrl = REPOSITORY_URL_MAP[repoName];
        if (!repoUrl) {
          return {
            success: false,
            repositoryUrl: '',
            error: `Unmapped repository name: ${repoName}`
          };
        }

        const repoNameMatch = repoUrl.match(/[/:]+([^/]+)\.git$/) || repoUrl.match(/[/]+([^/]+)$/);
        const repoBaseName = repoNameMatch ? repoNameMatch[1] : `repo-${repoName}`;
        const workingDirectory = path.join('/tmp', `version-bump-${repoBaseName}-${Date.now()}-${Math.floor(Math.random() * 1000)}`);

        try {
          // 1. Create JIRA Ticket
          const jiraResult = await workflow.createCheckpoint<JiraTicketResult, [string, string, string, string]>(
            VersionBumpStepsEnum(repoName).CREATE_JIRA_TICKET,
            createJiraTicket,
            dependencyName,
            version,
            email,
            repoName
          );
          if (!jiraResult.success) {
            throw new Error(`Failed to create JIRA ticket: ${jiraResult.error}`);
          }
          const jiraTicketId = jiraResult.ticketId;

          // 2. Clone and checkout
          const cloneResult = await workflow.createCheckpoint<{ success: boolean; error?: string }, [string, string]>(
            VersionBumpStepsEnum(repoName).CLONE_AND_CHECKOUT,
            cloneAndCheckoutStaging,
            repoUrl,
            workingDirectory
          );
          if (!cloneResult.success) {
            throw new Error(`Failed to clone and checkout: ${cloneResult.error}`);
          }

          // 3. Create Branch
          const branchResult = await workflow.createCheckpoint<{ success: boolean; branchName: string; error?: string }, [string, string, string, string]>(
            VersionBumpStepsEnum(repoName).CREATE_BRANCH,
            createBranch,
            workingDirectory,
            jiraTicketId,
            dependencyName,
            version
          );
          if (!branchResult.success) {
            throw new Error(`Failed to create branch: ${branchResult.error}`);
          }
          const branchName = branchResult.branchName;

          // 4. Update flake.nix
          const updateResult = await workflow.createCheckpoint<{ success: boolean; error?: string }, [string, string, string]>(
            VersionBumpStepsEnum(repoName).UPDATE_FLAKE_NIX,
            updateFlakeNix,
            workingDirectory,
            dependencyName,
            version
          );
          if (!updateResult.success) {
            throw new Error(`Failed to update flake.nix: ${updateResult.error}`);
          }

          // 5. Update flake.lock
          const lockResult = await workflow.createCheckpoint<{ success: boolean; error?: string }, [string, string]>(
            VersionBumpStepsEnum(repoName).UPDATE_FLAKE_LOCK,
            updateFlakeLock,
            workingDirectory,
            dependencyName
          );
          if (!lockResult.success) {
            throw new Error(`Failed to update flake.lock: ${lockResult.error}`);
          }

          // 6. Commit and Push
          const pushResult = await workflow.createCheckpoint<{ success: boolean; error?: string }, [string, string, string, string, string]>(
            VersionBumpStepsEnum(repoName).COMMIT_AND_PUSH,
            commitAndPush,
            workingDirectory,
            branchName,
            jiraTicketId,
            dependencyName,
            version
          );
          if (!pushResult.success) {
            throw new Error(`Failed to commit and push: ${pushResult.error}`);
          }

          // 7. Raise PR
          const prResult = await workflow.createCheckpoint<{ success: boolean; prUrl?: string; error?: string }, [string, string, string, string, string, string, string]>(
            VersionBumpStepsEnum(repoName).RAISE_PR,
            raisePullRequest,
            workflow.getWorkflowExecutionId(),
            repoUrl,
            branchName,
            jiraTicketId,
            dependencyName,
            version,
            email
          );

          if (!prResult.success) {
            throw new Error(`Failed to raise PR: ${prResult.error}`);
          }

          return {
            success: true,
            repositoryUrl: repoUrl,
            branchName: branchName,
            jiraTicket: jiraTicketId,
            prUrl: prResult.prUrl
          };
        } catch (error: any) {
          logger.error(`[versionBumpWorkflow] Error for ${repoName}: ${error.message}`);
          return {
            success: false,
            repositoryUrl: repoUrl,
            error: error.message
          };
        } finally {
          if (fs.existsSync(workingDirectory)) {
            try {
              fs.rmSync(workingDirectory, { recursive: true, force: true });
              logger.info(`[versionBumpWorkflow] Cleaned up ${workingDirectory}`);
            } catch (cleanupErr: any) {
              logger.warn(`[versionBumpWorkflow] Failed to cleanup ${workingDirectory}: ${cleanupErr.message}`);
            }
          }
        }
      })
    );

    const successfulResults = results.filter((r: VersionBumpResult) => r.success);
    const failedResults = results.filter((r: VersionBumpResult) => !r.success);

    logger.info(`Workflow finished: Processed ${repositoryNames.length} repositories. Success: ${successfulResults.length}, Failed: ${failedResults.length}.`);

    return {
      status: failedResults.length === 0 ? 'completed' : (successfulResults.length > 0 ? 'partial_failure' : 'failed'),
      results,
      summary: `Processed ${repositoryNames.length} repositories. Success: ${successfulResults.length}, Failed: ${failedResults.length}.`
    };
  }
};
