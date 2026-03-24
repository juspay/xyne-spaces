/**
 * Web Search Tool
 * Uses the @xynehq/jaf package's websearch tool internally
 */

import { z } from 'zod';
import { type Tool, webSearchTool } from '@xynehq/jaf';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { redisService } from '../../../services/redisService.js';
import type { XyneAIAgentContext, EnhancedCitationMappings } from './types.js';
import { getDescription, appendEnhancedSessionMappings, getNextPrefix } from './helpers.js';
import { getWebSearchToolUsedTotal } from '@/services/otel';

// ============================================================================
// Rate Limiting Constants
// ============================================================================

const WEB_SEARCH_RATE_LIMIT_REQUESTS = 10; // Max requests per window
const WEB_SEARCH_RATE_LIMIT_WINDOW_SECONDS = 60; // 1 minute window

// ============================================================================
// Types
// ============================================================================

/**
 * Search result from the web search API
 */
interface SearchResult {
    url: string;
    title: string;
    content: string;
    engine: string;
    score: number;
    publishedDate: string | null;
}

/**
 * Tool result from JAF websearch tool
 */
interface JafToolResult<T> {
    status: 'success' | 'error' | 'validation_error' | 'permission_denied' | 'not_found';
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
    metadata?: {
        executionTimeMs?: number;
        toolName?: string;
        [key: string]: unknown;
    };
}

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create web_search tool with description from Langfuse
 * Uses the @xynehq/jaf package's websearch tool internally
 */
export function createWebSearchTool(): Tool<{ query: string }, XyneAIAgentContext> {
    // Check if web search is configured
    const webSearchUrl = config.webSearch.url;

    if (!webSearchUrl) {
        // Return a disabled tool if not configured
        return {
            schema: {
                name: 'web_search',
                description: 'Web search is not configured. Contact administrator to enable.',
                parameters: z.object({
                    query: z.string().describe('The search query'),
                }),
            },
            execute: async () => {
                return 'Error: Web search is not configured. Please set WEB_SEARCH_URL environment variable.';
            },
        };
    }

    return {
        schema: {
            name: 'web_search',
            description: getDescription('web_search'),
            parameters: z.object({
                query: z.string()
                    .min(1, "Search query cannot be empty")
                    .max(500, "Search query too long")
                    .regex(/^[^<>{}]*$/, "Invalid characters in search query")
                    .transform(q => q.trim())
                    .describe('The search query to execute'),
            }),
        },
        execute: async (args, context) => {
            const { query } = args;

            // Sanitize query for logging - only log length and truncated version
            const sanitizedQuery = query.length > 20 ? `${query.substring(0, 20)}...` : query;
            logger.info(`[Tool] web_search: query_length=${query.length}, sanitized="${sanitizedQuery}"`);

            try {
                // Rate limiting check
                const rateLimitKey = `web_search_rate_limit:${context.userId}`;
                const redis = redisService.getClient();
                
                try {
                    const currentCountStr = await redis.get(rateLimitKey);
                    const currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;
                    
                    if (currentCount >= WEB_SEARCH_RATE_LIMIT_REQUESTS) {
                        logger.warn(`[Tool] web_search: Rate limit exceeded for user ${context.userId}`);
                        return 'Error: Web search rate limit exceeded. Please try again later.';
                    }
                    
                    // Increment counter with expiry
                    if (currentCount === 0) {
                        await redis.setex(rateLimitKey, WEB_SEARCH_RATE_LIMIT_WINDOW_SECONDS, 1);
                    } else {
                        await redis.incr(rateLimitKey);
                    }
                    
                    logger.info(`[Tool] web_search: Rate limit check passed for user ${context.userId} (${currentCount + 1}/${WEB_SEARCH_RATE_LIMIT_REQUESTS})`);
                } catch (rateLimitError) {
                    // Log rate limit check failure but allow the request to proceed
                    logger.error('[Tool] web_search: Rate limit check failed, allowing request:', rateLimitError);
                }

                // Create a timeout promise that rejects after 30 seconds
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => {
                        reject(new Error('Web search timed out after 30 seconds'));
                    }, 30000);
                });

                // Call the JAF websearch tool - returns JafToolResult<{ results: SearchResult[] }>
                const toolResult = await Promise.race([
                    webSearchTool.execute(
                        {
                            hostedWebServerUrl: webSearchUrl,
                            apiKey: config.webSearch.apiKey || '', // Empty string if no API key configured
                            query,
                        },
                        {}
                    ) as Promise<JafToolResult<{ results: SearchResult[] }>>,
                    timeoutPromise,
                ]);

                // Check if the tool call was successful
                if (toolResult.status !== 'success' || !toolResult.data) {
                    // Log detailed error internally but return generic message to user
                    logger.error('[Tool] web_search error:', {
                        status: toolResult.status,
                        error: toolResult.error,
                        query: query.substring(0, 20) + '...' // Sanitized query for logging
                    });
                    
                    // Return user-friendly error message
                    const userMessage = toolResult.status === 'permission_denied' 
                        ? 'Web search access denied. Please contact administrator.'
                        : 'Web search is temporarily unavailable. Please try again later.';
                    
                    return `Error: ${userMessage}`;
                }

                const results = toolResult.data.results;

                if (!results || results.length === 0) {
                    return 'No search results found for the query.';
                }

                // Track web search tool usage
                try {
                    getWebSearchToolUsedTotal().add(1);
                } catch (metricsError) {
                    logger.error('[Tool] web_search: Error recording metrics:', metricsError);
                }

                // Format results for LLM consumption
                const formattedResults = results
                    .slice(0, 30) // Limit to 30 results
                    .map((r: SearchResult, idx: number) => {
                        const title = r.title || 'Untitled';
                        const url = r.url || '#';
                        const content = r.content || '';
                        const engine = r.engine || 'unknown';
                        const publishedDate = r.publishedDate ? ` (Published: ${r.publishedDate})` : '';

                        return `[${idx + 1}] ${title}\nURL: ${url}\nSource: ${engine}${publishedDate}\n${content}`;
                    })
                    .join('\n\n');

                // Store URLs in enhanced session mappings for citation linking
                try {
                    const prefix = await getNextPrefix(context.sessionId);

                    // Build enhanced citation mappings for web search results
                    const entityIdMapping: Record<number, string> = {};
                    const entityTypeMapping: Record<number, 'message' | 'attachment' | 'call' | 'canvas' | 'ticket' | 'web_search'> = {};
                    const externalUrlMapping: Record<number, string | undefined> = {};
                    const isExternalMapping: Record<number, boolean> = {};
                    const conversationIdMapping: Record<number, string | undefined> = {};
                    const messageIdMapping: Record<number, string | undefined> = {};
                    const canvasIdMapping: Record<number, string | undefined> = {};
                    const channelIdMapping: Record<number, string> = {};

                    // Map result indices to URLs with validation
                    results.slice(0, 30).forEach((r, idx) => {
                        if (r.url) {
                            try {
                                const parsedUrl = new URL(r.url);
                                // Only allow http/https protocols
                                if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
                                    const index = idx + 1;
                                    // For web search, we don't have real entities, so we use the URL as entityId
                                    entityIdMapping[index] = r.url;
                                    // Use 'web_search' type for web search results
                                    entityTypeMapping[index] = 'web_search';
                                    externalUrlMapping[index] = r.url; // External URL
                                    isExternalMapping[index] = true; // Mark as external citation
                                    // Web search results don't have conversation/message/canvas IDs
                                    conversationIdMapping[index] = undefined;
                                    messageIdMapping[index] = undefined;
                                    canvasIdMapping[index] = undefined;
                                    channelIdMapping[index] = ''; // No channel for web results
                                } else {
                                    logger.warn(`[Tool] web_search: Skipping invalid URL protocol: ${parsedUrl.protocol}`);
                                }
                            } catch (error) {
                                logger.warn(`[Tool] web_search: Skipping malformed URL: ${r.url}`);
                            }
                        }
                    });

                    // Store enhanced mapping in Redis
                    const enhancedMappings: EnhancedCitationMappings = {
                        entityIdMapping,
                        entityTypeMapping,
                        conversationIdMapping,
                        messageIdMapping,
                        canvasIdMapping,
                        channelIdMapping,
                        externalUrlMapping,
                        isExternalMapping,
                    };

                    await appendEnhancedSessionMappings(context.sessionId, enhancedMappings, prefix);

                    logger.info(`[Tool] web_search: Stored ${Object.keys(externalUrlMapping).length} URLs in enhanced session mappings with prefix ${prefix}`);
                } catch (mappingError) {
                    // Non-blocking error - log but don't fail the tool
                    logger.error('[Tool] web_search: Failed to store URL mappings:', mappingError);
                }

                return `Found ${results.length} search results:\n\n${formattedResults}`;

            } catch (error) {
                logger.error('[Tool] web_search error:', error);
                return `Error: ${error instanceof Error ? error.message : 'Unknown error occurred during web search.'}`;
            }
        },
    };
}

/**
 * Get web_search tool
 * MUST call initializeTools() before using
 */
export function getWebSearchTool() {
    return createWebSearchTool();
}