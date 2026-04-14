/**
 * Xyne RCA Tool
 * RCA (Root Cause Analysis) investigation agent integration
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { config } from '../../../config/env.js';
import type { XyneAIAgentContext } from './types.js';
import { getDescription } from './helpers.js';

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create xyne_rca tool for RCA queries
 */
export function createXyneRcaTool(): Tool<{ query: string }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'xyne_rca',
      description: getDescription('xyne_rca'),
      parameters: z.object({
        query: z.string().describe('The RCA query to send to the Xyne RCA agent'),
      }),
    },
    execute: async (args, context) => {
      const { query } = args;
      const { userId, onStreamEvent } = context;

      logger.info(`[Tool] [${context.sessionId}] xyne_rca: query="${query}"`);

      const xyneRcaApiUrl = config.genius.apiUrl ? (config.genius.apiUrl + '/api/v3/investigation/') : '';
      const xyneRcaApiKey = config.xyne.apiKey;

      if (!xyneRcaApiUrl || !xyneRcaApiKey) {
        logger.error('[Tool] xyne_rca: Missing GENIUS_API_URL or XYNE_API_KEY in config');
        return 'Error: Xyne RCA API not configured. Please set GENIUS_API_URL and XYNE_API_KEY environment variables.';
      }

      // Fetch user email from database
      let userEmail = '';
      try {
        const user = await db.user.findUnique({
          where: { id: userId },
          select: { email: true },
        });
        userEmail = user?.email || '';
      } catch (error) {
        logger.warn(`[Tool] [${context.sessionId}] xyne_rca: Failed to fetch user email for userId=${userId}`);
      }

      const XYNE_RCA_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), XYNE_RCA_TIMEOUT_MS);

      try {
        // Send start event directly via callback for real-time streaming
        if (onStreamEvent) {
          onStreamEvent({
            type: 'xyne_rca_start',
            toolName: 'xyne_rca',
            query,
            timestamp: new Date().toISOString()
          });
        }

        // Prepare URL-encoded form data
        const formData = new URLSearchParams();
        formData.append('query', query);
        formData.append('analysis_type', 'investigation');
        formData.append('current_timestamp', '');

        const response = await fetch(xyneRcaApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${xyneRcaApiKey}`,
            'Accept': 'text/event-stream',
            'X-Source-Config': 'xyne_rca',
            'X-Xyne-User-Email': userEmail,
            'X-Xyne-User-Id': userId,
          },
          body: formData.toString(),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();

          if (onStreamEvent) {
            onStreamEvent({
              type: 'xyne_rca_error',
              toolName: 'xyne_rca',
              error: `API error: ${response.status}`,
              details: errorText
            });
          }

          return `Error: Xyne RCA API returned status ${response.status}: ${errorText}`;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          return 'Error: No response body from Xyne RCA API';
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

                const xyneRcaEventType = currentEventType !== 'data'
                  ? currentEventType
                  : (eventData.type || 'data');

                // Stream event directly via callback - real-time!
                if (onStreamEvent) {
                  onStreamEvent({ type: xyneRcaEventType, ...eventData });
                }

                currentEventType = 'data';

                if (xyneRcaEventType === 'final_output') {
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

        logger.info(`[Tool] [${context.sessionId}] xyne_rca: completed with ${eventCount} events`);

        return finalResult || 'Xyne RCA query completed but no text content was returned.';

      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
          if (onStreamEvent) {
            onStreamEvent({ type: 'xyne_rca_error', toolName: 'xyne_rca', error: 'Request timed out' });
          }
          return 'Error: Xyne RCA API request timed out';
        }

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[Tool] [${context.sessionId}] xyne_rca error:`, error);

        if (onStreamEvent) {
          onStreamEvent({ type: 'xyne_rca_error', toolName: 'xyne_rca', error: errorMessage });
        }

        return `Error calling Xyne RCA API: ${errorMessage}`;
      }
    },
  };
}

/**
 * Get xyne_rca tool
 * MUST call initializeTools() before using
 */
export function getXyneRcaTool() {
  return createXyneRcaTool();
}
