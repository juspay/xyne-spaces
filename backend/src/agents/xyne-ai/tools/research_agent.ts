/**
 * Research Agent Tool
 */

import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { logger } from '../../../utils/logger.js';
import { researchAgentService, type ResearchAgentResponse } from '../../../services/researchAgentService.js';
import type { XyneAIAgentContext } from './types.js';
import { getDescription } from './helpers.js';
import { askAIResearchAgentUsedTotal } from '@/services/otel';

// ============================================================================
// Types
// ============================================================================

interface ResearchAgentArgs {
  query: string;
  product?: string;
  repository?: string;
  session_id?: string;
  follow_up_data?: string;
}

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create research_agent tool for codebase analysis and technical investigation
 */
export function createResearchAgentTool(): Tool<ResearchAgentArgs, XyneAIAgentContext> {
  return {
    schema: {
      name: 'research_agent',
      description: getDescription('research_agent'),
      parameters: z.object({
        query: z.string().describe('The research question or code analysis request'),
        product: z.string().optional().describe('Product name for the research (e.g., "consumer-credit", "ExpressCheckout"). Mutually exclusive with repository.'),
        repository: z.string().optional().describe('Repository name for the research (e.g., "euler-lsp", "alfred"). Mutually exclusive with product.'),
        session_id: z.string().optional().describe('Optional session ID to continue a previous research conversation'),
        follow_up_data: z.string().optional().describe('JSON string with answers to previous follow-up questions'),
      }),
    },
    execute: async (args, context) => {
      const { query, product, repository, session_id, follow_up_data } = args;
      const { onStreamEvent, productNameToId, repositoryNameToId } = context;
      
      logger.info(`[Tool] [${context.sessionId}] research_agent: query="${query.substring(0, 100)}...", product=${product || 'none'}, repository=${repository || 'none'}, session_id=${session_id || 'new'}`);
      
      // ======================================================================
      // Input Validation
      // ======================================================================
      
      const getAvailableProducts = (): string[] => 
        productNameToId ? Array.from(productNameToId.keys()) : [];
      const getAvailableRepos = (): string[] => 
        repositoryNameToId ? Array.from(repositoryNameToId.keys()) : [];
      
      if (product && repository) {
        return `Error: Cannot specify both product and repository. Choose one:\n` +
          `- To use product: remove repository parameter\n` +
          `- To use repository: remove product parameter`;
      }
      
      let productId: string | null = null;
      let repositoryId: string | null = null;
      
      if (product) {
        productId = productNameToId?.get(product) || null;
        if (!productId) {
          return `Error: Invalid product name "${product}".\n\n` +
            `Available products: [${getAvailableProducts().join(', ')}]\n` +
            `Available repositories: [${getAvailableRepos().join(', ')}]`;
        }
      } else if (repository) {
        repositoryId = repositoryNameToId?.get(repository) || null;
        if (!repositoryId) {
          return `Error: Invalid repository name "${repository}".\n\n` +
            `Available repositories: [${getAvailableRepos().join(', ')}]\n` +
            `Available products: [${getAvailableProducts().join(', ')}]`;
        }
      } else {
        return `Error: Either product or repository is required for research agent.\n\n` +
          `Available products: [${getAvailableProducts().join(', ')}]\n` +
          `Available repositories: [${getAvailableRepos().join(', ')}]`;
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
        
        // Step 1: Create or reuse session
        let researchSessionId = session_id;
        if (!researchSessionId) {
          researchSessionId = await researchAgentService.createSession(
            productId,
            repositoryId,
            controller.signal
          );
          
          if (onStreamEvent) {
            onStreamEvent({ type: 'research_agent_session_created', toolName: 'research_agent', session_id: researchSessionId });
          }
        }
        
        // Step 2: Build the query with follow-up data if provided
        let enhancedQuery = query;
        if (follow_up_data) {
          enhancedQuery = `${query}\n\n**Additional Context from Previous Follow-ups**:\n${follow_up_data}\n\nPlease complete your analysis using this information.`;
        }
        
        // Step 3: Stream the research query using the service
        const structuredResponse = await researchAgentService.streamQuery(
          researchSessionId,
          enhancedQuery,
          {
            onEvent: onStreamEvent,
            signal: controller.signal,
          }
        );
        
        clearTimeout(timeoutId);
        
        // Send completion event
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
        
        // Track Research Agent tool usage
        try {
          askAIResearchAgentUsedTotal.add(1);
        } catch (metricsError) {
          logger.error('[Tool] research_agent: Error recording metrics:', metricsError);
        }
        
        // Format response for the LLM
        return formatResponse(structuredResponse);
        
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
 * Format the structured response for the LLM
 */
function formatResponse(response: ResearchAgentResponse): string {
  let result = `## Research Analysis\n\n${response.analysis}`;
  
  if (response.follow_ups.length > 0) {
    result += `\n\n## Follow-up Questions Needed\n\n`;
    result += `The research agent needs additional information to complete the analysis:\n\n`;
    response.follow_ups.forEach((fu, idx) => {
      result += `${idx + 1}. **${fu.question}**\n   - Justification: ${fu.justification}\n   - Data type needed: ${fu.data_type}\n`;
      if (fu.specific_keys && fu.specific_keys.length > 0) {
        result += `   - Specific keys: ${fu.specific_keys.join(', ')}\n`;
      }
      result += '\n';
    });
    result += `\n**Session ID for continuation:** ${response.session_id}\n`;
    result += `**To continue:** Use the session_id parameter and provide follow_up_data with the requested information.`;
  }
  
  result += `\n\n---\n**Confidence:** ${response.confidence} | **Complete:** ${response.is_complete ? 'Yes' : 'No'}`;
  
  return result;
}

/**
 * Get research_agent tool
 */
export function getResearchAgentTool() {
  return createResearchAgentTool();
}
