import { metrics } from '@opentelemetry/api';
import type { Histogram, Meter, ObservableGauge } from '@opentelemetry/api';
import { OTEL_SERVICE_NAME } from '../../config';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME);
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

// --- Long Tasks (main thread blocked >50ms) ---

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
        _longTaskDuration!.record(entry.duration);
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
          explicitBucketBoundaries: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512],
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

  import('web-vitals')
    .then(({ onLCP, onFCP, onINP, onCLS }) => {
      onLCP(({ value }) => lcpHistogram.record(value), { reportAllChanges: true });
      onFCP(({ value }) => fcpHistogram.record(value));
      onINP(({ value }) => inpHistogram.record(value), { reportAllChanges: true });
      onCLS(({ value }) => clsHistogram.record(value), { reportAllChanges: true });
    })
    .catch(() => {
      // web-vitals not available
    });
}
