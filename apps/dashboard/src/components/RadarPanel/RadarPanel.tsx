import {
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  BellOff,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Hash,
  Hourglass,
  ListFilter,
  Loader2,
  MoreHorizontal,
  Pencil,
  Search,
  Radar as RadarIcon,
  RefreshCw,
  Settings,
  Trash2,
  UsersRound,
  X,
  Zap,
} from 'lucide-react';
import {
  fetchRadarDebugRuns,
  fetchRadarItemTrail,
  fetchRadarPendingMe,
  fetchRadarPendingOthersPage,
  fetchRadarWaitingOn,
  dismissAllRadarItems,
  dismissRadarItem,
  resolveAllRadarItems,
  resolveRadarItem,
  RadarItemTrail,
  RadarRunLog,
  RadarRunsResult,
  RadarThreadCard,
  RadarFeedItem,
  type RadarPendingOthersPage,
  type RadarPendingOthersPageParams,
} from '../../api/radarApi';
import { ChannelScopeType, parseInitialMessageMd, type User } from '@xyne/shared';
import { useAuth } from '../../hooks/useAuth';
import { useRadarEnabled } from '../../hooks/radarCacConfig';
import {
  usePersistedRadarFilters,
  type RadarTimeRange,
} from '../../hooks/usePersistedRadarFilters';
import {
  MAX_TEAM_MEMBERS,
  usePersistedRadarTeams,
  type RadarTeam,
} from '../../hooks/usePersistedRadarTeams';
import {
  MAX_RULES,
  MAX_RULE_VALUES,
  MAX_RULE_VALUE_LENGTH,
  useRadarRules,
} from '../../hooks/useRadarRules';
import { sortRules, type RadarRuleCondition, type RadarRuleScope } from '@xyne/shared';
// The app's one user-group search, as used by the @-mention popovers and Share.
import { useUserGroupSearch } from '@xyne/shared/hooks';
import { useActiveUsers, useUsersById } from '../../hooks/useUsers';
import { useRankedActivePeople } from '../../hooks/useRankedPeopleSearch';
import { useAllChannels } from '../../hooks/useChannels';
// cmd+K's channel matcher and its name resolver, not a second one of Radar's:
// the same fuzzy-plus-participant-token search the command menu, the slash
// pickers and Forward already run, over the same item shape.
import { filterChannelsBySearchableNames } from '../../utils/rankingUtils';
import {
  formatChannelLabel,
  getDMNames,
  parseDMParticipantIds,
} from '../Chat/ChatDirectory/ChatDirectory.utils';
import { useAffinityCallback } from '../../hooks/useAffinityCallback';
import { cn } from '../../utils/classNames';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { Dialog } from '../ui/Dialog/Dialog';
import Avatar from '../ui/Avatar/Avatar';
import { Tooltip } from '../ui/Tooltip';
import { globalClickTracker } from '../../services/Analytics/globalClickTracker';

type RadarTab = 'all' | 'pending' | 'waiting';

/** A pane of the settings dialog. The union is the nav: adding a section here
 *  and a row to settingsNav is the whole of registering one. */
type RadarSettingsSection = 'rules' | 'teams';

/** The scopes a rule can test, in the order the builder offers them, with the
 *  word each reads as in a chip and the prompt for its value input. */
const RULE_SCOPES: ReadonlyArray<{
  id: RadarRuleScope;
  label: string;
  chip: string;
  placeholder: string;
}> = [
  { id: 'channel', label: 'Channel', chip: 'in', placeholder: 'Search channels and DMs' },
  { id: 'keyword', label: 'Keyword', chip: 'says', placeholder: 'deploy, sign-off, blocker…' },
  {
    id: 'mention',
    label: 'Mentions',
    chip: 'mentions',
    placeholder: 'Search user groups',
  },
  { id: 'sender', label: 'Requested by', chip: 'from', placeholder: 'Search people' },
];

/** Value matches offered per query in the rule builder. */
const RULE_VALUE_RESULTS = 8;

/** `useUserGroupSearch` returns everything on an empty query; this asks for
 *  nothing instead, since the picker draws nothing until it is asked. */
const EMPTY_GROUP_QUERY = '￼';

/** Groups held for chip names only — a chip falling back to a raw id is the
 *  failure this bound guards, so it covers a whole workspace roster. */
const GROUP_NAME_LIMIT = 500;

/** Avatars stacked on a rule-builder row, as on the channel filter's rows. */
const AVATARS_IN_RULE_ROW = 2;

/** One offered rule value. `people` is whoever the row is made of — a DM's
 *  participants or the one person — and empty for a named channel or a user
 *  group, which get a tile instead. */
interface RuleValueOption {
  /** Row identity for React, and the first of `values`. */
  value: string;
  /** Every id this row stands for: one for a person or a group, and for a
   *  channel every channel that renders to the label shown — picking the row
   *  has to mean the row, not whichever of them happened to sort first. */
  values: string[];
  label: string;
  people: string[];
  /** A user group — no avatars to stack, so the row wears the group tile. */
  group?: boolean;
}

/** Avatars rendered before the stack collapses into a +N chip. */
const AVATARS_SHOWN = 3;

/** Team-picker matches drawn per query; past this the search narrows instead. */
const TEAM_PICKER_RESULTS = 25;

/** Ranked candidates asked of the shared people search. Wide enough that
 *  narrowing the result to one picker's own people still fills a page. */
const RANKED_PEOPLE_LIMIT = 200;

/** Thread groups per page of the TABLE feed. */
const FEED_PAGE = 5;
/** Cards keep the feed they have always had: drawn in blocks as the reader
 *  scrolls, never paged. */
const CARDS_PAGE = 20;

/**
 * The creation window a time filter stands for, or null for any time. Shared
 * by the in-browser filter and the Pending Others page request so the two can
 * never disagree about what "today" means.
 */
const createdWindow = (
  range: RadarTimeRange,
  customFrom: string,
  customTo: string,
): { from: number; to: number } | null => {
  if (range === 'any') return null;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const from =
    range === 'today'
      ? dayStart.getTime()
      : range === '7d'
        ? Date.now() - 7 * 864e5
        : range === '30d'
          ? Date.now() - 30 * 864e5
          : customFrom
            ? new Date(customFrom).getTime()
            : 0;
  // The picker gives a date, not an instant — an inclusive end means the
  // whole of that day, otherwise "to today" silently excludes today.
  const to = range === 'custom' && customTo ? new Date(customTo).getTime() + 864e5 : Infinity;
  return { from, to };
};

/**
 * Radar — the execution feed. Card-based views over the open-item ledger:
 * Pending me (I hold the ball) and Pending others (I asked, someone else acts),
 * grouped per thread with per-item and per-thread resolve. Threads open in a
 * side panel; the Debug drawer shows the worker's run trail.
 */
const RadarPanel = (): ReactElement => {
  const navigate = useNavigate();
  const { user } = useAuth();
  // The router is built at module scope, so the rollout gate has to live here:
  // with radar_config off (or this user outside allowedEmails) the route is
  // reachable by URL but renders nothing and issues no requests.
  const radarEnabled = useRadarEnabled(user?.email);
  const params = useParams<{ channelId?: string; conversationId?: string }>();
  const usersById = useUsersById();
  const activeUsers = useActiveUsers();
  const channels = useAllChannels();
  const [pending, setPending] = useState<RadarThreadCard[]>([]);
  const [waiting, setWaiting] = useState<RadarThreadCard[]>([]);
  const [loading, setLoading] = useState(true);
  // Which layout draws the feed — a view preference, not part of what's
  // fetched or filtered, so it doesn't need to survive a reload.
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // One debug surface: the card's Debug button opens this thread-scoped view
  // (watermark position, per-item trails with the model's reasoning, runs).
  const [threadDebug, setThreadDebug] = useState<{
    conversationId: string;
    loading: boolean;
    trails: RadarItemTrail[];
    runs: RadarRunLog[];
    threadState: RadarRunsResult['threadState'];
    latestMessage: RadarRunsResult['latestMessage'];
    watermarkMessage: RadarRunsResult['watermarkMessage'];
    /** Lookup 404: unknown thread, or one the viewer has no channel access to. */
    notFound?: boolean;
  } | null>(null);
  const [debugLookup, setDebugLookup] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Table: zero-based page of the live feed and of the muted group.
  const [feedPage, setFeedPage] = useState(0);
  const [mutedPage, setMutedPage] = useState(0);
  // Cards: how much of the feed is drawn, grown by the scroll sentinel.
  const [feedLimit, setFeedLimit] = useState(CARDS_PAGE);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const [filterCategory, setFilterCategory] = useState<'pending' | 'channels' | 'time'>('pending');
  // "Pending on" replaces the old tabs: me maps to the pending feed, others to
  // the waiting feed, both to all. The selection is kept per user across
  // reloads, so returning to Radar does not mean picking the filters again.
  const {
    pendingMe,
    setPendingMe,
    pendingOthers,
    setPendingOthers,
    pendingUsers,
    setPendingUsers,
    teamIds,
    setTeamIds,
    othersMode,
    setOthersMode,
    excludedRequesters,
    setExcludedRequesters,
    filterChannels,
    setFilterChannels,
    timeRange,
    setTimeRange,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    clearAllFilters,
  } = usePersistedRadarFilters(user?.id);
  const { teams, createTeam, updateTeam, deleteTeam } = usePersistedRadarTeams(user?.id);
  // Which settings pane is open, and null for shut — one state rather than an
  // open flag beside a section, so the dialog can never be open on nothing.
  const [settingsSection, setSettingsSection] = useState<RadarSettingsSection | null>(null);
  // The team form is transient: which team is being edited and the half-typed
  // draft describe the dialog, not the feed, so none of it persists.
  const [teamDraft, setTeamDraft] = useState<{
    id: string | null;
    name: string;
    memberIds: Set<string>;
  } | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  // Every item's muted verdict is decided server-side, per read, so saving a
  // rule changes nothing on screen until the feed is re-read. This counter is
  // bumped once the server has accepted a write; the effect that watches it
  // sits below load(), which is declared further down.
  const [rulesVersion, setRulesVersion] = useState(0);
  const onRulesSaved = useCallback((): void => setRulesVersion(n => n + 1), []);
  const { rules, atRuleLimit, createRule, updateRule, deleteRule } = useRadarRules(
    user?.id,
    onRulesSaved,
  );
  // The rule being built, and the id it will replace when Save is pressed.
  // Editing loads the rule back into this one builder rather than opening a
  // second copy of it inside the row.
  const [ruleDraft, setRuleDraft] = useState<{
    id: string | null;
    scope: RadarRuleScope;
    conditions: RadarRuleCondition[];
  }>({ id: null, scope: 'channel', conditions: [] });
  const [ruleValueSearch, setRuleValueSearch] = useState('');
  // Muted items are kept, not dropped, so the reader can check what a rule is
  // doing — but shut, because the point of the rule was not to look at them.
  const [mutedOpen, setMutedOpen] = useState(false);
  // Table view: threads collapsed by the reader, keyed by scopeKey. Starts
  // empty — every group opens expanded, same as the cards feed always has.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Radix restores focus to its own trigger on close; this dialog has none,
  // and more than one control opens it, so whichever was clicked is remembered
  // here and given focus back by hand.
  const settingsOpenerRef = useRef<HTMLElement | null>(null);
  // Requested by defaults to the reading almost everyone wants, so it opens
  // shut: the header carries the current choice, and only someone who wants
  // the other one has to open it.
  const [requestedByOpen, setRequestedByOpen] = useState(false);
  // Same reasoning as the picker above: excluding a requester is the rare
  // choice, and "from anyone" is already the answer for almost everyone — so
  // it opens shut and states that answer rather than listing the workspace.
  const [requesterPickerOpen, setRequesterPickerOpen] = useState(false);
  const [requesterSearch, setRequesterSearch] = useState('');
  const [holderSearch, setHolderSearch] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [cardMenu, setCardMenu] = useState<string | null>(null);

  // Works from a bare conversation id (the debug lookup box) as well as a
  // card: the runs endpoint reports the thread's items (resolved included),
  // and the server enforces the viewer's channel ACL — a pasted id for a
  // thread the viewer can't open comes back 404.
  const openThreadDebugById = (conversationId: string) => {
    setThreadDebug({
      conversationId,
      loading: true,
      trails: [],
      runs: [],
      threadState: null,
      latestMessage: null,
      watermarkMessage: null,
    });
    void fetchRadarDebugRuns(conversationId)
      .then(async runsResult => {
        const trails = await Promise.all(
          (runsResult.items ?? []).map(i => fetchRadarItemTrail(i.id).catch(() => null)),
        );
        setThreadDebug({
          conversationId,
          loading: false,
          trails: trails.filter((t): t is RadarItemTrail => t !== null),
          runs: runsResult.runs,
          threadState: runsResult.threadState,
          latestMessage: runsResult.latestMessage,
          watermarkMessage: runsResult.watermarkMessage,
        });
      })
      .catch(() =>
        setThreadDebug({
          conversationId,
          loading: false,
          trails: [],
          runs: [],
          threadState: null,
          latestMessage: null,
          watermarkMessage: null,
          notFound: true,
        }),
      );
  };
  const openThreadDebug = (card: RadarThreadCard) => openThreadDebugById(card.conversationId);

  // Thread opens beside the feed (recap-style), not as a redirect.
  const showThreadPanel = !!params.conversationId;
  const closeThreadPanel = useCallback((): void => {
    void navigate('/chat/dir/radar');
  }, [navigate]);

  // Monotonic request id. Switching scope (me -> team A -> team B) fires
  // overlapping requests, and without this whichever response lands last wins
  // — which can be team A's. Only the newest request may touch state.
  const requestSeq = useRef(0);

  // Pending Others ("anyone") is workspace-wide, so it is read from the server a
  // page at a time with its filters applied there, instead of shipped whole to
  // be filtered and paged here. "Requested by me" stays a whole-feed read: it
  // is scoped to the viewer and small.
  const othersPaged = othersMode === 'all';
  const [othersPageData, setOthersPageData] = useState<RadarPendingOthersPage | null>(null);
  const othersParams = useMemo((): RadarPendingOthersPageParams => {
    // A ticked team is shorthand for its members, unioned with ticked people.
    const holders = new Set(pendingUsers);
    for (const team of teams) {
      if (!teamIds.has(team.id)) continue;
      for (const memberId of team.memberIds) holders.add(memberId);
    }
    const window = createdWindow(timeRange, customFrom, customTo);
    // Only the Pending others tab pages through it; the other tab reads page 0
    // for its badge count.
    const onOthersTab = pendingOthers && !pendingMe;
    // Cards scroll rather than page, so they ask for everything drawn so far.
    const cards = viewMode === 'cards';
    return {
      page: onOthersTab && !cards ? feedPage : 0,
      mutedPage: onOthersTab && !cards ? mutedPage : 0,
      pageSize: cards ? feedLimit : FEED_PAGE,
      holderIds: [...holders].sort(),
      channelIds: [...filterChannels].sort(),
      createdFrom: window && window.from > 0 ? new Date(window.from) : null,
      createdTo: window && Number.isFinite(window.to) ? new Date(window.to) : null,
    };
  }, [
    pendingUsers,
    teams,
    teamIds,
    timeRange,
    customFrom,
    customTo,
    pendingOthers,
    pendingMe,
    feedPage,
    mutedPage,
    feedLimit,
    viewMode,
    filterChannels,
  ]);
  const othersKey = JSON.stringify(othersParams);
  const othersParamsRef = useRef(othersParams);
  othersParamsRef.current = othersParams;
  const othersSeq = useRef(0);
  const othersRequestedKey = useRef<string | null>(null);
  const loadOthersPage = useCallback(async (): Promise<RadarPendingOthersPage | null> => {
    const seq = ++othersSeq.current;
    const params = othersParamsRef.current;
    othersRequestedKey.current = JSON.stringify(params);
    try {
      const data = await fetchRadarPendingOthersPage(params);
      if (seq !== othersSeq.current) return null;
      setOthersPageData(data);
      setWaiting(data.threads);
      return data;
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(
    async (background = false) => {
      const seq = ++requestSeq.current;
      const isCurrent = (): boolean => seq === requestSeq.current;
      if (!background) setLoading(true);
      try {
        // Others is two different reads, not one filtered two ways: "requested
        // by me" is the viewer's own asks, "all" is everything anyone else is
        // holding. Fetching the wrong one and narrowing it client-side would
        // silently cap the feed at whatever the other query returned.
        // Both halves, always. Skipping the unticked one saves a scan but
        // makes Me and Others fetch-scoped: ticking either would blank the
        // list to a spinner and re-download what was already in memory, when
        // it used to be a client-side view switch over feeds already held.
        const [p, w] = await Promise.all([
          fetchRadarPendingMe(),
          othersPaged ? loadOthersPage() : fetchRadarWaitingOn(),
        ]);
        if (!isCurrent()) return;
        setPending(p);
        if (!othersPaged) {
          setOthersPageData(null);
          setWaiting(w as RadarThreadCard[]);
        }
      } catch {
        if (!background && isCurrent()) {
          setPending([]);
          setWaiting([]);
        }
      } finally {
        if (!background && isCurrent()) setLoading(false);
      }
    },
    // othersMode alone: it picks which endpoint Others reads. The page and
    // filters of the paged read are taken from a ref, so changing them does not
    // re-read Pending me — the effect below fetches just the page.
    [othersPaged, loadOthersPage],
  );

  // Impression: the feed has loaded and is on screen. Resolve / dismiss / open
  // clicks below need this as their denominator. Fires once per load() — a
  // mount, a tab return, or the Refresh control — keyed on the request
  // sequence so the filter re-renders in between don't refire it.
  const feedViewedSeqRef = useRef(0);
  useEffect(() => {
    if (loading || !radarEnabled) return;
    if (feedViewedSeqRef.current === requestSeq.current) return;
    feedViewedSeqRef.current = requestSeq.current;
    const activeFilterKeys = [
      ...(pendingMe !== pendingOthers ? ['pending_on'] : []),
      ...(excludedRequesters.size ? ['requested_by'] : []),
      ...(pendingUsers.size ? ['pending_users'] : []),
      ...(teamIds.size ? ['teams'] : []),
      ...(filterChannels.size ? ['channels'] : []),
      ...(timeRange !== 'any' ? ['time_range'] : []),
    ];
    globalClickTracker.trackManualEvent('RADAR', 'RADAR_FEED_VIEWED', undefined, {
      itemCount:
        pending.reduce((n, c) => n + c.items.length, 0) +
        waiting.reduce((n, c) => n + c.items.length, 0),
      pendingMeCount: pending.reduce((n, c) => n + c.items.length, 0),
      pendingOthersCount: waiting.reduce((n, c) => n + c.items.length, 0),
      cardCount: pending.length + waiting.length,
      othersMode,
      activeFilterKeys,
      teamFilterApplied: teamIds.size > 0,
    });
  }, [
    loading,
    radarEnabled,
    pending,
    waiting,
    pendingMe,
    pendingOthers,
    excludedRequesters,
    pendingUsers,
    teamIds,
    filterChannels,
    timeRange,
    othersMode,
  ]);

  useEffect(() => {
    if (!radarEnabled) return;
    void load();
    // No timer. Each feed read is two GIN scans plus channel-ACL lookups, and
    // a poll pays that on every open tab forever — including backgrounded ones
    // nobody is reading. The feed refreshes on the events that mean "the user
    // is looking now": mount, switching tabs, returning to the window, and the
    // explicit Refresh control.
    // visibilitychange only: returning to the tab from another app fires BOTH
    // focus and visibilitychange, which sent two concurrent copies of every
    // feed request. visibilitychange alone covers tab switches and app
    // switches; the sequence guard in load() handles anything that still
    // overlaps.
    const refresh = (): void => {
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load, radarEnabled]);

  // The header tabs are exclusive; a stored "both" (or "neither") from the old
  // checkboxes opens on Pending me rather than a merged list the paged Pending
  // others feed cannot be merged into.
  useEffect(() => {
    if (pendingMe === pendingOthers) {
      setPendingMe(true);
      setPendingOthers(false);
    }
  }, [pendingMe, pendingOthers, setPendingMe, setPendingOthers]);

  // A new page or filter of Pending Others is one paged read, nothing else.
  // Skipped when load() has already asked for exactly this page.
  useEffect(() => {
    if (!radarEnabled || !othersPaged) return;
    if (othersRequestedKey.current === othersKey) return;
    void loadOthersPage();
  }, [othersKey, othersPaged, radarEnabled, loadOthersPage]);

  // A saved rule re-answers "is this muted" for every item, and only the server
  // can answer it — so a write has to be followed by a read. Keyed on the
  // version rather than on `rules`, which also moves for an optimistic write
  // the server has not accepted yet, and guarded by a ref because `load`
  // changes identity whenever a filter does and would otherwise refetch twice.
  const loadedRulesVersion = useRef(0);
  useEffect(() => {
    if (!radarEnabled || loadedRulesVersion.current === rulesVersion) return;
    loadedRulesVersion.current = rulesVersion;
    void load(true);
  }, [rulesVersion, load, radarEnabled]);

  // The people-picker ranking every other surface uses — cmd+K, the slash
  // pickers, Compose, Forward — rather than a matcher of radar's own: full-name
  // token matching, then MFU affinity, then DM recency. One call per search box
  // because a hook cannot live inside the picker, which renders conditionally.
  // A generous limit: each picker narrows the result to the ids it offers, so
  // the cap has to survive that intersection rather than bound what is drawn.
  const rankedRequesters = useRankedActivePeople(requesterSearch, RANKED_PEOPLE_LIMIT);
  const rankedHolders = useRankedActivePeople(holderSearch, RANKED_PEOPLE_LIMIT);
  const rankedTeamPeople = useRankedActivePeople(memberSearch, RANKED_PEOPLE_LIMIT);
  const rankedRulePeople = useRankedActivePeople(ruleValueSearch, RANKED_PEOPLE_LIMIT);

  /** A saved rule holds ids; naming them needs the roster the ids came from.
   *  Nobody with no rules and a closed pane pays for any of it. */
  const ruleScopesInUse = useMemo(() => {
    const scopes = new Set<RadarRuleScope>();
    for (const rule of rules) for (const c of rule.conditions) scopes.add(c.scope);
    return scopes;
  }, [rules]);
  const rulesPaneOpen = settingsSection === 'rules';
  const needChannelLabels = rulesPaneOpen || ruleScopesInUse.has('channel');
  const needGroupLabels = rulesPaneOpen || ruleScopesInUse.has('mention');

  /** A mention query wears a leading "@" — the chips teach the reader to type
   *  one, and it matches nothing, since groups are searched by name and alias. */
  const effectiveRuleQuery =
    ruleDraft.scope === 'mention'
      ? ruleValueSearch.trim().replace(/^@+/, '').trim()
      : ruleValueSearch.trim();

  const ruleGroupMatches = useUserGroupSearch(
    effectiveRuleQuery || EMPTY_GROUP_QUERY,
    RULE_VALUE_RESULTS,
  );
  // Names for saved rules, which hold an id long after the search that found it.
  // Both calls share one Zero subscription — InitialStateLoader already runs it
  // — so the sentinel query buys no fewer rows, only the sort over all of them.
  const allUserGroups = useUserGroupSearch(
    needGroupLabels ? '' : EMPTY_GROUP_QUERY,
    GROUP_NAME_LIMIT,
  );
  const ruleGroupNameById = useMemo(
    () => new Map(allUserGroups.map(g => [g.id, g.name])),
    [allUserGroups],
  );

  // Who a ticked team puts into the Others filter, and which team said so.
  // The feed has always counted these people (effectivePendingUsers); the
  // picker used to leave their row blank, so the list disagreed with what the
  // feed was actually doing.
  const lockedByTeam = useMemo(() => {
    const byId = new Map<string, string>();
    for (const team of teams) {
      if (!teamIds.has(team.id)) continue;
      for (const id of team.memberIds) if (!byId.has(id)) byId.set(id, team.name);
    }
    return byId;
  }, [teams, teamIds]);

  const channelById = useMemo(() => new Map(channels.map(c => [c.id, c])), [channels]);

  const nameOf = (userId: string): string => usersById.get(userId)?.name ?? 'Someone';

  const isDirectMessage = (scopeType: string | null | undefined): boolean =>
    scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;

  const channelLabel = (channelId: string): string => {
    const channel = channelById.get(channelId);
    if (!channel) return '#thread';
    if (isDirectMessage(channel.scopeType)) return 'Direct message';
    return `#${channel.name}`;
  };

  // Filter list needs DMs told apart: name the counterpart(s) when the DM
  // channel's name is the participant id list (how seeds store them).
  const filterChannelLabel = (channelId: string): string => {
    const channel = channelById.get(channelId);
    if (!channel) return '#thread';
    if (isDirectMessage(channel.scopeType)) {
      const me = localStorage.getItem('user_id');
      const ids = (channel.name ?? '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
      const others = ids
        .filter(id => id !== me && usersById.has(id))
        .map(id => usersById.get(id)?.name ?? '');
      if (others.length) return others.join(', ');
      if (me && ids.includes(me)) return `${nameOf(me)} (you)`;
      return 'Direct message';
    }
    return `#${channel.name}`;
  };

  // Every channel in cmd+K's own shape — the channel, the participant names to
  // render, and the wider set to search. getDMNames is the canonical resolver
  // for both, so a DM is named here exactly as the command menu names it.
  // Subscribed for the effect, not the value: affinity weights are read
  // imperatively inside the ranking helpers, so a fetch landing after mount is
  // invisible until something re-renders — and subscribing is what starts that
  // fetch in the first place.
  useAffinityCallback();

  // Every channel in cmd+K's own shape, but only for a reader who has a channel
  // rule or is writing one: getDMNames resolves participant names for the whole
  // channel list, and that is not work to do on every Radar open for a pane
  // nobody touched.
  const ruleChannelItems = useMemo(() => {
    if (!needChannelLabels) return [];
    // Read here rather than through selfId, which is declared further down;
    // this memo has to sit above filterChannelLabel's other readers.
    const me = localStorage.getItem('user_id') ?? '';
    return channels.map(channel => {
      const names = getDMNames(channel, me, usersById);
      return { channel, searchableNames: names.display, searchNames: names.search };
    });
  }, [channels, usersById, needChannelLabels]);

  // Channel id → the label it renders to, and each label → every id behind it.
  // Several channels can render to one label, so the picker offers one row per
  // label and writes every id under it: the rule then means what the row said,
  // and the server compares ids without having to resolve a name of its own.
  const { labelByChannelId, idsByChannelLabel } = useMemo(() => {
    const byId = new Map<string, string>();
    const byLabel = new Map<string, string[]>();
    for (const item of ruleChannelItems) {
      const label = formatChannelLabel(item);
      byId.set(item.channel.id, label);
      const ids = byLabel.get(label);
      if (ids) ids.push(item.channel.id);
      else byLabel.set(label, [item.channel.id]);
    }
    return { labelByChannelId: byId, idsByChannelLabel: byLabel };
  }, [ruleChannelItems]);

  /** A channel value's label, falling back to the id when the channel is gone
   *  — so a rule written against a since-deleted channel still reads as
   *  something rather than as a blank chip. */
  const ruleChannelLabel = useCallback(
    (channelId: string): string => labelByChannelId.get(channelId) ?? channelId,
    [labelByChannelId],
  );

  // The conversation is the ITEM's, not the card's: a DM card groups the whole
  // channel, so its items live in different threads and each has to open its own.
  const openThread = (card: RadarThreadCard, conversationId: string, messageId?: string) => {
    const path = `/chat/dir/radar/${card.channelId}/${conversationId}`;
    void navigate(messageId ? `${path}#origin=${conversationId}&messageId=${messageId}` : path);
  };

  const openOnClick = (open: () => void) => ({
    role: 'button',
    tabIndex: 0,
    // Bubble-phase, and only after opening: a nested target has to be able to
    // handle its own click before it stops reaching the card behind it.
    // Click bubbles from whatever was actually clicked — usually a child span —
    // so it must not be filtered on target; nested buttons stop propagation
    // themselves. Enter is different: without the target guard the card cancels
    // the keypress meant for a button inside it.
    onClick: (e: MouseEvent<HTMLElement>) => {
      e.stopPropagation();
      open();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        open();
      }
    },
  });

  const withBusy = async (key: string, fn: () => Promise<unknown>) => {
    setBusyKey(key);
    try {
      await fn();
      await load(true);
    } finally {
      setBusyKey(null);
    }
  };

  const cardUsers = (card: RadarThreadCard): string[] => [
    ...new Set(card.items.flatMap(i => [...i.requestedBy, ...i.pendingOn])),
  ];

  const selfId = localStorage.getItem('user_id');

  // Mock-style meta line: waiting cards say who the ball is with; pending
  // cards say who asked and who holds it.
  /** Compact age: 8m, 5h, 3d, 2w. Long enough to place a card, short enough to
   *  never be the reason the channel gets truncated. */
  const shortAgoFrom = (latest: number): string => {
    if (!latest) return '';
    const mins = Math.max(0, Math.round((Date.now() - latest) / 60000));
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.round(mins / 60)}h`;
    const days = Math.round(mins / 1440);
    return days < 14 ? `${days}d` : `${Math.round(days / 7)}w`;
  };

  const shortAgo = (card: RadarThreadCard): string =>
    shortAgoFrom(
      card.items.reduce(
        (max, i) => Math.max(max, new Date(i.updatedAt).getTime()),
        card.lastActivityAt ? new Date(card.lastActivityAt).getTime() : 0,
      ),
    );

  const shortAgoItem = (item: RadarFeedItem): string =>
    shortAgoFrom(new Date(item.updatedAt).getTime());

  // Some threads' preview/title text is a raw `:::initialMessage ... :::`
  // metadata block (a forwarded message's carrier format, meant to be parsed
  // before display, never shown as-is) rather than the human text it wraps.
  // Unwrap it to that real content when present.
  const cleanText = (text: string): string => {
    if (!text.trimStart().startsWith(':::initialMessage')) return text;
    const parsed = parseInitialMessageMd(text);
    return parsed?.content || text;
  };

  // The card's headline: what a reader scans first. Falls back through the
  // thread preview to the lead item's own title so a card never renders
  // blank above the numbered list.
  const threadTitle = (card: RadarThreadCard): string => {
    // threadPreview is truncated to a single line server-side, so when the
    // source message itself was a `:::initialMessage` block, the truncated
    // copy never reaches the closing `:::` — cleanText can't parse a block
    // it can't fully see, and hands the raw marker text back unchanged.
    // That's worse than no preview: fall through to the item's own title,
    // which is never truncated mid-block.
    const cleaned = card.threadPreview && cleanText(card.threadPreview);
    if (cleaned && !cleaned.trimStart().startsWith(':::initialMessage')) return cleaned;
    return cleanText(card.items[0]?.title || 'Thread');
  };

  const cardMeta = (card: RadarThreadCard): string =>
    [channelLabel(card.channelId), shortAgo(card)].filter(Boolean).join(' · ');

  // Cards can mix both kinds when viewing the merged feed, so each one still
  // names its side. The table view dropped this — every row there already
  // sits under an exclusive Pending me / Pending others tab, so it would
  // only ever repeat the tab you're already on.
  const badge = (kind: 'pending' | 'waiting', count: number) => (
    <span
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
        kind === 'pending' ? 'bg-[#e8604c]/10 text-[#e8604c]' : 'bg-muted text-muted-foreground',
      )}
    >
      {kind === 'pending' ? <Zap className='size-3' /> : <Hourglass className='size-3' />}
      {kind === 'pending' ? 'Pending Me' : 'Pending Others'}
      {count > 1 ? ` (${count} Items)` : ''}
    </span>
  );

  // "Me" reads faster than your own name in a list of other people's.
  const selfAwareName = (userId: string): string => (userId === selfId ? 'Me' : nameOf(userId));

  // First holder / first requester, or null. Indexing is checked under the
  // dashboard's tsconfig, so the lookup is bound once rather than re-indexed
  // behind a length test the compiler cannot use to narrow.
  const holderOf = (item: RadarFeedItem): string | null => item.pendingOn[0] ?? null;
  const requesterOf = (item: RadarFeedItem): string | null => item.requestedBy[0] ?? null;

  // Shared by the card and table item rows: title, source-message bullet, and
  // who it's pending on. Every consumer supplies its own wrapper element and
  // spacing — this owns content only. showPendingOn is off in the table,
  // where Pending On is already its own column — repeating it inline here
  // would be the row saying the same thing twice.
  const itemMainBlock = (
    card: RadarThreadCard,
    item: RadarFeedItem,
    index: number,
    showPendingOn = true,
  ) => (
    <>
      <button
        data-track-category='RADAR'
        data-track-name='OPEN_THREAD_FROM_ITEM'
        className={cn(
          'text-left text-foreground',
          // The table drops the inline pending-on line, and with it the
          // card's heavy headline weight and the hover underline.
          showPendingOn ? 'font-bold text-[15px] hover:underline' : 'font-medium text-sm',
        )}
        onClick={e => {
          e.stopPropagation();
          openThread(card, item.conversationId, item.sourceMessageId);
        }}
      >
        {index + 1}. {cleanText(item.title)}
      </button>
      {item.contextSummary && (
        <ul className='mt-2 space-y-1'>
          {/* The bullet opens the message that produced this item, not the
              top of the thread — on a card of several items they are
              different places. */}
          <li
            className='group/bullet flex items-start gap-2 text-sm text-muted-foreground rounded cursor-pointer hover:text-foreground'
            data-track-category='RADAR'
            data-track-name='OPEN_SOURCE_MESSAGE'
            {...openOnClick(() => openThread(card, item.conversationId, item.sourceMessageId))}
          >
            <span className='mt-[7px] size-1 rounded-full bg-muted-foreground shrink-0' />
            <span>{item.contextSummary}</span>
          </li>
        </ul>
      )}
      {/* Who this item is actually pending on — the card-level avatar
          stack up top says who's involved across every item; this says
          which one of them is holding this one. */}
      {showPendingOn && holderOf(item) && (
        <div className='mt-2 flex items-center gap-1.5'>
          <Avatar userId={holderOf(item)} size='xs' className='shrink-0 rounded-full' />
          <span className='text-xs font-medium text-muted-foreground'>
            {selfAwareName(holderOf(item)!)}
            {item.pendingOn.length > 1 ? ` +${item.pendingOn.length - 1}` : ''}
          </span>
        </div>
      )}
    </>
  );

  // Resolve / Dismiss, shared by the card and table item rows.
  const itemActions = (card: RadarThreadCard, item: RadarFeedItem, compact = false) => {
    // The table shows these as bare icons on row hover; cards keep the pills.
    const actionClass = compact
      ? 'inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50'
      : 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50';
    const itemKey = `item:${item.id}`;
    const dismissKey = `dismiss:${item.id}`;
    // Same dimensions on open / resolve / dismiss so the three can be compared
    // per item age and per side of the ledger. Ids only — no title text.
    const itemTrackMetadata = JSON.stringify({
      itemId: item.id,
      channelId: card.channelId,
      itemAgeHours: Math.max(
        0,
        Math.round((Date.now() - new Date(item.createdAt).getTime()) / 3_600_000),
      ),
      isPendingMe: !!selfId && item.pendingOn.includes(selfId),
      isRequestedByMe: !!selfId && item.requestedBy.includes(selfId),
      itemsOnCard: card.items.length,
    });
    return (
      <>
        {/* Resolve closes the item for everyone, so it is offered only to
            the people who asked for it — matching the parser's own rule
            that a requester's confirmation is what closes an item. */}
        {selfId && (item.requestedBy.includes(selfId) || item.pendingOn.includes(selfId)) ? (
          <Tooltip content='Mark this item done' className='px-2 py-1 text-[11px]'>
            <button
              data-track-category='RADAR'
              data-track-name='RESOLVE_ITEM'
              data-track-metadata={itemTrackMetadata}
              aria-label='Resolve'
              className={actionClass}
              disabled={busyKey === itemKey}
              onClick={e => {
                e.stopPropagation();
                void withBusy(itemKey, () => resolveRadarItem(item.id));
              }}
            >
              {busyKey === itemKey ? (
                <Loader2 className='size-3.5 animate-spin' />
              ) : (
                <Check className='size-3.5' />
              )}
              {!compact && 'Resolve'}
            </button>
          </Tooltip>
        ) : (
          compact && <span aria-hidden className='size-7 shrink-0' />
        )}
        {selfId && item.pendingOn.includes(selfId) ? (
          <Tooltip content='Remove from my list' className='px-2 py-1 text-[11px]'>
            <button
              data-track-category='RADAR'
              data-track-name='DISMISS_ITEM'
              data-track-metadata={itemTrackMetadata}
              aria-label='Dismiss'
              className={actionClass}
              disabled={busyKey === dismissKey}
              onClick={e => {
                e.stopPropagation();
                void withBusy(dismissKey, () => dismissRadarItem(item.id));
              }}
            >
              {busyKey === dismissKey ? (
                <Loader2 className='size-3.5 animate-spin' />
              ) : (
                <X className='size-3.5' />
              )}
              {!compact && 'Dismiss'}
            </button>
          </Tooltip>
        ) : (
          compact && <span aria-hidden className='size-7 shrink-0' />
        )}
      </>
    );
  };

  const renderItemBody = (card: RadarThreadCard, item: RadarFeedItem, index: number | null) => {
    const itemKey = `item:${item.id}`;
    const dismissKey = `dismiss:${item.id}`;
    // Same dimensions on open / resolve / dismiss so the three can be compared
    // per item age and per side of the ledger. Ids only — no title text.
    const itemTrackMetadata = JSON.stringify({
      itemId: item.id,
      channelId: card.channelId,
      itemAgeHours: Math.max(
        0,
        Math.round((Date.now() - new Date(item.createdAt).getTime()) / 3_600_000),
      ),
      isPendingMe: !!selfId && item.pendingOn.includes(selfId),
      isRequestedByMe: !!selfId && item.requestedBy.includes(selfId),
      itemsOnCard: card.items.length,
    });
    return (
      <div
        key={item.id}
        className={cn('group flex items-start gap-3', index !== null && index > 0 && 'mt-5')}
      >
        <div className='flex-1 min-w-0'>
          <button
            data-track-category='RADAR'
            data-track-name='OPEN_THREAD_FROM_ITEM'
            data-track-metadata={itemTrackMetadata}
            className='text-left font-bold text-foreground hover:underline text-[15px]'
            onClick={e => {
              e.stopPropagation();
              openThread(card, item.conversationId, item.sourceMessageId);
            }}
          >
            {index !== null ? `${index + 1}. ${item.title}` : item.title}
          </button>
          {item.contextSummary && (
            <ul className='mt-2 space-y-1'>
              {/* The bullet opens the message that produced this item, not the
                  top of the thread — on a card of several items they are
                  different places. */}
              <li
                className='group/bullet flex items-start gap-2 text-sm text-muted-foreground rounded cursor-pointer hover:text-foreground'
                data-track-category='RADAR'
                data-track-name='OPEN_SOURCE_MESSAGE'
                {...openOnClick(() => openThread(card, item.conversationId, item.sourceMessageId))}
              >
                <span className='mt-[7px] size-1 rounded-full bg-muted-foreground shrink-0' />
                <span>{item.contextSummary}</span>
              </li>
            </ul>
          )}
        </div>
        <span className='flex items-center gap-1.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'>
          {/* Resolve closes the item for everyone, so it is offered only to
              the people who asked for it — matching the parser's own rule
              that a requester's confirmation is what closes an item. */}
          {selfId && (item.requestedBy.includes(selfId) || item.pendingOn.includes(selfId)) && (
            <Tooltip content='Mark this item done' className='px-2 py-1 text-[11px]'>
              <button
                data-track-category='RADAR'
                data-track-name='RESOLVE_ITEM'
                data-track-metadata={itemTrackMetadata}
                className='inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50'
                disabled={busyKey === itemKey}
                onClick={e => {
                  e.stopPropagation();
                  void withBusy(itemKey, () => resolveRadarItem(item.id));
                }}
              >
                {busyKey === itemKey ? (
                  <Loader2 className='size-3.5 animate-spin' />
                ) : (
                  <Check className='size-3.5' />
                )}
                Resolve
              </button>
            </Tooltip>
          )}
          {selfId && item.pendingOn.includes(selfId) && (
            <Tooltip content='Remove from my list' className='px-2 py-1 text-[11px]'>
              <button
                data-track-category='RADAR'
                data-track-name='DISMISS_ITEM'
                data-track-metadata={itemTrackMetadata}
                className='inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50'
                disabled={busyKey === dismissKey}
                onClick={e => {
                  e.stopPropagation();
                  void withBusy(dismissKey, () => dismissRadarItem(item.id));
                }}
              >
                {busyKey === dismissKey ? (
                  <Loader2 className='size-3.5 animate-spin' />
                ) : (
                  <X className='size-3.5' />
                )}
                Dismiss
              </button>
            </Tooltip>
          )}
        </span>
      </div>
    );
  };

  // The card's "⋯" bulk menu: Resolve all / Dismiss all.
  const threadMenu = (card: RadarThreadCard, key: string) => {
    const busy = busyKey === key;
    const menuOpen = cardMenu === key;
    const dismissable = selfId ? card.items.filter(i => i.pendingOn.includes(selfId)).length : 0;
    const resolvable = selfId
      ? card.items.filter(i => i.requestedBy.includes(selfId) || i.pendingOn.includes(selfId))
          .length
      : 0;
    return (
      <span className='relative'>
        {menuOpen && (
          <button
            type='button'
            aria-label='Close menu'
            className='fixed inset-0 z-30 cursor-default'
            data-track-category='RADAR'
            data-track-name='CLOSE_CARD_MENU'
            onClick={() => setCardMenu(null)}
          />
        )}
        <button
          className={cn(
            'flex items-center justify-center size-8 rounded-full border border-border transition-colors',
            menuOpen
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
          aria-haspopup='menu'
          aria-expanded={menuOpen}
          aria-label='Bulk actions for this thread'
          disabled={busy}
          data-track-category='RADAR'
          data-track-name='TOGGLE_CARD_MENU'
          onClick={e => {
            e.stopPropagation();
            setCardMenu(open => (open === key ? null : key));
          }}
        >
          {busy ? (
            <Loader2 className='size-4 animate-spin' />
          ) : (
            <MoreHorizontal className='size-4' />
          )}
        </button>
        {menuOpen && (
          <div
            role='menu'
            className='absolute right-0 top-full mt-1.5 z-40 w-64 rounded-xl border border-border bg-popover text-popover-foreground shadow-lg py-1'
          >
            {resolvable > 0 && (
              <button
                role='menuitem'
                className='w-full flex flex-col items-start gap-0.5 text-left px-3 py-2 hover:bg-accent'
                data-track-category='RADAR'
                data-track-name='RESOLVE_ALL_ITEMS'
                onClick={() => {
                  setCardMenu(null);
                  void withBusy(key, () => resolveAllRadarItems(card.scopeKey));
                }}
              >
                <span className='flex items-center gap-2 text-sm font-medium'>
                  <Check className='size-4' />
                  Resolve all ({resolvable})
                </span>
                <span className='pl-6 text-xs text-muted-foreground'>
                  Marks these done and closes them for everyone.
                </span>
              </button>
            )}
            {dismissable > 0 && (
              <button
                role='menuitem'
                className='w-full flex flex-col items-start gap-0.5 text-left px-3 py-2 hover:bg-accent'
                data-track-category='RADAR'
                data-track-name='DISMISS_ALL_ITEMS'
                onClick={() => {
                  setCardMenu(null);
                  void withBusy(key, () => dismissAllRadarItems(card.scopeKey));
                }}
              >
                <span className='flex items-center gap-2 text-sm font-medium'>
                  <X className='size-4' />
                  Dismiss all ({dismissable})
                </span>
                <span className='pl-6 text-xs text-muted-foreground'>
                  Clears these from your Radar without replying.
                </span>
              </button>
            )}
          </div>
        )}
      </span>
    );
  };

  const renderCard = (card: RadarThreadCard, kind: 'pending' | 'waiting') => {
    const key = `${kind}:${card.scopeKey}`;
    const multi = card.items.length > 1;
    const dismissable = selfId ? card.items.filter(i => i.pendingOn.includes(selfId)).length : 0;
    const resolvable = selfId
      ? card.items.filter(i => i.requestedBy.includes(selfId) || i.pendingOn.includes(selfId))
          .length
      : 0;
    const involved = cardUsers(card);
    const involvedNames = involved.map(nameOf).join(', ');

    return (
      <div
        key={key}
        className={cn(
          'relative group/card rounded-2xl border border-border bg-card text-card-foreground border-l-[3px] border-l-[#e8604c] shadow-sm',
          !multi && 'cursor-pointer',
        )}
        {...(multi
          ? {}
          : {
              'data-track-category': 'RADAR',
              'data-track-name': 'OPEN_THREAD_FROM_CARD',
              ...openOnClick(() =>
                openThread(
                  card,
                  card.items[0]?.conversationId ?? card.conversationId,
                  card.items[0]?.sourceMessageId,
                ),
              ),
            })}
      >
        <div className='px-6 pt-5 flex items-center gap-3'>
          {badge(kind, card.items.length)}
          <span
            className='relative flex -space-x-1.5 group/avatars'
            aria-label={`Involved: ${involvedNames}`}
          >
            {involved.slice(0, AVATARS_SHOWN).map(id => (
              <Avatar
                key={id}
                userId={id}
                size='sm'
                className='shrink-0 rounded-lg ring-2 ring-card'
              />
            ))}
            {involved.length > AVATARS_SHOWN && (
              <span className='size-6 rounded-full bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center ring-2 ring-card'>
                +{involved.length - AVATARS_SHOWN}
              </span>
            )}
            {/* Initials alone don't say who these people are — name them on
                hover. Styled rather than a native title so it appears without
                the browser's ~1s delay and matches the rest of the panel.
                Width is capped and wrapping left on: a thread with nine
                participants produced a 754px single-line tooltip that ran off
                the right edge of the viewport. */}
            <span
              aria-hidden='true'
              className='pointer-events-none absolute left-0 top-full z-50 mt-1.5 hidden w-max max-w-64 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs font-medium leading-relaxed text-popover-foreground shadow-lg group-hover/avatars:block'
            >
              {involvedNames}
            </span>
          </span>
          <span className='text-sm text-muted-foreground truncate'>{cardMeta(card)}</span>
          {/* Both bulk verbs live behind the overflow menu: each one acts on
            every item at once, which is not something to put a stray click
            away from the per-item buttons directly above it. */}
          {multi && (dismissable > 0 || resolvable > 0) && (
            <span className='ml-auto flex items-center'>{threadMenu(card, key)}</span>
          )}
        </div>

        <div className='px-6 pt-4 pb-5'>
          {card.items.map((item, i) => renderItemBody(card, item, multi ? i : null))}
        </div>
        <button
          data-track-category='RADAR'
          data-track-name='OPEN_THREAD_DEBUG'
          title="This thread's entire run history"
          className='absolute bottom-2.5 right-3 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100'
          onClick={e => {
            e.stopPropagation();
            openThreadDebug(card);
          }}
        >
          <Bug className='size-3.5' />
          Debug
        </button>
      </div>
    );
  };

  // Table view's columns — shared by the header and every item row so they
  // line up. Each tab drops the person column that would only ever say "Me":
  // Pending me hides Pending on, Pending others hides Asked by.
  const tableShowsAskedBy = (): boolean => tab !== 'waiting';
  const tableShowsPendingOn = (): boolean => tab !== 'pending';
  const tableGrid = (): string =>
    tableShowsAskedBy() && tableShowsPendingOn()
      ? 'grid min-w-[860px] grid-cols-[minmax(240px,1fr)_120px_130px_130px_56px_64px] gap-x-4 px-5'
      : 'grid min-w-[724px] grid-cols-[minmax(240px,1fr)_120px_140px_56px_64px] gap-x-4 px-5';
  const tableMinWidth = (): string =>
    tableShowsAskedBy() && tableShowsPendingOn() ? 'min-w-[862px]' : 'min-w-[726px]';
  // Item titles and the Item header sit under the thread title, past the
  // thread row's chevron (16px icon + 8px gap).
  const TABLE_ITEM_INDENT = 'pl-6';

  // A small "avatar + name" display, shared by the Asked-by and Pending-on
  // cells.
  const personCell = (userId: string, extra: number) => (
    <span className='flex items-center gap-1.5 min-w-0'>
      <Avatar userId={userId} size='xs' className='shrink-0 rounded-full' />
      <span className='text-sm text-muted-foreground truncate'>
        {selfAwareName(userId)}
        {extra > 0 ? ` +${extra}` : ''}
      </span>
    </span>
  );

  const renderTableItemRow = (card: RadarThreadCard, item: RadarFeedItem, index: number) => (
    <div key={item.id} className={cn(tableGrid(), 'group items-start py-3 hover:bg-accent/40')}>
      <div className={cn('min-w-0', TABLE_ITEM_INDENT)}>
        {itemMainBlock(card, item, index, false)}
      </div>
      <div className='min-w-0 pt-0.5'>
        <span className='block text-sm text-muted-foreground truncate'>
          {channelLabel(card.channelId)}
        </span>
      </div>
      {tableShowsAskedBy() && (
        <div className='min-w-0 pt-0.5'>
          {requesterOf(item) && personCell(requesterOf(item)!, item.requestedBy.length - 1)}
        </div>
      )}
      {tableShowsPendingOn() && (
        <div className='min-w-0 pt-0.5'>
          {holderOf(item) && personCell(holderOf(item)!, item.pendingOn.length - 1)}
        </div>
      )}
      <div className='pt-0.5 text-right text-sm text-muted-foreground'>{shortAgoItem(item)}</div>
      {/* Unlabelled last column: Resolve / Dismiss, shown while the row is
          hovered or focused. */}
      <div className='flex items-start justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'>
        {itemActions(card, item, true)}
      </div>
    </div>
  );

  // Resolve all / Dismiss all at the right of a thread's title row, shown while it is
  // hovered. Each counts only the items the viewer may act on, matching the
  // per-row buttons.
  const threadBulkActions = (card: RadarThreadCard, key: string) => {
    const dismissable = selfId ? card.items.filter(i => i.pendingOn.includes(selfId)).length : 0;
    const resolvable = selfId
      ? card.items.filter(i => i.requestedBy.includes(selfId) || i.pendingOn.includes(selfId))
          .length
      : 0;
    const busy = busyKey === key;
    // Same bare icons as the item rows' Resolve / Dismiss, so the thread row
    // reads as their "all" version.
    const icon =
      'inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50';
    if (resolvable === 0 && dismissable === 0) return null;
    return (
      <span
        className={cn(
          'ml-auto flex items-center gap-1 shrink-0 transition-opacity',
          busy
            ? 'opacity-100'
            : 'opacity-0 group-hover/thread:opacity-100 focus-within:opacity-100',
        )}
      >
        {resolvable > 0 ? (
          <Tooltip content='Resolve all' className='px-2 py-1 text-[11px]'>
            <button
              className={icon}
              aria-label='Resolve all'
              disabled={busy}
              data-track-category='RADAR'
              data-track-name='RESOLVE_ALL_ITEMS'
              onClick={() => void withBusy(key, () => resolveAllRadarItems(card.scopeKey))}
            >
              {busy ? (
                <Loader2 className='size-3.5 animate-spin' />
              ) : (
                <Check className='size-3.5' />
              )}
            </button>
          </Tooltip>
        ) : (
          <span aria-hidden className='size-7 shrink-0' />
        )}
        {dismissable > 0 ? (
          <Tooltip content='Dismiss all' className='px-2 py-1 text-[11px]'>
            <button
              className={icon}
              aria-label='Dismiss all'
              disabled={busy}
              data-track-category='RADAR'
              data-track-name='DISMISS_ALL_ITEMS'
              onClick={() => void withBusy(key, () => dismissAllRadarItems(card.scopeKey))}
            >
              <X className='size-3.5' />
            </button>
          </Tooltip>
        ) : (
          <span aria-hidden className='size-7 shrink-0' />
        )}
      </span>
    );
  };

  const renderTableGroup = (card: RadarThreadCard, kind: 'pending' | 'waiting') => {
    const collapsed = collapsedGroups.has(card.scopeKey);
    const key = `table:${kind}:${card.scopeKey}`;
    return (
      <div key={key} className='border-b border-border last:border-b-0'>
        <div className='group/thread flex items-center gap-2 px-5 py-2 bg-muted/30'>
          <button
            className='flex items-center justify-center size-4 shrink-0 rounded text-muted-foreground hover:text-foreground transition-colors'
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand thread' : 'Collapse thread'}
            data-track-category='RADAR'
            data-track-name='TOGGLE_TABLE_GROUP'
            onClick={() =>
              setCollapsedGroups(prev => {
                const next = new Set(prev);
                if (next.has(card.scopeKey)) next.delete(card.scopeKey);
                else next.add(card.scopeKey);
                return next;
              })
            }
          >
            <ChevronDown className={cn('size-4 transition-transform', collapsed && '-rotate-90')} />
          </button>
          {/* Only the title opens the thread — matching the item rows below,
              where a row is never a single giant click target either. */}
          <button
            className='min-w-0 font-semibold text-foreground text-sm truncate text-left'
            data-track-category='RADAR'
            data-track-name='OPEN_THREAD_FROM_TABLE_GROUP'
            onClick={() =>
              openThread(
                card,
                card.items[0]?.conversationId ?? card.conversationId,
                card.items[0]?.sourceMessageId,
              )
            }
          >
            {threadTitle(card)}
          </button>
          {threadBulkActions(card, key)}
        </div>
        {!collapsed && card.items.map((item, i) => renderTableItemRow(card, item, i))}
      </div>
    );
  };

  const tableHeader = () => (
    <div
      className={cn(
        tableGrid(),
        'items-center py-2 rounded-t-2xl text-[11px] font-semibold tracking-wide text-muted-foreground uppercase border-b border-border',
      )}
    >
      <span className={TABLE_ITEM_INDENT}>Item</span>
      <span>Channel</span>
      {tableShowsAskedBy() && <span>Asked by</span>}
      {tableShowsPendingOn() && <span>Pending on</span>}
      <span className='text-right'>Updated</span>
      <span />
    </div>
  );

  // Neither box ticked reads the same as both: no narrowing.
  const tab: RadarTab = pendingMe === pendingOthers ? 'all' : pendingMe ? 'pending' : 'waiting';
  // On the Pending others tab with the paged feed, what arrived is already the
  // filtered page — the in-browser filters and paging stand aside.
  const othersFromServer = tab === 'waiting' && othersPaged && othersPageData !== null;

  // Each half is narrowed on its own feed before the two are merged. The
  // requester picker describes who has asked ME, the holder picker describes
  // who is holding THEIR items, and neither has anything to say about the
  // other half's cards — filtering after the merge needed a guard on every
  // predicate to keep it from eating the other feed. The facets are drawn from
  // the raw feeds for the same reason, plus anything already ticked, so a name
  // that drops out of a refetched feed stays on screen to untick.
  // Anything excluded stays listed even when the user store has no row for it
  // — a deleted account, or an id from another workspace. It renders as
  // "Someone", which is worth more than an exclusion that hides cards with
  // nothing on screen to switch it back off.
  const requesterOptions = [
    ...new Set([
      ...pending.flatMap(c => c.items.flatMap(i => i.requestedBy)).filter(id => usersById.has(id)),
      ...excludedRequesters,
    ]),
  ];
  const otherHolders = [
    ...new Set([
      ...(othersPageData
        ? othersPageData.facets.holderIds
        : waiting.flatMap(c => c.items.flatMap(i => i.pendingOn))),
      ...pendingUsers,
      // A ticked team's members, so the row they are ticked on exists even
      // when they hold nothing in the current feed.
      ...lockedByTeam.keys(),
    ]),
  ].filter(id => id !== selfId && usersById.has(id));

  // Requesters are excluded, never included: "everyone but Bob" has to keep
  // meaning everyone as new people ask, which a stored list of who is in can
  // never do. An item with no requester on record is nobody's to exclude.
  const pendingCards =
    pendingMe && excludedRequesters.size
      ? pending.filter(card =>
          card.items.some(
            i =>
              i.requestedBy.length === 0 || i.requestedBy.some(id => !excludedRequesters.has(id)),
          ),
        )
      : pending;

  // A ticked team is shorthand for its members, so team and person selections
  // union rather than intersect: picking Platform Pod and then one more name
  // widens the list by that name, it does not narrow the pod to them.
  const effectivePendingUsers = new Set(pendingUsers);
  for (const team of teams) {
    if (!teamIds.has(team.id)) continue;
    for (const memberId of team.memberIds) effectivePendingUsers.add(memberId);
  }
  const waitingCards =
    pendingOthers && effectivePendingUsers.size && !othersFromServer
      ? waiting.filter(card =>
          card.items.some(i => i.pendingOn.some(id => effectivePendingUsers.has(id))),
        )
      : waiting;

  // Merged on activity, not concatenated. Each feed arrives sorted, but
  // stacking them puts every card of mine above every card of theirs — a
  // minute-old ask sat below an eight-day-old one purely for being someone
  // else's.
  const cardActivity = (card: RadarThreadCard): number =>
    card.items.reduce(
      (max, i) => Math.max(max, new Date(i.updatedAt).getTime()),
      card.lastActivityAt ? new Date(card.lastActivityAt).getTime() : 0,
    );

  let cards: Array<{ card: RadarThreadCard; kind: 'pending' | 'waiting' }> = [
    ...(tab !== 'waiting' ? pendingCards.map(card => ({ card, kind: 'pending' as const })) : []),
    ...(tab !== 'pending' ? waitingCards.map(card => ({ card, kind: 'waiting' as const })) : []),
  ].sort((a, b) => cardActivity(b.card) - cardActivity(a.card));

  // Time is left out on purpose: a channel holding nothing in the current
  // range is still worth offering. Channel too, or the list would shrink to
  // the one option already ticked.
  const channelFacet = new Set(
    othersFromServer && othersPageData
      ? othersPageData.facets.channelIds
      : cards.map(c => c.card.channelId),
  );

  const clientTimeWindow = othersFromServer ? null : createdWindow(timeRange, customFrom, customTo);
  if (clientTimeWindow) {
    // When the item was raised, not when the thread was last touched: a
    // months-old ask does not become recent because someone replied today.
    const createdOf = (card: RadarThreadCard): number =>
      card.items.reduce((min, i) => Math.min(min, new Date(i.createdAt).getTime()), Infinity);
    const { from, to } = clientTimeWindow;
    cards = cards.filter(({ card }) => {
      const t = createdOf(card);
      return Number.isFinite(t) && t >= from && t <= to;
    });
  }

  if (filterChannels.size && !othersFromServer) {
    cards = cards.filter(({ card }) => filterChannels.has(card.channelId));
  }
  // The server has already said which items this viewer's rules mute; the panel
  // only places them. Nothing is dropped — a rule written too wide stays
  // findable by whoever wrote it. A card whose items disagree is split, because
  // a card is not a unit of attention; the asks inside it are.
  const mutedCards: typeof cards = [];
  let mutedItemCount = 0;
  {
    const live: typeof cards = [];
    // Runs on every render over up to MAX_FEED_ITEMS, so the common case — no
    // rule claims anything — passes the card through and allocates nothing.
    for (const entry of cards) {
      if (!entry.card.items.some(i => i.muted)) {
        live.push(entry);
        continue;
      }
      const kept = entry.card.items.filter(i => !i.muted);
      const hushed = entry.card.items.filter(i => i.muted);
      const split = (items: typeof entry.card.items): (typeof cards)[number] => ({
        ...entry,
        card: { ...entry.card, items },
      });
      if (kept.length > 0) live.push(split(kept));
      mutedCards.push(split(hushed));
      mutedItemCount += hushed.length;
    }
    cards = live;
  }
  if (othersFromServer && othersPageData) {
    // The server split its page the same way; its muted half is its own page.
    mutedCards.splice(
      0,
      mutedCards.length,
      ...othersPageData.mutedThreads.map(card => ({ card, kind: 'waiting' as const })),
    );
    mutedItemCount = othersPageData.mutedItemCount;
  }

  // A new filter or tab is a different list, so it starts from the first page.
  // A refresh of the same list deliberately does not: the reader may be deep
  // in it, and collapsing back to one page under them would lose their place.
  useEffect(() => {
    setFeedPage(0);
    setMutedPage(0);
    setFeedLimit(CARDS_PAGE);
  }, [
    tab,
    pendingUsers,
    teamIds,
    excludedRequesters,
    othersMode,
    filterChannels,
    timeRange,
    customFrom,
    customTo,
    // A rule changes which items are in the list at all, so it starts over
    // for the same reason a filter does.
    rules,
  ]);

  // Resolving or dismissing can empty the last page; fall back to the new
  // last page rather than showing an empty one.
  // A server page arrives already cut to size; its totals come with it.
  const feedTotal = othersFromServer && othersPageData ? othersPageData.totalThreads : cards.length;
  const mutedTotal =
    othersFromServer && othersPageData ? othersPageData.mutedTotalThreads : mutedCards.length;
  const feedPageCount = Math.max(1, Math.ceil(feedTotal / FEED_PAGE));
  const mutedPageCount = Math.max(1, Math.ceil(mutedTotal / FEED_PAGE));
  const safeFeedPage = Math.min(feedPage, feedPageCount - 1);
  const safeMutedPage = Math.min(mutedPage, mutedPageCount - 1);
  const feedSlice = othersFromServer
    ? cards
    : cards.slice(safeFeedPage * FEED_PAGE, (safeFeedPage + 1) * FEED_PAGE);
  const mutedSlice = othersFromServer
    ? mutedCards
    : mutedCards.slice(safeMutedPage * FEED_PAGE, (safeMutedPage + 1) * FEED_PAGE);

  // Cards only: the sentinel sits after the last drawn card and is rendered
  // only while there is more to draw. On the paged feed "more" means the
  // server said so, and growing feedLimit re-reads a longer page.
  const moreToDraw = othersFromServer
    ? feedLimit < feedTotal || (mutedOpen && feedLimit < mutedTotal)
    : feedLimit < cards.length || (mutedOpen && feedLimit < mutedCards.length);
  useEffect(() => {
    if (viewMode !== 'cards') return;
    const sentinel = feedEndRef.current;
    if (!sentinel || !moreToDraw) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) setFeedLimit(n => n + CARDS_PAGE);
      },
      { rootMargin: '600px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [moreToDraw, feedLimit, viewMode]);

  const renderPager = (
    page: number,
    pageCount: number,
    total: number,
    setPage: (page: number) => void,
    trackName: string,
  ) => {
    if (pageCount <= 1) return null;
    const from = page * FEED_PAGE + 1;
    const to = Math.min(total, (page + 1) * FEED_PAGE);
    return (
      <div className='flex items-center justify-between gap-3 pt-3 text-xs text-muted-foreground'>
        <span>
          {from}–{to} of {total} threads
        </span>
        <div className='flex items-center gap-1'>
          <button
            className='inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-accent disabled:opacity-40 disabled:pointer-events-none'
            disabled={page === 0}
            aria-label='Previous page'
            data-track-category='RADAR'
            data-track-name={`${trackName}_PREV`}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className='size-3.5' /> Prev
          </button>
          <span className='px-2 tabular-nums'>
            Page {page + 1} of {pageCount}
          </span>
          <button
            className='inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-accent disabled:opacity-40 disabled:pointer-events-none'
            disabled={page >= pageCount - 1}
            aria-label='Next page'
            data-track-category='RADAR'
            data-track-name={`${trackName}_NEXT`}
            onClick={() => setPage(page + 1)}
          >
            Next <ChevronRight className='size-3.5' />
          </button>
        </div>
      </div>
    );
  };

  // Tab counts: total open items on each side, muted excluded — independent
  // of the channel/time/requester pickers, which narrow what's drawn, not
  // what the tab itself claims to hold.
  const pendingMeTabCount = pending.reduce(
    (n, card) => n + card.items.filter(i => !i.muted).length,
    0,
  );
  const pendingOthersTabCount = othersPageData
    ? othersPageData.openItemCount
    : waiting.reduce((n, card) => n + card.items.filter(i => !i.muted).length, 0);

  const runBadge = (run: RadarRunLog) =>
    run.error ? (
      <span className='px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/10 text-red-500'>
        error
      </span>
    ) : run.gatePassed ? (
      <span className='px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600'>
        gate PASS · {run.gateReason}
      </span>
    ) : (
      <span className='px-2 py-0.5 rounded-full text-[11px] font-semibold bg-muted text-muted-foreground'>
        gate skip
      </span>
    );

  const opCount = (ops: unknown[] | null): number => (Array.isArray(ops) ? ops.length : 0);

  const fmtMs = (ms: number): string => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

  /** A run that changed nothing and failed at nothing — the bulk of any thread. */
  const isQuietRun = (run: RadarRunLog): boolean =>
    !run.error &&
    opCount(run.droppedOps) === 0 &&
    (!run.applied || run.applied.created + run.applied.resolved + run.applied.reassigned === 0);

  const appliedWords = (a: NonNullable<RadarRunLog['applied']>): string =>
    [
      a.created ? `${a.created} created` : '',
      a.resolved ? `${a.resolved} resolved` : '',
      a.reassigned ? `${a.reassigned} reassigned` : '',
    ]
      .filter(Boolean)
      .join(' · ');

  // Consecutive quiet runs collapse into one row. Grouping by adjacency rather
  // than pulling them all to the bottom keeps the timeline in order, and every
  // run is still there behind the disclosure.
  const runCard = (run: RadarRunLog): ReactElement => (
    <div key={run.id} className='rounded-xl border border-border bg-background p-3 text-xs'>
      <div className='flex items-center gap-2'>
        {runBadge(run)}
        <span className='text-muted-foreground'>
          {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
        </span>
        {run.durationMs !== null && (
          <span
            className={cn(
              'ml-auto',
              run.durationMs >= 10_000 ? 'text-amber-600 font-semibold' : 'text-muted-foreground',
            )}
          >
            {fmtMs(run.durationMs)}
          </span>
        )}
      </div>
      {run.assessment && (
        <div className='mt-1.5 px-2 py-1.5 rounded-lg bg-[#e8604c]/5'>
          <div className='text-[10px] font-bold uppercase tracking-wide text-[#e8604c]'>
            Model&apos;s read
          </div>
          <div className='mt-0.5 text-foreground break-words'>{run.assessment}</div>
        </div>
      )}
      {run.error && <div className='mt-1.5 text-red-500 break-words'>{run.error}</div>}
      {opCount(run.droppedOps) > 0 && (
        <div className='mt-1.5 px-2 py-1.5 rounded-lg bg-red-500/5 text-red-600'>
          <span className='font-semibold'>
            {opCount(run.droppedOps)} operation{opCount(run.droppedOps) === 1 ? '' : 's'} refused by
            the validator
          </span>{' '}
          — see raw operations below.
        </div>
      )}
      <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
        <span className='px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold'>
          {run.windowSize} msg{run.windowSize === 1 ? '' : 's'}
        </span>
        {run.parserRan ? (
          <span className='px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold'>
            {opCount(run.proposedOps)} proposed · {opCount(run.validOps)} valid
          </span>
        ) : (
          <span className='px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold'>
            parser skipped
          </span>
        )}
        {run.applied && appliedWords(run.applied) ? (
          <span className='px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-semibold'>
            {appliedWords(run.applied)}
          </span>
        ) : (
          run.parserRan && (
            <span className='px-2 py-0.5 rounded-full bg-muted text-muted-foreground'>
              nothing applied
            </span>
          )
        )}
      </div>
      {run.parserRan && (
        <details className='mt-1.5'>
          <summary className='cursor-pointer text-muted-foreground hover:text-foreground'>
            raw operations
          </summary>
          <pre className='mt-1 p-2 rounded-lg bg-muted overflow-x-auto text-[11px] leading-4'>
            {humanizeIds({
              proposed: run.proposedOps,
              valid: run.validOps,
              dropped: run.droppedOps,
            })}
          </pre>
        </details>
      )}
    </div>
  );

  const groupRuns = (
    runs: RadarRunLog[],
  ): Array<{ kind: 'run'; run: RadarRunLog } | { kind: 'quiet'; runs: RadarRunLog[] }> => {
    const out: Array<{ kind: 'run'; run: RadarRunLog } | { kind: 'quiet'; runs: RadarRunLog[] }> =
      [];
    for (const run of runs) {
      if (!isQuietRun(run)) {
        out.push({ kind: 'run', run });
        continue;
      }
      const tail = out[out.length - 1];
      if (tail && tail.kind === 'quiet') tail.runs.push(run);
      else out.push({ kind: 'quiet', runs: [run] });
    }
    return out;
  };

  // Debug JSON is unreadable with raw cuids — swap every known user id for
  // its @name before rendering.
  const humanizeIds = (value: unknown): string => {
    let json = JSON.stringify(value, null, 1);
    for (const [id, user] of usersById) {
      json = json.split(id).join(`@${user.name}`);
    }
    return json;
  };

  const timeLabel: Record<typeof timeRange, string> = {
    any: 'Any time',
    today: 'Today',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    custom: 'Custom range',
  };

  const dayMonth = (v: string): string =>
    new Date(`${v}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const customRangeLabel =
    customFrom && customTo
      ? customFrom.slice(0, 4) === customTo.slice(0, 4)
        ? `${dayMonth(customFrom)} – ${dayMonth(customTo)}, ${customTo.slice(0, 4)}`
        : `${dayMonth(customFrom)}, ${customFrom.slice(0, 4)} – ${dayMonth(customTo)}, ${customTo.slice(0, 4)}`
      : customFrom
        ? `From ${dayMonth(customFrom)}`
        : '';

  // By label, not id: several DM channels render to the same name and cannot
  // be told apart, so one row toggles all of them.
  const channelGroups = (() => {
    const me = localStorage.getItem('user_id');
    const byLabel = new Map<
      string,
      {
        label: string;
        rowLabel: string;
        ids: string[];
        dm: boolean;
        people: string[];
        live: boolean;
      }
    >();
    for (const channel of channels) {
      // A ticked channel stays listed even with nothing left in it, or the
      // row vanishes and only its chip can lift the filter.
      if (!channelFacet.has(channel.id) && !filterChannels.has(channel.id)) continue;
      const label = filterChannelLabel(channel.id);
      if (label === 'Direct message') continue;
      const existing = byLabel.get(label);
      if (existing) {
        existing.ids.push(channel.id);
        existing.live = existing.live || channelFacet.has(channel.id);
        continue;
      }
      const dm = isDirectMessage(channel.scopeType);
      const members = dm
        ? (channel.name ?? '')
            .split(',')
            .map(v => v.trim())
            .filter(id => usersById.has(id))
        : [];
      const people = members.filter(id => id !== me);
      byLabel.set(label, {
        label,
        rowLabel: dm ? label : label.replace(/^#/, ''),
        ids: [channel.id],
        dm,
        people: people.length ? people : members,
        live: channelFacet.has(channel.id),
      });
    }
    return [...byLabel.values()].sort((a, b) =>
      a.dm !== b.dm ? (a.dm ? 1 : -1) : a.label.localeCompare(b.label),
    );
  })();
  // How many things are narrowing the feed. The panel itself says which — the
  // Me and Others rows read back their own selection — so this is a count on
  // the button, not a row of chips repeating what is one click away.
  // Which side of the feed (pending me / pending others) is the tab above,
  // not a filter — only the narrowing actually applied within that side
  // counts here.
  const activeFilterCount =
    (tab !== 'waiting' ? excludedRequesters.size : 0) +
    (tab === 'waiting' ? teams.filter(t => teamIds.has(t.id)).length + pendingUsers.size : 0) +
    channelGroups.filter(g => g.ids.some(id => filterChannels.has(id))).length +
    (timeRange !== 'any' ? 1 : 0);

  // DMs belong here — they are channels, and most Radar threads live in one.
  // What is dropped is the unnamed fallback: a DM whose participants cannot be
  // resolved renders as a bare "Direct message", which several threads share
  // and none of them can be told apart by.
  const visibleChannelOptions = channelGroups.filter(g =>
    g.label.toLowerCase().includes(channelSearch.trim().toLowerCase()),
  );

  const railItem = (
    id: 'pending' | 'channels' | 'time',
    label: string,
    count: number,
  ): ReactElement => (
    <button
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
        filterCategory === id ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/60',
      )}
      data-track-category='RADAR'
      data-track-name='FILTER_CATEGORY'
      onClick={() => setFilterCategory(id)}
    >
      <span className='flex-1 text-left'>{label}</span>
      {count > 0 && (
        <span className='min-w-5 h-5 px-1.5 rounded-full bg-muted text-[11px] font-bold flex items-center justify-center'>
          {count}
        </span>
      )}
      <ChevronRight className='size-4 text-muted-foreground' />
    </button>
  );

  const checkbox = (checked: boolean): ReactElement => (
    <span
      className={cn(
        'size-4 shrink-0 rounded-full border flex items-center justify-center transition-colors',
        checked ? 'bg-[#e8604c] border-[#e8604c] text-white' : 'border-border',
      )}
    >
      {checked && <Check className='size-2.5' strokeWidth={3} />}
    </span>
  );

  // Requested-by is a choice between two readings of Others, not two
  // independent toggles — so it reads as a radio, not another checkbox.
  // Requested by picks one of two readings, so it is a radio in behaviour —
  // but a row that is "on" should look on, the same as every other row here.
  const radio = (checked: boolean): ReactElement => checkbox(checked);

  // One grid, two clicks: the first sets the start and clears any end, the
  // second closes the range. A click before the start restarts rather than
  // producing an inverted range.
  const iso = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const pickDay = (day: number) => {
    const picked = iso(new Date(calMonth.getFullYear(), calMonth.getMonth(), day));
    if (!customFrom || customTo || picked < customFrom) {
      setCustomFrom(picked);
      setCustomTo('');
    } else {
      setCustomTo(picked);
    }
  };

  const calendar = (() => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const lead = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const shiftMonth = (by: number) => setCalMonth(new Date(year, month + by, 1));
    return (
      <div className='mt-4'>
        <div className='flex items-center justify-between px-1'>
          <button
            className='p-1 rounded hover:bg-accent text-muted-foreground'
            aria-label='Previous month'
            data-track-category='RADAR'
            data-track-name='CALENDAR_PREV'
            onClick={() => shiftMonth(-1)}
          >
            ‹
          </button>
          <span className='text-sm font-semibold'>
            {calMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
          </span>
          <button
            className='p-1 rounded hover:bg-accent text-muted-foreground'
            aria-label='Next month'
            data-track-category='RADAR'
            data-track-name='CALENDAR_NEXT'
            onClick={() => shiftMonth(1)}
          >
            ›
          </button>
        </div>
        <div className='mt-2 grid grid-cols-7 gap-y-1 text-center'>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <span key={i} className='text-xs font-medium text-muted-foreground py-1'>
              {d}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`lead-${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const day = i + 1;
            const value = iso(new Date(year, month, day));
            const isStart = value === customFrom;
            const isEnd = value === customTo;
            const inRange = !!customFrom && !!customTo && value > customFrom && value < customTo;
            return (
              <button
                key={day}
                className={cn(
                  'mx-auto size-8 rounded-lg text-sm transition-colors',
                  isStart || isEnd
                    ? 'bg-[#e8604c] text-white font-semibold'
                    : inRange
                      ? 'bg-[#e8604c]/10 text-[#e8604c]'
                      : 'hover:bg-accent',
                )}
                data-track-category='RADAR'
                data-track-name='CALENDAR_PICK_DAY'
                onClick={() => pickDay(day)}
              >
                {day}
              </button>
            );
          })}
        </div>
        <div className='mt-2 px-1 text-sm text-muted-foreground'>
          {!customFrom ? 'Pick a start date' : !customTo ? 'Pick an end date' : customRangeLabel}
        </div>
      </div>
    );
  })();

  const userPicker = (
    heading: string,
    ids: string[],
    selected: Set<string>,
    setSelected: (next: Set<string>) => void,
    search: string,
    setSearch: (next: string) => void,
    // Two ways to mean "everyone" over one Set. Include: the set is who is
    // picked, drawn ticked; nobody picked means everyone, drawn empty with the
    // rule stated underneath. Exclude: the set is who is taken away, so
    // everyone else is drawn ticked and an empty set is everyone — no roster
    // is ever stored, so whoever asks next is in by default.
    mode: 'include' | 'exclude',
    /** This box's query, already ranked by useRankedActivePeople. */
    ranked: User[],
    /** id → the ticked team that put them here; those rows are on and fixed. */
    lockedOn?: Map<string, string>,
    /** Pass to make the heading a disclosure; omit and the body always shows. */
    collapse?: { open: boolean; onToggle: () => void; summary: string },
  ): ReactElement => {
    const query = search.trim();
    // At rest the list answers "who is this narrowed to", so it draws only the
    // people the filter already acts on — nothing at all when nothing is
    // picked. The roster used to sit here answering a question nobody asked,
    // and on a real workspace it was the slow path as well.
    //
    // With a query it answers "who do I mean" instead, over everyone on offer.
    // Whoever is already ticked is searched with the rest rather than pinned
    // above it: this box is three rows tall, so a ticked team's members would
    // otherwise push every match below the fold. Ids the user store has no row
    // for — an exclusion for a deleted account, drawn as "Someone" — cannot be
    // matched by name, so they appear only in the unsearched list.
    const offered = new Set(ids);
    const isOn = (id: string): boolean =>
      lockedOn?.has(id) ? true : mode === 'exclude' ? !selected.has(id) : selected.has(id);
    const candidates = query
      ? // The hook searches every active user; this picker only offers the
        // people its own half of the feed knows about.
        ranked.filter(u => offered.has(u.id)).map(u => u.id)
      : mode === 'exclude'
        ? // Exclusion starts from everyone, so here the list IS the
          // information: it is how you find out who has been asking you in the
          // first place, and there is no name to type until you have seen it.
          // It is short by construction — only the requesters in your own feed.
          ids
        : ids.filter(id => selected.has(id) || lockedOn?.has(id));
    // Whoever is ticked leads, in either mode and searched or not: the tick is
    // what the reader is looking for, and this box shows three rows at a time.
    // Order within each group is left alone — relevance from the ranker, or the
    // feed's own order at rest.
    const visible = [...candidates.filter(isOn), ...candidates.filter(id => !isOn(id))];
    // Select all follows the search: with a query typed, it means the names on
    // screen, not the ones hidden behind it. In exclude mode it only ever puts
    // people back.
    const allVisibleOn = visible.length > 0 && visible.every(isOn);
    return (
      <div className='mt-3 ml-8 rounded-xl border border-border overflow-hidden'>
        {collapse ? (
          <button
            className='w-full flex items-center gap-2 px-3 py-2 bg-muted/40 text-left hover:bg-muted/60'
            aria-expanded={collapse.open}
            data-track-category='RADAR'
            data-track-name='TOGGLE_PICKER_PEOPLE'
            onClick={collapse.onToggle}
          >
            <span className='flex-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
              {heading}
            </span>
            <span className='text-xs text-muted-foreground'>{collapse.summary}</span>
            {/* Down closed, up open — the direction the panel will move. */}
            <ChevronDown
              className={cn(
                'size-3.5 text-muted-foreground transition-transform',
                collapse.open && 'rotate-180',
              )}
            />
          </button>
        ) : (
          <div className='px-3 py-2 bg-muted/40 text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
            {heading}
          </div>
        )}
        {collapse && !collapse.open ? null : (
          <>
            <div className='relative px-3 pt-2'>
              <Search className='absolute left-5 top-1/2 mt-1 -translate-y-1/2 size-3.5 text-muted-foreground' />
              <input
                className='w-full pl-7 pr-2 py-1.5 rounded-lg border border-border bg-background text-sm text-foreground'
                placeholder='Search people'
                data-track-category='RADAR'
                data-track-name='SEARCH_PICKER_PEOPLE'
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {/* With everyone already in, there is nothing to select — and over a
            single row it says nothing the row itself does not. */}
            {visible.length > 1 && (mode === 'include' || selected.size > 0) && (
              <button
                className='w-full flex items-center gap-3 px-3 py-2 text-sm font-semibold hover:bg-accent focus:outline-none focus-visible:bg-accent'
                data-track-category='RADAR'
                data-track-name='FILTER_PENDING_SELECT_ALL'
                onClick={() => {
                  // Exclude mode: the row means "everyone in", so it clears the
                  // whole exclusion set. Acting only on the names the search left
                  // on screen looks like a dead control when the excluded one is
                  // hidden behind the query.
                  if (mode === 'exclude') {
                    setSelected(new Set());
                    return;
                  }
                  const next = new Set(selected);
                  for (const id of visible) {
                    // A team's members are not this control's to turn off.
                    if (lockedOn?.has(id)) continue;
                    if (allVisibleOn) next.delete(id);
                    else next.add(id);
                  }
                  setSelected(next);
                }}
              >
                <span className='flex-1 text-left'>Select all</span>
                {/* Exclusions exist, so not everyone is in — the row must not draw
                as though it already is, whatever the search happens to show. */}
                {checkbox(mode === 'exclude' ? selected.size === 0 : allVisibleOn)}
              </button>
            )}
            {/* Three rows, then scroll: the list is for finding a name, not reading
            the roster. */}
            {/* A visible scrollbar takes its width out of the rows, which pushes
            the tick column left of the unscrolled rows above it. Hiding it
            keeps one control column; the clipped fourth row is the affordance
            that there is more. */}
            <div className='max-h-32 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
              {visible.length === 0 && (
                <div className='px-3 py-2 text-xs text-muted-foreground'>
                  {query
                    ? 'No one matches.'
                    : mode === 'exclude'
                      ? 'Nobody has asked you yet.'
                      : 'Search to pick people.'}
                </div>
              )}
              {visible.map(id => {
                const lockedTeam = lockedOn?.get(id);
                return (
                  <button
                    key={id}
                    // Left enabled on purpose. A disabled button takes no pointer
                    // events, so the one thing this row has to say — that a team
                    // is holding it on, and which — never surfaced on hover.
                    aria-disabled={!!lockedTeam}
                    title={
                      lockedTeam ? `On ${lockedTeam} — untick the team to remove them` : undefined
                    }
                    className={cn(
                      'group/member w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent focus:outline-none focus-visible:bg-accent',
                      lockedTeam && 'cursor-not-allowed',
                    )}
                    data-track-category='RADAR'
                    data-track-name='FILTER_PENDING_USER'
                    onClick={() => {
                      // The team put them here; the team is where to take them off.
                      if (lockedTeam) return;
                      const next = new Set(selected);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      setSelected(next);
                    }}
                  >
                    <Avatar
                      userId={id}
                      size='rg'
                      showActiveStatus
                      className='shrink-0 rounded-lg'
                    />
                    <span className='flex-1 text-left truncate'>{nameOf(id)}</span>
                    {/* Named on hover over the whole row, not just the tick: the
                    row is where the pointer goes, and the reason this one will
                    not turn off is the team, which is not otherwise on screen. */}
                    {lockedTeam && (
                      <span className='hidden group-hover/member:block shrink-0 max-w-[45%] truncate text-[11px] text-muted-foreground'>
                        On {lockedTeam}
                      </span>
                    )}
                    {checkbox(isOn(id))}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  // Every active member bar the viewer. A team narrows Others, which is
  // "pending on someone else", so the viewer's own name would be a member that
  // can never match — and so would someone who has left.
  const teamPoolIds = useMemo(
    () =>
      // Nothing outside the teams pane reads this, so the feed does not pay
      // for it on every roster change.
      settingsSection === 'teams' ? activeUsers.filter(u => u.id !== selfId).map(u => u.id) : [],
    [activeUsers, selfId, settingsSection],
  );

  // Two groups, and neither grows with the org: who is already picked — never
  // more than MAX_TEAM_MEMBERS, and drawn whatever is typed, because the answer
  // to "who is on this team" must not depend on the search box — then a capped
  // page of everyone else, ordered by the same recipe cmd+K uses.
  const { pickedCandidates, teamCandidates, teamCandidatesTruncated } = useMemo(() => {
    const picked = teamDraft?.memberIds;
    const pool = new Set(teamPoolIds);
    const label = (id: string): string => getUserDisplayName(usersById.get(id));
    const pickedCandidates = picked
      ? [...picked]
          .filter(id => pool.has(id))
          .map(id => ({ id, label: label(id) }))
          .sort((a, b) => a.label.localeCompare(b.label))
      : [];
    const query = memberSearch.trim();
    if (!query) return { pickedCandidates, teamCandidates: [], teamCandidatesTruncated: false };
    // Whoever is picked is already drawn above; a second row for them would be
    // one tick control too many.
    const ranked = rankedTeamPeople
      .filter(u => u.id !== selfId && !picked?.has(u.id))
      .map(u => u.id);
    return {
      pickedCandidates,
      teamCandidates: ranked.slice(0, TEAM_PICKER_RESULTS).map(id => ({ id, label: label(id) })),
      teamCandidatesTruncated: ranked.length > TEAM_PICKER_RESULTS,
    };
  }, [teamPoolIds, usersById, memberSearch, teamDraft?.memberIds, rankedTeamPeople, selfId]);

  // One row shape for both groups — the tick is the same control whether the
  // person is being added or taken off, and the cap only ever bites on adding.
  const memberRow = (
    candidate: { id: string; label: string },
    picked: boolean,
  ): ReactElement | null => {
    const draft = teamDraft;
    if (!draft) return null;
    const full = !picked && draft.memberIds.size >= MAX_TEAM_MEMBERS;
    return (
      <button
        key={candidate.id}
        disabled={full}
        title={full ? `At most ${MAX_TEAM_MEMBERS} members` : undefined}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent focus:outline-none focus-visible:bg-accent',
          full && 'opacity-50 cursor-not-allowed',
        )}
        data-track-category='RADAR'
        data-track-name='TEAM_MEMBER'
        onClick={() => {
          const next = new Set(draft.memberIds);
          if (next.has(candidate.id)) next.delete(candidate.id);
          else next.add(candidate.id);
          setTeamDraft({ ...draft, memberIds: next });
        }}
      >
        <Avatar userId={candidate.id} size='rg' showActiveStatus className='shrink-0 rounded-lg' />
        <span className='flex-1 text-left truncate'>{candidate.label}</span>
        {checkbox(picked)}
      </button>
    );
  };

  const othersModePicker = (
    <div className='mt-3 ml-8 rounded-xl border border-border overflow-hidden'>
      <button
        className='w-full flex items-center gap-2 px-3 py-2 bg-muted/40 text-left hover:bg-muted/60'
        aria-expanded={requestedByOpen}
        data-track-category='RADAR'
        data-track-name='TOGGLE_REQUESTED_BY'
        onClick={() => setRequestedByOpen(open => !open)}
      >
        <span className='flex-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
          Requested by
        </span>
        <span className='text-xs text-muted-foreground'>
          {othersMode === 'me' ? 'Me' : 'Anyone'}
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 text-muted-foreground transition-transform',
            requestedByOpen && 'rotate-180',
          )}
        />
      </button>
      {requestedByOpen &&
        [
          { id: 'me' as const, label: 'Me' },
          { id: 'all' as const, label: 'Anyone' },
        ].map(mode => (
          <button
            key={mode.id}
            className='w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent focus:outline-none focus-visible:bg-accent'
            data-track-category='RADAR'
            data-track-name='FILTER_OTHERS_MODE'
            onClick={() => setOthersMode(mode.id)}
          >
            <span className='flex-1 text-left font-bold'>{mode.label}</span>
            {radio(othersMode === mode.id)}
          </button>
        ))}
    </div>
  );

  const teamsPicker = (
    <div className='mt-3 ml-8 rounded-xl border border-border overflow-hidden'>
      <div className='flex items-center gap-2 px-3 py-2 bg-muted/40'>
        <span className='flex-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
          Pending on · teams
        </span>
        {/* With no teams there is nothing to manage, so the one link in this
            slot is the one action available — making the first team. */}
        <button
          className='text-[11px] font-bold text-[#e8604c] hover:underline'
          data-track-category='RADAR'
          data-track-name={teams.length === 0 ? 'CREATE_TEAM_FROM_EMPTY' : 'OPEN_MANAGE_TEAMS'}
          onClick={e => {
            setTeamDraft(teams.length === 0 ? { id: null, name: '', memberIds: new Set() } : null);
            openSettings('teams', e.currentTarget);
          }}
        >
          {teams.length === 0 ? '+ Create team' : 'Manage teams ›'}
        </button>
      </div>
      {teams.length === 0 ? (
        <div className='px-3 py-2.5 text-xs text-muted-foreground'>
          No teams yet. Create a team to easily filter and see what’s pending.
        </div>
      ) : (
        teams.map(team => (
          <button
            key={team.id}
            className='w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent focus:outline-none focus-visible:bg-accent'
            data-track-category='RADAR'
            data-track-name='FILTER_BY_TEAM'
            onClick={() =>
              setTeamIds(prev => {
                const next = new Set(prev);
                if (next.has(team.id)) next.delete(team.id);
                else next.add(team.id);
                return next;
              })
            }
          >
            <span className='flex-1 text-left font-semibold'>{team.name}</span>
            <span className='text-xs text-muted-foreground'>
              {team.memberIds.length === 1 ? '1 person' : `${team.memberIds.length} people`}
            </span>
            {checkbox(teamIds.has(team.id))}
          </button>
        ))
      )}
    </div>
  );

  const draftValid = Boolean(teamDraft?.name.trim() && teamDraft?.memberIds.size);

  const saveTeamDraft = (): void => {
    if (!teamDraft || !draftValid) return;
    const members = [...teamDraft.memberIds];
    if (teamDraft.id) {
      updateTeam(teamDraft.id, teamDraft.name, members);
    } else {
      const id = createTeam(teamDraft.name, members);
      // A team is made in order to watch it, so ticking it is the point of
      // having made it.
      if (id) {
        setPendingOthers(true);
        setTeamIds(prev => new Set(prev).add(id));
      }
    }
    // Straight back to the filters: the team was made in order to use it, and
    // the list behind this form is not a step anyone asked for.
    closeSettings();
  };

  const removeTeam = (team: RadarTeam): void => {
    deleteTeam(team.id);
    // Otherwise a deleted team keeps narrowing the feed from a chip that no
    // longer has a row to untick.
    setTeamIds(prev => {
      const next = new Set(prev);
      next.delete(team.id);
      return next;
    });
  };

  // The search belongs to the form, not to the dialog: a query left over from
  // the last member picked would otherwise decide what the next draft opens on.
  const openTeamDraft = (draft: typeof teamDraft): void => {
    setTeamDraft(draft);
    setMemberSearch('');
  };

  const openSettings = (section: RadarSettingsSection, opener: HTMLElement | null): void => {
    settingsOpenerRef.current = opener;
    setSettingsSection(section);
  };

  const closeSettings = (): void => {
    setSettingsSection(null);
    setTeamDraft(null);
    setMemberSearch('');
    // After Radix's own unmount focus handling, which runs on a zero timeout.
    setTimeout(() => settingsOpenerRef.current?.focus(), 50);
  };

  // ── Rules ──────────────────────────────────────────────────────────────

  const ruleScope = RULE_SCOPES.find(s => s.id === ruleDraft.scope) ?? RULE_SCOPES[0]!;
  const draftScopeValues =
    ruleDraft.conditions.find(c => c.scope === ruleDraft.scope)?.values ?? [];

  /** What a stored value reads as. Ids are how a rule points at a thing that
   *  can be renamed; this is the one place that turns one back into a name. */
  const ruleValueLabel = (scope: RadarRuleScope, value: string): string => {
    if (scope === 'keyword') return `“${value}”`;
    if (scope === 'channel') return ruleChannelLabel(value);
    // A deleted group falls back to its id: the rule still matches what it
    // matched, and a blank chip would hide the condition the reader wants gone.
    if (scope === 'mention') return `@${ruleGroupNameById.get(value) ?? value}`;
    return nameOf(value);
  };

  /** One picked row, which may stand for several ids. The length cap mirrors the
   *  server's, so a pasted wall of text is refused here rather than saved and
   *  then rejected. */
  const addRuleValues = (values: string[]): void => {
    const clean = [
      ...new Set(
        values.map(v => v.trim()).filter(v => v !== '' && v.length <= MAX_RULE_VALUE_LENGTH),
      ),
    ];
    if (clean.length === 0) return;
    const current = ruleDraft.conditions.find(c => c.scope === ruleDraft.scope)?.values ?? [];
    const missing = clean.filter(v => !current.includes(v));
    if (missing.length === 0) {
      setRuleValueSearch('');
      return;
    }
    // All of the row or none of it. A channel row stands for every channel that
    // renders to its label, so taking the first few ids until the cap would
    // save a chip that still READS as the label while matching only part of
    // it — the same half-condition removeRuleValues exists to prevent.
    if (current.length + missing.length > MAX_RULE_VALUES) {
      toast.error(
        missing.length > 1
          ? `That adds ${missing.length} values and this condition has only ${
              MAX_RULE_VALUES - current.length
            } slot(s) left. Remove something first, or add fewer.`
          : `A condition holds at most ${MAX_RULE_VALUES} values.`,
      );
      return;
    }
    setRuleValueSearch('');
    setRuleDraft(draft => {
      const existing = draft.conditions.find(c => c.scope === draft.scope);
      const held = existing?.values ?? [];
      const toAdd = clean.filter(v => !held.includes(v));
      // Re-checked against the draft the updater was handed, not the one the
      // click saw, so two fast picks cannot get past the cap between renders.
      if (toAdd.length === 0 || held.length + toAdd.length > MAX_RULE_VALUES) return draft;
      const next = [...held, ...toAdd];
      return existing
        ? {
            ...draft,
            conditions: draft.conditions.map(c =>
              c.scope === draft.scope ? { ...c, values: next } : c,
            ),
          }
        : { ...draft, conditions: [...draft.conditions, { scope: draft.scope, values: next }] };
    });
  };

  /** Typed keywords, split the way the placeholder shows them: "deploy,
   *  sign-off" is two keywords ORed. Kept whole it would be one literal that
   *  whole-word matching only finds if a message says exactly "deploy,
   *  sign-off" — a chip that reads right and never fires. Ids never come
   *  through here; they are picked, not typed. */
  const addTypedKeywords = (typed: string): void => addRuleValues(typed.split(','));

  /** Every id the chip stood for, together — a channel chip is one label over
   *  several ids, and removing half of them would leave a chip that still reads
   *  the same and matches less. */
  const removeRuleValues = (scope: RadarRuleScope, values: string[]): void => {
    const drop = new Set(values);
    // The condition goes with its last value: an empty one would read as a
    // scope that matches anything, which is the opposite of what it now means.
    setRuleDraft(draft => ({
      ...draft,
      conditions: draft.conditions
        .map(c => (c.scope === scope ? { ...c, values: c.values.filter(v => !drop.has(v)) } : c))
        .filter(c => c.values.length > 0),
    }));
  };

  const resetRuleDraft = (): void => {
    setRuleDraft({ id: null, scope: 'channel', conditions: [] });
    setRuleValueSearch('');
  };

  /** A new rule at the limit is refused; editing one always goes through,
   *  since it replaces a row rather than adding one. */
  const ruleDraftBlocked = atRuleLimit && !ruleDraft.id;

  const saveRuleDraft = (): void => {
    if (ruleDraft.conditions.length === 0 || ruleDraftBlocked) return;
    if (ruleDraft.id) updateRule(ruleDraft.id, ruleDraft.conditions);
    else createRule(ruleDraft.conditions);
    resetRuleDraft();
  };

  // What the value input offers. Only built while the pane is open. A row is
  // shaped like the channel filter's: stacked avatars for anything made of
  // people, the hash tile for a named channel.
  const ruleValueOptions: RuleValueOption[] =
    settingsSection !== 'rules' || ruleDraft.scope === 'keyword'
      ? []
      : ((): RuleValueOption[] => {
          const query = effectiveRuleQuery;
          const chosen = new Set(draftScopeValues);
          const options: RuleValueOption[] = [];

          // Nothing is offered until it is asked for. Every one of these
          // rosters is the whole workspace, and a rule wants one row out of
          // it — an unprompted list is a page to scroll past rather than an
          // answer, and the weighting that makes these searches good only
          // applies to a query. The team picker has drawn nothing until asked
          // since it was rewritten, for the same reason.
          if (!query) return [];

          if (ruleDraft.scope === 'channel') {
            // cmd+K's own matcher, over cmd+K's own item shape: fuzzy on a
            // channel name, AND-across-tokens on DM participant names, so
            // "kush mam" finds the DM with both of them here exactly as it
            // does in the command menu, ranked by the same blend of match
            // score and affinity.
            const matched = filterChannelsBySearchableNames(ruleChannelItems, query);
            // One row per label: several channels can render to the same one,
            // and the row writes every id behind it so the rule means the row.
            const seen = new Set<string>();
            for (const item of matched) {
              const label = formatChannelLabel(item);
              if (seen.has(label)) continue;
              seen.add(label);
              const ids = idsByChannelLabel.get(label) ?? [item.channel.id];
              if (ids.every(id => chosen.has(id))) continue;
              const dm = isDirectMessage(item.channel.scopeType);
              const participants = dm
                ? parseDMParticipantIds(item.channel).filter(id => usersById.has(id))
                : [];
              const others = participants.filter(id => id !== selfId);
              options.push({
                value: item.channel.id,
                values: ids,
                // The tile carries the hash, so the row does not repeat it —
                // the same split the channel filter makes.
                label: dm ? label : label.replace(/^#/, ''),
                people: others.length ? others : participants,
              });
              if (options.length >= RULE_VALUE_RESULTS) break;
            }
            return options;
          }

          if (ruleDraft.scope === 'mention') {
            // Groups only: a mention rule asks what the message said, and what
            // it named was the group, not whoever happens to be in it.
            for (const group of ruleGroupMatches) {
              if (chosen.has(group.id)) continue;
              // Nobody can @mention a deactivated group, so offering one is
              // offering a condition that can never hold. Rules already written
              // against it still read as its name — ruleGroupNameById keeps them.
              if (group.isActive === false) continue;
              options.push({
                value: group.id,
                values: [group.id],
                label: group.name,
                people: [],
                group: true,
              });
              if (options.length >= RULE_VALUE_RESULTS) break;
            }
            return options;
          }

          // Teams are deliberately NOT offered here. They live in the browser,
          // and the engine that now enforces a mute has no table to resolve
          // one against — a team rule would save cleanly and then quietly
          // match nobody. Until teams are server-side, a rule names people.
          for (const person of rankedRulePeople) {
            if (chosen.has(person.id)) continue;
            options.push({
              value: person.id,
              values: [person.id],
              label: getUserDisplayName(person),
              people: [person.id],
            });
            if (options.length >= RULE_VALUE_RESULTS) break;
          }
          return options.slice(0, RULE_VALUE_RESULTS);
        })();

  /** The channel filter's own row furniture: a stack of up to two avatars for
   *  anything made of people, a tile for a named channel or a user group. */
  const ruleValueIcon = (option: RuleValueOption): ReactElement =>
    option.group ? (
      <span className='size-6 shrink-0 rounded-lg bg-muted text-muted-foreground flex items-center justify-center'>
        <UsersRound className='size-3.5' />
      </span>
    ) : option.people.length > 0 ? (
      <span className='flex -space-x-1.5 shrink-0'>
        {option.people.slice(0, AVATARS_IN_RULE_ROW).map(id => (
          <Avatar key={id} userId={id} size='sm' className='rounded-lg ring-2 ring-popover' />
        ))}
      </span>
    ) : (
      <span className='size-6 shrink-0 rounded-lg bg-muted text-muted-foreground flex items-center justify-center'>
        <Hash className='size-3.5' />
      </span>
    );

  /** A condition's values as the reader picked them: one entry per label, over
   *  every value that reads as that label. A channel label can cover several
   *  ids, and drawing one chip per id would repeat the same word. */
  const ruleChipParts = (
    condition: RadarRuleCondition,
  ): Array<{ label: string; values: string[] }> => {
    const parts: Array<{ label: string; values: string[] }> = [];
    const byLabel = new Map<string, number>();
    for (const value of condition.values) {
      const label = ruleValueLabel(condition.scope, value);
      const at = byLabel.get(label);
      if (at === undefined) {
        byLabel.set(label, parts.length);
        parts.push({ label, values: [value] });
      } else {
        parts[at]!.values.push(value);
      }
    }
    return parts;
  };

  /** One rule's conditions as chips: values ORed inside a chip, chips ANDed. */
  const ruleChips = (
    conditions: RadarRuleCondition[],
    onRemove?: (scope: RadarRuleScope, values: string[]) => void,
  ): ReactElement[] =>
    conditions.map((condition, i) => (
      <span key={condition.scope} className='inline-flex items-center gap-2'>
        {i > 0 && (
          <span className='text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
            and
          </span>
        )}
        <span className='inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold'>
          <span className='text-muted-foreground'>
            {RULE_SCOPES.find(s => s.id === condition.scope)?.chip}
          </span>
          {ruleChipParts(condition).map((part, k) => (
            <span key={part.values[0]} className='inline-flex items-center gap-1.5'>
              {k > 0 && (
                <span className='text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
                  or
                </span>
              )}
              <span className='max-w-[180px] truncate'>{part.label}</span>
              {onRemove && (
                <button
                  aria-label={`Remove ${part.label}`}
                  className='text-muted-foreground hover:text-foreground'
                  data-track-category='RADAR'
                  data-track-name='REMOVE_RULE_VALUE'
                  onClick={() => onRemove(condition.scope, part.values)}
                >
                  <X className='size-3' />
                </button>
              )}
            </span>
          ))}
        </span>
      </span>
    ));

  const rulesSection = (
    <div className='flex flex-col gap-5'>
      <div className='text-lg font-bold'>Rules</div>

      <div className='rounded-xl border border-border p-4 flex flex-col gap-3.5'>
        <div className='text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
          {ruleDraft.id ? 'Edit rule' : 'Build a rule'}
        </div>

        {ruleDraft.conditions.length > 0 && (
          <div className='flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2.5'>
            {ruleChips(ruleDraft.conditions, removeRuleValues)}
          </div>
        )}

        <div className='flex flex-wrap gap-2'>
          {RULE_SCOPES.map(scope => (
            <button
              key={scope.id}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                ruleDraft.scope === scope.id
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border text-foreground hover:bg-accent',
              )}
              data-track-category='RADAR'
              data-track-name='RULE_SCOPE'
              onClick={() => {
                setRuleDraft(draft => ({ ...draft, scope: scope.id }));
                setRuleValueSearch('');
              }}
            >
              {scope.label}
            </button>
          ))}
        </div>

        <div className='flex gap-2'>
          <div className='relative flex-1 min-w-0'>
            <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground' />
            <input
              className='w-full pl-7 pr-2 py-2 rounded-lg border border-border bg-background text-sm text-foreground'
              placeholder={ruleScope.placeholder}
              data-track-category='RADAR'
              data-track-name='RULE_VALUE_SEARCH'
              value={ruleValueSearch}
              onChange={e => setRuleValueSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && ruleDraft.scope === 'keyword')
                  addTypedKeywords(ruleValueSearch);
              }}
            />
          </div>
          {/* Only keywords are typed. Everything else points at a thing with
              an id, and is added by picking it from the list below. */}
          {ruleDraft.scope === 'keyword' && (
            <button
              disabled={!ruleValueSearch.trim()}
              className={cn(
                'shrink-0 rounded-lg border px-3 py-2 text-xs font-bold',
                ruleValueSearch.trim()
                  ? 'border-foreground text-foreground hover:bg-accent'
                  : 'border-border text-muted-foreground cursor-not-allowed',
              )}
              data-track-category='RADAR'
              data-track-name='ADD_RULE_KEYWORD'
              onClick={() => addTypedKeywords(ruleValueSearch)}
            >
              {draftScopeValues.length > 0 ? '+ Or' : '+ And'}
            </button>
          )}
        </div>

        {ruleValueOptions.length > 0 && (
          <div className='rounded-lg border border-border overflow-hidden'>
            {ruleValueOptions.map(option => (
              <button
                key={option.value}
                className='w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-accent focus:outline-none focus-visible:bg-accent'
                data-track-category='RADAR'
                data-track-name='ADD_RULE_VALUE'
                onClick={() => addRuleValues(option.values)}
              >
                {ruleValueIcon(option)}
                <span className='flex-1 truncate'>{option.label}</span>
                <span className='text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
                  {draftScopeValues.length > 0 ? 'or' : 'and'}
                </span>
              </button>
            ))}
          </div>
        )}
        {ruleDraft.scope !== 'keyword' && ruleValueOptions.length === 0 && (
          <div className='text-xs text-muted-foreground'>
            {effectiveRuleQuery ? 'Nothing else matches.' : 'Search to add a condition.'}
          </div>
        )}

        {/* Said before the save is attempted, not after: a refusal at the
            button would take the draft with it. */}
        {ruleDraftBlocked && (
          <div className='text-xs text-muted-foreground'>
            {MAX_RULES} rules is the limit. Delete one to add another.
          </div>
        )}

        <div className='flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3'>
          {/* There is only one thing a rule does, but saying nothing leaves the
              builder without a verb — the reader has to guess what Save means. */}
          <div className='flex items-center gap-2'>
            <span className='text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
              Then
            </span>
            <span className='rounded-lg border border-border px-3 py-1.5 text-xs font-bold'>
              Mute
            </span>
          </div>
          <div className='flex items-center gap-2'>
            {(ruleDraft.id || ruleDraft.conditions.length > 0) && (
              <button
                className='rounded-full px-3 py-2 text-xs font-semibold hover:bg-accent'
                data-track-category='RADAR'
                data-track-name='CANCEL_RULE'
                onClick={resetRuleDraft}
              >
                Cancel
              </button>
            )}
            <button
              disabled={ruleDraft.conditions.length === 0 || ruleDraftBlocked}
              title={ruleDraftBlocked ? `At most ${MAX_RULES} rules` : undefined}
              className={cn(
                'rounded-full px-4 py-2 text-xs font-bold transition-colors',
                ruleDraft.conditions.length > 0 && !ruleDraftBlocked
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground cursor-not-allowed',
              )}
              data-track-category='RADAR'
              data-track-name='SAVE_RULE'
              onClick={saveRuleDraft}
            >
              {ruleDraft.id ? 'Update rule' : 'Save rule'}
            </button>
          </div>
        </div>
      </div>

      <div className='rounded-xl border border-border overflow-hidden'>
        <div className='flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2.5'>
          <span className='text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
            Your rules
          </span>
          <span className='text-xs text-muted-foreground'>
            {rules.length === 1 ? '1 rule' : `${rules.length} rules`}
          </span>
        </div>
        {sortRules(rules).map(rule => (
          <div
            key={rule.id}
            className={cn(
              'flex items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0',
              rule.id === ruleDraft.id && 'bg-accent',
            )}
          >
            <div className='flex flex-col gap-2 min-w-0 flex-1'>
              <div className='flex flex-wrap items-center gap-2'>{ruleChips(rule.conditions)}</div>
              <div className='flex items-center gap-2'>
                <span className='text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
                  Then
                </span>
                <span className='text-xs font-bold'>Mute</span>
              </div>
            </div>
            <div className='flex shrink-0 items-center gap-1.5'>
              <button
                aria-label='Edit rule'
                title='Edit rule'
                className='rounded-full border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground'
                data-track-category='RADAR'
                data-track-name='EDIT_RULE'
                onClick={() => {
                  setRuleDraft({
                    id: rule.id,
                    scope: rule.conditions[0]?.scope ?? 'channel',
                    conditions: rule.conditions.map(c => ({ ...c, values: [...c.values] })),
                  });
                  setRuleValueSearch('');
                }}
              >
                <Pencil className='size-3.5' />
              </button>
              <button
                aria-label='Delete rule'
                title='Delete rule'
                className='rounded-full border border-[#e8604c]/40 p-1.5 text-[#e8604c] hover:bg-[#e8604c]/10'
                data-track-category='RADAR'
                data-track-name='DELETE_RULE'
                onClick={() => {
                  deleteRule(rule.id);
                  // Otherwise the builder is still offering to update a rule
                  // that no longer exists, and Save would quietly do nothing.
                  if (ruleDraft.id === rule.id) resetRuleDraft();
                }}
              >
                <Trash2 className='size-3.5' />
              </button>
            </div>
          </div>
        ))}
        {rules.length === 0 && (
          <div className='px-4 py-6 text-center text-sm text-muted-foreground'>
            No rules yet. Everything reaches you.
          </div>
        )}
      </div>
    </div>
  );
  // The Teams pane. The list and the form are one pane rather than two
  // dialogs: the form replaces the list in place and hands back to it, so the
  // heading is the only thing that has to say which of the two is showing.
  const teamsSection = (
    <div className='flex flex-col gap-5'>
      <div className='flex items-end justify-between gap-4 flex-wrap'>
        <div className='min-w-0'>
          <div className='text-lg font-bold'>
            {teamDraft ? (teamDraft.id ? 'Edit team' : 'New team') : 'Teams'}
          </div>
          <div className='mt-1 max-w-[440px] text-[13px] leading-relaxed text-muted-foreground'>
            {teamDraft
              ? 'Name the team and pick its members.'
              : 'A saved group of people. Filters can then show everything pending on that group, whoever asked.'}
          </div>
        </div>
        {!teamDraft && (
          <button
            className='shrink-0 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-90'
            data-track-category='RADAR'
            data-track-name='NEW_TEAM'
            onClick={() => openTeamDraft({ id: null, name: '', memberIds: new Set() })}
          >
            + New team
          </button>
        )}
      </div>

      {!teamDraft && (
        <div className='flex flex-col gap-2'>
          {teams.map(team => (
            <div
              key={team.id}
              className='flex items-center gap-3 rounded-xl border border-border px-3.5 py-3'
            >
              <div className='flex-1 min-w-0'>
                <div className='text-sm font-bold truncate'>{team.name}</div>
                <div className='text-xs text-muted-foreground truncate'>
                  {team.memberIds.length === 1 ? '1 member' : `${team.memberIds.length} members`}
                  {' · '}
                  {team.memberIds.slice(0, 2).map(nameOf).join(', ')}
                  {team.memberIds.length > 2 && ` +${team.memberIds.length - 2}`}
                </div>
              </div>
              <button
                className='shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent'
                data-track-category='RADAR'
                data-track-name='EDIT_TEAM'
                onClick={() =>
                  openTeamDraft({
                    id: team.id,
                    name: team.name,
                    memberIds: new Set(team.memberIds),
                  })
                }
              >
                Edit
              </button>
              <button
                className='shrink-0 rounded-full border border-[#e8604c]/40 text-[#e8604c] px-3 py-1.5 text-xs font-semibold hover:bg-[#e8604c]/10'
                data-track-category='RADAR'
                data-track-name='DELETE_TEAM'
                onClick={() => removeTeam(team)}
              >
                Delete
              </button>
            </div>
          ))}
          {teams.length === 0 && (
            <div className='rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground'>
              No teams yet. Create a team to easily filter and see what’s pending.
            </div>
          )}
        </div>
      )}

      {teamDraft && (
        <div className='max-w-[520px]'>
          <div className='text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5'>
            Team name
          </div>
          <input
            autoFocus
            className='w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground'
            placeholder='e.g. Platform Pod'
            data-track-category='RADAR'
            data-track-name='TEAM_NAME'
            value={teamDraft.name}
            onChange={e => setTeamDraft({ ...teamDraft, name: e.target.value })}
          />
          <div className='flex items-center gap-2 mt-4 mb-1.5'>
            <span className='flex-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
              Members
            </span>
            <span className='text-xs text-muted-foreground'>
              {teamDraft.memberIds.size ? `${teamDraft.memberIds.size} selected` : 'none selected'}
            </span>
          </div>
          <div className='rounded-xl border border-border overflow-hidden'>
            <div className='relative px-3 pt-2 pb-1'>
              <Search className='absolute left-5 top-1/2 mt-0.5 -translate-y-1/2 size-3.5 text-muted-foreground' />
              <input
                className='w-full pl-7 pr-2 py-1.5 rounded-lg border border-border bg-background text-sm text-foreground'
                placeholder='Search people'
                data-track-category='RADAR'
                data-track-name='SEARCH_TEAM_MEMBERS'
                value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
              />
            </div>
            {pickedCandidates.length > 0 && (
              <div className='px-3 pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
                On this team
              </div>
            )}
            {pickedCandidates.map(candidate => memberRow(candidate, true))}
            {/* Only ever a divider between two populated groups. */}
            {pickedCandidates.length > 0 && teamCandidates.length > 0 && (
              <div className='mx-3 my-1 border-t border-border' />
            )}
            {teamCandidates.map(candidate => memberRow(candidate, false))}
            {pickedCandidates.length + teamCandidates.length === 0 && (
              <div className='px-3 py-2 text-xs text-muted-foreground'>
                {memberSearch.trim() ? 'No one matches.' : 'Search to add people.'}
              </div>
            )}
            {/* "else" because whoever is already on the team is listed right
                above, however little the query matched. */}
            {memberSearch.trim() && teamCandidates.length === 0 && pickedCandidates.length > 0 && (
              <div className='px-3 py-2 text-xs text-muted-foreground'>No one else matches.</div>
            )}
            {teamCandidatesTruncated && (
              <div className='px-3 py-2 text-xs text-muted-foreground'>
                More people match — keep typing to narrow.
              </div>
            )}
          </div>

          <div className='flex items-center justify-end gap-3 mt-4'>
            <button
              className='rounded-full px-4 py-2 text-sm font-semibold hover:bg-accent'
              data-track-category='RADAR'
              data-track-name='TEAM_DRAFT_BACK'
              onClick={() => openTeamDraft(null)}
            >
              Back
            </button>
            <button
              disabled={!draftValid}
              className={cn(
                'rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                draftValid
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground cursor-not-allowed',
              )}
              data-track-category='RADAR'
              data-track-name='SAVE_TEAM'
              onClick={saveTeamDraft}
            >
              {teamDraft.id ? 'Save team' : 'Create team'}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Every pane of the dialog, in nav order. Registering a section is this row
  // plus a branch in the pane switch below.
  const settingsNav: Array<{ id: RadarSettingsSection; label: string; count: number }> = [
    { id: 'rules', label: 'Rules', count: rules.length },
    { id: 'teams', label: 'Teams', count: teams.length },
  ];

  // The app's Dialog, so Escape, the focus trap, focus restore and the portal
  // all come for free instead of being rebuilt here one bug at a time.
  const settingsDialog = (
    <Dialog
      open={settingsSection !== null}
      onOpenChange={open => {
        if (!open) closeSettings();
      }}
      title='Radar settings'
      description='Teams and everything else Radar keeps per person.'
      className='max-w-[940px] rounded-2xl border border-border overflow-hidden'
      // The drawer variant drops title, description and className on the
      // floor; a dialog at every width keeps this one surface.
      mobileVariant='dialog'
    >
      <div className='flex flex-col h-[640px] max-h-[85vh]'>
        <div className='flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border shrink-0'>
          <div className='text-sm font-bold'>Settings</div>
          <button
            aria-label='Close'
            className='shrink-0 p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'
            data-track-category='RADAR'
            data-track-name='CLOSE_RADAR_SETTINGS'
            onClick={closeSettings}
          >
            <X className='size-4' />
          </button>
        </div>

        <div className='flex flex-1 min-h-0'>
          <nav className='w-[190px] shrink-0 border-r border-border bg-muted/30 p-2.5'>
            {settingsNav.map(section => {
              const on = settingsSection === section.id;
              return (
                <button
                  key={section.id}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-lg px-3 py-2 mb-0.5 text-sm font-semibold transition-colors',
                    on
                      ? 'bg-background text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  data-track-category='RADAR'
                  data-track-name='RADAR_SETTINGS_SECTION'
                  onClick={() => setSettingsSection(section.id)}
                >
                  <span className='flex-1 text-left'>{section.label}</span>
                  <span className='text-xs font-normal text-muted-foreground'>{section.count}</span>
                </button>
              );
            })}
          </nav>

          <div className='flex-1 min-w-0 overflow-y-auto p-6'>
            {settingsSection === 'rules' && rulesSection}
            {settingsSection === 'teams' && teamsSection}
          </div>
        </div>
      </div>
    </Dialog>
  );

  const filtersPanel = (
    <div className='absolute left-0 top-full mt-2 z-40 w-[820px] rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl overflow-hidden'>
      <div className='flex min-h-[440px]'>
        <div className='w-60 shrink-0 border-r border-border bg-muted/30 p-3'>
          <div className='px-3 pt-1 pb-2 text-[11px] font-bold tracking-wide text-muted-foreground uppercase'>
            All filters
          </div>
          {railItem(
            'pending',
            'Pending',
            tab === 'waiting' ? teamIds.size + pendingUsers.size : excludedRequesters.size,
          )}
          {railItem('channels', 'Channels', filterChannels.size)}
          {railItem('time', 'Time', timeRange === 'any' ? 0 : 1)}
        </div>

        <div className='flex-1 min-w-0 p-6 max-h-[38rem] overflow-y-auto'>
          {filterCategory === 'pending' &&
            (tab !== 'waiting' ? (
              // Pending me tab: the only thing left to narrow is who asked.
              // Which side of the feed this is comes from the tab above, not
              // a checkbox here.
              <>
                <div className='text-sm font-semibold text-muted-foreground mb-3'>Requested by</div>
                {userPicker(
                  'Requested by',
                  requesterOptions,
                  excludedRequesters,
                  setExcludedRequesters,
                  requesterSearch,
                  setRequesterSearch,
                  'exclude',
                  rankedRequesters,
                  undefined,
                  {
                    open: requesterPickerOpen,
                    onToggle: () => setRequesterPickerOpen(open => !open),
                    // Who is still in, not who is out: "All but 1" made the
                    // reader do the subtraction, and the count that matters is
                    // the one the feed is actually narrowed to.
                    summary: (() => {
                      if (excludedRequesters.size === 0) return 'Anyone';
                      const included = requesterOptions.filter(
                        id => !excludedRequesters.has(id),
                      ).length;
                      return `${included} ${included === 1 ? 'person' : 'people'}`;
                    })(),
                  },
                )}
              </>
            ) : (
              // Pending others tab: narrow by who's holding it, and whether
              // that means "asked of me" or everyone else's asks.
              <>
                <div className='text-sm font-semibold text-muted-foreground mb-3'>Pending on</div>
                {teamsPicker}
                {userPicker(
                  'Pending on · people',
                  otherHolders,
                  pendingUsers,
                  setPendingUsers,
                  holderSearch,
                  setHolderSearch,
                  'include',
                  rankedHolders,
                  lockedByTeam,
                )}
                {othersModePicker}
              </>
            ))}

          {filterCategory === 'channels' && (
            <>
              <div className='text-sm font-semibold text-muted-foreground mb-3'>Channels</div>
              <div className='relative mb-2'>
                <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground' />
                <input
                  className='w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground'
                  placeholder='Search channels'
                  data-track-category='RADAR'
                  data-track-name='SEARCH_CHANNELS'
                  value={channelSearch}
                  onChange={e => setChannelSearch(e.target.value)}
                />
              </div>
              {visibleChannelOptions.length === 0 && (
                <div className='px-2 py-2 text-xs text-muted-foreground'>
                  {channelGroups.length === 0 ? 'Nothing to filter yet.' : 'No channels match.'}
                </div>
              )}
              {visibleChannelOptions.map(group => {
                const on = group.ids.some(id => filterChannels.has(id));
                return (
                  <button
                    key={group.label}
                    className={cn(
                      'w-full flex items-center gap-3 pl-2 pr-[13px] py-2.5 rounded-lg text-sm hover:bg-accent',
                      !group.live && 'opacity-50',
                    )}
                    title={group.live ? undefined : 'Nothing pending here right now'}
                    data-track-category='RADAR'
                    data-track-name='FILTER_BY_CHANNEL'
                    onClick={() =>
                      setFilterChannels(prev => {
                        const next = new Set(prev);
                        for (const id of group.ids) {
                          if (on) next.delete(id);
                          else next.add(id);
                        }
                        return next;
                      })
                    }
                  >
                    {group.dm ? (
                      <span className='flex -space-x-1.5 shrink-0'>
                        {group.people.slice(0, 2).map(id => (
                          <Avatar
                            key={id}
                            userId={id}
                            size='sm'
                            className='rounded-lg ring-2 ring-popover'
                          />
                        ))}
                      </span>
                    ) : (
                      <span className='size-6 shrink-0 rounded-lg bg-muted text-muted-foreground flex items-center justify-center'>
                        <Hash className='size-3.5' />
                      </span>
                    )}
                    <span className='flex-1 text-left truncate'>{group.rowLabel}</span>
                    {checkbox(on)}
                  </button>
                );
              })}
            </>
          )}

          {filterCategory === 'time' && (
            <>
              <div className='text-sm font-semibold text-muted-foreground mb-3'>Time range</div>
              <div className='flex flex-wrap gap-2'>
                {(['any', 'today', '7d', '30d', 'custom'] as const).map(r => (
                  <button
                    key={r}
                    className={cn(
                      'px-3.5 py-1.5 rounded-full border text-sm font-semibold transition-colors',
                      timeRange === r
                        ? 'bg-foreground text-background border-foreground'
                        : 'border-border text-foreground hover:bg-accent',
                    )}
                    data-track-category='RADAR'
                    data-track-name='FILTER_TIME_RANGE'
                    onClick={() => setTimeRange(r)}
                  >
                    {r === 'custom' ? 'Custom range…' : timeLabel[r]}
                  </button>
                ))}
              </div>
              {timeRange === 'custom' && calendar}
            </>
          )}
        </div>
      </div>

      <div className='flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30'>
        <button
          className='text-sm font-semibold text-muted-foreground hover:text-foreground'
          data-track-category='RADAR'
          data-track-name='CLEAR_ALL_FILTERS'
          onClick={clearAllFilters}
        >
          Clear all
        </button>
        <button
          className='px-5 py-2 rounded-full bg-foreground text-background text-sm font-semibold hover:opacity-90'
          data-track-category='RADAR'
          data-track-name='CLOSE_FILTERS'
          onClick={() => setFiltersOpen(false)}
        >
          Done
        </button>
      </div>
    </div>
  );

  if (!radarEnabled) return <div className='h-full w-full bg-background' />;

  return (
    <div className='flex h-full w-full overflow-hidden bg-background'>
      <div className={cn('flex flex-col h-full min-w-0', showThreadPanel ? 'w-1/2' : 'flex-1')}>
        <div className='flex items-center gap-3 px-6 pt-6 pb-4'>
          <RadarIcon className='size-5 text-foreground' />
          <h1 className='text-xl font-bold text-foreground'>Radar</h1>
          <button
            title='Refresh the feed'
            className='p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50'
            disabled={loading}
            data-track-category='RADAR'
            data-track-name='REFRESH_FEED'
            onClick={() => void load(true)}
          >
            <RefreshCw className='size-4' />
          </button>
          <button
            title='Radar settings'
            aria-haspopup='dialog'
            className='p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
            data-track-category='RADAR'
            data-track-name='OPEN_RADAR_SETTINGS'
            onClick={e => openSettings('rules', e.currentTarget)}
          >
            <Settings className='size-4' />
          </button>
          <div className='ml-auto flex items-center gap-3'>
            <span className='flex items-center gap-0.5 p-0.5 rounded-full border border-border bg-card'>
              {(['cards', 'table'] as const).map(mode => (
                <button
                  key={mode}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-semibold capitalize transition-colors',
                    viewMode === mode
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={viewMode === mode}
                  data-track-category='RADAR'
                  data-track-name='SET_RADAR_VIEW_MODE'
                  data-track-metadata={JSON.stringify({ viewMode: mode })}
                  onClick={() => setViewMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </span>
            <span className='flex items-center gap-1.5'>
              <Bug className='size-3.5 text-muted-foreground' />
              <input
                className='w-56 px-2.5 py-1 rounded-lg border border-border bg-card text-xs text-foreground placeholder:text-muted-foreground'
                data-track-category='RADAR'
                data-track-name='DEBUG_THREAD_LOOKUP'
                placeholder='Debug a thread id… ⏎'
                title='Paste a conversation id and press Enter to open its thread debug'
                value={debugLookup}
                onChange={e => setDebugLookup(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && debugLookup.trim()) {
                    openThreadDebugById(debugLookup.trim());
                  }
                }}
              />
            </span>
          </div>
        </div>
        <div className='flex items-center gap-5 px-6 border-b border-border'>
          {(
            [
              { id: 'pending' as const, label: 'Pending me', count: pendingMeTabCount },
              { id: 'waiting' as const, label: 'Pending others', count: pendingOthersTabCount },
            ] as const
          ).map(t => {
            const active = t.id === 'pending' ? tab !== 'waiting' : tab === 'waiting';
            return (
              <button
                key={t.id}
                className={cn(
                  'flex items-center gap-2 pb-3 pt-1 -mb-px border-b-2 text-sm font-semibold transition-colors',
                  active
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                aria-current={active ? 'true' : undefined}
                data-track-category='RADAR'
                data-track-name='SET_RADAR_TAB'
                data-track-metadata={JSON.stringify({ tab: t.id })}
                onClick={() => {
                  setPendingMe(t.id === 'pending');
                  setPendingOthers(t.id === 'waiting');
                }}
              >
                {t.label}
                <span
                  className={cn(
                    'min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center',
                    active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
        <div className='flex items-center flex-wrap gap-2 px-6 py-5'>
          <span className='relative'>
            {filtersOpen && (
              <button
                type='button'
                aria-label='Close filters'
                className='fixed inset-0 z-30 cursor-default'
                data-track-category='RADAR'
                data-track-name='CLOSE_FILTERS_BACKDROP'
                onClick={() => setFiltersOpen(false)}
              />
            )}
            <button
              className={cn(
                'inline-flex items-center gap-2 pl-3.5 pr-3 py-2 rounded-full text-sm font-semibold transition-colors border',
                filtersOpen || activeFilterCount > 0
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-card text-foreground border-border hover:bg-accent',
              )}
              aria-haspopup='dialog'
              aria-expanded={filtersOpen}
              data-track-category='RADAR'
              data-track-name='TOGGLE_FILTERS'
              onClick={() => setFiltersOpen(open => !open)}
            >
              <ListFilter className='size-4' />
              Filters
              {activeFilterCount > 0 && (
                <span className='min-w-5 h-5 px-1.5 rounded-full bg-[#e8604c] text-white text-[11px] font-bold flex items-center justify-center'>
                  {activeFilterCount}
                </span>
              )}
            </button>
            {filtersOpen && filtersPanel}
          </span>
        </div>

        <div className='flex-1 overflow-y-auto px-6 pb-8'>
          {loading ? (
            <div className='flex items-center gap-2 text-muted-foreground text-sm py-8'>
              <Loader2 className='size-4 animate-spin' /> Loading…
            </div>
          ) : cards.length === 0 && mutedCards.length === 0 ? (
            <div className='text-muted-foreground text-sm py-8'>
              {tab === 'waiting'
                ? 'Nothing pending on anyone else.'
                : tab === 'pending'
                  ? 'Nothing pending on you. Enjoy the quiet.'
                  : 'Nothing on the radar.'}
            </div>
          ) : (
            <div className={viewMode === 'table' ? 'max-w-5xl' : 'space-y-4 max-w-3xl'}>
              {viewMode === 'table' ? (
                <>
                  <div className={cn(tableMinWidth(), 'rounded-2xl border border-border')}>
                    {tableHeader()}
                    {feedSlice.map(({ card, kind }) => renderTableGroup(card, kind))}
                  </div>
                </>
              ) : (
                cards.slice(0, feedLimit).map(({ card, kind }) => renderCard(card, kind))
              )}
              {viewMode === 'table' &&
                renderPager(safeFeedPage, feedPageCount, feedTotal, setFeedPage, 'RADAR_PAGE')}
              {viewMode === 'cards' && moreToDraw && (
                <div ref={feedEndRef} aria-hidden className='h-px' />
              )}
              {/* Below everything, including the pager: the muted
                  group is the floor of the feed, not a page of it. It says how
                  much it is holding, because a rule that turns out to be too
                  wide is only findable if its cost is visible. */}
              {mutedCards.length > 0 && (
                <div className='pt-2'>
                  <button
                    className='w-full flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-left hover:bg-accent'
                    aria-expanded={mutedOpen}
                    data-track-category='RADAR'
                    data-track-name='TOGGLE_MUTED'
                    onClick={() => setMutedOpen(open => !open)}
                  >
                    <BellOff className='size-3.5 text-muted-foreground' />
                    <span className='text-sm font-semibold text-muted-foreground'>Muted</span>
                    <span className='flex-1 text-xs text-muted-foreground'>
                      {mutedItemCount === 1 ? '1 item' : `${mutedItemCount} items`}
                    </span>
                    <ChevronDown
                      className={cn(
                        'size-3.5 text-muted-foreground transition-transform',
                        mutedOpen && 'rotate-180',
                      )}
                    />
                  </button>
                  {mutedOpen &&
                    (viewMode === 'table' ? (
                      <div
                        className={cn(
                          tableMinWidth(),
                          'mt-4 rounded-2xl border border-border opacity-70',
                        )}
                      >
                        {tableHeader()}
                        {mutedSlice.map(({ card, kind }) => renderTableGroup(card, kind))}
                      </div>
                    ) : (
                      <div className='mt-4 space-y-4 opacity-70'>
                        {mutedCards
                          .slice(0, feedLimit)
                          .map(({ card, kind }) => renderCard(card, kind))}
                      </div>
                    ))}
                  {mutedOpen &&
                    viewMode === 'table' &&
                    renderPager(
                      safeMutedPage,
                      mutedPageCount,
                      mutedTotal,
                      setMutedPage,
                      'RADAR_MUTED_PAGE',
                    )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {threadDebug && (
        <div className='w-[440px] shrink-0 h-full border-l border-border bg-card flex flex-col'>
          <div className='px-4 py-3 border-b border-border'>
            <div className='flex items-center gap-2'>
              <Bug className='size-4 text-foreground' />
              <span className='text-sm font-bold text-foreground'>Thread debug</span>
              <button
                className='ml-auto p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent'
                data-track-category='RADAR'
                data-track-name='CLOSE_THREAD_DEBUG'
                onClick={() => setThreadDebug(null)}
              >
                <X className='size-4' />
              </button>
            </div>
            <div
              className='mt-0.5 text-[11px] font-mono text-muted-foreground truncate'
              title={threadDebug.conversationId}
            >
              {threadDebug.conversationId}
            </div>
          </div>
          {threadDebug.loading ? (
            <div className='flex items-center gap-2 text-muted-foreground text-sm px-4 py-6'>
              <Loader2 className='size-4 animate-spin' /> Loading…
            </div>
          ) : threadDebug.notFound ? (
            <div className='text-muted-foreground text-sm px-4 py-6'>
              Thread not found — either the id is wrong or you don&apos;t have access to that
              conversation.
            </div>
          ) : (
            <div className='flex-1 overflow-y-auto'>
              <div className='px-4 py-3 border-b border-border'>
                <div className='text-[11px] font-bold uppercase tracking-wide text-muted-foreground'>
                  Processed till
                </div>
                {threadDebug.threadState ? (
                  <>
                    <div className='mt-1 flex items-center gap-2 text-xs'>
                      <span className='text-foreground font-semibold'>
                        {formatDistanceToNow(new Date(threadDebug.threadState.watermarkCreatedAt), {
                          addSuffix: true,
                        })}
                      </span>
                      {threadDebug.latestMessage &&
                        (threadDebug.threadState.watermarkMsgId ===
                        threadDebug.latestMessage.messageId ? (
                          <span className='px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600'>
                            caught up
                          </span>
                        ) : (
                          <span className='px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-600'>
                            behind latest message
                          </span>
                        ))}
                    </div>
                    {/* Which message, not just when — the timestamp alone never
                        answers what anyone opens this panel to ask. */}
                    {threadDebug.watermarkMessage && (
                      <div className='mt-1.5 px-2 py-1.5 rounded-lg bg-muted text-xs'>
                        <span className='font-semibold text-foreground'>
                          {threadDebug.watermarkMessage.senderId
                            ? nameOf(threadDebug.watermarkMessage.senderId)
                            : 'Someone'}
                        </span>
                        <span className='text-muted-foreground'>
                          : {threadDebug.watermarkMessage.text || '(no text)'}
                        </span>
                      </div>
                    )}
                    {threadDebug.latestMessage &&
                      threadDebug.threadState.watermarkMsgId !==
                        threadDebug.latestMessage.messageId && (
                        <div className='mt-1.5 px-2 py-1.5 rounded-lg border border-amber-500/30 text-xs'>
                          <div className='text-[10px] font-bold uppercase tracking-wide text-amber-600'>
                            Latest, not yet processed
                          </div>
                          <div className='mt-0.5'>
                            <span className='font-semibold text-foreground'>
                              {threadDebug.latestMessage.senderId
                                ? nameOf(threadDebug.latestMessage.senderId)
                                : 'Someone'}
                            </span>
                            <span className='text-muted-foreground'>
                              : {threadDebug.latestMessage.text || '(no text)'}
                            </span>
                          </div>
                        </div>
                      )}
                  </>
                ) : (
                  <div className='mt-1 text-xs text-muted-foreground'>
                    nothing yet — thread never drained
                  </div>
                )}
              </div>

              <div className='px-4 pt-3 pb-1'>
                <div className='text-[11px] font-bold uppercase tracking-wide text-muted-foreground'>
                  Items · {threadDebug.trails.length}
                </div>
                <div className='mt-0.5 text-[11px] text-muted-foreground'>
                  What radar decided exists, and every change since.
                </div>
              </div>
              {threadDebug.trails.map((itemTrail, itemIndex) => (
                <details
                  key={itemTrail.item.id}
                  className='group/item mx-4 my-2 rounded-xl border border-border bg-background'
                >
                  {/* Collapsed by default: a thread of a dozen items is a wall
                      of trails otherwise, and the title plus status is enough
                      to find the one being chased. */}
                  <summary className='cursor-pointer list-none p-3'>
                    <div className='flex items-start gap-2'>
                      <span className='shrink-0 mt-0.5 size-5 rounded-md bg-muted text-[11px] font-bold text-muted-foreground flex items-center justify-center'>
                        {itemIndex + 1}
                      </span>
                      <span className='text-sm font-bold text-foreground leading-snug'>
                        {itemTrail.item.title}
                      </span>
                      <span
                        className={cn(
                          'ml-auto shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold',
                          itemTrail.item.status === 'OPEN'
                            ? 'bg-amber-500/10 text-amber-600'
                            : 'bg-emerald-500/10 text-emerald-600',
                        )}
                      >
                        {itemTrail.item.status}
                      </span>
                      <ChevronRight className='mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open/item:rotate-90' />
                    </div>
                    <div className='mt-1 pl-7 text-[11px] text-muted-foreground'>
                      {itemTrail.mutations.length} change
                      {itemTrail.mutations.length === 1 ? '' : 's'}
                    </div>
                  </summary>
                  <div className='px-3 pb-3'>
                    <div className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs'>
                      <span className='text-muted-foreground'>Pending on</span>
                      <span className='text-foreground font-semibold'>
                        {itemTrail.item.pendingOn.length
                          ? itemTrail.item.pendingOn.map(nameOf).join(', ')
                          : 'nobody'}
                      </span>
                      <span className='text-muted-foreground'>Asked by</span>
                      <span className='text-foreground font-semibold'>
                        {itemTrail.item.requestedBy.map(nameOf).join(', ') || '—'}
                      </span>
                      {/* Whose answer this is: rules are per reader, so this
                          says why the item is hidden FOR ME. */}
                      <span className='text-muted-foreground'>Your rules</span>
                      <span className='text-foreground font-semibold'>
                        {itemTrail.rules.matched.length > 0 ? (
                          <>
                            muted
                            <span className='font-normal text-muted-foreground'>
                              {' by '}
                              {itemTrail.rules.matched[0]!.conditions.map(
                                c =>
                                  `${RULE_SCOPES.find(s => s.id === c.scope)?.chip ?? c.scope} ${c.values
                                    .map(v => ruleValueLabel(c.scope, v))
                                    .join(' or ')}`,
                              ).join(' and ')}
                            </span>
                            {itemTrail.rules.matched.length > 1 && (
                              <span className='font-normal text-muted-foreground'>
                                {` · and ${itemTrail.rules.matched.length - 1} more`}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className='font-normal text-muted-foreground'>
                            no rule of yours matches this
                          </span>
                        )}
                      </span>
                    </div>
                    <div className='mt-2.5 space-y-2.5 border-l-2 border-border pl-3'>
                      {itemTrail.mutations.map(m => {
                        const source = m.sourceMessageId
                          ? itemTrail.sourceMessages[m.sourceMessageId]
                          : undefined;
                        return (
                          <div key={m.id} className='text-xs'>
                            <div className='flex items-center gap-2'>
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded-full text-[11px] font-semibold',
                                  m.op === 'create'
                                    ? 'bg-emerald-500/10 text-emerald-600'
                                    : m.op === 'resolve'
                                      ? 'bg-sky-500/10 text-sky-600'
                                      : 'bg-amber-500/10 text-amber-600',
                                )}
                              >
                                {m.op}
                              </span>
                              <span className='font-semibold text-foreground'>
                                {m.actorType === 'llm'
                                  ? 'LLM parser'
                                  : `${nameOf(m.actorId ?? '')} · by hand`}
                              </span>
                              <span className='ml-auto text-muted-foreground'>
                                {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                              </span>
                            </div>
                            {source && m.actorType === 'llm' && (
                              <div className='mt-1.5 px-2 py-1.5 rounded-lg bg-accent/40 border-l-2 border-[#e8604c]'>
                                <div className='text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
                                  Triggered by
                                </div>
                                <div className='mt-0.5 text-muted-foreground'>
                                  <span className='font-semibold text-foreground'>
                                    {source.senderName}:
                                  </span>{' '}
                                  “{source.text}”
                                </div>
                              </div>
                            )}
                            {typeof m.payload?.['reason'] === 'string' && (
                              <div className='mt-1.5 px-2 py-1.5 rounded-lg bg-[#e8604c]/5'>
                                <div className='text-[10px] font-bold uppercase tracking-wide text-[#e8604c]'>
                                  Reasoning
                                </div>
                                <div className='mt-0.5 text-foreground'>{m.payload['reason']}</div>
                              </div>
                            )}
                            {m.payload &&
                              (() => {
                                const rest = Object.fromEntries(
                                  Object.entries(m.payload).filter(
                                    ([k, v]) => k !== 'reason' && v !== null && v !== undefined,
                                  ),
                                );
                                return Object.keys(rest).length > 0 ? (
                                  <details className='mt-1'>
                                    <summary className='cursor-pointer text-muted-foreground hover:text-foreground'>
                                      payload
                                    </summary>
                                    <pre className='mt-1 p-2 rounded-lg bg-muted overflow-x-auto text-[11px] leading-4'>
                                      {humanizeIds(rest)}
                                    </pre>
                                  </details>
                                ) : null;
                              })()}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </details>
              ))}
              {threadDebug.trails.length === 0 && (
                <div className='px-4 py-3 text-xs text-muted-foreground'>
                  No items were created in this thread.
                </div>
              )}

              <div className='px-4 pt-3 pb-1'>
                <div className='text-[11px] font-bold uppercase tracking-wide text-muted-foreground'>
                  Worker runs · {threadDebug.runs.length}
                </div>
                <div className='mt-0.5 text-[11px] text-muted-foreground'>
                  How it decided — one pass per drain, newest first.
                </div>
              </div>
              <div className='px-4 pb-4 space-y-2'>
                {groupRuns(threadDebug.runs).map((entry, i) =>
                  entry.kind === 'quiet' ? (
                    <details
                      key={`quiet-${i}`}
                      className='rounded-xl border border-dashed border-border'
                    >
                      <summary className='cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground'>
                        {entry.runs.length} run{entry.runs.length === 1 ? '' : 's'} with no change
                        {entry.runs.at(-1) &&
                          ` · ${formatDistanceToNow(new Date(entry.runs.at(-1)!.createdAt), {
                            addSuffix: true,
                          })}`}
                      </summary>
                      <div className='px-2 pb-2 space-y-2'>
                        {entry.runs.map(run => runCard(run))}
                      </div>
                    </details>
                  ) : (
                    runCard(entry.run)
                  ),
                )}
                {threadDebug.runs.length === 0 && (
                  <div className='py-2 text-xs text-muted-foreground'>
                    {threadDebug.trails.length > 0
                      ? 'No runs left — run logs are swept on a retention timer, so the passes that produced these items have aged out.'
                      : 'No runs recorded.'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {showThreadPanel && (
        <div className='w-1/2 shrink-0 flex flex-col h-full bg-background border-l border-border'>
          <div className='flex-1 h-full overflow-hidden'>
            <Outlet context={{ onClose: closeThreadPanel }} />
          </div>
        </div>
      )}

      {/* At the panel's root, not inside the filters: more than one control
          opens it, and it belongs to Radar rather than to any one of them. */}
      {settingsSection !== null && settingsDialog}
    </div>
  );
};

export default RadarPanel;
