/**
 * Canvas Service - Creates canvases for knowledge learnings and other purposes
 */

import { v4 as uuidv4 } from 'uuid';
import { DatabaseClient } from '@/database/client';
import type { KnowledgeLearning } from '@/workflows/utils/knowledge-generator';
import { logger } from '@/utils/logger';
import { ServerBlockNoteEditor } from '@blocknote/server-util';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
// Y-Sweet XML fragment name used by the frontend collaborative editor
export const YSWEET_XML_FRAGMENT = 'document-store';


/**
 * Convert markdown to BlockNote JSON format
 */
export async function convertMarkdownToBlockNote(markdown: string): Promise<BlockNoteBlock[]> {
  try {
    const editor = ServerBlockNoteEditor.create();
    const parsed = await editor.tryParseMarkdownToBlocks(markdown);
    return parsed as BlockNoteBlock[];
  } catch (error) {
    logger.error('[CanvasService] Error converting markdown to BlockNote:', error);
    return [];
  }
}

/**
 * Get human-readable label for learning type
 */
function getLearningTypeLabel(learningType: string): string {
  switch (learningType) {
    case 'file_purpose':
      return 'File Purpose';
    case 'implementation_pattern':
      return 'Implementation Pattern';
    case 'gotcha':
      return 'Gotcha';
    case 'debugging_tip':
      return 'Debugging Tip';
    default:
      return 'Learning';
  }
}

/**
 * Convert knowledge learnings to BlockNote JSON format
 */
export function formatLearningsToBlockNote(
  learnings: KnowledgeLearning[],
  workflowExecutionId: string,
  title?: string
): BlockNoteBlock[] {
  const blocks: BlockNoteBlock[] = [];

  // Main title
  blocks.push({
    id: uuidv4(),
    type: 'heading',
    props: { level: 1 },
    content: [{ type: 'text', text: title || '📚 Knowledge Learnings', styles: {} }],
  });

  // Subtitle with execution reference
  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: `Captured from workflow execution: ${workflowExecutionId.substring(0, 8)}...`,
        styles: { italic: true },
      },
    ],
  });

  // Empty paragraph for spacing
  blocks.push({
    id: uuidv4(),
    type: 'paragraph',
    content: [],
  });

  // Group learnings by type
  const learningsByType = learnings.reduce(
    (acc, learning) => {
      const type = learning.learningType;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(learning);
      return acc;
    },
    {} as Record<string, KnowledgeLearning[]>
  );

  // Add each group
  for (const [learningType, typeLearnings] of Object.entries(learningsByType)) {
    const label = getLearningTypeLabel(learningType);

    // Section header
    blocks.push({
      id: uuidv4(),
      type: 'heading',
      props: { level: 2 },
      content: [{ type: 'text', text: `${label}`, styles: {} }],
    });

    // Add each learning in this category
    for (const learning of typeLearnings) {
      // Learning title as subheading
      blocks.push({
        id: uuidv4(),
        type: 'heading',
        props: { level: 3 },
        content: [{ type: 'text', text: learning.title, styles: { bold: true } }],
      });

      // Learning content
      blocks.push({
        id: uuidv4(),
        type: 'paragraph',
        content: [{ type: 'text', text: learning.content, styles: {} }],
      });

      // File paths if present
      if (learning.filePaths && learning.filePaths.length > 0) {
        blocks.push({
          id: uuidv4(),
          type: 'paragraph',
          content: [{ type: 'text', text: 'Related files:', styles: { bold: true } }],
        });

        for (const filePath of learning.filePaths) {
          blocks.push({
            id: uuidv4(),
            type: 'bulletListItem',
            content: [{ type: 'text', text: filePath, styles: { code: true } }],
          });
        }
      }

      // Code context if present
      if (learning.codeContext) {
        blocks.push({
          id: uuidv4(),
          type: 'paragraph',
          content: [{ type: 'text', text: 'Code context:', styles: { bold: true } }],
        });

        blocks.push({
          id: uuidv4(),
          type: 'codeBlock',
          props: { language: 'typescript' },
          content: [{ type: 'text', text: learning.codeContext, styles: {} }],
        });
      }

      // Spacing between learnings
      blocks.push({
        id: uuidv4(),
        type: 'paragraph',
        content: [],
      });
    }
  }

  return blocks;
}

/**
 * Metadata for knowledge canvas creation
 */
export interface KnowledgeCanvasMetadata {
  projectId: string;
  conversationId: string;
  repositoryUrl?: string | null;
  learningIds?: string[]; // IDs of individual learnings for approval tracking
}

/**
 * Create a knowledge canvas from workflow learnings
 * @param workflowExecutionId - The workflow execution ID
 * @param learnings - Array of knowledge learnings to include
 * @param createdByUserId - User ID to set as canvas creator (from workflow.createdBy)
 * @param metadata - Additional metadata including projectId, conversationId, etc.
 * @param canvasTitle - Optional custom title for the canvas (defaults to workflow/ticket name or date-based title)
 * @returns canonical canvas id for generating shareable link, or null on failure
 */
export async function createKnowledgeCanvas(
  workflowExecutionId: string,
  learnings: KnowledgeLearning[],
  createdByUserId: string,
  metadata?: KnowledgeCanvasMetadata,
  canvasTitle?: string
): Promise<string | null> {
  try {
    if (learnings.length === 0) {
      logger.info('[CanvasService] No learnings to create canvas for');
      return null;
    }

    const prisma = DatabaseClient.getInstance();
    const now = new Date();

    // Generate IDs
    const canvasId = uuidv4();
    const participantId = uuidv4();

    // Generate title with fallback to default
    const finalTitle = canvasTitle ? `📚 ${canvasTitle}` : `📚 Knowledge Learnings - ${new Date().toLocaleDateString()}`;

    // Format learnings to BlockNote content
    const content = formatLearningsToBlockNote(learnings, workflowExecutionId, finalTitle);

    // Create the canvas with PUBLIC visibility
    await prisma.canvas.create({
      data: {
        id: canvasId,
        title: finalTitle,
        content: content as any, // BlockNote JSON array
        createdBy: createdByUserId,
        visibility: 'PUBLIC',
        isTemplate: false,
        lastEditedBy: createdByUserId,
        lastEditedAt: now,
        createdAt: now,
        updatedAt: now,
        metadata: {
          source: 'workflow_knowledge',
          workflowExecutionId,
          learningCount: learnings.length,
          // Include approval-related metadata
          ...(metadata?.projectId && { projectId: metadata.projectId }),
          ...(metadata?.conversationId && { conversationId: metadata.conversationId }),
          ...(metadata?.repositoryUrl && { repositoryUrl: metadata.repositoryUrl }),
          ...(metadata?.learningIds && { learningIds: metadata.learningIds }),
        },
      },
    });

    // Add creator as OWNER participant
    await prisma.canvasParticipant.create({
      data: {
        id: participantId,
        canvasId,
        userId: createdByUserId,
        role: 'OWNER',
        joinedAt: now,
        updatedAt: now,
      },
    });

    logger.info(
      `[CanvasService] Created knowledge canvas ${canvasId} with ${learnings.length} learnings for execution ${workflowExecutionId}`
    );

    // Queue Vespa indexing job for the canvas
    try {
      const user = await prisma.user.findUnique({ where: { id: createdByUserId }, select: { workspaceId: true } });
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'feed',
        userId: createdByUserId,
        app: SubApp.CANVAS,
        ...(user?.workspaceId ? { workspaceId: user.workspaceId } : {}),
      });
      logger.info(`[CanvasService] Queued Vespa indexing for canvas ${canvasId}`);
    } catch (error) {
      logger.error(`[CanvasService] Failed to queue Vespa job for canvas ${canvasId}:`, error);
      // Don't fail the canvas creation if Vespa queueing fails
    }
    
    return canvasId;
  } catch (error) {
    logger.error('[CanvasService] Failed to create knowledge canvas:', error);
    return null;
  }
}

/**
 * Generate the shareable canvas URL from the canonical canvas id. When
 * workspaceId is provided, the URL is workspace-scoped
 * (`/{workspaceId}/chat/canvas/{canvasId}`); otherwise it falls back to the
 * unscoped form.
 */
export function getCanvasUrl(canvasId: string, workspaceId?: string): string {
  const frontendUrl = process.env.FRONTEND_URL || 'https://spaces.xyne.juspay.net';
  const path = workspaceId
    ? `/${workspaceId}/chat/canvas/${canvasId}`
    : `/chat/canvas/${canvasId}`;
  return `${frontendUrl}${path}`;
}

/**
 * Convert BlockNote JSON content to Markdown
 * @param blocks - BlockNote JSON blocks (from canvas.content)
 * @returns Markdown string
 */
export async function convertBlockNoteToMarkdown(blocks: unknown[]): Promise<string> {
  try {
    const editor = ServerBlockNoteEditor.create();
    // blocksToMarkdownLossy accepts the blocks array directly
    const markdown = await editor.blocksToMarkdownLossy(blocks as any);
    return markdown;
  } catch (error) {
    logger.error('[CanvasService] Failed to convert BlockNote to Markdown:', error);
    throw new Error('Failed to convert canvas content to Markdown');
  }
}

/**
 * Approve a knowledge canvas and create KnowledgeDocument entries
 * @param canvasId - The canvas ID to approve
 * @param approvedByUserId - The user approving the canvas
 * @returns Created KnowledgeDocument IDs
 */
export async function approveKnowledgeCanvas(
  canvasId: string,
  approvedByUserId: string
): Promise<{
  success: boolean;
  documentIds?: string[];
  error?: string;
  alreadyApproved?: boolean;
}> {
  const prisma = DatabaseClient.getInstance();

  try {
    // Get the canvas with its content and metadata
    const canvas = await prisma.canvas.findUnique({
      where: { id: canvasId },
      select: {
        id: true,
        title: true,
        content: true,
        metadata: true,
      },
    });

    if (!canvas) {
      return { success: false, error: 'Canvas not found' };
    }

    // Validate this is a knowledge canvas
    const metadata = canvas.metadata as Record<string, unknown> | null;
    if (!metadata || metadata.source !== 'workflow_knowledge') {
      return { success: false, error: 'Canvas is not a knowledge canvas' };
    }

    // Check if already approved
    if (metadata.approvedAt) {
      return { success: true, alreadyApproved: true };
    }

    const projectId = metadata.projectId as string | undefined;
    if (!projectId) {
      return { success: false, error: 'Canvas missing projectId in metadata' };
    }

    const workflowExecutionId = metadata.workflowExecutionId as string | undefined;
    const conversationId = metadata.conversationId as string | undefined;
    const repositoryUrl = metadata.repositoryUrl as string | null | undefined;
    const learningIds = metadata.learningIds as string[] | undefined;

    // Convert BlockNote content to Markdown
    const blocks = canvas.content as unknown[];
    const markdownContent = await convertBlockNoteToMarkdown(blocks);

    // Get original learnings metadata if available (for filePaths, learningType, etc.)
    let originalLearnings: Record<string, unknown>[] = [];
    if (learningIds && learningIds.length > 0) {
      const dbLearnings = await prisma.workflowKnowledge.findMany({
        where: { id: { in: learningIds } },
        select: {
          id: true,
          title: true,
          learningType: true,
          filePaths: true,
          codeContext: true,
        },
      });
      originalLearnings = dbLearnings;
    }

    // Create a single KnowledgeDocument from the full canvas
    const document = await prisma.knowledgeDocument.create({
      data: {
        projectId,
        repositoryUrl: repositoryUrl || null,
        title: canvas.title,
        content: markdownContent,
        sourceKnowledgeId: learningIds?.[0] || null, // Primary source learning
        workflowExecutionId: workflowExecutionId || null,
        conversationId: conversationId || null,
        approvedBy: approvedByUserId,
        metadata: {
          canvasId: canvas.id,
          learningIds: learningIds || [],
          originalLearnings: originalLearnings.map((l) => ({
            id: String(l.id),
            title: String(l.title),
            learningType: String(l.learningType),
            filePaths: l.filePaths as string[],
          })),
        },
      },
    });

    // Update canvas metadata with approval info
    await prisma.canvas.update({
      where: { id: canvasId },
      data: {
        metadata: {
          ...metadata,
          approvedAt: new Date().toISOString(),
          approvedBy: approvedByUserId,
          knowledgeDocumentId: document.id,
        },
      },
    });

    logger.info(
      `[CanvasService] Approved knowledge canvas ${canvasId} - created document ${document.id}`
    );

    // Queue Vespa update for the canvas (metadata changed)
    try {
      const user = await prisma.user.findUnique({ where: { id: approvedByUserId }, select: { workspaceId: true } });
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'feed', // Re-feed to update the document
        userId: approvedByUserId,
        app: SubApp.CANVAS,
        ...(user?.workspaceId ? { workspaceId: user.workspaceId } : {}),
      });
      logger.info(`[CanvasService] Queued Vespa update for approved canvas ${canvasId}`);
    } catch (error) {
      logger.error(`[CanvasService] Failed to queue Vespa update for approved canvas ${canvasId}:`, error);
    }
    
    return { success: true, documentIds: [document.id] };
  } catch (error) {
    logger.error('[CanvasService] Failed to approve knowledge canvas:', error);
    return { success: false, error: 'Failed to approve canvas' };
  }
}

/**
 * Get canvas by canonical id.
 */
export async function getCanvasById(canvasId: string) {
  const prisma = DatabaseClient.getInstance();
  return prisma.canvas.findUnique({
    where: { id: canvasId },
    select: {
      id: true,
      title: true,
      content: true,
      metadata: true,
      createdBy: true,
      createdAt: true,
    },
  });
}

/**
 * Find an existing detailed summary canvas for a call.
 */
export async function findExistingDetailedSummaryCanvas(
  callId: string
): Promise<{ canvasId: string; version: number } | null> {
  try {
    const prisma = DatabaseClient.getInstance();

    const existingCanvas = await prisma.canvas.findFirst({
      where: {
        AND: [
          {
            metadata: {
              path: ['source'],
              equals: 'call_detailed_summary',
            },
          },
          {
            metadata: {
              path: ['callId'],
              equals: callId,
            },
          },
        ],
      },
      select: {
        id: true,
        metadata: true,
      },
    });

    if (existingCanvas) {
      const metadata = existingCanvas.metadata as Record<string, any> | null;
      const version = typeof metadata?.version === 'number' ? metadata.version : 1;
      return {
        canvasId: existingCanvas.id,
        version,
      };
    }

    return null;
  } catch (error) {
    logger.error('[CanvasService] Error finding existing detailed summary canvas:', error);
    return null;
  }
}
