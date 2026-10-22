import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter, Attributes } from '@opentelemetry/api';
import { config } from '@/config/env';

/**
 * step: watch | gate | route | draft | before_posting | follow_up | episode | episode_quiet;
 * outcome: what it decided. Quiet decisions are only counted here, never stored.
 */
export interface ProactivityAttributes extends Attributes {
  step: string;
  outcome: string;
}

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

let _decisions: Counter<ProactivityAttributes> | null = null;
/** Every proactivity decision, by step and outcome: the funnel. */
export function getProactivityDecisionsTotal(): Counter<ProactivityAttributes> {
  _decisions ??= getMeter().createCounter('proactivity_decisions_total', {
    description: 'Agent proactivity decisions by step and outcome',
    unit: '1',
  });
  return _decisions;
}

let _stepDuration: Histogram<ProactivityAttributes> | null = null;
/** How long each step took, XOR calls included. */
export function getProactivityStepDuration(): Histogram<ProactivityAttributes> {
  _stepDuration ??= getMeter().createHistogram('proactivity_step_duration', {
    description: 'Agent proactivity step latency',
    unit: 'ms',
  });
  return _stepDuration;
}
