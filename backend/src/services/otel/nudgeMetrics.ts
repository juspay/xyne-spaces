import { metrics } from '@opentelemetry/api';
import type { Counter, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

// Nudge Created Total Counter — label: nudge_kind
let _nudgeCreatedTotal: Counter | null = null;
export function getNudgeCreatedTotal(): Counter {
  if (!_nudgeCreatedTotal) {
    _nudgeCreatedTotal = getMeter().createCounter('nudge_created_total', {
      description: 'Total number of proactive nudges created, by nudge kind',
      unit: '1',
    });
  }
  return _nudgeCreatedTotal;
}
