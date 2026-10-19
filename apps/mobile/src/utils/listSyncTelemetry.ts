export type ListSyncStage =
  | 'first_time'
  | 'warm_cache'
  | 'load_more'
  | 'cache_hydrate'
  | 'foreground_sync'
  | 'startup_prewarm'
  | 'live_update';
export type ListSyncStatus = 'complete' | 'error';
export type InitialListDataSource = 'none' | 'boot_cache' | 'snapshot_cache' | 'query_cache';
export type ListSyncDataSource = 'zero_run' | 'zero_subscription' | 'boot_cache' | 'query_cache';

type BuildListSyncPayloadArgs = {
  listType: 'dm_list' | 'activity_list' | 'calls_list' | 'channels_list';
  stage: ListSyncStage;
  status?: ListSyncStatus;
  listStartedAtMs: number;
  queryStartedAtMs: number;
  completedAtMs?: number;
  hadInitialData: boolean;
  visibleRowCount: number;
  queryRowCount?: number;
  cacheRowCount?: number;
  dataSource: ListSyncDataSource;
  newRows?: number;
  updatedRows?: number;
  hasMore?: boolean;
  initialDataSource?: InitialListDataSource;
  filterTab?: string;
  queryName?: string;
  queryComplete?: boolean;
  latestItemAt?: number;
  previousLatestItemAt?: number;
  error?: string | undefined;
};

const elapsedMs = (
  fromMs: number | null | undefined,
  toMs: number | null | undefined,
): number | undefined => {
  if (typeof toMs !== 'number' || !Number.isFinite(toMs)) return undefined;
  if (typeof fromMs !== 'number' || !Number.isFinite(fromMs)) return undefined;
  return Math.max(0, Math.round(toMs - fromMs));
};

export const buildListSyncPayload = ({
  listType,
  stage,
  status = 'complete',
  listStartedAtMs,
  queryStartedAtMs,
  completedAtMs = performance.now(),
  hadInitialData,
  visibleRowCount,
  queryRowCount,
  cacheRowCount,
  dataSource,
  newRows,
  updatedRows,
  hasMore,
  initialDataSource,
  filterTab,
  queryName,
  queryComplete,
  latestItemAt,
  previousLatestItemAt,
  error,
}: BuildListSyncPayloadArgs): Record<string, unknown> => {
  const queryLatencyMs = elapsedMs(queryStartedAtMs, completedAtMs);
  const totalLatencyMs = elapsedMs(listStartedAtMs, completedAtMs);
  const shouldEmitTotalLatency =
    typeof queryLatencyMs === 'number' &&
    typeof totalLatencyMs === 'number' &&
    totalLatencyMs !== queryLatencyMs;
  const shouldEmitInitialDataSource =
    initialDataSource !== undefined && initialDataSource !== 'none';

  return {
    list_type: listType,
    stage,
    status,
    latency_ms: queryLatencyMs ?? null,
    ...(shouldEmitTotalLatency ? { total_latency_ms: totalLatencyMs } : {}),
    data_source: dataSource,
    ...(shouldEmitInitialDataSource ? { initial_data_source: initialDataSource } : {}),
    had_initial_data: hadInitialData,
    visible_row_count: visibleRowCount,
    ...(queryRowCount !== undefined ? { query_row_count: queryRowCount } : {}),
    ...(cacheRowCount !== undefined ? { cache_row_count: cacheRowCount } : {}),
    ...(newRows !== undefined ? { new_rows: newRows } : {}),
    ...(updatedRows !== undefined ? { updated_rows: updatedRows } : {}),
    ...(hasMore !== undefined ? { has_more: hasMore } : {}),
    ...(queryComplete !== undefined ? { query_complete: queryComplete } : {}),
    ...(latestItemAt !== undefined ? { latest_item_at: latestItemAt } : {}),
    ...(previousLatestItemAt !== undefined
      ? { previous_latest_item_at: previousLatestItemAt }
      : {}),
    ...(filterTab ? { filter_tab: filterTab } : {}),
    ...(queryName ? { query_name: queryName } : {}),
    ...(error ? { error } : {}),
  };
};
