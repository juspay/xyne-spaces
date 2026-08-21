/**
 * Is a BlockNote canvas effectively empty?
 *
 * Used by the backend to decide whether an agent write needs human approval —
 * filling a blank canvas destroys nothing, so it is never gated.
 *
 * NOTE: apps/dashboard/src/utils/canvasVersioning.ts carries an equivalent
 * implementation for the version-save path. The two are intentionally
 * independent for now; if a third caller appears, collapse them here.
 */

const TEXT_LIKE_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
]);

const isInlineContentEmpty = (content: unknown): boolean => {
  if (content === undefined || content === null) return true;
  if (typeof content === 'string') return content.trim().length === 0;
  if (Array.isArray(content)) return content.every(item => isInlineContentEmpty(item));
  if (typeof content !== 'object') return false;

  const record = content as Record<string, unknown>;
  if (typeof record['text'] === 'string') return record['text'].trim().length === 0;
  if ('content' in record) return isInlineContentEmpty(record['content']);
  return false;
};

const isCanvasBlockEmpty = (block: unknown): boolean => {
  if (block === undefined || block === null) return true;
  if (typeof block !== 'object' || Array.isArray(block)) return isInlineContentEmpty(block);

  const record = block as Record<string, unknown>;
  const blockType = typeof record['type'] === 'string' ? record['type'] : 'paragraph';
  const children = Array.isArray(record['children']) ? record['children'] : [];

  // A non-text block (image, table, embed…) is never "empty" — it carries
  // content even when it has no words.
  if (!TEXT_LIKE_BLOCK_TYPES.has(blockType)) return false;
  if (!isInlineContentEmpty(record['content'])) return false;

  return children.every(child => isCanvasBlockEmpty(child));
};

export const isCanvasContentEmpty = (content: unknown): boolean => {
  if (!Array.isArray(content)) return isInlineContentEmpty(content);
  return content.length === 0 || content.every(block => isCanvasBlockEmpty(block));
};
