export const PLAIN_TEXT_CANVAS_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'codeBlock',
  'diagram',
  'mathBlock',
]);

const MAX_DEPTH = 64;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const canvasInlineContentToText = (content: unknown, depth = 0): string => {
  if (depth > MAX_DEPTH) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(node => canvasInlineContentToText(node, depth + 1)).join('');
  }
  if (!isRecord(content)) return '';
  if (typeof content['text'] === 'string') return content['text'];
  return canvasInlineContentToText(content['content'], depth + 1);
};

const isPlainTextContent = (content: unknown): boolean =>
  content === undefined ||
  typeof content === 'string' ||
  (Array.isArray(content) &&
    content.every(
      node =>
        isRecord(node) &&
        node['type'] === 'text' &&
        typeof node['text'] === 'string' &&
        (node['styles'] === undefined ||
          (isRecord(node['styles']) && Object.keys(node['styles']).length === 0)),
    ));

const sanitizeBlocks = (
  blocks: unknown[],
  knownBlockTypes: ReadonlySet<string> | undefined,
  depth: number,
  state: { changed: boolean },
): unknown[] => {
  const result: unknown[] = [];
  for (const block of blocks) {
    if (!isRecord(block) || depth > MAX_DEPTH) {
      state.changed = true;
      continue;
    }
    const type = typeof block['type'] === 'string' ? block['type'] : undefined;
    if (type && knownBlockTypes && !knownBlockTypes.has(type)) {
      state.changed = true;
      continue;
    }

    let next = block;
    if (type && PLAIN_TEXT_CANVAS_BLOCK_TYPES.has(type) && !isPlainTextContent(block['content'])) {
      const text = canvasInlineContentToText(block['content']);
      next = { ...next, content: text ? [{ type: 'text', text, styles: {} }] : [] };
      state.changed = true;
    }
    if (Array.isArray(block['children']) && block['children'].length > 0) {
      next = {
        ...next,
        children: sanitizeBlocks(block['children'], knownBlockTypes, depth + 1, state),
      };
    }
    result.push(next);
  }
  return result;
};

export function sanitizeCanvasContent<T>(
  content: T,
  knownBlockTypes?: ReadonlySet<string>,
): { content: T; changed: boolean } {
  if (!Array.isArray(content)) return { content, changed: false };
  const state = { changed: false };
  const sanitized = sanitizeBlocks(content, knownBlockTypes, 0, state);
  return { content: state.changed ? (sanitized as T) : content, changed: state.changed };
}
