/**
 * Create Canvas Tool
 * 
 * Creates a canvas from markdown content.
 * The canvas content is stored in Y-Sweet for real-time collaboration.
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { type Tool } from '@juspay-jaf/jaf';
import { DatabaseClient } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import type { XyneAIAgentContext } from './types.js';
import { getDescription } from './helpers.js';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import {
  convertMarkdownToBlockNote,
  getCanvasUrl,
} from '../../../services/canvasService.js';
import { initializeYSweetDoc } from '../../../utils/ysweetUtils.js';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create canvas tool for creating canvases from markdown
 */
export function createCreateCanvasTool(): Tool<{ markdown: string; title: string }, XyneAIAgentContext> {
  return {
    schema: {
      name: 'create_canvas',
      description: getDescription('create_canvas'),
      parameters: z.object({
        markdown: z.string().max(5 * 1024 * 1024, 'Markdown content exceeds 5MB limit').describe('The markdown content to convert to canvas'),
        title: z.string().describe('The title for the canvas'),
      }),
    },
    execute: async (args, context) => {
      const { markdown, title } = args;
      const { userId } = context;
      
      logger.info(`[Tool] [${context.sessionId}] create_canvas: title="${title}"`);
      const prisma = DatabaseClient.getInstance();

      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { workspaceId: true }
        });
        if (!user?.workspaceId) {
          logger.error('[CreateCanvas] User workspace not found - cannot create canvas');
          return 'Error creating canvas: User workspace not found.';
        }

        // Get the Ask AI bot user
        const askAIBot = await unifiedBotUserService.getBotByBotId('ask-ai', user.workspaceId);
        if (!askAIBot) {
          logger.error('[CreateCanvas] Ask AI bot not found - cannot create canvas');
          return 'Error creating canvas: Ask AI bot not found. Please ensure the bot is registered.';
        }
        const now = new Date();
        
        // Generate IDs
        const canvasId = uuidv4();
        const botParticipantId = uuidv4();
        const userParticipantId = uuidv4();
        
        // Convert markdown to BlockNote blocks
        const blocks = await convertMarkdownToBlockNote(markdown);
        
        // Create canvas and participants in a single transaction for data integrity
        await prisma.$transaction([
          // Create the canvas with Ask AI bot as creator
          // Content is stored in Y-Sweet only, not in postgres
          prisma.canvas.create({
            data: {
              id: canvasId,
              title,
              workspaceId: user.workspaceId,
              content: [], // Empty - Y-Sweet is the source of truth
              createdBy: askAIBot.id, // Ask AI bot is the creator
              visibility: 'PRIVATE',
              isTemplate: false,
              isCollaborative: true, // Enable collaborative editing for real-time updates
              lastEditedBy: askAIBot.id,
              lastEditedAt: now,
              createdAt: now,
              updatedAt: now,
            },
          }),
          // Add Ask AI bot as OWNER participant
          prisma.canvasParticipant.create({
            data: {
              id: botParticipantId,
              canvasId,
              workspaceId: user.workspaceId,
              userId: askAIBot.id,
              role: 'OWNER',
              joinedAt: now,
              updatedAt: now,
            },
          }),
          // Add the requesting user as OWNER participant
          prisma.canvasParticipant.create({
            data: {
              id: userParticipantId,
              canvasId,
              workspaceId: user.workspaceId,
              userId,
              role: 'OWNER',
              joinedAt: now,
              updatedAt: now,
            },
          }),
        ]);
        
        // Initialize Y-Sweet document with content for real-time collaboration
        const ysweetInitialized = await initializeYSweetDoc(canvasId, blocks as BlockNoteBlock[]);
        
        if (!ysweetInitialized) {
          return(`[Tool] [${context.sessionId}] create_canvas: Y-Sweet initialization failed for canvas ${canvasId}`);
        }
        
        // Generate canvas URL using shared utility
        const canvasUrl = getCanvasUrl(canvasId, user.workspaceId);
        
        logger.info(`[Tool] [${context.sessionId}] create_canvas: created canvas ${canvasId} with Ask AI bot and user as owners`);
        
        return `Canvas created successfully!\n\nTitle: ${title}\nURL: ${canvasUrl}`;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[Tool] [${context.sessionId}] create_canvas error:`, error);
        return `Error creating canvas: ${errorMessage}`;
      }
    },
  };
}

/**
 * Get create_canvas tool
 * MUST call initializeTools() before using
 */
export function getCreateCanvasTool() {
  return createCreateCanvasTool();
}
