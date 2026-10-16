/**
 * How the user arrived. `forward` and `call` are live ChatLinkSource values;
 * `tap` / `share` / `restore` are v3 additions (design §5.3).
 */
export const ENTRY_POINTS = [
  'tap',
  'notification',
  'deeplink',
  'activity',
  'search',
  'share',
  'forward',
  'call',
  'restore',
] as const;

export type EntryPoint = (typeof ENTRY_POINTS)[number];

/** List / restore / share open the chat. Everything else may name a message. */
const CHAT_OPEN_ENTRIES: ReadonlySet<EntryPoint> = new Set(['tap', 'share', 'restore']);

export const isJumpEntry = (entry: EntryPoint): boolean => !CHAT_OPEN_ENTRIES.has(entry);

const ENTRY_SET: ReadonlySet<string> = new Set(ENTRY_POINTS);

/**
 * `call` keeps v2's deterministic list → channel → thread stack.
 * Every other source replaces the resolver host in place.
 */
export type ResolvedCommitMode = 'replace' | 'synthesize-call-stack';

export const parseEntryPoint = (source: unknown, from?: unknown): EntryPoint => {
  if (typeof source === 'string' && ENTRY_SET.has(source)) {
    return source as EntryPoint;
  }
  if (from === 'channel_thread') {
    return 'tap';
  }
  if (typeof from === 'string' && ENTRY_SET.has(from)) {
    return from as EntryPoint;
  }
  return 'deeplink';
};

export const isColdStartFromParams = (entry: EntryPoint, rawFlag: unknown): boolean => {
  if (entry === 'restore') {
    return true;
  }
  if (rawFlag === true || rawFlag === 'true' || rawFlag === '1') {
    return true;
  }
  if (Array.isArray(rawFlag)) {
    return isColdStartFromParams(entry, rawFlag[0]);
  }
  return false;
};

export const resolvedCommitMode = (entry: EntryPoint): ResolvedCommitMode =>
  entry === 'call' ? 'synthesize-call-stack' : 'replace';
