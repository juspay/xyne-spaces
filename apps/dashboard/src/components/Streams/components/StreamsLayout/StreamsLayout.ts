import { allowsDuplicates, sourceKey } from '../Streams/Streams.utils';
import { DEFAULT_WIDTH, LEGACY_VIEWPORT, MAX_WIDTH, MIN_WIDTH } from '../Streams/Streams.types';
import type { Column, ColumnSource, Stream, StreamsLayout } from '../Streams/Streams.types';

export const clampWidth = (value: number): number =>
  Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)));

/**
 * Widths are pixels now. Two older shapes may still be in storage:
 * a viewport fraction (0–1) and, before that, a preset index (0 | 1 | 2).
 * Both are far below the pixel floor, so anything under it is legacy — convert
 * it rather than clamping a stream full of 280px slivers.
 */
const LEGACY_PRESETS = [0.333, 0.5, 0.667];

const readWidth = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return DEFAULT_WIDTH;
  if (value >= MIN_WIDTH) return clampWidth(value);
  // Preset indices first, and this order matters: they are whole numbers, and 0
  // and 1 are also legal-looking fractions. Read the other way round, a stored
  // `1` (the half preset) came back as a full-viewport 1440px column and a `0`
  // fell through to the default, so only index 2 ever migrated correctly.
  if (Number.isInteger(value) && value < LEGACY_PRESETS.length) {
    return clampWidth((LEGACY_PRESETS[value] ?? 0.46) * LEGACY_VIEWPORT);
  }
  if (value <= 1) return clampWidth(value * LEGACY_VIEWPORT);
  return DEFAULT_WIDTH;
};

/**
 * Layout persistence.
 *
 * localStorage rather than the database: putting stream layouts in Xyne's Zero
 * schema means a Prisma migration, mutators, ACLs and the pre-commit tenant-key
 * guard — disproportionate while this is an experiment. It is also what the
 * existing `Resizable` panels already use. If Streams ships, the durable home is
 * a `streams_layout` table, which would buy cross-device sync for free.
 *
 * Every field is read defensively. Cascade's hard lesson (§3): its `readLayout`
 * discarded the *entire* stored object on a parse failure, so one new field
 * without a default wiped every width and order on first read of an old layout.
 * Here, a malformed field falls back to its default and the rest survives.
 */

const STORAGE_KEY = 'xyne.streams.layout.v1';

/**
 * Where a layout that could not be read is parked before anything overwrites it.
 *
 * `loadLayout` used to answer "the stored layout is unreadable" and "there is no
 * stored layout" with the same value — a fresh empty layout — and the screen then
 * saved that over the original. One transient module error during a hot reload was
 * therefore enough to destroy a hand-assembled layout permanently, with nothing
 * logged and nothing kept. It has happened at least once, to a seventeen-column
 * stream.
 *
 * The read is the right place to take the copy: it is the only moment the raw
 * string is in hand *and* known to be untrusted. Restoring is deliberately manual
 * — this is a black box for the rare bad day, not a migration path.
 */
const BACKUP_KEY = `${STORAGE_KEY}.bak`;

/**
 * Keep the unreadable value, once, before anything can write over it.
 *
 * Never overwrites an existing backup: if the layout has already failed to read
 * and been replaced by an empty default, a second failure would otherwise back up
 * the *empty* one and bury the copy that still has the columns in it.
 */
const backupUnreadable = (stored: string): void => {
  try {
    if (localStorage.getItem(BACKUP_KEY) === null) localStorage.setItem(BACKUP_KEY, stored);
  } catch {
    // Quota or private mode. The backup is insurance, never a blocker.
  }
};

const uid = (): string => crypto.randomUUID();

export const makeColumn = (source: ColumnSource, width = DEFAULT_WIDTH): Column => ({
  id: uid(),
  source,
  width: clampWidth(width),
  addedAt: Date.now(),
});

type Raw = Record<string, unknown>;

const asRaw = (value: unknown): Raw | null =>
  typeof value === 'object' && value !== null ? (value as Raw) : null;

const str = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const isSource = (value: unknown): value is ColumnSource => {
  const raw = asRaw(value);
  if (!raw) return false;
  const kind = raw['kind'];
  if (kind === 'channel') return typeof raw['channelId'] === 'string';
  if (kind === 'board') {
    const mode = raw['viewMode'];
    return mode === 'my-tickets' || mode === 'board';
  }
  if (kind === 'agent') return true;
  // Item columns. Each is validated on the id that identifies the item and on
  // nothing else — the optional context fields are conveniences, and a column
  // dropped because a `channelId` went missing would lose a ticket the user can
  // still perfectly well be shown.
  if (kind === 'ticket') return typeof raw['ticketId'] === 'string';
  if (kind === 'thread') {
    return typeof raw['channelId'] === 'string' && typeof raw['conversationId'] === 'string';
  }
  if (kind === 'document') return typeof raw['canvasId'] === 'string';
  if (kind === 'file') {
    return (
      typeof raw['attachmentId'] === 'string' &&
      typeof raw['fileName'] === 'string' &&
      typeof raw['mimeType'] === 'string'
    );
  }
  return false;
};

const readColumn = (value: unknown): Column | null => {
  const raw = asRaw(value);
  if (!raw) return null;
  const source = raw['source'];
  if (!isSource(source)) return null;
  const title = raw['title'];
  const attachedTo = raw['attachedTo'];
  const collapsed = raw['collapsed'];
  return {
    id: str(raw['id'], uid()),
    source,
    width: readWidth(raw['width']),
    ...(typeof title === 'string' && { title }),
    ...(raw['pinned'] === true && { pinned: true }),
    ...(typeof attachedTo === 'string' && attachedTo !== '' && { attachedTo }),
    ...(collapsed === true && { collapsed: true }),
    addedAt: num(raw['addedAt'], Date.now()),
  };
};

const readStream = (value: unknown): Stream | null => {
  const raw = asRaw(value);
  if (!raw) return null;
  const rawColumns = raw['columns'];
  const columns = Array.isArray(rawColumns)
    ? rawColumns.map(readColumn).filter((column): column is Column => column !== null)
    : [];
  const name = str(raw['name'], '').trim();
  const archivedAt = raw['archivedAt'];
  return {
    id: str(raw['id'], uid()),
    name: name || 'Stream',
    columns,
    focus: Math.max(0, Math.min(num(raw['focus'], 0), columns.length)),
    createdAt: num(raw['createdAt'], Date.now()),
    // Spread-if-present rather than `archivedAt: undefined`, which
    // `exactOptionalPropertyTypes` rejects and which would also write a null
    // into storage on every save of a live stream. Same shape `readColumn` uses
    // for `title` and `pinned`.
    ...(typeof archivedAt === 'number' && Number.isFinite(archivedAt) && { archivedAt }),
  };
};

export const emptyStream = (name = 'My stream'): Stream => ({
  id: uid(),
  name,
  columns: [],
  focus: 0,
  createdAt: Date.now(),
});

export const defaultLayout = (): StreamsLayout => {
  const stream = emptyStream();
  return { version: 1, streams: [stream], activeStreamId: stream.id };
};

export const isLive = (stream: Stream): boolean => stream.archivedAt === undefined;

export const liveStreams = (layout: StreamsLayout): Stream[] => layout.streams.filter(isLive);

/** Most recently archived first — the one you are likeliest to want back. */
export const archivedStreams = (layout: StreamsLayout): Stream[] =>
  layout.streams
    .filter(stream => !isLive(stream))
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));

/**
 * The open stream.
 *
 * Total by construction: `settle` guarantees `activeStreamId` names a live stream,
 * so the fallbacks below are unreachable in practice. They exist because the
 * screen renders `activeStream(layout).columns` unconditionally, and a view has
 * no useful way to handle "there is no stream" — better an empty stream than a
 * crash if some future edit breaks the invariant.
 */
export const activeStream = (layout: StreamsLayout): Stream =>
  layout.streams.find(stream => stream.id === layout.activeStreamId) ??
  layout.streams.find(isLive) ??
  layout.streams[0] ??
  emptyStream();

/**
 * The live stream nearest `at`, searching right first and then left.
 *
 * Right first because that is the stream which visually takes the departing one's
 * place: archive the stream you are in and the list closes up leftward, so the
 * entry now sitting where you were looking is the one that was to its right.
 */
const nearestLive = (streams: readonly Stream[], at: number): Stream | undefined => {
  for (let i = Math.max(0, at); i < streams.length; i += 1) {
    const stream = streams[i];
    if (stream && isLive(stream)) return stream;
  }
  for (let i = Math.min(at, streams.length) - 1; i >= 0; i -= 1) {
    const stream = streams[i];
    if (stream && isLive(stream)) return stream;
  }
  return undefined;
};

/**
 * Re-establish the two things every layout must satisfy: there is at least one
 * live stream, and `activeStreamId` names one.
 *
 * One function rather than the same three lines inside archive, delete and
 * load, because the interesting case is the one that is easy to forget — you
 * archived or deleted the last live stream, and there is now nothing to show.
 * Handled in a single place it is three lines; open-coded four times it is
 * three chances to ship a blank screen.
 *
 * `at` is where the departing stream sat, so a replacement is chosen by
 * proximity rather than by being first in the array.
 */
const settle = (streams: Stream[], activeStreamId: string, at = 0): StreamsLayout => {
  const current = streams.find(stream => stream.id === activeStreamId);
  if (current && isLive(current)) return { version: 1, streams, activeStreamId };
  const next = nearestLive(streams, at);
  if (next) return { version: 1, streams, activeStreamId: next.id };
  // Nothing live left. A fresh empty stream rather than an empty list: Streams
  // with no stream at all has no state a person can act on — no strip, no add
  // button that belongs to anything — so the screen would be a dead end.
  const fresh = emptyStream();
  return { version: 1, streams: [...streams, fresh], activeStreamId: fresh.id };
};

/**
 * A thread column that is really a ticket becomes one.
 *
 * The first build read `/chat/dir/{channel}/{conversation}/{ticket}` as a thread
 * carrying a ticket id, which rendered a column headed with the channel name
 * and filled with a ticket — its own tab bar, its own title, its own close
 * button inside the stream's. Those columns are already saved in people's streams,
 * and closing them by hand is work nobody should have to do to get the fix.
 *
 * Converted rather than dropped: the column is pointing at something real and
 * the user put it there. Only its kind was wrong.
 */
const retypeTicketThreads = (stream: Stream): Stream => {
  let changed = false;
  const columns = stream.columns.map(column => {
    const source = column.source;
    if (source.kind !== 'thread' || !source.ticketId) return column;
    changed = true;
    return {
      ...column,
      source: {
        kind: 'ticket' as const,
        ticketId: source.ticketId,
        channelId: source.channelId,
        conversationId: source.conversationId,
      },
    };
  });
  return changed ? { ...stream, columns } : stream;
};

/**
 * Drop columns whose source is already in the stream, keeping the first.
 *
 * The stream holds at most one column per source, and that is now enforced where
 * columns are added — but streams saved before it was could already contain two
 * `#onboarding` columns, and they would stay duplicated forever. Cleaning on
 * load is the migration.
 *
 * Focus is pulled back to a column that still exists, since removing anything
 * ahead of it shifts every index after.
 */
/**
 * Make every `attachedTo` mean what the renderer assumes it means.
 *
 * Attachment is a stored back-pointer, and stored pointers rot: the parent gets
 * closed, a drag moves the pair apart, an older build wrote a shape this one
 * does not expect. Rather than defend against each of those at every read site —
 * the strip, the overview, focus mode, the jump pills all walk this list — the
 * invariants are re-established once, here, and everything downstream may simply
 * trust them.
 *
 * Detaching is always the repair, never dropping the column. A column whose
 * parent went away is still a thread you were reading; it just stands on its own
 * now, which is exactly what detach means and what the user can already do by
 * hand.
 */
const settleAttachments = (stream: Stream): Stream => {
  const byId = new Map(stream.columns.map(column => [column.id, column]));
  const claimed = new Set<string>();
  let changed = false;

  // Annotated, because the rest-spread repairs below each narrow to a type
  // missing whichever field they dropped, and the union of those is not `Column`.
  const settled: Column[] = stream.columns.map((column): Column => {
    const parentId = column.attachedTo;
    if (parentId === undefined) return column;

    const parent = byId.get(parentId);
    const valid =
      // Points at a real column, and not at itself.
      parent !== undefined &&
      parentId !== column.id &&
      // One level only. A thread attached to a channel may not itself host a
      // ticket — a chain has no visual form in a strip of side-by-side panes,
      // and the second link would render as a third box in a "single panel".
      parent.attachedTo === undefined &&
      // First claim wins. Two columns naming one parent is the state the swap
      // path exists to prevent, so if it is on disk it came from somewhere else.
      !claimed.has(parentId);

    if (!valid) {
      changed = true;
      const { attachedTo: _dropped, ...standalone } = column;
      return standalone;
    }

    claimed.add(parentId);

    // Pinning belongs to the pair, so an attachment's pin must *match* its
    // parent's rather than simply being absent. This is a rendering invariant,
    // not a tidiness one: the strip draws pinned columns in a different
    // container from scrolling ones, so a pair that disagrees here is a pair
    // rendered in two places — the parent held at the left edge and its
    // attachment somewhere off in the scroller, sharing a border with whatever
    // happens to be next to it.
    if ((column.pinned === true) !== (parent.pinned === true)) {
      changed = true;
      if (parent.pinned === true) return { ...column, pinned: true };
      const { pinned: _unpinned, ...unpinnedColumn } = column;
      return unpinnedColumn;
    }
    return column;
  });

  // Collapse only ever describes the parent half of a live pair. A column that
  // is collapsed but holds nothing would be a column that simply never draws —
  // unreachable, unclosable, and invisible in the strip. Any such flag is stale
  // (the pane was detached or closed while its parent was squeezed out) and the
  // repair is to show the column again.
  const holders = new Set(
    settled.filter(column => column.attachedTo !== undefined).map(column => column.attachedTo),
  );
  const shown: Column[] = settled.map((column): Column => {
    if (column.collapsed !== true || holders.has(column.id)) return column;
    changed = true;
    const { collapsed: _restored, ...visible } = column;
    return visible;
  });

  // Adjacency, re-established by moving rather than by detaching: the pair being
  // out of order is a layout accident, while the relationship is something the
  // user expressed. Lift every attachment out and reinsert it behind its parent.
  const attachments = new Map<string, Column>();
  for (const column of shown) {
    if (column.attachedTo !== undefined) attachments.set(column.attachedTo, column);
  }
  const ordered: Column[] = [];
  for (const column of shown) {
    if (column.attachedTo !== undefined) continue;
    ordered.push(column);
    const attachment = attachments.get(column.id);
    if (attachment) ordered.push(attachment);
  }
  if (!changed && ordered.every((column, index) => column === shown[index])) return stream;

  const focusedId = stream.columns[stream.focus]?.id;
  const focus = ordered.findIndex(column => column.id === focusedId);
  return { ...stream, columns: ordered, focus: focus >= 0 ? focus : 0 };
};

const dedupe = (stream: Stream): Stream => {
  const seen = new Set<string>();
  const columns = stream.columns.filter(column => {
    // Surfaces that are allowed to repeat skip the ledger entirely — several Ask
    // AI columns share one source key by construction, and a migration that
    // swept them up on load would quietly delete every chat but the first.
    if (allowsDuplicates(column.source)) return true;
    const key = sourceKey(column.source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (columns.length === stream.columns.length) return stream;
  const focusedId = stream.columns[stream.focus]?.id;
  const focus = columns.findIndex(column => column.id === focusedId);
  return { ...stream, columns, focus: focus >= 0 ? focus : 0 };
};

/**
 * The stored list, whatever the field happened to be called when it was written.
 *
 * This field has been renamed before and may be again, and carrying a list of
 * every former name is a list that only grows — and is made of exactly the
 * vocabulary a rename set out to remove. So it is found by *shape* instead: the
 * one array whose entries carry a `columns` array. There is only ever one such
 * field, a shape outlives every rename, and a reader that never spells the old
 * name cannot be broken by forgetting to update it.
 */
const readList = (raw: Raw): readonly unknown[] => {
  const named = raw['streams'];
  if (Array.isArray(named)) return named;
  for (const value of Object.values(raw)) {
    if (!Array.isArray(value)) continue;
    if (value.some(entry => Array.isArray(asRaw(entry)?.['columns']))) return value;
  }
  return [];
};

/**
 * Which stream was open.
 *
 * Same problem as `readList` and the same answer. The id is looked up by name
 * first, then by shape — any string in the stored object that names one of the
 * streams just parsed *is* the pointer, whatever the field is called. Two
 * unrelated fields cannot both hold a live stream id, so there is nothing to
 * disambiguate.
 *
 * An id naming a stream that is no longer in storage is not an error worth
 * discarding a layout over — it is what you get if the stream was deleted in
 * another tab. Fall through to the first one.
 */
const readActiveId = (raw: Raw, streams: readonly Stream[]): string => {
  const named = raw['activeStreamId'];
  if (typeof named === 'string' && streams.some(stream => stream.id === named)) return named;
  for (const value of Object.values(raw)) {
    if (typeof value === 'string' && streams.some(stream => stream.id === value)) return value;
  }
  return streams[0]?.id ?? '';
};

/** How many columns the stored value *claimed*, before any of them were validated. */
const columnsIn = (rawStreams: readonly unknown[]): number =>
  rawStreams.reduce<number>((total, stream) => {
    const columns = asRaw(stream)?.['columns'];
    return total + (Array.isArray(columns) ? columns.length : 0);
  }, 0);

export const loadLayout = (): StreamsLayout => {
  // Declared outside the `try` so the `catch` can still reach the raw string it
  // failed to make sense of — that string is the only copy of the user's layout.
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultLayout();
    const raw = asRaw(JSON.parse(stored));
    if (!raw) {
      backupUnreadable(stored);
      return defaultLayout();
    }
    const rawStreams = readList(raw);
    // Parsed but not yet reconciled. Held separately so the count below measures
    // what *validation* rejected and nothing else: `dedupe` and
    // `settleAttachments` also remove columns, on purpose and for reasons that
    // are not losses, and folding them in would make the warning cry wolf on
    // every ordinary load that happened to contain a duplicate.
    const parsed = Array.isArray(rawStreams)
      ? rawStreams.map(readStream).filter((stream): stream is Stream => stream !== null)
      : [];
    const streams = parsed
      // Retype before deduping: a mistyped column and its correctly typed
      // twin have different source keys until the first one is fixed, so
      // deduping first would leave both in the stream.
      .map(retypeTicketThreads)
      .map(dedupe)
      // After dedupe: it removes columns, and a removed column may be a parent.
      .map(settleAttachments);
    // Nothing survived validation. Distinct from "nothing was stored": something
    // was, and this build cannot read it, so keep it rather than replace it.
    if (streams.length === 0) {
      if (rawStreams.length > 0) backupUnreadable(stored);
      return defaultLayout();
    }
    // What validation threw away, if anything.
    //
    // Dropping an unreadable column and keeping the rest is the deliberate
    // policy of this file — one bad field must never cost you the layout. But
    // the same code path is what a *migration* looks like from the inside: retire
    // a `kind` and every stored column of that kind silently stops existing, on
    // everyone's next load, with the layout still opening normally. Silence is
    // right for the corrupt-column case and wrong for the migration case, and
    // nothing here can tell them apart — so say it out loud either way and let
    // whoever is reading the console decide.
    const claimed = columnsIn(rawStreams);
    const kept = parsed.reduce((total, stream) => total + stream.columns.length, 0);
    if (claimed > kept) {
      // eslint-disable-next-line no-console -- data loss is silent otherwise; this is the only signal
      console.warn(
        `[streams] dropped ${claimed - kept} of ${claimed} stored columns — unreadable, or of a kind this build no longer has`,
      );
    }
    // Every column gone, streams intact: the quiet half of the same failure, and
    // the one the header's "Cascade's hard lesson" is about. The layout still
    // *loads*, just empty, which reads as the user having closed everything.
    // Partial loss is logged above but deliberately NOT backed up: the backup
    // slot is written once and never overwritten, so letting a routine one-column
    // drop claim it would leave nothing for the catastrophe to fall back on.
    if (claimed > 0 && kept === 0) backupUnreadable(stored);
    // Through `settle` rather than returned directly, so a stored layout whose
    // active stream was archived — or which somehow has no live stream at all —
    // opens on something rather than on nothing.
    return settle(streams, readActiveId(raw, streams));
  } catch (error) {
    // Deliberately loud, and deliberately not silent about which key holds the
    // copy. The failure this guards against is a *transient* one — a module
    // half-applied by a hot reload, say — so by the time anyone investigates,
    // the code that threw may read perfectly well.
    // eslint-disable-next-line no-console -- the stored layout was unreadable; say so loudly
    console.error(
      `[streams] could not read the stored layout — keeping the original at "${BACKUP_KEY}"`,
      error,
    );
    if (stored) backupUnreadable(stored);
    return defaultLayout();
  }
};

export const saveLayout = (layout: StreamsLayout): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Quota or private mode — the layout is a convenience, never a blocker.
  }
};

/* ------------------------------------------------------------------ streams */

/**
 * The name a new stream gets: the first free "Stream N".
 *
 * First free rather than `streams.length + 1`, which is wrong the moment anything
 * is deleted — remove Stream 2 of three and the next new stream is called Stream 3,
 * which already exists. The name goes straight into an editable field anyway,
 * so this only has to be unsurprising.
 */
const nextStreamName = (streams: readonly Stream[]): string => {
  const taken = new Set(streams.map(stream => stream.name));
  let n = streams.length + 1;
  while (taken.has(`Stream ${n}`)) n += 1;
  return `Stream ${n}`;
};

/** "Incidents copy", then "Incidents copy 2" — the app's own convention. */
const copyName = (streams: readonly Stream[], name: string): string => {
  const taken = new Set(streams.map(stream => stream.name));
  const base = `${name} copy`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
};

/** Open a stream. Ignored if it does not exist or is archived — restore it first. */
export const switchStream = (layout: StreamsLayout, id: string): StreamsLayout => {
  const stream = layout.streams.find(candidate => candidate.id === id);
  if (!stream || !isLive(stream) || id === layout.activeStreamId) return layout;
  return { ...layout, activeStreamId: id };
};

/** Append an empty stream and open it. */
export const createStream = (layout: StreamsLayout, name?: string): StreamsLayout => {
  const stream = emptyStream(name?.trim() || nextStreamName(layout.streams));
  return { version: 1, streams: [...layout.streams, stream], activeStreamId: stream.id };
};

/**
 * Copy a stream, place the copy beside its original, and open it.
 *
 * Beside rather than appended: a copy belongs next to what it was copied from,
 * which is also the only place anyone looks for it. Opened because duplicating
 * is how you make a variant — you are about to edit the copy, not admire it.
 */
export const duplicateStream = (layout: StreamsLayout, id: string): StreamsLayout => {
  const at = layout.streams.findIndex(stream => stream.id === id);
  const source = layout.streams[at];
  if (!source) return layout;
  const copy: Stream = {
    id: uid(),
    name: copyName(layout.streams, source.name),
    // Fresh column ids, and this is the whole reason duplication needs a helper
    // rather than a spread. A column id is layout-local — it keys the seed a
    // drag left in a composer, the set of columns mid-collapse, the focus ring
    // — so two streams sharing one id would have the copy inherit whatever was
    // happening to the original, and closing a column in one would take the
    // other with it.
    //
    // `addedAt` is deliberately *not* reset: it records when you started
    // watching this thing, and duplicating the stream you were watching it in
    // does not change that answer.
    columns: source.columns.map(column => ({ ...column, id: uid() })),
    focus: source.focus,
    createdAt: Date.now(),
  };
  const streams = layout.streams.slice();
  streams.splice(at + 1, 0, copy);
  return { version: 1, streams, activeStreamId: copy.id };
};

/** Rename a stream. An empty name keeps the old one — same rule as `readStream`. */
export const renameStream = (layout: StreamsLayout, id: string, name: string): StreamsLayout => {
  const trimmed = name.trim();
  return {
    ...layout,
    streams: layout.streams.map(stream =>
      stream.id === id ? { ...stream, name: trimmed || stream.name } : stream,
    ),
  };
};

/** Put a stream down without losing it. Reversible, so it never asks first. */
export const archiveStream = (layout: StreamsLayout, id: string): StreamsLayout => {
  const at = layout.streams.findIndex(stream => stream.id === id);
  if (at < 0) return layout;
  const streams = layout.streams.map(stream =>
    stream.id === id ? { ...stream, archivedAt: Date.now() } : stream,
  );
  return settle(streams, layout.activeStreamId, at);
};

/**
 * Bring an archived stream back, and open it.
 *
 * Opened because restoring is not list management — you go looking through the
 * archive for a specific arrangement precisely when you want to be in it, and
 * putting it back in the list without showing it leaves the gesture half done.
 */
export const restoreStream = (layout: StreamsLayout, id: string): StreamsLayout => {
  const target = layout.streams.find(stream => stream.id === id);
  if (!target || isLive(target)) return layout;
  const streams = layout.streams.map(stream => {
    if (stream.id !== id) return stream;
    // `delete` rather than setting `undefined`: `exactOptionalPropertyTypes`
    // rejects the assignment, and the key would otherwise survive in storage.
    const live = { ...stream };
    delete live.archivedAt;
    return live;
  });
  return { version: 1, streams, activeStreamId: id };
};

/**
 * Put a stream back where it was — the undo behind a delete.
 *
 * Takes the whole `Stream` rather than resurrecting one from an id, because after
 * `deleteStream` there is nothing left to resurrect *from*: the caller holds the
 * only copy. Restoring at its original index rather than appending matters for
 * the same reason column order does — the list is a place you learn, and an
 * undo that puts the stream back somewhere else has not undone anything.
 *
 * Opens it, since undoing a delete means wanting it back.
 */
export const insertStream = (layout: StreamsLayout, stream: Stream, at: number): StreamsLayout => {
  // Already there — the undo was taken twice, or the delete never landed.
  if (layout.streams.some(candidate => candidate.id === stream.id)) return layout;
  const streams = layout.streams.slice();
  streams.splice(Math.max(0, Math.min(at, streams.length)), 0, stream);
  return settle(streams, isLive(stream) ? stream.id : layout.activeStreamId, at);
};

/** Discard a stream for good. The caller confirms; this does not. */
export const deleteStream = (layout: StreamsLayout, id: string): StreamsLayout => {
  const at = layout.streams.findIndex(stream => stream.id === id);
  if (at < 0) return layout;
  return settle(
    layout.streams.filter(stream => stream.id !== id),
    layout.activeStreamId,
    at,
  );
};

/**
 * Focus mode, kept in its own slot rather than inside the layout.
 *
 * It is a way of *looking* at a stream, not part of the stream — every stream would
 * otherwise carry a copy, and switching streams would change how you are viewing
 * as a side effect of changing what you are viewing. Its own key also means a
 * malformed layout can never take the view mode down with it.
 */
const FOCUS_MODE_KEY = 'xyne.streams.focus-mode.v1';

export const loadFocusMode = (): boolean => {
  try {
    return localStorage.getItem(FOCUS_MODE_KEY) === '1';
  } catch {
    return false;
  }
};

export const saveFocusMode = (enabled: boolean): void => {
  try {
    localStorage.setItem(FOCUS_MODE_KEY, enabled ? '1' : '0');
  } catch {
    // Same as the layout: a convenience, never a blocker.
  }
};
