import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { QueryResultType } from '@rocicorp/zero';
import { CalendarDays, MessageCircle } from 'lucide-react';
import { PhoneDefault } from '@xyne/icons';
import AvatarGroup from '../../components/ui/Avatar/AvatarGroup';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useCallDuration } from '../../hooks/useCalls';
import { useScrollFade } from '../../hooks/useScrollFade';
import { useUser } from '../../hooks/useUsers';
import { useZero } from '../../hooks/useZero';
import { cn } from '../../utils/classNames';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { queries } from '../../zero/queries';
import { getPreviewParticipantUserIds } from '../CallHistoryScreen/callHistoryItem.utils';
import { isPartOfCall } from './ActivityPill';
import { sdlcItemName, sourceItemOf } from './sdlcItems';

type SdlcCall = QueryResultType<ReturnType<typeof queries.getSdlcCalls>>[number];
type CallPhase = 'LIVE' | 'UPCOMING' | 'PAST';

/** Live and upcoming calls are few; they come in one go. */
const SHORT_LIST_LIMIT = 50;
/** Past calls come a page at a time, the next one asked for as the list nears its end. */
const PAST_PAGE_SIZE = 30;
const LOAD_MORE_WITHIN = 8;
const ROW_HEIGHT = 60;
const HEADER_HEIGHT = 40;
const EMPTY_HEIGHT = 44;
const ROW_OVERSCAN = 8;
/** How far the list fades at an edge, as the file list's does in place of a scrollbar. */
const ROWS_FADE_PX = 48;

type Entry =
  | { kind: 'header'; key: string; label: string; count: number | null }
  | { kind: 'call'; key: string; phase: CallPhase; call: SdlcCall }
  | { kind: 'empty'; key: string; label: string };

/** The conversation a call's discussion is, which the webhook keeps in its metadata. */
function conversationIdOf(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null || !('conversationId' in metadata)) {
    return null;
  }
  return typeof metadata.conversationId === 'string' ? metadata.conversationId : null;
}

/** "Today", "Tomorrow", or the day itself. */
function dayLabel(value: number): string {
  const date = new Date(value);
  const today = new Date();
  const startOf = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(today)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
  });
}

function timeLabel(value: number): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function lengthLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 > 0 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/** What names the places calls are in: the track the list is for, if any, and the hub's tracks. */
interface CallPlaces {
  track: { id: string; name: string } | null;
  hubName: string;
  trackNames: ReadonlyMap<string, string>;
}

/**
 * Where a call was started, by name: the item, the track, or the hub for a call on
 * neither. The hub's list names an item with its track, as the same folder name can
 * be in several.
 */
function placeOf(call: SdlcCall, places: CallPlaces): string {
  const owner = call.sdlcEntityLinks[0];
  if (!owner) return places.hubName;
  if (owner.sourceType === 'TRACK') {
    return places.trackNames.get(owner.sourceId) ?? places.track?.name ?? places.hubName;
  }
  const item = sourceItemOf(owner);
  const itemName = item ? sdlcItemName(item) : null;
  if (places.track) return itemName ?? places.track.name;
  const trackId = (owner.sourceItemLinks ?? [])[0]?.sourceId;
  const trackName = trackId ? places.trackNames.get(trackId) : undefined;
  return [trackName, itemName].filter(Boolean).join(' / ') || places.hubName;
}

/** Now, to the minute: upcoming calls are the ones not over by then. */
function useMinute(): number {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  useEffect(() => {
    const timer = window.setInterval(
      () => setMinute(Math.floor(Date.now() / 60_000) * 60_000),
      60_000,
    );
    return (): void => window.clearInterval(timer);
  }, []);
  return minute;
}

/**
 * The past calls: the first page live, later ones fetched once as the list reaches
 * them. A call that has ended doesn't change, so later pages needn't be live.
 */
function usePastCalls(args: { channelId: string; trackId?: string; invitedOnly: boolean }): {
  calls: SdlcCall[];
  loaded: boolean;
  hasMore: boolean;
  loadMore: () => void;
} {
  const zero = useZero();
  const [firstPage, firstDetails] = useCachedQuery(
    queries.getSdlcCalls({ ...args, phase: 'PAST', limit: PAST_PAGE_SIZE }),
  );
  // Later pages, for the list they were fetched for; another track or filter starts over.
  const listKey = `${args.trackId ?? 'hub'}:${String(args.invitedOnly)}`;
  const [later, setLater] = useState<{ key: string; calls: SdlcCall[]; hasMore: boolean }>({
    key: listKey,
    calls: [],
    hasMore: true,
  });
  const fetching = useRef(false);
  const loaded = firstDetails.type === 'complete';
  const calls = useMemo(() => {
    const first: readonly SdlcCall[] = Array.isArray(firstPage) ? firstPage : [];
    const laterCalls = later.key === listKey ? later.calls : [];
    const seen = new Set(first.map(call => call.id));
    return [...first, ...laterCalls.filter(call => !seen.has(call.id))];
  }, [firstPage, later, listKey]);
  const hasMore =
    loaded && calls.length >= PAST_PAGE_SIZE && (later.key === listKey ? later.hasMore : true);

  const loadMore = (): void => {
    const last = calls.at(-1);
    if (!hasMore || fetching.current || !last || typeof last.endedAt !== 'number') return;
    fetching.current = true;
    const start = { endedAt: last.endedAt, id: last.id };
    void zero
      .run(queries.getSdlcCalls({ ...args, phase: 'PAST', limit: PAST_PAGE_SIZE, start }), {
        type: 'complete',
      })
      .then(page => {
        setLater(current => ({
          key: listKey,
          calls: [...(current.key === listKey ? current.calls : []), ...page],
          hasMore: page.length === PAST_PAGE_SIZE,
        }));
      })
      .finally(() => {
        fetching.current = false;
      });
  };

  return { calls, loaded, hasMore, loadMore };
}

function StartedBy(props: { userId: string }): ReactElement | null {
  const user = useUser(props.userId);
  return user ? <>{getUserDisplayName(user)}</> : null;
}

function LiveLength(props: { startedAt: number }): ReactElement {
  const length = useCallDuration(props.startedAt, true, 'simple');
  return <>{length || 'Just started'}</>;
}

function CallRow(props: {
  call: SdlcCall;
  phase: CallPhase;
  places: CallPlaces;
  open: boolean;
  onOpen: (conversationId: string) => void;
}): ReactElement {
  const { call, phase } = props;
  const place = placeOf(call, props.places);
  const title = call.title?.trim() || `Call in ${place}`;
  // A call started on no track or item has no discussion here to open.
  const conversationId = call.sdlcEntityLinks.length > 0 ? conversationIdOf(call.metadata) : null;
  const people = getPreviewParticipantUserIds(call.participantPreviewUserIds ?? null, undefined);
  const { onOpen } = props;

  let when: ReactNode;
  if (phase === 'LIVE') {
    when = (
      <>
        Started {timeLabel(call.startedAt)} · <LiveLength startedAt={call.startedAt} />
      </>
    );
  } else if (phase === 'UPCOMING') {
    const startsAt = call.startsAt ?? call.startedAt;
    when = `${dayLabel(startsAt)}, ${timeLabel(startsAt)}${
      call.endsAt ? ` – ${timeLabel(call.endsAt)}` : ''
    }`;
  } else {
    when = `${dayLabel(call.startedAt)}, ${timeLabel(call.startedAt)}${
      call.endedAt ? ` · ${lengthLabel(call.endedAt - call.startedAt)}` : ''
    }`;
  }

  return (
    <button
      type='button'
      disabled={!conversationId}
      onClick={() => {
        if (conversationId) onOpen(conversationId);
      }}
      aria-pressed={props.open}
      className={cn(
        'group flex h-full w-full items-center gap-3 rounded-lg px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        props.open ? 'bg-muted' : 'enabled:hover:bg-muted/60',
      )}
      title={conversationId ? `Open the discussion of ${title}` : title}
      data-track-category='SdlcHub'
      data-track-name='SdlcCallOpened'
      data-track-metadata={JSON.stringify({ phase, scope: props.places.track ? 'track' : 'hub' })}
    >
      <span
        className={cn(
          'relative flex size-8 shrink-0 items-center justify-center rounded-full',
          phase === 'LIVE'
            ? 'bg-status-success/15 text-status-success'
            : 'bg-muted text-muted-foreground',
        )}
        aria-hidden='true'
      >
        {phase === 'UPCOMING' ? <CalendarDays className='size-4' /> : <PhoneDefault size={15} />}
        {phase === 'LIVE' && (
          <span className='absolute -right-0.5 -top-0.5 flex size-2.5'>
            <span className='absolute inline-flex size-full rounded-full bg-status-success opacity-60 animate-live-ping motion-reduce:hidden' />
            <span className='relative inline-flex size-full rounded-full border-2 border-background bg-status-success' />
          </span>
        )}
      </span>
      <span className='min-w-0 flex-1'>
        <span className='flex min-w-0 items-center gap-2'>
          <span className='truncate text-sm font-medium text-foreground'>{title}</span>
          {isPartOfCall(call.participants[0]) && (
            <span className='shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10.5px] font-medium text-primary'>
              Invited
            </span>
          )}
        </span>
        <span className='mt-0.5 block truncate text-xs text-muted-foreground'>
          {when}
          {call.title?.trim() ? ` · ${place}` : null}
          {' · by '}
          <StartedBy userId={call.createdByUserId} />
        </span>
      </span>
      {people.length > 0 && <AvatarGroup userIds={people} size='xs' count={3} />}
      {conversationId && (
        <MessageCircle
          className='size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100'
          aria-hidden='true'
        />
      )}
    </button>
  );
}

/**
 * A track's calls, or the whole hub's: the ones going on now, the ones still to come,
 * and the ones that have ended, newest first. A track's are the ones started on it or
 * on anything in it. Opening one shows its discussion beside the list.
 */
export function SdlcCalls(props: {
  channelId: string;
  /** The track whose calls these are; none for the hub's. */
  track: { id: string; name: string } | null;
  hubName: string;
  /** The hub's tracks by id, to say which one each call is in. */
  trackNames: ReadonlyMap<string, string>;
  /** The conversation the panel beside is showing, if any. */
  openConversationId: string | null;
  onOpenCall: (conversationId: string) => void;
  /** The track's discussions; the hub's list has none of its own. */
  onDiscussTrack?: () => void;
  /** Absent for someone outside the hub, who can't start one. */
  onStartCall?: () => void;
}): ReactElement {
  const [invitedOnly, setInvitedOnly] = useState(false);
  const scope = {
    channelId: props.channelId,
    invitedOnly,
    ...(props.track && { trackId: props.track.id }),
  };
  const places = useMemo<CallPlaces>(
    () => ({ track: props.track, hubName: props.hubName, trackNames: props.trackNames }),
    [props.track, props.hubName, props.trackNames],
  );
  const from = useMinute();
  const [liveRows] = useCachedQuery(
    queries.getSdlcCalls({ ...scope, phase: 'LIVE', limit: SHORT_LIST_LIMIT }),
  );
  const [upcomingRows, upcomingDetails] = useCachedQuery(
    queries.getSdlcCalls({ ...scope, phase: 'UPCOMING', from, limit: SHORT_LIST_LIMIT }),
  );
  const past = usePastCalls(scope);

  const live = useMemo<readonly SdlcCall[]>(
    () => (Array.isArray(liveRows) ? liveRows : []),
    [liveRows],
  );
  const upcoming = useMemo<readonly SdlcCall[]>(
    () => (Array.isArray(upcomingRows) ? upcomingRows : []),
    [upcomingRows],
  );
  const nothingYet =
    live.length === 0 &&
    upcoming.length === 0 &&
    past.calls.length === 0 &&
    past.loaded &&
    upcomingDetails.type === 'complete';

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];
    if (live.length > 0) {
      list.push({ kind: 'header', key: 'live', label: 'Live now', count: live.length });
      for (const call of live) list.push({ kind: 'call', key: call.id, phase: 'LIVE', call });
    }
    list.push({ kind: 'header', key: 'upcoming', label: 'Upcoming', count: null });
    if (upcoming.length === 0) {
      list.push({ kind: 'empty', key: 'upcoming-empty', label: 'Nothing scheduled' });
    }
    for (const call of upcoming) list.push({ kind: 'call', key: call.id, phase: 'UPCOMING', call });
    list.push({ kind: 'header', key: 'past', label: 'Past', count: null });
    if (past.loaded && past.calls.length === 0) {
      list.push({ kind: 'empty', key: 'past-empty', label: 'No calls have ended yet' });
    }
    for (const call of past.calls) list.push({ kind: 'call', key: call.id, phase: 'PAST', call });
    return list;
  }, [live, upcoming, past.calls, past.loaded]);

  const rowsFade = useScrollFade<HTMLDivElement>('y', ROWS_FADE_PX);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => rowsFade.node.current,
    estimateSize: index => {
      const entry = entries[index];
      if (entry?.kind === 'header') return HEADER_HEIGHT;
      if (entry?.kind === 'empty') return EMPTY_HEIGHT;
      return ROW_HEIGHT;
    },
    overscan: ROW_OVERSCAN,
    getItemKey: index => entries[index]?.key ?? index,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastShown = virtualRows.at(-1)?.index ?? 0;
  useEffect(() => {
    if (lastShown >= entries.length - LOAD_MORE_WITHIN) past.loadMore();
    // Only the list reaching its end asks for more; loadMore reads the latest page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastShown, entries.length]);

  const filterButton = (value: boolean, label: string): ReactElement => (
    <button
      type='button'
      aria-pressed={invitedOnly === value}
      onClick={() => setInvitedOnly(value)}
      className={cn(
        'rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors',
        invitedOnly === value
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
      data-track-category='SdlcHub'
      data-track-name='SdlcCallsFiltered'
      data-track-metadata={JSON.stringify({ invitedOnly: value })}
    >
      {label}
    </button>
  );

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex shrink-0 items-center gap-2 pb-3'>
        <div
          role='group'
          aria-label='Which calls'
          className='flex items-center rounded-lg bg-muted p-0.5'
        >
          {filterButton(false, 'All calls')}
          {filterButton(true, 'Invited')}
        </div>
        <div className='ml-auto flex items-center gap-2'>
          {props.onDiscussTrack && (
            <button
              type='button'
              onClick={props.onDiscussTrack}
              className='flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted'
              data-track-category='SdlcHub'
              data-track-name='TrackCallsChatOpened'
            >
              <MessageCircle className='size-[14px]' />
              Discussions
            </button>
          )}
          {props.onStartCall && (
            <button
              type='button'
              onClick={props.onStartCall}
              className='flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90'
              data-track-category='SdlcHub'
              data-track-name='SdlcCallsStartCallOpened'
            >
              <PhoneDefault size={14} />
              Start a call
            </button>
          )}
        </div>
      </div>

      {nothingYet ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-2 pb-16 text-center'>
          <span className='flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground'>
            <PhoneDefault size={18} />
          </span>
          <p className='text-sm font-medium'>
            {invitedOnly
              ? 'No calls you were invited to'
              : `No calls in ${props.track?.name ?? props.hubName} yet`}
          </p>
          <p className='max-w-sm text-xs text-muted-foreground'>
            {props.track
              ? 'A call started on this track, or on anything in it, shows here and becomes one of its discussions.'
              : 'Calls started anywhere in the hub show here: on a track, on anything in one, or on the hub itself.'}
          </p>
        </div>
      ) : (
        <div
          ref={rowsFade.ref}
          onScroll={rowsFade.onScroll}
          style={rowsFade.style}
          className='no-scrollbar min-h-0 flex-1 overflow-y-auto pb-6'
        >
          <div className='relative w-full' style={{ height: virtualizer.getTotalSize() }}>
            {virtualRows.map(row => {
              const entry = entries[row.index];
              if (!entry) return null;
              return (
                <div
                  key={row.key}
                  className='absolute inset-x-0 top-0'
                  style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                >
                  {entry.kind === 'header' ? (
                    <h3 className='flex h-full items-end gap-1.5 px-3 pb-2 text-xs font-medium text-muted-foreground'>
                      {entry.label}
                      {entry.count !== null && (
                        <span className='tabular-nums text-status-success'>{entry.count}</span>
                      )}
                    </h3>
                  ) : entry.kind === 'empty' ? (
                    <p className='flex h-full items-center px-3 text-sm text-muted-foreground'>
                      {entry.label}
                    </p>
                  ) : (
                    <CallRow
                      call={entry.call}
                      phase={entry.phase}
                      places={places}
                      open={
                        props.openConversationId !== null &&
                        conversationIdOf(entry.call.metadata) === props.openConversationId
                      }
                      onOpen={props.onOpenCall}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
