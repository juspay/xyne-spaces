import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';
import type { DecisionFeature, EngineRun } from '@/services/decision/types';

/** live: the answer users got. shadow: asked only to compare it. */
export type RunRole = 'live' | 'shadow';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

function lazy<T>(create: () => T): () => T {
  let instance: T | null = null;
  return () => (instance ??= create());
}

const runsTotal = lazy<Counter>(() =>
  getMeter().createCounter('decision_runs_total', {
    description: 'Decision engine runs by outcome (answered, abstained, failed)',
    unit: '1',
  })
);

const runDuration = lazy<Histogram>(() =>
  getMeter().createHistogram('decision_run_duration', {
    description: 'Decision engine run latency in milliseconds',
    unit: 'ms',
    advice: { explicitBucketBoundaries: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000] },
  })
);

const tokensTotal = lazy<Counter>(() =>
  getMeter().createCounter('decision_tokens_total', {
    description: 'Tokens used by decision engine runs',
    unit: '1',
  })
);

const agreementTotal = lazy<Counter>(() =>
  getMeter().createCounter('decision_agreement_total', {
    description: 'Evaluated decisions where two engines both answered, by whether they agreed',
    unit: '1',
  })
);

export function recordRun(feature: DecisionFeature, run: EngineRun<unknown>, role: RunRole): void {
  const attributes = { feature, engine: run.engine, role };
  runsTotal().add(1, { ...attributes, outcome: run.outcome });
  if (run.outcome !== 'answered' && run.outcome !== 'abstained') return;
  runDuration().record(run.latencyMs, attributes);
  if (run.promptTokens) tokensTotal().add(run.promptTokens, { ...attributes, direction: 'prompt' });
  if (run.completionTokens) tokensTotal().add(run.completionTokens, { ...attributes, direction: 'completion' });
}

/** Lower bounds of the confidence buckets, highest first. */
const CONFIDENCE_BUCKETS = [0.95, 0.9, 0.8, 0.6] as const;

/** e.g. 0.93 => '0.90'; under 0.6 => '0.50', the floor; no confidence => 'unknown'. */
export const confidenceBucket = (confidence: number | undefined): string => {
  if (confidence === undefined) return 'unknown';
  return (CONFIDENCE_BUCKETS.find((bound) => confidence >= bound) ?? 0.5).toFixed(2);
};

/** `liveConfidence` only for pairs with the live engine, so agreement can be read by how sure it was. */
export function recordAgreement(feature: DecisionFeature, pair: string, agree: boolean, liveConfidence?: string): void {
  agreementTotal().add(1, { feature, pair, agree: String(agree), ...(liveConfidence && { live_confidence: liveConfidence }) });
}
