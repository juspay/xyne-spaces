import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import {
  Bug,
  Check,
  CheckCircle,
  ChevronDown,
  Hash,
  Hourglass,
  Loader2,
  Radar as RadarIcon,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';
import {
  createRadarTeam,
  deleteRadarTeam,
  fetchRadarDebugRuns,
  fetchRadarItemTrail,
  fetchRadarPendingMe,
  fetchRadarTeamFeed,
  fetchRadarTeams,
  fetchRadarWaitingOn,
  resolveAllRadarItems,
  resolveRadarItem,
  updateRadarTeam,
  RadarItemTrail,
  RadarRunLog,
  RadarRunsResult,
  RadarTeam,
  RadarTeamFeedItem,
  RadarThreadCard,
  RadarFeedItem,
} from '../../api/radarApi';
import { ChannelScopeType } from '@xyne/shared';
import { useAuth } from '../../hooks/useAuth';
import { useRadarEnabled } from '../../hooks/radarCacConfig';
import { useUsersById } from '../../hooks/useUsers';
import { useAllChannels } from '../../hooks/useChannels';
import { cn } from '../../utils/classNames';

type RadarTab = 'all' | 'pending' | 'waiting';

const AVATAR_COLORS = [
  'bg-sky-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-emerald-600',
  'bg-rose-500',
  'bg-indigo-600',
] as const;

/** Avatars rendered before the stack collapses into a +N chip. */
const AVATARS_SHOWN = 3;

const colorFor = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
};

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

/**
 * Radar — the execution feed. Card-based views over the open-item ledger:
 * Pending me (I hold the ball) and Waiting on (I asked, someone else acts),
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
  const channels = useAllChannels();
  const [tab, setTab] = useState<RadarTab>('pending');
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
    /** Lookup 404: unknown thread, or one the viewer has no channel access to. */
    notFound?: boolean;
  } | null>(null);
  const [teams, setTeams] = useState<RadarTeam[]>([]);
  const [scope, setScope] = useState<string>('me');
  const [teamItems, setTeamItems] = useState<RadarTeamFeedItem[]>([]);
  const [teamForm, setTeamForm] = useState<
    { mode: 'create' } | { mode: 'edit'; teamId: string } | null
  >(null);
  const [teamName, setTeamName] = useState('');
  const [teamMembers, setTeamMembers] = useState<Set<string>>(new Set());
  const [memberAdd, setMemberAdd] = useState('');
  const [teamSaving, setTeamSaving] = useState(false);
  const [debugLookup, setDebugLookup] = useState('');
  // Client-side channel filter (DMs included), rendered beside Scope.
  const [filterChannels, setFilterChannels] = useState<Set<string>>(new Set());
  const [channelFilterOpen, setChannelFilterOpen] = useState(false);

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
        if (scope === 'me') {
          const [p, w] = await Promise.all([fetchRadarPendingMe(), fetchRadarWaitingOn()]);
          if (!isCurrent()) return;
          setPending(p);
          setWaiting(w);
        } else {
          const items = await fetchRadarTeamFeed(scope);
          if (!isCurrent()) return;
          setTeamItems(items);
        }
      } catch {
        if (!background && isCurrent()) {
          setPending([]);
          setWaiting([]);
          setTeamItems([]);
        }
      } finally {
        if (!background && isCurrent()) setLoading(false);
      }
    },
    [scope],
  );

  useEffect(() => {
    if (!radarEnabled) return;
    void fetchRadarTeams()
      .then(setTeams)
      .catch(() => {});
  }, [radarEnabled]);

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
      const selfId = localStorage.getItem('user_id');
      const others = (channel.name ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(id => id !== selfId && usersById.has(id))
        .map(id => usersById.get(id)?.name ?? '');
      return others.length ? `DM · ${others.join(', ')}` : 'Direct message';
    }
    return `#${channel.name}`;
  };

  const openThread = (card: RadarThreadCard) =>
    void navigate(`/chat/dir/radar/${card.channelId}/${card.conversationId}`);

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
  const nameTag = (id: string): string => (id === selfId ? 'you' : `@${nameOf(id)}`);

  const sentAgo = (card: RadarThreadCard): string => {
    const latest = card.items.reduce(
      (max, i) => Math.max(max, new Date(i.updatedAt).getTime()),
      card.lastActivityAt ? new Date(card.lastActivityAt).getTime() : 0,
    );
    return latest ? formatDistanceToNow(latest, { addSuffix: true }) : '';
  };

  // Mock-style meta line: waiting cards say who the ball is with; pending
  // cards say who asked and who holds it.
  const cardMeta = (card: RadarThreadCard, kind: 'pending' | 'waiting'): string => {
    const holders = [...new Set(card.items.flatMap(i => i.pendingOn))];
    const requesters = [...new Set(card.items.flatMap(i => i.requestedBy))];
    const ago = sentAgo(card);
    if (kind === 'waiting') {
      const to = holders.map(nameTag).join(', ') || 'nobody yet';
      return `${channelLabel(card.channelId)} · Sent ${ago} to ${to}`;
    }
    const by = requesters.map(nameTag).join(', ') || 'someone';
    const on = holders.map(nameTag).join(', ') || 'nobody';
    return `${channelLabel(card.channelId)} · Sent ${ago} by ${by} · pending on ${on}`;
  };

  const pill = (which: RadarTab, label: string, icon: ReactElement) => (
    <button
      className={cn(
        'flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-full border transition-colors',
        tab === which
          ? 'bg-foreground text-background border-foreground'
          : 'bg-card text-muted-foreground border-border hover:text-foreground hover:bg-accent/50',
      )}
      data-track-category='RADAR'
      data-track-name='SWITCH_TAB'
      onClick={() => {
        setTab(which);
        // Switching tabs is the "show me what's current" gesture now that
        // nothing polls — refetch quietly behind the already-rendered list.
        void load(true);
      }}
    >
      {icon}
      {label}
    </button>
  );

  const badge = (kind: 'pending' | 'waiting', count: number) => (
    <span
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
        kind === 'pending' ? 'bg-[#e8604c]/10 text-[#e8604c]' : 'bg-muted text-muted-foreground',
      )}
    >
      {kind === 'pending' ? <Zap className='size-3' /> : <Hourglass className='size-3' />}
      {kind === 'pending' ? (scope === 'me' ? 'Pending Me' : 'Pending Team') : 'Waiting On'}
      {count > 1 ? ` (${count} Items)` : ''}
    </span>
  );

  const renderItemBody = (card: RadarThreadCard, item: RadarFeedItem, index: number | null) => {
    const itemKey = `item:${item.id}`;
    return (
      <div
        key={item.id}
        className={cn('group flex items-start gap-2', index !== null && index > 0 && 'mt-3')}
      >
        <div className='flex-1 min-w-0'>
          <button
            data-track-category='RADAR'
            data-track-name='OPEN_THREAD_FROM_ITEM'
            className='text-left font-bold text-foreground hover:underline text-[15px]'
            onClick={() => openThread(card)}
          >
            {index !== null ? `${index + 1}. ${item.title}` : item.title}
          </button>
          {item.contextSummary && (
            <ul className='mt-1.5 space-y-1'>
              <li className='flex items-start gap-2 text-sm text-muted-foreground'>
                <span className='mt-[7px] size-1 rounded-full bg-muted-foreground shrink-0' />
                <span>
                  {item.contextSummary}{' '}
                  <button
                    className='inline-flex px-1.5 rounded bg-muted text-[11px] font-semibold text-muted-foreground hover:text-foreground align-middle'
                    data-track-category='RADAR'
                    data-track-name='OPEN_SOURCE_THREAD'
                    title='Open source thread'
                    onClick={() => openThread(card)}
                  >
                    [1]
                  </button>
                </span>
              </li>
            </ul>
          )}
        </div>
        <button
          data-track-category='RADAR'
          data-track-name='RESOLVE_ITEM'
          title='Resolve this item'
          className='p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-accent transition-colors disabled:opacity-50 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
          disabled={busyKey === itemKey}
          onClick={() => void withBusy(itemKey, () => resolveRadarItem(item.id))}
        >
          {busyKey === itemKey ? (
            <Loader2 className='size-4 animate-spin' />
          ) : (
            <CheckCircle className='size-4' />
          )}
        </button>
      </div>
    );
  };

  const renderCard = (card: RadarThreadCard, kind: 'pending' | 'waiting') => {
    const key = `${kind}:${card.conversationId}`;
    const busy = busyKey === key;
    const multi = card.items.length > 1;
    const involved = cardUsers(card);
    const involvedNames = involved.map(nameOf).join(', ');

    return (
      <div
        key={key}
        className='relative group/card rounded-2xl border border-border bg-card text-card-foreground border-l-[3px] border-l-[#e8604c] shadow-sm'
      >
        <div className='px-5 pt-4 flex items-center gap-3'>
          {badge(kind, card.items.length)}
          <span
            className='relative flex -space-x-1.5 group/avatars'
            aria-label={`Involved: ${involvedNames}`}
          >
            {involved.slice(0, AVATARS_SHOWN).map(id => (
              <span
                key={id}
                className={cn(
                  'size-6 rounded-full text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-card',
                  colorFor(id),
                )}
              >
                {initialsOf(nameOf(id))}
              </span>
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
          <span className='text-sm text-muted-foreground truncate'>{cardMeta(card, kind)}</span>
        </div>

        <div className='px-5 pt-3 pb-4'>
          {card.items.map((item, i) => renderItemBody(card, item, multi ? i : null))}

          {multi && (
            <div className='mt-4 flex items-center gap-2'>
              <button
                className='flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50'
                disabled={busy}
                data-track-category='RADAR'
                data-track-name='RESOLVE_ALL_ITEMS'
                onClick={() => void withBusy(key, () => resolveAllRadarItems(card.conversationId))}
              >
                {busy ? <Loader2 className='size-4 animate-spin' /> : <Check className='size-4' />}
                Resolve All
              </button>
            </div>
          )}
        </div>
        <button
          data-track-category='RADAR'
          data-track-name='OPEN_THREAD_DEBUG'
          title="This thread's entire run history"
          className='absolute bottom-2.5 right-3 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100'
          onClick={() => openThreadDebug(card)}
        >
          <Bug className='size-3.5' />
          Debug
        </button>
      </div>
    );
  };

  // Single-team model: "Only Me" vs "Me + Team". The first team is THE team.
  const team = teams[0] ?? null;
  const activeTeam = scope === 'me' ? null : (teams.find(t => t.id === scope) ?? null);
  const teamMemberSet = useMemo(() => new Set(activeTeam?.memberIds ?? []), [activeTeam]);
  const inTeam = (ids: string[]) => ids.some(id => teamMemberSet.has(id));

  let cards: Array<{ card: RadarThreadCard; kind: 'pending' | 'waiting' }>;
  if (!activeTeam) {
    cards = [
      ...(tab !== 'waiting' ? pending.map(card => ({ card, kind: 'pending' as const })) : []),
      ...(tab !== 'pending' ? waiting.map(card => ({ card, kind: 'waiting' as const })) : []),
    ];
  } else {
    // An item between two members is BOTH pending (the holder is a member)
    // and waited-on (the requester is a member) — it shows under both tabs.
    const filtered = teamItems.filter(item => {
      const pendingHit = inTeam(item.pendingOn);
      const waitingHit = inTeam(item.requestedBy);
      return tab === 'all' ? pendingHit || waitingHit : tab === 'pending' ? pendingHit : waitingHit;
    });
    const byConversation = new Map<string, RadarThreadCard>();
    for (const item of filtered) {
      let card = byConversation.get(item.conversationId);
      if (!card) {
        card = {
          conversationId: item.conversationId,
          channelId: item.channelId,
          threadPreview: null,
          lastActivityAt: null,
          items: [],
        };
        byConversation.set(item.conversationId, card);
      }
      card.items.push(item);
    }
    cards = [...byConversation.values()].map(card => ({
      card,
      kind:
        tab === 'waiting'
          ? ('waiting' as const)
          : tab === 'pending'
            ? ('pending' as const)
            : inTeam(card.items.flatMap(i => i.pendingOn))
              ? ('pending' as const)
              : ('waiting' as const),
    }));
  }

  // Options come from the UNfiltered scope, so a selection never empties the list.
  const channelOptions = [...new Set(cards.map(c => c.card.channelId))];
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

  // Debug JSON is unreadable with raw cuids — swap every known user id for
  // its @name before rendering.
  const humanizeIds = (value: unknown): string => {
    let json = JSON.stringify(value, null, 1);
    for (const [id, user] of usersById) {
      json = json.split(id).join(`@${user.name}`);
    }
    return json;
  };

  const channelFilter = (
    <span className='relative ml-4'>
      {channelFilterOpen && (
        <button
          type='button'
          aria-label='Close channel filter'
          className='fixed inset-0 z-30 cursor-default'
          data-track-category='RADAR'
          data-track-name='CLOSE_CHANNEL_FILTER'
          onClick={() => setChannelFilterOpen(false)}
        />
      )}
      <button
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
          filterChannels.size > 0 || channelFilterOpen
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
        data-track-category='RADAR'
        data-track-name='TOGGLE_CHANNEL_FILTER'
        onClick={() => setChannelFilterOpen(open => !open)}
      >
        Channel
        {filterChannels.size > 0 && (
          <span className='min-w-4 h-4 px-1 rounded-full bg-[#e8604c] text-white text-[10px] font-bold flex items-center justify-center'>
            {filterChannels.size}
          </span>
        )}
        <ChevronDown
          className={cn('size-3.5 transition-transform', channelFilterOpen && 'rotate-180')}
        />
      </button>
      {channelFilterOpen && (
        <div className='absolute left-0 top-full mt-1.5 z-40 w-64 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl py-1.5'>
          <div className='max-h-60 overflow-y-auto'>
            {channelOptions.length === 0 && (
              <div className='px-3 py-2 text-xs text-muted-foreground'>Nothing to filter yet.</div>
            )}
            {channelOptions.map(id => (
              <button
                key={id}
                data-track-category='RADAR'
                data-track-name='FILTER_BY_CHANNEL'
                className='w-full flex items-center gap-2.5 text-left px-3 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  setFilterChannels(prev => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
              >
                <span className='size-6 shrink-0 rounded-lg bg-muted text-muted-foreground flex items-center justify-center'>
                  <Hash className='size-3.5' />
                </span>
                <span className='truncate flex-1'>{filterChannelLabel(id)}</span>
                {filterChannels.has(id) && <Check className='size-4 shrink-0 text-[#e8604c]' />}
              </button>
            ))}
          </div>
          {filterChannels.size > 0 && (
            <div className='mt-1 pt-1.5 border-t border-border px-3'>
              <button
                className='text-xs font-semibold text-muted-foreground hover:text-foreground'
                data-track-category='RADAR'
                data-track-name='CLEAR_CHANNEL_FILTER'
                onClick={() => setFilterChannels(new Set())}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </span>
  );

  const submitTeamForm = () => {
    if (!teamForm) return;
    setTeamSaving(true);
    // "Me + Team": the viewer is always part of their own team.
    const memberIds = [...new Set([...(selfId ? [selfId] : []), ...teamMembers])];
    const name = teamName.trim() || 'Team';
    const request =
      teamForm.mode === 'create'
        ? createRadarTeam(name, memberIds)
        : updateRadarTeam(teamForm.teamId, name, memberIds);
    void request
      .then(saved => {
        setTeams(prev =>
          teamForm.mode === 'create'
            ? [...prev, saved]
            : prev.map(t => (t.id === saved.id ? saved : t)),
        );
        if (teamForm.mode === 'create') setScope(saved.id);
        setTeamForm(null);
        setTeamName('');
        setTeamMembers(new Set());
        void load(true);
      })
      .catch(() => {})
      .finally(() => setTeamSaving(false));
  };

  const memberMatches =
    memberAdd.trim().length > 0
      ? [...usersById.values()]
          .filter(u => !teamMembers.has(u.id))
          .filter(u => u.name.toLowerCase().includes(memberAdd.trim().toLowerCase()))
          .slice(0, 6)
      : [];

  const teamFormPopover = (
    <div className='absolute left-0 top-full mt-2 z-30 w-80 rounded-2xl bg-card border border-border p-4 shadow-xl text-left'>
      <div className='text-sm font-bold text-foreground mb-2'>Team members</div>
      <div className='space-y-1 mb-2'>
        {[...teamMembers].map(id => (
          <div key={id} className='flex items-center gap-2.5 px-1 py-1 text-sm text-foreground'>
            <span
              className={cn(
                'size-7 rounded-full text-white text-[10px] font-bold flex items-center justify-center',
                colorFor(id),
              )}
            >
              {initialsOf(nameOf(id))}
            </span>
            @{nameOf(id)}
            {id === selfId ? (
              <span className='ml-auto text-[11px] font-semibold text-muted-foreground'>you</span>
            ) : (
              <button
                className='ml-auto p-1 rounded text-muted-foreground hover:text-red-500'
                data-track-category='RADAR'
                data-track-name='REMOVE_TEAM_MEMBER'
                title='Remove member'
                onClick={() =>
                  setTeamMembers(prev => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  })
                }
              >
                <X className='size-4' />
              </button>
            )}
          </div>
        ))}
        {teamMembers.size === 0 && (
          <div className='text-xs text-muted-foreground px-1 py-1'>No members yet.</div>
        )}
      </div>
      <div className='relative'>
        <input
          className='w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground'
          data-track-category='RADAR'
          data-track-name='SEARCH_TEAM_MEMBER'
          placeholder='+ Add member @mention'
          value={memberAdd}
          onChange={e => setMemberAdd(e.target.value)}
        />
        {memberMatches.length > 0 && (
          <div className='absolute left-0 right-0 top-full mt-1 z-40 rounded-xl border border-border bg-popover text-popover-foreground shadow-lg py-1 max-h-44 overflow-y-auto'>
            {memberMatches.map(u => (
              <button
                key={u.id}
                data-track-category='RADAR'
                data-track-name='ADD_TEAM_MEMBER'
                className='w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm hover:bg-accent'
                onClick={() => {
                  setTeamMembers(prev => new Set(prev).add(u.id));
                  setMemberAdd('');
                }}
              >
                <span
                  className={cn(
                    'size-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center',
                    colorFor(u.id),
                  )}
                >
                  {initialsOf(u.name)}
                </span>
                @{u.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className='mt-3 pt-3 border-t border-border flex items-center gap-3'>
        {teamForm?.mode === 'edit' && team && (
          <button
            data-track-category='RADAR'
            data-track-name='DELETE_TEAM'
            className='text-xs font-semibold text-red-500/80 hover:text-red-500'
            onClick={() => {
              void deleteRadarTeam(team.id).then(() => {
                setTeams([]);
                setScope('me');
                setTeamForm(null);
              });
            }}
          >
            Remove team
          </button>
        )}
        <span className='ml-auto flex items-center gap-3'>
          <button
            className='text-sm font-semibold text-muted-foreground hover:text-foreground'
            data-track-category='RADAR'
            data-track-name='CANCEL_TEAM_FORM'
            onClick={() => setTeamForm(null)}
          >
            Cancel
          </button>
          <button
            className='px-4 py-1.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50'
            disabled={teamSaving || teamMembers.size === 0}
            data-track-category='RADAR'
            data-track-name='SAVE_TEAM'
            onClick={submitTeamForm}
          >
            {teamSaving ? 'Saving…' : 'Save'}
          </button>
        </span>
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
        <div className='flex items-center gap-2 px-6 pb-3'>
          {pill('all', 'All', <span />)}
          {pill(
            'pending',
            scope === 'me' ? 'Pending Me' : 'Pending Team',
            <Zap className='size-4' />,
          )}
          {pill('waiting', 'Waiting On', <Hourglass className='size-4' />)}
        </div>
        <div className='flex items-center gap-2 px-6 pb-5'>
          <span className='text-xs font-semibold text-muted-foreground uppercase tracking-wide'>
            Scope
          </span>
          <div className='inline-flex items-center rounded-full border border-border bg-card p-0.5 shadow-sm'>
            <button
              className={cn(
                'px-4 py-1.5 rounded-full text-sm font-semibold transition-colors',
                scope === 'me'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              data-track-category='RADAR'
              data-track-name='SET_SCOPE_ONLY_ME'
              onClick={() => setScope('me')}
            >
              Only Me
            </button>
            <span className='relative'>
              <button
                data-track-category='RADAR'
                data-track-name='SET_SCOPE_TEAM'
                title={
                  team
                    ? scope === team.id
                      ? 'Click again to edit team members'
                      : undefined
                    : 'Pick your team members'
                }
                className={cn(
                  'px-4 py-1.5 rounded-full text-sm font-semibold transition-colors',
                  scope !== 'me'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => {
                  if (!team) {
                    setTeamName('Team');
                    setTeamMembers(new Set(selfId ? [selfId] : []));
                    setMemberAdd('');
                    setTeamForm(f => (f ? null : { mode: 'create' }));
                    return;
                  }
                  if (scope === team.id) {
                    // Second click on the active segment opens the editor.
                    setTeamName(team.name);
                    setTeamMembers(new Set(team.memberIds));
                    setMemberAdd('');
                    setTeamForm(f => (f ? null : { mode: 'edit', teamId: team.id }));
                  } else {
                    setScope(team.id);
                  }
                }}
              >
                Me + Team{team ? ` (${team.memberIds.length})` : ''} ▾
              </button>
              {teamForm && teamFormPopover}
            </span>
          </div>
          {channelFilter}
        </div>

        <div className='flex-1 overflow-y-auto px-6 pb-8'>
          {loading ? (
            <div className='flex items-center gap-2 text-muted-foreground text-sm py-8'>
              <Loader2 className='size-4 animate-spin' /> Loading…
            </div>
          ) : cards.length === 0 ? (
            <div className='text-muted-foreground text-sm py-8'>
              {tab === 'waiting'
                ? "You're not waiting on anyone."
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
                ) : (
                  <div className='mt-1 text-xs text-muted-foreground'>
                    nothing yet — thread never drained
                  </div>
                )}
              </div>

              <div className='px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground'>
                Items · {threadDebug.trails.length}
              </div>
              {threadDebug.trails.map(itemTrail => (
                <div
                  key={itemTrail.item.id}
                  className='mx-4 my-2 rounded-xl border border-border bg-background p-3'
                >
                  <div className='flex items-start gap-2'>
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
                  </div>
                  <div className='mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs'>
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
                              {m.actorType === 'llm' ? 'LLM parser' : nameOf(m.actorId ?? '')}
                            </span>
                            <span className='ml-auto text-muted-foreground'>
                              {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                            </span>
                          </div>
                          {source && (
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
              ))}
              {threadDebug.trails.length === 0 && (
                <div className='px-4 py-3 text-xs text-muted-foreground'>
                  No items were created in this thread.
                </div>
              )}

              <div className='px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground'>
                Worker runs · {threadDebug.runs.length}
              </div>
              <div className='px-4 pb-4 space-y-2'>
                {threadDebug.runs.map(run => (
                  <div
                    key={run.id}
                    className='rounded-xl border border-border bg-background p-3 text-xs'
                  >
                    <div className='flex items-center gap-2'>
                      {runBadge(run)}
                      <span className='text-muted-foreground'>
                        {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                      </span>
                      {run.durationMs !== null && (
                        <span className='ml-auto text-muted-foreground'>{run.durationMs}ms</span>
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
                    {run.error && (
                      <div className='mt-1.5 text-red-500 break-words'>{run.error}</div>
                    )}
                    <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
                      <span className='px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold'>
                        {run.windowSize} msg{run.windowSize === 1 ? '' : 's'}
                      </span>
                      {run.parserRan ? (
                        <>
                          <span className='px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold'>
                            proposed {opCount(run.proposedOps)}
                          </span>
                          <span className='px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold'>
                            valid {opCount(run.validOps)}
                          </span>
                          {opCount(run.droppedOps) > 0 && (
                            <span className='px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 font-semibold'>
                              dropped {opCount(run.droppedOps)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className='px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold'>
                          parser skipped
                        </span>
                      )}
                      {run.applied && (
                        <span className='px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-semibold'>
                          applied +{run.applied.created} ✓{run.applied.resolved} ↺
                          {run.applied.reassigned}
                        </span>
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
                ))}
                {threadDebug.runs.length === 0 && (
                  <div className='py-2 text-xs text-muted-foreground'>No runs recorded.</div>
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
