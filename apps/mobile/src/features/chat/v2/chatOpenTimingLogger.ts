import { Event, logger } from '@/src/utils/logger';
import { getConnectionDurationDuring } from '@/src/utils/zeroConnectionTiming';

export type ChatOpenPaintSource =
  'backend' | 'local' | 'cache' | 'thread_cache' | 'mixed_zero_thread_cache' | 'none';

export type ChatOpenTimingTelemetry = {
  cacheHit?: boolean | undefined;
  cacheReadDurationMs?: number | undefined;
  cacheRows?: number | undefined;
  cacheSnapshotAgeMs?: number | undefined;
  initialFetchStatus?: 'not_started' | 'running' | 'complete' | 'failed' | undefined;
  preZeroQueryDispatchMs?: number | undefined;
  initialFetchDurationMs?: number | undefined;
};

type ChatOpenSummaryInput = {
  cycleId: string;
  channelId: string;
  startedAtMs: number;
  threadId?: string | undefined;
  entryPoint?: string | undefined;
  notificationOpenKind?: string | undefined;
  routeOpenLatencyMs?: number | null | undefined;
  firstPaintSource?: ChatOpenPaintSource | undefined;
  firstPaintLatencyMs?: number | undefined;
  finalLivePaintLatencyMs: number;
  telemetry?: ChatOpenTimingTelemetry | undefined;
};

const getNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;

const normalizePaintSource = (source: ChatOpenPaintSource): string => source;

const formatAge = (ms: number): string => {
  const safeMs = Math.max(0, Math.round(ms));
  if (safeMs < 1000) return `${safeMs}ms`;

  const totalSeconds = Math.floor(safeMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return seconds > 0 ? `${totalMinutes}m${seconds}s` : `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return minutes > 0 ? `${totalHours}h${minutes}m` : `${totalHours}h`;

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d${hours}h` : `${days}d`;
};

export const logChatOpenSummary = ({
  cycleId,
  channelId,
  startedAtMs,
  threadId,
  entryPoint,
  notificationOpenKind,
  routeOpenLatencyMs,
  firstPaintSource,
  firstPaintLatencyMs,
  finalLivePaintLatencyMs,
  telemetry,
}: ChatOpenSummaryInput): void => {
  const cacheRows = getNumber(telemetry?.cacheRows);
  const initialFetchStatus = telemetry?.initialFetchStatus ?? 'not_started';
  const resolvedFirstPaintSource = normalizePaintSource(firstPaintSource ?? 'backend');
  const preZeroQueryDispatchMs = getNumber(telemetry?.preZeroQueryDispatchMs);
  const backendFetchDurationMs = getNumber(telemetry?.initialFetchDurationMs);
  const zeroConnectionEndMs =
    typeof preZeroQueryDispatchMs === 'number' ? startedAtMs + preZeroQueryDispatchMs : undefined;
  const zeroReconnectWaitMs =
    typeof zeroConnectionEndMs === 'number'
      ? getConnectionDurationDuring(startedAtMs, zeroConnectionEndMs)
      : undefined;
  const renderAfterBackendMs =
    typeof telemetry?.preZeroQueryDispatchMs === 'number' &&
    typeof backendFetchDurationMs === 'number' &&
    finalLivePaintLatencyMs >= telemetry.preZeroQueryDispatchMs + backendFetchDurationMs
      ? Math.max(
          0,
          finalLivePaintLatencyMs - telemetry.preZeroQueryDispatchMs - backendFetchDurationMs,
        )
      : undefined;
  logger.info(Event.LOTUS_CHAT_OPEN_TIMING, {
    cycleId,
    channelId,
    ...(threadId ? { threadId } : {}),
    ...(entryPoint ? { entryPoint } : {}),
    ...(notificationOpenKind ? { notificationOpenKind } : {}),
    ...(typeof routeOpenLatencyMs === 'number' ? { navigationLatencyMs: routeOpenLatencyMs } : {}),
    firstPaintSource: resolvedFirstPaintSource,
    ...(typeof firstPaintLatencyMs === 'number' ? { firstPaintLatencyMs } : {}),
    finalLivePaintLatencyMs,
    ...(typeof telemetry?.cacheHit === 'boolean'
      ? { cacheStatus: telemetry.cacheHit ? 'hit' : 'miss' }
      : {}),
    ...(typeof telemetry?.cacheReadDurationMs === 'number'
      ? { cacheReadDurationMs: telemetry.cacheReadDurationMs }
      : {}),
    ...(typeof cacheRows === 'number' ? { cacheRows } : {}),
    ...(typeof telemetry?.cacheSnapshotAgeMs === 'number'
      ? { cacheSnapshotAge: formatAge(telemetry.cacheSnapshotAgeMs) }
      : {}),
    backendSyncStatus: initialFetchStatus,
    ...(typeof preZeroQueryDispatchMs === 'number'
      ? { backendSyncStartDelayMs: preZeroQueryDispatchMs }
      : {}),
    ...(typeof backendFetchDurationMs === 'number' ? { backendFetchDurationMs } : {}),
    ...(typeof zeroReconnectWaitMs === 'number' ? { zeroReconnectWaitMs } : {}),
    ...(typeof renderAfterBackendMs === 'number' ? { renderAfterBackendMs } : {}),
  });
};
