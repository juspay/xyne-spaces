/**
 * Dragging things *between* columns.
 *
 * The stream's other drag — `useColumnDrag` — moves a column to a new slot, and is
 * pointer-based because it has to animate a card following the cursor at sixty
 * frames a second. This one is different in kind: it carries a *payload* from
 * one surface to another, across components that know nothing about each other.
 *
 * So it uses the browser's own drag and drop rather than a second pointer state
 * machine. Native DnD already owns the hard parts — the drag image, the cursor,
 * the enter/leave bookkeeping across arbitrary elements, cancelling on Escape —
 * and a payload drag has no per-frame work that would justify replacing them.
 *
 * The contract is deliberately small. A source stamps a typed item; a surface
 * says which items it accepts; the stream decides what a drop *means*. Surfaces
 * never learn about each other, which is the only way this stays addable — the
 * columns are a channel panel, a kanban board and an agent chat, three
 * components with nothing in common but the chrome around them.
 */

/**
 * Custom MIME rather than `text/plain`, so a drag from anywhere else on the page
 * — a text selection, a file, a link — is not mistaken for one of ours.
 */
export const STREAM_ITEM_MIME = 'application/x-xyne-stream-item';

/**
 * One conversation, on its way somewhere.
 *
 * A union with a single member today. It is written as a union anyway because
 * the second member is the obvious next step (a ticket dragged onto a board, a
 * message dragged onto Ask AI) and `kind` is what lets a surface accept one and
 * refuse the other without either of them changing shape.
 */
export type StreamItem = {
  kind: 'conversation';
  channelId: string;
  conversationId: string;
  channelName: string;
  /** Enough of the message to name the thing in a label or a prepared question. */
  excerpt: string;
};

export const setDragItem = (dataTransfer: DataTransfer, item: StreamItem): void => {
  dataTransfer.setData(STREAM_ITEM_MIME, JSON.stringify(item));
  // A plain-text twin, so dragging a thread into any ordinary text field outside
  // the stream produces something readable rather than nothing at all.
  dataTransfer.setData('text/plain', item.excerpt);
  dataTransfer.effectAllowed = 'copy';
};

/**
 * Whether the drag currently in flight is one of ours.
 *
 * `types` rather than `getData`, and that is not a style choice: during
 * `dragover` the browser refuses to hand over the actual data — it is readable
 * only in `drop`. A drop target that tried to inspect the payload to decide
 * whether to accept it would therefore always see an empty string and always
 * refuse. The type list is the only thing legible mid-drag.
 */
export const hasDragItem = (dataTransfer: DataTransfer | null): boolean =>
  dataTransfer !== null && Array.from(dataTransfer.types).includes(STREAM_ITEM_MIME);

export const readDragItem = (dataTransfer: DataTransfer | null): StreamItem | null => {
  if (!dataTransfer) return null;
  const raw = dataTransfer.getData(STREAM_ITEM_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const item = parsed as Partial<StreamItem>;
    if (item.kind !== 'conversation') return null;
    if (typeof item.channelId !== 'string' || typeof item.conversationId !== 'string') return null;
    return {
      kind: 'conversation',
      channelId: item.channelId,
      conversationId: item.conversationId,
      channelName: typeof item.channelName === 'string' ? item.channelName : 'channel',
      excerpt: typeof item.excerpt === 'string' ? item.excerpt : '',
    };
  } catch {
    // Someone else's drag that happens to claim our MIME type. Refuse it rather
    // than throwing inside a drop handler.
    return null;
  }
};

/**
 * The question a dropped thread becomes.
 *
 * Prepared, not sent. Dropping something is a cheap gesture and firing a model
 * call off the back of one is not — so the drop hands you a question with the
 * cursor in it, and you decide whether to ask it.
 */
export const questionFor = (item: StreamItem): string =>
  item.excerpt
    ? `About this thread in #${item.channelName} — “${item.excerpt}”: `
    : `About this thread in #${item.channelName}: `;
