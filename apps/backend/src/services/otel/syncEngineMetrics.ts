/**
 * OTEL sink for the sync engine's metrics facade (`zero/sync/metrics.ts` — which lazy-imports
 * this module so the env-free sync unit tests never touch config/env). Instruments follow the
 * repo idiom (lazy singletons on the service meter, ms histograms with explicit buckets).
 *
 * Gauges are OBSERVABLE: the engine registers live `read()` sources (memo byte totals, queue
 * depths, subscriber counts) and each named gauge reports every registered source with its
 * attributes at collection time; dispose de-registers (e.g. a tap connection closing).
 */
import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';
import type {
  SyncAttrs,
  SyncCounterName,
  SyncGaugeName,
  SyncHistogramName,
  SyncMetricsSink,
} from '@/zero/sync/metrics';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

/** Dispatch/emit hops are sub-ms→seconds; persist/hydrate can stretch under load. */
const LATENCY_BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

const COUNTER_DESCRIPTIONS: Record<SyncCounterName, string> = {
  sync_engine_subscribe_total: 'Sync-engine subscribe requests by plane/query/outcome',
  sync_engine_admission_total: 'ACL gate admission evaluations by result',
  sync_engine_frames_total: 'Frames emitted to clients by plane/type',
  sync_engine_rows_emitted_total: 'Rows emitted to clients by plane/kind',
  sync_engine_hydrate_total: 'Client hydrations by plane/mode (snapshot vs resume)',
  sync_engine_memo_total: 'Snapshot-memo lookups by memo/event (hit vs miss)',
  sync_engine_decrypt_values_total: 'Emit-time decryption values by result',
  sync_engine_tap_pokes_total: 'Tap pokes by result',
  sync_engine_tap_persist_total: 'Tap poke persists by result',
  sync_engine_tap_events_total: 'Tap lifecycle events (reset/backoff/fatal/fence_lost)',
  sync_engine_shadow_checks_total: 'Client-reported shadow comparisons by result (match = denominator) and divergence kind',
};

const HISTOGRAM_DESCRIPTIONS: Record<SyncHistogramName, string> = {
  sync_engine_subscribe_latency: 'Gateway subscribe handling latency (ms)',
  sync_engine_hydrate_latency: 'Client hydration latency by plane/mode (ms)',
  sync_engine_dispatch_latency: 'Stream-entry dispatch latency by plane (ms)',
  sync_engine_regate_latency: 'Per-client re-gate latency (ms)',
  sync_engine_persist_latency: 'Tap poke atomic persist latency (ms)',
  sync_engine_decrypt_batch_latency: 'decryptBatch provider call latency (ms)',
};

const GAUGE_DESCRIPTIONS: Record<SyncGaugeName, string> = {
  sync_engine_instances: 'Instances with live interest by plane',
  sync_engine_data_subscribers: 'Subscribed clients by plane',
  sync_engine_memo_bytes: 'Snapshot memo estimated bytes by memo',
  sync_engine_memo_entries: 'Snapshot memo entries by memo',
  sync_engine_persist_queue_depth: 'Tap persist queue depth by client group',
  sync_engine_decrypt_cache_entries: 'Emit-time decrypt cache entries',
};

const counters = new Map<SyncCounterName, Counter>();
function counter(name: SyncCounterName): Counter {
  let c = counters.get(name);
  if (!c) {
    c = getMeter().createCounter(name, { description: COUNTER_DESCRIPTIONS[name], unit: '1' });
    counters.set(name, c);
  }
  return c;
}

const histograms = new Map<SyncHistogramName, Histogram>();
function histogram(name: SyncHistogramName): Histogram {
  let h = histograms.get(name);
  if (!h) {
    h = getMeter().createHistogram(name, {
      description: HISTOGRAM_DESCRIPTIONS[name],
      unit: 'ms',
      advice: { explicitBucketBoundaries: LATENCY_BUCKETS_MS },
    });
    histograms.set(name, h);
  }
  return h;
}

interface GaugeSource {
  attrs: SyncAttrs;
  read: () => number;
}
const gaugeSources = new Map<SyncGaugeName, Set<GaugeSource>>();
const gaugesCreated = new Set<SyncGaugeName>();

function ensureGauge(name: SyncGaugeName): Set<GaugeSource> {
  let sources = gaugeSources.get(name);
  if (!sources) {
    sources = new Set();
    gaugeSources.set(name, sources);
  }
  if (!gaugesCreated.has(name)) {
    gaugesCreated.add(name);
    const g = getMeter().createObservableGauge(name, { description: GAUGE_DESCRIPTIONS[name] });
    g.addCallback((result) => {
      for (const s of gaugeSources.get(name) ?? []) {
        try {
          result.observe(s.read(), s.attrs);
        } catch {
          /* a dead source must not break collection */
        }
      }
    });
  }
  return sources;
}

export const syncEngineMetricsSink: SyncMetricsSink = {
  count(name, value, attrs) {
    counter(name).add(value, attrs);
  },
  observe(name, ms, attrs) {
    histogram(name).record(ms, attrs);
  },
  gauge(name, attrs, read) {
    const sources = ensureGauge(name);
    const source: GaugeSource = { attrs, read };
    sources.add(source);
    return () => sources.delete(source);
  },
};
