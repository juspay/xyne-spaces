import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  chartComponentToMarkdown,
  chartNotificationPreview,
  compactChartValue,
  createChartViewModel,
  pivotChartSeries,
} from '@/src/utils/flowChartUtils';
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';

const barChart: FlowComponentLike = {
  id: 'chart',
  type: 'chart',
  props: {
    type: 'bar',
    points: [
      { label: 'LOGIN', value: 3410 },
      { label: 'UPDATE', value: 1843 },
      { label: 'DELETE', value: 149 },
    ],
    caption: 'Dummy persisted activity events',
  },
};

const lineChart: FlowComponentLike = {
  id: 'chart',
  type: 'chart',
  props: {
    type: 'line',
    series: [
      { x: 'Mon', y: 1, series: 'android' },
      { x: 'Mon', y: 2, series: 'ios' },
      { x: 'Tue', y: 3, series: 'android' },
      { x: 'Tue', y: 1, series: 'ios' },
    ],
    caption: 'Crashes by platform',
  },
};

describe('flowChartUtils', () => {
  it('builds a bar chart view model', () => {
    const viewModel = createChartViewModel(barChart);
    assert.ok(viewModel);
    assert.equal(viewModel.kind, 'bar');
    if (viewModel.kind !== 'bar') return;
    assert.equal(viewModel.points.length, 3);
    assert.equal(viewModel.caption, 'Dummy persisted activity events');
  });

  it('builds a multi-series line view model', () => {
    const viewModel = createChartViewModel(lineChart);
    assert.ok(viewModel);
    assert.equal(viewModel.kind, 'line');
  });

  it('rejects empty chart payloads', () => {
    assert.equal(createChartViewModel({ type: 'chart', props: { type: 'bar', points: [] } }), null);
    assert.equal(createChartViewModel({ type: 'plan' }), null);
  });

  it('compacts large values', () => {
    assert.equal(compactChartValue(3410), '3.4k');
    assert.equal(compactChartValue(1_200_000), '1.2m');
    assert.equal(compactChartValue(42), '42');
  });

  it('pivots series preserving first-seen order', () => {
    const { data, names } = pivotChartSeries([
      { x: 'Mon', y: 1, series: 'android' },
      { x: 'Mon', y: 2, series: 'ios' },
      { x: 'Tue', y: 3, series: 'android' },
    ]);
    assert.deepEqual(names, ['android', 'ios']);
    assert.equal(data[0]?.['x'], 'Mon');
    assert.equal(data[0]?.['android'], 1);
    assert.equal(data[0]?.['ios'], 2);
  });

  it('projects chart components to markdown', () => {
    const markdown = chartComponentToMarkdown(barChart);
    assert.match(markdown, /\*\*Chart\*\* \(bar\)/);
    assert.match(markdown, /LOGIN/);
    assert.match(markdown, /3\.4k/);
  });

  it('builds notification preview text', () => {
    const viewModel = createChartViewModel(barChart);
    assert.ok(viewModel);
    assert.equal(chartNotificationPreview(viewModel), '📊 Dummy persisted activity events');
  });
});
