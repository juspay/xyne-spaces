// ---------------------------------------------------------------------------
// Canvas document model for read-only native rendering.
//
// A canvas lives in one of two shapes:
//   • BlockNote JSON blocks (the `canvases.content` column — empty for
//     collaborative canvases, which every call summary / PRD canvas is), or
//   • a Y-Sweet Yjs doc whose `document-store` XmlFragment holds the
//     y-prosemirror tree BlockNote edits (blockGroup › blockContainer › block).
// Both are folded into the same small tree so one renderer draws either.
// ---------------------------------------------------------------------------

export const CANVAS_XML_FRAGMENT = 'document-store';

export interface InlineStyles {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  textColor?: string;
  backgroundColor?: string;
}

export type CanvasInline =
  | { kind: 'text'; text: string; styles: InlineStyles; href?: string }
  | { kind: 'mention'; userId: string; label: string }
  | {
      kind: 'citation';
      callId: string;
      segment: number | null;
      timestamp: string;
      speaker: string;
      snippet: string;
      count: number;
    }
  | { kind: 'break' };

export interface CanvasTableCell {
  content: CanvasInline[];
  isHeader: boolean;
}

export interface CanvasBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: CanvasInline[];
  /** Only set for `table` blocks. */
  rows?: CanvasTableCell[][];
  children: CanvasBlock[];
}

// ── Shared helpers ──────────────────────────────────────────────────────────

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

const parseSegment = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const countCitationSegments = (raw: unknown): number => {
  if (typeof raw !== 'string' || !raw) return 1;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.length : 1;
  } catch {
    return 1;
  }
};

const citationFromProps = (props: Record<string, unknown>): CanvasInline => ({
  kind: 'citation',
  callId: asString(props['callId']),
  segment: parseSegment(props['segment']),
  timestamp: asString(props['timestamp']),
  speaker: asString(props['speaker']),
  snippet: asString(props['snippet']),
  count: countCitationSegments(props['segments']),
});

const mentionFromProps = (props: Record<string, unknown>): CanvasInline => ({
  kind: 'mention',
  userId: asString(props['userId'] ?? props['id']),
  label: asString(props['username'] ?? props['label'] ?? props['name'] ?? props['userEmail']),
});

/** y-prosemirror suffixes overlapping marks of the same type with `--<hash>`. */
const markName = (key: string): string => key.split('--')[0] ?? key;

function stylesFromMarks(marks: Record<string, unknown>): {
  styles: InlineStyles;
  href?: string;
} {
  const styles: InlineStyles = {};
  let href: string | undefined;
  for (const [rawKey, value] of Object.entries(marks)) {
    if (value === null || value === undefined || value === false) continue;
    const key = markName(rawKey);
    switch (key) {
      case 'bold':
      case 'italic':
      case 'underline':
      case 'code':
        styles[key] = true;
        break;
      case 'strike':
      case 'strikethrough':
        styles.strike = true;
        break;
      case 'textColor':
      case 'backgroundColor': {
        const colour = asString(asRecord(value)['stringValue'] ?? value);
        if (colour && colour !== 'default') styles[key] = colour;
        break;
      }
      case 'link': {
        const linkHref = asString(asRecord(value)['href']);
        if (linkHref) href = linkHref;
        break;
      }
      default:
        break;
    }
  }
  return href ? { styles, href } : { styles };
}

/** Merge adjacent text runs that render identically (Yjs deltas fragment a lot). */
function compactInline(nodes: CanvasInline[]): CanvasInline[] {
  const out: CanvasInline[] = [];
  for (const node of nodes) {
    const previous = out[out.length - 1];
    if (
      node.kind === 'text' &&
      previous?.kind === 'text' &&
      previous.href === node.href &&
      JSON.stringify(previous.styles) === JSON.stringify(node.styles)
    ) {
      out[out.length - 1] = { ...previous, text: previous.text + node.text };
      continue;
    }
    if (node.kind === 'text' && node.text.length === 0) continue;
    out.push(node);
  }
  return out;
}

// ── BlockNote JSON → CanvasBlock ────────────────────────────────────────────

function inlineFromBlockNoteJson(content: unknown): CanvasInline[] {
  if (typeof content === 'string') return [{ kind: 'text', text: content, styles: {} }];
  if (!Array.isArray(content)) return [];
  const out: CanvasInline[] = [];
  for (const raw of content) {
    const node = asRecord(raw);
    const type = asString(node['type']);
    if (type === 'text') {
      out.push({
        kind: 'text',
        text: asString(node['text']),
        styles: stylesFromMarks(asRecord(node['styles'])).styles,
      });
    } else if (type === 'link') {
      const href = asString(node['href']);
      for (const child of inlineFromBlockNoteJson(node['content'])) {
        out.push(child.kind === 'text' ? { ...child, href } : child);
      }
    } else if (type === 'mention') {
      out.push(mentionFromProps(asRecord(node['props'])));
    } else if (type === 'citation') {
      out.push(citationFromProps(asRecord(node['props'])));
    } else if (type === 'hardBreak') {
      out.push({ kind: 'break' });
    } else if (node['content'] !== undefined) {
      out.push(...inlineFromBlockNoteJson(node['content']));
    }
  }
  return compactInline(out);
}

function tableRowsFromBlockNoteJson(content: unknown): CanvasTableCell[][] {
  const rows = asRecord(content)['rows'];
  if (!Array.isArray(rows)) return [];
  const headerRows = Number(asRecord(content)['headerRows'] ?? 0);
  return rows.map((row, rowIndex) => {
    const cells = asRecord(row)['cells'];
    if (!Array.isArray(cells)) return [];
    return cells.map(cell => {
      const cellRecord = asRecord(cell);
      const cellContent =
        cellRecord['type'] === 'tableCell' ? cellRecord['content'] : (cell as unknown);
      return { content: inlineFromBlockNoteJson(cellContent), isHeader: rowIndex < headerRows };
    });
  });
}

export function blocksFromBlockNoteJson(blocks: unknown): CanvasBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.map((raw, index): CanvasBlock => {
    const block = asRecord(raw);
    const type = asString(block['type']) || 'paragraph';
    const isTable = type === 'table';
    return {
      id: asString(block['id']) || `json-${index}`,
      type,
      props: asRecord(block['props']),
      content: isTable ? [] : inlineFromBlockNoteJson(block['content']),
      ...(isTable ? { rows: tableRowsFromBlockNoteJson(block['content']) } : {}),
      children: blocksFromBlockNoteJson(block['children']),
    };
  });
}

// ── Yjs (y-prosemirror) → CanvasBlock ───────────────────────────────────────

/** The Yjs shapes this reader touches — typed structurally so it stays pure. */
interface YXmlTextLike {
  toDelta: () => Array<{ insert?: unknown; attributes?: Record<string, unknown> }>;
}
interface YXmlElementLike {
  nodeName: string;
  getAttributes: () => Record<string, unknown>;
  toArray: () => unknown[];
}

const isXmlElement = (node: unknown): node is YXmlElementLike =>
  !!node &&
  typeof (node as YXmlElementLike).nodeName === 'string' &&
  typeof (node as YXmlElementLike).toArray === 'function';

const isXmlText = (node: unknown): node is YXmlTextLike =>
  !!node && typeof (node as YXmlTextLike).toDelta === 'function' && !isXmlElement(node);

function inlineFromYChildren(children: readonly unknown[]): CanvasInline[] {
  const out: CanvasInline[] = [];
  for (const child of children) {
    if (isXmlText(child)) {
      for (const op of child.toDelta()) {
        if (typeof op.insert !== 'string') continue;
        const { styles, href } = stylesFromMarks(op.attributes ?? {});
        out.push(
          href
            ? { kind: 'text', text: op.insert, styles, href }
            : {
                kind: 'text',
                text: op.insert,
                styles,
              },
        );
      }
      continue;
    }
    if (!isXmlElement(child)) continue;
    const attrs = child.getAttributes();
    if (child.nodeName === 'mention') out.push(mentionFromProps(attrs));
    else if (child.nodeName === 'citation') out.push(citationFromProps(attrs));
    else if (child.nodeName === 'hardBreak') out.push({ kind: 'break' });
    else out.push(...inlineFromYChildren(child.toArray()));
  }
  return compactInline(out);
}

function tableRowsFromY(table: YXmlElementLike): CanvasTableCell[][] {
  return table
    .toArray()
    .filter(isXmlElement)
    .filter(row => row.nodeName === 'tableRow')
    .map(row =>
      row
        .toArray()
        .filter(isXmlElement)
        .map(cell => ({
          isHeader: cell.nodeName === 'tableHeader',
          content: inlineFromYChildren(
            cell
              .toArray()
              .flatMap(paragraph => (isXmlElement(paragraph) ? paragraph.toArray() : [paragraph])),
          ),
        })),
    );
}

function blocksFromYGroup(group: YXmlElementLike, path: string): CanvasBlock[] {
  const blocks: CanvasBlock[] = [];
  group
    .toArray()
    .filter(isXmlElement)
    .forEach((container, index) => {
      if (container.nodeName !== 'blockContainer') return;
      const parts = container.toArray().filter(isXmlElement);
      const contentNode = parts.find(part => part.nodeName !== 'blockGroup');
      const childGroup = parts.find(part => part.nodeName === 'blockGroup');
      const containerAttrs = container.getAttributes();
      const type = contentNode?.nodeName ?? 'paragraph';
      const isTable = type === 'table';
      blocks.push({
        id: asString(containerAttrs['id']) || `${path}.${index}`,
        type,
        props: { ...containerAttrs, ...(contentNode?.getAttributes() ?? {}) },
        content: contentNode && !isTable ? inlineFromYChildren(contentNode.toArray()) : [],
        ...(isTable && contentNode ? { rows: tableRowsFromY(contentNode) } : {}),
        children: childGroup ? blocksFromYGroup(childGroup, `${path}.${index}`) : [],
      });
    });
  return blocks;
}

/** Read the BlockNote tree out of a Y.Doc's `document-store` XmlFragment. */
export function blocksFromYFragment(fragment: { toArray: () => unknown[] }): CanvasBlock[] {
  const top = fragment.toArray().filter(isXmlElement);
  return top.flatMap((node, index) =>
    node.nodeName === 'blockGroup' ? blocksFromYGroup(node, String(index)) : [],
  );
}

// ── Queries over the tree ───────────────────────────────────────────────────

const inlineText = (content: readonly CanvasInline[]): string =>
  content
    .map(node =>
      node.kind === 'text'
        ? node.text
        : node.kind === 'mention'
          ? `@${node.label}`
          : node.kind === 'break'
            ? '\n'
            : '',
    )
    .join('');

/** True when nothing visible would render (a fresh canvas is one empty paragraph). */
export function isCanvasDocumentEmpty(blocks: readonly CanvasBlock[]): boolean {
  return blocks.every(
    block =>
      inlineText(block.content).trim().length === 0 &&
      !(block.rows && block.rows.length > 0) &&
      !['image', 'video', 'audio', 'file', 'embed', 'divider'].includes(block.type) &&
      isCanvasDocumentEmpty(block.children),
  );
}

export { inlineText as canvasInlineText };
