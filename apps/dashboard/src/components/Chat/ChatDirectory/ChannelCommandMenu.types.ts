// Types for ChannelCommandMenu component (using const objects due to erasableSyntaxOnly)
import type { Channel } from '@xyne/shared';
import type { SearchResultsFilters } from '../../../hooks/useSearchResultsScreen';
import type { ContextItem } from '../ThreadContextPanel/ThreadContextPanel.types';
import type { InitialQueryData } from './LexicalSearchInput';
import { parseSearchFilters, parseTypeFilter } from '../../../utils/searchFilterParser';

type SearchResultsDocType = SearchResultsFilters['docType'];

/**
 * Searchable type constants for the type: filter
 * These are the valid type values that can be used with the type filter
 */
export const SearchableTypes = {
  MESSAGES: 'messages',
  CHANNELS: 'channels',
  USERS: 'users',
  PEOPLE: 'people',
  TICKETS: 'tickets',
  FILES: 'files',
  ATTACHMENTS: 'attachments',
  CANVAS: 'canvas',
  TRANSCRIPT: 'transcript',
  RCA: 'rca',
  EMAILS: 'emails',
} as const;
/**
 * Type suggestions for the type: filter autocomplete
 * These are the available types that can be used with the type filter
 */
export const TYPE_SUGGESTIONS = [
  { id: SearchableTypes.MESSAGES, name: SearchableTypes.MESSAGES },
  { id: SearchableTypes.CHANNELS, name: SearchableTypes.CHANNELS },
  { id: SearchableTypes.USERS, name: SearchableTypes.USERS },
  { id: SearchableTypes.PEOPLE, name: SearchableTypes.PEOPLE, aliasFor: SearchableTypes.USERS },
  { id: SearchableTypes.TICKETS, name: SearchableTypes.TICKETS },
  { id: SearchableTypes.FILES, name: SearchableTypes.FILES },
  { id: SearchableTypes.ATTACHMENTS, name: SearchableTypes.ATTACHMENTS },
  { id: SearchableTypes.CANVAS, name: SearchableTypes.CANVAS, subApp: 'canvas' },
  { id: SearchableTypes.TRANSCRIPT, name: SearchableTypes.TRANSCRIPT, subApp: 'transcript' },
  { id: SearchableTypes.RCA, name: SearchableTypes.RCA, subApp: 'RCA' },
  { id: SearchableTypes.EMAILS, name: SearchableTypes.EMAILS },
] as const;
export const TabType = {
  ALL: 'all',
  USERS: 'users',
  CHANNELS: 'channels',
  MESSAGES: 'messages',
  TICKETS: 'tickets',
  ATTACHMENTS: 'attachments',
  CANVAS: 'canvas',
  CALL: 'call',
  RECORDING: 'recording',
  DESK: 'desk',
} as const;

export type TabType = (typeof TabType)[keyof typeof TabType];

/**
 * Single source of truth for results-page docTypes.
 *
 * Each entry defines, per docType:
 *  - `tab`: the results-page TabType it maps to.
 *  - `groupKeys`: the backend-result group key(s) that resolve to this docType
 *    (empty when no backend group maps to it, e.g. 'all' / 'channels').
 *
 * Adding a new tab/docType means editing exactly ONE entry here — the three
 * derived maps below (VALID_DOC_TYPES, DOC_TYPE_TO_TAB, GROUP_KEY_TO_DOC_TYPE)
 * pick it up automatically.
 *
 * NOTE: both 'all' and 'channels' intentionally map to TabType.ALL to preserve
 * existing behavior (the old `docTypeToTabType` switch returned ALL for both via
 * its `default` case).
 */
export const DOC_TYPE_REGISTRY = {
  all: { tab: TabType.ALL, groupKeys: [] },
  messages: { tab: TabType.MESSAGES, groupKeys: ['conversation'] },
  files: {
    tab: TabType.ATTACHMENTS,
    groupKeys: ['attachment', 'canvas', 'transcript', 'recording'],
  },
  tickets: { tab: TabType.TICKETS, groupKeys: ['ticket'] },
  channels: { tab: TabType.ALL, groupKeys: [] },
  desk: { tab: TabType.DESK, groupKeys: ['desk'] },
  people: { tab: TabType.USERS, groupKeys: ['user'] },
} as const satisfies Record<SearchResultsDocType, { tab: TabType; groupKeys: readonly string[] }>;

/** Valid docType strings — derived from the registry keys. */
export const VALID_DOC_TYPES = Object.keys(DOC_TYPE_REGISTRY) as SearchResultsDocType[];

/** docType -> results-page TabType — derived from the registry. */
export const DOC_TYPE_TO_TAB = Object.fromEntries(
  (Object.entries(DOC_TYPE_REGISTRY) as [SearchResultsDocType, { tab: TabType }][]).map(
    ([docType, { tab }]) => [docType, tab],
  ),
) as Record<SearchResultsDocType, TabType>;

/**
 * Palette TabType -> results-page docType, so "Show detailed results for" lands on the
 * tab the user was already looking at.
 *
 * Deliberately NOT an inversion of DOC_TYPE_TO_TAB: 'all' and 'channels' both map to
 * TabType.ALL, so inverting is lossy — it would drop 'channels' and make TabType.ALL
 * ambiguous. Only the palette's own tabs appear here; TabType also carries CANVAS/CALL/
 * RECORDING, which are not tabs in the palette, hence Partial.
 */
export const TAB_TO_DOC_TYPE = {
  [TabType.ALL]: 'all',
  [TabType.MESSAGES]: 'messages',
  [TabType.USERS]: 'people',
  [TabType.CHANNELS]: 'channels',
  [TabType.ATTACHMENTS]: 'files',
  [TabType.TICKETS]: 'tickets',
  [TabType.DESK]: 'desk',
} as const satisfies Partial<Record<TabType, SearchResultsDocType>>;

/**
 * Backend-result group key -> results-page docType — derived by inverting each
 * registry entry's `groupKeys`.
 */
export const GROUP_KEY_TO_DOC_TYPE = Object.fromEntries(
  (
    Object.entries(DOC_TYPE_REGISTRY) as [SearchResultsDocType, { groupKeys: readonly string[] }][]
  ).flatMap(([docType, { groupKeys }]) => groupKeys.map(groupKey => [groupKey, docType])),
) as Record<string, SearchResultsDocType>;

export const VespaApps = {
  CHAT: 'chat',
  TICKET: 'ticket',
  FILE: 'file',
  MAIL: 'mail',
  CALL: 'call',
} as const;

export type VespaApps = (typeof VespaApps)[keyof typeof VespaApps];

export const VespaDocTypes = {
  MESSAGES: 'messages',
  CHANNELS: 'channels',
  ATTACHMENTS: 'attachments',
  TICKETS: 'tickets',
  FILES: 'files',
  CALLS: 'calls',
} as const;

export type VespaDocTypes = (typeof VespaDocTypes)[keyof typeof VespaDocTypes];

export const MentionType = {
  USER: 'user',
  CHANNEL: 'channel',
  // Value filter (not an entity): the exclusive priority chip. `id` holds the
  // canonical TicketPriority value (e.g. 'HIGH'), `name` the display label.
  PRIORITY: 'priority',
} as const;

export type MentionType = (typeof MentionType)[keyof typeof MentionType];

/**
 * Picked entity + filter metadata for a mention/filter chip (cmd+K search,
 * GlobalCommandMenu). `type` mirrors the MentionType values above.
 */
export interface MentionData {
  id: string;
  name: string;
  type: 'user' | 'channel' | 'priority';
  prefix?: 'from:' | 'to:' | 'with:' | 'in:' | 'assignee:' | 'priority:';
  email?: string;
  photoLink?: string;
}

export type { ContextItem };

export interface ContextPickerItem {
  id: string;
  title: string;
  isPrivate?: boolean; // relevant for channels only
}

export interface ChannelCommandMenuProps {
  channels: Channel[];
  starred: Channel[];
  directMessages: Channel[];
  currentUserID: string;
  unreadCounts: Record<string, number>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true, clicking items adds them to context instead of navigating */
  contextSelectionMode?: boolean;
  /** Currently selected context items (used to show checkmarks) */
  contextItems?: ContextItem[];
  /** Called when user toggles an item in/out of context */
  onContextItemToggle?: (item: ContextItem) => void;
  /** Called when user confirms selection ("Add to Thread") */
  onContextSelectionConfirm?: () => void;
  /** Pre-populated mention filter (e.g., from Cmd+F for current channel) */
  initialMention?: MentionData | null;
  /**
   * Pre-populated full query (mention chips + trailing text) used to restore
   * the previous search when reopening the overlay from the results-page header.
   */
  initialQuery?: InitialQueryData | null;
  /**
   * Controls which tabs are visible. When omitted, defaults to all
   * pre-existing tabs (users, channels, messages, desk, tickets, attachments).
   * Pass an explicit array to show only those tabs — e.g.
   * [TabType.CHANNELS, TabType.TICKETS, TabType.CANVAS] for the AskAI context picker.
   */
  enabledTabs?: TabType[];
  /**
   * When true, renders as a plain inline panel (<Command>) instead of a
   * full-screen dialog (<Command.Dialog>). Parent controls visibility by
   * conditionally mounting/unmounting this component.
   */
  inline?: boolean;
  /** Called whenever the active tab changes; used to track active tab for call/recording disambiguation. */
  onTabChange?: (tab: TabType) => void;
  /** When provided, the dialog opens on this tab instead of ALL. Used by context-aware Cmd+F. */
  initialTab?: TabType;
  /** When true, the search input will not steal focus on open (used when parent wants to keep focus elsewhere) */
  disableAutoFocus?: boolean;
  /** When true, hides the tab bar. The search scope is still controlled by initialTab. */
  hideTabs?: boolean;
  /** When true, enables desk ticket merge UI (only set when opened via the support screen search button) */
  deskMergeEnabled?: boolean;
}

/* ------------------------------------------------------------------------- *
 * Filter → category relevance — one table (FILTER_RELEVANCE) mapping each filter
 * to its result tabs. Drives (a) which local People/Channels sections stay shown and
 * (b) the narrowed Vespa `apps` we query. Full write-up: SEARCH_FILTER_RELEVANCE.md.
 * ------------------------------------------------------------------------- */

/**
 * Filter kinds with a fixed relevant-tab set. `type:` is intentionally NOT one —
 * it names its tab(s) directly (expanded in getRelevantTabSets).
 */
export type FilterKind =
  | 'from'
  | 'to'
  | 'with'
  | 'in'
  | 'assignee'
  | 'priority'
  | 'status'
  | 'stage'
  | 'board'
  | 'tags'
  | 'date'
  | 'mention' // bare @user
  | 'channelMention'; // bare #channel

/**
 * Which category tabs each filter's RESULTS fall into — NOT the category of the
 * filter's value. Keys are the filters sent to Vespa (chip prefixes, text operators,
 * and the two mention params). Two invariants:
 *   - `in:<channel>`/`from:@user` return the CONTENT they scope (messages/tickets/…),
 *     never CHANNELS/USERS themselves.
 *   - CHANNELS is relevant ONLY via `type:channels`, USERS ONLY via `type:users`
 *     (handled in getRelevantTabs' type: expansion, not here).
 * Omit a tab where the backend ignores the filter (e.g. `date` omits Desk).
 */
export const FILTER_RELEVANCE: Record<FilterKind, TabType[]> = {
  // Content authored by / sent from the user (messages, desk email, tickets & files created).
  from: [TabType.MESSAGES, TabType.DESK, TabType.TICKETS, TabType.ATTACHMENTS],
  to: [TabType.DESK],
  with: [TabType.MESSAGES],
  // Content scoped to a channel/DM — NOT the channel itself.
  in: [
    TabType.MESSAGES,
    TabType.TICKETS,
    TabType.ATTACHMENTS,
    TabType.DESK,
    TabType.CALL,
    TabType.RECORDING,
  ],
  assignee: [TabType.TICKETS],
  priority: [TabType.TICKETS],
  status: [TabType.TICKETS],
  stage: [TabType.TICKETS],
  board: [TabType.TICKETS],
  tags: [TabType.TICKETS],
  // Desk omitted: the Cmd+K path never populates mail date params (backend wires date to
  // slack/ticket/file only). Add DESK once options.mail.createdBefore/After/On/Range is set.
  date: [
    TabType.MESSAGES,
    TabType.TICKETS,
    TabType.ATTACHMENTS,
    TabType.CANVAS,
    TabType.CALL,
    TabType.RECORDING,
  ],
  // @user / #channel is a mention/channelMention filter (Vespa `mentions`/`channelMentions`, messages-only)
  // ONLY when text precedes it ("deploy @alice") or another chip exists; a lone @/# navigates to the
  // DM/channel instead. A prefixed @/# (from:/in:) goes by its prefix — see filterChipToKind.
  mention: [TabType.MESSAGES], // @user → `mentions` filter (else DM quick-switch)
  channelMention: [TabType.MESSAGES], // #channel → `channelMentions` filter (else channel quick-switch)
};

/** Tabs with no Vespa app: ALL (no scoping) + client-side USERS/CHANNELS (see LOCAL_TYPES). */
type ClientSideTab = typeof TabType.ALL | typeof TabType.USERS | typeof TabType.CHANNELS;

/**
 * Category tab → its backing Vespa app (many-to-one; Attachments/Canvas/Call/Recording all
 * → FILE). The only tab↔app bridge — query scoping derives from FILTER_RELEVANCE through this
 * map, so relevance and query scope can't drift. Every content tab MUST be listed: the
 * `satisfies` fails the build if a new one is added to TabType and forgotten here.
 */
export const TAB_TO_VESPA_APPS = {
  [TabType.MESSAGES]: VespaApps.CHAT,
  [TabType.TICKETS]: VespaApps.TICKET,
  [TabType.ATTACHMENTS]: VespaApps.FILE,
  [TabType.CANVAS]: VespaApps.FILE,
  [TabType.CALL]: VespaApps.FILE,
  [TabType.RECORDING]: VespaApps.FILE,
  [TabType.DESK]: VespaApps.MAIL,
} satisfies Record<Exclude<TabType, ClientSideTab>, VespaApps>;

/**
 * `type:` value → UI tab (first hop of type→tab→app). Needed because the `type:` vocabulary
 * (SearchableTypes) and UI tabs (TabType) differ — files/attachments/rca → ATTACHMENTS.
 */
const SEARCHABLE_TYPE_TO_TAB: Record<string, TabType> = {
  [SearchableTypes.MESSAGES]: TabType.MESSAGES,
  [SearchableTypes.CHANNELS]: TabType.CHANNELS,
  [SearchableTypes.USERS]: TabType.USERS,
  [SearchableTypes.PEOPLE]: TabType.USERS,
  [SearchableTypes.TICKETS]: TabType.TICKETS,
  [SearchableTypes.FILES]: TabType.ATTACHMENTS,
  [SearchableTypes.ATTACHMENTS]: TabType.ATTACHMENTS,
  [SearchableTypes.CANVAS]: TabType.CANVAS,
  [SearchableTypes.TRANSCRIPT]: TabType.CALL,
  [SearchableTypes.RCA]: TabType.ATTACHMENTS,
  [SearchableTypes.EMAILS]: TabType.DESK,
};

/** Minimal shape of a filter chip needed to classify it (tolerant of both call sites). */
type FilterChip = { type: string; prefix?: string };

/**
 * Classify one filter chip into its FilterKind (null when it isn't a relevance filter).
 * A chip is a picked token (from:/to:/with:/in:/assignee:/priority: or a bare @user/#channel),
 * not a text-typed filter. Shared chip taxonomy — also drives query bucketing
 * (deriveMentionBuckets in useSearchMetrics), so the two can't drift.
 *
 * Prefix-first: a prefix uniquely determines the chip's type (from:/to:/with:/assignee: only
 * attach to USER chips, in: only to CHANNEL — enforced at chip creation in MentionPlugin), so
 * the bare-@/# type checks below are reached only by prefix-less chips.
 */
export function filterChipToKind(chip: FilterChip): FilterKind | null {
  switch (chip.prefix) {
    case 'from:':
      return 'from';
    case 'to:':
      return 'to';
    case 'with:':
      return 'with';
    case 'in:':
      return 'in';
    case 'assignee:':
      return 'assignee';
    case 'priority:':
      return 'priority';
    default:
      break;
  }
  // Priority chip carries type 'priority' even without a prefix.
  if (chip.type === MentionType.PRIORITY) return 'priority';
  // Bare @user / #channel chips (no prefix) scope to message content.
  if (chip.type === MentionType.USER) return 'mention';
  if (chip.type === MentionType.CHANNEL) return 'channelMention';
  return null;
}

/**
 * Every active filter's relevant-tab set, to be intersected by getRelevantTabs. The one
 * place `parsed` is consumed: chips + text operators → FilterKind → FILTER_RELEVANCE, and
 * `type:` values → tabs directly (SEARCHABLE_TYPE_TO_TAB), since `type:` names its own tab(s).
 */
function getRelevantTabSets(
  selectedFilters: ReadonlyArray<FilterChip>,
  parsed: ReturnType<typeof parseSearchFilters>,
): TabType[][] {
  const kinds = new Set<FilterKind>();
  for (const chip of selectedFilters) {
    const kind = filterChipToKind(chip);
    if (kind) kinds.add(kind);
  }
  if (parsed.status) kinds.add('status');
  if (parsed.stage) kinds.add('stage');
  if (parsed.board) kinds.add('board');
  if (parsed.tags) kinds.add('tags');
  if (parsed.before || parsed.after || parsed.on || parsed.range) kinds.add('date');

  const sets: TabType[][] = [...kinds].map(kind => FILTER_RELEVANCE[kind]);

  const typeTabs = parseTypeFilter(parsed.type)
    .map(type => SEARCHABLE_TYPE_TO_TAB[type])
    .filter((tab): tab is TabType => Boolean(tab));
  if (typeTabs.length > 0) sets.push(typeTabs);

  return sets;
}

/**
 * The category tabs relevant to the active filters — the INTERSECTION of every active
 * filter's tab set (combining filters narrows further).
 *
 * Pass `rawText` = the raw input WITH its filter tokens still in it (status:open, type:tickets,
 * before:2024), NOT the cleaned free-text query, or the text-typed filters are invisible here.
 *
 * Returns `null` (no constraint) when no filter is active or filters conflict to an empty
 * intersection (safer to not narrow than to show nothing).
 */
export function getRelevantTabs(
  selectedFilters: ReadonlyArray<FilterChip>,
  rawText: string,
): Set<TabType> | null {
  // Parse the text filters once; getRelevantTabSets reuses it for both the kind
  // derivation and the type: expansion (avoids parsing the query string twice).
  const parsed = parseSearchFilters(rawText);
  const sets = getRelevantTabSets(selectedFilters, parsed);

  if (sets.length === 0) {
    // A half-typed `type:mess` resolves to no tab yet but is still an active constraint — return
    // an empty set (hide locals), not null (which would flash them back mid-compose).
    // A bare `type:` with no value → parsed.type undefined → null → nothing to constrain.
    return parsed.type ? new Set<TabType>() : null;
  }

  let relevant = new Set<TabType>(sets[0] ?? []);
  for (const set of sets.slice(1)) {
    relevant = new Set([...relevant].filter(tab => set.includes(tab)));
  }
  return relevant.size > 0 ? relevant : null;
}

/**
 * The comma-separated Vespa `apps` param for a set of relevant tabs, mapped through
 * TAB_TO_VESPA_APPS. Query scoping derives from relevance, so the two can't drift. Narrowing
 * is lossless (an app backing no relevant tab only returns noise). Returns `null` (query all
 * apps) when nothing constrains it.
 */
export function getRelevantAppsParam(relevantTabs: Set<TabType> | null): string | null {
  if (!relevantTabs) return null;

  const apps = new Set<VespaApps>();
  for (const [tab, app] of Object.entries(TAB_TO_VESPA_APPS)) {
    if (relevantTabs.has(tab as TabType)) apps.add(app);
  }
  return apps.size > 0 ? [...apps].join(',') : null;
}
