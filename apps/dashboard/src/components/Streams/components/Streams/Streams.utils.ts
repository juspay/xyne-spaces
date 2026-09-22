import type { Column, ColumnSource, SurfaceKind } from './Streams.types';

/**
 * Scroll behaviour that respects the OS motion setting.
 *
 * Travelling between columns is the largest movement Streams makes — the whole
 * viewport of live content slides sideways — so it is the one that most needs a
 * way out. Read per call rather than cached: the setting can change while the
 * page is open, and there is no cost to asking.
 *
 * Reduced motion here means arriving instantly, not not arriving: `auto` still
 * lands on the same column, it just skips the journey.
 */
/**
 * Read per call rather than cached: the setting can change while the page is
 * open, and asking costs nothing.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const scrollBehavior = (): ScrollBehavior =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';

/**
 * Stable identity for *what a column is showing*, as opposed to the column's own
 * id. Two columns pointing at the same channel share a source key but not an id.
 *
 * Used to tell the add palette what is already in the stream. The distinction
 * matters: layout is keyed by column id so the same channel could in principle be
 * opened twice, but doing it by accident from a search list is a mistake, not a
 * feature — so the palette surfaces it rather than silently allowing it.
 */
/**
 * Whether a stream may hold more than one of this surface.
 *
 * The stream's rule is one column per thing, because two copies of #product are
 * indistinguishable in the strip, the overview and the jump panel — you cannot
 * tell which you are looking at, or which a notification meant.
 *
 * Ask AI is the exception, and the only one. Two chats with an assistant are
 * not two views of one thing; they are two conversations, the way two browser
 * tabs on the same site are. Keeping one open on a long-running question while
 * you start a throwaway beside it is the normal way to use it, and collapsing
 * them was the stream enforcing a rule that only made sense for the surfaces it
 * was written for.
 */
export const allowsDuplicates = (source: ColumnSource): boolean => source.kind === 'agent';

export const sourceKey = (source: ColumnSource): string => {
  switch (source.kind) {
    case 'channel':
      return `channel:${source.channelId}`;
    case 'board':
      return `board:${source.viewMode}:${source.channelId ?? ''}`;
    case 'agent':
      return `agent:${source.channelId ?? ''}`;
    // Item columns key on the item's own id and nothing else. Deliberately not
    // on the channel it was opened from: the same ticket reached from a board
    // and from a channel is one ticket, and opening it twice would put two
    // identical headers in the strip with no way to tell them apart.
    case 'ticket':
      return `ticket:${source.ticketId}`;
    case 'thread':
      return `thread:${source.conversationId}`;
    case 'document':
      return `document:${source.canvasId}`;
    case 'file':
      return `file:${source.attachmentId}`;
    default:
      return 'unknown';
  }
};

/**
 * The kinds that arrive *attached* to whatever you opened them from.
 *
 * Exactly the item kinds — see the note on `ColumnSource`. A place you navigate
 * to (a channel, a board, a feed) stands on its own by definition; a thing you
 * clicked inside one of those places usually does not, and the pair is how the
 * stream says so without drawing anything.
 */
const ATTACHING_KINDS: ReadonlySet<SurfaceKind> = new Set(['ticket', 'thread', 'document', 'file']);

export const isAttachingSource = (source: ColumnSource): boolean =>
  ATTACHING_KINDS.has(source.kind);

/** The column attached to `parentId`, if the parent is holding one. */
export const attachmentOf = (columns: readonly Column[], parentId: string): Column | undefined =>
  columns.find(column => column.attachedTo === parentId);

/**
 * Which column would own an attachment opened from `columnId`.
 *
 * Itself, unless it is *already* an attachment — in which case its parent does.
 * That is what keeps a chain from forming: click a file inside a thread that is
 * itself attached to #general, and the file replaces the thread in #general's
 * one slot rather than hanging a third pane off the side. The slot means "the
 * thing I am currently looking at out of this channel", and there is only ever
 * one of those.
 *
 * Returns undefined when the id names nothing, which the callers treat as "no
 * attaching, open it as a free column" rather than as an error.
 */
export const hostFor = (columns: readonly Column[], columnId: string): Column | undefined => {
  const column = columns.find(candidate => candidate.id === columnId);
  if (!column) return undefined;
  if (column.attachedTo === undefined) return column;
  return columns.find(candidate => candidate.id === column.attachedTo);
};

/**
 * Whether `host` is a place an item may attach to.
 *
 * Channels and DMs only, for now, and that is the user-facing rule rather than a
 * technical limit: a thread read out of #general is meaningless without
 * #general, while a ticket picked off a board reads perfectly well on its own.
 * Widening this is one entry.
 */
export const acceptsAttachment = (host: Column): boolean => host.source.kind === 'channel';

/**
 * Move a column within the stream, carrying its pane and respecting everyone else's.
 *
 * Two rules, both of which the plain splice this replaces got wrong:
 *
 *  - **A parent travels with its pane.** Moving a channel and leaving its thread
 *    behind parks that thread beside whatever channel happened to be next, which
 *    reads as the thread having changed owner. It has not — `attachedTo` still
 *    points home — so the stream was showing a lie until the next reload, when the
 *    load-time settle silently teleported it back.
 *  - **A pair is never landed inside.** Dropping between someone else's channel
 *    and its pane tears that pair in half. Same defect, other side of it.
 *
 * A pane cannot be `from`: its header is not a drag handle and the keyboard
 * move refuses it, so the only way to move one is to detach it first.
 *
 * `to` indexes the stream with `from` already removed — the convention
 * `useColumnDrag.resolveInsertAt` computes against. Returns null when the move
 * is out of range or names a pane, so callers can leave the stream untouched.
 */
export const moveColumn = (
  columns: readonly Column[],
  from: number,
  to: number,
): { columns: Column[]; focus: number } | null => {
  if (from < 0 || to < 0 || from >= columns.length) return null;
  const moved = columns[from];
  if (!moved || moved.attachedTo !== undefined) return null;

  const pane = attachmentOf(columns, moved.id);
  // `to` indexes the stream with everything in hand already removed — the column
  // *and* its pane. That is what `resolveInsertAt` measures against, and getting
  // it wrong by one is invisible until you drop past the pane, at which point
  // the pair lands a slot off or the "did not move" early-out swallows the drop
  // entirely. Which is exactly how a drag from the pane's header looked dead.
  const rest = columns.filter(column => column.id !== moved.id && column.id !== pane?.id);
  let at = Math.min(to, rest.length);
  // Landing on a pane means landing inside its pair. Step past it.
  while (at > 0 && at < rest.length && rest[at]?.attachedTo === rest[at - 1]?.id) at += 1;

  const next = rest.slice();
  next.splice(at, 0, ...(pane ? [moved, pane] : [moved]));
  return { columns: next, focus: at };
};
