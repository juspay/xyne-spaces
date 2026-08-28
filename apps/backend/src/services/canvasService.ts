/**
 * Canvas Service - Creates canvases for knowledge learnings and other purposes
 */

import { v4 as uuidv4 } from 'uuid';
import { DatabaseClient } from '@/database/client';
import type { KnowledgeLearning } from '@/workflows/utils/knowledge-generator';
import { logger } from '@/utils/logger';
import { withServerEditor } from '@/utils/serverBlockNoteEditor';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { CanvasRole, CanvasVisibility } from '@xyne/shared';
import { toJsonSafeValue } from './jsonSafe';
// Y-Sweet XML fragment name used by the frontend collaborative editor
export const YSWEET_XML_FRAGMENT = 'document-store';


/**
 * Convert markdown to BlockNote JSON format
 */
export async function convertMarkdownToBlockNote(markdown: string): Promise<BlockNoteBlock[]> {
  try {
    const parsed = await withServerEditor((editor) => editor.tryParseMarkdownToBlocks(markdown));
    return toJsonSafeValue(parsed) as BlockNoteBlock[];
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

    // Resolve the creator's workspace to stamp the denormalized tenant key.
    const creator = await prisma.user.findUnique({
      where: { id: createdByUserId },
      select: { workspaceId: true },
    });
    if (!creator?.workspaceId) {
      logger.error('[CanvasService] Creator workspace not found - cannot create canvas');
      return null;
    }
    const workspaceId = creator.workspaceId;

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
        workspaceId,
        content: content as any, // BlockNote JSON array
        createdBy: createdByUserId,
        visibility: CanvasVisibility.PUBLIC,
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
        workspaceId,
        userId: createdByUserId,
        role: CanvasRole.OWNER,
        joinedAt: now,
        updatedAt: now,
      },
    });

    logger.info(
      `[CanvasService] Created knowledge canvas ${canvasId} with ${learnings.length} learnings for execution ${workflowExecutionId}`
    );

    // Queue Vespa indexing job for the canvas
    try {
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'feed',
        userId: createdByUserId,
        app: SubApp.CANVAS,
        workspaceId,
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

type LooseInline = { type?: string; text?: string; props?: Record<string, unknown>; styles?: unknown };
type LooseBlock = {
  type?: string;
  content?: unknown;
  children?: LooseBlock[];
};

// ServerBlockNoteEditor.create() only knows the default schema, so custom inline
// nodes must be rewritten before Markdown export.
const CUSTOM_INLINE_TYPES = new Set(['mention', 'citation']);

// Render a custom inline node as plain text, mirroring the frontend display
// logic (CanvasMentionSpec: prefer the group name for group mentions, otherwise
// the username).
function customInlineToText(inline: LooseInline): string {
  // Citation chips are annotations that point at a transcript segment; in a
  // plain-text/markdown export (or Vespa index text) they carry no useful prose
  // — the cited words already live in the transcript — so drop them to empty.
  if (inline.type === 'citation') return '';
  const props = inline.props || {};
  const groupId = props['groupId'] as string | undefined;
  const groupName = props['groupName'] as string | undefined;
  const username = props['username'] as string | undefined;
  const name = groupId && groupName ? groupName : username || 'mention';
  return `@${name}`;
}

function normalizeInlineContent(content: unknown): unknown {
  if (Array.isArray(content)) {
    return content.map(normalizeInlineContent);
  }

  if (!content || typeof content !== 'object') {
    return content;
  }

  const inline = content as LooseInline;
  if (inline.type && CUSTOM_INLINE_TYPES.has(inline.type)) {
    return { type: 'text', text: customInlineToText(inline), styles: {} };
  }

  return Object.fromEntries(
    Object.entries(content).map(([key, value]) => [key, normalizeInlineContent(value)]),
  );
}

// Remove citation blocks and replace custom inline nodes before serialization.
function normalizeBlocksForMarkdown(blocks: LooseBlock[]): LooseBlock[] {
  return blocks.flatMap(block => {
    if (block.type === 'citation') return [];

    const next: LooseBlock = { ...block };

    if (block.content !== undefined) {
      next.content = normalizeInlineContent(block.content);
    }

    if (Array.isArray(block.children) && block.children.length > 0) {
      next.children = normalizeBlocksForMarkdown(block.children);
    }

    return [next];
  });
}

/**
 * Convert BlockNote JSON content to Markdown
 * @param blocks - BlockNote JSON blocks (from canvas.content)
 * @returns Markdown string
 */
export async function convertBlockNoteToMarkdown(blocks: unknown[]): Promise<string> {
  try {
    // Strip custom inline nodes (e.g. mentions) the default server schema does
    // not know about, otherwise blocksToMarkdownLossy throws
    // "node type <x> not found in schema".
    const normalized = normalizeBlocksForMarkdown((blocks as LooseBlock[]) || []);
    // blocksToMarkdownLossy accepts the blocks array directly
    const markdown = await withServerEditor((editor) => editor.blocksToMarkdownLossy(normalized as any));
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
  approvedByUserId: string,
  callerWorkspaceId: string
): Promise<{
  success: boolean;
  documentIds?: string[];
  error?: string;
  alreadyApproved?: boolean;
  forbidden?: boolean;
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
        workspaceId: true,
        createdBy: true,
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

    // CanvasesACL resolves canvases by workspace only, so this endpoint enforces the
    // workspace boundary and an approver-ownership check itself.
    if (canvas.workspaceId !== callerWorkspaceId) {
      return { success: false, error: 'Canvas not found', forbidden: true };
    }

    let authorized = canvas.createdBy === approvedByUserId;
    if (!authorized) {
      const ownerParticipant = await prisma.canvasParticipant.findFirst({
        where: { canvasId: canvas.id, userId: approvedByUserId, role: 'OWNER' },
        select: { id: true },
      });
      authorized = !!ownerParticipant;
    }
    if (!authorized) {
      const wfExecId = metadata.workflowExecutionId as string | undefined;
      if (wfExecId) {
        const wfExec = await prisma.workflowExecution.findUnique({
          where: { id: wfExecId },
          select: { createdBy: true },
        });
        authorized = !!wfExec?.createdBy && wfExec.createdBy === approvedByUserId;
      }
    }
    if (!authorized) {
      return {
        success: false,
        error: 'Not authorized to approve this knowledge canvas',
        forbidden: true,
      };
    }

    // Check if already approved
    if (metadata.approvedAt) {
      return { success: true, alreadyApproved: true };
    }

    const projectId = metadata.projectId as string | undefined;
    if (!projectId) {
      return { success: false, error: 'Canvas missing projectId in metadata' };
    }

    // Resolve the project's workspace to stamp the denormalized tenant key.
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) {
      return { success: false, error: 'Project not found for canvas' };
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
        workspaceId: project.workspaceId,
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
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'feed', // Re-feed to update the document
        userId: approvedByUserId,
        app: SubApp.CANVAS,
        workspaceId: callerWorkspaceId,
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
 *
 * Backward-compat: pre-XYNE-17290 callers stored the viewAccessId or
 * editAccessId in URLs and JSON metadata blobs, and some in-flight clients
 * may still pass those. If the canonical id lookup misses, fall back to
 * matching the legacy capability-id columns and return the canonical row.
 * This does NOT reintroduce the capability-URL edit gate — resolving via
 * editAccessId here only affects lookup, not authorization.
 */
export async function getCanvasById(canvasId: string) {
  const prisma = DatabaseClient.getInstance();
  const select = {
    id: true,
    title: true,
    content: true,
    metadata: true,
    createdBy: true,
    createdAt: true,
  } as const;
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    select,
  });
  if (canvas) return canvas;
  return prisma.canvas.findFirst({
    where: {
      OR: [{ viewAccessId: canvasId }, { editAccessId: canvasId }],
    },
    select,
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

/**
 * A call's detailed-summary canvas id. Recordings record it on their own row, and
 * a shared call has it copied there too; otherwise fall back to finding the canvas
 * by the call it summarizes, which is how a regular call's is normally reached.
 */
export async function resolveDetailedSummaryCanvasId(call: {
  externalId: string;
  metadata: unknown;
}): Promise<string | null> {
  const metadata = call.metadata as Record<string, unknown> | null;
  const stamped = metadata?.['detailedSummaryCanvasId'];
  if (typeof stamped === 'string' && stamped.trim()) return stamped;
  const found = await findExistingDetailedSummaryCanvas(call.externalId);
  return found?.canvasId ?? null;
}
