import { diagnosticsStore } from '../store';

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface MemoryMeasurement {
  bytes: number;
  breakdown: { bytes: number; types: string[]; attribution: { url: string; scope: string }[] }[];
}

const BYTES_PER_MB = 1024 * 1024;
const HEAP_SAMPLE_MS = 2000;
/** `measureUserAgentSpecificMemory` forces cross-origin-isolated GC accounting — it is not cheap. */
const PRECISE_SAMPLE_MS = 60_000;

function getPerformanceMemory(): PerformanceMemory | undefined {
  return (performance as unknown as { memory?: PerformanceMemory }).memory;
}

export function startMemorySource(): () => void {
  const timers: ReturnType<typeof setInterval>[] = [];

  if (getPerformanceMemory()) {
    const sampleHeap = (): void => {
      const memory = getPerformanceMemory();
      if (!memory) return;
      diagnosticsStore.record('heapUsedMb', memory.usedJSHeapSize / BYTES_PER_MB);
      diagnosticsStore.record(
        'heapFraction',
        (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100,
      );
    };
    sampleHeap();
    timers.push(setInterval(sampleHeap, HEAP_SAMPLE_MS));
  } else {
    const reason = 'Detailed memory reporting is only available in Chrome and the desktop app.';
    diagnosticsStore.markUnsupported('heapUsedMb', reason);
    diagnosticsStore.markUnsupported('heapFraction', reason);
  }

  // Whole-renderer memory (JS + DOM + workers). Electron overrides this with the
  // OS working-set figure when it is available, which is broader still.
  const measure = (
    performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<MemoryMeasurement> }
  ).measureUserAgentSpecificMemory;

  if (typeof measure === 'function' && globalThis.crossOriginIsolated) {
    const samplePrecise = (): void => {
      measure
        .call(performance)
        .then(result => diagnosticsStore.record('rssMb', result.bytes / BYTES_PER_MB))
        .catch(() => undefined);
    };
    samplePrecise();
    timers.push(setInterval(samplePrecise, PRECISE_SAMPLE_MS));
  } else if (!window.electronAPI) {
    diagnosticsStore.markUnsupported(
      'rssMb',
      'Total process memory is only reported in the desktop app.',
    );
  }

  return () => {
    for (const timer of timers) clearInterval(timer);
  };
}
