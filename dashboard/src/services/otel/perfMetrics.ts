import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter, ObservableGauge } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';
import { logger, Event } from '../../utils/logger';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME);
}

// --- Route normalization (low-cardinality metric label) ---
//
// Web-vitals / long-task entries carry no route context, and the metric
// resource only labels `service_instance_id` + `platform_name`. Without a
// screen dimension you can see *that* INP is bad but not *where*. We derive a
// low-cardinality route template from the current path (the same value the
// bridge logger records as `pageUrl`) by collapsing id-like segments to `:id`,
// so cardinality is bounded by the number of route shapes — not by ids.
function currentRouteTemplate(): string {
  try {
    const path = window.location.pathname || '/';
    const template =
      '/' +
      path
        .split('/')
        .filter(Boolean)
        .map(seg => {
          if (seg.length >= 12) return ':id';
          if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(seg)) return ':id';
          if (/^\d+$/.test(seg)) return ':id';
          if (/\d/.test(seg) && /[a-z]/i.test(seg)) return ':id';
          return seg.toLowerCase();
        })
        .join('/');
    return template.length > 64 ? template.slice(0, 64) : template;
  } catch {
    return 'unknown';
  }
}

// --- React Profiler render duration ---

let _componentRenderDuration: Histogram | null = null;

export const componentRenderDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_componentRenderDuration) {
      _componentRenderDuration = getMeter().createHistogram('component_render_duration', {
        description: 'React component render duration in milliseconds',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [1, 2, 4, 8, 16, 32, 64, 128, 256],
        },
      });
    }
    return _componentRenderDuration[prop as keyof Histogram];
  },
});

// --- JS Heap memory (Chrome only) ---

let _memoryGaugeRegistered = false;

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function getPerformanceMemory(): PerformanceMemory | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  return (performance as any).memory as PerformanceMemory | undefined;
}

export function registerMemoryGauge(): void {
  if (_memoryGaugeRegistered) return;
  if (!getPerformanceMemory()) return;

  _memoryGaugeRegistered = true;
  const meter = getMeter();

  const heapUsed: ObservableGauge = meter.createObservableGauge('js_heap_used_bytes', {
    description: 'JS heap memory used in bytes',
    unit: 'By',
  });

  const heapTotal: ObservableGauge = meter.createObservableGauge('js_heap_total_bytes', {
    description: 'JS heap memory total in bytes',
    unit: 'By',
  });

  const heapLimit: ObservableGauge = meter.createObservableGauge('js_heap_limit_bytes', {
    description: 'JS heap memory limit in bytes',
    unit: 'By',
  });

  meter.addBatchObservableCallback(
    observer => {
      const mem = getPerformanceMemory();
      if (mem) {
        observer.observe(heapUsed, mem.usedJSHeapSize);
        observer.observe(heapTotal, mem.totalJSHeapSize);
        observer.observe(heapLimit, mem.jsHeapSizeLimit);
      }
    },
    [heapUsed, heapTotal, heapLimit],
  );
}

// --- JS Heap snapshot bridge log (route-tagged via the logger envelope) ---
//
// The Prometheus `js_heap_*` gauges only carry `instance` (per-browser UUID),
// so heap pressure cannot be attributed to a page/route/feature from metrics
// alone. This periodic snapshot rides the existing bridge logger, which adds
// `pageUrl`, `pageViewId`, `clientSessionId`, `emailId`, `platformName`, and
// `version` to every entry — giving free route attribution and user-level
// correlation without adding labels to the metric (which would explode
// cardinality).
//
// Cadence: 30s. With ~1000 active browsers, that's ~33 events/sec — small.

let _heapSnapshotLogRegistered = false;
const HEAP_SNAPSHOT_INTERVAL_MS = 30_000;
const BYTES_PER_MB = 1024 * 1024;

export function registerHeapSnapshotLog(): void {
  if (_heapSnapshotLogRegistered) return;
  if (!getPerformanceMemory()) return;

  _heapSnapshotLogRegistered = true;

  const emit = (): void => {
    const mem = getPerformanceMemory();
    if (!mem) return;
    logger.info(Event.JS_HEAP_SNAPSHOT, {
      usedHeapMb: Math.round(mem.usedJSHeapSize / BYTES_PER_MB),
      totalHeapMb: Math.round(mem.totalJSHeapSize / BYTES_PER_MB),
      limitHeapMb: Math.round(mem.jsHeapSizeLimit / BYTES_PER_MB),
      usedHeapFraction: Number((mem.usedJSHeapSize / mem.jsHeapSizeLimit).toFixed(3)),
    });
  };

  // First snapshot one interval after init so app startup isn't double-taxed.
  setInterval(emit, HEAP_SNAPSHOT_INTERVAL_MS);
}

// Minimal shapes for Long Tasks API (not in the TS DOM lib).
interface LongTaskAttribution {
  containerType?: string;
  containerName?: string;
  containerSrc?: string;
}
interface LongTaskTiming extends PerformanceEntry {
  attribution?: LongTaskAttribution[];
}

// --- Long Tasks (main thread blocked >50ms) ---

// Tasks/interactions above these thresholds also emit a route-tagged bridge log
// carrying high-cardinality attribution (selectors, container src). Metrics stay
// low-cardinality; the logs carry the "where exactly" detail for triage.
const LONG_TASK_SLOW_LOG_MS = 200;
const INP_SLOW_LOG_MS = 200;

let _longTaskDuration: Histogram | null = null;
let _longTaskObserverRegistered = false;

export function registerLongTaskObserver(): void {
  if (_longTaskObserverRegistered) return;
  if (typeof PerformanceObserver === 'undefined') return;

  _longTaskObserverRegistered = true;

  if (!_longTaskDuration) {
    _longTaskDuration = getMeter().createHistogram('long_task_duration', {
      description: 'Duration of long tasks blocking the main thread (>50ms)',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [50, 100, 150, 200, 300, 500, 1000, 2000],
      },
    });
  }

  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const route = currentRouteTemplate();
        // `attribution[0]` describes the frame/container the task ran in.
        // containerType is low-cardinality (window | iframe | embed | object).
        const attr = (entry as LongTaskTiming).attribution?.[0];
        _longTaskDuration!.record(entry.duration, {
          route,
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Prometheus metric label
          container_type: attr?.containerType ?? 'window',
        });

        // High-cardinality detail (containerName/Src) goes to the bridge log,
        // not the metric — and only for tasks big enough to matter — so a
        // janky route can be traced to a specific element without label blowup.
        if (entry.duration >= LONG_TASK_SLOW_LOG_MS) {
          logger.info(Event.LONG_TASK_SLOW, {
            durationMs: Math.round(entry.duration),
            route,
            containerType: attr?.containerType || '',
            containerName: attr?.containerName || '',
            containerSrc: attr?.containerSrc || '',
          });
        }
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    // longtask not supported in this browser
  }
}

// --- Zero client-side poke processing (IVM + view updates) ---

let _pokeRenderDuration: Histogram | null = null;

export const pokeRenderDuration: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_pokeRenderDuration) {
      _pokeRenderDuration = getMeter().createHistogram('zero_client_poke_processing_duration', {
        description:
          'Client-side poke processing time: IVM advancement + query view state updates in milliseconds',
        unit: 'ms',
        advice: {
          // Top bucket extended past 512ms because the prior cap was clipping
          // a real long tail — observed p99 saturating at exactly 512.
          explicitBucketBoundaries: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 5000],
        },
      });
    }
    return _pokeRenderDuration[prop as keyof Histogram];
  },
});

/**
 * Creates a batchViewUpdates wrapper for Zero that measures client-side
 * poke processing time (IVM advancement + query view state updates).
 * React 19 with createRoot auto-batches all state updates including
 * setTimeout callbacks, so no explicit batching needed.
 */
export function createBatchViewUpdatesWithMetrics(): (applyViewUpdates: () => void) => void {
  return (applyViewUpdates: () => void) => {
    const start = performance.now();
    applyViewUpdates();
    const duration = performance.now() - start;
    if (duration > 1) {
      pokeRenderDuration.record(duration);
    }
  };
}

// --- Web Vitals ---

let _webVitalsRegistered = false;

export function registerWebVitals(): void {
  if (_webVitalsRegistered) return;
  _webVitalsRegistered = true;

  const meter = getMeter();

  const lcpHistogram = meter.createHistogram('web_vital_lcp', {
    description: 'Largest Contentful Paint in milliseconds',
    unit: 'ms',
    advice: { explicitBucketBoundaries: [100, 500, 1000, 1500, 2500, 4000, 8000] },
  });

  const fcpHistogram = meter.createHistogram('web_vital_fcp', {
    description: 'First Contentful Paint in milliseconds',
    unit: 'ms',
    advice: { explicitBucketBoundaries: [100, 500, 1000, 1500, 2500, 4000] },
  });

  const inpHistogram = meter.createHistogram('web_vital_inp', {
    description: 'Interaction to Next Paint in milliseconds',
    unit: 'ms',
    advice: { explicitBucketBoundaries: [50, 100, 200, 300, 500, 1000] },
  });

  const clsHistogram = meter.createHistogram('web_vital_cls', {
    description: 'Cumulative Layout Shift score',
    unit: '1',
    advice: { explicitBucketBoundaries: [0.01, 0.05, 0.1, 0.15, 0.25, 0.5, 1] },
  });

  // Use the attribution build so INP carries the interaction target + the
  // longest-script breakdown. Lets us split slow interactions by route and
  // pin the worst ones to a specific element/script in the bridge log.
  import('web-vitals/attribution')
    .then(({ onLCP, onFCP, onINP, onCLS }) => {
      onLCP(({ value }) => lcpHistogram.record(value), { reportAllChanges: true });
      onFCP(({ value }) => fcpHistogram.record(value));

      onINP(
        metric => {
          const route = currentRouteTemplate();
          const attr = metric.attribution;
          const interactionType = attr?.interactionType ?? 'unknown';

          // Low-cardinality labels only: route template + pointer|keyboard.
          inpHistogram.record(metric.value, {
            route,
            // eslint-disable-next-line @typescript-eslint/naming-convention -- Prometheus metric label
            interaction_type: interactionType,
          });

          // The selector and longest-script breakdown are high-cardinality —
          // emit them as a route-tagged bridge log for the slow tail only.
          if (metric.value >= INP_SLOW_LOG_MS && attr) {
            const script = attr.longestScript;
            logger.info(Event.WEB_VITAL_INP_SLOW, {
              valueMs: Math.round(metric.value),
              route,
              interactionType,
              interactionTarget: attr.interactionTarget || '(removed)',
              inputDelayMs: Math.round(attr.inputDelay),
              processingDurationMs: Math.round(attr.processingDuration),
              presentationDelayMs: Math.round(attr.presentationDelay),
              longestScriptMs: script ? Math.round(script.intersectingDuration) : 0,
              longestScriptSubpart: script?.subpart ?? '',
              longestScriptSource: script?.entry?.sourceURL ?? '',
              longestScriptFn: script?.entry?.sourceFunctionName ?? '',
            });
          }
        },
        { reportAllChanges: true },
      );

      onCLS(metric => clsHistogram.record(metric.value, { route: currentRouteTemplate() }), {
        reportAllChanges: true,
      });
    })
    .catch(() => {
      // web-vitals not available
    });
}

// --- Component render frequency (catches the "many cheap renders" pattern) ---
//
// `component_render_duration` is gated at >16ms, so a component that re-renders
// thousands of times at a few ms each (the unstable-deps / eager-useMemo
// signature) is invisible to it — each render slips under the gate while the
// cumulative CPU is large. This counter records EVERY render so frequency is
// visible on its own axis. Labels are low-cardinality (component + phase).
let _componentRenderTotal: Counter | null = null;

export const componentRenderTotal: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_componentRenderTotal) {
      _componentRenderTotal = getMeter().createCounter('component_render_total', {
        description:
          'Count of React component renders at all durations, to surface high-frequency re-render patterns',
      });
    }
    return _componentRenderTotal[prop as keyof Counter];
  },
});
