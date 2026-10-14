import { Event, logger } from '@/src/utils/logger';

type ChatOpenProfilePayload = Record<string, unknown>;

type ChatOpenProfilerContext = {
  cycleId: string;
  channelId: string;
  startedAt: number;
  counters: Map<string, number>;
  marks: Map<string, { openLatencyMs: number; payload: ChatOpenProfilePayload }>;
  summaryLogged: boolean;
  errorLogged: boolean;
};

let activeContext: ChatOpenProfilerContext | null = null;

const ENABLE_VERBOSE_CHAT_OPEN_PROFILER = __DEV__;
const PRODUCTION_MARKS = new Set([
  'zero_initial_conversation_load_start',
  'zero_initial_local_snapshot_applied',
  'zero_initial_conversation_load_done',
  'zero_initial_conversation_load_error',
  'zero_latest_conversations_complete',
  'zero_updated_conversations_complete',
  'final_live_paint',
  'live_settled_paint',
]);

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const getNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;

const getString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const pickLargest = (
  candidates: Array<{ key: string; ms: number | undefined }>,
): { key: string; ms: number } | null => {
  const valid = candidates.filter(
    (candidate): candidate is { key: string; ms: number } =>
      typeof candidate.ms === 'number' && candidate.ms >= 0,
  );
  if (valid.length === 0) return null;
  return valid.reduce((largest, current) => (current.ms > largest.ms ? current : largest));
};

const buildOpenSummary = (): ChatOpenProfilePayload | null => {
  if (!activeContext || activeContext.summaryLogged) return null;

  const openBegin = activeContext.marks.get('open_begin');
  const initialFetchStart = activeContext.marks.get('zero_initial_conversation_load_start');
  const localSnapshotApplied = activeContext.marks.get('zero_initial_local_snapshot_applied');
  const initialFetchDone = activeContext.marks.get('zero_initial_conversation_load_done');
  const initialFetchError = activeContext.marks.get('zero_initial_conversation_load_error');
  const deltaLatest = activeContext.marks.get('zero_latest_conversations_complete');
  const deltaViewport = activeContext.marks.get('zero_updated_conversations_complete');
  const finalLivePaint = activeContext.marks.get('final_live_paint');

  if (!finalLivePaint) return null;

  const navigationLatencyMs = getNumber(openBegin?.payload['routeOpenLatencyMs']);
  const finalPaintSource = getString(finalLivePaint.payload['dataSource']);
  const isLiveSettledPending = finalPaintSource !== undefined && finalPaintSource !== 'backend';
  const displayRows = getNumber(finalLivePaint.payload['displayRows']);
  const blankPlaceholderShown =
    typeof finalLivePaint.payload['blankPlaceholderShown'] === 'boolean'
      ? finalLivePaint.payload['blankPlaceholderShown']
      : undefined;
  const finalLivePaintLatencyMs = finalLivePaint.openLatencyMs;
  const firstPaintLatencyMs = finalLivePaintLatencyMs;
  const firstPaintSource = finalPaintSource === 'retained' ? 'retained' : 'backend';
  const initialFetchDurationMs =
    getNumber(initialFetchDone?.payload['durationMs']) ??
    getNumber(initialFetchDone?.payload['fetchDurationMs']) ??
    getNumber(initialFetchError?.payload['durationMs']) ??
    getNumber(initialFetchError?.payload['fetchDurationMs']);
  const initialFetchStartLatencyMs = initialFetchStart?.openLatencyMs;
  const initialFetchCompleteLatencyMs =
    initialFetchDone?.openLatencyMs ?? initialFetchError?.openLatencyMs;
  const firstPaintToFinalLiveDelayMs =
    finalLivePaint.openLatencyMs >= firstPaintLatencyMs
      ? Math.max(0, finalLivePaint.openLatencyMs - firstPaintLatencyMs)
      : undefined;
  const initialFetchStatus = initialFetchDone
    ? 'complete'
    : initialFetchError
      ? 'failed'
      : initialFetchStart
        ? 'running'
        : 'not_started';
  const localSnapshotAppliedLatencyMs = localSnapshotApplied?.openLatencyMs;
  const localSnapshotRows = getNumber(localSnapshotApplied?.payload['localRows']);
  const localSnapshotMergedRows = getNumber(localSnapshotApplied?.payload['mergedRows']);
  const entryPoint = getString(openBegin?.payload['entryPoint']);
  const threadId = getString(openBegin?.payload['threadId']);
  const surface = getString(openBegin?.payload['surface']);
  const notificationOpenKind = getString(openBegin?.payload['notificationOpenKind']);
  const deltaLatestFetchDurationMs =
    getNumber(deltaLatest?.payload['durationMs']) ??
    getNumber(deltaLatest?.payload['fetchDurationMs']);
  const deltaViewportFetchDurationMs =
    getNumber(deltaViewport?.payload['durationMs']) ??
    getNumber(deltaViewport?.payload['fetchDurationMs']);
  const renderAfterFetchDurationMs =
    initialFetchDone && finalLivePaint.openLatencyMs >= initialFetchDone.openLatencyMs
      ? Math.max(0, finalLivePaint.openLatencyMs - initialFetchDone.openLatencyMs)
      : undefined;
  const bottleneck = pickLargest([
    { key: 'navigation', ms: navigationLatencyMs },
    { key: 'fetch_start_delay', ms: initialFetchStartLatencyMs },
    { key: 'backend_fetch', ms: initialFetchDurationMs },
    { key: 'render_after_fetch', ms: renderAfterFetchDurationMs },
  ]);

  return {
    milestone: 'open_summary',
    cycleId: activeContext.cycleId,
    channelId: activeContext.channelId,
    ...(threadId ? { threadId } : {}),
    ...(surface ? { surface } : {}),
    ...(entryPoint ? { entryPoint } : {}),
    ...(notificationOpenKind ? { notificationOpenKind } : {}),
    openPath: finalPaintSource === 'retained' ? 'retained_then_backend' : 'backend_only',
    ...(typeof navigationLatencyMs === 'number' ? { navigationLatencyMs } : {}),
    firstPaintSource,
    firstPaintLatencyMs,
    finalLivePaintLatencyMs,
    ...(finalPaintSource ? { finalPaintSource } : {}),
    ...(isLiveSettledPending ? { liveSettledPending: true } : {}),
    ...(typeof displayRows === 'number' ? { displayRows } : {}),
    ...(typeof blankPlaceholderShown === 'boolean' ? { blankPlaceholderShown } : {}),
    initialFetchStatus,
    ...(typeof localSnapshotAppliedLatencyMs === 'number' ? { localSnapshotAppliedLatencyMs } : {}),
    ...(typeof localSnapshotRows === 'number' ? { localSnapshotRows } : {}),
    ...(typeof localSnapshotMergedRows === 'number' ? { localSnapshotMergedRows } : {}),
    ...(typeof initialFetchStartLatencyMs === 'number' ? { initialFetchStartLatencyMs } : {}),
    ...(typeof initialFetchCompleteLatencyMs === 'number' ? { initialFetchCompleteLatencyMs } : {}),
    ...(typeof initialFetchDurationMs === 'number' ? { initialFetchDurationMs } : {}),
    ...(typeof firstPaintToFinalLiveDelayMs === 'number' ? { firstPaintToFinalLiveDelayMs } : {}),
    ...(typeof deltaLatestFetchDurationMs === 'number' ? { deltaLatestFetchDurationMs } : {}),
    ...(typeof deltaViewportFetchDurationMs === 'number' ? { deltaViewportFetchDurationMs } : {}),
    ...(typeof renderAfterFetchDurationMs === 'number' ? { renderAfterFetchDurationMs } : {}),
    ...(bottleneck ? { bottleneck: bottleneck.key } : {}),
  };
};

const lastMarkLatencyMs = (): number => {
  if (!activeContext) return 0;
  let max = 0;
  for (const mark of activeContext.marks.values()) {
    if (mark.openLatencyMs > max) max = mark.openLatencyMs;
  }
  return max;
};

const finalizeAbandonedOpen = (reason: string): void => {
  if (!activeContext || activeContext.summaryLogged) return;
  const ctx = activeContext;
  ctx.summaryLogged = true;

  const openBegin = ctx.marks.get('open_begin');
  const firstPaint = ctx.marks.get('mmkv_first_paint');
  const initialFetchStart = ctx.marks.get('zero_initial_conversation_load_start');
  const localSnapshotApplied = ctx.marks.get('zero_initial_local_snapshot_applied');
  const initialFetchDone = ctx.marks.get('zero_initial_conversation_load_done');
  const initialFetchError = ctx.marks.get('zero_initial_conversation_load_error');
  const reachedStage = initialFetchDone
    ? 'fetch_complete'
    : initialFetchError
      ? 'fetch_failed'
      : localSnapshotApplied
        ? 'local_snapshot_applied'
        : initialFetchStart
          ? 'fetch_running'
          : firstPaint
            ? 'first_paint'
            : 'pre_paint';
  const navigationLatencyMs = getNumber(openBegin?.payload['routeOpenLatencyMs']);
  const entryPoint = getString(openBegin?.payload['entryPoint']);
  const surface = getString(openBegin?.payload['surface']);
  const threadId = getString(openBegin?.payload['threadId']);
  const notificationOpenKind = getString(openBegin?.payload['notificationOpenKind']);

  logger.info(Event.LOTUS_CHAT_OPEN_TIMING, {
    milestone: 'open_abandoned',
    reason,
    cycleId: ctx.cycleId,
    channelId: ctx.channelId,
    ...(threadId ? { threadId } : {}),
    ...(surface ? { surface } : {}),
    ...(entryPoint ? { entryPoint } : {}),
    ...(notificationOpenKind ? { notificationOpenKind } : {}),
    ...(typeof navigationLatencyMs === 'number' ? { navigationLatencyMs } : {}),
    reachedStage,
    firstPaintReached: !!firstPaint,
    ...(firstPaint ? { firstPaintLatencyMs: firstPaint.openLatencyMs } : {}),
    localSnapshotApplied: !!localSnapshotApplied,
    ...(localSnapshotApplied
      ? { localSnapshotAppliedLatencyMs: localSnapshotApplied.openLatencyMs }
      : {}),
    abandonedAtLatencyMs: Math.round(now() - ctx.startedAt),
    lastMarkedLatencyMs: lastMarkLatencyMs(),
  });
};

const emit = (name: string, payload?: ChatOpenProfilePayload): void => {
  if (!activeContext) return;
  if (!ENABLE_VERBOSE_CHAT_OPEN_PROFILER && !PRODUCTION_MARKS.has(name)) return;
  const openLatencyMs = Math.round(now() - activeContext.startedAt);
  activeContext.marks.set(name, {
    openLatencyMs,
    payload: payload ?? {},
  });

  if (name === 'final_live_paint') {
    if (activeContext.summaryLogged) return;
    const summary = buildOpenSummary();
    if (!summary) return;
    activeContext.summaryLogged = true;
    logger.info(Event.LOTUS_CHAT_OPEN_TIMING, summary);
    return;
  }

  if (name === 'live_settled_paint') {
    const finalLivePaint = activeContext.marks.get('final_live_paint');
    if (!finalLivePaint) return;

    const openBegin = activeContext.marks.get('open_begin');
    const entryPoint = getString(openBegin?.payload['entryPoint']);
    const surface = getString(openBegin?.payload['surface']);
    const threadId = getString(openBegin?.payload['threadId']);
    const notificationOpenKind = getString(openBegin?.payload['notificationOpenKind']);
    const visibleRows =
      getNumber(finalLivePaint.payload['displayRows']) ??
      getNumber(finalLivePaint.payload['rows']) ??
      getNumber(finalLivePaint.payload['paintRows']);
    const liveRows = getNumber(payload?.['rows']) ?? getNumber(payload?.['paintRows']);
    const firstPaintDataSource = getString(finalLivePaint.payload['dataSource']);
    if (firstPaintDataSource === 'backend') return;

    logger.info(Event.LOTUS_CHAT_OPEN_TIMING, {
      milestone: 'live_settled',
      cycleId: activeContext.cycleId,
      channelId: activeContext.channelId,
      ...(threadId ? { threadId } : {}),
      ...(surface ? { surface } : {}),
      ...(entryPoint ? { entryPoint } : {}),
      ...(notificationOpenKind ? { notificationOpenKind } : {}),
      liveSettledLatencyMs: openLatencyMs,
      ...(typeof visibleRows === 'number' ? { visibleRows } : {}),
      ...(typeof liveRows === 'number' ? { liveRows } : {}),
      ...(typeof visibleRows === 'number' && typeof liveRows === 'number'
        ? { rowCountDeltaAfterVisible: liveRows - visibleRows }
        : {}),
      visiblePaintLatencyMs: finalLivePaint.openLatencyMs,
      visibleToLiveSettledDelayMs: Math.max(0, openLatencyMs - finalLivePaint.openLatencyMs),
      ...(payload ?? {}),
    });
    return;
  }

  if (name === 'zero_initial_conversation_load_error' && !activeContext.errorLogged) {
    activeContext.errorLogged = true;
    const errorMark = activeContext.marks.get('zero_initial_conversation_load_error');
    logger.warn(Event.LOTUS_CHAT_OPEN_TIMING, {
      milestone: 'initial_messages_fetch_failed',
      cycleId: activeContext.cycleId,
      channelId: activeContext.channelId,
      openLatencyMs,
      ...(errorMark?.payload ?? {}),
    });
  }
};

export const chatOpenProfiler = {
  begin(cycleId: string, channelId: string, payload?: ChatOpenProfilePayload): void {
    if (activeContext && activeContext.cycleId !== cycleId) {
      finalizeAbandonedOpen('superseded');
    }
    activeContext = {
      cycleId,
      channelId,
      startedAt: now(),
      counters: new Map(),
      marks: new Map(),
      summaryLogged: false,
      errorLogged: false,
    };
    activeContext.marks.set('open_begin', {
      openLatencyMs: 0,
      payload: payload ?? {},
    });
  },

  mark(name: string, payload?: ChatOpenProfilePayload): void {
    emit(name, payload);
  },

  abandon(cycleId: string, reason: string): void {
    if (!activeContext || activeContext.cycleId !== cycleId) return;
    finalizeAbandonedOpen(reason);
    activeContext = null;
  },

  count(name: string, amount = 1): void {
    if (!ENABLE_VERBOSE_CHAT_OPEN_PROFILER) return;
    if (!activeContext) return;
    activeContext.counters.set(name, (activeContext.counters.get(name) ?? 0) + amount);
  },

  flushCounters(name: string, payload?: ChatOpenProfilePayload): void {
    if (!ENABLE_VERBOSE_CHAT_OPEN_PROFILER) return;
    if (!activeContext) return;
    const counters: Record<string, number> = {};
    for (const [key, value] of activeContext.counters) {
      counters[key] = value;
    }
    logger.info(Event.LOTUS_CHAT_OPEN_TIMING, {
      milestone: name,
      cycleId: activeContext.cycleId,
      channelId: activeContext.channelId,
      counters,
      ...(payload ?? {}),
    });
  },

  measure<T>(name: string, fn: () => T, payload?: ChatOpenProfilePayload): T {
    if (!ENABLE_VERBOSE_CHAT_OPEN_PROFILER && !PRODUCTION_MARKS.has(name)) return fn();
    const start = now();
    try {
      return fn();
    } finally {
      emit(name, {
        durationMs: Math.round(now() - start),
        ...(payload ?? {}),
      });
    }
  },
};
