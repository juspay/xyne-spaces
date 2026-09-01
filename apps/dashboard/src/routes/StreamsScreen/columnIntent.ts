import type { ColumnSource } from './Streams.types';

/**
 * Reading a column's navigation as "open this beside me".
 *
 * Every column with `needsRouterScope` has a private address bar (see
 * `StreamRouterScope`), and the surfaces inside it navigate exactly as they do
 * in the app — a board pushes a ticket URL, a channel pushes a thread URL, the
 * canvas tab pushes a document URL. In the app those navigations replace what
 * you were looking at. In a stream they should not: the whole promise is that
 * following something does not cost you the thing you followed it from.
 *
 * So rather than patching a dozen components to take an `onOpen` prop, the stream
 * reads the URL they were already going to push and decides for itself. Nothing
 * outside this folder changes, and a surface that learns a new destination
 * tomorrow gets it for free.
 *
 * The one thing this must get right is *restraint*. A channel column changes
 * its own URL constantly — tab switches, `#origin=` jumps, deep-links into its
 * own list — and turning any of those into a column would make the stream sprout
 * panels while you are simply reading. So the rule is narrow: a navigation is an
 * intent only when it names an item the column is not already showing.
 */

/**
 * Path roots the app owns. Used to spot a leading workspace id — a column's seed
 * path carries one (`/{workspaceId}/chat/dir/x`) and the navigations pushed from
 * inside it usually do not (`/chat/dir/x`), so both shapes have to normalise to
 * the same segments before anything is matched.
 */
const ROOTS = new Set(['chat', 'projects', 'support', 'ai', 'streams', 'search-results']);

/**
 * Segments that follow `chat/dir` and are *not* a channel id.
 *
 * Without this list `chat/dir/threads` reads as a channel called "threads", and
 * `chat/dir/canvas/abc` reads as a thread `abc` inside a channel called
 * "canvas". Both would open a column for something that does not exist.
 */
const NOT_A_CHANNEL = new Set(['canvas', 'threads', 'unreads', 'recap', 'my-tickets']);

/**
 * Segments that follow a channel id and are *not* a conversation id — each names
 * a different kind of thing hanging off the channel.
 */
const NOT_A_CONVERSATION = new Set(['canvas', 'tickets', 'profile', 'group']);

const segmentsOf = (pathname: string): string[] => {
  const parts = pathname.split('/').filter(Boolean);
  // Drop a leading workspace id. Recognised by exclusion rather than by shape:
  // the id format has changed before, and the list of roots has not.
  return parts.length > 0 && !ROOTS.has(parts[0] as string) ? parts.slice(1) : parts;
};

/** Present and non-empty. `URLSearchParams` returns `''` for `?ticketId=`. */
const param = (search: URLSearchParams, name: string): string | undefined => {
  const value = search.get(name);
  return value !== null && value !== '' ? value : undefined;
};

/**
 * What a column is *already* showing, so its own navigations are left alone.
 *
 * A thread column that pushed its own URL again would otherwise be read as an
 * intent to open a second copy of itself. `openBeside` would find the existing
 * column and merely travel to it, so the result is harmless — but the stream
 * jumping to a column you are already in, because that column re-rendered, is
 * exactly the kind of unexplained movement the strip must not make.
 */
const isSelf = (source: ColumnSource, intent: ColumnSource): boolean => {
  if (source.kind !== intent.kind) return false;
  if (source.kind === 'ticket' && intent.kind === 'ticket') {
    return source.ticketId === intent.ticketId;
  }
  if (source.kind === 'thread' && intent.kind === 'thread') {
    return source.conversationId === intent.conversationId;
  }
  if (source.kind === 'document' && intent.kind === 'document') {
    return source.canvasId === intent.canvasId;
  }
  return false;
};

/**
 * Read a navigation as a column to open, or `null` to let it happen in place.
 *
 * `null` is the important half of the return type, and the default: anything not
 * recognised stays local, which is the behaviour every column had before this
 * existed. A wrong `null` costs a feature; a wrong intent moves the stream under
 * someone's hands.
 */
export const columnIntentFor = (path: string, source: ColumnSource): ColumnSource | null => {
  let url: URL;
  try {
    // Base is never used — every path here is absolute — but `URL` requires one.
    url = new URL(path, 'https://streams.local');
  } catch {
    return null;
  }

  const segments = segmentsOf(url.pathname);
  const search = url.searchParams;

  const intent = readIntent(segments, search);
  if (!intent) return null;
  return isSelf(source, intent) ? null : intent;
};

const readIntent = (segments: string[], search: URLSearchParams): ColumnSource | null => {
  const [root, second, third, fourth] = segments;

  // A ticket picked on a board arrives as query state on the channel's own path
  // — `/chat/dir/{channelId}?tab=tickets&ticketId=…&conversationId=…` — because
  // in the app the ticket opens *inside* the channel's tickets tab. The pathname
  // is therefore identical to the column's, and `ticketId` is the only thing
  // that distinguishes "show me this ticket" from "switch to the tickets tab".
  const ticketParam = param(search, 'ticketId');
  if (ticketParam) {
    const channelId = root === 'chat' && second === 'dir' ? third : undefined;
    const conversationId = param(search, 'conversationId');
    return {
      kind: 'ticket',
      ticketId: ticketParam,
      ...(channelId && !NOT_A_CHANNEL.has(channelId) && { channelId }),
      ...(conversationId && { conversationId }),
    };
  }

  // `/projects/{projectId}/{boardId}/{ticketId}` — the standalone ticket page.
  if (root === 'projects' && second && third && fourth) {
    return { kind: 'ticket', ticketId: fourth };
  }

  if (root === 'chat') {
    // `/chat/canvas/{canvasId}` — the documents page.
    if (second === 'canvas' && third && third !== 'new') {
      return { kind: 'document', canvasId: third };
    }

    if (second === 'dir' && third) {
      // `/chat/dir/canvas/{canvasId}` — documents reached from the directory.
      if (third === 'canvas' && fourth && fourth !== 'new') {
        return { kind: 'document', canvasId: fourth };
      }
      if (NOT_A_CHANNEL.has(third)) return null;

      // Everything below hangs off a channel id.
      if (!fourth) return null;

      // `/chat/dir/{channelId}/canvas/{canvasId}` — the channel's canvas tab.
      if (fourth === 'canvas') {
        const canvasId = segments[4];
        return canvasId && canvasId !== 'new'
          ? { kind: 'document', canvasId, channelId: third }
          : null;
      }

      // `/chat/dir/{channelId}/tickets/{ticketId}`
      if (fourth === 'tickets') {
        const ticketId = segments[4];
        return ticketId ? { kind: 'ticket', ticketId, channelId: third } : null;
      }

      if (NOT_A_CONVERSATION.has(fourth)) return null;

      // `/chat/dir/{channelId}/{conversationId}/{ticketId}` — a ticket, not a
      // thread. The app pushes this shape when the conversation you clicked
      // *is* a ticket, and rendering it as a thread produced the thing that
      // looked most broken: a column headed "Thread" that was showing a ticket,
      // with its own tab bar and its own close button inside the stream's.
      //
      // `profile` also lands in that slot and is a side panel, so the same
      // exclusion list that guards the conversation segment guards this one.
      const fifth = segments[4];
      if (fifth && !NOT_A_CONVERSATION.has(fifth)) {
        return {
          kind: 'ticket',
          ticketId: fifth,
          channelId: third,
          conversationId: fourth,
        };
      }

      // `/chat/dir/{channelId}/{conversationId}` — a plain thread.
      return { kind: 'thread', channelId: third, conversationId: fourth };
    }
  }

  return null;
};
