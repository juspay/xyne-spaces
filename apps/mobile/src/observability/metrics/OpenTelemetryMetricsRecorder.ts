import type { Attributes, Counter, Histogram, Meter, UpDownCounter } from '@opentelemetry/api';

import type {
  CounterMetricKey,
  HistogramMetricKey,
  MetricAttributesFor,
  MetricsRecorder,
  UpDownCounterMetricKey,
} from './MetricsRecorder';
import { APP_METRICS, type MetricDefinition, type AppMetricKey } from './metrics';

export type MetricsErrorHandler = (error: unknown) => void;

const ignoreMetricsError: MetricsErrorHandler = () => {};

export class OpenTelemetryMetricsRecorder implements MetricsRecorder {
  private readonly counters = new Map<AppMetricKey, Counter>();
  private readonly upDownCounters = new Map<AppMetricKey, UpDownCounter>();
  private readonly histograms = new Map<AppMetricKey, Histogram>();

  constructor(
    private readonly meter: Meter,
    private readonly onError: MetricsErrorHandler = ignoreMetricsError,
  ) {}

  incrementCounter<TKey extends CounterMetricKey>(
    metric: TKey,
    attributes: MetricAttributesFor<TKey>,
    amount = 1,
  ): void {
    this.runSafely(() => {
      this.assertFinite(amount, metric);

      if (amount < 0) {
        throw new Error(`Counter "${metric}" cannot increase by a negative amount`);
      }

      this.getCounter(metric).add(amount, this.toOtelAttributes(attributes));
    });
  }

  updateUpDownCounter<TKey extends UpDownCounterMetricKey>(
    metric: TKey,
    amount: number,
    attributes: MetricAttributesFor<TKey>,
  ): void {
    this.runSafely(() => {
      this.assertFinite(amount, metric);
      this.getUpDownCounter(metric).add(amount, this.toOtelAttributes(attributes));
    });
  }

  recordHistogram<TKey extends HistogramMetricKey>(
    metric: TKey,
    value: number,
    attributes: MetricAttributesFor<TKey>,
  ): void {
    this.runSafely(() => {
      this.assertFinite(value, metric);
      this.getHistogram(metric).record(value, this.toOtelAttributes(attributes));
    });
  }

  private getCounter(metric: AppMetricKey): Counter {
    const existing = this.counters.get(metric);

    if (existing) {
      return existing;
    }

    const definition = this.getDefinition(metric);

    if (definition.kind !== 'counter') {
      throw new Error(`Metric "${metric}" is not a counter`);
    }

    const counter = this.meter.createCounter(definition.name, {
      description: definition.description,
      unit: definition.unit,
    });

    this.counters.set(metric, counter);
    return counter;
  }

  private getUpDownCounter(metric: AppMetricKey): UpDownCounter {
    const existing = this.upDownCounters.get(metric);

    if (existing) {
      return existing;
    }

    const definition = this.getDefinition(metric);

    if (definition.kind !== 'upDownCounter') {
      throw new Error(`Metric "${metric}" is not an UpDownCounter`);
    }

    const counter = this.meter.createUpDownCounter(definition.name, {
      description: definition.description,
      unit: definition.unit,
    });

    this.upDownCounters.set(metric, counter);
    return counter;
  }

  private getHistogram(metric: AppMetricKey): Histogram {
    const existing = this.histograms.get(metric);

    if (existing) {
      return existing;
    }

    const definition = this.getDefinition(metric);

    if (definition.kind !== 'histogram') {
      throw new Error(`Metric "${metric}" is not a histogram`);
    }

    const histogram = this.meter.createHistogram(definition.name, {
      description: definition.description,
      unit: definition.unit,
      advice: {
        explicitBucketBoundaries: [...definition.boundaries],
      },
    });

    this.histograms.set(metric, histogram);
    return histogram;
  }

  private getDefinition(metric: AppMetricKey): MetricDefinition {
    return APP_METRICS[metric];
  }

  private toOtelAttributes<TKey extends AppMetricKey>(
    attributes: MetricAttributesFor<TKey>,
  ): Attributes {
    return { ...attributes } as Attributes;
  }

  private assertFinite(value: number, metric: AppMetricKey): void {
    if (!Number.isFinite(value)) {
      throw new Error(`Metric "${metric}" received a non-finite value`);
    }
  }

  private runSafely(operation: () => void): void {
    try {
      operation();
    } catch (error) {
      try {
        this.onError(error);
      } catch {
        // An error handler must not crash product code either.
      }
    }
  }
}
