/**
 * Get Memories Tool
 * Semantically searches mem0 memories for a given user via XYNE_AI_EXTENDED_URL.
 */

import { z } from 'zod';
import type { Tool } from '@xynehq/jaf';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { getDescription } from './helpers.js';
import type { XyneAIAgentContext } from './types.js';

// ============================================================================
// Tool Factory
// ============================================================================

export function createGetMemoriesTool(): Tool<{ query: string }, XyneAIAgentContext> {
  if (!config.xyneAiExtended.url) {
    return {
      schema: {
        name: 'get_memories',
        description: 'Memory service is not configured. Contact administrator to enable.',
        parameters: z.object({ query: z.string().describe('The search query') }),
      },
      execute: async () => 'Error: Memory service is not configured. Please set XYNE_AI_EXTENDED_URL environment variable.',
    };
  }

  return {
    schema: {
      name: 'get_memories',
      description: getDescription('get_memories'),
      parameters: z.object({
        query: z.string().describe('What you are looking for — all memories are returned regardless, use this to express intent'),
      }),
    },
    execute: async (_args, context) => {
      const user_id = context.userId;
      const baseUrl = config.xyneAiExtended.url;

      try {
        const response = await fetch(
          `${baseUrl}/mem0/memories?user_id=${encodeURIComponent(user_id)}`,
          { signal: AbortSignal.timeout(15000) },
        );

        if (!response.ok) {
          logger.error(`[Tool] get_memories: HTTP ${response.status}`);
          return `Error: Memory retrieval failed (HTTP ${response.status}).`;
        }

        const data = await response.json() as { results?: Array<{ memory: string }> };
        const results = data.results ?? [];

        if (results.length === 0) {
          return 'No relevant memories found.';
        }

        const formatted = results
          .map((r, i) => `[${i + 1}] ${r.memory}`)
          .join('\n');

        return `Found ${results.length} relevant memories:\n\n${formatted}`;
      } catch (error) {
        logger.error('[Tool] get_memories error:', error);
        return `Error: ${error instanceof Error ? error.message : 'Unknown error retrieving memories.'}`;
      }
    },
  };
}

export function getGetMemoriesTool() {
  return createGetMemoriesTool();
}
