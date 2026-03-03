/**
 * Research Agent Service
 * Handles communication with the Research Agent API for products and repositories
 */

import { config } from '@/config/env.js';
import { logger } from '@/utils/logger.js';
import type {
  ResearchProduct,
  ResearchRepository,
  ResearchContext,
} from '@xyne/shared';

// Re-export shared types
export type { ResearchProduct, ResearchRepository, ResearchContext };

// ============================================================================
// Types
// ============================================================================

export interface ResearchProductExtended extends ResearchProduct {
  description?: string;
  repositories?: ResearchRepositoryExtended[];
}

export interface ResearchRepositoryExtended extends ResearchRepository {
  language?: string;
  description?: string;
  status?: string;
}

export interface ResearchSession {
  id: string;
}

export interface ResearchFollowUp {
  question: string;
  justification: string;
  data_type: string;
  specific_keys?: string[];
}

export interface ResearchAgentResponse {
  session_id: string;
  analysis: string;
  follow_ups: ResearchFollowUp[];
  is_complete: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export type StreamEventCallback = (event: Record<string, unknown>) => void;

// ============================================================================
// Service
// ============================================================================

class ResearchAgentService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.research_agent_url || '';
  }

  /**
   * Get authentication headers for Research Agent API
   * Supports both Pomerium cookie auth and API key auth
   */
  private getHeaders(): Record<string, string> {
    const pomeriumCookie = process.env.RESEARCH_AGENT_POMERIUM_COOKIE;
    const pomeriumJwt = process.env.RESEARCH_AGENT_POMERIUM_JWT;
    const bearerToken = process.env.RESEARCH_AGENT_BEARER_TOKEN;

    if (pomeriumCookie) {
      const headers: Record<string, string> = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': `${this.baseUrl}/`,
        'Cookie': `_pomerium=${pomeriumCookie}`,
        'Content-Type': 'application/json',
      };

      if (bearerToken) {
        headers['Authorization'] = `Bearer ${bearerToken}`;
      }

      if (pomeriumJwt) {
        headers['x-pomerium-jwt-assertion'] = pomeriumJwt;
      }

      return headers;
    }

    // Fallback to API key auth
    const apiKey = config.research_agent_api_key;
    if (apiKey) {
      return {
        'Authorization': `bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
    }

    throw new Error('Research Agent authentication not configured');
  }

  /**
   * List all available products from Research Agent
   * Returns simplified list with id and name for UI display
   */
  async listProducts(): Promise<ResearchProduct[]> {
    if (!this.baseUrl) {
      throw new Error('RESEARCH_AGENT_URL not configured');
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/products`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[ResearchAgentService] Failed to fetch products: ${response.status} - ${errorText}`);
        throw new Error(`Failed to fetch products: ${response.status}`);
      }

      const products = (await response.json()) as ResearchProduct[];
      
      // Return simplified list with id and name
      return products.map(p => ({
        id: p.id,
        name: p.name,
      }));
    } catch (error) {
      logger.error('[ResearchAgentService] Error fetching products:', error);
      throw error;
    }
  }

  /**
   * List all available repositories from Research Agent
   * Returns simplified list with id and name for UI display
   */
  async listRepositories(): Promise<ResearchRepository[]> {
    if (!this.baseUrl) {
      throw new Error('RESEARCH_AGENT_URL not configured');
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/repositories`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[ResearchAgentService] Failed to fetch repositories: ${response.status} - ${errorText}`);
        throw new Error(`Failed to fetch repositories: ${response.status}`);
      }

      const repositories = (await response.json()) as ResearchRepository[];
      
      // Return simplified list with id and name
      return repositories.map(r => ({
        id: r.id,
        name: r.name,
      }));
    } catch (error) {
      logger.error('[ResearchAgentService] Error fetching repositories:', error);
      throw error;
    }
  }

  /**
   * Build name→ID mappings for validation
   * Used by the agent context for tool validation
   */
  async buildNameMappings(): Promise<{
    productNameToId: Map<string, string>;
    repositoryNameToId: Map<string, string>;
  }> {
    const [products, repositories] = await Promise.all([
      this.listProducts().catch((error) => {
        logger.warn('[ResearchAgentService] Failed to fetch products for mapping:', error);
        return [] as ResearchProduct[];
      }),
      this.listRepositories().catch((error) => {
        logger.warn('[ResearchAgentService] Failed to fetch repositories for mapping:', error);
        return [] as ResearchRepository[];
      }),
    ]);

    const productNameToId = new Map<string, string>();
    const repositoryNameToId = new Map<string, string>();

    for (const product of products) {
      productNameToId.set(product.name, product.id);
    }

    for (const repo of repositories) {
      repositoryNameToId.set(repo.name, repo.id);
    }

    return { productNameToId, repositoryNameToId };
  }

  /**
   * Create a new research session
   */
  async createSession(
    productId?: string | null,
    repositoryId?: string | null,
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.baseUrl) {
      throw new Error('RESEARCH_AGENT_URL not configured');
    }

    const response = await fetch(`${this.baseUrl}/api/chat/sessions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        repository_id: repositoryId || null,
        product_id: productId || null,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[ResearchAgentService] Session creation failed: ${response.status} - ${errorText}`);
      throw new Error(`Failed to create research session: ${response.status}`);
    }

    const sessionData = (await response.json()) as ResearchSession;
    return sessionData.id;
  }

  /**
   * Stream a research query and process SSE events
   * Returns the final response after processing the complete event
   */
  async streamQuery(
    sessionId: string,
    query: string,
    options?: {
      systemPrompt?: string;
      maxTurns?: number;
      branch?: string;
      onEvent?: StreamEventCallback;
      signal?: AbortSignal;
    }
  ): Promise<ResearchAgentResponse> {
    if (!this.baseUrl) {
      throw new Error('RESEARCH_AGENT_URL not configured');
    }

    const streamHeaders = {
      ...this.getHeaders(),
      'Accept': 'text/event-stream',
    };

    const messageData = {
      content: query,
      system_prompt: options?.systemPrompt || '',
      max_turns: options?.maxTurns || 20,
      session_id: sessionId,
      model_name: process.env.RESEARCH_AGENT_MODEL_NAME || 'private-large',
      branch: options?.branch || process.env.RESEARCH_AGENT_BRANCH || 'main'
    };

    const response = await fetch(`${this.baseUrl}/api/chat/sessions/${sessionId}/stream`, {
      method: 'POST',
      headers: streamHeaders,
      body: JSON.stringify(messageData),
      signal: options?.signal ?? AbortSignal.timeout(600000), // 10 minute fallback timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[ResearchAgentService] Stream request failed: ${response.status} - ${errorText}`);
      throw new Error(`Research Agent API returned status ${response.status}: ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body from Research Agent API');
    }

    // Process SSE stream and wait for 'complete' event
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResponse = '';
    let currentEventType = 'data';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          if (trimmedLine.startsWith('event:')) {
            currentEventType = trimmedLine.slice(6).trim();
            continue;
          }

          if (trimmedLine.startsWith('data:')) {
            const dataContent = trimmedLine.slice(5).trim();
            if (!dataContent || dataContent === '[DONE]') continue;

            try {
              const eventData = JSON.parse(dataContent);

              // Emit intermediate events
              if (options?.onEvent) {
                options.onEvent({ type: `research_agent_${currentEventType}`, toolName: 'research_agent', ...eventData });
              }

              // Check for 'complete' event with response
              if (currentEventType === 'complete' && eventData.response) {
                finalResponse = eventData.response;
              }

              currentEventType = 'data';
            } catch {
              // Non-JSON SSE data, skip
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!finalResponse) {
      logger.warn('[ResearchAgentService] No complete event received from stream');
      throw new Error('Research query completed but no complete response was received');
    }

    // Parse the response into structured format
    return this.parseResponse(sessionId, finalResponse);
  }

  /**
   * Extract JSON from markdown code blocks using string-based parsing
   * Safer than regex - avoids ReDoS vulnerabilities
   */
  private extractJsonFromCodeBlock(rawResponse: string): string | null {
    // Try ```json first, then plain ```
    const markers = ['```json', '```'];

    for (const startMarker of markers) {
      const startIndex = rawResponse.indexOf(startMarker);
      if (startIndex !== -1) {
        const jsonStart = startIndex + startMarker.length;
        const endIndex = rawResponse.indexOf('```', jsonStart);
        if (endIndex !== -1) {
          const extracted = rawResponse.slice(jsonStart, endIndex).trim();
          // Only return if it looks like JSON (starts with {)
          if (extracted.startsWith('{')) {
            return extracted;
          }
        }
      }
    }
    return null;
  }

  /**
   * Parse raw research agent response into structured format
   */
  private parseResponse(sessionId: string, rawResponse: string): ResearchAgentResponse {
    const MAX_RESPONSE_SIZE = 500000; // 500KB limit
    if (rawResponse.length > MAX_RESPONSE_SIZE) {
      logger.warn(`[ResearchAgentService] Response too large (${rawResponse.length} bytes), truncating`);
      rawResponse = rawResponse.slice(0, MAX_RESPONSE_SIZE);
    }

    try {
      // Use string-based extraction instead of regex (safer, avoids ReDoS)
      const extractedJson = this.extractJsonFromCodeBlock(rawResponse);
      const jsonStr = extractedJson ?? rawResponse.trim();

      const parsed = JSON.parse(jsonStr);

      return {
        session_id: sessionId,
        analysis: parsed.analysis || rawResponse,
        follow_ups: parsed.follow_ups || [],
        is_complete: parsed.is_complete ?? true,
        confidence: parsed.confidence || 'MEDIUM',
      };
    } catch {
      // Fallback: treat entire response as analysis
      return {
        session_id: sessionId,
        analysis: rawResponse,
        follow_ups: [],
        is_complete: true,
        confidence: 'MEDIUM',
      };
    }
  }
}

// Export singleton instance
export const researchAgentService = new ResearchAgentService();
