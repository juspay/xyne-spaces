import { ChipType } from '../ChannelCommandMenu.types';
import type { TabType, ChipData, SearchScopeToggles } from '../ChannelCommandMenu.types';
import type { ChipPrefix } from '../../../../search/filterModel';

// ─── Public contract ────────────────────────────────────────────────────────

/**
 * A chip as persisted: identity only (id, type, prefix), never a display name. BOARD is the lone
 * exception — its id is an opaque backend key with no live lookup, so its label is kept in `name`.
 */
export interface StoredChip {
  id: string;
  type: ChipType;
  prefix?: ChipPrefix;
  name?: string;
}

/**
 * One Cmd+K search as saved to localStorage: free text + filter chips + tab + scope, never any
 * result content. Its chips are {@link StoredChip} — stored by id, without display names.
 */
export interface StoredRecentSearch {
  text: string;
  filterChips: StoredChip[];
  tab: TabType;
  toggles: SearchScopeToggles; // Stored so replay reproduces the same results; not part of the identity key (latest scope wins).
  ts: number;
}

/**
 * A {@link StoredRecentSearch} read back for rendering: the same fields, but its chips are
 * {@link ChipData} — each with its display name resolved live.
 */
export interface RecentSearchEntry {
  text: string;
  filterChips: ChipData[];
  tab: TabType;
  toggles: SearchScopeToggles;
  ts: number;
}

/** Minimal chip shape both the palette (ChipData) and the results page (ResultsMention) satisfy. */
export interface LiveChip {
  id: string;
  type: ChipType;
  prefix?: ChipPrefix;
  name?: string;
}

/** The shape of a query handed to {@link saveCurrentSearchQuery}: free text, chips, tab, and scope. */
export interface LiveSearchQuery {
  text: string;
  filterChips: LiveChip[];
  tab: TabType;
  onlyMyChannels: boolean;
  includeBotMessages: boolean;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Read the MRU list for this user+workspace, dropping entries older than {@link EXPIRY_MS}. */
export function loadRecentSearches(workspaceId: string, userId: string): StoredRecentSearch[] {
  if (!workspaceId || !userId) return [];
  try {
    const stored = localStorage.getItem(buildStorageKey(workspaceId, userId));
    if (!stored) return [];

    const envelope = JSON.parse(stored) as RecentSearchEnvelope;
    if (envelope?.version !== STORAGE_VERSION || !Array.isArray(envelope.entries)) return [];

    return pruneExpired(envelope.entries);
  } catch {
    return [];
  }
}

/** Insert or bump a query to the top, refresh its timestamp, then prune + cap. */
export function saveRecentSearch(
  workspaceId: string,
  userId: string,
  entry: StoredRecentSearch,
): void {
  if (!workspaceId || !userId) return;
  try {
    const incomingKey = identityKeyFor(entry);
    const withoutDuplicate = loadRecentSearches(workspaceId, userId).filter(
      existing => identityKeyFor(existing) !== incomingKey,
    );

    const nextEntries = pruneExpired([entry, ...withoutDuplicate]).slice(0, MAX_STORED);
    writeEntries(workspaceId, userId, nextEntries);
  } catch {
    // ignore — recents are best-effort and must never block a search
  }
}

/**
 * Persist the given query as a recent. Trims the text, drops empty inputs, and reduces each chip to
 * identity — the single place that mapping lives, so every caller stays in sync.
 *
 * @remarks
 * Called on these product triggers — each a "user acted on this search" signal:
 * - Cmd+K palette: opening a message, ticket, or file result, pressing "Show results for…",
 *   or a section's "See more".
 * - Full-screen results page: opening a message/ticket/file result (side pane) or jumping to
 *   a message in home.
 *
 * NOT on opening a user or channel result — navigating to a person or channel is navigation,
 * not a query worth replaying. No-op on an empty query, browsing, inline "See more" expand, or
 * dismissal.
 * Repeat triggers for the same query bump the existing entry rather than duplicating it.
 */
export function saveCurrentSearchQuery(
  workspaceId: string,
  userId: string,
  query: LiveSearchQuery,
): void {
  const trimmedText = query.text.trim();
  if (!trimmedText && query.filterChips.length === 0) return; // never store an empty input

  saveRecentSearch(workspaceId, userId, {
    text: trimmedText,
    filterChips: query.filterChips.map(toStoredChip),
    tab: query.tab,
    toggles: {
      onlyMyChannels: query.onlyMyChannels,
      includeBotMessages: query.includeBotMessages,
    },
    ts: Date.now(),
  });
}

/** Remove a single row (hover ×), matched by its canonical identity key. */
export function removeRecentSearch(workspaceId: string, userId: string, identityKey: string): void {
  if (!workspaceId || !userId) return;
  try {
    const remaining = loadRecentSearches(workspaceId, userId).filter(
      entry => identityKeyFor(entry) !== identityKey,
    );
    writeEntries(workspaceId, userId, remaining);
  } catch {
    // ignore
  }
}

/**
 * Generates a normalized string key to identify identical search entries.
 * Text is lowercased/trimmed, and chips are sorted by ID (ignoring display names). Fields join
 * with a Unit Separator (\x1F) instead of visible punctuation, so no id or query text can contain
 * the delimiter and collide. The key is only compared for equality, never parsed back apart.
 *
 * @example (<US> = the \x1F unit separator)
 * // 1. Text normalizes to the same key
 * identityKeyFor({ text: "QuickPay ", filterChips: [] })                 // => "quickpay<US>"
 * identityKeyFor({ text: "quickpay",  filterChips: [] })                 // => "quickpay<US>"
 * // 2. Chips append to the key
 * identityKeyFor({ text: "pay", filterChips: [{type:"in", id:"C1"}] })   // => "pay<US>in:C1"
 * // 3. Multiple chips sort alphabetically by their signatures
 * identityKeyFor({ text: "x", filterChips: [{type:"b", id:"2"}, {type:"a", id:"1"}] }) // => "x<US>a:1<US>b:2"
 */
export function identityKeyFor(entry: {
  text: string;
  filterChips: ReadonlyArray<{ id: string; type: ChipType; prefix?: ChipPrefix }>;
}): string {
  const UNIT_SEPARATOR = '\x1F';
  const normalizedText = entry.text.trim().toLowerCase().replace(/\s+/g, ' ');
  const chipSignature = entry.filterChips
    .map(chip => `${chip.prefix ?? ''}${chip.type}:${chip.id}`)
    .sort()
    .join(UNIT_SEPARATOR);
  return `${normalizedText}${UNIT_SEPARATOR}${chipSignature}`;
}

/** Plain-text label for a recent (chips + free text), used as the row's aria-label. */
export function recentSearchLabel(entry: RecentSearchEntry): string {
  const chipText = entry.filterChips
    .map(chip => `${chip.prefix ?? ''}${chip.name ?? chip.id}`)
    .join(' ');
  return [chipText, entry.text].filter(Boolean).join(' ').trim();
}

// ─── Internals ──────────────────────────────────────────────────────────────

const STORAGE_VERSION = 1;
const MAX_STORED = 20;
// 30 days — recents older than this are pruned on read.
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

interface RecentSearchEnvelope {
  version: number;
  entries: StoredRecentSearch[];
}

// localStorage key, scoped per workspace + user so separate accounts on one browser stay isolated.
const buildStorageKey = (workspaceId: string, userId: string): string =>
  `cmdk-recents:${workspaceId}:${userId}`;

const pruneExpired = (entries: StoredRecentSearch[]): StoredRecentSearch[] => {
  const cutoff = Date.now() - EXPIRY_MS;
  return entries.filter(entry => entry.ts >= cutoff);
};

const writeEntries = (workspaceId: string, userId: string, entries: StoredRecentSearch[]): void => {
  const envelope: RecentSearchEnvelope = { version: STORAGE_VERSION, entries };
  localStorage.setItem(buildStorageKey(workspaceId, userId), JSON.stringify(envelope));
};

// Persist chip identity only; the display name is resolved live at read. BOARD is the lone
// exception — its id is opaque, so its stored label is the one thing kept.
const toStoredChip = (chip: LiveChip): StoredChip => ({
  id: chip.id,
  type: chip.type,
  ...(chip.prefix ? { prefix: chip.prefix } : {}),
  ...(chip.type === ChipType.BOARD && chip.name ? { name: chip.name } : {}),
});
