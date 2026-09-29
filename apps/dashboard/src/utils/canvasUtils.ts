import { sanitizeCanvasContent } from '@xyne/shared';
import { logger, Event as LogEvent } from './logger';
import { createPreviewUrl } from '../services/clients/fileFetchService';
import { BASE_URL } from '../services/clients/apiClient';
import type { TocHeading } from '../components/Canvas/TableOfContents';
import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core';

/**
 * Make stored canvas content safe to hand to the editor (XYNE-65102).
 *
 * The backend repairs content on every write, but rows can still reach the
 * browser unrepaired: rows written before the fix, restored versions, raw SQL
 * or scripts run against the database, and blocks from a newer client that
 * this build does not know. BlockNote throws on the first invalid node while
 * the editor is being created, so this runs on every load path:
 *
 *   - drops blocks whose type the schema has no spec for,
 *   - flattens rich inline content (links, styles, mentions) inside plain-text
 *     blocks such as `codeBlock` to their text,
 *   - drops malformed inline nodes and flattens nested links.
 *
 * The rules live in `@xyne/shared` so the server and the browser agree on
 * what "valid" means. Repairs are logged with the canvas id so rows that
 * still need a data fix can be found.
 */
export const removeUnknownBlocks = <T extends { type?: string; children?: unknown; content?: unknown }>(
  blocks: T[],
  knownBlockTypes: ReadonlySet<string>,
  canvasId?: string,
): T[] => {
  try {
    const { content, report } = sanitizeCanvasContent(blocks, { knownBlockTypes });
    if (report.changed) {
      logger.warn(LogEvent.CANVAS_CONTENT_REPAIRED, {
        canvasId,
        ...report,
      });
    }
    return content;
  } catch (error) {
    // The sanitizer is written not to throw; if it ever does, loading the raw
    // content is still better than failing here. The render boundary around
    // the editor contains whatever happens next.
    logger.error(LogEvent.CANVAS_CONTENT_SANITIZE_FAILED, {
      canvasId,
      message: error instanceof Error ? error.message : String(error),
    });
    return blocks;
  }
};

export const knownBlockTypesOf = (schema: unknown): ReadonlySet<string> =>
  new Set(Object.keys((schema as { blockSchema: Record<string, unknown> }).blockSchema));

export const resolveFileUrl = async (attachmentId: string): Promise<string> => {
  try {
    const blob = await createPreviewUrl(attachmentId);

    const blobUrl = URL.createObjectURL(blob);
    return blobUrl;
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Error resolving file URL:'),
      error: error,
    });
    return `${BASE_URL}/attachments/${attachmentId}/download`;
  }
};

export const extractHeadingsFromBlocks = (
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>,
): TocHeading[] => {
  const headingBlocks: Array<{
    id: string;
    type: string;
    props: { level?: number };
    content?: Array<{ type: string; text?: string }>;
  }> = [];

  editor.forEachBlock(block => {
    const level = block.props?.['level'];
    if (block.type === 'heading' && typeof level === 'number' && [1, 2, 3].includes(level)) {
      headingBlocks.push(block as (typeof headingBlocks)[0]);
    }
    return true;
  });

  return headingBlocks
    .map(block => {
      const level = block.props?.['level'];
      if (typeof level !== 'number') return null;

      const textParts: string[] = [];

      if (block.content && Array.isArray(block.content)) {
        block.content.forEach(item => {
          if (item.type === 'text' && item.text) {
            textParts.push(item.text);
          }
        });
      }

      const text = textParts.join('').trim();

      return text
        ? {
            id: block.id,
            text,
            level,
          }
        : null;
    })
    .filter((heading): heading is TocHeading => heading !== null);
};

export const scrollToHeading = (id: string, container?: HTMLElement | null): void => {
  if (!id) return;

  const searchRoot = container || document;
  const blockElement = searchRoot.querySelector(`[data-id="${id}"]`);

  if (blockElement) {
    blockElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};
