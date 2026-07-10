import { WorkflowEngine } from '../../workflow-types';
import { WorkflowDefinition } from '../../registry/workflowRegistry';
import { WorkflowType, BugWorkflowContext } from '../../types/workflow-enums';
import { MerchantTokenResult, GeniusInvestigationResult } from './types';
import { z } from 'zod';
import { config } from '@/config/env';
import {logger} from '@/utils/logger';

// Step IDs for genius investigation workflow
export enum GeniusInvestigationWorkflowSteps {
  GET_MERCHANT_TOKEN = 'get_merchant_token',
  CALL_INVESTIGATION_API = 'call_investigation_api',
  RUN_BUG_WORKFLOW_WITH_OUTPUT = 'run_bug_workflow_with_output',
}

// Function to get merchant token from dashboard API
const getMerchantToken = async (merchantId: string = 'meesho'): Promise<MerchantTokenResult> => {
  logger.info(`🔑 Getting merchant token for: ${merchantId}`);

  try {
    const dashboardUrl = process.env.DASHBOARD_API_URL || 'https://dashboard.expresscheckout.juspay.in';
    const authHeader = process.env.DASHBOARD_AUTH_TOKEN || '';

    const response = await fetch(`${dashboardUrl}/ec/s1/admin/switch/merchant/${merchantId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authHeader}`,
      }
    });

    if (!response.ok) {
      throw new Error(`Dashboard API failed with status: ${response.status}`);
    }

    const result = await response.json() as { token?: string };
    const token = result.token;

    if (!token) {
      throw new Error('Token not found in dashboard API response');
    }

    logger.info(`✅ Successfully retrieved merchant token`);

    return {
      success: true,
      token: token,
      responseStatus: response.status
    };
  } catch (error) {
    logger.error(`❌ Failed to get merchant token:`, error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      responseStatus: 500
    };
  }
};

// Function to parse SSE stream and extract the final investigation result
const parseSSEStream = (sseOutput: string): string => {
  try {
    // Look for the final result event - typically "agent_response" or similar
    const lines = sseOutput.split('\n');
    let finalResult = '';

    // Find the last agent_response event which contains the final investigation output
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];

      // Look for agent_response event with final data
      if (line.startsWith('event: agent_response') || line.startsWith('event: final_result')) {
        // Get the next line which should be the data
        const dataLine = lines[i + 1];
        if (dataLine && dataLine.startsWith('data: ')) {
          try {
            const jsonData = JSON.parse(dataLine.substring(6));
            if (jsonData.message || jsonData.result || jsonData.analysis) {
              finalResult = jsonData.message || jsonData.result || jsonData.analysis;
              break;
            }
          } catch (e) {
            // Continue searching if JSON parse fails
            continue;
          }
        }
      }
    }

    // If no final result found, try to extract from the last meaningful content
    if (!finalResult) {
      // Look for the last data event that has substantial content
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.startsWith('data: ') && line.length > 50) {
          try {
            const jsonData = JSON.parse(line.substring(6));
            if (jsonData.message && jsonData.message.length > 100) {
              finalResult = jsonData.message;
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }
    }

    // If still no result, return a summary message
    if (!finalResult) {
      return 'Investigation completed. Please check the full investigation logs for detailed analysis.';
    }

    return finalResult;
  } catch (error) {
    logger.error('Error parsing SSE stream:', error);
    return 'Investigation completed but could not parse final result.';
  }
};

// Function to call Genius investigation API with streaming support
const callInvestigationAPI = async (
  bugId: string,
  title: string,
  description: string,
  merchantToken: string,
  merchantId: string
): Promise<GeniusInvestigationResult> => {
  logger.info(`🔍 Starting Genius investigation for bug: ${bugId} with merchant: ${merchantId}`);

  try {
    const geniusUrl = config.genius.apiUrl;

    // Construct the query object as a JSON string
    const queryObject = {
      merchantId: merchantId,
      ticketId: bugId,
      query: description || title
    };

    const formData = new FormData();
    formData.append('query', JSON.stringify(queryObject));
    formData.append('analysis_type', 'investigation');
    formData.append('current_timestamp', '');

    const response = await fetch(`${geniusUrl}/api/v3/investigation/`, {
      method: 'POST',
      headers: {
        'Accept': 'text/event-stream',
        'x-source': 'XyneSpaces',
        'Authorization': `Basic ${Buffer.from(merchantToken).toString('base64')}`,
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Genius Investigation API failed with status: ${response.status}`);
    }

    // Handle streaming response
    let rawSSEOutput = '';

    // For streaming responses, we need to read the stream
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        rawSSEOutput += chunk;
      }
    } else {
      // Fallback to text response if no stream
      rawSSEOutput = await response.text();
    }

    logger.info(`✅ Genius investigation completed successfully`);
    logger.info(`📊 Response length: ${rawSSEOutput.length} characters`);

    // Parse SSE stream to extract final result
    const parsedResult = parseSSEStream(rawSSEOutput);

    return {
      success: true,
      investigationOutput: parsedResult, // Return parsed investigation result
      responseStatus: response.status
    };
  } catch (error) {
    logger.error(`❌ Genius investigation failed for bug ${bugId}:`, error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      responseStatus: 500
    };
  }
};

const GeniusInvestigationWorkflowInputSchema = z.object({
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

const geniusInvestigationWorkflowContextMapper = (payload: any): BugWorkflowContext => ({
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

export const geniusInvestigationWorkflow: WorkflowDefinition<
  BugWorkflowContext,
  GeniusInvestigationResult,
  typeof GeniusInvestigationWorkflowSteps
> = {
  type: WorkflowType.GENIUS_INVESTIGATION_WORKFLOW,
  name: 'Genius Investigation Workflow',
  description: 'Workflow that fetches merchant token and performs investigation using Genius API',
  inputSchema: GeniusInvestigationWorkflowInputSchema,
  contextMapper: geniusInvestigationWorkflowContextMapper,

  async execute(
    engine: WorkflowEngine<BugWorkflowContext, typeof GeniusInvestigationWorkflowSteps>
  ): Promise<GeniusInvestigationResult> {
    const context = engine.getContext();
    const { bugId, title, description, merchantId } = context;

    try {
      // Step 1: Get merchant token
      const merchantIdToUse = merchantId || 'meesho'; // Default to 'meesho' if not provided
      logger.info(`🔑 Getting merchant token for merchant: ${merchantIdToUse}`);
      const tokenResult: MerchantTokenResult = await engine.createCheckpoint(
        GeniusInvestigationWorkflowSteps.GET_MERCHANT_TOKEN,
        getMerchantToken,
        merchantIdToUse
      );

      if (!tokenResult.success || !tokenResult.token) {
        throw new Error(`Failed to get merchant token: ${tokenResult.error}`);
      }

      logger.info('✅ Merchant token retrieved successfully');

      // Step 2: Call Investigation API with the token
      logger.info('🔍 Calling Genius Investigation API...');
      const investigationResult: GeniusInvestigationResult = await engine.createCheckpoint(
        GeniusInvestigationWorkflowSteps.CALL_INVESTIGATION_API,
        callInvestigationAPI,
        bugId,
        title,
        description,
        tokenResult.token,
        merchantIdToUse
      );

      if (!investigationResult.success || !investigationResult.investigationOutput) {
        logger.warn('⚠️ Genius Investigation API returned no output, skipping Bug Workflow');
        return investigationResult;
      }
      
      logger.info('investigationResult.investigationOutput:', investigationResult.investigationOutput); 
      // Step 3: Run Bug Workflow with Genius Investigation output
      logger.info('🐛 Running Bug Workflow with Genius Investigation output...');
      const bugWorkflowResult = await engine.createParallelWorkflows(
        GeniusInvestigationWorkflowSteps.RUN_BUG_WORKFLOW_WITH_OUTPUT,
        {
          workflows: [{
            workflowType: WorkflowType.BUG_WORKFLOW as const,
            initialContext: {
              ...context,
              // Use Genius Investigation output as the description for Bug Workflow
              description: `${description}\n\n## Genius Investigation Analysis:\n${investigationResult.investigationOutput}`
            }
          }] as const,
          onExecutionComplete: async (_result) => {
            return { break: true } as any;
          },
          onAllCompleted: async (results) => {
            return results[0]?.result || null;
          }
        }
      );

      logger.info('✅ Genius Investigation workflow completed with Bug Workflow');

      return {
        ...investigationResult,
        bugWorkflowResult
      } as any;
    } catch (error) {
      logger.error(`❌ Genius Investigation workflow failed for ${bugId}:`, error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        responseStatus: 500
      };
    }
  },
};
