import type { Attributes } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

import { createAppMetricExporter } from './config/createAppMetricExporter';

import type {
  CounterMetricKey,
  HistogramMetricKey,
  MetricAttributesFor,
  MetricsRecorder,
  UpDownCounterMetricKey,
} from './MetricsRecorder';
import {
  OpenTelemetryMetricsRecorder,
  type MetricsErrorHandler,
} from './OpenTelemetryMetricsRecorder';

export type MetricsServiceOptions = Readonly<{
  endpoint: string;
  serviceName: string;
  exportIntervalMs: number;
  exportTimeoutMs?: number;
  resourceAttributes?: Attributes;
  onError?: MetricsErrorHandler;
  pendingCapacity?: number;
}>;

const ignoreMetricsError: MetricsErrorHandler = () => {};

type PendingMetricOperation = (recorder: MetricsRecorder) => void;

export class MetricsService implements MetricsRecorder {
  private readonly options: MetricsServiceOptions;
  private readonly onError: MetricsErrorHandler;

  private readonly pendingCapacity;
  private readonly pendingOperations: PendingMetricOperation[] = [];

  private provider: MeterProvider | null = null;
  private recorder: OpenTelemetryMetricsRecorder | null = null;

  constructor(options: MetricsServiceOptions) {
    this.options = options;
    this.onError = options.onError ?? ignoreMetricsError;
    this.pendingCapacity = Math.max(0, Math.floor(options.pendingCapacity ?? 100));
  }

  start(): void {
    if (this.provider !== null) {
      return;
    }

    try {
      const exportTimeoutMs =
        this.options.exportTimeoutMs ??
        Math.min(5000, Math.floor(this.options.exportIntervalMs / 2));

      const resource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: this.options.serviceName,
        ...(this.options.resourceAttributes ?? {}),
      });

      const exporter = createAppMetricExporter({
        url: this.options.endpoint,
        timeoutMillis: exportTimeoutMs,
      });

      const reader = new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: this.options.exportIntervalMs,
        exportTimeoutMillis: exportTimeoutMs,
      });

      const provider = new MeterProvider({
        resource,
        readers: [reader],
      });

      const meter = provider.getMeter(this.options.serviceName);

      const recorder = new OpenTelemetryMetricsRecorder(meter, this.onError);

      this.provider = provider;
      this.recorder = recorder;

      this.drainPendingOperations(recorder);
    } catch (error) {
      this.reportError(error);
    }
  }

  incrementCounter<TKey extends CounterMetricKey>(
    metric: TKey,
    attributes: MetricAttributesFor<TKey>,
    amount = 1,
  ): void {
    const attributesSnapshot = {
      ...attributes,
    } as MetricAttributesFor<TKey>;

    this.recordOrBuffer(recorder => {
      recorder.incrementCounter(metric, attributesSnapshot, amount);
    });
  }

  updateUpDownCounter<TKey extends UpDownCounterMetricKey>(
    metric: TKey,
    amount: number,
    attributes: MetricAttributesFor<TKey>,
  ): void {
    const attributesSnapshot = {
      ...attributes,
    } as MetricAttributesFor<TKey>;

    this.recordOrBuffer(recorder => {
      recorder.updateUpDownCounter(metric, amount, attributesSnapshot);
    });
  }

  recordHistogram<TKey extends HistogramMetricKey>(
    metric: TKey,
    value: number,
    attributes: MetricAttributesFor<TKey>,
  ): void {
    const attributesSnapshot = {
      ...attributes,
    } as MetricAttributesFor<TKey>;

    this.recordOrBuffer(recorder => {
      recorder.recordHistogram(metric, value, attributesSnapshot);
    });
  }

  async forceFlush(): Promise<void> {
    const provider = this.provider;

    if (provider === null) {
      return;
    }

    try {
      await provider.forceFlush();
    } catch (error) {
      this.reportError(error);
    }
  }

  async shutdown(): Promise<void> {
    const provider = this.provider;

    if (provider === null) {
      return;
    }

    this.provider = null;
    this.recorder = null;

    try {
      await provider.shutdown();
    } catch (error) {
      this.reportError(error);
    }
  }

  private recordOrBuffer(operation: PendingMetricOperation): void {
    if (this.recorder !== null) {
      operation(this.recorder);
      return;
    }

    if (this.pendingCapacity === 0) {
      return;
    }

    if (this.pendingOperations.length >= this.pendingCapacity) {
      this.pendingOperations.shift();
    }

    this.pendingOperations.push(operation);
  }

  private drainPendingOperations(recorder: MetricsRecorder): void {
    const operations = this.pendingOperations.splice(0);

    for (const operation of operations) {
      operation(recorder);
    }
  }

  isStarted(): boolean {
    return this.provider !== null;
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch {
      // Metrics diagnostics must never crash product code.
    }
  }
}
