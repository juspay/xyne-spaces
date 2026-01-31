// Bug Workflow definition

import { WorkflowEngine, LoopControl } from '../../workflow-types';
import { WorkflowDefinition } from '../../registry/workflowRegistry';
import { BugWorkflowEvalContext } from '../../types/workflow-enums';
import { WorkflowType } from '../../types/workflow-enums';
import { repoIdMap, commits, BugWorkflowEvalOutput } from './types';
import { getGraphServerUrlForTicket, ensureGraphsLoaded } from './utils';
import { z } from 'zod';
import {logger} from '@/utils/logger';

// Step IDs for bug workflow eval
export enum BugWorkflowEvalSteps {
  SET_UP_GRAPH_SERVER = 'set_up_graph_server',
  PARALLEL_RUNNING = 'Parallel Running',
  COMPARE_CHANGES = 'compare_changes',
}

const set_up_graph_server = async (ticketId: string, commits: commits | undefined) => {
  if (!commits) {
    logger.info('⚠️  No commits found in context, skipping graph server setup.');
    return {
      loadedGraphs: [],
    };
  }

  logger.info(`📊 [BUG_WORKFLOW_EVAL] Setting up graph server with commits:`, commits);

  // Determine which pod to use based on ticket ID
  const graphServerUrl = getGraphServerUrlForTicket(ticketId);
  logger.info(`🎯 Using graph server pod: ${graphServerUrl}`);

  // Use the retry-enabled function that waits 3 minutes on failures
  const success = await ensureGraphsLoaded(graphServerUrl, commits);

  if (success) {
    logger.info(`✅ [BUG_WORKFLOW_EVAL] All required graphs loaded successfully`);
    return {
      loadedGraphs: Object.keys(commits),
    };
  } else {
    logger.error(`❌ [BUG_WORKFLOW_EVAL] Failed to load graphs after retries`);
    return {
      loadedGraphs: [],
    };
  }
};

const compare_changes = async (
  parallelRunsResults: BugWorkflowEvalOutput,
  commits: commits | undefined
) => {
  logger.info('Generating comparison URLs for manual review...');

  if (!parallelRunsResults) {
    logger.info('No parallel run results found, skipping comparison.');
  }

  const comparisonResult: { [key: string]: { [key: string]: string } } = {};

  for (const run in parallelRunsResults) {
    if (Object.prototype.hasOwnProperty.call(parallelRunsResults, run)) {
      const result = (parallelRunsResults as any)[run];

      // Check if workflow returned failure info
      if (result && result.failureInfo) {
        const { step, reason } = result.failureInfo;
        comparisonResult[run] = {
          result: `WORKFLOW_FAILED: ${step}`,
          failure_step: step,
          failure_reason: reason,
        };
        logger.error(`❌ [VALIDATION] ${run}: Failed at ${step} - ${reason}`);
        continue;
      }

      // Check if result has results array
      if (!result || !result.results) {
        comparisonResult[run] = {
          result: 'WORKFLOW_FAILED: Invalid workflow result structure',
          failure_step: 'WORKFLOW_EXECUTION',
          failure_reason: 'Workflow returned invalid result format',
          failure_details: JSON.stringify({ actualResult: result }),
        };
        logger.error(`❌ [VALIDATION] ${run}: Invalid result structure`);
        continue;
      }

      const codeFixResults = result.results;

      if (!Array.isArray(codeFixResults)) {
        comparisonResult[run] = {
          result: 'WORKFLOW_FAILED: Results not in array format',
          failure_step: 'RESULT_FORMAT',
          failure_reason: 'Expected results array, got different format',
          failure_details: JSON.stringify({ resultsType: typeof codeFixResults }),
        };
        logger.error(`❌ [VALIDATION] ${run}: Results not in array format`);
        continue;
      }

      if (codeFixResults.length === 0) {
        comparisonResult[run] = {
          result: 'WORKFLOW_FAILED: No code fixes generated',
          failure_step: 'CODE_GENERATION',
          failure_reason: 'Workflow completed but produced no code fixes',
          failure_details:
            'Check previous steps: RCA analysis, COE analysis, multi-repo analysis, or repository setup',
        };
        logger.error(`❌ [VALIDATION] ${run}: No code fixes generated`);
        continue;
      }

      // Check for failed code fixes within the results
      const failedFixes = codeFixResults.filter(
        (codeFix: any) => !codeFix.success || !codeFix.latestCommit
      );
      if (failedFixes.length > 0) {
        const failureReasons = failedFixes
          .map(
            (fix: any) =>
              `${fix.repository}: ${fix.error || 'Missing commit - coding agent failed to push changes'}`
          )
          .join('; ');

        comparisonResult[run] = {
          result: `WORKFLOW_FAILED: ${failedFixes.length}/${codeFixResults.length} repositories failed`,
          failure_step: 'CODE_IMPLEMENTATION',
          failure_reason: `Failed repositories: ${failureReasons}`,
          failure_details: JSON.stringify({
            total_repos: codeFixResults.length,
            failed_repos: failedFixes.length,
            failures: failedFixes,
          }),
        };
        logger.error(`❌ [VALIDATION] ${run}: Code implementation failures - ${failureReasons}`);
        continue;
      }

      // Successful case - generate PR links
      const repoPrLinks: { [key: string]: string } = {};
      let hasValidPrLinks = false;

      for (const codeFix of codeFixResults) {
        const { repository, latestCommit } = codeFix;
        const repoInfo = repoIdMap[repository as keyof typeof repoIdMap];

        if (!repoInfo) {
          repoPrLinks[repository] =
            `REPO_CONFIG_ERROR: Repository ${repository} not found in repoIdMap`;
          logger.info(
            `❌ [VALIDATION] Repository ${repository} not found in repoIdMap, skipping comparison link generation.`
          );
          continue;
        }

        const { projectId } = repoInfo;
        const sourceCommit = latestCommit;
        const destinationCommit = commits?.[repository as keyof typeof commits];

        if (!sourceCommit || !destinationCommit) {
          repoPrLinks[repository] =
            `COMMIT_ERROR: Missing commit info - source: ${sourceCommit || 'missing'}, destination: ${destinationCommit || 'missing'}`;
          logger.info(
            `❌ [VALIDATION] Missing commit information for ${repository}, source: ${sourceCommit}, destination: ${destinationCommit}`
          );
          continue;
        }

        const pr_link = `https://bitbucket.example.com/projects/${projectId}/repos/${repository}/compare/commits?sourceBranch=${sourceCommit}&targetBranch=${destinationCommit}`;
        repoPrLinks[repository] = pr_link;
        hasValidPrLinks = true;
      }

      if (hasValidPrLinks) {
        comparisonResult[run] = repoPrLinks;
        logger.info(`✅ [VALIDATION] ${run}: Successfully generated PR links`);
      } else {
        comparisonResult[run] = {
          result: 'PR_GENERATION_FAILED: No valid PR links could be generated',
          failure_step: 'PR_LINK_GENERATION',
          failure_reason: 'All repositories had missing commits or configuration errors',
          failure_details: JSON.stringify(repoPrLinks),
        };
        logger.error(`❌ [VALIDATION] ${run}: No valid PR links generated`);
      }
    }
  }

  return {
    comparisonResult,
  };
};

const CommitSchema = z
  .object({
    'euler-api-txns': z.string().optional(),
    'euler-api-customer': z.string().optional(),
    'euler-api-order': z.string().optional(),
    'euler-api-gateway': z.string().optional(),
    'euler-api-cards': z.string().optional(),
    'euler-api-pre-txn': z.string().optional(),
    'euler-api-token': z.string().optional(),
    'euler-api-dashboard': z.string().optional(),
    'offer-engine': z.string().optional(),
  })
  .optional();

const BugWorkflowEvalInputSchema = z.object({
  bugId: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  reportedBy: z.string(),
  merchantId: z.string().optional(),
  assignedTo: z.string().optional(),
  labels: z.array(z.string()).optional(),
  codeFiles: z.array(z.string()).optional(),
  humanReadableId: z.string().optional(),
  pr_url: z.string().optional(),
  commits: CommitSchema,
});

const bugWorkflowEvalContextMapper = (payload: any): BugWorkflowEvalContext => ({
  ticketId: payload.ticketId,
  bugId: payload.bugId,
  title: payload.title,
  description: payload.description,
  severity: payload.severity ,
  reportedBy: payload.reportedBy,
  merchantId: payload.merchantId,
  assignedTo: payload.assignedTo,
  labels: payload.labels,
  codeFiles: payload.codeFiles,
  humanReadableId: payload.humanReadableId,
  pr_url: payload.pr_url,
  commits: payload.commits,
});

export const bugWorkflowEval: WorkflowDefinition<
  BugWorkflowEvalContext,
  void,
  typeof BugWorkflowEvalSteps
> = {
  type: WorkflowType.BUG_WORKFLOW_EVAL,
  name: 'Bug Workflow Eval',
  description:
    'Complete bug resolution workflow including analysis, coding, testing, and deployment with evaluation',
  inputSchema: BugWorkflowEvalInputSchema,
  contextMapper: bugWorkflowEvalContextMapper,

  async execute(engine: WorkflowEngine<BugWorkflowEvalContext, typeof BugWorkflowEvalSteps>) {
    const context = engine.getContext();

    try {
      const { commits } = context;

      const loadedGraphs = await engine.createCheckpoint(
        BugWorkflowEvalSteps.SET_UP_GRAPH_SERVER,
        set_up_graph_server,
        context.ticketId,
        commits
      );
      logger.info('Graphs are loaded. ', loadedGraphs);

      // Validate that graphs were loaded successfully
      if (!loadedGraphs || !loadedGraphs.loadedGraphs || loadedGraphs.loadedGraphs.length === 0) {
        logger.error('❌ [VALIDATION] No graphs were loaded successfully');
        throw new Error(
          'Graph server setup failed - no graphs were loaded. This may indicate repository access issues or graph generation failures.'
        );
      }
      logger.info(`✅ [VALIDATION] Successfully loaded ${loadedGraphs.loadedGraphs.length} graphs`);

      const allFinalResults = await engine.createParallelWorkflows(
        BugWorkflowEvalSteps.PARALLEL_RUNNING,
        {
          workflows: [
            {
              workflowType: WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS as const,
              initialContext: { ...context, runIndex: 0 },
            },
            {
              workflowType: WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS as const,
              initialContext: { ...context, runIndex: 1 },
            },
            {
              workflowType: WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS as const,
              initialContext: { ...context, runIndex: 2 },
            },
            {
              workflowType: WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS as const,
              initialContext: { ...context, runIndex: 3 },
            },
            {
              workflowType: WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS as const,
              initialContext: { ...context, runIndex: 4 },
            },
            {
              workflowType: WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS as const,
              initialContext: { ...context, runIndex: 5 },
            },
            {
              workflowType: WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS as const,
              initialContext: { ...context, runIndex: 6 },
            },
            {
              workflowType: WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS as const,
              initialContext: { ...context, runIndex: 7 },
            },
            {
              workflowType: WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS as const,
              initialContext: { ...context, runIndex: 8 },
            },
            {
              workflowType: WorkflowType.BUG_WORKFLOW_EVAL_INNER_STEPS as const,
              initialContext: { ...context, runIndex: 9 },
            },
          ] as const,
          onExecutionComplete: async (_childResult) => {
            return LoopControl.CONTINUE;
          },
          onAllCompleted: async (allResults) => {
            const sortedResults = [...allResults].sort(
              (a, b) => (a.result?.runIndex ?? -1) - (b.result?.runIndex ?? -1)
            );

            return {
              run1: sortedResults[0]?.result,
              run2: sortedResults[1]?.result,
              run3: sortedResults[2]?.result,
              run4: sortedResults[3]?.result,
              run5: sortedResults[4]?.result,
              run6: sortedResults[5]?.result,
              run7: sortedResults[6]?.result,
              run8: sortedResults[7]?.result,
              run9: sortedResults[8]?.result,
              run10: sortedResults[9]?.result,
            };
          },
        }
      );

      const comparisonResult = await engine.createCheckpoint(
        BugWorkflowEvalSteps.COMPARE_CHANGES,
        compare_changes,
        allFinalResults,
        commits
      );
      logger.info('Changes reviewed and compared. ', comparisonResult);
    } catch (error) {
      logger.error(`❌ [WORKFLOW-DEBUG] Bug workflow eval failed for ${context.ticketId}:`, error);

      let step = 'WORKFLOW_EXCEPTION';
      let reason = `Unexpected workflow error: ${error instanceof Error ? error.message : 'Unknown error'}`;

      if (error instanceof Error) {
        logger.error(`❌ [WORKFLOW-DEBUG] Error message: ${error.message}`);
        logger.error(`❌ [WORKFLOW-DEBUG] Error stack: ${error.stack}`);

        const stack = error.stack || '';

        if (stack.includes('set_up_graph_server') || error.message.includes('Graph server setup')) {
          step = 'GRAPH_SERVER_SETUP';
          reason = error.message;
          logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`);
        } else if (
          stack.includes('createParallelWorkflows') ||
          stack.includes('PARALLEL_RUNNING')
        ) {
          step = 'PARALLEL_WORKFLOWS';
          reason = error.message;
          logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`);
        } else if (stack.includes('compare_changes')) {
          step = 'COMPARE_CHANGES';
          reason = error.message;
          logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`);
        }
      }

      // Store failure info for logging

      // Log the failure summary for debugging/monitoring purposes
      logger.error(`❌ [WORKFLOW-FAILURE-SUMMARY] Step: ${step}, Reason: ${reason}`);

      // Throw the error to ensure the workflow is marked as failed
      throw new Error(`Bug workflow eval failed at step ${step}: ${reason}`);
    }
  },
};
