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
import {
  Bug,
  Check,
  ChevronRight,
  Hash,
  Hourglass,
  ListFilter,
  Loader2,
  MoreHorizontal,
  Search,
  Radar as RadarIcon,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';
import {
  fetchRadarDebugRuns,
  fetchRadarItemTrail,
  fetchRadarPendingMe,
  fetchRadarPendingOthers,
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
} from '../../api/radarApi';
import { ChannelScopeType } from '@xyne/shared';
import { useAuth } from '../../hooks/useAuth';
import { useRadarEnabled } from '../../hooks/radarCacConfig';
import { usePersistedRadarFilters } from '../../hooks/usePersistedRadarFilters';
import {
  MAX_TEAM_MEMBERS,
  usePersistedRadarTeams,
  type RadarTeam,
} from '../../hooks/usePersistedRadarTeams';
import { useActiveUsers, useUsersById } from '../../hooks/useUsers';
import { useAllChannels } from '../../hooks/useChannels';
import { cn } from '../../utils/classNames';
import { getUserDisplayName, matchesUserQuery } from '../../utils/userDisplayName';
import { Dialog } from '../ui/Dialog/Dialog';
import Avatar from '../ui/Avatar/Avatar';
import { Tooltip } from '../ui/Tooltip';

type RadarTab = 'all' | 'pending' | 'waiting';

/** Avatars rendered before the stack collapses into a +N chip. */
const AVATARS_SHOWN = 3;

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
  // The manage-teams dialog is transient: which team is being edited and the
  // half-typed draft describe the dialog, not the feed, so none of it persists.
  const [manageTeams, setManageTeams] = useState(false);
  const [teamDraft, setTeamDraft] = useState<{
    id: string | null;
    name: string;
    memberIds: Set<string>;
  } | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  // Radix restores focus to its own trigger on close; this dialog has none,
  // so the opener is remembered here and given focus back by hand.
  const manageTeamsOpenerRef = useRef<HTMLButtonElement>(null);
  // Requested by defaults to the reading almost everyone wants, so it opens
  // shut: the header carries the current choice, and only someone who wants
  // the other one has to open it.
  const [requestedByOpen, setRequestedByOpen] = useState(false);
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
          othersMode === 'all' ? fetchRadarPendingOthers() : fetchRadarWaitingOn(),
        ]);
        if (!isCurrent()) return;
        setPending(p);
        setWaiting(w);
      } catch {
        if (!background && isCurrent()) {
          setPending([]);
          setWaiting([]);
        }
      } finally {
        if (!background && isCurrent()) setLoading(false);
      }
    },
    // othersMode alone: it picks which endpoint Others reads. The tick states
    // only choose what is rendered from what is already here.
    [othersMode],
  );

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
  const shortAgo = (card: RadarThreadCard): string => {
    const latest = card.items.reduce(
      (max, i) => Math.max(max, new Date(i.updatedAt).getTime()),
      card.lastActivityAt ? new Date(card.lastActivityAt).getTime() : 0,
    );
    if (!latest) return '';
    const mins = Math.max(0, Math.round((Date.now() - latest) / 60000));
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.round(mins / 60)}h`;
    const days = Math.round(mins / 1440);
    return days < 14 ? `${days}d` : `${Math.round(days / 7)}w`;
  };

  const cardMeta = (card: RadarThreadCard): string =>
    [channelLabel(card.channelId), shortAgo(card)].filter(Boolean).join(' · ');

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

  const renderItemBody = (card: RadarThreadCard, item: RadarFeedItem, index: number | null) => {
    const itemKey = `item:${item.id}`;
    const dismissKey = `dismiss:${item.id}`;
    return (
      <div
        key={item.id}
        className={cn('group flex items-start gap-3', index !== null && index > 0 && 'mt-5')}
      >
        <div className='flex-1 min-w-0'>
          <button
            data-track-category='RADAR'
            data-track-name='OPEN_THREAD_FROM_ITEM'
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

  const renderCard = (card: RadarThreadCard, kind: 'pending' | 'waiting') => {
    const key = `${kind}:${card.scopeKey}`;
    const busy = busyKey === key;
    const multi = card.items.length > 1;
    const dismissable = selfId ? card.items.filter(i => i.pendingOn.includes(selfId)).length : 0;
    const resolvable = selfId
      ? card.items.filter(i => i.requestedBy.includes(selfId) || i.pendingOn.includes(selfId))
          .length
      : 0;
    const menuOpen = cardMenu === key;
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
            <span className='ml-auto flex items-center'>
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
            </span>
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

  // Neither box ticked reads the same as both: no narrowing.
  const tab: RadarTab = pendingMe === pendingOthers ? 'all' : pendingMe ? 'pending' : 'waiting';

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
    ...new Set([...waiting.flatMap(c => c.items.flatMap(i => i.pendingOn)), ...pendingUsers]),
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
    pendingOthers && effectivePendingUsers.size
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
  const channelFacet = new Set(cards.map(c => c.card.channelId));

  if (timeRange !== 'any') {
    // When the item was raised, not when the thread was last touched: a
    // months-old ask does not become recent because someone replied today.
    const createdOf = (card: RadarThreadCard): number =>
      card.items.reduce((min, i) => Math.min(min, new Date(i.createdAt).getTime()), Infinity);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const from =
      timeRange === 'today'
        ? dayStart.getTime()
        : timeRange === '7d'
          ? Date.now() - 7 * 864e5
          : timeRange === '30d'
            ? Date.now() - 30 * 864e5
            : customFrom
              ? new Date(customFrom).getTime()
              : 0;
    // The picker gives a date, not an instant — an inclusive end means the
    // whole of that day, otherwise "to today" silently excludes today.
    const to = timeRange === 'custom' && customTo ? new Date(customTo).getTime() + 864e5 : Infinity;
    cards = cards.filter(({ card }) => {
      const t = createdOf(card);
      return Number.isFinite(t) && t >= from && t <= to;
    });
  }

  if (filterChannels.size) {
    cards = cards.filter(({ card }) => filterChannels.has(card.channelId));
  }

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
  const activeFilterCount =
    (pendingMe ? 1 : 0) +
    (pendingMe ? excludedRequesters.size : 0) +
    (pendingOthers ? 1 : 0) +
    (pendingOthers ? teams.filter(t => teamIds.has(t.id)).length + pendingUsers.size : 0) +
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
  ): ReactElement => {
    const visible = ids.filter(id =>
      nameOf(id).toLowerCase().includes(search.trim().toLowerCase()),
    );
    const isOn = (id: string): boolean =>
      mode === 'exclude' ? !selected.has(id) : selected.has(id);
    // Select all follows the search: with a query typed, it means the names on
    // screen, not the ones hidden behind it. In exclude mode it only ever puts
    // people back.
    const allVisibleOn = visible.length > 0 && visible.every(isOn);
    return (
      <div className='mt-3 ml-8 rounded-xl border border-border overflow-hidden'>
        <div className='px-3 py-2 bg-muted/40 text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
          {heading}
        </div>
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
        {/* With everyone already in, there is nothing to select. */}
        {(mode === 'include' || selected.size > 0) && (
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
              {ids.length === 0 ? 'Nobody here yet.' : 'No one matches.'}
            </div>
          )}
          {visible.map(id => (
            <button
              key={id}
              className='w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent focus:outline-none focus-visible:bg-accent'
              data-track-category='RADAR'
              data-track-name='FILTER_PENDING_USER'
              onClick={() => {
                const next = new Set(selected);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setSelected(next);
              }}
            >
              <Avatar userId={id} size='rg' showActiveStatus className='shrink-0 rounded-lg' />
              <span className='flex-1 text-left truncate'>{nameOf(id)}</span>
              {checkbox(isOn(id))}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // Every active member bar the viewer. A team narrows Others, which is
  // "pending on someone else", so the viewer's own name would be a member that
  // can never match — and so would someone who has left.
  // Sorted once per roster change rather than on every keystroke anywhere in
  // the panel, and searched with the predicate the rest of the app uses, so an
  // email or an out-of-order two-token query finds the same person here as in
  // cmd+K. The label is the same field that predicate reads, so a row can
  // never match on a name it does not show.
  const sortedTeamCandidates = useMemo(
    () =>
      activeUsers
        .filter(u => u.id !== selfId)
        .map(u => ({ id: u.id, label: getUserDisplayName(u), user: u }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [activeUsers, selfId],
  );
  const teamCandidates = sortedTeamCandidates.filter(c => matchesUserQuery(c.user, memberSearch));

  const selectedTeamNames = teams.filter(t => teamIds.has(t.id)).map(t => t.name);

  // Reads back the sentence the two halves make: who asked, then whose queue.
  // Teams are named because the name is the point of having made one; loose
  // people are counted, since a list of them is the thing a team replaces.
  // The Me half reads the same way: who is excluded, if anyone.
  const meSummary = ((): string => {
    const excluded = [...excludedRequesters];
    if (excluded.length === 0) return 'from anyone';
    // Same shape as the Others half: name the first, count the rest.
    const rest = excluded.length - 1;
    return `all but ${nameOf(excluded[0] ?? '')}${rest ? ` +${rest}` : ''}`;
  })();

  const othersSummary = ((): string => {
    const requester = othersMode === 'me' ? 'requested by me' : 'requested by anyone';
    const peopleCount = pendingUsers.size;
    if (selectedTeamNames.length === 0 && peopleCount === 0) return `${requester} · everyone`;
    if (selectedTeamNames.length === 0) {
      return `${requester} · ${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}`;
    }
    const shown = selectedTeamNames.slice(0, 2);
    const extra = selectedTeamNames.length - shown.length + peopleCount;
    return `${requester} · ${shown.join(', ')}${extra ? ` +${extra}` : ''}`;
  })();

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
        <ChevronRight
          className={cn(
            'size-3.5 text-muted-foreground transition-transform',
            requestedByOpen && 'rotate-90',
          )}
        />
      </button>
      {requestedByOpen &&
        [
          { id: 'me' as const, label: 'Me', hint: 'What you are chasing' },
          { id: 'all' as const, label: 'Anyone', hint: 'Everything on them, whoever asked' },
        ].map(mode => (
          <button
            key={mode.id}
            className='w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent focus:outline-none focus-visible:bg-accent'
            data-track-category='RADAR'
            data-track-name='FILTER_OTHERS_MODE'
            onClick={() => setOthersMode(mode.id)}
          >
            <span className='flex-1 text-left'>
              <span className='block font-bold'>{mode.label}</span>
              <span className='block text-xs text-muted-foreground'>{mode.hint}</span>
            </span>
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
          ref={manageTeamsOpenerRef}
          className='text-[11px] font-bold text-[#e8604c] hover:underline'
          data-track-category='RADAR'
          data-track-name={teams.length === 0 ? 'CREATE_TEAM_FROM_EMPTY' : 'OPEN_MANAGE_TEAMS'}
          onClick={() => {
            setTeamDraft(teams.length === 0 ? { id: null, name: '', memberIds: new Set() } : null);
            setManageTeams(true);
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
    setTeamDraft(null);
    setManageTeams(false);
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

  const closeManageTeams = (): void => {
    setManageTeams(false);
    setTeamDraft(null);
    setMemberSearch('');
    // After Radix's own unmount focus handling, which runs on a zero timeout.
    setTimeout(() => manageTeamsOpenerRef.current?.focus(), 50);
  };

  // The app's Dialog, so Escape, the focus trap, focus restore and the portal
  // all come for free instead of being rebuilt here one bug at a time.
  const manageTeamsDialog = (
    <Dialog
      open={manageTeams}
      onOpenChange={open => {
        if (!open) closeManageTeams();
      }}
      title={teamDraft ? (teamDraft.id ? 'Edit team' : 'New team') : 'Teams'}
      description={
        teamDraft ? 'Name the team and pick its members.' : 'Saved groups you can filter by.'
      }
      className='max-w-[520px] rounded-2xl border border-border overflow-hidden'
      // The drawer variant drops title, description and className on the
      // floor; this is a small form, and a dialog on every width keeps it one.
      mobileVariant='dialog'
    >
      <div className='flex flex-col max-h-[80vh]'>
        <div className='flex items-start gap-3 px-5 pt-4 pb-3 border-b border-border'>
          <div className='flex-1 min-w-0'>
            <div className='text-base font-bold'>
              {teamDraft ? (teamDraft.id ? 'Edit team' : 'New team') : 'Teams'}
            </div>
          </div>
          <button
            aria-label='Close'
            className='shrink-0 p-1 rounded-md text-muted-foreground hover:bg-accent'
            data-track-category='RADAR'
            data-track-name='CLOSE_MANAGE_TEAMS'
            onClick={closeManageTeams}
          >
            <X className='size-4' />
          </button>
        </div>

        <div className='flex-1 overflow-y-auto px-5 py-4'>
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
                      {team.memberIds.length === 1
                        ? '1 member'
                        : `${team.memberIds.length} members`}
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
                      setTeamDraft({
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
              <button
                className='rounded-xl border border-dashed border-border px-3.5 py-3 text-sm font-bold text-[#e8604c] hover:bg-accent'
                data-track-category='RADAR'
                data-track-name='NEW_TEAM'
                onClick={() => setTeamDraft({ id: null, name: '', memberIds: new Set() })}
              >
                + New team
              </button>
            </div>
          )}

          {teamDraft && (
            <div>
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
                  {teamDraft.memberIds.size
                    ? `${teamDraft.memberIds.size} selected`
                    : 'none selected'}
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
                {teamCandidates.length === 0 && (
                  <div className='px-3 py-2 text-xs text-muted-foreground'>
                    {memberSearch.trim() ? 'No one matches.' : 'Nobody here yet.'}
                  </div>
                )}
                {teamCandidates.map(candidate => {
                  const picked = teamDraft.memberIds.has(candidate.id);
                  // The cap is what the picker enforces: past it, only
                  // unticking stays available.
                  const full = !picked && teamDraft.memberIds.size >= MAX_TEAM_MEMBERS;
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
                        const next = new Set(teamDraft.memberIds);
                        if (next.has(candidate.id)) next.delete(candidate.id);
                        else next.add(candidate.id);
                        setTeamDraft({ ...teamDraft, memberIds: next });
                      }}
                    >
                      <Avatar
                        userId={candidate.id}
                        size='rg'
                        showActiveStatus
                        className='shrink-0 rounded-lg'
                      />
                      <span className='flex-1 text-left truncate'>{candidate.label}</span>
                      {checkbox(picked)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className='flex items-center gap-3 px-5 py-3 border-t border-border'>
          <span className='flex-1 text-xs text-muted-foreground'>
            {teamDraft ? '' : teams.length === 1 ? '1 team' : `${teams.length} teams`}
          </span>
          <button
            className='rounded-full px-4 py-2 text-sm font-semibold hover:bg-accent'
            data-track-category='RADAR'
            data-track-name='MANAGE_TEAMS_BACK'
            onClick={() => {
              if (teamDraft) setTeamDraft(null);
              else setManageTeams(false);
            }}
          >
            {teamDraft ? 'Back' : 'Done'}
          </button>
          {teamDraft && (
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
          )}
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
          {railItem('pending', 'Pending', (pendingMe ? 1 : 0) + (pendingOthers ? 1 : 0))}
          {railItem('channels', 'Channels', filterChannels.size)}
          {railItem('time', 'Time', timeRange === 'any' ? 0 : 1)}
        </div>

        <div className='flex-1 min-w-0 p-6 max-h-[38rem] overflow-y-auto'>
          {filterCategory === 'pending' && (
            <>
              <div className='text-sm font-semibold text-muted-foreground mb-3'>Pending on</div>
              <button
                className='w-full flex items-center gap-3 pl-2 pr-[13px] py-2.5 rounded-lg text-sm hover:bg-accent'
                data-track-category='RADAR'
                data-track-name='FILTER_PENDING_ME'
                onClick={() => setPendingMe(v => !v)}
              >
                <span className='flex-1 min-w-0 flex items-baseline gap-2 text-left'>
                  <span className='font-bold'>Me</span>
                  {pendingMe && (
                    <span className='truncate text-xs text-muted-foreground'>{meSummary}</span>
                  )}
                </span>
                {checkbox(pendingMe)}
              </button>
              {pendingMe &&
                userPicker(
                  'Requested by',
                  requesterOptions,
                  excludedRequesters,
                  setExcludedRequesters,
                  requesterSearch,
                  setRequesterSearch,
                  'exclude',
                )}
              <button
                className={cn(
                  'w-full flex items-center gap-3 pl-2 pr-[13px] py-2.5 rounded-lg text-sm hover:bg-accent',
                  // Clear of the picker above, so the two halves read as two.
                  pendingMe && 'mt-8',
                )}
                data-track-category='RADAR'
                data-track-name='FILTER_PENDING_OTHERS'
                onClick={() => {
                  setPendingOthers(v => !v);
                  if (pendingOthers) {
                    setPendingUsers(new Set());
                    setTeamIds(new Set());
                  }
                }}
              >
                <span className='flex-1 min-w-0 flex items-baseline gap-2 text-left'>
                  <span className='font-bold'>Others</span>
                  {pendingOthers && (
                    <span className='truncate text-xs text-muted-foreground'>{othersSummary}</span>
                  )}
                </span>
                {checkbox(pendingOthers)}
              </button>
              {pendingOthers && teamsPicker}
              {pendingOthers &&
                userPicker(
                  'Pending on · people',
                  otherHolders,
                  pendingUsers,
                  setPendingUsers,
                  holderSearch,
                  setHolderSearch,
                  'include',
                )}
              {pendingOthers && othersModePicker}
            </>
          )}

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
          <div className='ml-auto flex items-center gap-1.5'>
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
          </div>
        </div>
        <div className='flex items-center flex-wrap gap-2 px-6 pb-5'>
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
            {manageTeams && manageTeamsDialog}
          </span>
        </div>

        <div className='flex-1 overflow-y-auto px-6 pb-8'>
          {loading ? (
            <div className='flex items-center gap-2 text-muted-foreground text-sm py-8'>
              <Loader2 className='size-4 animate-spin' /> Loading…
            </div>
          ) : cards.length === 0 ? (
            <div className='text-muted-foreground text-sm py-8'>
              {tab === 'waiting'
                ? 'Nothing pending on anyone else.'
                : tab === 'pending'
                  ? 'Nothing pending on you. Enjoy the quiet.'
                  : 'Nothing on the radar.'}
            </div>
          ) : (
            <div className='space-y-4 max-w-3xl'>
              {cards.map(({ card, kind }) => renderCard(card, kind))}
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
    </div>
  );
};

export default RadarPanel;
