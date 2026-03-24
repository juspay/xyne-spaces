/**
 * Genius Analytics Tool
 */

import { z } from 'zod';
import { type Tool } from '@xynehq/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/env.js';
import type { XyneAIAgentContext } from './types.js';
import { getDescription, getISTTimestampForGenius } from './helpers.js';
import { getAskAIGeniusUsedTotal } from '@/services/otel';

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create genius tool for analytics queries
 */
export function createGeniusTool(): Tool<{ query: string }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'genius',
      description: getDescription('genius'),
      parameters: z.object({
        query: z.string().describe('The analytics query to send to Genius'),
      }),
    },
    execute: async (args, context) => {
      const { query } = args;
      const { userId, onStreamEvent } = context;
      
      logger.info(`[Tool] [${context.sessionId}] genius: query="${query}"`);
      
      const geniusApiUrl = config.genius.apiUrl ? (config.genius.apiUrl + '/api/v3/query_routing/') : '';
      const queryRoutingKey = config.genius.queryRoutingKey;
      
      if (!geniusApiUrl || !queryRoutingKey) {
        logger.error('[Tool] genius: Missing GENIUS_API_URL or QUERY_ROUTING_KEY in config');
        return 'Error: Genius API not configured. Please set GENIUS_API_URL and QUERY_ROUTING_KEY environment variables.';
      }
      
      const currentTimestamp = getISTTimestampForGenius();
      
      // Fetch user email from database
      let userEmail = '';
      try {
        const user = await db.user.findUnique({
          where: { id: userId },
          select: { email: true },
        });
        userEmail = user?.email || '';
      } catch (error) {
        logger.warn(`[Tool] [${context.sessionId}] genius: Failed to fetch user email for userId=${userId}`);
      }
      
      const GENIUS_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GENIUS_TIMEOUT_MS);
      
      try {
        // Send start event directly via callback for real-time streaming
        if (onStreamEvent) {
          onStreamEvent({ type: 'genius_start', toolName: 'genius', query, timestamp: currentTimestamp });
        }
        
        const response = await fetch(geniusApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': queryRoutingKey,
            'Accept': 'text/event-stream',
            'X-Xyne-User-Id': userId,
          },
          body: JSON.stringify({
            query,
            current_timestamp: currentTimestamp,
            agent: 'analytics',
            source: 'xyne_spaces',
            email: userEmail,
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorText = await response.text();
          
          if (onStreamEvent) {
            onStreamEvent({ type: 'genius_error', toolName: 'genius', error: `API error: ${response.status}`, details: errorText });
          }
          
          return `Error: Genius API returned status ${response.status}: ${errorText}`;
        }
        
        const reader = response.body?.getReader();
        if (!reader) {
          return 'Error: No response body from Genius API';
        }
        
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult = '';
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
            if (line.startsWith('event:')) {
              currentEventType = line.slice(6).trim();
              continue;
            }
            
            if (line.startsWith('data:')) {
              const dataContent = line.slice(5).trim();
              if (!dataContent) continue;
              
              try {
                const eventData = JSON.parse(dataContent);
                eventCount++;
                
                const geniusEventType = currentEventType !== 'data' 
                  ? currentEventType 
                  : (eventData.type || 'data');
                
                // Stream event directly via callback - real-time!
                if (onStreamEvent) {
                  onStreamEvent({ type: geniusEventType, ...eventData });
                }
                
                currentEventType = 'data';
                
                if (geniusEventType === 'final_output') {
                  if (eventData.message) {
                    finalResult = eventData.message;
                  }
                }
              } catch {
                // Non-JSON SSE data, skip
              }
            }
          }
        }
        
        logger.info(`[Tool] [${context.sessionId}] genius: completed with ${eventCount} events`);
        
        // Track Genius tool usage
        try {
          getAskAIGeniusUsedTotal().add(1);
        } catch (metricsError) {
          logger.error('[Tool] genius: Error recording metrics:', metricsError);
        }
        
        return finalResult || 'Genius query completed but no text content was returned.';
        
      } catch (error) {
        clearTimeout(timeoutId);
        
        if (error instanceof Error && error.name === 'AbortError') {
          if (onStreamEvent) {
            onStreamEvent({ type: 'genius_error', toolName: 'genius', error: 'Request timed out' });
          }
          return 'Error: Genius API request timed out';
        }
        
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[Tool] [${context.sessionId}] genius error:`, error);
        
        if (onStreamEvent) {
          onStreamEvent({ type: 'genius_error', toolName: 'genius', error: errorMessage });
        }
        
        return `Error calling Genius API: ${errorMessage}`;
      }
    },
  };
}

/**
 * Get genius tool
 * MUST call initializeTools() before using
 */
export function getGeniusTool() {
  return createGeniusTool();
}
