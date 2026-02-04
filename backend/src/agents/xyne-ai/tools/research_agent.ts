/**
 * Research Agent Tool
 */

import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/env.js';
import type { XyneAIAgentContext, ResearchAgentResponse } from './types.js';
import { XYNE_SPACES_REPOSITORY_ID } from './types.js';
import { getDescription } from './helpers.js';

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create research_agent tool for codebase analysis and technical investigation
 */
export function createResearchAgentTool(): Tool<{ query: string; session_id?: string; follow_up_data?: string }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'research_agent',
      description: getDescription('research_agent'),
      parameters: z.object({
        query: z.string().describe('The research question or code analysis request'),
        session_id: z.string().optional().describe('Optional session ID to continue a previous research conversation'),
        follow_up_data: z.string().optional().describe('JSON string with answers to previous follow-up questions'),
      }),
    },
    execute: async (args, context) => {
      const { query, session_id, follow_up_data } = args;
      const { onStreamEvent } = context;
      
      logger.info(`[Tool] [${context.sessionId}] research_agent: query="${query.substring(0, 100)}...", session_id=${session_id || 'new'}`);
      
      const researchAgentUrl = config.research_agent_url;
      const researchAgentApiKey = config.research_agent_api_key;
      
      // Check for Pomerium cookie auth (for SSO/external access)
      const pomeriumCookie = process.env.RESEARCH_AGENT_POMERIUM_COOKIE;
      const bearerToken = process.env.RESEARCH_AGENT_BEARER_TOKEN;
      
      let headers: Record<string, string>;
      
      if (pomeriumCookie) {
        // Use Pomerium cookie authentication (for SSO access)
        headers = {
          'Accept': 'text/event-stream',
          'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Referer': 'https://research-agent.sso.internal.svc.k8s.office.mum.juspay.net/',
          'Cookie': `_pomerium=${pomeriumCookie}`,
          'Content-Type': 'application/json',
        };
        
        if (bearerToken) {
          headers['Authorization'] = `Bearer ${bearerToken}`;
          logger.info('[Tool] research_agent: Using Pomerium cookie + Bearer token authentication');
        } else {
          logger.info('[Tool] research_agent: Using Pomerium cookie authentication');
        }
      } else if (researchAgentUrl && researchAgentApiKey) {
        // Fallback to API key auth
        const encodedApiKey = Buffer.from(researchAgentApiKey).toString('base64');
        headers = {
          'Authorization': `Bearer ${encodedApiKey}`,
          'Content-Type': 'application/json',
        };
        logger.info('[Tool] research_agent: Using API key authentication');
      } else {
        logger.error('[Tool] research_agent: Missing authentication configuration');
        return 'Error: Research Agent API not configured. Please set RESEARCH_AGENT_URL and RESEARCH_AGENT_API_KEY, or RESEARCH_AGENT_POMERIUM_COOKIE environment variables.';
      }
      
      if (!researchAgentUrl) {
        logger.error('[Tool] research_agent: Missing RESEARCH_AGENT_URL in config');
        return 'Error: Research Agent URL not configured. Please set RESEARCH_AGENT_URL environment variable.';
      }
      
      const RESEARCH_AGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), RESEARCH_AGENT_TIMEOUT_MS);
      
      try {
        // Send start event
        if (onStreamEvent) {
          onStreamEvent({ 
            type: 'research_agent_start', 
            toolName: 'research_agent', 
            query: query.substring(0, 200),
            session_id: session_id || 'creating_new',
          });
        }
        
        let researchSessionId = session_id;
        
        // Step 1: Create or reuse session
        if (!researchSessionId) {
          logger.info(`[Tool] [${context.sessionId}] research_agent: Creating new session`);
          
          const sessionResponse = await fetch(`${researchAgentUrl}/api/chat/sessions`, {
            method: 'POST',
            headers: {
              ...headers,
              'Accept': 'application/json, text/plain, */*',
            },
            body: JSON.stringify({
              repository_id: XYNE_SPACES_REPOSITORY_ID,
              product_id: null,
            }),
            signal: controller.signal,
          });
          
          if (!sessionResponse.ok) {
            const errorText = await sessionResponse.text();
            logger.error(`[Tool] [${context.sessionId}] research_agent: Session creation failed: ${sessionResponse.status} - ${errorText}`);
            
            if (onStreamEvent) {
              onStreamEvent({ type: 'research_agent_error', toolName: 'research_agent', error: `Session creation failed: ${sessionResponse.status}` });
            }
            
            return `Error: Failed to create research session: ${sessionResponse.status}`;
          }
          
          const sessionData = await sessionResponse.json() as { id: string };
          researchSessionId = sessionData.id;
          logger.info(`[Tool] [${context.sessionId}] research_agent: Created session ${researchSessionId}`);
          
          if (onStreamEvent) {
            onStreamEvent({ type: 'research_agent_session_created', toolName: 'research_agent', session_id: researchSessionId });
          }
        } else {
          logger.info(`[Tool] [${context.sessionId}] research_agent: Reusing session ${researchSessionId}`);
        }
        
        // Step 2: Build the query with follow-up data if provided
        let enhancedQuery = query;
        if (follow_up_data) {
          enhancedQuery = `${query}\n\n**Additional Context from Previous Follow-ups**:\n${follow_up_data}\n\nPlease complete your analysis using this information.`;
          logger.info(`[Tool] [${context.sessionId}] research_agent: Enhanced query with follow-up data`);
        }
        
        // Step 3: Stream the research query
        const streamHeaders = {
          ...headers,
          'Accept': 'text/event-stream',
        };
        
        const messageData = {
          content: enhancedQuery,
          system_prompt: '', // Use default system prompt from research agent
          max_turns: 20,
          session_id: researchSessionId,
        };
        
        logger.info(`[Tool] [${context.sessionId}] research_agent: Starting stream request to session ${researchSessionId}`);
        
        const streamResponse = await fetch(`${researchAgentUrl}/api/chat/sessions/${researchSessionId}/stream`, {
          method: 'POST',
          headers: streamHeaders,
          body: JSON.stringify(messageData),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!streamResponse.ok) {
          const errorText = await streamResponse.text();
          logger.error(`[Tool] [${context.sessionId}] research_agent: Stream request failed: ${streamResponse.status} - ${errorText}`);
          
          if (onStreamEvent) {
            onStreamEvent({ type: 'research_agent_error', toolName: 'research_agent', error: `API error: ${streamResponse.status}`, details: errorText });
          }
          
          return `Error: Research Agent API returned status ${streamResponse.status}: ${errorText}`;
        }
        
        const reader = streamResponse.body?.getReader();
        if (!reader) {
          return 'Error: No response body from Research Agent API';
        }
        
        // Step 4: Process SSE stream and wait for 'complete' event
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResponse = '';
        let eventCount = 0;
        let currentEventType = 'data';
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // Parse SSE event type
            if (trimmedLine.startsWith('event:')) {
              currentEventType = trimmedLine.slice(6).trim();
              continue;
            }
            
            // Parse SSE data
            if (trimmedLine.startsWith('data:')) {
              const dataContent = trimmedLine.slice(5).trim();
              if (!dataContent || dataContent === '[DONE]') continue;
              
              try {
                const eventData = JSON.parse(dataContent);
                eventCount++;
                
                // Stream intermediate events
                if (onStreamEvent) {
                  onStreamEvent({ type: `research_agent_${currentEventType}`, toolName: 'research_agent', ...eventData });
                }
                
                // Check for 'complete' event with response
                if (currentEventType === 'complete' && eventData.response) {
                  finalResponse = eventData.response;
                  logger.info(`[Tool] [${context.sessionId}] research_agent: Found 'complete' event`);
                }
                
                currentEventType = 'data';
              } catch {
                // Non-JSON SSE data, skip
              }
            }
          }
        }
        
        logger.info(`[Tool] [${context.sessionId}] research_agent: Stream completed with ${eventCount} events`);
        
        if (!finalResponse) {
          logger.warn(`[Tool] [${context.sessionId}] research_agent: No 'complete' event received`);
          return 'Research query completed but no complete response was received.';
        }
        
        // Step 5: Parse the response into structured format
        let structuredResponse: ResearchAgentResponse;
        try {
          // Try to extract JSON from markdown code blocks
          const jsonMatch = finalResponse.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
          const jsonStr = jsonMatch ? jsonMatch[1] : finalResponse.trim();
          
          const parsed = JSON.parse(jsonStr);
          
          structuredResponse = {
            session_id: researchSessionId!,
            analysis: parsed.analysis || finalResponse,
            follow_ups: parsed.follow_ups || [],
            is_complete: parsed.is_complete ?? true,
            confidence: parsed.confidence || 'MEDIUM',
          };
        } catch {
          // Fallback: treat entire response as analysis
          structuredResponse = {
            session_id: researchSessionId!,
            analysis: finalResponse,
            follow_ups: [],
            is_complete: true,
            confidence: 'MEDIUM',
          };
        }
        
        // Send completion event with structured data
        if (onStreamEvent) {
          onStreamEvent({ 
            type: 'research_agent_complete', 
            toolName: 'research_agent',
            session_id: structuredResponse.session_id,
            is_complete: structuredResponse.is_complete,
            confidence: structuredResponse.confidence,
            follow_ups_count: structuredResponse.follow_ups.length,
          });
        }
        
        // Format response for the LLM
        let formattedResult = `## Research Analysis\n\n${structuredResponse.analysis}`;
        
        if (structuredResponse.follow_ups.length > 0) {
          formattedResult += `\n\n## Follow-up Questions Needed\n\n`;
          formattedResult += `The research agent needs additional information to complete the analysis:\n\n`;
          structuredResponse.follow_ups.forEach((fu, idx) => {
            formattedResult += `${idx + 1}. **${fu.question}**\n   - Justification: ${fu.justification}\n   - Data type needed: ${fu.data_type}\n`;
            if (fu.specific_keys && fu.specific_keys.length > 0) {
              formattedResult += `   - Specific keys: ${fu.specific_keys.join(', ')}\n`;
            }
            formattedResult += '\n';
          });
          formattedResult += `\n**Session ID for continuation:** ${structuredResponse.session_id}\n`;
          formattedResult += `**To continue:** Use the session_id parameter and provide follow_up_data with the requested information.`;
        }
        
        formattedResult += `\n\n---\n**Confidence:** ${structuredResponse.confidence} | **Complete:** ${structuredResponse.is_complete ? 'Yes' : 'No'}`;
        
        return formattedResult;
        
      } catch (error) {
        clearTimeout(timeoutId);
        
        if (error instanceof Error && error.name === 'AbortError') {
          if (onStreamEvent) {
            onStreamEvent({ type: 'research_agent_error', toolName: 'research_agent', error: 'Request timed out' });
          }
          return 'Error: Research Agent request timed out after 10 minutes';
        }
        
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[Tool] [${context.sessionId}] research_agent error:`, error);
        
        if (onStreamEvent) {
          onStreamEvent({ type: 'research_agent_error', toolName: 'research_agent', error: errorMessage });
        }
        
        return `Error calling Research Agent API: ${errorMessage}`;
      }
    },
  };
}

/**
 * Get research_agent tool
 * MUST call initializeTools() before using
 */
export function getResearchAgentTool() {
  return createResearchAgentTool();
}
