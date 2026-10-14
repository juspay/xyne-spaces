import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  InstrumentType,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';

import { createAppMetricExporter } from '@/src/observability/metrics/config/createAppMetricExporter';

describe('createAppMetricExporter', () => {
  it('selects cumulative temporality for counters and histograms', () => {
    const exporter = createAppMetricExporter({
      url: 'http://localhost:4001/godel/v1/metrics',
      timeoutMillis: 1000,
    });

    assert.equal(
      exporter.selectAggregationTemporality(InstrumentType.COUNTER),
      AggregationTemporality.CUMULATIVE,
    );
    assert.equal(
      exporter.selectAggregationTemporality(InstrumentType.HISTOGRAM),
      AggregationTemporality.CUMULATIVE,
    );
    assert.equal(
      exporter.selectAggregationTemporality(InstrumentType.UP_DOWN_COUNTER),
      AggregationTemporality.CUMULATIVE,
    );
  });
});

describe('cumulative counter collection', () => {
  it('exports a growing process total across flushes', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({
          exporter,
          exportIntervalMillis: 60_000,
        }),
      ],
    });

    try {
      const counter = provider.getMeter('test').createCounter('app_session_heartbeat');

      counter.add(1, { session_id: 'session-a' });
      await provider.forceFlush();

      counter.add(1, { session_id: 'session-a' });
      await provider.forceFlush();

      const exportedValues = exporter.getMetrics().map(resourceMetrics => {
        const metric = resourceMetrics.scopeMetrics[0]?.metrics[0];
        assert.ok(metric);
        assert.equal(metric.aggregationTemporality, AggregationTemporality.CUMULATIVE);
        assert.equal(metric.dataPointType, DataPointType.SUM);
        return metric.dataPoints[0]?.value;
      });

      assert.deepEqual(exportedValues, [1, 2]);
    } finally {
      await provider.shutdown();
    }
  });
});
