/**
 * Read Canvas Tool
 *
 * Reads a canvas by its canonical id and returns the full content
 * converted from BlockNote format to Markdown.
 *
 * The canvas_id is mandatory - the agent must provide it.
 * Content is read from Y-Sweet (collaborative document store).
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { logger } from '../../../utils/logger.js';
import { getCanvasById } from '../../../services/canvasService.js';
import { readFromYSweet } from '../../../utils/ysweetUtils.js';
import { convertBlockNoteToMarkdown } from '../../../services/canvasService.js';
import { db } from '../../../database/client.js';
import type {
  XyneAIAgentContext,
  EnhancedToolResult,
} from './types.js';
import {
  getDescription,
  getNextPrefix,
  buildEnhancedCitationMappings,
  appendEnhancedSessionMappings,
  formatEnhancedToolResultForContext,
  toIST,
} from './helpers.js';

// ============================================================================
// Schema
// ============================================================================

const ReadCanvasArgsSchema = z.object({
  canvas_id: z.string().optional().describe('The canonical id of the canvas to read (from the /chat/canvas/{canvasId} URL). If not provided, uses the canvas context from where Ask AI was triggered.'),
});

type ReadCanvasArgs = z.infer<typeof ReadCanvasArgsSchema>;

// ============================================================================
// Implementation
// ============================================================================

/**
 * Read Canvas Implementation
 * Fetches canvas by canonical id and converts to markdown
 */
async function readCanvasImpl(
  canvasId: string,
  sessionId: string
): Promise<EnhancedToolResult> {
  try {
    logger.info(`[Tool] [${sessionId}] read_canvas: canvasId=${canvasId}`);

    const canvas = await getCanvasById(canvasId);

    if (!canvas) {
      return {
        success: false,
        entities: [],
        error: `Canvas not found for canvasId: ${canvasId}`,
      };
    }

    // Get canvas creator info
    const canvasCreator = await db.user.findUnique({
      where: { id: canvas.createdBy },
      select: { id: true, name: true, email: true },
    });

    // Read content from Y-Sweet (not postgres)
    const blocks = await readFromYSweet(canvas.id);

    // Convert BlockNote blocks to Markdown
    const markdownContent = await convertBlockNoteToMarkdown(blocks);

    // Build entity
    const entity = {
      entityType: 'canvas' as const,
      entityId: canvas.id,
      entityIndex: 1,
      content: `Canvas: ${canvas.title}\n\n${markdownContent}`,
      authorName: canvasCreator?.name || canvasCreator?.email || 'Unknown User',
      authorId: canvas.createdBy,
      timestamp: toIST(canvas.createdAt),
      channelId: '',  // Canvas is channel-level, no specific channelId
      channelName: '',
      canvasId: canvas.id,
    };

    logger.info(
      `[Tool] [${sessionId}] read_canvas: Successfully read canvas "${canvas.title}" (${canvas.id})`
    );

    return {
      success: true,
      entities: [entity],
      metadata: {
        totalCount: 1,
        messageCount: 0,
        attachmentCount: 0,
        callCount: 0,
        canvasCount: 1,
        ticketCount: 0,
      },
    };
  } catch (error) {
    logger.error(`[Tool] [${sessionId}] read_canvas error:`, error);
    return {
      success: false,
      entities: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create read_canvas tool with description from Langfuse
 * This tool requires canvas_id as a mandatory parameter
 */
export function createReadCanvasTool(): Tool<ReadCanvasArgs, XyneAIAgentContext> {
  return {
    schema: {
      name: 'read_canvas',
      description: getDescription('read_canvas'),
      parameters: ReadCanvasArgsSchema,
    },
    execute: async (args, context) => {
      // Use provided canvas_id or fall back to the ambient canvas context
      const canvasId = args.canvas_id?.trim() || context.canvasId;

      if (!canvasId || canvasId.trim() === '') {
        return 'Error: canvas_id is required. Please provide the canonical canvas id from the URL, or trigger Ask AI from within a canvas.';
      }

      const result = await readCanvasImpl(
        canvasId,
        context.sessionId
      );

      const prefix = await getNextPrefix(context.sessionId);
      if (result.success && result.entities.length > 0) {
        await appendEnhancedSessionMappings(context.sessionId, buildEnhancedCitationMappings(result), prefix);
      }

      return formatEnhancedToolResultForContext(result, prefix);
    },
  };
}

/**
 * Get read_canvas tool
 * MUST call initializeTools() before using
 */
export function getReadCanvasTool() {
  return createReadCanvasTool();
}
