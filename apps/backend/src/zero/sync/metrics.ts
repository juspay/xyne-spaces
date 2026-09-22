/**
 * Env-free metrics facade for the sync engine.
 *
 * The OTEL sink (`@/services/otel/syncEngineMetrics`) transitively imports config/env, which
 * the env-free unit suites must never load — so the sink is resolved by a lazy dynamic import
 * on first use, and every call is a silent no-op until it lands (or forever, under tests).
 * Gauges registered before the sink resolves are parked and attached on resolution.
 *
 * Naming: one `sync_engine_*` family; counters end in `_total`, histograms are `_latency`
 * (milliseconds), gauges are current-state observations. Attribute values must stay LOW
 * CARDINALITY (plane/mode/result enums, query names — never instance keys or user ids).
 */

export type SyncCounterName =
  | 'sync_engine_subscribe_total' // {plane, queryName, outcome: accepted|refused_query|refused_role}
  | 'sync_engine_admission_total' // {result: admit|deny}
  | 'sync_engine_frames_total' // {plane, type: snapshot|delta|current|revoke}
  | 'sync_engine_rows_emitted_total' // {plane, kind: upsert|delete}
  | 'sync_engine_hydrate_total' // {plane, mode: snapshot|resume}
  | 'sync_engine_memo_total' // {memo: gate|rowlevel, event: hit|miss}
  | 'sync_engine_decrypt_values_total' // {result: cache_hit|decrypted|failed}
  | 'sync_engine_tap_pokes_total' // {result: applied|cancelled}
  | 'sync_engine_tap_persist_total' // {result: ok|failed}
  | 'sync_engine_tap_events_total'; // {event: reset|backoff|fatal|fence_lost}

export type SyncHistogramName =
  | 'sync_engine_subscribe_latency' // {plane}
  | 'sync_engine_hydrate_latency' // {plane, mode}
  | 'sync_engine_dispatch_latency' // {plane}
  | 'sync_engine_regate_latency'
  | 'sync_engine_persist_latency'
  | 'sync_engine_decrypt_batch_latency';

export type SyncGaugeName =
  | 'sync_engine_instances' // {plane}
  | 'sync_engine_data_subscribers' // {plane}
  | 'sync_engine_memo_bytes' // {memo}
  | 'sync_engine_memo_entries' // {memo}
  | 'sync_engine_persist_queue_depth' // {group}
  | 'sync_engine_decrypt_cache_entries';

export type SyncAttrs = Record<string, string>;

export interface SyncMetricsSink {
  count(name: SyncCounterName, value: number, attrs?: SyncAttrs): void;
  observe(name: SyncHistogramName, ms: number, attrs?: SyncAttrs): void;
  /** Register an observable-gauge source; returns a dispose fn. */
  gauge(name: SyncGaugeName, attrs: SyncAttrs, read: () => number): () => void;
}

let sink: SyncMetricsSink | undefined;
let loading = false;
const parkedGauges: Array<{
  name: SyncGaugeName;
  attrs: SyncAttrs;
  read: () => number;
  handle: { dispose?: () => void; disposed?: boolean };
}> = [];

function ensureSink(): void {
  if (sink || loading) return;
  loading = true;
  void import('@/services/otel/syncEngineMetrics')
    .then((m) => {
      sink = m.syncEngineMetricsSink;
      for (const g of parkedGauges) {
        if (!g.handle.disposed) g.handle.dispose = sink.gauge(g.name, g.attrs, g.read);
      }
      parkedGauges.length = 0;
    })
    .catch(() => {
      /* otel/config unavailable (env-free unit tests) — metrics stay no-op */
    });
}

export const syncMetrics = {
  count(name: SyncCounterName, attrs?: SyncAttrs, value = 1): void {
    ensureSink();
    try {
      sink?.count(name, value, attrs);
    } catch {
      /* metrics must never break the engine */
    }
  },

  observe(name: SyncHistogramName, ms: number, attrs?: SyncAttrs): void {
    ensureSink();
    try {
      sink?.observe(name, ms, attrs);
    } catch {
      /* ignore */
    }
  },

  /** Register a live gauge source (e.g. a memo's byte total). Returns dispose. */
  gauge(name: SyncGaugeName, attrs: SyncAttrs, read: () => number): () => void {
    ensureSink();
    if (sink) {
      try {
        return sink.gauge(name, attrs, read);
      } catch {
        return () => {};
      }
    }
    const handle: { dispose?: () => void; disposed?: boolean } = {};
    parkedGauges.push({ name, attrs, read, handle });
    return () => {
      handle.disposed = true;
      handle.dispose?.();
    };
  },
};
