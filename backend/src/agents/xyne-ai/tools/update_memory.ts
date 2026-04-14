/**
 * Update Memory Tool
 * Fire-and-forget: stores a memory in mem0 for the given user.
 * Returns immediately while the HTTP call runs in the background.
 */

import { z } from 'zod';
import type { Tool } from '@juspay-jaf/jaf';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { getDescription } from './helpers.js';
import type { XyneAIAgentContext } from './types.js';

// ============================================================================
// Tool Factory
// ============================================================================

export function createUpdateMemoryTool(): Tool<{ content: string }, XyneAIAgentContext> {
  if (!config.xyneAiExtended.url) {
    return {
      schema: {
        name: 'update_memory',
        description: 'Memory service is not configured. Contact administrator to enable.',
        parameters: z.object({ content: z.string().describe('The information to store as a memory') }),
      },
      execute: async () => 'Error: Memory service is not configured. Please set XYNE_AI_EXTENDED_URL environment variable.',
    };
  }

  return {
    schema: {
      name: 'update_memory',
      description: getDescription('update_memory'),
      parameters: z.object({
        content: z.string().describe('The information to store as a memory'),
      }),
    },
    execute: async (args, context) => {
      const { content } = args;
      const user_id = context.userId;
      const baseUrl = config.xyneAiExtended.url;

      // Fire and forget — do not await the HTTP call
      fetch(`${baseUrl}/mem0/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content }],
          user_id,
        }),
        signal: AbortSignal.timeout(30000),
      }).catch((error) => {
        logger.error('[Tool] update_memory background error:', error);
      });

      return 'Memory update initiated in background.';
    },
  };
}

export function getUpdateMemoryTool() {
  return createUpdateMemoryTool();
}
