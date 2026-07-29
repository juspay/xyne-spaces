import { WorkflowEngine, LoopControl } from '../../workflow-types';
import { WorkflowDefinition } from '../../registry/workflowRegistry';
import { WorkflowType, BugWorkflowContext } from '../../types/workflow-enums';
import { config } from '../../../config/env';
import { ResearchAnalysisResult } from './types';
import { LLMClient, UserMessage, createUserMessage } from '@framework';
import { z } from 'zod';
import {logger} from '@/utils/logger';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

// Step IDs for query workflow
export enum QueryWorkflowSteps {
  EXTRACT_MERCHANT_ID = 'extract_merchant_id',
  GET_MERCHANT_TOKEN = 'get_merchant_token',
  GENIUS_INVESTIGATION_LOOP = 'genius_investigation_loop',
  GENIUS_INVESTIGATION_OUTPUT = 'genius_investigation_output',
}


// Initialize LLM client for merchant ID extraction
const initializeLLMClient = async (ticketId: string): Promise<LLMClient> => {
  const credential = await orgLLMCredentialService.getCredentialByTicketId(
    ticketId,
    OrgLLMServiceAccountPurpose.DEFAULT,
  );
  if (!credential) {
    throw new Error(`No active DEFAULT LiteLLM service account credential for ticket ${ticketId}`);
  }
  return new LLMClient({
    provider: {
      type: 'litellm',
      config: {
        apiKey: credential.apiKey,
        baseUrl: credential.baseUrl,
        timeout: 600000, // 10 minutes
        retries: 5
      },
    },
    defaultModel: config.workflow.defaultModelName,
  });
};

// Function to extract merchant ID from description using LLM
const extractMerchantId = async (
  queryId: string,
  description: string,
  ticketId: string,
): Promise<{ merchantId: string | null }> => {
  logger.info(`🔍 Extracting merchant ID for ticket: ${queryId}`);

  if (config.use_mock_analysis) {
    logger.info('Using MOCK merchant ID extraction');
    await new Promise(resolve => setTimeout(resolve, 500));
    return { merchantId: 'meesho' };
  }

  try {
    const llmClient = await initializeLLMClient(ticketId);

    const prompt = `Please extract the merchant ID from the following description. Return ONLY a JSON object with the structure: { "merchant_id": "extracted_id" }. If no merchant ID is found, return: { "merchant_id": null }. Common merchant ID formats: meesho, flipkart, amazon, etc.

Description:
${description}`;

    logger.info(`[ExtractMerchantId] Sending prompt to LLM`);

    const llmMessages: UserMessage[] = [createUserMessage(prompt)];

    const response = await llmClient.generate({
      model: config.workflow.defaultModelName,
      messages: llmMessages,
    });

    const responseContent = response.content || '{ "merchant_id": null }';
    logger.info(`[ExtractMerchantId] Received response from LLM: ${responseContent}`);

    // Parse the JSON response
    let merchantId: string | null = null;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonResponse = JSON.parse(jsonMatch[0]);
        merchantId = jsonResponse.merchant_id || null;
      }
    } catch (parseError) {
      logger.error('Error parsing JSON response:', parseError);
      merchantId = null;
    }

    logger.info(`[ExtractMerchantId] Extracted merchant ID: ${merchantId}`);

    return {
      merchantId: merchantId,
    };
  } catch (error) {
    logger.error('Error during merchant ID extraction:', error);
    if (error instanceof Error) {
      logger.error('Error message:', error.message);
      logger.error('Error stack:', error.stack);
    }
    // Return null on error, will use default
    return { merchantId: null };
  }
};

// Function to get merchant token from dashboard API
const getMerchantToken = async (merchantId: string): Promise<{ success: boolean; token?: string; error?: string }> => {
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
    };
  } catch (error) {
    logger.error(`❌ Failed to get merchant token:`, error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
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
const callGeniusInvestigation = async (
  queryId: string,
  title: string,
  description: string,
  merchantToken: string,
  merchantId: string
): Promise<{ success: boolean; investigationOutput?: string; error?: string }> => {
  logger.info(`🔍 Starting Genius investigation for query: ${queryId} with merchant: ${merchantId}`);

  try {
    const geniusUrl = config.genius.apiUrl;

    // Construct the query object as a JSON string
    const queryObject = {
      merchantId: merchantId,
      ticketId: queryId,
      query: description || title
    };

    const formData = new FormData();
    formData.append('query', JSON.stringify(queryObject));
    formData.append('analysis_type', 'investigation');
    formData.append('current_timestamp', '');

    logger.info(`[GeniusInvestigation] Calling ${geniusUrl}/api/v3/investigation/`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000); // 30 minute timeout

    try {
      const response = await fetch(`${geniusUrl}/api/v3/investigation/`, {
        method: 'POST',
        headers: {
          'Accept': 'text/event-stream',
          'x-source': 'XyneSpaces',
          'Authorization': `Basic ${Buffer.from(merchantToken).toString('base64')}`,
          'Connection': 'keep-alive',
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[GeniusInvestigation] API returned status ${response.status}: ${errorText}`);
        throw new Error(`Genius Investigation API failed with status: ${response.status}`);
      }

      // Handle streaming response
      let rawSSEOutput = '';
      let lastChunkTime = Date.now();
      const chunkTimeout = 5 * 60 * 1000; // 5 minutes max between chunks

      // For streaming responses, we need to read the stream
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            // Check if we've been waiting too long for the next chunk
            if (Date.now() - lastChunkTime > chunkTimeout) {
              logger.error(`[GeniusInvestigation] Timeout: No data received for ${chunkTimeout / 1000} seconds`);
              throw new Error('Stream timeout: No data received for 5 minutes');
            }

            const { done, value } = await reader.read();

            if (done) {
              logger.info(`[GeniusInvestigation] Stream completed`);
              break;
            }

            lastChunkTime = Date.now();
            const chunk = decoder.decode(value, { stream: true });
            rawSSEOutput += chunk;

            // Log progress every 10KB
            if (rawSSEOutput.length % 10000 < chunk.length) {
              logger.info(`[GeniusInvestigation] Received ${(rawSSEOutput.length / 1024).toFixed(2)} KB so far...`);
            }
          }
        } catch (readError) {
          logger.error(`[GeniusInvestigation] Error reading stream:`, readError);
          throw readError;
        } finally {
          reader.releaseLock();
        }
      } else {
        // Fallback to text response if no stream
        logger.info(`[GeniusInvestigation] No stream body, using text response`);
        rawSSEOutput = await response.text();
      }

      logger.info(`✅ Genius investigation completed successfully`);
      logger.info(`📊 Response length: ${rawSSEOutput.length} characters`);

      // Parse SSE stream to extract final result
      const parsedResult = parseSSEStream(rawSSEOutput);

      return {
        success: true,
        investigationOutput: parsedResult,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    logger.error(`❌ Genius investigation failed for query ${queryId}:`, error);

    // Provide more specific error messages
    let errorMessage = 'Unknown error';
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = 'Request timeout after 30 minutes';
      } else if (error.message.includes('terminated') || error.message.includes('closed')) {
        errorMessage = 'Connection closed by server. The investigation may have completed or failed on the server side.';
      } else {
        errorMessage = error.message;
      }
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
};

const QueryWorkflowInputSchema = z.object({
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

const queryWorkflowContextMapper = (payload: any): BugWorkflowContext => ({
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

export const queryWorkflow: WorkflowDefinition<
  BugWorkflowContext,
  { result: ResearchAnalysisResult | null; failureInfo?: { step: string; reason: string; details?: any } },
  typeof QueryWorkflowSteps
> = {
  type: WorkflowType.QUERY_WORKFLOW,
  name: 'Query Workflow',
  description: 'Workflow to answer user queries using Genius investigation',
  inputSchema: QueryWorkflowInputSchema,
  contextMapper: queryWorkflowContextMapper,

  async execute(
    engine: WorkflowEngine<BugWorkflowContext, typeof QueryWorkflowSteps>
  ): Promise<{ result: ResearchAnalysisResult | null; failureInfo?: { step: string; reason: string; details?: any } }> {
    const context = engine.getContext();
    const { bugId: queryId, title, description, merchantId: contextMerchantId } = context;

    try {
      // Step 1: Extract or use provided merchant ID
      let merchantId = contextMerchantId;

      if (!merchantId) {
        logger.info('📝 No merchant ID provided, attempting to extract from description');
        const extractionResult = await engine.createCheckpoint(
          QueryWorkflowSteps.EXTRACT_MERCHANT_ID,
          extractMerchantId,
          queryId,
          description,
          context.ticketId,
        );
        merchantId = extractionResult.merchantId || 'meesho'; // Default to 'meesho' if extraction fails
        logger.info(`📝 Extracted/Default merchant ID: ${merchantId}`);
      } else {
        logger.info(`📝 Using provided merchant ID: ${merchantId}`);
      }

      // Step 2: Get merchant token
      logger.info('🔑 Getting merchant token...');
      const tokenResult = await engine.createCheckpoint(
        QueryWorkflowSteps.GET_MERCHANT_TOKEN,
        getMerchantToken,
        merchantId
      );

      if (!tokenResult.success || !tokenResult.token) {
        throw new Error(`Failed to get merchant token: ${tokenResult.error}`);
      }

      logger.info('✅ Merchant token retrieved successfully');

      // Step 3: Call Genius Investigation API with retry loop
      logger.info('🔍 Calling Genius Investigation API with retry logic...');
      let investigationResult: { success: boolean; investigationOutput?: string; error?: string } | undefined;
      const merchantToken = tokenResult.token!; // We already checked it exists above

      await engine.createWhileLoop(
        QueryWorkflowSteps.GENIUS_INVESTIGATION_LOOP,
        3, // Max 3 attempts
        async (iteration: number) => {
          logger.info(`🔄 Genius Investigation Attempt ${iteration + 1}/3`);

          // Call the function directly without creating a checkpoint
          const result = await callGeniusInvestigation(
            queryId,
            title,
            description,
            merchantToken,
            merchantId
          );

          if (result.success && result.investigationOutput) {
            investigationResult = result;
            logger.info('✅ Genius investigation succeeded on attempt', iteration + 1);
            return LoopControl.BREAK; // Success - exit loop
          } else {
            logger.info(`❌ Genius investigation failed on attempt ${iteration + 1}: ${result.error}`);

            // If this is the last attempt, store the failed result
            if (iteration === 2) {
              investigationResult = result;
              return LoopControl.BREAK;
            }

            // Wait before retrying (exponential backoff: 5s, 10s)
            const backoffDelay = 5000 * (iteration + 1);
            logger.info(`⏳ Waiting ${backoffDelay / 1000}s before retry...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));

            return LoopControl.CONTINUE; // Retry
          }
        }
      );

      if (!investigationResult || !investigationResult.success || !investigationResult.investigationOutput) {
        const errorMsg = investigationResult?.error || 'Unknown error';
        throw new Error(`Genius investigation failed after 3 attempts: ${errorMsg}`);
      }

      logger.info('✅ [VALIDATION] Genius investigation successful');

      // Step 4: Create output checkpoint to display the result in UI
      const outputResult = await engine.createCheckpoint(
        QueryWorkflowSteps.GENIUS_INVESTIGATION_OUTPUT,
        async () => {
          return {
            investigationOutput: investigationResult!.investigationOutput!,
            success: true,
          };
        }
      );

      return {
        result: { analysis: outputResult.investigationOutput },
      };
    } catch (error) {
      logger.error(`❌ [WORKFLOW-DEBUG] Query workflow failed for ${queryId}:`, error);

      let step = 'WORKFLOW_EXCEPTION';
      let reason = `Unexpected workflow error: ${error instanceof Error ? error.message : 'Unknown error'}`;

      if (error instanceof Error) {
        logger.error(`❌ [WORKFLOW-DEBUG] Error message: ${error.message}`);
        logger.error(`❌ [WORKFLOW-DEBUG] Error stack: ${error.stack}`);

        const stack = error.stack || '';

        if (stack.includes('callGeniusInvestigation') || error.message.includes('Genius investigation')) {
          step = 'GENIUS_INVESTIGATION';
          reason = error.message;
          logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`);
        } else if (stack.includes('getMerchantToken')) {
          step = 'GET_MERCHANT_TOKEN';
          reason = 'Failed to retrieve merchant token: ' + error.message;
          logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`);
        } else if (stack.includes('extractMerchantId')) {
          step = 'EXTRACT_MERCHANT_ID';
          reason = 'Failed to extract merchant ID: ' + error.message;
          logger.error(`❌ [VALIDATION] Failed at step: ${step} - ${reason}`);
        }
      }

      // Log the failure summary for debugging/monitoring purposes
      logger.error(`❌ [WORKFLOW-FAILURE-SUMMARY] Step: ${step}, Reason: ${reason}`);

      // Throw the error to ensure the workflow is marked as failed
      throw new Error(`Query workflow failed at step ${step}: ${reason}`);
    }
  },
};
