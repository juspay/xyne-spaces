import type { APP_METRICS, AppMetricKey, MetricDefinition } from './metrics';

type AppMetricCatalog = typeof APP_METRICS;

type MetricKind = MetricDefinition['kind'];

export type AppMetricKeyByKind<TKind extends MetricKind> = {
  [TKey in AppMetricKey]: AppMetricCatalog[TKey]['kind'] extends TKind ? TKey : never;
}[AppMetricKey];

type AttributePolicyFor<TKey extends AppMetricKey> = AppMetricCatalog[TKey]['attributes'];

export type MetricAttributesFor<TKey extends AppMetricKey> = Readonly<{
  [
    TAttribute in keyof AttributePolicyFor<TKey>
  ]: AttributePolicyFor<TKey>[TAttribute] extends readonly (infer TValue)[]
    ? TValue
    : AttributePolicyFor<TKey>[TAttribute] extends 'dynamic-string'
      ? string
      : never;
}>;

export type CounterMetricKey = AppMetricKeyByKind<'counter'>;

export type UpDownCounterMetricKey = AppMetricKeyByKind<'upDownCounter'>;

export type HistogramMetricKey = AppMetricKeyByKind<'histogram'>;

export interface MetricsRecorder {
  incrementCounter<TKey extends CounterMetricKey>(
    metric: TKey,
    attributes: MetricAttributesFor<TKey>,
    amount?: number,
  ): void;

  updateUpDownCounter<TKey extends UpDownCounterMetricKey>(
    metric: TKey,
    amount: number,
    attributes: MetricAttributesFor<TKey>,
  ): void;

  recordHistogram<TKey extends HistogramMetricKey>(
    metric: TKey,
    value: number,
    attributes: MetricAttributesFor<TKey>,
  ): void;
}
