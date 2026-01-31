import { WorkflowEngine, LoopControl } from '../../workflow-types';
import { WorkflowDefinition } from '../../registry/workflowRegistry';
import { WorkflowType, BugWorkflowContext, CoderWorkflowContext } from '../../types/workflow-enums';
import { InvestigationWorkflowParallelOutput } from './types';
import { z } from 'zod';
import {logger} from '@/utils/logger';

// Step IDs for investigation workflow
export enum InvestigationWorkflowSteps {
  START_WORKFLOWS = 'start_workflows',
  PARALLEL_WORKFLOWS = 'parallel_workflows',
  MERGE_RESULTS = 'merge_results',
}

// Merge results from all parallel workflows
const mergeResults = async (parallelResults: InvestigationWorkflowParallelOutput) => {
  logger.info('📊 Merging results from all parallel workflows...');

  const mergedOutput = {
    geniusInvestigation: parallelResults.geniusInvestigation || null,
    bugWorkflow: parallelResults.bugWorkflow || null,
    coderWorkflow: parallelResults.coderWorkflow || null,
    summary: {
      geniusSuccess: parallelResults.geniusInvestigation?.success || false,
      bugWorkflowSuccess: parallelResults.bugWorkflow !== null && parallelResults.bugWorkflow !== undefined,
      coderSuccess: parallelResults.coderWorkflow?.results && Array.isArray(parallelResults.coderWorkflow.results) && parallelResults.coderWorkflow.results.length > 0,
      timestamp: new Date().toISOString()
    }
  };

  logger.info('✅ Results merged successfully:', JSON.stringify(mergedOutput.summary, null, 2));

  return mergedOutput;
}

const InvestigationWorkflowInputSchema = z.object({
  bugId: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  reportedBy: z.string(),
  merchantId: z.string().optional(),
  assignedTo: z.string().optional(),
  labels: z.array(z.string()).optional(),
  codeFiles: z.array(z.string()).optional(),
  humanReadableId: z.string().optional()
})

const investigationWorkflowContextMapper = (payload: any): BugWorkflowContext => ({
  ticketId: payload.ticketId,
  bugId: payload.bugId,
  title: payload.title,
  description: payload.description,
  severity: payload.severity,
  reportedBy: payload.reportedBy,
  merchantId: payload.merchantId,
  assignedTo: payload.assignedTo,
  labels: payload.labels,
  codeFiles: payload.codeFiles,
  humanReadableId: payload.humanReadableId
})

export const investigationWorkflow: WorkflowDefinition<
  BugWorkflowContext,
  any,
  typeof InvestigationWorkflowSteps
> = {
  type: WorkflowType.INVESTIGATION_WORKFLOW,
  name: 'Investigation Workflow',
  description: 'Workflow that performs bug investigation using parallel workflows (Genius Investigation, Bug Workflow, and Coder Workflow)',
  inputSchema: InvestigationWorkflowInputSchema,
  contextMapper: investigationWorkflowContextMapper,

  async execute(
    engine: WorkflowEngine<BugWorkflowContext, typeof InvestigationWorkflowSteps>
  ): Promise<any> {
    const context = engine.getContext();
    const { bugId, title, description } = context;

    try {
      logger.info('🚀 Starting parallel workflows for investigation...');

      // Dummy checkpoint before starting parallel workflows
      await engine.createCheckpoint(
        InvestigationWorkflowSteps.START_WORKFLOWS,
        async () => {
          logger.info('🔄 Starting three workflows: Genius Investigation, Bug Workflow, and Coder Workflow');
          return { message: 'Starting three workflows' };
        }
      );

      // Run Genius Investigation, Bug Workflow, and Coder Workflow in parallel
      const parallelResults = await engine.createParallelWorkflows<
       [
          { workflowType: WorkflowType.GENIUS_INVESTIGATION_WORKFLOW; initialContext: BugWorkflowContext },
          { workflowType: WorkflowType.BUG_WORKFLOW; initialContext: BugWorkflowContext },
          { workflowType: WorkflowType.CODER_WORKFLOW; initialContext: CoderWorkflowContext }
        ],
        InvestigationWorkflowParallelOutput>(
        InvestigationWorkflowSteps.PARALLEL_WORKFLOWS,
        {
          workflows: [
            {
              workflowType: WorkflowType.GENIUS_INVESTIGATION_WORKFLOW as const,
              initialContext: { ...context, merchantId: context.merchantId }
            },
            {
              workflowType: WorkflowType.BUG_WORKFLOW as const,
              initialContext: { ...context }
            },
            {
              workflowType: WorkflowType.CODER_WORKFLOW as const,
              initialContext: {
                ...context,
                userPrompt: description || title,
                product: 'Express Checkout',
                ticketId: bugId
              }
            },
          ] as const,
          onExecutionComplete: async (_childResult) => {
            return LoopControl.CONTINUE;
          },
          onAllCompleted: async (allResults) => {
            return {
              geniusInvestigation: allResults[0]?.result || null,
              bugWorkflow: allResults[1]?.result || null,
              coderWorkflow: allResults[2]?.result || null,
            };
          }
        }
      );

      logger.info('✅ All parallel workflows completed');

      // Merge and consolidate results
      const mergedResults = await engine.createCheckpoint(
        InvestigationWorkflowSteps.MERGE_RESULTS,
        mergeResults,
        parallelResults
      );

      logger.info('✅ Investigation workflow completed with merged results');

      return mergedResults;
    } catch (error) {
      // Re-throw WorkflowExternalWaitException - this is expected behavior for parallel workflows
      if (error instanceof Error && error.name === 'WorkflowExternalWaitException') {
        throw error;
      }

      logger.error(`❌ Investigation workflow failed for ${bugId}:`, error);

      // Return error information
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
  },
};
