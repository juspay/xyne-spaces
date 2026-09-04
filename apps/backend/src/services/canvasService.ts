/**
 * Canvas Service - Creates canvases for knowledge learnings and other purposes
 */

import { defaultBlockSpecs, defaultStyleSpecs } from '@blocknote/core';
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
export async function convertMarkdownToBlockNote(
  markdown: string,
  existingBlocks: unknown[] = [],
): Promise<BlockNoteBlock[]> {
  try {
    const parsed = await withServerEditor(editor => editor.tryParseMarkdownToBlocks(markdown));
    const restored = restoreCustomBlocks(parsed as LooseBlock[], existingBlocks as LooseBlock[]);
    return toJsonSafeValue(restored) as BlockNoteBlock[];
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
  const path = workspaceId ? `/${workspaceId}/chat/canvas/${canvasId}` : `/chat/canvas/${canvasId}`;
  return `${frontendUrl}${path}`;
}

type LooseInline = {
  type?: string;
  text?: string;
  content?: unknown;
  props?: Record<string, unknown>;
  styles?: unknown;
};
type LooseBlock = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: LooseBlock[];
};

// ServerBlockNoteEditor.create() only knows the default schema, so custom inline
// nodes must be rewritten before Markdown export.
const CUSTOM_INLINE_TYPES = new Set(['mention', 'citation', 'math']);

// Render a custom inline node as plain text, mirroring the frontend display
// logic (CanvasMentionSpec: prefer the group name for group mentions, otherwise
// the username).
/** Plain inline content is either the string itself or text nodes holding it. */
function plainInlineToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part =>
      part && typeof part === 'object' && typeof (part as LooseInline).text === 'string'
        ? (part as LooseInline).text
        : '',
    )
    .join('');
}

function customInlineToText(inline: LooseInline): string {
  // Citation chips are annotations that point at a transcript segment; in a
  // plain-text/markdown export (or Vespa index text) they carry no useful prose
  // — the cited words already live in the transcript — so drop them to empty.
  if (inline.type === 'citation') return '';
  // Inline math keeps its LaTeX as plain content, so $…$ is the same formula.
  if (inline.type === 'math') return `$${plainInlineToString(inline.content)}$`;
  const props = inline.props || {};
  const groupId = props['groupId'] as string | undefined;
  const groupName = props['groupName'] as string | undefined;
  const username = props['username'] as string | undefined;
  const name = groupId && groupName ? groupName : username || 'mention';
  return `@${name}`;
}

const DEFAULT_STYLE_NAMES: ReadonlySet<string> = new Set(Object.keys(defaultStyleSpecs));

/**
 * Drop styles the markdown editor has no spec for.
 *
 * Commenting on canvas text applies a `canvasCommentThread` style. The Yjs
 * schema knows it, but the editor that writes markdown is built from the
 * defaults alone, so leaving it on a text node throws and the whole canvas
 * fails to read. Markdown could not carry the annotation anyway.
 */
function knownStylesOnly(styles: unknown): unknown {
  if (!styles || typeof styles !== 'object') return styles;
  return Object.fromEntries(
    Object.entries(styles).filter(([name]) => DEFAULT_STYLE_NAMES.has(name)),
  );
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
    Object.entries(content).map(([key, value]) =>
      key === 'styles' ? [key, knownStylesOnly(value)] : [key, normalizeInlineContent(value)],
    ),
  );
}

const DEFAULT_BLOCK_TYPES: ReadonlySet<string> = new Set(Object.keys(defaultBlockSpecs));

// Default types that still need rewriting: BlockNote serialises a video with
// image syntax and audio as raw HTML, so both are rewritten despite being known.
const REWRITTEN_DEFAULT_TYPES: ReadonlySet<string> = new Set(['video', 'audio', 'file']);

/**
 * A canvas block the server schema has no spec for, rendered as one it does.
 *
 * blocksToMarkdownLossy looks the spec up by block type, so an unmapped type
 * throws on its propSchema and the whole canvas fails to convert — every block
 * lost for the sake of the one that could not be rendered. Returning null drops
 * just that block.
 */
function customBlockToDefault(block: LooseBlock): LooseBlock | null {
  // Diagram and math hold their source as plain content, so a fenced code block
  // is the same text under a language tag.
  if (block.type === 'diagram') {
    return { ...block, type: 'codeBlock', props: { language: 'mermaid' } };
  }
  if (block.type === 'mathBlock') {
    return { ...block, type: 'codeBlock', props: { language: 'latex' } };
  }
  // Whiteboard and embed cannot be drawn from markdown, so they go out as a
  // fence the write side recognises: the whiteboard's id lets restoreCustomBlocks
  // put the original block back rather than lose the drawing, and the labels are
  // what a reader can know about it.
  if (block.type === 'whiteboard') {
    const title = String(block.props?.['title'] ?? 'Untitled Whiteboard');
    const labels = whiteboardLabels(block.props?.['data']);
    const lines = [`id: ${block.id ?? ''}`, `title: ${title}`];
    if (labels.length > 0) lines.push(`labels: ${labels.join(', ')}`);
    return fenceBlock('whiteboard', lines.join('\n'));
  }
  if (block.type === 'embed') {
    const url = String(block.props?.['url'] ?? '');
    return url ? fenceBlock('embed', `url: ${url}`) : null;
  }
  // BlockNote renders a video with image syntax, audio as raw <audio> HTML and a
  // file as a bare link, so a reader cannot tell a clip from a picture and an edit
  // turns one into the other — or into a paragraph. A fence names the kind
  // outright and carries the attachment id back.
  if (block.type === 'video' || block.type === 'audio' || block.type === 'file') {
    const attachment = String(block.props?.['url'] ?? '');
    if (!attachment) return null;
    const lines = [`attachment: ${attachment}`];
    const name = String(block.props?.['name'] ?? '');
    if (name) lines.push(`name: ${name}`);
    const caption = String(block.props?.['caption'] ?? '');
    if (caption) lines.push(`caption: ${caption}`);
    return fenceBlock(block.type, lines.join('\n'));
  }
  return null;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A paragraph whose text is emitted verbatim, so raw HTML survives serialization. */
const htmlBlock = (html: string): LooseBlock => ({
  type: 'paragraph',
  content: [{ type: 'text', text: html, styles: {} }],
});

const fenceBlock = (language: string, text: string): LooseBlock => ({
  type: 'codeBlock',
  props: { language },
  content: [{ type: 'text', text, styles: {} }],
});

/** The `key: value` lines of a fence written by customBlockToDefault. */
function fenceFields(block: LooseBlock): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of plainInlineToString(block.content).split('\n')) {
    const match = /^([a-zA-Z]+):\s*(.*)$/.exec(line);
    if (match?.[1] && match[2] !== undefined) fields[match[1]] = match[2].trim();
  }
  return fields;
}

interface ExcalidrawTextElement {
  type?: string;
  text?: string;
  originalText?: string;
  isDeleted?: boolean;
  x?: number;
  y?: number;
}

/**
 * The text on a whiteboard, in reading order.
 *
 * `data` is an Excalidraw scene; its text elements are both the free labels
 * and the text bound inside shapes, so together they are what the board says.
 */
function whiteboardLabels(data: unknown): string[] {
  let scene: unknown;
  try {
    scene = typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    return [];
  }
  const elements = (scene as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];

  const isText = (element: unknown): element is ExcalidrawTextElement =>
    typeof element === 'object' &&
    element !== null &&
    (element as ExcalidrawTextElement).type === 'text' &&
    !(element as ExcalidrawTextElement).isDeleted;

  const labels = elements
    .filter(isText)
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
    .map(element => (element.originalText ?? element.text ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return [...new Set(labels)];
}

/**
 * The inverse of customBlockToDefault, for markdown coming back in.
 *
 * The server parses with the default schema, so a fence can only become a
 * codeBlock. The canvas renders a mermaid codeBlock through a view-only viewer
 * whose editable source sits in a hidden <pre>, while a diagram block draws the
 * same picture and opens its source on click — so the agent's diagrams are only
 * editable if they come back as diagram blocks.
 */
// Blocks whose content is literal source text, where a $ is just a dollar sign.
const PLAIN_CONTENT_TYPES = new Set(['codeBlock', 'diagram', 'mathBlock']);

// customInlineToText writes inline math back as $…$, but nothing turned that
// into a math node again — so an agent that read a canvas and wrote it back
// flattened every inline formula to literal text. Rejecting a $…$ that opens or
// closes on whitespace or spans a line keeps most prices out of it.
const INLINE_MATH = /\$(?!\s)([^$\n]*[^$\n\s])\$/g;

// What is between the dollars has to contain something only mathematics uses.
// Requiring that, rather than rejecting things that look like numbers, is what
// keeps a price *range* out: "$100-$200" leaves "100-" between the dollars,
// which a numeric test lets through and this does not. A formula of digits and
// a minus sign alone ("$1-2$") is given up in exchange, and stays as text.
const MATHEMATICAL_CHARACTER = /[a-zA-Z\\^_{}=+*/<>]/;

function restoreInlineMath(content: unknown): unknown {
  if (!Array.isArray(content)) return content;

  return content.flatMap((part): LooseInline[] => {
    const node = part as LooseInline;
    if (node?.type !== 'text' || typeof node.text !== 'string' || !node.text.includes('$')) {
      return [node];
    }

    const parts: LooseInline[] = [];
    let cursor = 0;
    for (const match of node.text.matchAll(INLINE_MATH)) {
      const latex = match[1];
      if (latex === undefined || !MATHEMATICAL_CHARACTER.test(latex)) continue;
      const start = match.index ?? 0;
      if (start > cursor) {
        parts.push({ ...node, text: node.text.slice(cursor, start) });
      }
      parts.push({ type: 'math', content: [{ type: 'text', text: latex, styles: {} }] });
      cursor = start + match[0].length;
    }

    if (parts.length === 0) return [node];
    if (cursor < node.text.length) parts.push({ ...node, text: node.text.slice(cursor) });
    return parts;
  });
}

function restoreCustomBlocks(blocks: LooseBlock[], existing: LooseBlock[] = []): LooseBlock[] {
  // A whiteboard is only ever restored from the document being edited: the
  // markdown carries its id and labels, never the drawing.
  const whiteboards = existing.filter(block => block.type === 'whiteboard');
  const restored = new Set<LooseBlock>();
  const takeWhiteboard = (id: string): LooseBlock | undefined => {
    const byId = whiteboards.find(board => board.id === id && !restored.has(board));
    const board = byId ?? whiteboards.find(candidate => !restored.has(candidate));
    if (board) restored.add(board);
    return board;
  };

  // A diagram and an equation go out as a plain ```mermaid / ```latex fence,
  // which is exactly what a person types when they want a code block. Coming
  // back, the two are told apart by whether the canvas actually holds one with
  // this source: an agent editing round the diagram keeps its block, and a
  // fence nobody had before stays the code block it was written as. Both render
  // the same diagram either way — that is what makes this safe.
  const sourceOf = (block: LooseBlock): string =>
    (Array.isArray(block.content) ? block.content : [])
      .map(part => {
        const node = part as LooseInline;
        return typeof node?.text === 'string' ? node.text : '';
      })
      .join('')
      .trim();

  const takeSourceBlock = (type: string, source: string): LooseBlock | undefined => {
    const match = existing.find(
      block => block.type === type && !restored.has(block) && sourceOf(block) === source
    );
    if (match) restored.add(match);
    return match;
  };

  const walk = (level: LooseBlock[]): LooseBlock[] =>
    level.flatMap(block => {
      const next: LooseBlock = { ...block };

      if (Array.isArray(block.children) && block.children.length > 0) {
        next.children = walk(block.children);
      }

      if (block.type !== undefined && !PLAIN_CONTENT_TYPES.has(block.type)) {
        next.content = restoreInlineMath(block.content);
      }

      if (block.type !== 'codeBlock') return [next];

      const language = String(block.props?.['language'] ?? '').toLowerCase();
      if (language === 'mermaid' || language === 'latex') {
        const type = language === 'mermaid' ? 'diagram' : 'mathBlock';
        return takeSourceBlock(type, sourceOf(block))
          ? [{ ...next, type, props: {} }]
          : [next];
      }
      // Only a fence customBlockToDefault wrote carries these fields. One a
      // person typed does not, and is left alone as the code block it is.
      const fields = fenceFields(block);
      if (language === 'whiteboard' && fields['id'] !== undefined) {
        const board = takeWhiteboard(fields['id']);
        return board ? [board] : [];
      }
      if (language === 'embed' && fields['url'] !== undefined) {
        return fields['url'] ? [{ type: 'embed', props: { url: fields['url'] } }] : [];
      }
      if (
        (language === 'video' || language === 'audio' || language === 'file') &&
        fields['attachment'] !== undefined
      ) {
        if (!fields['attachment']) return [];
        return [
          {
            type: language,
            props: {
              url: fields['attachment'],
              ...(fields['name'] ? { name: fields['name'] } : {}),
              ...(fields['caption'] ? { caption: fields['caption'] } : {}),
            },
          },
        ];
      }

      return [next];
    });

  const result = walk(blocks);
  // A drawing the markdown no longer mentions is kept rather than deleted: the
  // writer never saw its content, so it cannot have meant to remove it. Only
  // whiteboards — a diagram or equation the markdown drops really was dropped,
  // since its source was there to be read.
  return [...result, ...whiteboards.filter(board => !restored.has(board))];
}

// Remove citation blocks and replace custom inline nodes before serialization.
function normalizeBlocksForMarkdown(blocks: LooseBlock[]): LooseBlock[] {
  return blocks.flatMap(block => {
    if (block.type === 'citation') return [];

    // Markdown has no toggle, and a bare list item comes back as a plain bullet
    // while a toggleable heading loses both its arrow and its nesting. BlockNote
    // parses <details> back into a toggle with its children intact — and into a
    // toggleable heading when the summary holds an <hN> — so that is what both
    // are written as.
    const isToggleHeading = block.type === 'heading' && block.props?.['isToggleable'] === true;
    if (block.type === 'toggleListItem' || isToggleHeading) {
      const text = escapeHtml(plainInlineToString(block.content));
      const level = Number(block.props?.['level'] ?? 1);
      const summary = isToggleHeading ? `<h${level}>${text}</h${level}>` : text;
      const children = Array.isArray(block.children)
        ? normalizeBlocksForMarkdown(block.children)
        : [];
      return [
        htmlBlock(`<details><summary>${summary}</summary>`),
        ...children,
        htmlBlock('</details>'),
      ];
    }

    const needsRewrite =
      Boolean(block.type) &&
      (REWRITTEN_DEFAULT_TYPES.has(block.type as string) ||
        !DEFAULT_BLOCK_TYPES.has(block.type as string));
    const supported = needsRewrite ? customBlockToDefault(block) : block;
    if (!supported) return [];

    const next: LooseBlock = { ...supported };

    if (supported.content !== undefined) {
      next.content = normalizeInlineContent(supported.content);
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
    // Strip custom inline nodes (e.g. mentions) and rewrite custom blocks the
    // default server schema does not know about, otherwise blocksToMarkdownLossy
    // throws "node type <x> not found in schema" and the whole canvas is lost.
    const normalized = normalizeBlocksForMarkdown((blocks as LooseBlock[]) || []);
    // blocksToMarkdownLossy accepts the blocks array directly
    const markdown = await withServerEditor(editor =>
      editor.blocksToMarkdownLossy(normalized as any),
    );
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
          originalLearnings: originalLearnings.map(l => ({
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
