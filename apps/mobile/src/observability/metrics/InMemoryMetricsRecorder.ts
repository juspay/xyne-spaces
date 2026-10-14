import type {
  CounterMetricKey,
  HistogramMetricKey,
  MetricAttributesFor,
  MetricsRecorder,
  UpDownCounterMetricKey,
} from './MetricsRecorder';
import type { MetricAttributeValue, MetricDefinition, AppMetricKey } from './metrics';

export type RecordedMetric = Readonly<{
  metric: AppMetricKey;
  kind: MetricDefinition['kind'];
  value: number;
  attributes: Readonly<Record<string, MetricAttributeValue>>;
}>;

export class InMemoryMetricsRecorder implements MetricsRecorder {
  private readonly records: RecordedMetric[] = [];

  incrementCounter<TKey extends CounterMetricKey>(
    metric: TKey,
    attributes: MetricAttributesFor<TKey>,
    amount = 1,
  ): void {
    this.capture(metric, 'counter', amount, attributes);
  }

  updateUpDownCounter<TKey extends UpDownCounterMetricKey>(
    metric: TKey,
    amount: number,
    attributes: MetricAttributesFor<TKey>,
  ): void {
    this.capture(metric, 'upDownCounter', amount, attributes);
  }

  recordHistogram<TKey extends HistogramMetricKey>(
    metric: TKey,
    amount: number,
    attributes: MetricAttributesFor<TKey>,
  ): void {
    this.capture(metric, 'histogram', amount, attributes);
  }

  getRecords(): readonly RecordedMetric[] {
    return this.records.map(record => ({
      ...record,
      attributes: {
        ...record.attributes,
      },
    }));
  }

  clear(): void {
    this.records.length = 0;
  }

  private capture<TKey extends AppMetricKey>(
    metric: TKey,
    kind: MetricDefinition['kind'],
    value: number,
    attributes: MetricAttributesFor<TKey>,
  ): void {
    this.records.push({
      metric,
      kind,
      value,
      attributes: {
        ...attributes,
      } as Readonly<Record<string, MetricAttributeValue>>,
    });
  }
}
