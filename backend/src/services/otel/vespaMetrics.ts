import { metrics } from '@opentelemetry/api';
import type { Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}


// Vespa backfill queue gauges
let _backfillQueueGaugesRegistered = false;
export function registerVespaBackfillQueueMetrics(
  getStats: () => Promise<{ waiting: number; active: number; completed: number; failed: number; delayed: number; total: number }>
): void {
  if (_backfillQueueGaugesRegistered) return;
  _backfillQueueGaugesRegistered = true;

  const meter = getMeter();
  const states = ['waiting', 'active', 'completed', 'failed', 'delayed', 'total'] as const;

  for (const state of states) {
    meter.createObservableGauge(`vespa_backfill_queue_${state}`, {
      description: `Vespa backfill queue ${state} job count`,
      unit: '1',
    }).addCallback(async (result) => {
      const stats = await getStats();
      result.observe(stats[state]);
    });
  }
}
