import { config } from '@/config/env';
import crypto from 'crypto';
import { ChatSessionResponse, SessionDetailsResponse, CrossVerifyReesposne, ToolCall, GraphInfo } from './types';
import {logger} from '@/utils/logger';

/**
 * Exit codes for workflow checkpoint failures
 * These codes help identify specific failure scenarios and determine if retry is appropriate
 */
export enum WorkflowExitCode {
  // Success codes (0-99)
  SUCCESS = 0,

  // Retriable errors (100-199) - Temporary failures that can be retried
  PARSING_ERROR = 100,
  TIMEOUT = 101,
  NETWORK_ERROR = 102,
  TEMPORARY_SERVICE_ERROR = 103,

  // Non-retriable errors (200-299) - Fatal errors that should not be retried
  INSUFFICIENT_INFORMATION = 200,
  INVALID_INPUT = 201,
  MISSING_REQUIRED_DATA = 202,
  PLACEHOLDER_BUG_REPORT = 203,
  EMPTY_BUG_DESCRIPTION = 204,

  // Analysis errors (300-399)
  NO_ROOT_CAUSE_FOUND = 300,
  NO_CODE_CHANGES_NEEDED = 301,
  ANALYSIS_INCOMPLETE = 302,

  // System errors (400-499)
  UNKNOWN_ERROR = 400,
  CONFIGURATION_ERROR = 401,
}

/**
 * Response structure with exit code
 */
export interface WorkflowResponse<T> {
  exit_code: WorkflowExitCode;
  message?: string;
  data?: T;
}

/**
 * Determine if an exit code indicates a retriable error
 */
export function isRetriableExitCode(exitCode: WorkflowExitCode): boolean {
  return exitCode >= 100 && exitCode < 200;
}

/**
 * Determine if an exit code indicates a fatal error (should stop workflow)
 */
export function isFatalExitCode(exitCode: WorkflowExitCode): boolean {
  return exitCode >= 200 && exitCode < 400;
}

/**
 * Get human-readable message for exit code
 */
export function getExitCodeMessage(exitCode: WorkflowExitCode): string {
  const messages: Record<WorkflowExitCode, string> = {
    [WorkflowExitCode.SUCCESS]: 'Operation completed successfully',
    [WorkflowExitCode.PARSING_ERROR]: 'Failed to parse response - will retry',
    [WorkflowExitCode.TIMEOUT]: 'Operation timed out - will retry',
    [WorkflowExitCode.NETWORK_ERROR]: 'Network error occurred - will retry',
    [WorkflowExitCode.TEMPORARY_SERVICE_ERROR]: 'Temporary service error - will retry',
    [WorkflowExitCode.INSUFFICIENT_INFORMATION]: 'Insufficient information provided in bug report - cannot proceed',
    [WorkflowExitCode.INVALID_INPUT]: 'Invalid input data - cannot proceed',
    [WorkflowExitCode.MISSING_REQUIRED_DATA]: 'Required data is missing - cannot proceed',
    [WorkflowExitCode.PLACEHOLDER_BUG_REPORT]: 'Bug report contains placeholder text - cannot proceed',
    [WorkflowExitCode.EMPTY_BUG_DESCRIPTION]: 'Bug description is empty or meaningless - cannot proceed',
    [WorkflowExitCode.NO_ROOT_CAUSE_FOUND]: 'Unable to determine root cause',
    [WorkflowExitCode.NO_CODE_CHANGES_NEEDED]: 'No code changes required',
    [WorkflowExitCode.ANALYSIS_INCOMPLETE]: 'Analysis could not be completed',
    [WorkflowExitCode.UNKNOWN_ERROR]: 'Unknown error occurred',
    [WorkflowExitCode.CONFIGURATION_ERROR]: 'Configuration error',
  };

  return messages[exitCode] || 'Unknown exit code';
}

/**
 * Custom error class for workflow exit code errors
 */
export class WorkflowExitCodeError extends Error {
  constructor(
    public exitCode: WorkflowExitCode,
    message?: string
  ) {
    super(message || getExitCodeMessage(exitCode));
    this.name = 'WorkflowExitCodeError';
  }
}

const MAX_RETRIES = 3;

/**
 * Selects a graph server URL based on ticket ID using consistent hashing.
 * This ensures the same ticket always routes to the same pod.
 * 
 * @param ticketId - The unique ticket identifier
 * @returns The selected graph server URL
 */
export const getGraphServerUrlForTicket = (ticketId: string): string => {
    const urls = config.nx_graph_server_urls;
    
    if (urls.length === 1) {
        return urls[0];
    }
    
    // Use SHA-256 hash of ticket ID for consistent routing
    const hash = crypto.createHash('sha256').update(ticketId).digest();
    
    // Convert first 4 bytes to a number for index selection
    const hashValue = hash.readUInt32BE(0);
    
    // Modulo operation to select pod index
    const podIndex = hashValue % urls.length;
    
    logger.info(`Routing ticket ${ticketId} to pod ${podIndex}: ${urls[podIndex]}`);
    return urls[podIndex];
};

/**
 * Fetches all graphs loaded on a specific graph server pod
 * @param graphServerUrl - The URL of the graph server pod
 * @returns Array of loaded graph information
 * @throws Error if connection fails or server returns error
 */
export const getLoadedGraphs = async (graphServerUrl: string): Promise<GraphInfo[]> => {
    const response = await fetchWithRetry(`${config.research_agent_url}/api/graphs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `bearer ${config.research_agent_api_key}`
        },
        body: JSON.stringify({
            graph_url: graphServerUrl
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get loaded graphs from ${graphServerUrl}: ${response.statusText} - ${errorText}`);
    }

    const graphs = await response.json() as GraphInfo[];
    logger.info(`Loaded graphs on ${graphServerUrl}:`, graphs.map(g => g.graph_id));
    return graphs;
};

/**
 * Adds/pushes a graph to a specific graph server pod
 * @param graphServerUrl - The URL of the graph server pod
 * @param graphId - The ID of the graph to add
 * @param graphPath - The S3 path to the graph file
 * @returns Success status
 */
export const addGraphToPod = async (graphServerUrl: string, graphId: string, graphPath: string): Promise<boolean> => {
    try {
        logger.info(`Pushing graph ${graphId} to pod ${graphServerUrl}...`);
        
        const payload = {
            graph_url: graphServerUrl,
            graph_id: graphId,
            path: graphPath,
            directed: true,
            xyne: true
        };

        const response = await fetchWithRetry(`${config.research_agent_url}/api/add_graph`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `bearer ${config.research_agent_api_key}`
            },
            body: JSON.stringify(payload)
        }, 240000); // 4 minute timeout for graph loading

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Failed to add graph ${graphId}: ${response.statusText} - ${errorText}`);
            return false;
        }

        logger.info(`Successfully pushed graph ${graphId} to ${graphServerUrl}`);
        return true;
    } catch (error) {
        logger.error(`Error adding graph ${graphId} to pod:`, error);
        return false;
    }
};

/**
 * Builds S3 path for a graph based on repository and commit
 * @param repo - Repository name
 * @param commitId - Commit hash
 * @returns S3 path to the graph file
 */
const buildGraphS3Path = (repo: string, commitId: string): string => {
    if (repo !== commitId) {
        return `s3://euler-jenkins-assets/manifest/${repo}/graph/${commitId}.pkl.xz`;
    } else {
        // fallback to current repo knowledge
        return `s3://euler-jenkins-assets/CODE_GRAPHS_DO_NOT_TOUCH/${commitId}.pkl.xz`;
    }
};

/**
 * Checks if graphs for required repos are available on the pod (any commit version)
 * @param graphServerUrl - The URL of the graph server pod
 * @param requiredRepos - Array of repository names needed
 * @returns Object with available and missing repos
 */
export const checkRepoGraphsAvailability = async (
    graphServerUrl: string,
    requiredRepos: string[]
): Promise<{ available: string[]; missing: string[] }> => {
    try {
        const loadedGraphs = await getLoadedGraphs(graphServerUrl);
        const loadedRepoIds = new Set(loadedGraphs.map(g => g.graph_id));
        
        const available = requiredRepos.filter(repo => loadedRepoIds.has(repo));
        const missing = requiredRepos.filter(repo => !loadedRepoIds.has(repo));
        
        logger.info(`Graph availability on ${graphServerUrl}:`, {
            available,
            missing
        });
        
        return { available, missing };
    } catch (error) {
        logger.error('Error checking repo graph availability (connection failed):', error);
        // On connection error, assume all graphs are missing
        return { available: [], missing: requiredRepos };
    }
};

/**
 * Ensures latest graphs from CODE_GRAPHS_DO_NOT_TOUCH are loaded for required repos
 * Loads graphs SEQUENTIALLY (one at a time) to avoid overloading the server
 * Implements retry logic with 3-minute wait on errors
 * @param graphServerUrl - The URL of the graph server pod
 * @param requiredRepos - Array of repository names needed
 * @returns True if all graphs are available, false otherwise
 */
export const ensureLatestGraphsLoaded = async (
    graphServerUrl: string,
    requiredRepos: string[]
): Promise<boolean> => {
    const MAX_ATTEMPTS = 2;
    const RETRY_DELAY_MS = 3 * 60 * 1000; // 3 minutes
    
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            logger.info(`[Attempt ${attempt}/${MAX_ATTEMPTS}] Verifying latest graphs on ${graphServerUrl} for: ${requiredRepos.join(', ')}`);
            
            // Get currently loaded graphs on this pod
            let loadedGraphs: GraphInfo[];
            try {
                loadedGraphs = await getLoadedGraphs(graphServerUrl);
            } catch (error) {
                logger.error(`Failed to connect to graph server ${graphServerUrl}:`, error);
                
                // If this is the first attempt and we got a connection error, wait and retry
                if (attempt < MAX_ATTEMPTS) {
                    logger.info(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry (pod may be restarting)...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                    continue;
                }
                
                // On last attempt, throw the error
                throw error;
            }
            
            const loadedGraphIds = new Set(loadedGraphs.map(g => g.graph_id));
            
            // Find missing graphs
            let missingGraphs = requiredRepos.filter(id => !loadedGraphIds.has(id));
            
            if (missingGraphs.length === 0) {
                logger.info(`✅ All required graphs are loaded on ${graphServerUrl}`);
                return true;
            }
            
            logger.warn(`⚠️  Missing graphs on ${graphServerUrl}: ${missingGraphs.join(', ')}`);
            logger.info('Loading latest graphs from CODE_GRAPHS_DO_NOT_TOUCH SEQUENTIALLY...');
            
            // Load graphs SEQUENTIALLY (one at a time) to avoid overloading server
            let hadErrors = false;
            for (const graphId of missingGraphs) {
                const s3Path = `s3://euler-jenkins-assets/CODE_GRAPHS_DO_NOT_TOUCH/${graphId}.pkl.xz`;
                logger.info(`Loading ${graphId} from ${s3Path}...`);
                
                const success = await addGraphToPod(graphServerUrl, graphId, s3Path);
                if (!success) {
                    logger.error(`❌ Failed to load ${graphId}`);
                    hadErrors = true;
                    // Don't break - try to load remaining graphs
                }
            }
            
            if (hadErrors) {
                logger.error('❌ Some graphs failed to load');
                
                // Wait and then check which graphs are actually loaded
                if (attempt < MAX_ATTEMPTS) {
                    logger.info(`Waiting ${RETRY_DELAY_MS / 1000} seconds before checking and retrying missing graphs...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                    continue;
                }
            }
            
            // Verify graphs are now loaded
            try {
                const verifyGraphs = await getLoadedGraphs(graphServerUrl);
                const verifyIds = new Set(verifyGraphs.map(g => g.graph_id));
                const stillMissing = requiredRepos.filter(id => !verifyIds.has(id));
                
                if (stillMissing.length === 0) {
                    logger.info('✅ Verification passed: All graphs confirmed loaded');
                    return true;
                } else {
                    logger.warn(`⚠️  Verification failed: Still missing ${stillMissing.join(', ')}`);
                    
                    // If this is not the last attempt, retry after delay
                    if (attempt < MAX_ATTEMPTS) {
                        logger.info(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                        continue;
                    }
                    return false;
                }
            } catch (verifyError) {
                logger.error('Failed to verify loaded graphs:', verifyError);
                
                // If this is not the last attempt, retry after delay
                if (attempt < MAX_ATTEMPTS) {
                    logger.info(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                    continue;
                }
                return false;
            }
        } catch (error) {
            logger.error(`Error on attempt ${attempt}/${MAX_ATTEMPTS}:`, error);
            
            // If this is not the last attempt, retry after delay
            if (attempt < MAX_ATTEMPTS) {
                logger.info(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                continue;
            }
            
            // On last attempt, return false
            return false;
        }
    }
    
    return false;
};

/**
 * Verifies that required graphs are loaded on the pod, and loads them if missing
 * Uses the commits mapping to reconstruct S3 paths for missing graphs
 * Loads graphs SEQUENTIALLY (one at a time) to avoid overloading the server
 * Implements retry logic with 3-minute wait on errors
 * @param graphServerUrl - The URL of the graph server pod
 * @param commits - Mapping of repository names to commit hashes
 * @returns True if all graphs are available, false otherwise
 */
export const ensureGraphsLoaded = async (
    graphServerUrl: string, 
    commits: Record<string, string>
): Promise<boolean> => {
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 3 * 60 * 1000; // 3 minutes
    
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const requiredGraphIds = Object.keys(commits);
            logger.info(`[Attempt ${attempt}/${MAX_ATTEMPTS}] Verifying graphs on ${graphServerUrl} for: ${requiredGraphIds.join(', ')}`);
            
            // Get currently loaded graphs on this pod
            let loadedGraphs: GraphInfo[];
            try {
                loadedGraphs = await getLoadedGraphs(graphServerUrl);
            } catch (error) {
                logger.error(`Failed to connect to graph server ${graphServerUrl}:`, error);
                
                // If this is the first attempt and we got a connection error, wait and retry
                if (attempt < MAX_ATTEMPTS) {
                    logger.info(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry (pod may be restarting)...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                    continue;
                }
                
                // On last attempt, throw the error
                throw error;
            }
            
            const loadedGraphIds = new Set(loadedGraphs.map(g => g.graph_id));
            
            // Find missing graphs
            let missingGraphs = requiredGraphIds.filter(id => !loadedGraphIds.has(id));
            
            if (missingGraphs.length === 0) {
                logger.info(`✅ All required graphs are loaded on ${graphServerUrl}`);
                return true;
            }
            
            logger.warn(`⚠️  Missing graphs on ${graphServerUrl}: ${missingGraphs.join(', ')}`);
            logger.info('Reconstructing S3 paths from commits and loading graphs SEQUENTIALLY...');
            
            // Load graphs SEQUENTIALLY (one at a time) to avoid overloading server
            let hadErrors = false;
            for (const graphId of missingGraphs) {
                const commitId = commits[graphId];
                if (!commitId) {
                    logger.error(`No commit found for graph: ${graphId}`);
                    hadErrors = true;
                    continue;
                }
                
                const s3Path = buildGraphS3Path(graphId, commitId);
                logger.info(`Loading ${graphId} from ${s3Path}...`);
                
                const success = await addGraphToPod(graphServerUrl, graphId, s3Path);
                if (!success) {
                    logger.error(`❌ Failed to load ${graphId}`);
                    hadErrors = true;
                    // Don't break - try to load remaining graphs
                }
            }
            
            if (hadErrors) {
                logger.error('❌ Some graphs failed to load');
                
                // Wait and then check which graphs are actually loaded
                if (attempt < MAX_ATTEMPTS) {
                    logger.info(`Waiting ${RETRY_DELAY_MS / 1000} seconds before checking and retrying missing graphs...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                    continue;
                }
            }
            
            // Verify graphs are now loaded
            try {
                const verifyGraphs = await getLoadedGraphs(graphServerUrl);
                const verifyIds = new Set(verifyGraphs.map(g => g.graph_id));
                const stillMissing = requiredGraphIds.filter(id => !verifyIds.has(id));
                
                if (stillMissing.length === 0) {
                    logger.info('✅ Verification passed: All graphs confirmed loaded');
                    return true;
                } else {
                    logger.warn(`⚠️  Verification failed: Still missing ${stillMissing.join(', ')}`);
                    
                    // If this is not the last attempt, retry after delay
                    if (attempt < MAX_ATTEMPTS) {
                        logger.info(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                        continue;
                    }
                    return false;
                }
            } catch (verifyError) {
                logger.error('Failed to verify loaded graphs:', verifyError);
                
                // If this is not the last attempt, retry after delay
                if (attempt < MAX_ATTEMPTS) {
                    logger.info(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                    continue;
                }
                return false;
            }
        } catch (error) {
            logger.error(`Error on attempt ${attempt}/${MAX_ATTEMPTS}:`, error);
            
            // If this is not the last attempt, retry after delay
            if (attempt < MAX_ATTEMPTS) {
                logger.info(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                continue;
            }
            
            // On last attempt, return false
            return false;
        }
    }
    
    return false;
};

const fetchWithRetry = async (url: string, options: RequestInit, timeout = 600000): Promise<Response> => {
    let lastError: Error | undefined;

    for (let i = 0; i < MAX_RETRIES; i++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        const signal = controller.signal;

        try {
            const response = await fetch(url, { ...options, keepalive: false, signal });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof TypeError) {
                lastError = error;
                logger.warn(`Fetch to ${url} terminated. Retrying (${i + 1}/${MAX_RETRIES})...`);
                await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
                continue;
            }
            if (error instanceof Error && error.name === 'AbortError') {
                logger.error(`Request to ${url} timed out after ${timeout}ms.`);
                lastError = error;
                continue; // Retry on timeout
            }
            // For other errors, fail immediately
            throw error;
        }
    }
    // If all retries fail, throw the last captured error
    throw new Error(`Fetch failed after ${MAX_RETRIES} retries: ${lastError?.message}`);
};

/**
 * Creates a new chat session with the research agent.
 * @param title - The title for the chat session.
 * @param productId - The ID of the product to associate the session with.
 * @returns The ID of the newly created session.
 */
export const createChatSession = async (title: string, productId: string): Promise<string> => {
    const url = `${config.research_agent_url}/api/chat/sessions`;
    const payload = {
        title,
        product_id: productId
    };

    const sessionResponse = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `bearer ${config.research_agent_api_key}`
        },
        body: JSON.stringify(payload)
    });

    if (!sessionResponse.ok) {
        const errorText = await sessionResponse.text();
        throw new Error(`Failed to create chat session: ${sessionResponse.statusText} - ${errorText}`);
    }

    const session = (await sessionResponse.json()) as ChatSessionResponse;
    logger.info(`Session created successfully. ID: ${session.id}`);
    return session.id;
};

/**
 * Streams a response from the research agent for a given session and query.
 * Proactively checks and loads required graphs before making the request.
 * @param sessionId - The ID of the chat session.
 * @param query - The query or prompt to send to the agent.
 * @param ticketId - The ticket ID for routing to the appropriate graph server pod.
 * @param systemPrompt - System prompt defining the LLM's role and behavior (REQUIRED).
 * @param commits - Optional mapping of repository names to commit hashes for graph loading
 * @param requiredRepos - Optional array of repository names needed (for BUG_WORKFLOW without commits)
 * @returns The accumulated text response from the agent.
 */
export const streamAgentResponse = async (
    sessionId: string, 
    query: string, 
    ticketId: string,
    systemPrompt: string,
    commits?: Record<string, string>,
    requiredRepos?: string[]
): Promise<string> => {
    const STREAM_TIMEOUT = 360000;
    const graphServerUrl = getGraphServerUrlForTicket(ticketId);
    
    // PROACTIVE GRAPH CHECK: Ensure graphs are loaded BEFORE making request
    if (commits && Object.keys(commits).length > 0) {
        logger.info('[BUG_WORKFLOW_EVAL] Checking graphs before request...');
        await ensureGraphsLoaded(graphServerUrl, commits);
    } else if (requiredRepos && requiredRepos.length > 0) {
        logger.info('[BUG_WORKFLOW] Checking graphs before request...');
        await ensureLatestGraphsLoaded(graphServerUrl, requiredRepos);
    }
    
    // Helper function to make the actual stream request
    const makeStreamRequest = async (): Promise<string> => {
        const convoResponse = await fetchWithRetry(`${config.research_agent_url}/api/chat/sessions/${sessionId}/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `bearer ${config.research_agent_api_key}`
            },
            body: JSON.stringify({
                content: query,
                nx_graph_url: graphServerUrl,
                system_prompt: systemPrompt
            })
        }, STREAM_TIMEOUT);

        if (!convoResponse.ok) {
            throw new Error(`Failed to start conversation: ${convoResponse.statusText}`);
        }

        const reader = convoResponse.body?.getReader();
        if (!reader) {
            throw new Error('Failed to get response reader');
        }

        let accumulatedResponse = '';
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;

        while (!done) {
            try {
                const { done: streamDone, value } = await reader.read();
                done = streamDone;
                if (value) {
                    buffer += decoder.decode(value, { stream: true });
                }
                if (done) {
                    buffer += decoder.decode();
                }
            } catch (error) {
                logger.error('Stream interrupted mid-read:', error);
                done = true; 
            }

            const parts = buffer.split('\n\n');
            buffer = done ? '' : parts.pop() || '';

            for (const part of parts) {
                if (!part) continue;

                const lines = part.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        try {
                            const data = JSON.parse(line.substring(5));
                            if (data.event_type === 'text_delta' && data.text) {
                                accumulatedResponse += data.text;
                            }
                        } catch (e) {
                            // Ignore JSON parsing errors
                        }
                    }
                }
            }
        }
        return accumulatedResponse;
    };
    
    // Make request (graphs are already verified and loaded above)
    let response = await makeStreamRequest();
    
    // FALLBACK: If still empty, try reloading graphs one more time
    if (!response || response.trim() === '') {
        logger.warn(`⚠️  Empty response received despite graph preloading on ${graphServerUrl}`);
        logger.info('Attempting fallback graph reload...');
        
        let graphsReloaded = false;
        if (commits && Object.keys(commits).length > 0) {
            logger.info('[BUG_WORKFLOW_EVAL] Fallback: Reloading graphs using commits...');
            graphsReloaded = await ensureGraphsLoaded(graphServerUrl, commits);
        } else if (requiredRepos && requiredRepos.length > 0) {
            logger.info('[BUG_WORKFLOW] Fallback: Reloading latest graphs...');
            graphsReloaded = await ensureLatestGraphsLoaded(graphServerUrl, requiredRepos);
        }
        
        if (graphsReloaded) {
            logger.info('Fallback reload successful - retrying request');
            response = await makeStreamRequest();
        } else {
            logger.error('Fallback reload failed - response remains empty');
        }
    }
    
    return response;
};

/**
 * Fetches the tool calls for a given chat session.
 * @param sessionId - The ID of the chat session.
 * @returns An array of tool calls made during the session.
 */
export const getSessionToolCalls = async (sessionId: string): Promise<ToolCall[]> => {
    const sessionOverview = await fetchWithRetry(`${config.research_agent_url}/api/chat/sessions/${sessionId}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `bearer ${config.research_agent_api_key}`
        }
    });

    if (!sessionOverview.ok) {
        const errorText = await sessionOverview.text();
        logger.error(`Failed to get session overview: ${sessionOverview.statusText} - ${errorText}`);
        return [];
    }

    const sessionDetails = await sessionOverview.json() as SessionDetailsResponse;
    if (sessionDetails.tool_calls) {
        return sessionDetails.tool_calls.map((call) => ({
            tool_name: call.tool_name,
            tool_args: call.args,
            result: call.results,
        }));
    }

    return [];
};

export const crossVerify = async (graph: string, moduleList: string[], functionList: string[], ticketId: string): Promise<string> => {
    try {
        const graphServerUrl = getGraphServerUrlForTicket(ticketId);
        const crossVerifyResult = await fetchWithRetry(`${config.research_agent_url}/api/${graph}/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `bearer ${config.research_agent_api_key}`
            },
            body: JSON.stringify({
                graph_url: graphServerUrl,
                module_list: moduleList,
                function_list: functionList
            })
        });

        if (!crossVerifyResult.ok) {
            const errorText = await crossVerifyResult.text();
            logger.error(`Failed to cross verify: ${crossVerifyResult.statusText} - ${errorText}`);
            return '';
        }

        const response = await crossVerifyResult.json() as CrossVerifyReesposne;
        if (response.status === 'failure' && (response.missing_functions || response.missing_modules)) {
            let feedback = 'The following items were not found:';
            if (response.missing_modules) {
                feedback += `\n- Missing Modules: ${response.missing_modules}`;
            }
            if (response.missing_functions) {
                feedback += `\n- Missing Functions: ${response.missing_functions}`;
            }
            return feedback;
        }

        return '';
    } catch (error) {
        logger.error('An unexpected error occurred during cross-verification:', error);
        return '';
    }
}

/**
 * Parses a JSON response from a string, handling markdown code blocks, conversational text, and exit codes.
 * IMPORTANT: This function now THROWS errors instead of returning fallback values.
 * This allows the retry mechanism to work properly.
 * 
 * @param responseText - The text containing the JSON.
 * @returns The parsed JSON object.
 * @throws WorkflowExitCodeError if response contains a fatal exit code.
 * @throws Error if JSON parsing fails (retriable).
 */
export const parseJsonResponse = <T>(responseText: string): T => {
    try {
        let parsedData: any;
        
        // Strategy 1: Try to extract JSON from markdown code blocks
        const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            parsedData = JSON.parse(jsonMatch[1]);
        } else {
            // Strategy 2: Try to find JSON object by looking for { and } at the end
            // (handles case where LLM returns conversational text followed by JSON)
            const lastBraceIndex = responseText.lastIndexOf('}');
            if (lastBraceIndex !== -1) {
                // Find the matching opening brace by counting
                let braceCount = 0;
                let startIndex = -1;
                for (let i = lastBraceIndex; i >= 0; i--) {
                    if (responseText[i] === '}') {
                        braceCount++;
                    } else if (responseText[i] === '{') {
                        braceCount--;
                        if (braceCount === 0) {
                            startIndex = i;
                            break;
                        }
                    }
                }
                
                if (startIndex !== -1) {
                    const jsonCandidate = responseText.substring(startIndex, lastBraceIndex + 1);
                    try {
                        parsedData = JSON.parse(jsonCandidate);
                        logger.info('✅ Successfully extracted JSON from conversational response');
                    } catch (e) {
                        // If extraction failed, try parsing entire response
                        parsedData = JSON.parse(responseText);
                    }
                } else {
                    // Fallback: Try to parse the entire response as JSON
                    parsedData = JSON.parse(responseText);
                }
            } else {
                // Fallback: Try to parse the entire response as JSON
                parsedData = JSON.parse(responseText);
            }
        }
        
        // Check if the response contains an exit_code field
        if (parsedData && typeof parsedData === 'object' && 'exit_code' in parsedData) {
            const exitCode = parsedData.exit_code as WorkflowExitCode;
            
            // Special handling: NO_ROOT_CAUSE_FOUND (300) should be retriable
            if (exitCode === WorkflowExitCode.NO_ROOT_CAUSE_FOUND) {
                logger.info(`🔄 [RETRY-TEST] Detected exit_code 300 - triggering retry mechanism`);
                logger.warn(`⚠️ Retriable analysis error: Exit code ${exitCode} - ${getExitCodeMessage(exitCode)}`);
                throw new Error(`Retriable error: ${getExitCodeMessage(exitCode)}`);
            }
            
            // If exit code indicates a fatal error, throw immediately (don't retry)
            if (isFatalExitCode(exitCode)) {
                logger.error(`❌ Fatal error detected: Exit code ${exitCode} - ${getExitCodeMessage(exitCode)}`);
                throw new WorkflowExitCodeError(
                    exitCode,
                    parsedData.message || getExitCodeMessage(exitCode)
                );
            }
            
            // If exit code indicates success, return the data
            if (exitCode === WorkflowExitCode.SUCCESS) {
                return parsedData.data || parsedData;
            }
            
            // If exit code is retriable, throw an error to trigger retry
            if (isRetriableExitCode(exitCode)) {
                logger.warn(`⚠️ Retriable error: Exit code ${exitCode} - ${getExitCodeMessage(exitCode)}`);
                throw new Error(`Retriable error: ${getExitCodeMessage(exitCode)}`);
            }
        }
        
        return parsedData;
    } catch (error) {
        logger.error('Error parsing JSON response:', error);
        
        // If it's already a WorkflowExitCodeError, re-throw it
        if (error instanceof WorkflowExitCodeError) {
            throw error;
        }
        
        // For parsing errors, re-throw the original error if it's a retriable error
        // This preserves the retry mechanism for exit_code 300/302
        if (error instanceof Error && error.message.includes('Retriable error:')) {
            throw error; // Preserve the original retriable error
        }
        
        // For other parsing errors, throw an error to trigger retry
        throw new Error(`JSON parsing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
};

export const formatObjectToString = (obj: Record<string, any>): string => {
    return Object.entries(obj)
        .map(([key, value]) => {
            if (Array.isArray(value)) {
                return `${key}: ${value.join(', ')}`;
            }
            return `${key}: ${value}`;
        })
        .join('\n');
};
