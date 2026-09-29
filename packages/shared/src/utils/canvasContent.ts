/**
 * Canvas content sanitizer (XYNE-65102).
 *
 * A canvas is stored as a BlockNote block array in `Canvas.content` (and a
 * copy of it in `CanvasVersion.content`). The editor turns that array into a
 * ProseMirror document with `createChecked`, which throws on the first node
 * whose children break the schema. React creates the editor inside `useMemo`,
 * so one bad block takes the whole page down, and because "My Canvas" reopens
 * the last canvas on every visit, the user is locked out until local storage
 * is cleared.
 *
 * The production crash was a code block holding a link:
 *
 *   RangeError: Invalid content for node codeBlock: <"git clone ", link(...)>
 *
 * Code-like blocks are declared with `code: true`, so ProseMirror only lets
 * them hold unmarked text: no links, no bold/italic, no mentions.
 *
 * This module is the single definition of "content the editor can load". It
 * is pure (no DOM, no BlockNote import) so the same function runs:
 *   - in the backend Prisma middleware, for every Prisma write to a canvas,
 *   - in the Zero mutators, for every write from a browser or agent,
 *   - in the dashboard, right before content is handed to the editor, which
 *     also covers rows written outside the app (psql, scripts, migrations).
 *
 * It repairs rather than rejects: a writer that produced a link inside a code
 * block keeps its text, and the save succeeds.
 */

/**
 * Block types whose ProseMirror node is `code: true` and so only accepts
 * unmarked text. Must stay in sync with the dashboard canvas schema
 * (CanvasCodeBlockSpec, CanvasDiagramSpec, CanvasMathBlockSpec) and with
 * `PLAIN_CONTENT_TYPES` in the backend markdown converter.
 */
export const PLAIN_TEXT_CANVAS_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'codeBlock',
  'diagram',
  'mathBlock',
]);

/** Guards against pathological nesting (and cycles in hand-built objects). */
const MAX_CANVAS_BLOCK_DEPTH = 64;

export interface CanvasContentSanitizeReport {
  /** True when the returned content differs from the input. */
  changed: boolean;
  /** Plain-text blocks whose rich inline content was flattened to text. */
  flattenedPlainTextBlocks: number;
  /** Inline nodes removed because they were not objects or had no usable text. */
  droppedInlineNodes: number;
  /** Links nested inside another link, replaced with their text. */
  flattenedNestedLinks: number;
  /** Inline nodes rewritten into a valid shape (strings inside links, links without an href). */
  normalizedInlineNodes: number;
  /** Blocks removed because they were not objects, too deep, or unknown to the schema. */
  droppedBlocks: number;
  /** Distinct block types removed as unknown (for logging). */
  droppedBlockTypes: string[];
  /** Distinct types of the plain-text blocks that were flattened (for logging). */
  flattenedBlockTypes: string[];
}

export interface SanitizeCanvasContentOptions {
  /**
   * Block types the target schema can render. Blocks of any other type are
   * dropped. Leave undefined on the server, where the schema is not known and
   * unknown blocks must be kept for newer clients.
   */
  knownBlockTypes?: ReadonlySet<string>;
}

export interface SanitizeCanvasContentResult<T> {
  content: T;
  report: CanvasContentSanitizeReport;
}

type UnknownRecord = Record<string, unknown>;

type PlainTextNode = { type: 'text'; text: string; styles: Record<string, never> };

interface SanitizeState {
  flattenedPlainTextBlocks: number;
  droppedInlineNodes: number;
  flattenedNestedLinks: number;
  normalizedInlineNodes: number;
  droppedBlocks: number;
  droppedBlockTypes: Set<string>;
  flattenedBlockTypes: Set<string>;
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Collect the visible text of any inline content: a string, a text node, a
 * link (its label), or a custom node that carries `text` or `content`.
 * Nodes with no text (a mention with only props) contribute nothing.
 */
export const canvasInlineContentToText = (content: unknown, depth = 0): string => {
  if (depth > MAX_CANVAS_BLOCK_DEPTH) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(node => canvasInlineContentToText(node, depth + 1)).join('');
  }
  if (!isRecord(content)) return '';
  if (typeof content['text'] === 'string') return content['text'];
  return canvasInlineContentToText(content['content'], depth + 1);
};

const toPlainTextContent = (content: unknown): PlainTextNode[] => {
  const text = canvasInlineContentToText(content);
  return text ? [{ type: 'text', text, styles: {} }] : [];
};

/** True when content is already exactly what a plain-text block accepts. */
const isPlainTextContent = (content: unknown): boolean => {
  if (content === undefined || typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  return content.every(
    node =>
      isRecord(node) &&
      node['type'] === 'text' &&
      typeof node['text'] === 'string' &&
      (node['styles'] === undefined ||
        (isRecord(node['styles']) && Object.keys(node['styles']).length === 0)),
  );
};

/**
 * Clean the children of a link. BlockNote renders a link's `content` as
 * styled text only, so nested links are replaced by their text and junk
 * entries are dropped.
 */
const sanitizeLinkContent = (content: unknown, state: SanitizeState): unknown => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    state.droppedInlineNodes += 1;
    return [];
  }

  const cleaned: unknown[] = [];
  let changed = false;
  for (const node of content) {
    if (typeof node === 'string') {
      // A link holds styled text nodes only, not the string shorthand.
      cleaned.push({ type: 'text', text: node, styles: {} });
      state.normalizedInlineNodes += 1;
      changed = true;
      continue;
    }
    if (!isRecord(node)) {
      state.droppedInlineNodes += 1;
      changed = true;
      continue;
    }
    if (node['type'] === 'link') {
      // ProseMirror has no link-inside-link; keep the label only.
      state.flattenedNestedLinks += 1;
      changed = true;
      const text = canvasInlineContentToText(node['content']);
      if (text) cleaned.push({ type: 'text', text, styles: {} });
      continue;
    }
    if (typeof node['text'] !== 'string') {
      state.droppedInlineNodes += 1;
      changed = true;
      continue;
    }
    cleaned.push(node);
  }
  // Keep the original reference when nothing changed.
  return changed ? cleaned : content;
};

/**
 * Clean the inline content of a normal (rich text) block. Only shapes that
 * are known to crash editor creation are touched: non-object entries, text
 * nodes without string text, links without an href, and nested links.
 * Strings (valid BlockNote shorthand) and custom inline nodes (mention,
 * citation, math) are kept as they are.
 */
const sanitizeRichInlineContent = (content: unknown, state: SanitizeState): unknown => {
  // Strings are valid shorthand; objects are table content (rows/cells) and
  // are left to the table spec.
  if (!Array.isArray(content)) return content;

  const cleaned: unknown[] = [];
  let changed = false;
  for (const node of content) {
    if (typeof node === 'string') {
      cleaned.push(node);
      continue;
    }
    if (!isRecord(node) || typeof node['type'] !== 'string') {
      state.droppedInlineNodes += 1;
      changed = true;
      continue;
    }
    if (node['type'] === 'text' && typeof node['text'] !== 'string') {
      state.droppedInlineNodes += 1;
      changed = true;
      continue;
    }
    if (node['type'] === 'link') {
      const linkContent = sanitizeLinkContent(node['content'], state);
      if (typeof node['href'] !== 'string' || node['href'].length === 0) {
        // A link without a target is only its label.
        changed = true;
        const text = canvasInlineContentToText(linkContent);
        if (text) {
          cleaned.push({ type: 'text', text, styles: {} });
          state.normalizedInlineNodes += 1;
        } else {
          state.droppedInlineNodes += 1;
        }
        continue;
      }
      if (linkContent !== node['content']) {
        cleaned.push({ ...node, content: linkContent });
        changed = true;
        continue;
      }
    }
    cleaned.push(node);
  }
  // Keep the original reference when nothing changed.
  return changed ? cleaned : content;
};

const sanitizeBlocks = (
  blocks: unknown[],
  options: SanitizeCanvasContentOptions,
  state: SanitizeState,
  depth: number,
): unknown[] => {
  const result: unknown[] = [];

  for (const block of blocks) {
    if (!isRecord(block) || depth > MAX_CANVAS_BLOCK_DEPTH) {
      state.droppedBlocks += 1;
      continue;
    }

    const type = typeof block['type'] === 'string' ? block['type'] : undefined;
    // A block with no type becomes a paragraph in BlockNote, so it is kept.
    if (type && options.knownBlockTypes && !options.knownBlockTypes.has(type)) {
      state.droppedBlocks += 1;
      state.droppedBlockTypes.add(type);
      continue;
    }

    let next: UnknownRecord = block;

    if (type && PLAIN_TEXT_CANVAS_BLOCK_TYPES.has(type)) {
      if (!isPlainTextContent(block['content'])) {
        next = { ...next, content: toPlainTextContent(block['content']) };
        state.flattenedPlainTextBlocks += 1;
        state.flattenedBlockTypes.add(type);
      }
    } else if (block['content'] !== undefined) {
      const content = sanitizeRichInlineContent(block['content'], state);
      if (content !== block['content']) next = { ...next, content };
    }

    const children = block['children'];
    if (children !== undefined && !Array.isArray(children)) {
      // BlockNote iterates children; anything else crashes block creation.
      next = { ...next, children: [] };
      state.droppedBlocks += 1;
    } else if (Array.isArray(children) && children.length > 0) {
      next = { ...next, children: sanitizeBlocks(children, options, state, depth + 1) };
    }

    result.push(next);
  }

  return result;
};

const createState = (): SanitizeState => ({
  flattenedPlainTextBlocks: 0,
  droppedInlineNodes: 0,
  flattenedNestedLinks: 0,
  normalizedInlineNodes: 0,
  droppedBlocks: 0,
  droppedBlockTypes: new Set(),
  flattenedBlockTypes: new Set(),
});

const toReport = (state: SanitizeState): CanvasContentSanitizeReport => ({
  changed:
    state.flattenedPlainTextBlocks > 0 ||
    state.droppedInlineNodes > 0 ||
    state.flattenedNestedLinks > 0 ||
    state.normalizedInlineNodes > 0 ||
    state.droppedBlocks > 0,
  flattenedPlainTextBlocks: state.flattenedPlainTextBlocks,
  droppedInlineNodes: state.droppedInlineNodes,
  flattenedNestedLinks: state.flattenedNestedLinks,
  normalizedInlineNodes: state.normalizedInlineNodes,
  droppedBlocks: state.droppedBlocks,
  droppedBlockTypes: [...state.droppedBlockTypes],
  flattenedBlockTypes: [...state.flattenedBlockTypes],
});

/**
 * Sanitize a canvas block array so the editor can always load it.
 *
 * Never throws. Content that is not an array (null, Prisma JSON null
 * sentinels, legacy shapes) is returned untouched with `changed: false`, so
 * callers can run this on any value they are about to write. When nothing
 * needed fixing the original reference is returned.
 */
export function sanitizeCanvasContent<T>(
  content: T,
  options: SanitizeCanvasContentOptions = {},
): SanitizeCanvasContentResult<T> {
  const state = createState();
  if (!Array.isArray(content)) {
    return { content, report: toReport(state) };
  }

  const sanitized = sanitizeBlocks(content, options, state, 0);
  const report = toReport(state);
  return { content: report.changed ? (sanitized as T) : content, report };
}
