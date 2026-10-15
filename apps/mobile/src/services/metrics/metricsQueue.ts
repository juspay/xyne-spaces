import type { StartupTimingsPayload } from '@/src/utils/startupTimings';
import { AppState, InteractionManager } from 'react-native';
import { getJson, setJson } from '@/src/services/localStorage';
import { metrics } from '@opentelemetry/api';

const METRICS_QUEUE_KEY = '@lotus_metrics_startup_queue';
// Hard cap so the queue (and its AsyncStorage mirror, re-drained on every foreground)
// can't grow without bound when telemetry never initializes. Startup metrics are
// best-effort; dropping the oldest is acceptable.
const MAX_QUEUE_SIZE = 200;

const startupMetricsQueue: StartupTimingsPayload[] = [];

function capQueue(): void {
  if (startupMetricsQueue.length > MAX_QUEUE_SIZE) {
    startupMetricsQueue.splice(0, startupMetricsQueue.length - MAX_QUEUE_SIZE);
  }
}

export function clearStartupMetricsQueue(): void {
  startupMetricsQueue.splice(0, startupMetricsQueue.length);
  setJson(METRICS_QUEUE_KEY, []);
}

let telemetryReady = false;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let isFlushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

async function flushWithTimeout(timeoutMs: number): Promise<void> {
  await Promise.race([
    flushMetricsQueue(),
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
  ]);
}

function scheduleRetryFlush(): void {
  if (retryTimer || startupMetricsQueue.length === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushMetricsQueue().then(() => {
      if (startupMetricsQueue.length > 0) scheduleRetryFlush();
    });
  }, 3000);
}

function isTelemetryInitialized(): boolean {
  // @ts-expect-error — internal OTel API, checks if a real MeterProvider is registered
  return !!metrics._globalMeterProvider;
}

function setupBackgroundFlush(): void {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener('change', async nextAppState => {
    if (nextAppState === 'background') {
      persistQueue();
      await flushWithTimeout(2000); // Attempt flush before app is suspended without blocking exit
    } else if (nextAppState === 'active') {
      InteractionManager.runAfterInteractions(() => {
        drainPersistedQueue();
        void flushMetricsQueue();
        scheduleRetryFlush();
      });
    }
  });
}

function persistQueue(): void {
  if (startupMetricsQueue.length === 0) {
    setJson(METRICS_QUEUE_KEY, []);
    return;
  }
  try {
    setJson(METRICS_QUEUE_KEY, startupMetricsQueue);
  } catch (err) {
    console.warn('[StartupMetrics] Persist queue failed:', err);
  }
}

function drainPersistedQueue(): void {
  try {
    const stored = getJson<StartupTimingsPayload[]>(METRICS_QUEUE_KEY);
    if (stored && stored.length > 0) {
      startupMetricsQueue.push(...stored);
      capQueue();
    }
    setJson(METRICS_QUEUE_KEY, []);
  } catch (err) {
    console.warn('[StartupMetrics] Drain persisted queue failed:', err);
  }
}

export async function enqueueStartupMetrics(payload: StartupTimingsPayload): Promise<void> {
  setupBackgroundFlush();
  startupMetricsQueue.push(payload);
  capQueue();
  persistQueue();
  await flushMetricsQueue();
  scheduleRetryFlush();
}

export function markTelemetryReady(): void {
  telemetryReady = true;
  void flushWithTimeout(3000);
}

async function flushMetricsQueue(): Promise<void> {
  if (isFlushing) {
    return;
  }

  const ready = telemetryReady || isTelemetryInitialized();
  if (!ready) {
    return;
  }
  if (startupMetricsQueue.length === 0) {
    return;
  }

  isFlushing = true;
  const payloads = startupMetricsQueue.splice(0, startupMetricsQueue.length);

  try {
    const { recordStartupMetrics } = await import('@/src/services/metrics/startupMetrics');
    for (const payload of payloads) {
      await recordStartupMetrics(payload);
    }
    try {
      const { forceFlushMetrics } = await import('@/src/services/metrics/telemetry');
      await forceFlushMetrics();
    } catch (err) {
      console.warn('[StartupMetrics] Force-flush failed (periodic reader will retry):', err);
    }
  } catch (err) {
    console.error('[StartupMetrics] Recording failed — restoring to queue:', err);
    startupMetricsQueue.unshift(...payloads);
    capQueue();
  } finally {
    isFlushing = false;
    persistQueue();
  }
}

drainPersistedQueue();
void flushMetricsQueue();
