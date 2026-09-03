import type { EditorView } from '@tiptap/pm/view';
import { CANVAS_EMBED_TYPE } from './CanvasEmbedSpec';

export interface LinkRange {
  url: string;
  from: number;
  to: number;
}

function buildEmbedBlock(
  view: EditorView,
  url: string,
): ReturnType<EditorView['state']['schema']['nodes'][string]['createAndFill']> | null {
  const embed = view.state.schema.nodes[CANVAS_EMBED_TYPE];
  const blockContainer = view.state.schema.nodes['blockContainer'];
  if (!embed || !blockContainer) return null;

  const embedNode = embed.createAndFill({ url });
  if (!embedNode) return null;
  return blockContainer.createAndFill(undefined, embedNode);
}

/** Position just after the block containing `pos`, where a sibling block may go. */
function afterBlockContaining(view: EditorView, pos: number, doc = view.state.doc): number | null {
  const resolved = doc.resolve(pos);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === 'blockContainer') return resolved.after(depth);
  }
  return null;
}

/**
 * Swap a link for an embed of it.
 *
 * The embed goes in a block of its own *after* the paragraph rather than in place
 * of the link text: a paragraph cannot hold a block, so replacing the inline range
 * directly leaves the link sitting next to a stray embed.
 */
export function replaceLinkWithEmbed(view: EditorView, link: LinkRange): boolean {
  const block = buildEmbedBlock(view, link.url);
  if (!block) return false;

  const transaction = view.state.tr.delete(link.from, link.to);
  const insertAt = afterBlockContaining(view, transaction.mapping.map(link.from), transaction.doc);
  if (insertAt === null) return false;

  view.dispatch(transaction.insert(insertAt, block).scrollIntoView());
  return true;
}

/** Put an embed of `url` where the cursor is, as its own block. */
export function insertEmbedBlock(view: EditorView, url: string): boolean {
  const block = buildEmbedBlock(view, url);
  if (!block) return false;

  view.dispatch(view.state.tr.replaceSelectionWith(block).scrollIntoView());
  return true;
}

/**
 * The range of the link carrying `url`, nearest the cursor.
 *
 * Found by scanning rather than read off the selection: the link toolbar opens on
 * hover, so the cursor is usually somewhere else entirely when its buttons are
 * pressed. Adjacent text nodes are merged, since a link split by bold or italic
 * spans several of them.
 */
export function findLinkRange(view: EditorView, url: string): LinkRange | null {
  const linkMark = view.state.schema.marks['link'];
  if (!linkMark || !url) return null;

  const ranges: Array<{ from: number; to: number }> = [];
  view.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const hasLink = node.marks.some(mark => mark.type === linkMark && mark.attrs['href'] === url);
    if (!hasLink) return true;

    const previous = ranges[ranges.length - 1];
    if (previous && previous.to === pos) previous.to = pos + node.nodeSize;
    else ranges.push({ from: pos, to: pos + node.nodeSize });
    return true;
  });

  if (ranges.length === 0) return null;

  const cursor = view.state.selection.from;
  const nearest = ranges.reduce((best, range) => {
    const distance = Math.min(Math.abs(cursor - range.from), Math.abs(cursor - range.to));
    const bestDistance = Math.min(Math.abs(cursor - best.from), Math.abs(cursor - best.to));
    return distance < bestDistance ? range : best;
  });

  return { url, from: nearest.from, to: nearest.to };
}
