/**
 * Read Canvas Tool
 *
 * Reads a canvas by its viewAccessId and returns the full content
 * converted from BlockNote format to Markdown.
 *
 * The canvas_view_access_id is mandatory - the agent must provide it.
 * Content is read from Y-Sweet (collaborative document store).
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { logger } from '../../../utils/logger.js';
import { getCanvasByViewAccessId } from '../../../services/canvasService.js';
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
  canvas_view_access_id: z.string().optional().describe('The viewAccessId of the canvas to read. This is the ID from the canvas URL (e.g., from /chat/canvas/{viewAccessId}). If not provided, uses the canvas context from where Ask AI was triggered.'),
});

type ReadCanvasArgs = z.infer<typeof ReadCanvasArgsSchema>;

// ============================================================================
// Implementation
// ============================================================================

/**
 * Read Canvas Implementation
 * Fetches canvas by viewAccessId and converts to markdown
 */
async function readCanvasImpl(
  viewAccessId: string,
  sessionId: string
): Promise<EnhancedToolResult> {
  try {
    logger.info(`[Tool] [${sessionId}] read_canvas: viewAccessId=${viewAccessId}`);

    // Fetch canvas metadata by viewAccessId
    const canvas = await getCanvasByViewAccessId(viewAccessId);

    if (!canvas) {
      return {
        success: false,
        entities: [],
        error: `Canvas not found for viewAccessId: ${viewAccessId}`,
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
 * This tool requires canvas_view_access_id as a mandatory parameter
 */
export function createReadCanvasTool(): Tool<ReadCanvasArgs, XyneAIAgentContext> {
  return {
    schema: {
      name: 'read_canvas',
      description: getDescription('read_canvas'),
      parameters: ReadCanvasArgsSchema,
    },
    execute: async (args, context) => {
      // Use provided canvas_view_access_id or fall back to context's canvasViewAccessId
      const canvasViewAccessId = args.canvas_view_access_id?.trim() || context.canvasViewAccessId;

      // Validate that canvas_view_access_id is available
      if (!canvasViewAccessId || canvasViewAccessId.trim() === '') {
        return 'Error: canvas_view_access_id is required. Please provide the viewAccessId from the canvas URL, or trigger Ask AI from within a canvas.';
      }

      const result = await readCanvasImpl(
        canvasViewAccessId,
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