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

export const removeUnknownBlocks = <T extends { type?: string; children?: unknown }>(
  blocks: T[],
  knownBlockTypes: ReadonlySet<string>,
): T[] =>
  blocks
    .filter(block => !block?.type || knownBlockTypes.has(block.type))
    .map(block =>
      Array.isArray(block.children) && block.children.length > 0
        ? { ...block, children: removeUnknownBlocks(block.children as T[], knownBlockTypes) }
        : block,
    );

export const knownBlockTypesOf = (schema: unknown): ReadonlySet<string> =>
  new Set(Object.keys((schema as { blockSchema: Record<string, unknown> }).blockSchema));

const isAlreadyResolvableFileSource = (source: string): boolean =>
  source.startsWith('data:') ||
  source.startsWith('blob:') ||
  source.startsWith('http://') ||
  source.startsWith('https://') ||
  source.startsWith('/');

export const resolveFileUrl = async (attachmentId: string): Promise<string> => {
  if (isAlreadyResolvableFileSource(attachmentId)) {
    return attachmentId;
  }

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
