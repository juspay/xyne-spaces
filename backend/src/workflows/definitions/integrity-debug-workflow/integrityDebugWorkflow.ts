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
import { formatGatewayIssueReport } from './utils.js';
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
  GENERATE_GATEWAY_ISSUE_REPORT = 'generate_gateway_issue_report',
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
): Promise<string> => {
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
    return mockResult.repository;
  }

  try {
    const workflowConfig = loadWorkflowConfig();
    
    // Create research agent session with product ID to search across all repos in product
    const sessionId = await researchAgentService.createSession(
      process.env.RESEARCH_AGENT_PRODUCT_ID || null, // productId - search within product
      null, // repositoryId - no specific repo, search all repos in product
      undefined
    );

    logger.info(`[${ticketId}] Created research agent session: ${sessionId}`);

    // Build repository identification prompt (Step 1)
    const repoIdentificationPrompt = buildStep1RepositoryIdentificationPrompt(gateway);

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

    logger.info(`[${ticketId}] STEP 1: Repository identification completed`);

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
    });

    return identificationResult.repository;
  } catch (error) {
    logger.error(`[${ticketId}] STEP 1: Error identifying repository:`, error);
    logger.error(`${ticketId}_identify_repository_1_error`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
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
  logger.info(`${ticketId}_discover_amount_format_4_input`, { gateway, repository: identifiedRepository, logsCollected: Object.keys(collectedLogs).length });

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

    const sessionId = await researchAgentService.createSession(
      null,
      repositoryId,
      undefined
    );

    logger.info(`[${ticketId}] Created research agent session: ${sessionId}`);

    // Build prompt with collected logs data
    const logsJson = JSON.stringify(collectedLogs, null, 2);
    const amountFormatPrompt = buildStep2AmountFormatPrompt(gateway, logsJson);
    const workflowConfig = loadWorkflowConfig();

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
    logger.info(`${ticketId}_discover_amount_format_4_output`, amountFormatResult);

    return amountFormatResult;
  } catch (error) {
    logger.error(`[${ticketId}] STEP 4: Error analyzing amount logic:`, error);
    logger.error(`${ticketId}_discover_amount_format_4_error`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
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
    orderCount: orderIds.length,
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

    // Create research agent session for the identified repository
    const sessionId = await researchAgentService.createSession(
      null, // productId - don't pass when repository_id is specified
      repositoryId, // repositoryId - search in identified repo
      undefined
    );

    logger.info(`[${ticketId}] Created research agent session: ${sessionId}`);

    // Build log requirements discovery prompt (Step 2)
    const logRequirementsPrompt = buildStep3LogRequirementsPrompt(gateway, orderIds, merchantId, flow);

    const workflowConfig = loadWorkflowConfig();
    
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
    logger.info(`${ticketId}_discover_log_requirements_2_output`, requirementsResult);

    return requirementsResult;
  } catch (error) {
    logger.error(`[${ticketId}] STEP 2: Error discovering log requirements:`, error);
    logger.error(`${ticketId}_discover_log_requirements_2_error`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
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
  logRequirements: any
): Promise<any> => {
  logger.info(`[${ticketId}] STEP 3: Fetching logs for ${orderIds.length} orders`);
  logger.info(`${ticketId}_fetch_logs_3_input`, {
    gateway,
    orderIds,
    orderCount: orderIds.length,
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
    // Create research agent session for log collection
    const sessionId = await researchAgentService.createSession(
      process.env.RESEARCH_AGENT_PRODUCT_ID || null, // productId - for log access
      null, // repositoryId - logs are not in a specific repository
      undefined
    );

    logger.info(`[${ticketId}] Created research agent session: ${sessionId}`);

    // Build log collection prompt (Step 3)
    // Handle both field names: required_fields or required_fields_for_dry_run
    const requiredFields = logRequirements.required_fields || logRequirements.required_fields_for_dry_run;
    const logCollectionPrompt = buildStep4LogCollectionPrompt(
      gateway,
      orderIds,
      merchantId,
      requiredFields,
      flow
    );

    const workflowConfig = loadWorkflowConfig();

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
    logger.info(`${ticketId}_fetch_logs_3_output`, {
      fieldsCollected: Object.keys(collectedLogs).length,
    });

    return collectedLogs;
  } catch (error) {
    logger.error(`[${ticketId}] STEP 3: Error fetching logs:`, error);
    logger.error(`${ticketId}_fetch_logs_3_error`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
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
    orderCount: orderIds.length,
    merchantId,
    repository: identifiedRepository,
    logsCollected: Object.keys(collectedLogs).length,
    amountFormat: amountFormat.amount_format,
    multiplier: amountFormat.multiplier,
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

    // Create research agent session for the identified repository
    const sessionId = await researchAgentService.createSession(
      null, // productId - don't pass when repository_id is specified
      repositoryId, // repositoryId - search only in identified repo
      undefined
    );

    logger.info(`[${ticketId}] Created research agent session: ${sessionId}`);

    // Build code analysis prompt with collected logs and amount format (Step 5)
    const logsJson = JSON.stringify(collectedLogs, null, 2);
    const codeAnalysisPrompt = buildStep5CodeAnalysisPrompt(gateway, orderIds, merchantId, logsJson, amountFormat);

    // Stream query to research agent
    // System prompt comes from agent config: integrity-step5-code-analyzer
    const workflowConfig = loadWorkflowConfig();
    const response = await researchAgentService.streamQuery(
      sessionId,
      codeAnalysisPrompt,
      {
        systemPrompt: agentConfig[workflowConfig.agents.step5].systemPrompt,
        maxTurns: 999,  // No limit - let it run until complete
      }
    );

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
    logger.info(`${ticketId}_analyze_code_5_output`, analysisResult);

    return analysisResult;
  } catch (error) {
    logger.error(`[${ticketId}] STEP 5: Error analyzing code:`, error);
    logger.error(`${ticketId}_analyze_code_5_error`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
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

  if (analysisResult.is_our_issue && analysisResult.responsible_party === 'our_code') {
    logger.info(`[${ticketId}] Action: Create PR to fix our code`);
    return 'create_pr';
  } else {
    logger.info(`[${ticketId}] Action: Escalate to gateway`);
    return 'escalate_to_gateway';
  }
};

/**
 * Step 6: Prepare fix PR parameters (setup only, actual checkpoint call happens in execute)
 */
const prepareFixPRParams = async (
  ticketId: string,
  analysisResult: any,
  gateway: string
): Promise<{
  initialMessage: string;
  repoUrl: string;
  fixBranchName: string;
  skipBranchCheckout: boolean;
  localRepoPath: string;
}> => {
  const workflowConfig = loadWorkflowConfig();

  logger.info(`[${ticketId}] Creating fix PR`);
  logger.info(`${ticketId}_create_fix_pr_6_input`, {
    repository: analysisResult.repository,
    affectedFilesCount: analysisResult.affected_files.length,
    createRealPR: workflowConfig.createRealPR,
    mockMode: config.use_mock_analysis,
  });

  if (!analysisResult.repository) {
    throw new Error('Repository not identified in code analysis');
  }

  // Determine repository path based on configuration
  const localRepoPath = workflowConfig.localRepoPath?.[analysisResult.repository as 'api-txns' | 'api-gateway'];
  if (!localRepoPath) {
    throw new Error(`Local repository path not configured for ${analysisResult.repository}. Please set API_TXNS_REPO_PATH or API_GATEWAY_REPO_PATH in .env.local`);
  }

  logger.info(`[${ticketId}] Using local repository at: ${localRepoPath}`);
  logger.info(`[${ticketId}] Create real PR: ${workflowConfig.createRealPR}`);
  logger.info(`[${ticketId}] Mock mode: ${config.use_mock_analysis}`);

  // Build initial user message for agentic checkpoint
  let initialMessage = `Fix the integrity check issue identified in code analysis.\n\n`;

  // Add repo context based on mode
  if (workflowConfig.createRealPR) {
    initialMessage += `**Repository**: ${analysisResult.repository}\n\n`;
  } else {
    initialMessage += `**IMPORTANT**: You are working with a local repository at ${localRepoPath}.\n\n`;
  }

  initialMessage += `## Analysis Summary\n${analysisResult.analysis_summary}\n\n`;
  initialMessage += `## Files to Fix:\n`;
  for (const file of analysisResult.affected_files) {
    initialMessage += `- ${file.file_path} (${file.function_name}, lines ${file.line_numbers})\n`;
    initialMessage += `  Issue: ${file.issue_description}\n`;
  }
  initialMessage += `\n## Suggested Fix:\n${analysisResult.suggested_fix.description}\n\n`;
  initialMessage += `## Code Changes:\n`;
  for (const change of analysisResult.suggested_fix.code_changes) {
    initialMessage += `- ${change.file}: ${change.change_description}\n`;
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
  // When CREATE_REAL_PR=false, work directly in local repo (no cloning)
  // When CREATE_REAL_PR=true, clone from remote
  const useLocalRepoDirectly = !workflowConfig.createRealPR || config.use_mock_analysis;
  const repoUrl = useLocalRepoDirectly
    ? localRepoPath  // Direct path - no cloning
    : (analysisResult.repository === 'api-txns'
      ? 'https://bitbucket.example.com/scm/be/euler-api-txns.git'
      : 'https://bitbucket.example.com/scm/be/euler-api-gateway.git');

  // Skip branch operations when working directly in local repo
  const skipBranchCheckout = useLocalRepoDirectly;

  // Add PR target branch instruction to the initial message
  if (workflowConfig.createRealPR && !config.use_mock_analysis) {
    initialMessage += `\n**IMPORTANT**: When creating the PR, set the target branch to: ${INTEGRITY_GIT_CONFIG.prTargetBranch}\n`;
  }

  logger.info(`[${ticketId}] Prepared fix PR parameters`);

  return {
    initialMessage,
    repoUrl,
    fixBranchName,
    skipBranchCheckout,
    localRepoPath,
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
  gateway: z.string().describe('Payment gateway name (e.g., SETU, PAYU)'),
  merchantId: z.string().describe('Merchant ID'),
  flow: z.enum(['WEBHOOK', 'SYNC', 'REDIRECTION']).describe('Payment flow type'),
  failureReason: z.string().describe('Failure reason (e.g., INTEGRITY_CHECK_FAILED)'),
  orderIds: z.array(z.string()).describe('Array of order IDs that failed integrity check'),
});

/**
 * Context mapper to convert payload to workflow context
 */
const contextMapper = (payload: any): IntegrityDebugContext => {
  // Create a single session with all order IDs
  const sessions: SessionData[] = [{
    orderId: payload.orderIds[0], // First order ID for compatibility
    merchantId: payload.merchantId,
    failureReason: payload.failureReason,
    gateway: payload.gateway,
    flow: payload.flow,
  }];

  return {
    ...payload, // Include all original fields for validation on resume
    ticketId: payload.ticketId,
    csvData: '', // Not used anymore
    sessions,
    orderIds: payload.orderIds, // Store all order IDs
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

  logger.info(`[${ticketId}] Starting NEW 4-STEP Integrity Debug Workflow`);
  logger.info(`${ticketId}_workflow_start`, {
    sessionCount: context.sessions.length,
  });

  // Extract session context from first session
  const firstSession = context.sessions[0];
  if (!firstSession) {
    throw new Error('No sessions found in context');
  }
  const gateway = firstSession.gateway;
  const merchantId = firstSession.merchantId;
  const flow = firstSession.flow;
  
  // Use orderIds from context (new format) or fall back to sessions (old CSV format)
  const orderIds = context.orderIds || context.sessions.map(s => s.orderId);

  logger.info(`[${ticketId}] Starting NEW 5-STEP Integrity Debug Workflow`);
  logger.info(`[${ticketId}] Session context:`, { gateway, orderIds, merchantId, flow, orderCount: orderIds.length });

  // STEP 1: Identify repository
  const identifiedRepository = await engine.createCheckpoint(
    IntegrityDebugWorkflowSteps.IDENTIFY_REPOSITORY,
    identifyRepository,
    ticketId,
    gateway
  );

  logger.info(`[${ticketId}] STEP 1 Complete: Repository = ${identifiedRepository}`);

  // STEP 2: Discover log requirements
  const logRequirements = await engine.createCheckpoint(
    IntegrityDebugWorkflowSteps.DISCOVER_LOG_REQUIREMENTS,
    discoverLogRequirements,
    ticketId,
    gateway,
    orderIds,
    merchantId,
    flow,
    identifiedRepository
  );

  logger.info(`[${ticketId}] STEP 2 Complete: Discovered ${logRequirements.integrity_locations_found?.length || 0} integrity locations`);

  // STEP 3: Fetch logs based on requirements
  const collectedLogs = await engine.createCheckpoint(
    IntegrityDebugWorkflowSteps.FETCH_LOGS,
    fetchLogs,
    ticketId,
    gateway,
    orderIds,
    merchantId,
    flow,
    logRequirements
  );

  logger.info(`[${ticketId}] STEP 3 Complete: Collected ${Object.keys(collectedLogs).length} log categories`);

  // STEP 4: Analyze amount logic using Money framework with collected logs
  const amountFormat = await engine.createCheckpoint(
    IntegrityDebugWorkflowSteps.DISCOVER_AMOUNT_FORMAT,
    discoverAmountFormat,
    ticketId,
    gateway,
    identifiedRepository,
    collectedLogs
  );

  logger.info(`[${ticketId}] STEP 4 Complete: Amount logic = ${amountFormat.amount_format}, calculated amount = ${amountFormat.calculated_amount}`);

  // STEP 5: Comprehensive code analysis (with amount format context)
  const analysisResult = await engine.createCheckpoint(
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

  logger.info(`[${ticketId}] STEP 5 Complete: Analysis shows ${analysisResult.is_our_issue ? 'OUR ISSUE' : 'GATEWAY ISSUE'}`);

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
    // Step 5: Prepare fix PR parameters
    const fixPRParams = await prepareFixPRParams(ticketId, analysisResult, gateway);
    const workflowConfig = loadWorkflowConfig();

    // Create fix PR using agentic checkpoint (in main execute function for AST graph generation)
    const agenticResult = await engine.createAgenticCheckpoint(
      IntegrityDebugWorkflowSteps.CREATE_FIX_PR,
      'integrity-fix-agent',
      {
        repoInfo: {
          repoUrl: fixPRParams.repoUrl,
          repoBranch: fixPRParams.skipBranchCheckout ? undefined : fixPRParams.fixBranchName,
          baseBranch: fixPRParams.skipBranchCheckout ? undefined : INTEGRITY_GIT_CONFIG.analysisBaseBranch,
          earlyPRCreation: workflowConfig.createRealPR && !config.use_mock_analysis,
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
    if (!config.use_mock_analysis && workflowConfig.applyChangesToLocalRepo && agenticResult.gitInfo?.workingDirectory) {
      logger.info(`[${ticketId}] Applying changes to local repository: ${fixPRParams.localRepoPath}`);
      try {
        const { execSync } = await import('child_process');

        // Get the workspace directory where changes were made
        const workspaceDir = agenticResult.gitInfo.workingDirectory;

        // Create the same branch in local repo
        execSync(`cd "${fixPRParams.localRepoPath}" && git checkout -b ${fixPRParams.fixBranchName} ${INTEGRITY_GIT_CONFIG.analysisBaseBranch} 2>/dev/null || git checkout ${fixPRParams.fixBranchName}`, { encoding: 'utf-8' });

        // Get the patch from workspace
        const patch = execSync(`cd "${workspaceDir}" && git format-patch -1 ${commitHash} --stdout`, { encoding: 'utf-8' });

        // Apply the patch to local repo
        execSync(`cd "${fixPRParams.localRepoPath}" && git am --3way`, { input: patch, encoding: 'utf-8' });

        logger.info(`[${ticketId}] ✅ Successfully applied changes to ${fixPRParams.localRepoPath} on branch ${fixPRParams.fixBranchName}`);
        logger.info(`[${ticketId}] To view changes: cd ${fixPRParams.localRepoPath} && git diff ${INTEGRITY_GIT_CONFIG.analysisBaseBranch}..${fixPRParams.fixBranchName}`);
      } catch (error) {
        logger.error(`[${ticketId}] ❌ Failed to apply changes to local repo:`, error);
        logger.info(`[${ticketId}] You can manually apply the git diff shown above`);
      }
    }

    logger.info(`${ticketId}_create_fix_pr_6_output`, {
      commitHash,
      diffLength: gitDiff?.length || 0,
      prLink: prLinkFromAgent || 'N/A',
      mode: workflowConfig.createRealPR ? 'PR' : 'local',
      appliedToLocal: workflowConfig.applyChangesToLocalRepo
    });

    // Set final PR link
    prLink = config.use_mock_analysis
      ? `MOCK MODE: Changes applied to ${fixPRParams.localRepoPath}. Run: cd ${fixPRParams.localRepoPath} && git diff`
      : workflowConfig.createRealPR && prLinkFromAgent
      ? prLinkFromAgent
      : workflowConfig.applyChangesToLocalRepo
      ? `Changes applied to ${fixPRParams.localRepoPath} on branch ${fixPRParams.fixBranchName}`
      : `Local changes committed at ${fixPRParams.localRepoPath} (commit: ${commitHash})`;
  } else {
    // Step 6: Generate gateway issue report
    gatewayIssueReport = await engine.createCheckpoint(
      IntegrityDebugWorkflowSteps.GENERATE_GATEWAY_ISSUE_REPORT,
      generateGatewayIssueReport,
      ticketId,
      analysisResult,
      collectedLogs
    );
  }

  logger.info(`[${ticketId}] Integrity Debug Workflow completed`);
  logger.info(`${ticketId}_workflow_complete`, {
    issueType: action === 'create_pr' ? 'our_issue' : 'gateway_issue',
    prLink,
    commitHash,
    hasGitDiff: !!gitDiff,
    hasGatewayReport: !!gatewayIssueReport,
  });

  const workflowOutput: IntegrityDebugWorkflowOutput = {
    sessionsAnalyzed: orderIds.length,
    issueType: action === 'create_pr' ? ('our_issue' as const) : ('gateway_issue' as const),
    repository: analysisResult.repository || undefined,
    prLink,
    gitDiff,
    commitHash,
    gatewayIssueReport,
    logsAggregated: collectedLogs, // Now using collected logs instead of aggregated logs
    analysisDetails: analysisResult,
    // New fields from 4-step workflow
    logRequirements,
    integrityLocationsAnalyzed: analysisResult.integrity_locations_analysis?.length || 0,
  };

  logger.info(`[${ticketId}] Returning NEW 4-STEP workflow output`);
  logger.info(`[${ticketId}] Workflow Summary:`, {
    gateway,
    repository: identifiedRepository,
    orderCount: orderIds.length,
    integrityLocations: logRequirements.integrity_locations_found?.length || 0,
    isOurIssue: analysisResult.is_our_issue,
    issueType: analysisResult.issue_type,
    action,
  });
  console.log(`[${ticketId}] NEW 4-STEP Workflow output:`, workflowOutput);

  return workflowOutput;
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
