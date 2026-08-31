import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { DateRangeValue } from '../../ui/DateRangeFilter';
import { DeskMetricsDateRangePicker } from '../DeskMetrics/DeskMetricsDateRangePicker';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, MultipleCrossCancelDefault } from '@xyne/icons';
import { Dialog } from '../../ui/Dialog/Dialog';
import { cn } from '../../../utils/classNames';
import { queries } from '../../../zero/queries';
// Not useCachedQuery: this rollup is throwaway, not warm-start state.
import { useQuery } from '../../../hooks/useQuery';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import { useDeskTagsConfig } from '../../../hooks/useDeskTagsConfig';
import { useUsersById } from '../../../hooks/useUsers';
import { tagsConfigApi } from '../../../api/tagsConfigApi';
import { getApiErrorMessage } from '../../../utils/apiError';
import type { TicketStatusV2 } from '@xyne/shared';
import type { TicketFilters } from '../../Tickets/TicketFilters/types';
import { TopicsFilterBar } from './TopicsFilterBar';
import { TopicsTreemap } from './TopicsTreemap';
import { TopicsTrendPanel } from './TopicsTrendPanel';
import {
  MAX_DEPTH,
  MAX_BOXES,
  MAX_RANGE_DAYS,
  MS_PER_DAY,
  applyTicketFilters,
  buildDimensions,
  buildTrend,
  dimensionFor,
  groupLevel,
  labelFor,
  maxDailyCount,
  planDrill,
  swatchFor,
  templateFor,
  ticketsForKey,
  usefulDimensions,
  type ConversationTag,
  type ConversationTagMap,
  type DimensionContext,
  type DimensionKey,
  type TopicsTicket,
} from './TopicsExplorer.utils';

/**
 * Desk-scoped ticket volume grouped by any stack of columns: treemap left, one
 * daily-volume trend row per group right. Zero has no aggregation, so the
 * rollup runs client-side — hence one channel and a bounded created-at window.
 */

const PAGER_BUTTON =
  'flex h-6 w-6 items-center justify-center rounded border border-border transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent';
const PANEL = 'flex min-h-[320px] flex-col overflow-hidden rounded-xl border border-border bg-card';
const PANEL_HEADER = 'flex items-baseline justify-between border-b border-border px-4 py-2';
const PANEL_TITLE = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';
/** The filters this panel applies, keyed by the search-param the list reads. */
const FILTER_KEYS = [
  'aiCategory',
  'priority',
  'stages',
  'assignee',
  'userGroups',
  'generatedTags',
] as const satisfies readonly (keyof TicketFilters)[];

/** Combine a calendar date with an HH:mm time into an epoch-ms bound. */
const dateTimeMs = (date: Date, time: string, isEnd: boolean): number => {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hour, minute, isEnd ? 59 : 0, isEnd ? 999 : 0);
  return result.getTime();
};

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export interface TopicsExplorerProps {
  open: boolean;
  onClose: () => void;
  channelId: string;
  channelName?: string;
  /** Desk base path (e.g. `/ws/support`), used for the ticket-list drill-through. */
  supportBase: string;
  /**
   * Board-derived option lists, passed in rather than derived from the synced
   * rows: the date range would otherwise hide configured-but-unused values, so
   * the filter menus would not match the ticket list's own.
   */
  availableAiCategories: string[];
  availableStages: { name: string; status?: TicketStatusV2 }[];
}

export const TopicsExplorer = ({
  open,
  onClose,
  channelId,
  channelName,
  supportBase,
  availableAiCategories,
  availableStages,
}: TopicsExplorerProps): ReactElement => {
  const navigate = useNavigate();
  const [dims, setDims] = useState<DimensionKey[]>(['priority', 'aiCategory']);
  const [filters, setFilters] = useState<TicketFilters>({});
  // AI tags/sentiment live outside Zero, so they arrive per conversation.
  const [aiTagsByConversation, setAiTagsByConversation] = useState<ConversationTagMap>(
    () => new Map<string, readonly ConversationTag[]>(),
  );
  const [isLoadingAiTagDimensions, setIsLoadingAiTagDimensions] = useState(false);
  const [aiTagsFailed, setAiTagsFailed] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  // Defaults to today: the rollup runs client-side over synced rows, so the
  // panel opens on the cheapest window and widens only when asked.
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => ({
    startDate: new Date(),
    endDate: new Date(),
  }));
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('23:59');
  const [hovered, setHovered] = useState<string | null>(null);
  const isMember = !!useGetChannelUserStatus(channelId);
  const usersById = useUsersById();
  const prevPageRef = useRef<HTMLButtonElement | null>(null);
  const nextPageRef = useRef<HTMLButtonElement | null>(null);

  const { startMs, endMs, rangeDays } = useMemo(() => {
    const from = dateTimeMs(dateRange.startDate, startTime, false);
    const to = dateTimeMs(dateRange.endDate, endTime, true);
    return {
      startMs: from,
      endMs: to,
      // Calendar days spanned, inclusive — elapsed time goes fractional once a
      // custom start/end time is set.
      rangeDays: Math.max(Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY) + 1, 1),
    };
  }, [dateRange, startTime, endTime]);

  // Memoized: a fresh query object rebuilds and rehashes the ZQL AST on every
  // state change, including each mouse move.
  const ticketsQuery = useMemo(
    () =>
      queries.topicsExplorerTickets({
        channelId,
        isMember,
        createdAtStart: startMs,
        createdAtEnd: endMs,
      }),
    [channelId, isMember, startMs, endMs],
  );
  const queryOptions = useMemo(() => ({ enabled: open && !!channelId }), [open, channelId]);

  const [rows, details] = useQuery(ticketsQuery, queryOptions);

  // Zero pushes a new array identity on every sync frame while rows stream in;
  // deferring re-runs the rollup on the settled array rather than every push.
  const deferredRows = useDeferredValue(rows);
  const isSyncingRows = rows !== deferredRows;
  const allTickets = useMemo<readonly TopicsTicket[]>(() => deferredRows ?? [], [deferredRows]);
  // A deferred frame counts as loading, so a partial rollup never renders as final.
  const isTicketsReady = details.type === 'complete' && !isSyncingRows;

  const ctx = useMemo<DimensionContext>(
    () => ({
      userName: (id): string => {
        const user = usersById.get(id);
        return user?.displayName ?? user?.name ?? user?.email ?? 'Unknown user';
      },
    }),
    [usersById],
  );

  // Tag categories are grouping dimensions, so they load with the panel and the
  // date range rather than with the tag filter.
  useEffect(() => {
    if (!open || !channelId) return;
    let cancelled = false;
    setIsLoadingAiTagDimensions(true);
    setAiTagsFailed(false);
    tagsConfigApi
      .getGeneratedTagsByConversation(channelId, startMs, endMs)
      .then(result => {
        if (cancelled) return;
        const next = new Map<string, readonly ConversationTag[]>();
        for (const row of result.conversations) {
          if (row.conversationId) next.set(row.conversationId, row.tags ?? []);
        }
        setAiTagsByConversation(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAiTagsByConversation(new Map<string, readonly ConversationTag[]>());
        setAiTagsFailed(true);
        // Otherwise the AI tag dimensions vanish from "Group by" unexplained.
        toast.error(getApiErrorMessage(err, 'Could not load AI tag categories'));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAiTagDimensions(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [open, channelId, startMs, endMs]);

  // Category list comes from the desk's own tag config, so "Group by" offers
  // exactly what Desk Settings configured — not whatever the range happens to
  // have tagged.
  const { categories: tagCategories } = useDeskTagsConfig(channelId, open && !!channelId);
  const configuredTagCategories = useMemo(() => Object.keys(tagCategories), [tagCategories]);

  const dimensions = useMemo(
    () => buildDimensions(aiTagsByConversation, configuredTagCategories),
    [aiTagsByConversation, configuredTagCategories],
  );

  /**
   * The AI-tag filter reads the same window-scoped map the groupings read, so a
   * ticket that passes the filter cannot then land in the grouping's "no tags in
   * this range" bucket. Resolving it server-side scanned all history instead,
   * which is exactly how the two scopes came apart.
   */
  const tagConversationIds = useMemo<string[] | null>(() => {
    const selected = filters.generatedTags;
    if (!selected?.length) return null;
    const wanted = new Set(selected);
    const matched: string[] = [];
    for (const [conversationId, tags] of aiTagsByConversation) {
      if (tags.some(t => wanted.has(`${t.category}:${t.tag}`))) matched.push(conversationId);
    }
    return matched;
  }, [filters.generatedTags, aiTagsByConversation]);

  // The map is the filter's only source, so a filter set while it loads has to
  // hold the list empty rather than render one frame of unfiltered counts.
  const tagsPending = !!filters.generatedTags?.length && isLoadingAiTagDimensions;

  const tickets = useMemo(
    () => applyTicketFilters(allTickets, filters, tagsPending ? [] : tagConversationIds),
    [allTickets, filters, tagConversationIds, tagsPending],
  );
  const available = useMemo(() => usefulDimensions(tickets, dimensions), [tickets, dimensions]);

  // A chosen tag category can vanish when the range changes; pruning in an
  // effect would commit one render against a dead dimension.
  const activeDims = useMemo<DimensionKey[]>(() => {
    const kept = dims.filter(key => dimensions.has(key));
    return kept.length > 0 ? kept : ['priority'];
  }, [dims, dimensions]);

  /** Walk the drill path, one dimension per step. */
  const { allNodes, depth, scoped, validPath } = useMemo(() => {
    let current = tickets;
    let dimIndex = 0;
    const walked: string[] = [];

    for (const key of path) {
      const dim = activeDims[dimIndex];
      const nextDim = activeDims[dimIndex + 1];
      if (!dim || !nextDim) break;
      const subset = ticketsForKey(current, dimensionFor(dimensions, dim), key);
      if (subset.length === 0) break;
      current = subset;
      dimIndex += 1;
      walked.push(key);
    }

    return {
      allNodes: groupLevel(current, dimensionFor(dimensions, activeDims[dimIndex]), ctx),
      depth: dimIndex,
      scoped: current,
      validPath: walked,
    };
  }, [tickets, activeDims, dimensions, ctx, path]);

  const pageCount = Math.max(Math.ceil(allNodes.length / MAX_BOXES), 1);
  // Clamp rather than reset: paging state can outlive a filter change.
  const safePage = Math.min(page, pageCount - 1);
  const nodes = useMemo(
    () => allNodes.slice(safePage * MAX_BOXES, safePage * MAX_BOXES + MAX_BOXES),
    [allNodes, safePage],
  );

  // Charts exactly the queried range; a fixed bucket count would fabricate
  // zeros past its end.
  const trend = useMemo(() => buildTrend(nodes, rangeDays, endMs), [nodes, rangeDays, endMs]);

  // Spans every group at this level, not just the page: per-page scaling drew a
  // group peaking at 8 as tall as one peaking at 1,500.
  const trendMax = useMemo(
    () => maxDailyCount(allNodes, rangeDays, endMs),
    [allNodes, rangeDays, endMs],
  );

  const currentDim = dimensionFor(dimensions, activeDims[depth]);
  const isOverlapping = currentDim.multi === true;
  // A leaf tile's click belongs to the ticket list, not to another level.
  const isDrillable = activeDims.length > depth + 1;

  // A leaf can only open the ticket list when every level of its path maps to a
  // filter param. Where it cannot, the tile stays inert rather than opening a
  // wider list than it counted — the three sets name what is responsible, kept
  // apart so one inert box cannot speak for its whole dimension.
  const { tiles, openBlockers, emptyBuckets, conflicting } = useMemo(() => {
    const total = scoped.length || 1;
    const blockers = new Set<string>();
    const emptyBoxes = new Set<string>();
    const combined = new Set<string>();

    const built = nodes.map((node, i) => {
      const share = Math.round((node.tickets.length / total) * 100);
      let canOpen = true;
      if (!isDrillable) {
        const plan = planDrill(
          [...validPath, node.key].map((key, level) => ({
            dim: dimensionFor(dimensions, activeDims[level]),
            key,
          })),
          filters.generatedTags,
        );
        canOpen =
          plan.dropped.length === 0 &&
          plan.emptyBuckets.length === 0 &&
          plan.conflicting.length === 0;
        for (const label of plan.dropped) blockers.add(label);
        for (const label of plan.emptyBuckets) emptyBoxes.add(label);
        for (const label of plan.conflicting) combined.add(label);
      }
      return {
        name: node.label,
        nodeKey: node.key,
        ...swatchFor(i),
        count: `${node.tickets.length.toLocaleString()} tickets`,
        // Percentages of an overlapping level do not add up, so they are
        // suppressed everywhere at once — tile text, aria-label and tooltip.
        share: isOverlapping ? '' : `${share}%`,
        sharePct: share,
        canOpen,
      };
    });

    return {
      tiles: built,
      openBlockers: [...blockers],
      emptyBuckets: [...emptyBoxes],
      conflicting: [...combined],
    };
  }, [
    nodes,
    scoped.length,
    isOverlapping,
    isDrillable,
    validPath,
    dimensions,
    activeDims,
    filters,
  ]);

  /**
   * One trend row per tile, so the two panels cannot drift in order or shade.
   * Memoized because `hovered` changes on every mouse move: rebuilt row objects
   * would defeat `TrendRow`'s memo and re-render every chart on each move.
   */
  const rowsWithTrend = useMemo(
    () =>
      tiles.map((tile, i) => ({
        key: tile.nodeKey,
        label: tile.name,
        colour: tile.fill,
        points: trend[i] ?? [],
        canSelect: isDrillable || tile.canOpen,
      })),
    [tiles, trend, isDrillable],
  );

  // No useMemo: templateFor indexes a module-level table, so the reference is stable.
  const layout = templateFor(tiles.length);

  // Formatted through each level's own dimension: raw keys are ids for Assignee
  // and `category:tag` for AI tags.
  const crumbs = [
    { label: 'All tickets', to: [] as string[] },
    ...validPath.map((key, i) => ({
      label: labelFor(dimensionFor(dimensions, activeDims[i]), key, ctx),
      to: path.slice(0, i + 1),
    })),
  ];

  /** Caveats shown above the panels, so a capped or partial rollup says so. */
  const notices = [
    isOverlapping && {
      id: 'overlap',
      tone: 'muted' as const,
      text: 'A ticket can carry several tags, so these groups overlap and add up to more than the total.',
    },
    openBlockers.length > 0 && {
      id: 'noOpen',
      tone: 'muted' as const,
      text: `The ticket list has no filter for ${openBlockers.join(' or ')}, so these boxes can be read and charted here but not opened as a ticket list.`,
    },
    emptyBuckets.length > 0 && {
      id: 'noEmptyValue',
      tone: 'muted' as const,
      text: `The ticket list cannot filter for ${emptyBuckets.map(label => `“${label}”`).join(' or ')}, so only ${emptyBuckets.length > 1 ? 'those boxes' : 'that box'} cannot be opened. The rest open as usual.`,
    },
    conflicting.length > 0 && {
      id: 'conflicting',
      tone: 'muted' as const,
      text: `${conflicting.join(' and ')} reuses a filter an earlier level or the filter bar already set, and the ticket list combines repeats with OR, so opening would show more tickets than the box counts.`,
    },
  ].filter(Boolean) as { id: string; tone: 'muted' | 'warn'; text: string }[];

  const openTickets = useCallback(
    (nodeKey: string): void => {
      const plan = planDrill(
        [...validPath, nodeKey].map((key, i) => ({
          dim: dimensionFor(dimensions, activeDims[i]),
          key,
        })),
        filters.generatedTags,
      );

      // Guard, not a user path: the tile is already inert when this holds, since
      // a list that cannot express every level is wider than the box clicked.
      if (plan.dropped.length > 0 || plan.emptyBuckets.length > 0 || plan.conflicting.length > 0)
        return;

      const params = new URLSearchParams();

      // Only the filters the rollup applies, each already the param name the
      // list reads it from — `TicketFilters` keys are not all (`boards`/`board`).
      for (const key of FILTER_KEYS) {
        for (const value of filters[key] ?? []) params.append(key, value);
      }

      // The drill path replaces any filter on the same field: the list ORs
      // repeated params, so Assignee={alice,bob} drilled into alice opens both.
      for (const { param, value } of plan.assignments) {
        params.delete(param);
        params.append(param, value);
      }

      params.set('createdDateStart', String(startMs));
      params.set('createdDateEnd', String(endMs));
      // No onClose(): dropping `topics=open` from the URL already closes this.
      void navigate(`${supportBase}/${channelId}?${params.toString()}`);
    },
    [activeDims, channelId, dimensions, endMs, filters, navigate, startMs, supportBase, validPath],
  );

  // Moves focus at either end: the pressed button goes `disabled`, dropping
  // focus to <body> and dead-ending keyboard paging.
  const goToPage = (next: number): void => {
    const target = Math.min(Math.max(next, 0), pageCount - 1);
    setPage(target);
    if (target <= 0) nextPageRef.current?.focus();
    else if (target >= pageCount - 1) prevPageRef.current?.focus();
  };

  /** Every drill rebuilds the group set, so path and page always move together. */
  const showPath = useCallback((next: string[]): void => {
    setPath(next);
    setPage(0);
    // The next level reuses group keys, so a stale hover lights up an unrelated group.
    setHovered(null);
  }, []);

  // Keeps the first `keepLevels` drilled steps: the keys above the edited level
  // came from dimensions that did not move, so dropping them would throw the
  // user back to the root for an edit outside their branch.
  const regroup = useCallback(
    (next: DimensionKey[], keepLevels: number): void => {
      setDims(next);
      showPath(validPath.slice(0, keepLevels));
    },
    [showPath, validPath],
  );

  const onTileClick = useCallback(
    (nodeKey: string): void => {
      if (isDrillable) {
        showPath([...validPath, nodeKey]);
        return;
      }
      if (tiles.find(t => t.nodeKey === nodeKey)?.canOpen) openTickets(nodeKey);
    },
    [isDrillable, tiles, openTickets, showPath, validPath],
  );

  const selectClass =
    'rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground';

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
      title='Topics Explorer'
      className={cn(
        'left-auto right-0 top-0 bottom-0 h-screen w-[85vw] max-h-none max-w-none translate-x-0 translate-y-0 rounded-l-[16px] rounded-r-none bg-transparent shadow-none',
        'data-[state=open]:!zoom-in-100 data-[state=open]:!slide-in-from-top-[0%] data-[state=open]:!slide-in-from-right-full',
        'data-[state=closed]:!zoom-out-100 data-[state=closed]:!slide-out-to-top-[0%] data-[state=closed]:!slide-out-to-right-full',
      )}
    >
      <div className='relative h-full w-full'>
        <button
          type='button'
          onClick={onClose}
          className='absolute right-6 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-[10px] border border-desk-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground dark:border-border'
          aria-label='Close topics explorer'
          data-track-category='TOPICS_EXPLORER'
          data-track-name='CloseButton'
        >
          <MultipleCrossCancelDefault size={16} />
        </button>

        <div className='isolate flex h-full w-full flex-col overflow-hidden rounded-l-[16px] border border-desk-border bg-popover shadow-2xl dark:border-border'>
          {/* pr-12 clears the absolutely-positioned close button — same
              convention as DeskMetricsDashboard's header. */}
          <div className='shrink-0 space-y-3 border-b border-desk-border px-6 pb-3 pr-12 pt-4 dark:border-border'>
            <div>
              <h2 className='text-base font-semibold'>
                Topics Explorer
                {channelName && <span className='text-muted-foreground'> · {channelName}</span>}
              </h2>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                Boxes are ordered by volume — read the count and bar for size. Click one to go
                deeper.
              </p>
            </div>

            {/* Desk's own submenus, so field list and value formats match the
                ticket list exactly. */}
            <div className='flex flex-wrap items-center gap-2'>
              <TopicsFilterBar
                channelId={channelId}
                filters={filters}
                onChange={next => {
                  setFilters(next);
                  showPath([]);
                }}
                availableAiCategories={availableAiCategories}
                availableStages={availableStages}
                isLoadingTags={tagsPending}
              />

              <span className='ml-auto'>
                <DeskMetricsDateRangePicker
                  dateRange={dateRange}
                  startTime={startTime}
                  endTime={endTime}
                  maxDays={MAX_RANGE_DAYS}
                  onChange={(dr, st, et) => {
                    setDateRange(dr);
                    setStartTime(st);
                    setEndTime(et);
                    showPath([]);
                  }}
                />
              </span>
            </div>

            {/* Grouping — how the tickets are broken up */}
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Group by
              </span>

              {activeDims.map((dim, level) => (
                <span key={dim} className='flex items-center gap-1'>
                  {/* Decorative: otherwise announced as "greater than". */}
                  {level > 0 && (
                    <span aria-hidden='true' className='text-muted-foreground'>
                      ›
                    </span>
                  )}
                  <select
                    value={dim}
                    onChange={e => {
                      const next = [...activeDims];
                      next[level] = e.target.value as DimensionKey;
                      regroup(next, level);
                    }}
                    className={selectClass}
                    aria-label={`Group level ${level + 1}`}
                    data-track-category='TOPICS_EXPLORER'
                    data-track-name='CHANGE_DIMENSION'
                  >
                    {/* Current dim first, then anything not already used at another
                        level. `available` alone drops the selected dim once it stops
                        splitting the data, leaving a value that matches no option. */}
                    {[dim, ...available.filter(k => !activeDims.includes(k))].map(k => (
                      <option key={k} value={k}>
                        {dimensionFor(dimensions, k).label}
                      </option>
                    ))}
                  </select>
                  {activeDims.length > 1 && (
                    <button
                      type='button'
                      onClick={() =>
                        regroup(
                          activeDims.filter((_, i) => i !== level),
                          level,
                        )
                      }
                      // 24x24 hit area: the bare glyph was under the WCAG 2.5.8 minimum.
                      className='flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground'
                      aria-label={`Remove level ${level + 1}`}
                      data-track-category='TOPICS_EXPLORER'
                      data-track-name='REMOVE_LEVEL'
                    >
                      <MultipleCrossCancelDefault size={12} aria-hidden />
                    </button>
                  )}
                </span>
              ))}

              {activeDims.length < MAX_DEPTH && available.some(k => !activeDims.includes(k)) && (
                <button
                  type='button'
                  onClick={() => {
                    const unused = available.find(k => !activeDims.includes(k));
                    // Appending leaves existing levels untouched, so the path survives.
                    if (unused) regroup([...activeDims, unused], validPath.length);
                  }}
                  className='rounded-md border border-dashed border-border px-2 py-1 text-sm text-muted-foreground hover:text-foreground'
                  data-track-category='TOPICS_EXPLORER'
                  data-track-name='ADD_LEVEL'
                >
                  + Level
                </button>
              )}

              {activeDims.length >= MAX_DEPTH && (
                <span className='text-xs text-muted-foreground'>Max {MAX_DEPTH} levels</span>
              )}

              {isLoadingAiTagDimensions && (
                <span className='text-xs text-muted-foreground'>Loading AI tag categories…</span>
              )}
            </div>
          </div>

          {/* Breadcrumb + counts */}
          <div className='flex flex-wrap items-center gap-1 px-6 py-2 text-sm'>
            {/* A real breadcrumb: bare buttons split by "›" are announced as
                "greater than" between every level. */}
            <nav aria-label='Drill path'>
              <ol className='flex flex-wrap items-center gap-1'>
                {crumbs.map((crumb, i) => (
                  <li key={`${i}-${crumb.label}`} className='flex items-center gap-1'>
                    {i > 0 && (
                      <span aria-hidden='true' className='text-muted-foreground'>
                        ›
                      </span>
                    )}
                    <button
                      type='button'
                      onClick={() => showPath(crumb.to)}
                      className={
                        i === 0
                          ? 'text-muted-foreground hover:text-foreground'
                          : 'font-medium hover:underline'
                      }
                      aria-current={i === crumbs.length - 1 ? 'page' : undefined}
                      data-track-category='TOPICS_EXPLORER'
                      data-track-name={i === 0 ? 'BREADCRUMB_ROOT' : 'BREADCRUMB_LEVEL'}
                    >
                      {crumb.label}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <span className='ml-auto text-muted-foreground'>
              {isTicketsReady
                ? `${allNodes.length} groups · ${scoped.length.toLocaleString()} tickets`
                : 'Loading tickets…'}
            </span>
          </div>

          {notices.map(notice => (
            <div
              key={notice.id}
              className={cn(
                'mx-6 mb-2 rounded-md px-3 text-xs',
                notice.tone === 'warn'
                  ? 'bg-amber-500/10 py-2'
                  : 'bg-muted py-1.5 text-muted-foreground',
              )}
            >
              {notice.text}
            </div>
          ))}

          {/* overflow-y-auto: below `lg` the two panels stack inside an
              overflow-hidden ancestor, leaving the second unreachable. */}
          <div className='grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-6 pb-6 lg:grid-cols-[3fr_2fr]'>
            {/* Left: treemap */}
            <section className={PANEL}>
              <header className={PANEL_HEADER}>
                <h3 className={PANEL_TITLE}>{currentDim.label}</h3>
                <nav
                  aria-label='Topic pages'
                  className='flex items-center gap-2 text-xs text-muted-foreground'
                >
                  <span className='tabular-nums' aria-live='polite'>
                    {allNodes.length === 0
                      ? 'no groups'
                      : `${safePage * MAX_BOXES + 1}–${safePage * MAX_BOXES + nodes.length} of ${allNodes.length}`}
                  </span>
                  {pageCount > 1 && (
                    <span className='flex items-center gap-1'>
                      <button
                        ref={prevPageRef}
                        type='button'
                        onClick={() => goToPage(safePage - 1)}
                        disabled={safePage === 0}
                        className={PAGER_BUTTON}
                        aria-label='Previous page'
                        data-track-category='TOPICS_EXPLORER'
                        data-track-name='PREV_PAGE'
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <span className='tabular-nums'>
                        {safePage + 1}/{pageCount}
                      </span>
                      <button
                        ref={nextPageRef}
                        type='button'
                        onClick={() => goToPage(safePage + 1)}
                        disabled={safePage >= pageCount - 1}
                        className={PAGER_BUTTON}
                        aria-label='Next page'
                        data-track-category='TOPICS_EXPLORER'
                        data-track-name='NEXT_PAGE'
                      >
                        <ChevronRight size={13} />
                      </button>
                    </span>
                  )}
                </nav>
              </header>

              <div className='min-h-0 flex-1 p-2'>
                {tiles.length === 0 ? (
                  <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
                    {/* The tag fetch feeds the filter, so its failure has to be
                        named here — otherwise a dead filter reads as a confident
                        "No tickets match". */}
                    {tagsPending
                      ? 'Loading AI tags…'
                      : aiTagsFailed && !!filters.generatedTags?.length
                        ? 'Could not load AI tags — clear that filter or retry.'
                        : isTicketsReady
                          ? 'No tickets match'
                          : 'Loading tickets…'}
                  </div>
                ) : (
                  <TopicsTreemap
                    tiles={tiles}
                    layout={layout}
                    hovered={hovered}
                    drillable={isDrillable}
                    onSelect={onTileClick}
                    onHover={setHovered}
                  />
                )}
              </div>
            </section>

            {/* Right: one trend row per group, same order and shade as the tiles */}
            <section className={PANEL}>
              <header className={PANEL_HEADER}>
                <h3 className={PANEL_TITLE}>Daily volume</h3>
                {/* Not "last N days": the range can be any window, e.g. Yesterday. */}
                <span className='text-xs text-muted-foreground'>
                  {rangeDays} {rangeDays === 1 ? 'day' : 'days'}
                </span>
              </header>

              <TopicsTrendPanel
                rows={rowsWithTrend}
                max={trendMax}
                hovered={hovered}
                onHover={setHovered}
                onSelect={onTileClick}
              />
            </section>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
