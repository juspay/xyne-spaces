import type { PartialBlock } from '@blocknote/core';
import { diffArrays, diffWordsWithSpace } from 'diff';
import { normalizeCanvasContent } from './canvasVersioning';

/**
 * Builds the document shown by the read-only version preview while diff mode is on.
 *
 * The result is the selected version's document — same blocks, same types, same inline
 * formatting — with text that exists only in that version highlighted green, and text
 * that exists only in the current canvas re-inserted inline in red strikethrough. The
 * diff therefore reads as the document itself rather than as a separate list of hunks.
 *
 * Highlighting uses BlockNote's built-in `backgroundColor` / `strike` styles, so no
 * schema or editor change is needed to render it.
 */

type UnknownRecord = Record<string, unknown>;

const ADDED_STYLES: UnknownRecord = { backgroundColor: 'green' };
const REMOVED_STYLES: UnknownRecord = { backgroundColor: 'red', strike: true };

/** Separates the parts of a block alignment key so unrelated fields cannot collide. */
const KEY_SEPARATOR = '\u0000';

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A block's inline content flattened into a character-addressable stream.
 * Text segments carry their original styles (and link) so slices can be re-emitted with
 * the formatting they had; atoms are non-text inline content (mentions, citations) which
 * contribute no characters but must keep their position.
 */
type TextSegment = {
  kind: 'text';
  text: string;
  styles: UnknownRecord;
  href?: string;
  start: number;
  end: number;
};

type AtomSegment = { kind: 'atom'; node: unknown; start: number };

type InlineSegment = TextSegment | AtomSegment;

const collectInlineSegments = (
  content: unknown,
  segments: InlineSegment[],
  offset: number,
  href?: string,
): number => {
  const linkStyles = href ? { href } : {};

  if (typeof content === 'string') {
    if (!content) return offset;
    segments.push({
      kind: 'text',
      text: content,
      styles: {},
      start: offset,
      end: offset + content.length,
      ...linkStyles,
    });
    return offset + content.length;
  }

  if (!Array.isArray(content)) return offset;

  let cursor = offset;
  for (const item of content) {
    if (!isRecord(item)) {
      segments.push({ kind: 'atom', node: item, start: cursor });
      continue;
    }

    if (item['type'] === 'text' && typeof item['text'] === 'string') {
      const text = item['text'];
      if (!text) continue;
      segments.push({
        kind: 'text',
        text,
        styles: isRecord(item['styles']) ? item['styles'] : {},
        start: cursor,
        end: cursor + text.length,
        ...linkStyles,
      });
      cursor += text.length;
      continue;
    }

    // Links wrap their own inline content: flatten it so link text takes part in the diff.
    if (item['type'] === 'link' && typeof item['href'] === 'string') {
      const next = collectInlineSegments(item['content'], segments, cursor, item['href']);
      if (next === cursor) segments.push({ kind: 'atom', node: item, start: cursor });
      cursor = next;
      continue;
    }

    segments.push({ kind: 'atom', node: item, start: cursor });
  }

  return cursor;
};

/** Returns null when the block's content is not an inline stream (tables, images, files). */
const getInlineSegments = (block: UnknownRecord): InlineSegment[] | null => {
  const content = block['content'];
  if (typeof content !== 'string' && !Array.isArray(content)) return null;

  const segments: InlineSegment[] = [];
  collectInlineSegments(content, segments, 0);
  return segments;
};

const segmentsToText = (segments: InlineSegment[]): string =>
  segments.reduce((text, segment) => (segment.kind === 'text' ? text + segment.text : text), '');

const getBlockChildren = (block: UnknownRecord): UnknownRecord[] =>
  Array.isArray(block['children']) ? block['children'].filter(isRecord) : [];

/**
 * Blocks are aligned on type + own text, so a block whose text is untouched keeps its
 * identity even when neighbouring blocks were inserted or deleted around it.
 */
const getBlockKey = (block: UnknownRecord): string => {
  const type = typeof block['type'] === 'string' ? block['type'] : 'paragraph';
  const segments = getInlineSegments(block);
  if (segments) return `${type}${KEY_SEPARATOR}${segmentsToText(segments)}`;

  // Non-text blocks have nothing to word-diff, so they compare whole.
  return [
    type,
    JSON.stringify(block['content'] ?? null),
    JSON.stringify(block['props'] ?? null),
  ].join(KEY_SEPARATOR);
};

/** Emits `[from, to)` of the version's inline stream, keeping original formatting. */
const pushSegmentSlice = (
  target: unknown[],
  segments: InlineSegment[],
  from: number,
  to: number,
  extraStyles: UnknownRecord,
): void => {
  for (const segment of segments) {
    if (segment.kind === 'atom') {
      if (segment.start >= from && segment.start < to) target.push(segment.node);
      continue;
    }

    const start = Math.max(from, segment.start);
    const end = Math.min(to, segment.end);
    if (end <= start) continue;

    const textNode: UnknownRecord = {
      type: 'text',
      text: segment.text.slice(start - segment.start, end - segment.start),
      styles: { ...segment.styles, ...extraStyles },
    };

    target.push(
      segment.href ? { type: 'link', href: segment.href, content: [textNode] } : textNode,
    );
  }
};

/**
 * Word-diffs one block's text against its counterpart and rebuilds the version block's
 * inline content with added text highlighted and removed text spliced back in.
 * Returns null when the block cannot be diffed inline.
 */
const buildInlineDiffContent = (
  currentBlock: UnknownRecord,
  versionBlock: UnknownRecord,
): unknown[] | null => {
  const segments = getInlineSegments(versionBlock);
  if (!segments) return null;

  const currentSegments = getInlineSegments(currentBlock);
  const currentText = currentSegments ? segmentsToText(currentSegments) : '';
  const versionText = segmentsToText(segments);

  const content: unknown[] = [];
  let cursor = 0;

  // `added` is text only in the version, `removed` is text only in the current canvas.
  for (const change of diffWordsWithSpace(currentText, versionText)) {
    if (!change.value) continue;

    if (change.removed) {
      content.push({ type: 'text', text: change.value, styles: { ...REMOVED_STYLES } });
      continue;
    }

    const next = cursor + change.value.length;
    pushSegmentSlice(content, segments, cursor, next, change.added ? ADDED_STYLES : {});
    cursor = next;
  }

  // Flush atoms sitting at the very end of the block, which no slice above can reach.
  pushSegmentSlice(content, segments, cursor, versionText.length + 1, {});

  return content;
};

const markInlineItem = (item: unknown, extraStyles: UnknownRecord): unknown => {
  if (!isRecord(item)) return item;

  if (item['type'] === 'text' && typeof item['text'] === 'string') {
    const styles = isRecord(item['styles']) ? item['styles'] : {};
    return { ...item, styles: { ...styles, ...extraStyles } };
  }

  if (Array.isArray(item['content'])) {
    return { ...item, content: item['content'].map(child => markInlineItem(child, extraStyles)) };
  }

  return item;
};

const markTableCell = (cell: unknown, extraStyles: UnknownRecord): unknown => {
  if (Array.isArray(cell)) return cell.map(item => markInlineItem(item, extraStyles));
  if (isRecord(cell) && 'content' in cell) {
    return { ...cell, content: markInlineContent(cell['content'], extraStyles) };
  }
  return cell;
};

function markInlineContent(content: unknown, extraStyles: UnknownRecord): unknown {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content, styles: { ...extraStyles } }] : content;
  }

  if (Array.isArray(content)) {
    return content.map(item => markInlineItem(item, extraStyles));
  }

  // Table content: { type: 'tableContent', rows: [{ cells: [...] }] }
  if (isRecord(content) && Array.isArray(content['rows'])) {
    return {
      ...content,
      rows: (content['rows'] as unknown[]).map(row =>
        isRecord(row) && Array.isArray(row['cells'])
          ? {
              ...row,
              cells: (row['cells'] as unknown[]).map(cell => markTableCell(cell, extraStyles)),
            }
          : row,
      ),
    };
  }

  return content;
}

/**
 * Applies one diff style to every piece of text in a block and its children.
 * `dropId` is set for blocks lifted from the current canvas so their ids cannot collide
 * with the version blocks they are rendered next to.
 */
const markBlock = (
  block: UnknownRecord,
  extraStyles: UnknownRecord,
  dropId: boolean,
): UnknownRecord => {
  const marked: UnknownRecord = { ...block };

  if ('content' in block) marked['content'] = markInlineContent(block['content'], extraStyles);

  const children = getBlockChildren(block);
  if (children.length > 0) {
    marked['children'] = children.map(child => markBlock(child, extraStyles, dropId));
  }

  if (dropId) delete marked['id'];

  return marked;
};

const mergeUnchangedBlock = (
  currentBlock: UnknownRecord | undefined,
  versionBlock: UnknownRecord,
): UnknownRecord => {
  const currentChildren = currentBlock ? getBlockChildren(currentBlock) : [];
  const versionChildren = getBlockChildren(versionBlock);
  if (currentChildren.length === 0 && versionChildren.length === 0) return versionBlock;

  return { ...versionBlock, children: diffBlockLists(currentChildren, versionChildren) };
};

const buildModifiedBlocks = (
  currentBlock: UnknownRecord | undefined,
  versionBlock: UnknownRecord,
): UnknownRecord[] => {
  if (!currentBlock) return [markBlock(versionBlock, ADDED_STYLES, false)];

  const inlineContent = buildInlineDiffContent(currentBlock, versionBlock);
  // Nothing to word-diff (image, table, file...): show the old and the new side by side.
  if (!inlineContent) {
    return [
      markBlock(currentBlock, REMOVED_STYLES, true),
      markBlock(versionBlock, ADDED_STYLES, false),
    ];
  }

  const merged: UnknownRecord = { ...versionBlock, content: inlineContent };
  const currentChildren = getBlockChildren(currentBlock);
  const versionChildren = getBlockChildren(versionBlock);
  if (currentChildren.length > 0 || versionChildren.length > 0) {
    merged['children'] = diffBlockLists(currentChildren, versionChildren);
  }

  return [merged];
};

function diffBlockLists(
  currentBlocks: UnknownRecord[],
  versionBlocks: UnknownRecord[],
): UnknownRecord[] {
  const changes = diffArrays(currentBlocks.map(getBlockKey), versionBlocks.map(getBlockKey));
  const result: UnknownRecord[] = [];
  let currentIndex = 0;
  let versionIndex = 0;

  const takeCurrent = (): UnknownRecord | undefined => currentBlocks[currentIndex++];
  const takeVersion = (): UnknownRecord | undefined => versionBlocks[versionIndex++];

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    if (!change) continue;

    const count = change.count ?? change.value.length;

    if (!change.added && !change.removed) {
      for (let offset = 0; offset < count; offset += 1) {
        const currentBlock = takeCurrent();
        const versionBlock = takeVersion();
        if (versionBlock) result.push(mergeUnchangedBlock(currentBlock, versionBlock));
      }
      continue;
    }

    if (change.removed) {
      // A removed run followed by an added run is an edit: pair the blocks up so their
      // text is diffed in place instead of rendering the block twice.
      const nextChange = changes[index + 1];
      const addedCount =
        nextChange && nextChange.added ? (nextChange.count ?? nextChange.value.length) : 0;
      const pairedCount = Math.min(count, addedCount);

      for (let offset = 0; offset < pairedCount; offset += 1) {
        const currentBlock = takeCurrent();
        const versionBlock = takeVersion();
        if (versionBlock) result.push(...buildModifiedBlocks(currentBlock, versionBlock));
      }

      for (let offset = pairedCount; offset < count; offset += 1) {
        const currentBlock = takeCurrent();
        if (currentBlock) result.push(markBlock(currentBlock, REMOVED_STYLES, true));
      }

      if (nextChange && nextChange.added) {
        for (let offset = pairedCount; offset < addedCount; offset += 1) {
          const versionBlock = takeVersion();
          if (versionBlock) result.push(markBlock(versionBlock, ADDED_STYLES, false));
        }
        index += 1;
      }

      continue;
    }

    for (let offset = 0; offset < count; offset += 1) {
      const versionBlock = takeVersion();
      if (versionBlock) result.push(markBlock(versionBlock, ADDED_STYLES, false));
    }
  }

  return result;
}

const toBlockList = (content: unknown): UnknownRecord[] =>
  Array.isArray(content) ? content.filter(isRecord) : [];

/**
 * Produces the version document annotated with its differences against the current canvas.
 * Both inputs are normalized (and therefore deep-cloned) so the caller's content is never
 * mutated by the rebuild.
 */
export const buildCanvasVersionDiffContent = (
  currentContent: unknown,
  versionContent: unknown,
): PartialBlock[] => {
  const currentBlocks = toBlockList(normalizeCanvasContent(currentContent));
  const versionBlocks = toBlockList(normalizeCanvasContent(versionContent));

  return diffBlockLists(currentBlocks, versionBlocks) as unknown as PartialBlock[];
};
