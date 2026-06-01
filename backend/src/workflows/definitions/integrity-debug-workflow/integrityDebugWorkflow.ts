/**
 * Integrity Debug Workflow
 * Automated debugging of payment integrity check failures
 */

import { WorkflowDefinition } from '../../registry/workflowRegistry.js';
import { WorkflowType, IntegrityDebugContext } from '../../types/workflow-enums.js';
import { WorkflowEngine, GitDiffFile } from '../../workflow-types.js';
import { logger } from '../../../utils/logger.js';
import { researchAgentService } from '../../../services/researchAgentService.js';
import { config } from '../../../config/env.js';
import { z } from 'zod';
import { loadWorkflowConfig, INTEGRITY_GIT_CONFIG } from './config.js';
import { config as agentConfig } from '../../config.js';
import { executeWithRetry, formatRetryErrors } from './retry-utils.js';
import { RetryMetadata, formatRetryMetadata } from './retry-tracking.js';

// Import user prompts (system prompts come from agent configs)
import {
  buildStep1RepositoryIdentificationPrompt,
  buildStep2AmountFormatPrompt,
  buildStep3LogRequirementsPrompt,
  buildStep4LogCollectionPrompt,
  buildStep5CodeAnalysisPrompt,
} from './prompts-v2.js';
import type {
  SessionData,
  IntegrityDebugWorkflowOutput,
} from './types.js';
import { formatGatewayIssueReport, mapRepositoryName, getRepositoryBaseBranch } from './utils.js';
import {
  getMockStep1RepositoryIdentification,
  getMockStep2AmountFormat,
  getMockStep3LogRequirements,
  getMockStep4LogCollection,
  getMockStep5CodeAnalysis,
} from './mockResearchAgent-v2.js';

// ============================================================================
// Step IDs
// ============================================================================

export enum IntegrityDebugWorkflowSteps {
  PARSE_CSV_INPUT = 'parse_csv_input',
  IDENTIFY_REPOSITORY = 'identify_repository',
  DISCOVER_AMOUNT_FORMAT = 'discover_amount_format',
  DISCOVER_LOG_REQUIREMENTS = 'discover_log_requirements',
  FETCH_LOGS = 'fetch_logs',
  ANALYZE_CODE = 'analyze_code',
  DECIDE_ACTION = 'decide_action',
  CREATE_FIX_PR = 'create_fix_pr',
  SUMMARIZE_PR = 'summarize_pr',
  GENERATE_GATEWAY_ISSUE_REPORT = 'generate_gateway_issue_report',
  SAVE_ERROR_DETAILS = 'save_error_details',
}

// ============================================================================
// Utility Functions
// ============================================================================


/**
 * Map repository name to UUID for research agent
 * Hardcoded repository IDs for integrity debug workflow
 */
function getRepositoryId(repositoryName: string): string | null {
  const repoMap: Record<string, string> = {
    'euler-api-txns': '8cbe7e27-7ead-4aca-8ca1-f84dc417a50a',
    'api-txns': '8cbe7e27-7ead-4aca-8ca1-f84dc417a50a',
    'euler-api-gateway': '47f190fd-0c7c-4e0b-bd77-4c5fe216f023',
    'api-gateway': '47f190fd-0c7c-4e0b-bd77-4c5fe216f023',
  };

  return repoMap[repositoryName] || null;
}

/**
 * Convert GitDiffFile[] to a readable string format
 */
function formatGitDiff(gitDiff?: GitDiffFile[]): string {
  if (!gitDiff || gitDiff.length === 0) {
    return 'No changes detected';
  }

  return gitDiff.map(file => {
    const type = file.type === 'add' ? 'Added' :
                 file.type === 'delete' ? 'Deleted' :
                 file.type === 'rename' ? 'Renamed' : 'Modified';
    const path = file.type === 'rename' ? `${file.oldPath} → ${file.newPath}` : file.newPath || file.oldPath;

    const hunks = file.hunks.map(hunk => hunk.content).join('\n');

    return `diff --git a/${file.oldPath} b/${file.newPath}\n${type}: ${path}\n${hunks}`;
  }).join('\n\n');
}

// ============================================================================
// Workflow Steps Implementation
// ============================================================================

/**
 * STEP 1: Identify repository using research agent
 */
const identifyRepository = async (
  ticketId: string,
  gateway: string
): Promise<{ repository: string; researchAgentSessionId: string }> => {
  logger.info(`[${ticketId}] STEP 1: Identifying repository for gateway: ${gateway}`);
  logger.info(`${ticketId}_identify_repository_1_input`, { gateway });

  // Check if we should use mock data
  if (config.use_mock_analysis) {
    logger.info(`[${ticketId}] Using MOCK repository identification (USE_MOCK_ANALYSIS=true)`);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate processing time
    const mockResult = getMockStep1RepositoryIdentification();
    logger.info(`${ticketId}_identify_repository_1_output`, {
      mock: true,
      repository: mockResult.repository,
    });
    return { repository: mockResult.repository, researchAgentSessionId: 'mock-session-id' };
  }

  try {
    const workflowConfig = loadWorkflowConfig();

    // Build repository identification prompt (Step 1) - done outside retry for debug logging
    const repoIdentificationPrompt = buildStep1RepositoryIdentificationPrompt(gateway);

    // Track retry metadata for observability
    let currentRetryMetadata: RetryMetadata | undefined;

    // Execute with retry logic
    const retryResult = await executeWithRetry(
      `${ticketId} - Repository Identification`,
      async () => {
        // Create research agent session with product ID to search across all repos in product
        const sessionId = await researchAgentService.createSession(
          process.env.RESEARCH_AGENT_PRODUCT_ID || null, // productId - search within product
          null, // repositoryId - no specific repo, search all repos in product
          undefined
        );

        logger.info(`[${ticketId}] ✅ Research Agent Session Created: ${sessionId}`);

        // Stream query to research agent
        // System prompt comes from agent config: integrity-step1-repository-identifier
        const response = await researchAgentService.streamQuery(
          sessionId,
          repoIdentificationPrompt,
          {
            systemPrompt: agentConfig[workflowConfig.agents.step1].systemPrompt,
            maxTurns: 999,  // No limit - let it run until complete
          }
        );

        return { sessionId, response };
      },
      workflowConfig.retry.enabled ? {
        maxRetries: workflowConfig.retry.maxRetries,
        retryDelayMs: workflowConfig.retry.retryDelayMs,
        exponentialBackoff: workflowConfig.retry.exponentialBackoff,
        onRetryUpdate: async (metadata) => {
          currentRetryMetadata = metadata;
          logger.info(`[${ticketId}] Retry metadata updated:`, {
            attempt: metadata.totalAttempts,
            status: metadata.finalStatus,
          });
        },
      } : { maxRetries: 0 }
    );

    if (!retryResult.success || !retryResult.result) {
      throw new Error(formatRetryErrors('Repository Identification', retryResult));
    }

    const { sessionId, response } = retryResult.result;
    logger.info(`[${ticketId}] STEP 1: Repository identification completed`);

    // Log retry summary if retries occurred
    if (currentRetryMetadata && currentRetryMetadata.totalAttempts > 1) {
      logger.info(`[${ticketId}] Repository Identification Retry Summary:\n${formatRetryMetadata(currentRetryMetadata)}`);
    }

    // Write debug files only in development/test mode
    if (config.use_mock_analysis || process.env.NODE_ENV !== 'production') {
      const fs = await import('fs/promises');
      const path = await import('path');
      const debugData = {
        step: 'STEP 1: IDENTIFY REPOSITORY',
        sessionId,
        prompt: repoIdentificationPrompt,
        systemPrompt: agentConfig[workflowConfig.agents.step1].systemPrompt,
        response: response.analysis
      };
      const ticketLogsDir = path.join(process.cwd(), 'logs', ticketId);
      await fs.mkdir(ticketLogsDir, { recursive: true });
      const outputPath = path.join(ticketLogsDir, 'step1-identify-repository.json');
      await fs.writeFile(outputPath, JSON.stringify(debugData, null, 2));
      logger.info(`[${ticketId}] Response written to ${outputPath}`);
    }

    // Parse the response - try to extract JSON (simple format: {repository: "name"})
    let identificationResult: { repository: string };
    try {
      // Try to parse as JSON directly
      identificationResult = JSON.parse(response.analysis);
    } catch (parseError) {
      // Try to extract JSON from code block
      const jsonMatch = response.analysis.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        identificationResult = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Failed to parse repository identification JSON from research agent response');
      }
    }

    logger.info(`[${ticketId}] STEP 1: Identified repository: ${identificationResult.repository}`);
    logger.info(`${ticketId}_identify_repository_1_output`, {
      repository: identificationResult.repository,
      researchAgentSessionId: sessionId,
      retryMetadata: currentRetryMetadata,
    });

    return { repository: identificationResult.repository, researchAgentSessionId: sessionId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[${ticketId}] STEP 1: Error identifying repository:`, error);
    logger.error(`${ticketId}_identify_repository_1_error`, {
      error: errorMessage,
    });
    throw new Error(`STEP 1 (Repository Identification) failed: ${errorMessage}`);
  }
};

/**
 * NEW STEP 4: Analyze amount logic using Money framework with collected logs
 */
const discoverAmountFormat = async (
  ticketId: string,
  gateway: string,
  identifiedRepository: string,
  collectedLogs: any
): Promise<any> => {
  logger.info(`[${ticketId}] STEP 4: Analyzing amount logic for ${gateway} gateway`);
  logger.info(`${ticketId}_discover_amount_format_4_input`, { gateway, repository: identifiedRepository, logsCollected: collectedLogs ? Object.keys(collectedLogs).length : 0 });

  // Check if we should use mock data
  if (config.use_mock_analysis) {
    logger.info(`[${ticketId}] Using MOCK amount logic analysis (USE_MOCK_ANALYSIS=true)`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const mockFormat = getMockStep2AmountFormat();
    logger.info(`${ticketId}_discover_amount_format_4_output`, {
      mock: true,
      amountFormat: mockFormat.amount_format,
      multiplier: mockFormat.multiplier,
      calculatedAmount: mockFormat.calculated_amount,
    });
    return mockFormat;
  }

  try {
    const repositoryId = getRepositoryId(identifiedRepository);
    if (!repositoryId) {
      throw new Error(`Unknown repository: ${identifiedRepository}. Please add repository ID to .env.local`);
    }

    // Build prompt with collected logs data
    const logsJson = JSON.stringify(collectedLogs, null, 2);
    const amountFormatPrompt = buildStep2AmountFormatPrompt(gateway, logsJson);
    const workflowConfig = loadWorkflowConfig();

    // Execute with retry logic
    const retryResult = await executeWithRetry(
      `${ticketId} - Amount Format Analysis`,
      async () => {
        const sessionId = await researchAgentService.createSession(
          null,
          repositoryId,
          undefined
        );

        logger.info(`[${ticketId}] ✅ Research Agent Session Created: ${sessionId}`);

        // Stream query to research agent
        // System prompt comes from agent config: integrity-step2-amount-format-analyzer
        const response = await researchAgentService.streamQuery(
          sessionId,
          amountFormatPrompt,
          {
            systemPrompt: agentConfig[workflowConfig.agents.step2].systemPrompt,
            maxTurns: 999,  // No limit - let it run until complete
          }
        );

        return { sessionId, response };
      },
      workflowConfig.retry.enabled ? {
        maxRetries: workflowConfig.retry.maxRetries,
        retryDelayMs: workflowConfig.retry.retryDelayMs,
        exponentialBackoff: workflowConfig.retry.exponentialBackoff,
      } : { maxRetries: 0 }
    );

    if (!retryResult.success || !retryResult.result) {
      throw new Error(formatRetryErrors('Amount Format Analysis', retryResult));
    }

    const { sessionId, response } = retryResult.result;
    logger.info(`[${ticketId}] STEP 4: Amount logic analysis completed`);

    // Write debug files only in development/test mode
    if (config.use_mock_analysis || process.env.NODE_ENV !== 'production') {
      const fs = await import('fs/promises');
      const path = await import('path');
      const debugData = {
        step: 'STEP 4: DISCOVER AMOUNT LOGIC',
        sessionId,
        prompt: amountFormatPrompt,
        systemPrompt: agentConfig[workflowConfig.agents.step2].systemPrompt,
        response: response.analysis
      };
      const ticketLogsDir = path.join(process.cwd(), 'logs', ticketId);
      await fs.mkdir(ticketLogsDir, { recursive: true });
      const outputPath = path.join(ticketLogsDir, 'step4-discover-amount-logic.json');
      await fs.writeFile(outputPath, JSON.stringify(debugData, null, 2));
      logger.info(`[${ticketId}] Response written to ${outputPath}`);
    }

    // Parse response
    let amountFormatResult: any;
    try {
      amountFormatResult = JSON.parse(response.analysis);
    } catch (parseError) {
      const jsonMatch = response.analysis.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        amountFormatResult = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Failed to parse amount logic JSON from research agent response');
      }
    }

    logger.info(`[${ticketId}] STEP 4: Amount logic: ${amountFormatResult.amount_format}, calculated: ${amountFormatResult.calculated_amount}`);

    const resultWithSessionId = { ...amountFormatResult, researchAgentSessionId: sessionId };
    logger.info(`${ticketId}_discover_amount_format_4_output`, resultWithSessionId);

    return resultWithSessionId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[${ticketId}] STEP 4: Error analyzing amount logic:`, error);
    logger.error(`${ticketId}_discover_amount_format_4_error`, {
      error: errorMessage,
    });
    throw new Error(`STEP 4 (Amount Format Analysis) failed: ${errorMessage}`);
  }
};

/**
 * NEW STEP 3: Discover what log data is required by examining gateway code
 */
const discoverLogRequirements = async (
  ticketId: string,
  gateway: string,
  orderIds: string[],
  merchantId: string,
  flow: string,
  identifiedRepository: string
): Promise<any> => {
  logger.info(`[${ticketId}] STEP 2: Discovering log requirements for ${gateway} gateway`);
  logger.info(`${ticketId}_discover_log_requirements_2_input`, {
    gateway,
    orderIds,
    orderCount: orderIds?.length || 0,
    merchantId,
    flow,
    repository: identifiedRepository,
  });

  // Check if we should use mock data
  if (config.use_mock_analysis) {
    logger.info(`[${ticketId}] Using MOCK log requirements discovery (USE_MOCK_ANALYSIS=true)`);
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate processing time
    const mockRequirements = getMockStep3LogRequirements();
    logger.info(`${ticketId}_discover_log_requirements_2_output`, {
      mock: true,
      locationsFound: mockRequirements.integrity_locations_found.length,
      fieldCategoriesRequired: Object.keys(mockRequirements.required_fields).length,
    });
    return mockRequirements;
  }

  try {
    // Map repository name to UUID
    const repositoryId = getRepositoryId(identifiedRepository);
    if (!repositoryId) {
      throw new Error(`Unknown repository: ${identifiedRepository}. Please add repository ID to .env.local`);
    }

    logger.info(`[${ticketId}] Mapped repository ${identifiedRepository} to ID ${repositoryId}`);

    // Build log requirements discovery prompt (Step 2)
    const logRequirementsPrompt = buildStep3LogRequirementsPrompt(gateway, orderIds, merchantId, flow);
    const workflowConfig = loadWorkflowConfig();

    // Execute with retry logic
    const retryResult = await executeWithRetry(
      `${ticketId} - Log Requirements Discovery`,
      async () => {
        // Create research agent session for the identified repository
        const sessionId = await researchAgentService.createSession(
          null, // productId - don't pass when repository_id is specified
          repositoryId, // repositoryId - search in identified repo
          undefined
        );

        logger.info(`[${ticketId}] ✅ Research Agent Session Created: ${sessionId}`);

        // Stream query to research agent (use more turns for comprehensive code search)
        // System prompt comes from agent config: integrity-step3-log-requirements-analyzer
        const response = await researchAgentService.streamQuery(
          sessionId,
          logRequirementsPrompt,
          {
            systemPrompt: agentConfig[workflowConfig.agents.step3].systemPrompt,
            maxTurns: 999,  // No limit - let it run until complete
          }
        );

        return { sessionId, response };
      },
      workflowConfig.retry.enabled ? {
        maxRetries: workflowConfig.retry.maxRetries,
        retryDelayMs: workflowConfig.retry.retryDelayMs,
        exponentialBackoff: workflowConfig.retry.exponentialBackoff,
      } : { maxRetries: 0 }
    );

    if (!retryResult.success || !retryResult.result) {
      throw new Error(formatRetryErrors('Log Requirements Discovery', retryResult));
    }

    const { sessionId, response } = retryResult.result;
    logger.info(`[${ticketId}] STEP 2: Log requirements discovery completed`);

    // Write debug files only in development/test mode
    if (config.use_mock_analysis || process.env.NODE_ENV !== 'production') {
      const fs = await import('fs/promises');
      const path = await import('path');
      const debugData = {
        step: 'STEP 2: DISCOVER LOG REQUIREMENTS',
        sessionId,
        prompt: logRequirementsPrompt,
        systemPrompt: agentConfig[workflowConfig.agents.step3].systemPrompt,
        response: response.analysis
      };
      const ticketLogsDir = path.join(process.cwd(), 'logs', ticketId);
      await fs.mkdir(ticketLogsDir, { recursive: true });
      const outputPath = path.join(ticketLogsDir, 'step2-discover-log-requirements.json');
      await fs.writeFile(outputPath, JSON.stringify(debugData, null, 2));
      logger.info(`[${ticketId}] Response written to ${outputPath}`);
    }

    // Parse the response - try to extract JSON
    let requirementsResult: any;
    try {
      // Try to parse as JSON directly
      requirementsResult = JSON.parse(response.analysis);
    } catch (parseError) {
      // Try to extract JSON from markdown code block (```json ... ```)
      let jsonMatch = response.analysis.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          requirementsResult = JSON.parse(jsonMatch[1]);
        } catch (e) {
          logger.error(`[${ticketId}] Failed to parse JSON from code block:`, jsonMatch[1].substring(0, 500));
          throw new Error('Invalid JSON in markdown code block');
        }
      } else {
        // Try to extract JSON from plain code block (``` ... ```)
        jsonMatch = response.analysis.match(/```\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          try {
            requirementsResult = JSON.parse(jsonMatch[1]);
          } catch (e) {
            logger.error(`[${ticketId}] Failed to parse JSON from plain code block:`, jsonMatch[1].substring(0, 500));
            throw new Error('Invalid JSON in code block');
          }
        } else {
          // Log the actual response to help debug
          logger.error(`[${ticketId}] Could not find JSON in response. Full response:`, response.analysis);
          throw new Error('Failed to parse log requirements JSON from research agent response. No JSON found in response.');
        }
      }
    }

    logger.info(`[${ticketId}] STEP 2: Log requirements discovered:`, {
      locationsFound: requirementsResult.integrity_locations_found?.length || 0,
      fieldCategoriesRequired: Object.keys(requirementsResult.required_fields || {}).length,
    });

    const resultWithSessionId = { ...requirementsResult, researchAgentSessionId: sessionId };
    logger.info(`${ticketId}_discover_log_requirements_2_output`, resultWithSessionId);

    return resultWithSessionId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[${ticketId}] STEP 2: Error discovering log requirements:`, error);
    logger.error(`${ticketId}_discover_log_requirements_2_error`, {
      error: errorMessage,
    });
    throw new Error(`STEP 2 (Log Requirements Discovery) failed: ${errorMessage}`);
  }
};

/**
 * NEW STEP 3: Fetch logs based on discovered requirements
 */
const fetchLogs = async (
  ticketId: string,
  gateway: string,
  orderIds: string[],
  merchantId: string,
  flow: string,
  logRequirements: any,
  additionalUserInfo?: string
): Promise<any> => {
  logger.info(`[${ticketId}] STEP 3: Fetching logs for ${orderIds.length} orders`);
  logger.info(`${ticketId}_fetch_logs_3_input`, {
    gateway,
    orderIds,
    orderCount: orderIds?.length || 0,
    merchantId,
    flow,
    requiredFieldCategories: Object.keys(logRequirements.required_fields || {}).length,
  });

  // Check if we should use mock data
  if (config.use_mock_analysis) {
    logger.info(`[${ticketId}] Using MOCK log collection (USE_MOCK_ANALYSIS=true)`);
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate processing time
    const mockLogs = getMockStep4LogCollection();
    logger.info(`${ticketId}_fetch_logs_3_output`, {
      mock: true,
      fieldsCollected: Object.keys(mockLogs).length,
    });
    return mockLogs;
  }

  try {
    // Handle both field names: required_fields or required_fields_for_dry_run
    let requiredFields = logRequirements.required_fields || logRequirements.required_fields_for_dry_run;

    // Flatten nested structure only if it's the OLD shape:
    //   { database_fields: { table: [...] }, gateway_response_fields: { table: [...] } }
    // If the agent returned the newer FLAT-ARRAY shape (e.g. database_tables: [...],
    // gateway_response_fields: [...]), pass it through unchanged so the array values
    // flow into buildStep4LogCollectionPrompt and get rendered by its array branch.
    // Guarding each branch prevents Object.assign({}, someArray) from silently
    // converting an array into numeric-keyed string properties.
    const isPlainObject = (v: any) =>
      v != null && typeof v === 'object' && !Array.isArray(v);

    const hasNestedShape =
      requiredFields && (
        isPlainObject(requiredFields.database_fields) ||
        isPlainObject(requiredFields.gateway_response_fields)
      );

    if (hasNestedShape) {
      const flattenedFields: Record<string, any> = {};

      if (isPlainObject(requiredFields.database_fields)) {
        Object.assign(flattenedFields, requiredFields.database_fields);
      }

      if (isPlainObject(requiredFields.gateway_response_fields)) {
        Object.assign(flattenedFields, requiredFields.gateway_response_fields);
      }

      if (requiredFields.verification_fields) {
        flattenedFields.verification_metadata = requiredFields.verification_fields;
      }

      requiredFields = flattenedFields;
      logger.info(`[${ticketId}] Flattened nested required_fields structure`);
    }

    // Build log collection prompt (Step 3)
    const workflowConfig = loadWorkflowConfig();
    const logCollectionPrompt = buildStep4LogCollectionPrompt(
      gateway,
      orderIds,
      merchantId,
      requiredFields,
      flow,
      additionalUserInfo
    );

    // Execute with retry logic
    const retryResult = await executeWithRetry(
      `${ticketId} - Log Collection`,
      async () => {
        // Create research agent session for log collection
        const sessionId = await researchAgentService.createSession(
          process.env.RESEARCH_AGENT_PRODUCT_ID || null, // productId - for log access
          null, // repositoryId - logs are not in a specific repository
          undefined
        );

        logger.info(`[${ticketId}] ✅ Research Agent Session Created: ${sessionId}`);

        // Stream query to research agent
        // System prompt comes from agent config: integrity-step4-log-collector
        const response = await researchAgentService.streamQuery(
          sessionId,
          logCollectionPrompt,
          {
            systemPrompt: agentConfig[workflowConfig.agents.step4].systemPrompt,
            maxTurns: 999,  // No limit - let it run until complete
          }
        );

        return { sessionId, response };
      },
      workflowConfig.retry.enabled ? {
        maxRetries: workflowConfig.retry.maxRetries,
        retryDelayMs: workflowConfig.retry.retryDelayMs,
        exponentialBackoff: workflowConfig.retry.exponentialBackoff,
      } : { maxRetries: 0 }
    );

    if (!retryResult.success || !retryResult.result) {
      throw new Error(formatRetryErrors('Log Collection', retryResult));
    }

    const { sessionId, response } = retryResult.result;
    logger.info(`[${ticketId}] STEP 3: Log collection completed`);

    // Write debug files only in development/test mode
    if (config.use_mock_analysis || process.env.NODE_ENV !== 'production') {
      const fs3 = await import('fs/promises');
      const path3 = await import('path');
      const debugData3 = {
        step: 'STEP 3: FETCH LOGS',
        sessionId,
        prompt: logCollectionPrompt,
        systemPrompt: agentConfig[workflowConfig.agents.step4].systemPrompt,
        response: response.analysis
      };
      const ticketLogsDir3 = path3.join(process.cwd(), 'logs', ticketId);
      await fs3.mkdir(ticketLogsDir3, { recursive: true });
      const outputPath3 = path3.join(ticketLogsDir3, 'step3-fetch-logs.json');
      await fs3.writeFile(outputPath3, JSON.stringify(debugData3, null, 2));
      logger.info(`[${ticketId}] Response written to ${outputPath3}`);
    }

    // Parse the response - try to extract JSON
    let collectedLogs: any;
    try {
      // Try to parse as JSON directly
      collectedLogs = JSON.parse(response.analysis);
    } catch (parseError) {
      // Try to extract JSON from code block
      const jsonMatch = response.analysis.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        collectedLogs = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Failed to parse collected logs JSON from research agent response');
      }
    }

    logger.info(`[${ticketId}] STEP 3: Logs collected successfully`);

    const logsWithSessionId = { ...collectedLogs, researchAgentSessionId: sessionId };
    logger.info(`${ticketId}_fetch_logs_3_output`, {
      fieldsCollected: Object.keys(collectedLogs).length,
      researchAgentSessionId: sessionId,
    });

    return logsWithSessionId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[${ticketId}] STEP 3: Error fetching logs:`, error);
    logger.error(`${ticketId}_fetch_logs_3_error`, {
      error: errorMessage,
    });
    throw new Error(`STEP 3 (Log Collection) failed: ${errorMessage}`);
  }
};

/**
 * NEW STEP 5: Analyze code using research agent with collected logs and amount format
 */
const analyzeCode = async (
  ticketId: string,
  gateway: string,
  orderIds: string[],
  merchantId: string,
  collectedLogs: any,
  identifiedRepository: string,
  amountFormat: any
): Promise<any> => {
  logger.info(`[${ticketId}] STEP 5: Starting comprehensive code analysis for ${gateway}`);
  logger.info(`${ticketId}_analyze_code_5_input`, {
    gateway,
    orderIds,
    orderCount: orderIds?.length || 0,
    merchantId,
    repository: identifiedRepository,
    logsCollected: collectedLogs ? Object.keys(collectedLogs).length : 0,
    amountFormat: amountFormat?.amount_format || 'unknown',
    multiplier: amountFormat?.multiplier || 0,
  });

  // Check if we should use mock data
  if (config.use_mock_analysis) {
    logger.info(`[${ticketId}] Using MOCK code analysis (USE_MOCK_ANALYSIS=true)`);
    await new Promise((resolve) => setTimeout(resolve, 3000)); // Simulate processing time
    const mockAnalysis = getMockStep5CodeAnalysis();
    logger.info(`${ticketId}_analyze_code_5_output`, {
      mock: true,
      isOurIssue: mockAnalysis.is_our_issue,
      repository: mockAnalysis.repository,
      integrityLocationsAnalyzed: mockAnalysis.integrity_locations_analysis?.length || 0,
    });
    return mockAnalysis;
  }

  try {
    // Map repository name to UUID
    const repositoryId = getRepositoryId(identifiedRepository);
    if (!repositoryId) {
      throw new Error(`Unknown repository: ${identifiedRepository}. Please add repository ID to .env.local`);
    }

    logger.info(`[${ticketId}] Mapped repository ${identifiedRepository} to ID ${repositoryId}`);

    // Build code analysis prompt with collected logs and amount format (Step 5)
    const logsJson = JSON.stringify(collectedLogs, null, 2);
    const codeAnalysisPrompt = buildStep5CodeAnalysisPrompt(gateway, orderIds, merchantId, logsJson, amountFormat);

    // Stream query to research agent
    // System prompt comes from agent config: integrity-step5-code-analyzer
    const workflowConfig = loadWorkflowConfig();

    // Execute with retry logic
    const retryResult = await executeWithRetry(
      `${ticketId} - Code Analysis`,
      async () => {
        // Create research agent session for the identified repository
        const sessionId = await researchAgentService.createSession(
          null, // productId - don't pass when repository_id is specified
          repositoryId, // repositoryId - search only in identified repo
          undefined
        );

        logger.info(`[${ticketId}] ✅ Research Agent Session Created: ${sessionId}`);

        const response = await researchAgentService.streamQuery(
          sessionId,
          codeAnalysisPrompt,
          {
            systemPrompt: agentConfig[workflowConfig.agents.step5].systemPrompt,
            maxTurns: 999,  // No limit - let it run until complete
          }
        );

        return { sessionId, response };
      },
      workflowConfig.retry.enabled ? {
        maxRetries: workflowConfig.retry.maxRetries,
        retryDelayMs: workflowConfig.retry.retryDelayMs,
        exponentialBackoff: workflowConfig.retry.exponentialBackoff,
      } : { maxRetries: 0 }
    );

    if (!retryResult.success || !retryResult.result) {
      throw new Error(formatRetryErrors('Code Analysis', retryResult));
    }

    const { sessionId, response } = retryResult.result;
    logger.info(`[${ticketId}] STEP 5: Code analysis completed`);

    // Write debug files only in development/test mode
    if (config.use_mock_analysis || process.env.NODE_ENV !== 'production') {
      const fs4 = await import('fs/promises');
      const path4 = await import('path');
      const debugData4 = {
        step: 'STEP 5: ANALYZE CODE',
        sessionId,
        prompt: codeAnalysisPrompt,
        systemPrompt: agentConfig[workflowConfig.agents.step5].systemPrompt,
        response: response.analysis
      };
      const ticketLogsDir4 = path4.join(process.cwd(), 'logs', ticketId);
      await fs4.mkdir(ticketLogsDir4, { recursive: true });
      const outputPath4 = path4.join(ticketLogsDir4, 'step5-analyze-code.json');
      await fs4.writeFile(outputPath4, JSON.stringify(debugData4, null, 2));
      logger.info(`[${ticketId}] Response written to ${outputPath4}`);
    }

    // Parse the response - try to extract JSON
    let analysisResult: any;
    try {

      // Try to parse as JSON directly
      analysisResult = JSON.parse(response.analysis);
    } catch (parseError) {
      // Try to extract JSON from code block
      const jsonMatch = response.analysis.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        analysisResult = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Failed to parse code analysis JSON from research agent response');
      }
    }

    logger.info(`[${ticketId}] STEP 5: Code analysis result:`, {
      isOurIssue: analysisResult.is_our_issue,
      repository: analysisResult.repository,
      issueType: analysisResult.issue_type,
      integrityLocationsAnalyzed: analysisResult.integrity_locations_analysis?.length || 0,
    });
    logger.info(`${ticketId}_analyze_code_5_output`, { ...analysisResult, researchAgentSessionId: sessionId });

    return { ...analysisResult, researchAgentSessionId: sessionId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[${ticketId}] STEP 5: Error analyzing code:`, error);
    logger.error(`${ticketId}_analyze_code_5_error`, {
      error: errorMessage,
    });
    throw new Error(`STEP 5 (Code Analysis) failed: ${errorMessage}`);
  }
};

/**
 * Step 5: Decide action based on code analysis
 */
const decideAction = async (
  ticketId: string,
  analysisResult: any
): Promise<'create_pr' | 'escalate_to_gateway'> => {
  logger.info(`[${ticketId}] Deciding action based on analysis result`);
  logger.info(`${ticketId}_decide_action_5_input`, {
    isOurIssue: analysisResult.is_our_issue,
    responsibleParty: analysisResult.responsible_party,
  });

  // Default to create_pr unless explicitly a gateway issue
  if (analysisResult.is_our_issue === false) {
    logger.info(`[${ticketId}] Action: Escalate to gateway (not our issue)`);
    return 'escalate_to_gateway';
  } else {
    // Default: create PR (when is_our_issue is true or undefined)
    logger.info(`[${ticketId}] Action: Create PR to fix our code`);
    return 'create_pr';
  }
};

/**
 * Create PR summary for display in workflow steps
 */
const createPRSummary = async (
  prLink: string | undefined,
  commitHash: string | undefined,
  analysisResult: any,
  gateway: string
): Promise<{
  prLink: string;
  commitHash: string;
  filesChanged: number;
  summary: string;
  issueType: string;
  gateway: string;
  repository: string;
}> => {
  const filesChanged = analysisResult.affected_files?.length || 0;

  let summary = `## PR Created for ${gateway} Integrity Fix\n\n`;
  summary += `**Issue Type**: ${analysisResult.issue_type}\n`;
  summary += `**Repository**: ${analysisResult.repository}\n`;
  summary += `**Files Changed**: ${filesChanged}\n\n`;

  if (analysisResult.analysis_summary) {
    summary += `**Issue Summary**:\n${analysisResult.analysis_summary}\n\n`;
  }

  if (prLink) {
    summary += `**PR Link**: ${prLink}\n\n`;
  }

  if (commitHash && commitHash !== 'No commit created') {
    summary += `**Commit**: ${commitHash}\n\n`;
  }

  if (analysisResult.suggested_fix?.description) {
    summary += `**Fix Description**:\n${analysisResult.suggested_fix.description}\n\n`;
  }

  return {
    prLink: prLink || 'N/A',
    commitHash: commitHash || 'N/A',
    filesChanged,
    summary,
    issueType: analysisResult.issue_type,
    gateway,
    repository: analysisResult.repository,
  };
};

/**
 * Step 6: Prepare fix PR parameters (setup only, actual checkpoint call happens in execute)
 */
const prepareFixPRParams = async (
  ticketId: string,
  analysisResult: any,
  gateway: string,
  identifiedRepository: string
): Promise<{
  initialMessage: string;
  repoUrl: string;
  fixBranchName: string;
  skipBranchCheckout: boolean;
  localRepoPath?: string;
  repository: 'api-gateway' | 'api-txns';
}> => {
  const workflowConfig = loadWorkflowConfig();

  logger.info(`[${ticketId}] Creating fix PR`);

  // Use repository from analysis result, fallback to identified repository or default
  const rawRepository = analysisResult.repository || identifiedRepository || 'api-gateway';

  // Normalize repository name (e.g., "euler-api-gateway" -> "api-gateway")
  const repository = mapRepositoryName(rawRepository);

  if (!analysisResult.repository) {
    logger.warn(`[${ticketId}] Repository not in analysis result, using fallback: ${repository}`);
  }

  logger.info(`${ticketId}_create_fix_pr_6_input`, {
    rawRepository,
    repository,
    affectedFilesCount: analysisResult.affected_files?.length || 0,
    mockMode: config.use_mock_analysis,
  });

  // Determine repository path based on configuration
  // Only required in mock mode (for direct local repo access)
  const localRepoPath = workflowConfig.localRepoPath?.[repository];

  // In mock mode, local repo path is required
  if (config.use_mock_analysis && !localRepoPath) {
    logger.error(`[${ticketId}] Mock mode requires local repository path for ${repository}`);
    throw new Error(`Local repository path not configured for ${repository}. Please set API_TXNS_REPO_PATH or API_GATEWAY_REPO_PATH in .env.local`);
  }

  if (localRepoPath) {
    logger.info(`[${ticketId}] Using local repository at: ${localRepoPath}`);
  }
  logger.info(`[${ticketId}] Mock mode: ${config.use_mock_analysis}`);

  // Build initial user message for agentic checkpoint
  let initialMessage = `Fix the integrity check issue identified in code analysis.\n\n`;

  // Add repo context
  if (config.use_mock_analysis) {
    initialMessage += `**IMPORTANT**: You are working with a local repository at ${localRepoPath!}.\n\n`;
  } else {
    initialMessage += `**Repository**: ${repository}\n\n`;
  }

  initialMessage += `## Analysis Summary\n${analysisResult.analysis_summary}\n\n`;

  if (analysisResult.affected_files && analysisResult.affected_files.length > 0) {
    initialMessage += `## Files to Fix:\n`;
    for (const file of analysisResult.affected_files) {
      initialMessage += `- ${file.file_path || file} (${file.function_name || ''}, lines ${file.line_numbers || file.line || ''})\n`;
      initialMessage += `  Issue: ${file.issue_description || file.issue || ''}\n`;
    }
  }

  initialMessage += `\n## Suggested Fix:\n${analysisResult.suggested_fix?.description || 'See analysis summary'}\n\n`;

  if (analysisResult.suggested_fix?.code_changes && analysisResult.suggested_fix.code_changes.length > 0) {
    initialMessage += `## Code Changes:\n`;
    for (const change of analysisResult.suggested_fix.code_changes) {
      initialMessage += `- ${change.file}: ${change.change_description || change.description || ''}\n`;
    }
  }
  initialMessage += `\n## Instructions:\n`;
  initialMessage += `1. Read the affected files to understand the current implementation\n`;
  initialMessage += `2. Make the necessary code changes as described above\n`;
  initialMessage += `3. **CRITICAL CONSTRAINT**: ${workflowConfig.prompts.fileModificationConstraint}\n`;
  initialMessage += `4. Commit the changes with a descriptive message\n`;
  initialMessage += `5. ${workflowConfig.prompts.prCreationInstructions}\n`;

  if (workflowConfig.prompts.additionalContext) {
    initialMessage += `\n## Additional Context:\n${workflowConfig.prompts.additionalContext}\n`;
  }

  // Create a unique branch name for this fix: integrity-fix-<date>-<gateway>
  const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  const gatewayName = gateway.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const fixBranchName = `${INTEGRITY_GIT_CONFIG.branchPrefix}-${currentDate}-${gatewayName}`;

  // Determine repo configuration based on mode
  // In mock mode: work directly in local repo (no cloning)
  // In production mode: clone from remote and create PR
  const useLocalRepoDirectly = config.use_mock_analysis;
  const repoUrl = useLocalRepoDirectly
    ? localRepoPath!  // Direct path - no cloning (mock mode only) - guaranteed non-null by earlier check
    : (repository === 'api-txns'
      ? 'ssh://git@github.com/example-org/euler-api-txns.git'
      : 'ssh://git@github.com/example-org/euler-api-gateway.git');

  // Skip branch operations when working directly in local repo (mock mode)
  const skipBranchCheckout = useLocalRepoDirectly;

  // Add PR target branch instruction (production mode only)
  if (!config.use_mock_analysis) {
    initialMessage += `\n**IMPORTANT**: When creating the PR, set the target branch to: ${INTEGRITY_GIT_CONFIG.prTargetBranch}\n`;
  }

  logger.info(`[${ticketId}] Prepared fix PR parameters`);

  return {
    initialMessage,
    repoUrl,
    fixBranchName,
    skipBranchCheckout,
    localRepoPath,
    repository,
  };
};

/**
 * Step 7: Generate gateway issue report
 */
const generateGatewayIssueReport = async (
  ticketId: string,
  analysisResult: any,
  collectedLogs: any
): Promise<string> => {
  logger.info(`[${ticketId}] Generating gateway issue report`);
  logger.info(`${ticketId}_generate_gateway_issue_report_7_input`, {
    gateway: collectedLogs.gateway || 'Unknown',
  });

  const logsJson = JSON.stringify(collectedLogs, null, 2);
  const report = formatGatewayIssueReport(analysisResult, logsJson);

  logger.info(`[${ticketId}] Gateway issue report generated`);
  logger.info(`${ticketId}_generate_gateway_issue_report_7_output`, {
    reportLength: report.length,
  });

  return report;
};

// ============================================================================
// Workflow Definition
// ============================================================================

/**
 * Input schema for workflow validation
 */
const IntegrityDebugInputSchema = z.object({
  ticketId: z.string().describe('Ticket ID for this workflow execution'),

  // Input format fields (from API) - optional because context won't have them at top level
  gateway: z.string().optional().describe('Payment gateway name (e.g., SETU, PAYU)'),
  merchantId: z.string().optional().describe('Merchant ID'),
  flow: z.enum(['WEBHOOK', 'SYNC', 'REDIRECTION']).optional().describe('Payment flow type'),
  failureReason: z.string().optional().describe('Failure reason (e.g., INTEGRITY_CHECK_FAILED)'),
  orderIds: z.array(z.string()).optional().describe('Array of order IDs that failed integrity check'),

  // Context format fields (after contextMapper) - optional because input won't have them
  csvData: z.string().optional().describe('CSV data (legacy, not used)'),
  sessions: z.array(z.object({
    orderId: z.string(),
    merchantId: z.string(),
    failureReason: z.string(),
    gateway: z.string(),
    flow: z.enum(['WEBHOOK', 'SYNC', 'REDIRECTION']),
  })).optional().describe('Sessions array (created by contextMapper)'),

  // Optional free-text added to the Step 4 (Log Collection) user prompt under an
  // "## Additional User Info:" header. Useful for gateway-specific quirks, log
  // format hints, or any ad-hoc context the caller wants to give the agent.
  additionalUserInfo: z.string().optional().describe('Optional free-text appended to the Step 4 (Log Collection) user prompt'),
}).passthrough(); // Allow additional fields without validation errors

/**
 * Context mapper to convert payload to workflow context
 * Made idempotent - can be safely called multiple times (creation + execution)
 */
const contextMapper = (payload: any): IntegrityDebugContext => {
  // If payload already has sessions (already transformed), return as-is
  // This happens when runner calls contextMapper on already-transformed context from DB
  if (payload.sessions && Array.isArray(payload.sessions) && payload.sessions.length > 0) {
    return {
      ticketId: payload.ticketId,
      csvData: payload.csvData || '',
      sessions: payload.sessions,
      orderIds: payload.orderIds || [],
      additionalUserInfo: payload.additionalUserInfo,
    };
  }

  // Otherwise, transform raw input into context
  const sessions: SessionData[] = [{
    orderId: payload.orderIds?.[0] || 'unknown', // First order ID for compatibility
    merchantId: payload.merchantId || 'unknown',
    failureReason: payload.failureReason || 'unknown',
    gateway: payload.gateway || 'unknown',
    flow: payload.flow || 'WEBHOOK',
  }];

  return {
    ticketId: payload.ticketId,
    csvData: '', // Not used anymore
    sessions,
    orderIds: payload.orderIds || [], // Store all order IDs
    additionalUserInfo: payload.additionalUserInfo,
  };
};

/**
 * Main workflow execution function
 */
async function execute(
  engine: WorkflowEngine<IntegrityDebugContext, typeof IntegrityDebugWorkflowSteps>
): Promise<IntegrityDebugWorkflowOutput> {
  const context = engine.getContext();
  const ticketId = context.ticketId;

  // Track errors from each step with comprehensive details
  const stepErrors: Array<{
    step: string;
    stepName: string;
    error: string;
    errorStack?: string;
    fallbackUsed?: any;
    timestamp?: string;
  }> = [];

  try {
    // Extract session context from first session
    const firstSession = context.sessions?.[0];
    if (!firstSession) {
      logger.warn(`[${ticketId}] No sessions found in context, using defaults`);
    }
  const gateway = firstSession?.gateway || 'unknown';
  const merchantId = firstSession?.merchantId || 'unknown';
  const flow = firstSession?.flow || 'WEBHOOK';

  // Use orderIds from context (new format) or fall back to sessions (old CSV format)
  const orderIds = context.orderIds || context.sessions?.map(s => s.orderId) || [];

  // STEP 1: Identify repository (continue with fallback on error)
  let identifiedRepository = 'api-gateway'; // Default fallback
  try {
    const repoResult = await engine.createCheckpoint(
      IntegrityDebugWorkflowSteps.IDENTIFY_REPOSITORY,
      identifyRepository,
      ticketId,
      gateway
    );
    // Normalize repository name (e.g., "euler-api-gateway" -> "api-gateway")
    identifiedRepository = mapRepositoryName(repoResult.repository);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error(`[${ticketId}] STEP 1 Failed: ${errorMsg} - continuing with fallback: ${identifiedRepository}`);

    stepErrors.push({
      step: 'identify_repository',
      stepName: 'Repository Identification',
      error: errorMsg,
      errorStack: errorStack?.substring(0, 500),
      fallbackUsed: identifiedRepository,
      timestamp: new Date().toISOString(),
    });
  }

  // STEP 2: Discover log requirements (continue with fallback on error)
  let logRequirements: any = { integrity_locations_found: [], log_paths: [] }; // Default fallback
  try {
    logRequirements = await engine.createCheckpoint(
      IntegrityDebugWorkflowSteps.DISCOVER_LOG_REQUIREMENTS,
      discoverLogRequirements,
      ticketId,
      gateway,
      orderIds,
      merchantId,
      flow,
      identifiedRepository
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error(`[${ticketId}] STEP 2 Failed: ${errorMsg} - continuing with empty log requirements`);
    stepErrors.push({
      step: 'discover_log_requirements',
      stepName: 'Log Requirements Discovery',
      error: errorMsg,
      errorStack: errorStack?.substring(0, 500),
      fallbackUsed: logRequirements,
      timestamp: new Date().toISOString(),
    });
  }

  // STEP 3: Fetch logs based on requirements (continue with fallback on error)
  let collectedLogs: any = { sessions: [] }; // Default fallback
  try {
    collectedLogs = await engine.createCheckpoint(
      IntegrityDebugWorkflowSteps.FETCH_LOGS,
      fetchLogs,
      ticketId,
      gateway,
      orderIds,
      merchantId,
      flow,
      logRequirements,
      context.additionalUserInfo
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error(`[${ticketId}] STEP 3 Failed: ${errorMsg} - continuing with empty logs`);
    stepErrors.push({
      step: 'fetch_logs',
      stepName: 'Log Collection',
      error: errorMsg,
      errorStack: errorStack?.substring(0, 500),
      fallbackUsed: collectedLogs,
      timestamp: new Date().toISOString(),
    });
  }

  // STEP 4: Analyze amount logic using Money framework with collected logs (continue with fallback on error)
  let amountFormat: any = { amount_format: 'unknown', calculated_amount: 'unknown' }; // Default fallback
  try {
    amountFormat = await engine.createCheckpoint(
      IntegrityDebugWorkflowSteps.DISCOVER_AMOUNT_FORMAT,
      discoverAmountFormat,
      ticketId,
      gateway,
      identifiedRepository,
      collectedLogs
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error(`[${ticketId}] STEP 4 Failed: ${errorMsg} - continuing with unknown amount format`);
    stepErrors.push({
      step: 'discover_amount_format',
      stepName: 'Amount Format Analysis',
      error: errorMsg,
      errorStack: errorStack?.substring(0, 500),
      fallbackUsed: amountFormat,
      timestamp: new Date().toISOString(),
    });
  }

  // STEP 5: Comprehensive code analysis (with amount format context) (continue with fallback on error)
  let analysisResult: any = {
    is_our_issue: false,
    issue_type: 'unknown',
    analysis_summary: 'Analysis could not be completed',
    affected_files: [],
    suggested_fix: { code_changes: [] }
  }; // Default fallback
  try {
    analysisResult = await engine.createCheckpoint(
      IntegrityDebugWorkflowSteps.ANALYZE_CODE,
      analyzeCode,
      ticketId,
      gateway,
      orderIds,
      merchantId,
      collectedLogs,
      identifiedRepository,
      amountFormat
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error(`[${ticketId}] STEP 5 Failed: ${errorMsg} - continuing with incomplete analysis`);
    stepErrors.push({
      step: 'analyze_code',
      stepName: 'Code Analysis',
      error: errorMsg,
      errorStack: errorStack?.substring(0, 500),
      fallbackUsed: analysisResult,
      timestamp: new Date().toISOString(),
    });
  }

  // Step 6: Decide action
  const action = await engine.createCheckpoint(
    IntegrityDebugWorkflowSteps.DECIDE_ACTION,
    decideAction,
    ticketId,
    analysisResult
  );

  let prLink: string | undefined;
  let gitDiff: string | undefined;
  let commitHash: string | undefined;
  let gatewayIssueReport: string | undefined;

  if (action === 'create_pr') {
    // Step 6: Prepare fix PR parameters
    const fixPRParams = await prepareFixPRParams(ticketId, analysisResult, gateway, identifiedRepository);
    const workflowConfig = loadWorkflowConfig();

    // Create fix PR using agentic checkpoint (in main execute function for AST graph generation)
    const agenticResult = await engine.createAgenticCheckpoint(
      IntegrityDebugWorkflowSteps.CREATE_FIX_PR,
      'integrity-fix-agent',
      {
        repoInfo: {
          repoUrl: fixPRParams.repoUrl,
          repoBranch: fixPRParams.skipBranchCheckout ? undefined : fixPRParams.fixBranchName,
          baseBranch: fixPRParams.skipBranchCheckout ? undefined : getRepositoryBaseBranch(fixPRParams.repository),
          earlyPRCreation: !config.use_mock_analysis,  // Always create PR in production mode
          getCommitMessage: (raw_commit_message: string) => `EUL-0000 ${raw_commit_message}`,
        },
        conversationContext: {
          initialUserMessage: fixPRParams.initialMessage,
        },
      }
    );

    // Get the git diff from the agentic result
    gitDiff = formatGitDiff(agenticResult.gitInfo?.gitDiff);
    commitHash = agenticResult.gitInfo?.commitHash || 'No commit created';
    const prLinkFromAgent = agenticResult.gitInfo?.pullRequestUrl || agenticResult.gitInfo?.pr_link;

    logger.info(`[${ticketId}] Changes committed: ${commitHash}`);
    logger.info(`[${ticketId}] Git diff:\n${gitDiff}`);

    // In mock mode, log where changes were made
    if (config.use_mock_analysis) {
      logger.info(`[${ticketId}] ✅ MOCK MODE: Changes made to ${fixPRParams.localRepoPath}`);
      logger.info(`[${ticketId}] To view changes: cd ${fixPRParams.localRepoPath} && git diff`);
      console.log(`\n✅ MOCK MODE: Changes made to ${fixPRParams.localRepoPath}`);
      console.log(`To view changes: cd ${fixPRParams.localRepoPath} && git diff\n`);
    }

    // Apply changes to local repository if configured (for non-mock mode)
    if (!config.use_mock_analysis && workflowConfig.applyChangesToLocalRepo && fixPRParams.localRepoPath && agenticResult.gitInfo?.workingDirectory) {
      logger.info(`[${ticketId}] Applying changes to local repository: ${fixPRParams.localRepoPath}`);
      try {
        const { execSync } = await import('child_process');

        // Get the workspace directory where changes were made
        const workspaceDir = agenticResult.gitInfo.workingDirectory;

        // Create the same branch in local repo
        const baseBranch = getRepositoryBaseBranch(fixPRParams.repository);
        execSync(`cd "${fixPRParams.localRepoPath}" && git checkout -b ${fixPRParams.fixBranchName} ${baseBranch} 2>/dev/null || git checkout ${fixPRParams.fixBranchName}`, { encoding: 'utf-8' });

        // Get the patch from workspace
        const patch = execSync(`cd "${workspaceDir}" && git format-patch -1 ${commitHash} --stdout`, { encoding: 'utf-8' });

        // Apply the patch to local repo
        execSync(`cd "${fixPRParams.localRepoPath}" && git am --3way`, { input: patch, encoding: 'utf-8' });

        logger.info(`[${ticketId}] ✅ Successfully applied changes to ${fixPRParams.localRepoPath} on branch ${fixPRParams.fixBranchName}`);
        logger.info(`[${ticketId}] To view changes: cd ${fixPRParams.localRepoPath} && git diff ${baseBranch}..${fixPRParams.fixBranchName}`);
      } catch (error) {
        logger.error(`[${ticketId}] ❌ Failed to apply changes to local repo:`, error);
        logger.info(`[${ticketId}] You can manually apply the git diff shown above`);
      }
    }

    logger.info(`${ticketId}_create_fix_pr_6_output`, {
      commitHash,
      diffLength: gitDiff?.length || 0,
      prLink: prLinkFromAgent || 'N/A',
      mode: config.use_mock_analysis ? 'mock' : 'production',
      appliedToLocal: workflowConfig.applyChangesToLocalRepo
    });

    // Set final PR link
    prLink = config.use_mock_analysis
      ? `MOCK MODE: Changes applied to ${fixPRParams.localRepoPath}. Run: cd ${fixPRParams.localRepoPath} && git diff`
      : prLinkFromAgent || (workflowConfig.applyChangesToLocalRepo && fixPRParams.localRepoPath
        ? `Changes applied to ${fixPRParams.localRepoPath} on branch ${fixPRParams.fixBranchName}`
        : `Local changes committed (commit: ${commitHash})`);

    // Step 7: Create PR Summary for display
    const prSummary = await engine.createCheckpoint(
      IntegrityDebugWorkflowSteps.SUMMARIZE_PR,
      createPRSummary,
      prLink,
      commitHash,
      analysisResult,
      gateway
    );

    logger.info(`${ticketId}_summarize_pr_7_output`, prSummary);
  }

  // Generate gateway issue report if it's a gateway issue OR if there's escalation details
  if (action === 'escalate_to_gateway' || analysisResult.gateway_escalation_details) {
    gatewayIssueReport = await engine.createCheckpoint(
      IntegrityDebugWorkflowSteps.GENERATE_GATEWAY_ISSUE_REPORT,
      generateGatewayIssueReport,
      ticketId,
      analysisResult,
      collectedLogs
    );

    logger.info(`${ticketId}_generate_gateway_report_output`, {
      hasReport: !!gatewayIssueReport,
      reportLength: gatewayIssueReport?.length || 0,
    });
  }

  const workflowOutput: IntegrityDebugWorkflowOutput = {
    sessionsAnalyzed: orderIds?.length || 0,
    issueType: action === 'create_pr' ? ('our_issue' as const) : ('gateway_issue' as const),
    repository: analysisResult?.repository || undefined,
    prLink,
    gitDiff,
    commitHash,
    gatewayIssueReport,
    logsAggregated: collectedLogs, // Now using collected logs instead of aggregated logs
    analysisDetails: analysisResult,
    // New fields from 4-step workflow
    logRequirements,
    integrityLocationsAnalyzed: analysisResult?.integrity_locations_analysis?.length || 0,
    // Include step errors if any steps failed
    stepErrors: stepErrors?.length > 0 ? stepErrors : undefined,
  };

  return workflowOutput;
  } catch (error) {
    // Determine which step failed by checking the error stack or message
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Try to identify the step that failed
    let failedStep = 'unknown';
    let failedStepName = 'Unknown Step';

    if (errorMessage.includes('repository') || errorMessage.includes('STEP 1')) {
      failedStep = IntegrityDebugWorkflowSteps.IDENTIFY_REPOSITORY;
      failedStepName = 'Repository Identification';
    } else if (errorMessage.includes('log requirements') || errorMessage.includes('STEP 2')) {
      failedStep = IntegrityDebugWorkflowSteps.DISCOVER_LOG_REQUIREMENTS;
      failedStepName = 'Log Requirements Discovery';
    } else if (errorMessage.includes('fetch') || errorMessage.includes('logs') || errorMessage.includes('STEP 3')) {
      failedStep = IntegrityDebugWorkflowSteps.FETCH_LOGS;
      failedStepName = 'Log Collection';
    } else if (errorMessage.includes('amount') || errorMessage.includes('STEP 4')) {
      failedStep = IntegrityDebugWorkflowSteps.DISCOVER_AMOUNT_FORMAT;
      failedStepName = 'Amount Format Analysis';
    } else if (errorMessage.includes('code analysis') || errorMessage.includes('STEP 5')) {
      failedStep = IntegrityDebugWorkflowSteps.ANALYZE_CODE;
      failedStepName = 'Code Analysis';
    } else if (errorMessage.includes('PR') || errorMessage.includes('commit') || errorMessage.includes('STEP 6')) {
      failedStep = IntegrityDebugWorkflowSteps.CREATE_FIX_PR;
      failedStepName = 'Create Fix PR';
    } else if (errorMessage.includes('gateway') || errorMessage.includes('report')) {
      failedStep = IntegrityDebugWorkflowSteps.GENERATE_GATEWAY_ISSUE_REPORT;
      failedStepName = 'Generate Gateway Issue Report';
    }

    logger.error(`[${ticketId}] Workflow failed at step: ${failedStepName}`);
    logger.error(`[${ticketId}] Error message: ${errorMessage}`);
    logger.error(`${ticketId}_workflow_error`, {
      step: failedStep,
      stepName: failedStepName,
      errorMessage,
      errorStack: errorStack?.substring(0, 500), // Limit stack trace length
    });

    // Save error details to a checkpoint so it's available in the API response and visible in steps
    const errorDetails = {
      failureReason: `Workflow failed at: ${failedStepName}`,
      errorMessage: errorMessage,
      failedStep: failedStep,
      failedStepName: failedStepName,
      errorDetails: errorStack?.substring(0, 1000),
      timestamp: new Date().toISOString(),
      howToDebug: `Check the logs for step "${failedStepName}" (${failedStep}) to see the full error details.`,
      // Also include partial workflow output for context
      partialResults: {
        sessionsAnalyzed: 0,
        issueType: 'our_issue' as const,
        logsAggregated: {},
        analysisDetails: {},
      }
    };

    try {
      await engine.createCheckpoint(
        IntegrityDebugWorkflowSteps.SAVE_ERROR_DETAILS,
        async () => errorDetails
      );

      logger.info(`[${ticketId}] Error details saved to step: ${IntegrityDebugWorkflowSteps.SAVE_ERROR_DETAILS}`);
    } catch (e) {
      logger.warn(`[${ticketId}] Failed to save error details to checkpoint:`, e);
    }

    // Now throw the error so workflow is marked as FAILURE
    const structuredError = new Error(errorMessage);
    (structuredError as any).workflowError = {
      step: failedStep,
      stepName: failedStepName,
      details: errorStack?.substring(0, 1000),
      timestamp: new Date().toISOString(),
    };

    throw structuredError;
  }
}

// ============================================================================
// Export Workflow Definition
// ============================================================================

export const integrityDebugWorkflow: WorkflowDefinition<
  IntegrityDebugContext,
  IntegrityDebugWorkflowOutput,
  typeof IntegrityDebugWorkflowSteps
> = {
  type: WorkflowType.INTEGRITY_DEBUG_WORKFLOW,
  name: 'Integrity Debug Workflow',
  description: 'Automated debugging of payment integrity check failures',
  inputSchema: IntegrityDebugInputSchema,
  contextMapper,
  execute,
  category: 'debugging',
  tags: ['payments', 'integrity', 'debugging', 'automated'],
  priority: 'high',
  estimatedDuration: 15 * 60 * 1000, // 15 minutes
};