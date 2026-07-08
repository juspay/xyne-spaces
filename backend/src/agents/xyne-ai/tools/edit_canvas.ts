/**
 * Edit Canvas Tool
 * 
 * Edits an existing canvas by replacing its content.
 * The LLM generates the markdown content, and this tool:
 * 1. Validates edit access for the current user
 * 2. Converts markdown to BlockNote format
 * 3. Updates the canvas metadata in the database (content stored in Y-Sweet)
 * 4. Syncs content to Y-Sweet for collaborative editing
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { DatabaseClient } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import type { XyneAIAgentContext } from './types.js';
import { getDescription } from './helpers.js';
import { canvasAuthService } from '../../../services/canvasAuthService.js';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import {
  convertMarkdownToBlockNote,
  getCanvasUrl,
} from '../../../services/canvasService.js';
import { syncToYSweet } from '../../../utils/ysweetUtils.js';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Edit canvas tool for updating existing canvases
 */
export function createEditCanvasTool(): Tool<{ canvasViewId?: string; content: string; title?: string }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'edit_canvas',
      description: getDescription('edit_canvas'),
      parameters: z.object({
        canvasViewId: z.string().optional().describe('The viewAccessId of the canvas to edit. If not provided, uses the canvas context from where Ask AI was triggered.'),
        content: z.string().max(5 * 1024 * 1024, 'Content exceeds 5MB limit').describe('The new content in markdown format'),
        title: z.string().optional().describe('Optional new title for the canvas'),
      }),
    },
    execute: async (args, context) => {
      // Use provided canvasViewId or fall back to context's canvasViewAccessId
      const canvasViewId = args.canvasViewId?.trim() || context.canvasViewAccessId;
      const { content, title } = args;
      const { userId } = context;
      
      // Validate that canvasViewId is available
      if (!canvasViewId || canvasViewId.trim() === '') {
        return 'Error: canvasViewId is required. Please provide the viewAccessId of the canvas to edit, or trigger Ask AI from within a canvas.';
      }
      
      logger.info(`[Tool] [${context.sessionId}] edit_canvas: canvasViewId="${canvasViewId}"`);

      const prisma = DatabaseClient.getInstance();

      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { workspaceId: true }
        });
        if (!user?.workspaceId) {
          logger.error('[EditCanvas] User workspace not found - cannot edit canvas');
          return 'Error editing canvas: User workspace not found.';
        }

        // Get the Ask AI bot user
        const askAIBot = await unifiedBotUserService.getBotByBotId('ask-ai', user.workspaceId);
        if (!askAIBot) {
          logger.error('[EditCanvas] Ask AI bot not found - cannot edit canvas');
          return 'Error editing canvas: Ask AI bot not found. Please ensure the bot is registered.';
        }

        // Check edit access using canvasAuthService (also validates canvas exists)
        const authResult = await canvasAuthService.checkCanvasAccess(canvasViewId, userId);
        
        if (!authResult.canvas) {
          logger.warn(`[Tool] [${context.sessionId}] edit_canvas: Canvas not found for viewAccessId="${canvasViewId}"`);
          return `Canvas not found with ID: ${canvasViewId}`;
        }
        
        if (!authResult.canEdit) {
          logger.warn(`[Tool] [${context.sessionId}] edit_canvas: User ${userId} does not have edit access to canvas ${authResult.canvas.id}`);
          return `You don't have edit access to this canvas. Only the creator, owners, editors, or users with the edit link can modify it.`;
        }
        
        // Convert markdown content to BlockNote blocks
        const blocks = await convertMarkdownToBlockNote(content);
        
        // Update the canvas metadata (content is stored in Y-Sweet only)
        const now = new Date();
        await prisma.canvas.update({
          where: { id: authResult.canvas.id },
          data: {
            content: [], // Empty - Y-Sweet is the source of truth
            lastEditedBy: askAIBot.id, // Ask AI bot is the editor
            lastEditedAt: now,
            updatedAt: now,
            ...(title && { title }),
          },
        });
        
        // Generate canvas URL using shared utility
        const canvasUrl = getCanvasUrl(canvasViewId, user.workspaceId);
        
        logger.info(`[Tool] [${context.sessionId}] edit_canvas: Updated canvas ${authResult.canvas.id}`);
        
        // Sync content to Y-Sweet for collaborative editing
        const ysweetSynced = await syncToYSweet(authResult.canvas.id, blocks as BlockNoteBlock[]);
        
        if (!ysweetSynced) {
          return(`[Tool] [${context.sessionId}] edit_canvas: Y-Sweet sync failed for canvas ${authResult.canvas.id}`);
        }
        
        const titleMessage = title ? `\nTitle: ${title}` : '';
        return `Canvas updated successfully!${titleMessage}\nURL: ${canvasUrl}`;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[Tool] [${context.sessionId}] edit_canvas error:`, error);
        return `Error editing canvas: ${errorMessage}`;
      }
    },
  };
}

/**
 * Get edit_canvas tool
 * MUST call initializeTools() before using
 */
export function getEditCanvasTool() {
  return createEditCanvasTool();
}
