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
import { queries, TOPICS_EXPLORER_TICKET_LIMIT } from '../../../zero/queries';
// Not useCachedQuery: it persists the whole result to IndexedDB, re-stringifying
// the array on every live update. This rollup is throwaway, not warm-start state.
import { useQuery } from '../../../hooks/useQuery';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import { useUsersById } from '../../../hooks/useUsers';
import { tagsConfigApi } from '../../../api/tagsConfigApi';
import { getApiErrorMessage } from '../../../utils/apiError';
import type { TicketFilters } from '../../Tickets/TicketFilters/types';
import { TopicsFilterBar } from './TopicsFilterBar';
import { TopicsTreemap } from './TopicsTreemap';
import { TopicsTrendPanel } from './TopicsTrendPanel';
import {
  DEFAULT_RANGE_DAYS,
  MAX_DEPTH,
  MAX_BOXES,
  NONE_KEY,
  readableOn,
  MS_PER_DAY,
  TREND_DAYS,
  applyTicketFilters,
  buildDimensions,
  buildTrend,
  colourFor,
  dimensionFor,
  distinctValues,
  groupLevel,
  labelFor,
  maxDailyCount,
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
 * Topics Explorer — desk-scoped ticket volume grouped by any stack of columns.
 * Treemap left, one daily-volume trend row per group right, sharing order and
 * colour so the panels read as one view. Zero has no aggregation, so the rollup
 * runs client-side — hence one channel and a bounded created-at window.
 */

const PAGER_BUTTON =
  'flex h-6 w-6 items-center justify-center rounded border border-border transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent';

/** Combine a calendar date with an HH:mm time into an epoch-ms bound. */
const dateTimeMs = (date: Date, time: string, isEnd: boolean): number => {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hour, minute, isEnd ? 59 : 0, isEnd ? 999 : 0);
  return result.getTime();
};

/** Server-side row cap in `filterConversationsByTags`. */
const TAG_FILTER_CONVERSATION_CAP = 1000;

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
}

export const TopicsExplorer = ({
  open,
  onClose,
  channelId,
  channelName,
  supportBase,
}: TopicsExplorerProps): ReactElement => {
  const navigate = useNavigate();
  const usersById = useUsersById();
  // Both defaults carry a ticket-list filter, so the out-of-the-box drill-through
  // lands on exactly the tickets in the tile. aiSubCategory is deliberately not a
  // default: the list has no filter for it, so opening from it silently widens to
  // the parent category and has to warn.
  const [dims, setDims] = useState<DimensionKey[]>(['aiCategory', 'priority']);
  const [filters, setFilters] = useState<TicketFilters>({});
  // AI tags/sentiment live outside Zero, so they resolve to conversation ids.
  const [tagConversationIds, setTagConversationIds] = useState<string[] | null>(null);
  const [isResolvingTags, setIsResolvingTags] = useState(false);
  const [tagError, setTagError] = useState(false);
  const [tagFilterCapped, setTagFilterCapped] = useState(false);
  // LLM tags per conversation, which power the `aiTag:*` grouping dimensions.
  const [aiTagsByConversation, setAiTagsByConversation] = useState<ConversationTagMap>(
    () => new Map<string, readonly ConversationTag[]>(),
  );
  const [isLoadingAiTagDimensions, setIsLoadingAiTagDimensions] = useState(false);
  const [aiTagDimensionsTruncated, setAiTagDimensionsTruncated] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  // Same picker as Desk Metrics: presets plus an explicit custom range.
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (DEFAULT_RANGE_DAYS - 1));
    return { startDate: start, endDate: end };
  });
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('23:59');
  const [hovered, setHovered] = useState<string | null>(null);
  const isMember = !!useGetChannelUserStatus(channelId);
  const prevPageRef = useRef<HTMLButtonElement | null>(null);
  const nextPageRef = useRef<HTMLButtonElement | null>(null);

  const { startMs, endMs, rangeDays } = useMemo(() => {
    const from = dateTimeMs(dateRange.startDate, startTime, false);
    const to = dateTimeMs(dateRange.endDate, endTime, true);
    return {
      startMs: from,
      endMs: to,
      // Calendar days spanned, inclusive — NOT elapsed time. The trend buckets by
      // calendar day, so rounding the elapsed span dropped a whole day whenever
      // the custom times made it fractional: a 1 Aug 09:00 → 5 Aug 17:00 range is
      // 4.3 elapsed days but covers 5 days, and 1 Aug's tickets were counted in
      // the boxes while having no bar in the graph.
      rangeDays: Math.max(Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY) + 1, 1),
    };
  }, [dateRange, startTime, endTime]);

  // Memoized: a fresh query object rebuilds the ZQL AST and rehashes it on every
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

  // Zero pushes a new array identity on every sync frame while rows stream in.
  // Deferring re-runs the rollup on the settled array rather than every push.
  const deferredRows = useDeferredValue(rows);
  const isSyncingRows = rows !== deferredRows;
  // No `as unknown as`: the assignability check is what makes a Zero schema
  // rename fail the build instead of silently emptying a grouping at runtime.
  const allTickets = useMemo<readonly TopicsTicket[]>(() => deferredRows ?? [], [deferredRows]);
  // A deferred frame counts as loading, so the panel never flashes a partial
  // rollup as if it were final.
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

  useEffect(() => {
    const tags = filters.generatedTags;
    setTagError(false);
    setTagFilterCapped(false);
    if (!tags || tags.length === 0) {
      setTagConversationIds(null);
      setIsResolvingTags(false);
      return;
    }
    // `tagsPending` covers the render before this runs; see the derivation below.
    setTagConversationIds(null);
    setIsResolvingTags(true);
    let cancelled = false;
    tagsConfigApi
      .filterConversationsByTags(channelId, tags)
      .then(ids => {
        if (cancelled) return;
        setTagConversationIds(ids);
        // filterConversationsByTags is hard-capped at 1000 rows server-side. In a
        // list that is fine; here the whitelist is the denominator of every box,
        // so at the cap the counts are simply wrong and must say so.
        setTagFilterCapped(ids.length >= TAG_FILTER_CONVERSATION_CAP);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTagConversationIds([]);
        setTagError(true);
        // Otherwise an API failure renders a confident "No tickets match".
        toast.error(getApiErrorMessage(err, 'Could not resolve AI tags'));
      })
      .finally(() => {
        if (!cancelled) setIsResolvingTags(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [channelId, filters.generatedTags]);

  // Tag categories are grouping dimensions, so they load with the panel and the
  // date range rather than with the tag filter.
  useEffect(() => {
    if (!open || !channelId) return;
    let cancelled = false;
    setIsLoadingAiTagDimensions(true);
    tagsConfigApi
      .getGeneratedTagsByConversation(channelId, startMs, endMs)
      .then(result => {
        if (cancelled) return;
        const next = new Map<string, readonly ConversationTag[]>();
        for (const row of result.conversations) {
          if (row.conversationId) next.set(row.conversationId, row.tags ?? []);
        }
        setAiTagsByConversation(next);
        setAiTagDimensionsTruncated(result.truncated);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAiTagsByConversation(new Map<string, readonly ConversationTag[]>());
        setAiTagDimensionsTruncated(false);
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

  const dimensions = useMemo(() => buildDimensions(aiTagsByConversation), [aiTagsByConversation]);

  // From the whole range, not the filtered subset, so a choice never disappears
  // once something else is selected. NONE_KEY is dropped: it is the grouping
  // sentinel for "no value", and offering it as a filter gave an option that
  // matched nothing, since the filters compare against the real column value.
  const availableAiCategories = useMemo(
    () =>
      distinctValues(allTickets, 'aiCategory').flatMap(o =>
        o.value === NONE_KEY ? [] : [o.value],
      ),
    [allTickets],
  );
  const availableStages = useMemo(
    () =>
      distinctValues(allTickets, 'stageName').flatMap(o =>
        o.value === NONE_KEY ? [] : [{ name: o.value }],
      ),
    [allTickets],
  );

  // A resolving AI-tag filter matches nothing. Derived, not set in the effect,
  // which committed one frame of fully unfiltered results first.
  const tagsPending = !!filters.generatedTags?.length && tagConversationIds === null;

  const tickets = useMemo(
    () => applyTicketFilters(allTickets, filters, tagsPending ? [] : tagConversationIds),
    [allTickets, filters, tagConversationIds, tagsPending],
  );
  const available = useMemo(() => usefulDimensions(tickets, dimensions), [tickets, dimensions]);

  // A chosen tag category can vanish when the range changes, so the selection is
  // derived — pruning in an effect would commit one render against a dead dimension.
  const activeDims = useMemo<DimensionKey[]>(() => {
    const kept = dims.filter(key => dimensions.has(key));
    return kept.length > 0 ? kept : ['aiCategory'];
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
      // Every group at this level, ranked by volume. Paginated for display.
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

  // Never chart more days than were queried: 30 buckets over a 7-day range would
  // render 23 fabricated zeros that read as a volume collapse.
  const trendDays = Math.min(rangeDays, TREND_DAYS);
  const trend = useMemo(() => buildTrend(nodes, trendDays, endMs), [nodes, trendDays, endMs]);

  // Y domain spans EVERY group at this level, not just the page — per-page
  // scaling drew a group peaking at 8 as tall as one peaking at 1,500.
  const trendMax = useMemo(
    () => maxDailyCount(allNodes, trendDays, endMs),
    [allNodes, trendDays, endMs],
  );

  const currentDim = dimensionFor(dimensions, activeDims[depth]);
  const isOverlapping = currentDim.multi === true;
  // A tile opens sub-groups only when another dimension sits below this one;
  // otherwise it is a leaf and the click belongs to the ticket list.
  const isDrillable = activeDims.length > depth + 1;

  const tiles = useMemo(() => {
    const total = scoped.length || 1;
    return nodes.map((node, i) => {
      const colour = colourFor(i);
      const share = Math.round((node.tickets.length / total) * 100);
      return {
        name: node.label,
        nodeKey: node.key,
        colour,
        ink: readableOn(colour),
        count: `${node.tickets.length.toLocaleString()} tickets`,
        // Percentages of a level whose groups overlap do not add up, so they are
        // suppressed everywhere at once — tile text, aria-label and tooltip.
        share: isOverlapping ? '' : `${share}%`,
        sharePct: share,
      };
    });
  }, [nodes, scoped.length, isOverlapping]);

  /** One trend row per group, in the same order and hue as the tiles. */
  const rowsWithTrend = useMemo(
    () =>
      nodes.map((node, i) => ({
        key: node.key,
        label: node.label,
        colour: colourFor(i),
        points: trend[i]?.points ?? [],
      })),
    [nodes, trend],
  );

  const layout = useMemo(() => templateFor(tiles.length), [tiles.length]);

  // Only once the sync has settled: mid-stream the count is still climbing, so
  // an early check flashes the cap warning.
  const isTruncated = isTicketsReady && allTickets.length >= TOPICS_EXPLORER_TICKET_LIMIT;

  /**
   * Root plus one crumb per drilled level. Formatted through the level's own
   * dimension: raw keys are user ids for Assignee and `category:tag` for AI tags.
   */
  const crumbs = [
    { label: 'All tickets', to: [] as string[] },
    ...validPath.map((key, i) => ({
      label: labelFor(dimensionFor(dimensions, activeDims[i]), key, ctx),
      to: path.slice(0, i + 1),
    })),
  ];

  /** Caveats shown above the panels. One list beats three near-identical blocks. */
  const notices = [
    isOverlapping && {
      id: 'overlap',
      tone: 'muted' as const,
      text: 'A ticket can carry several tags, so these groups overlap and add up to more than the total.',
    },
    isTruncated && {
      id: 'rows',
      tone: 'warn' as const,
      text: `Showing the ${TOPICS_EXPLORER_TICKET_LIMIT.toLocaleString()} most recent tickets — older ones are excluded from these totals. Narrow the range for exact counts.`,
    },
    tagFilterCapped && {
      id: 'tagFilter',
      tone: 'warn' as const,
      text: `The AI tag filter matched at least ${TAG_FILTER_CONVERSATION_CAP.toLocaleString()} conversations, which is the server cap — these counts exclude the rest. Narrow the tags or the range for exact counts.`,
    },
    aiTagDimensionsTruncated && {
      id: 'aiTags',
      tone: 'warn' as const,
      text: 'AI tag data was capped for this range — tickets beyond the cap count as untagged in the AI tag groupings. Narrow the range for exact counts.',
    },
  ].filter(Boolean) as { id: string; tone: 'muted' | 'warn'; text: string }[];

  const openTickets = useCallback(
    (nodeKey: string): void => {
      const params = new URLSearchParams();
      const dropped: string[] = [];

      // TicketFilters keys are already the search-param names the ticket list
      // reads, so the active filters serialise straight through.
      for (const [key, value] of Object.entries(filters)) {
        if (Array.isArray(value)) value.forEach(v => params.append(key, String(v)));
        else if (value !== undefined && value !== null) params.append(key, String(value));
      }

      // The drill path overrides any filter on the same field. The list ORs
      // repeated params, so filtering Assignee={alice,bob} and drilling into
      // alice used to open both — a superset of the tile you clicked. Cleared
      // once per param, since every aiTag level shares `generatedTags`.
      const overridden = new Set<string>();

      [...validPath, nodeKey].forEach((key, i) => {
        const dimKey = activeDims[i];
        const dim = dimKey ? dimensions.get(dimKey) : undefined;
        if (!dim) return;
        // The "no value" bucket needs its own param: emitting the internal
        // sentinel would open a list the filter silently ignores.
        const value = key === NONE_KEY ? dim.emptyParam : key;
        if (!dim.param || value === null || value === undefined) {
          dropped.push(dim.label);
          return;
        }
        if (!overridden.has(dim.param)) {
          params.delete(dim.param);
          overridden.add(dim.param);
        }
        params.append(dim.param, value);
      });

      params.set('createdDateStart', String(startMs));
      params.set('createdDateEnd', String(endMs));
      if (dropped.length > 0) {
        toast.info(
          `Opened without ${[...new Set(dropped)].join(' and ')} — the ticket list has no filter for it.`,
        );
      }
      onClose();
      void navigate(`${supportBase}/${channelId}?${params.toString()}`);
    },
    [
      activeDims,
      channelId,
      dimensions,
      endMs,
      filters,
      navigate,
      onClose,
      startMs,
      supportBase,
      validPath,
    ],
  );

  /**
   * Pages and keeps focus alive: the pressed button goes `disabled` at either
   * end, dropping focus to <body> and dead-ending keyboard paging.
   */
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
  }, []);

  /** Regrouping likewise invalidates both the drill path and the page. */
  const regroup = useCallback(
    (next: DimensionKey[]): void => {
      setDims(next);
      showPath([]);
    },
    [showPath],
  );

  const onTileClick = useCallback(
    (nodeKey: string): void => {
      const node = nodes.find(n => n.key === nodeKey);
      if (!node) return;
      if (isDrillable) showPath([...validPath, nodeKey]);
      else openTickets(node.key);
    },
    [isDrillable, nodes, openTickets, showPath, validPath],
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
                isResolvingTags={isResolvingTags}
              />

              <span className='ml-auto'>
                <DeskMetricsDateRangePicker
                  dateRange={dateRange}
                  startTime={startTime}
                  endTime={endTime}
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
                      regroup(next.filter((v, i) => next.indexOf(v) === i));
                    }}
                    className={selectClass}
                    aria-label={`Group level ${level + 1}`}
                    data-track-category='TOPICS_EXPLORER'
                    data-track-name='CHANGE_DIMENSION'
                  >
                    {/* Current dim first, then anything not already used at
                        another level. Filtering `available` alone dropped the
                        selected dim once it stopped splitting the data, leaving
                        a select whose value matched no option — the browser then
                        showed the first one while the state said otherwise. */}
                    {[dim, ...available.filter(k => !activeDims.includes(k))].map(k => (
                      <option key={k} value={k}>
                        {dimensionFor(dimensions, k).label}
                      </option>
                    ))}
                  </select>
                  {activeDims.length > 1 && (
                    <button
                      type='button'
                      onClick={() => regroup(activeDims.filter((_, i) => i !== level))}
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
                    // This level's groups are unchanged, so the path survives.
                    if (unused) {
                      setDims([...activeDims, unused]);
                      setPage(0);
                    }
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
            {/* A real breadcrumb: bare buttons split by "›" were announced as
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
            <section className='flex min-h-[320px] flex-col overflow-hidden rounded-xl border border-border bg-card'>
              <header className='flex items-baseline justify-between border-b border-border px-4 py-2'>
                <h3 className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                  {currentDim.label}
                </h3>
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
                    {tagError
                      ? 'Could not load AI tags — clear that filter or retry.'
                      : isResolvingTags
                        ? 'Resolving AI tags…'
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

            {/* Right: one trend row per group, same order and hue as the tiles */}
            <section className='flex min-h-[320px] flex-col overflow-hidden rounded-xl border border-border bg-card'>
              <header className='flex items-baseline justify-between border-b border-border px-4 py-2'>
                <h3 className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                  Daily volume
                </h3>
                <span className='text-xs text-muted-foreground'>last {trendDays} days</span>
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
