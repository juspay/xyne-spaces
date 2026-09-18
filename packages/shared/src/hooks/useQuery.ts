import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useQuery as zeroUseQuery } from '@rocicorp/zero/react';
import type {
  DefaultSchema,
  BaseDefaultSchema,
  DefaultContext,
  BaseDefaultContext,
  PullRow,
  ReadonlyJSONValue,
  QueryRequest,
  Query,
  TTL,
} from '@rocicorp/zero';
import type { UseQueryOptions, QueryResult } from '@rocicorp/zero/react';
import { Event } from '../logger/events.js';
import { useInstrumentation, useZero } from './useZero.js';
import { isSharedQuery, isWorkspacePartitioned } from '../sync/registry.js';
import { useSharedQuery, useSyncEngineReady, useSyncServing } from '../sync/useSharedQuery.js';
import { obsEmit, isShadow } from '../sync/obs.js';
import { useZeroFallbackConfig } from './ZeroFallbackContext.js';
import { useFallbackQuery } from './useFallbackQuery.js';
import { useEncryptionConfig } from './useEncryptionConfig.js';
import { decryptionCache } from '../crypto/decryption-cache.js';
import { isEncryptedField } from '../crypto/field-decrypt.js';
import { wasInterrupted } from './metricValidity.js';
import type { MetricsRecorder } from '../logger/index.js';

/**
 * Decryption pass over query results using server-provided config.
 * Pure function — no hooks allowed here.
 * Records metrics when metrics API is provided.
 */
function decryptResultData<TData>(
  data: TData,
  key: CryptoKey | null,
  encryptedFields: Record<string, { fields: string[]; enforceClientEncryption: boolean }>,
  metrics?: MetricsRecorder,
  queryName?: string,
): [TData, boolean] {
  if (!data || typeof data !== 'object') {
    return [data, false];
  }

  let hasPending = false;
  const startTime = performance.now();
  let cacheHits = 0;
  let cacheMisses = 0;
  let fieldsProcessed = 0;
  const tablesEncountered = new Set<string>();

  function traverseRecord(record: Record<string, unknown>): Record<string, unknown> {
    const entries = Object.entries(record).filter(([k]) => k !== '__tableName');
    const result: Record<string, unknown> = {};

    for (const [k, v] of entries) {
      result[k] = traverse(v);
    }

    return result;
  }

  function decryptRecord(
    record: Record<string, unknown>,
    tableName: string,
  ): [Record<string, unknown>, boolean] {
    const tableConfig = encryptedFields[tableName];
    if (!tableConfig || !tableConfig.fields?.length || !tableConfig.enforceClientEncryption) {
      if ('__tableName' in record) {
        const { __tableName, ...rest } = record;
        return [rest, false];
      }
      return [record, false];
    }

    tablesEncountered.add(tableName);
    const fieldsToDecrypt = tableConfig.fields;
    let recordPending = false;
    let modified = false;
    const copy: Record<string, unknown> = {};

    for (const field of fieldsToDecrypt) {
      const value = record[field];
      if (isEncryptedField(value)) {
        fieldsProcessed++;
        const encryptedValue = value as string;
        const cached = decryptionCache.get(encryptedValue);

        if (cached !== undefined) {
          copy[field] = cached;
          modified = true;
          cacheHits++;
        } else {
          if (key) {
            const prefetchStart = performance.now();
            void decryptionCache.prefetch(encryptedValue, key);
            const prefetchLatency = performance.now() - prefetchStart;
            metrics?.recordLatency?.('crypto.decrypt.cache.prefetch', prefetchLatency, {
              query: queryName ?? 'unknown',
              table: tableName,
            });
          }
          // Mark as pending even without key - ensures re-processing when key arrives
          recordPending = true;
          cacheMisses++;
        }
      }
    }

    if (modified) {
      const result = { ...record, ...copy };
      // Remove metadata field before returning
      delete result['__tableName'];
      return [result, recordPending];
    }
    // Remove metadata field even if not modified
    if ('__tableName' in record) {
      const { __tableName, ...rest } = record;
      return [rest, recordPending];
    }
    return [record, recordPending];
  }

  function traverse(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;

    if (Array.isArray(value)) {
      const firstRow = value[0] as Record<string, unknown> | undefined;
      const tableName = firstRow?.['__tableName'] as string | undefined;

      if (tableName && encryptedFields[tableName]?.enforceClientEncryption) {
        const decrypted: unknown[] = [];
        for (const row of value) {
          if (row && typeof row === 'object') {
            const [dr, pending] = decryptRecord(row as Record<string, unknown>, tableName);
            if (pending) hasPending = true;
            decrypted.push(traverseRecord(dr));
          } else {
            decrypted.push(row);
          }
        }
        return decrypted;
      }

      return value.map(traverse);
    }

    const obj = value as Record<string, unknown>;
    const tableName = obj['__tableName'] as string | undefined;

    if (tableName && encryptedFields[tableName]?.enforceClientEncryption) {
      const [dr, pending] = decryptRecord(obj, tableName);
      if (pending) hasPending = true;
      return traverseRecord(dr);
    }

    return traverseRecord(obj);
  }

  const result = traverse(data);

  const totalLatency = performance.now() - startTime;
  if (fieldsProcessed > 0 && metrics) {
    const tableTag = Array.from(tablesEncountered).join(',');
    metrics.recordLatency('crypto.decrypt.result_data', totalLatency, {
      query: queryName ?? 'unknown',
      table: tableTag,
    });
    metrics.recordLatency('crypto.decrypt.cache_hits', cacheHits, {
      query: queryName ?? 'unknown',
      table: tableTag,
    });
    metrics.recordLatency('crypto.decrypt.cache_misses', cacheMisses, {
      query: queryName ?? 'unknown',
      table: tableTag,
    });
    metrics.recordLatency('crypto.decrypt.fields_processed', fieldsProcessed, {
      query: queryName ?? 'unknown',
      table: tableTag,
    });
  }

  return [result as TData, hasPending];
}

/**
 * App-wide default TTL for queries that don't specify one. Zero's own default
 * is 5m; after unmount a query keeps a live zero-cache pipeline until its TTL
 * expires, so per-entity queries pile up server-side. Callers with a reason to
 * keep a query hot (shared context, frequent back-nav) pass an explicit ttl.
 */
export const DEFAULT_QUERY_TTL: TTL = '2m';

function withDefaultTTL(options?: UseQueryOptions | boolean): UseQueryOptions {
  if (typeof options === 'object' && options !== null) {
    return options.ttl !== undefined ? options : { ...options, ttl: DEFAULT_QUERY_TTL };
  }
  return { ttl: DEFAULT_QUERY_TTL };
}

/**
 * Walks a query result (array or singular) and returns the highest
 * `updatedAt | lastActivityAt | createdAt` it finds across all rows.
 * Returns 0 when no timestamps are present, which deterministically
 * yields to the other source rather than guessing.
 *
 * Used as a freshness signal in the SWR ladder: Zero can fire `complete`
 * from its persisted kv state (see `experimentalWatch({initialValuesInFirstDiff: true})`
 * in zero-client's queryManager), which means a fresh fallback HTTP result
 * may carry rows that are strictly newer than what Zero just emitted as
 * `complete`. Yielding to Zero unconditionally in that window causes the
 * cache to be overwritten with the older kv snapshot, producing a visible
 * "fresh → stale → fresh" flicker until IVM applies the next server diff.
 */
function maxFreshnessTimestamp(data: unknown): number {
  if (data == null) return 0;
  const rows = Array.isArray(data) ? data : [data];
  let max = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const v = r['updatedAt'] ?? r['lastActivityAt'] ?? r['createdAt'];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) || 0 : 0;
    if (n > max) max = n;
  }
  return max;
}

/**
 * Internal: routes query through Zero or fallback based on config.
 */
function useQueryWithFallback<
  TTable extends keyof TSchema['tables'] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  query: QueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  options?: UseQueryOptions | boolean,
): QueryResult<TReturn> {
  const { fallbackEnabled, keepZeroAlongsideFallback, onZeroComplete } = useZeroFallbackConfig();

  const enabledOption = typeof options === 'object' ? options.enabled : options;
  const baseEnabled = enabledOption ?? true;

  // Zero stays subscribed while fallback is on only when the app has opted in
  // via `keepZeroAlongsideFallback`. Lotus opts in so its first-complete latch
  // can fire (the latch needs Zero to actually run to flip). Dashboard doesn't
  // opt in → Zero is disabled while fallback serves the page (original behavior,
  // no wasted parallel IVM hydration).
  const zeroEnabled = (keepZeroAlongsideFallback || !fallbackEnabled) && baseEnabled;

  const zeroResult = zeroUseQuery(query, {
    ...withDefaultTTL(options),
    enabled: zeroEnabled,
  });

  const fallbackResult = useFallbackQuery<TTable, TInput, TOutput, TSchema, TReturn, TContext>(
    query,
    typeof options === 'object'
      ? { ...options, enabled: fallbackEnabled && baseEnabled }
      : fallbackEnabled && baseEnabled,
  );

  // Notify the app's "Zero is ready" signal the first time Zero delivers any
  // query result. No-op when the app doesn't supply onZeroComplete.
  const zeroDetailsType = zeroResult[1].type;
  useEffect(() => {
    if (zeroDetailsType === 'complete') {
      onZeroComplete?.();
    }
  }, [zeroDetailsType, onZeroComplete]);

  // SWR handoff between fallback and Zero. When `keepZeroAlongsideFallback`
  // is opted in (lotus), Zero stays subscribed alongside fallback so the
  // first-complete latch can flip. The handoff handles two known races:
  //
  // 1. Latch flips before Zero has confirmed THIS query → Zero is unknown,
  //    return fallback (stale-while-revalidate, prevents empty flash).
  // 2. Zero emits `complete` from its persisted kv `got` state (the standard
  //    Zero behavior — see queryManager's experimentalWatch with
  //    initialValuesInFirstDiff: true) but the snapshot it carries predates
  //    a recent postgres mutation that fallback DID capture. Returning Zero
  //    here would overwrite the fresher fallback rows in queryCacheActor
  //    until IVM applies the next server diff (typically seconds), producing
  //    a visible fresh→stale→fresh flicker. Guard by comparing the max
  //    timestamp across rows and yielding only when Zero is at least as
  //    fresh.
  if (fallbackEnabled) return fallbackResult;
  if (!keepZeroAlongsideFallback) return zeroResult;
  if (zeroResult[1].type === 'complete') {
    if (fallbackResult[1].type === 'complete') {
      const zMax = maxFreshnessTimestamp(zeroResult[0]);
      const fMax = maxFreshnessTimestamp(fallbackResult[0]);
      if (zMax >= fMax) return zeroResult;
      return fallbackResult;
    }
    return zeroResult;
  }
  if (fallbackResult[1].type === 'complete') return fallbackResult;
  return zeroResult;
}

/**
 * Shared useQuery with instrumentation and fallback support.
 * Both dashboard and lotus use this implementation.
 */
export function useQuery<
  TTable extends keyof TSchema['tables'] & string,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
  TContext extends BaseDefaultContext = DefaultContext,
>(
  query: QueryRequest<TTable, TInput, TOutput, TSchema, TReturn, TContext>,
  options?: UseQueryOptions | boolean,
): QueryResult<TReturn> {
  const { logger, metrics } = useInstrumentation();
  const queryName = query.query.queryName || 'unknown';
  const args = query.args;

  // Shared-base sync engine: for allowlisted queries, serve from the local hosted IVM
  // (fan-out) and disable Zero. Direct callers get the result here; useCachedQuery
  // caches whatever this returns, unchanged.
  const zero = useZero();
  const syncReady = useSyncEngineReady();
  // Serving = the server hasn't refused this principal (`sync:unavailable`, e.g. a guest). When it
  // has, a shared query is NOT routed to the engine at all — it stays on native Zero. This is the
  // role-agnostic connection-level fallback; the SWR handoff below is the per-query safety net.
  const serving = useSyncServing();
  const isShared = useMemo(
    () => syncReady && serving && isSharedQuery(query.query.queryName),
    [syncReady, serving, query.query.queryName],
  );
  // Shadow-diff: keep Zero running alongside the sync result and DISPLAY Zero (known-good),
  // so we can measure where the sync result deviates without corrupting the UI.
  const shadow = isShared && isShadow();
  // Workspace-partitioned queries: inject ctx.workspaceId into the args so the instance keys per
  // workspace and the override base partitions correctly. The caller never passes workspaceId (the
  // query stays argless); the backend independently FORCES it from the socket, so this only keeps the
  // client's instance key + local base aligned with the server's. Non-partitioned queries pass through.
  const sharedArgs = useMemo(() => {
    if (!isShared || !isWorkspacePartitioned(query.query.queryName)) return args;
    return { ...((args as object) ?? {}), workspaceId: zero.context.workspaceId };
  }, [isShared, args, query.query.queryName, zero.context.workspaceId]);
  const sharedHash = useMemo(() => {
    if (!isShared) return undefined;
    try {
      // @ts-expect-error internal query structure (mirrors useCachedQuery hashing)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      return (query.query.fn({ ctx: zero.context, args: sharedArgs }).hash() as string) || undefined;
    } catch {
      return undefined;
    }
  }, [isShared, query, zero.context, sharedArgs]);
  const sharedResult = useSharedQuery<TReturn>(
    isShared,
    sharedHash,
    query.query.queryName,
    sharedArgs,
    zero.context,
  );

  const argsKey = useMemo(() => JSON.stringify(args), [args]);
  const startTime = useMemo(() => performance.now(), [queryName, argsKey]);
  const hasLoggedCompleteRef = useRef(false);
  const isEnabled = typeof options === 'boolean' ? options : options?.enabled !== false;

  useEffect(() => {
    if (!isEnabled) return;
    hasLoggedCompleteRef.current = false;
    // Observability: which route this query mount took (Zero vs shared sync engine).
    obsEmit('client-route', { queryName, route: isShared ? 'sync' : 'zero' });
    logger.info(Event.ZERO_QUERY_CALLED, { query: queryName });
    metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'start' });
  }, [queryName, argsKey, isEnabled, isShared]);

  // SWR handoff: keep Zero live until the sync engine has actually HYDRATED this query, then
  // disable it. Zero is the safety net — if the engine never hydrates (a silent failure: stuck
  // hydration, a per-query `sync:error`, a connection that never readies), Zero keeps serving and
  // the query never blanks. This makes the fallback automatic and role-agnostic. In shadow mode Zero
  // is always kept (it's the displayed baseline). Once hydrated, steady-state load moves off Zero.
  const sharedHydrated = isShared && sharedResult?.[1]?.type === 'complete';
  const effectiveOptions = useMemo(() => {
    if (!isShared || shadow || !sharedHydrated) return options;
    return typeof options === 'object' && options !== null
      ? { ...options, enabled: false }
      : { enabled: false };
  }, [isShared, shadow, sharedHydrated, options]);
  const result = useQueryWithFallback(query, effectiveOptions);
  const [data, details] = result;

  // Shadow-diff: once BOTH the Zero result (`result`) and the sync result (`sharedResult`)
  // are `complete`, compare their data — but debounced, so a live delta that lands on one
  // a beat before the other doesn't read as a divergence. A diff that survives the settle
  // is a real deviation and is logged to the obs.
  const shadowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!shadow || !sharedResult) return;
    const [, zDetails] = result;
    const [, sDetails] = sharedResult;
    if (zDetails.type !== 'complete' || sDetails.type !== 'complete') return;
    if (shadowTimer.current) clearTimeout(shadowTimer.current);
    shadowTimer.current = setTimeout(() => {
      const [zData] = result;
      const [sData] = sharedResult;
      const zeroLen = Array.isArray(zData) ? zData.length : zData == null ? 0 : 1;
      const syncLen = Array.isArray(sData) ? sData.length : sData == null ? 0 : 1;
      let match = zeroLen === syncLen;
      if (match) {
        try {
          match = shadowStable(zData) === shadowStable(sData);
        } catch {
          match = false;
        }
      }
      obsEmit('shadow-diff', {
        queryName,
        match,
        zeroLen,
        syncLen,
        ...(match ? {} : { zeroIds: shadowIds(zData), syncIds: shadowIds(sData) }),
      });
    }, 600);
    return () => {
      if (shadowTimer.current) clearTimeout(shadowTimer.current);
    };
  }, [shadow, result, sharedResult, queryName]);

  useEffect(() => {
    if (details.type === 'complete' && !hasLoggedCompleteRef.current) {
      hasLoggedCompleteRef.current = true;
      const latency = performance.now() - startTime;
      const skewed = wasInterrupted(startTime);
      if (!skewed) {
        metrics.recordLatency('zero.query.latency', latency, { query: queryName });
      }
      metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'success' });
      const rowCount = Array.isArray(data) ? data.length : data != null ? 1 : 0;
      logger.info(Event.ZERO_QUERY_COMPLETE, { query: queryName, latency, skewed, rowCount });
    } else if (details.type === 'error') {
      metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'error' });
      logger.error(Event.ZERO_QUERY_FAILED, { query: queryName, error: details.error });
    }
  }, [data, details, queryName, startTime, metrics, logger]);

  // Decryption pass — uses server-provided config from context
  const { key, config: encConfig } = useEncryptionConfig();
  const encryptedFields = encConfig?.encryptedFields ?? {};
  const clientEncryptionEnabled = encConfig?.clientEncryptionEnabled ?? false;
  const hasEncrypted = Object.keys(encryptedFields).length > 0;
  const shouldDecrypt = hasEncrypted && clientEncryptionEnabled;

  const [decryptionTick, setDecryptionTick] = useState(0);
  const triggerRerender = useCallback(() => setDecryptionTick(t => t + 1), []);

  // Ref to hold fully-decrypted data snapshot - only updated when hasPending is false
  const stableDecryptedRef = useRef<typeof data | null>(null);
  // Track the source data that produced our stable snapshot
  const lastSourceDataRef = useRef<typeof data | null>(null);

  const [decryptedData, hasPending] = useMemo(
    () => (shouldDecrypt ? decryptResultData(data, key, encryptedFields, metrics, queryName) : [data, false]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, key, encryptedFields, decryptionTick, shouldDecrypt],
  );

  // Update stable ref only when we have complete decrypted data
  useEffect(() => {
    if (!shouldDecrypt) return;
    if (!hasPending && decryptedData !== lastSourceDataRef.current) {
      stableDecryptedRef.current = decryptedData;
      lastSourceDataRef.current = data;
    }
  }, [decryptedData, hasPending, data, shouldDecrypt]);

  useEffect(() => {
    if (!shouldDecrypt) return;
    if (hasPending) {
      return decryptionCache.subscribe(triggerRerender);
    }
    return undefined;
  }, [hasPending, triggerRerender, data, shouldDecrypt]);

  // Shared queries return the hosted-IVM result directly (Zero disabled above).
  // Decryption of shared rows is a follow-up. In shadow mode we DISPLAY Zero (baseline)
  // and only observe the sync result via the diff above.
  if (isShared) return shadow ? result : sharedResult ?? result;

  if (!shouldDecrypt) {
    return result;
  }

  // Return stable snapshot while decrypting to prevent UI flicker.
  // Only expose new data when fully decrypted (hasPending = false).
  // On first render with no stable data yet, return current decrypted state.
  const outputData =
    hasPending && stableDecryptedRef.current !== null ? stableDecryptedRef.current : decryptedData;

  return [outputData, details] as unknown as QueryResult<TReturn>;
}

/**
 * useRawQuery for raw Query objects (not QueryRequest).
 * Requires explicit queryName for logging/metrics.
 */
export function useRawQuery<
  TTable extends keyof TSchema['tables'] & string,
  TSchema extends BaseDefaultSchema = DefaultSchema,
  TReturn = PullRow<TTable, TSchema>,
>(
  query: Query<TTable, TSchema, TReturn>,
  queryName: string,
  options?: UseQueryOptions | boolean,
): QueryResult<TReturn> {
  const { logger, metrics } = useInstrumentation();

  const queryKey = useMemo(() => JSON.stringify(query), [query]);
  const startTime = useMemo(() => performance.now(), [queryName, queryKey]);
  const hasLoggedCompleteRef = useRef(false);

  useEffect(() => {
    hasLoggedCompleteRef.current = false;
    logger.info(Event.ZERO_QUERY_CALLED, { query: queryName });
    metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'start' });
  }, [queryName, queryKey]);

  const result = zeroUseQuery(query, withDefaultTTL(options));
  const [data, details] = result;

  useEffect(() => {
    if (details.type === 'complete' && !hasLoggedCompleteRef.current) {
      hasLoggedCompleteRef.current = true;
      const latency = performance.now() - startTime;
      const skewed = wasInterrupted(startTime);
      if (!skewed) {
        metrics.recordLatency('zero.query.latency', latency, { query: queryName });
      }
      metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'success' });
      const rowCount = Array.isArray(data) ? data.length : data != null ? 1 : 0;
      logger.info(Event.ZERO_QUERY_COMPLETE, { query: queryName, latency, skewed, rowCount });
    } else if (details.type === 'error') {
      metrics.incrementCounter('zero.query.operations', { query: queryName, stage: 'error' });
      logger.error(Event.ZERO_QUERY_FAILED, { query: queryName, error: details.error });
    }
  }, [data, details, queryName]);

  // Decryption pass — uses server-provided config from context
  const { key, config: encConfig } = useEncryptionConfig();
  const encryptedFields = encConfig?.encryptedFields ?? {};
  const clientEncryptionEnabled = encConfig?.clientEncryptionEnabled ?? false;
  const hasEncrypted = Object.keys(encryptedFields).length > 0;
  const shouldDecrypt = hasEncrypted && clientEncryptionEnabled;

  const [decryptionTick, setDecryptionTick] = useState(0);
  const triggerRerender = useCallback(() => setDecryptionTick(t => t + 1), []);

  // Ref to hold fully-decrypted data snapshot - only updated when hasPending is false
  const stableDecryptedRef = useRef<typeof data | null>(null);
  // Track the source data that produced our stable snapshot
  const lastSourceDataRef = useRef<typeof data | null>(null);

  const [decryptedData, hasPending] = useMemo(
    () => (shouldDecrypt ? decryptResultData(data, key, encryptedFields, metrics, queryName) : [data, false]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, key, encryptedFields, decryptionTick, shouldDecrypt],
  );

  // Update stable ref only when we have complete decrypted data
  useEffect(() => {
    if (!shouldDecrypt) return;
    if (!hasPending && decryptedData !== lastSourceDataRef.current) {
      stableDecryptedRef.current = decryptedData;
      lastSourceDataRef.current = data;
    }
  }, [decryptedData, hasPending, data, shouldDecrypt]);

  useEffect(() => {
    if (!shouldDecrypt) return;
    if (hasPending) {
      return decryptionCache.subscribe(triggerRerender);
    }
    return undefined;
  }, [hasPending, triggerRerender, data, shouldDecrypt]);

  if (!shouldDecrypt) {
    return result;
  }

  // Return stable snapshot while decrypting to prevent UI flicker.
  // Only expose new data when fully decrypted (hasPending = false).
  // On first render with no stable data yet, return current decrypted state.
  const outputData =
    hasPending && stableDecryptedRef.current !== null ? stableDecryptedRef.current : decryptedData;

  return [outputData, details] as unknown as QueryResult<TReturn>;
}

/** Stable JSON of a query result for shadow-diff equality (object keys sorted; array order
 *  preserved since result order is significant). */
function shadowStable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/** Top-level row ids of a query result, for reporting which rows diverged. */
function shadowIds(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>).id : r));
}
