import { diagnosticsStore } from '../store';
import { pressureToNumber } from '../thresholds';

/**
 * Compute Pressure API — not in the TS DOM lib yet. This is the only browser
 * API that reports *real* CPU pressure as the operating system sees it, rather
 * than a main-thread proxy: it accounts for other apps, thermal throttling and
 * core parking, none of which long-task timing can see.
 */
interface PressureRecord {
  source: string;
  state: string;
  time: number;
}
interface PressureObserverLike {
  observe(source: string, options?: { sampleInterval?: number }): Promise<void>;
  disconnect(): void;
}
type PressureObserverCtor = new (
  callback: (records: PressureRecord[]) => void,
) => PressureObserverLike;

const PRESSURE_SAMPLE_MS = 2000;
const LONG_TASK_WINDOW_MS = 30_000;
const BLOCKED_SAMPLE_MS = 1000;

export function startCpuSource(): () => void {
  const stops: (() => void)[] = [];

  stops.push(startPressureObserver());
  stops.push(startFrameRateSampler());
  stops.push(startLongTaskObserver());

  return () => {
    for (const stop of stops) stop();
  };
}

function startPressureObserver(): () => void {
  const ctor = (globalThis as unknown as { PressureObserver?: PressureObserverCtor })
    .PressureObserver;
  if (!ctor) {
    diagnosticsStore.markUnsupported(
      'cpuPressure',
      'This browser does not report OS-level CPU pressure. Chrome or the desktop app will show it.',
    );
    return () => undefined;
  }

  let observer: PressureObserverLike | null = null;
  try {
    observer = new ctor(records => {
      for (const record of records) {
        if (record.source === 'cpu') {
          diagnosticsStore.record('cpuPressure', pressureToNumber(record.state));
        }
      }
    });
    void observer.observe('cpu', { sampleInterval: PRESSURE_SAMPLE_MS }).catch(() => {
      // Blocked by the `compute-pressure` permissions policy, or an insecure context.
      diagnosticsStore.markUnsupported(
        'cpuPressure',
        'CPU pressure reporting is blocked on this page.',
      );
    });
  } catch {
    diagnosticsStore.markUnsupported('cpuPressure', 'CPU pressure reporting is unavailable.');
  }

  return () => observer?.disconnect();
}

/**
 * Counts frames actually delivered. rAF stops firing in a hidden tab, so the
 * accounting window is reset on visibility change rather than reporting 0 fps
 * for a tab that was simply in the background.
 */
function startFrameRateSampler(): () => void {
  let frames = 0;
  let windowStart = performance.now();
  let handle = 0;
  let running = true;

  const tick = (): void => {
    if (!running) return;
    frames += 1;
    const now = performance.now();
    const elapsed = now - windowStart;
    if (elapsed >= BLOCKED_SAMPLE_MS) {
      diagnosticsStore.record('fps', (frames * 1000) / elapsed);
      diagnosticsStore.record('longTaskShare', diagnosticsStore.longTaskShare(LONG_TASK_WINDOW_MS));
      frames = 0;
      windowStart = now;
    }
    handle = requestAnimationFrame(tick);
  };

  const onVisibility = (): void => {
    frames = 0;
    windowStart = performance.now();
  };

  document.addEventListener('visibilitychange', onVisibility);
  handle = requestAnimationFrame(tick);

  return () => {
    running = false;
    cancelAnimationFrame(handle);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

function startLongTaskObserver(): () => void {
  if (typeof PerformanceObserver === 'undefined') {
    diagnosticsStore.markUnsupported(
      'longTaskShare',
      'This browser cannot measure main-thread blocking.',
    );
    return () => undefined;
  }

  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        diagnosticsStore.recordLongTask(
          entry.duration,
          Date.now() - (performance.now() - entry.startTime),
        );
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
    return () => observer.disconnect();
  } catch {
    diagnosticsStore.markUnsupported(
      'longTaskShare',
      'This browser cannot measure main-thread blocking.',
    );
    return () => undefined;
  }
}
