// Minimal mention data stored in recents (no name — resolved at restore time).
// Filters MUST round-trip by id: storing the display text would let replay
// re-resolve by name and land on a different entity than the one searched.
export interface StoredMention {
  id: string;
  type: 'user' | 'channel';
  prefix?: string;
}

export interface RecentQuery {
  query: string;
  mentions: StoredMention[];
  /** Active tab at capture time, so replay reruns under the same scope.
   *  Kept as a plain string: this module must not depend on component types. */
  tab?: string;
  ts: number; // ms since epoch, refreshed on every bump
}

interface RecentsEnvelope {
  version: number;
  entries: RecentQuery[];
}

const SCHEMA_VERSION = 1;

// Keyed by workspace AND user: without the workspace segment, someone switching
// workspaces in the same browser profile sees the other workspace's history —
// wrong data, not just a privacy nicety.
const storageKey = (workspaceId: string, userId: string): string =>
  `cmdk-recents:${workspaceId}:${userId}`;

// Superseded by the versioned, workspace-scoped key above. Dropped on read so it
// does not sit in localStorage forever.
const LEGACY_KEY = (userId: string): string => `xyne_cmdK_recent_queries:${userId}`;

/** Entries kept on disk. Deeper than the display limit because dedupe eats
 *  entries and "see more" reveals the tail. */
export const MAX_STORED_RECENTS = 20;

/** Rows rendered in the collapsed Recents section. */
export const RECENTS_DISPLAY_LIMIT = 3;

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isStoredMention(value: unknown): value is StoredMention {
  if (typeof value !== 'object' || value === null) return false;
  const mention = value as Record<string, unknown>;
  return (
    typeof mention['id'] === 'string' &&
    (mention['type'] === 'user' || mention['type'] === 'channel') &&
    (mention['prefix'] === undefined || typeof mention['prefix'] === 'string')
  );
}

// localStorage is untrusted input: entries written by older schema versions or
// other same-origin code may miss fields, and a bare `as RecentQuery[]` cast
// would let them crash consumers (e.g. `query.trim()` in render). Returns a
// normalized entry, or null when the shape is unusable.
function parseRecentQuery(value: unknown): RecentQuery | null {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;
  const query = entry['query'];
  const ts = entry['ts'];
  const tab = entry['tab'];
  const rawMentions = entry['mentions'];
  if (typeof query !== 'string') return null;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  if (tab !== undefined && typeof tab !== 'string') return null;
  if (rawMentions !== undefined && !Array.isArray(rawMentions)) return null;
  const mentions = (rawMentions ?? []) as unknown[];
  if (!mentions.every(isStoredMention)) return null;
  return { query, mentions, ...(tab !== undefined ? { tab } : {}), ts };
}

/**
 * Identity for dedupe and per-row removal: same text + same filter entities.
 *
 * Text compares case-insensitively with internal whitespace collapsed, so
 * "QuickPay" and "quickpay  mandate" bump the existing row instead of adding a
 * near-duplicate. Only the comparison is normalized -- the raw trimmed text is
 * what gets stored and rendered, and the newest casing wins because the new
 * entry is inserted at the top and the old one filtered out.
 *
 * Prefixes are deliberately NOT collapsed: "quickp" and "quickpay" stay separate
 * entries, per the exact-match-only rule.
 *
 * Encoded as JSON rather than a delimiter-joined string so the two halves cannot
 * collide: `"a b" + [c]` and `"a" + [b, c]` produce different keys.
 */
export function recentQueryKey(entry: Pick<RecentQuery, 'query' | 'mentions'>): string {
  const normalizedQuery = entry.query.trim().replace(/\s+/g, ' ').toLowerCase();
  const mentionIds = (entry.mentions ?? []).map(m => `${m.prefix ?? ''}${m.id}`);
  return JSON.stringify([normalizedQuery, mentionIds]);
}

function clearStorage(workspaceId: string, userId: string): void {
  try {
    localStorage.removeItem(storageKey(workspaceId, userId));
  } catch {
    // ignore (storage unavailable)
  }
}

function writeEntries(workspaceId: string, userId: string, entries: RecentQuery[]): void {
  try {
    const envelope: RecentsEnvelope = { version: SCHEMA_VERSION, entries };
    localStorage.setItem(storageKey(workspaceId, userId), JSON.stringify(envelope));
  } catch {
    // ignore (quota exceeded / storage unavailable)
  }
}

/**
 * Read the MRU list, dropping entries older than 30 days.
 *
 * Pruning is lazy — it happens here and on write, so there are no timers and no
 * background job. The MRU cap does the real work; the age cut only stops a
 * returning user from seeing months-old context.
 *
 * Reads are deliberately forgiving: a version this build does not recognize is
 * not grounds to delete someone's history. Storage is only cleared when it is
 * unreadable in a way that would re-fail on every load (unparseable JSON, or an
 * envelope with no entries array). Data from a newer build is left untouched.
 */
export function loadRecentQueries(workspaceId: string, userId: string): RecentQuery[] {
  try {
    localStorage.removeItem(LEGACY_KEY(userId));
  } catch {
    // ignore
  }

  let parsed: unknown;
  try {
    const stored = localStorage.getItem(storageKey(workspaceId, userId));
    if (!stored) return [];
    parsed = JSON.parse(stored);
  } catch {
    // JSON.parse failed — the stored value is beyond repair, drop it so it
    // doesn't re-fail on every load.
    clearStorage(workspaceId, userId);
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    clearStorage(workspaceId, userId);
    return [];
  }

  const envelope = parsed as Record<string, unknown>;
  const storedVersion = envelope['version'];

  // Written by a NEWER build than this one. Read nothing and — crucially — write
  // nothing: this build would serialize back in its own older shape and silently
  // strip fields the newer build depends on. Deleting would be worse still, so
  // the data is left exactly as found. Happens whenever two tabs straddle a deploy.
  if (typeof storedVersion === 'number' && storedVersion > SCHEMA_VERSION) {
    return [];
  }

  // Older or unrecognized version: read it anyway rather than wiping it. A
  // tolerant parser IS the migration for the common case (a field added, absent
  // on old rows, defaulted on read), and parseRecentQuery already drops anything
  // genuinely unusable row by row.
  //
  // A future version that truly cannot salvage v1 data — a field removed, or one
  // whose MEANING changed so old values would be misread — should clearStorage()
  // here explicitly. That is the rare, deliberate case, not the default.
  if (!Array.isArray(envelope['entries'])) {
    clearStorage(workspaceId, userId);
    return [];
  }

  const cutoff = Date.now() - MAX_AGE_MS;
  const valid = (envelope['entries'] as unknown[])
    .map(parseRecentQuery)
    .filter((entry): entry is RecentQuery => entry !== null && entry.ts >= cutoff)
    .slice(0, MAX_STORED_RECENTS);

  return valid;
}

/**
 * Record a search at its commit point (a selection), moving it to the top.
 *
 * Dedupe is exact-match only — same query text and same filter entities. Near
 * misses ("quickp" vs "quickpay") are kept as separate entries by design.
 */
export function saveRecentQuery(
  workspaceId: string,
  userId: string,
  query: string,
  mentions: StoredMention[] = [],
  tab?: string,
): void {
  const entry: RecentQuery = {
    query,
    mentions,
    ...(tab !== undefined ? { tab } : {}),
    ts: Date.now(),
  };
  const key = recentQueryKey(entry);
  const deduped = loadRecentQueries(workspaceId, userId).filter(r => recentQueryKey(r) !== key);
  writeEntries(workspaceId, userId, [entry, ...deduped].slice(0, MAX_STORED_RECENTS));
}

/** Remove a single entry (the per-row ×). */
export function removeRecentQuery(workspaceId: string, userId: string, key: string): void {
  const remaining = loadRecentQueries(workspaceId, userId).filter(r => recentQueryKey(r) !== key);
  writeEntries(workspaceId, userId, remaining);
}

/** Empty the list (the "Clear all" action), which also hides the section. */
export function clearRecentQueries(workspaceId: string, userId: string): void {
  clearStorage(workspaceId, userId);
}
