import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  callScheduleComponentToMarkdown,
  callScheduleDurationLabel,
  createCallScheduleViewModel,
  formatCallSlotLabel,
  isLikelyUserId,
  parseCallScheduleDuration,
  readCallScheduleSelection,
} from '@/src/utils/flowCallScheduleUtils';
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';

const proposed: FlowComponentLike = {
  id: 'call-schedule',
  type: 'call_schedule',
  props: {
    phase: 'proposed',
    title: 'Dummy sync call',
    attendees: ['Deepak Oram', 'user-abc12345'],
    slots: [
      { id: 'slot-1', start: '2026-09-04T10:00:00.000Z' },
      { id: 'slot-2', start: '2026-09-04T14:30:00.000Z' },
    ],
    defaultSlotId: 'slot-1',
    defaultDuration: 30,
  },
};

const scheduled: FlowComponentLike = {
  id: 'call-schedule',
  type: 'call_schedule',
  props: {
    phase: 'scheduled',
    title: 'Dummy sync call',
    attendees: ['user-1'],
    start: '2026-09-04T10:00:00.000Z',
    duration: 45,
  },
};

describe('flowCallScheduleUtils', () => {
  it('builds a proposed view model with defaults', () => {
    const viewModel = createCallScheduleViewModel(proposed);
    assert.ok(viewModel);
    assert.equal(viewModel.phase, 'proposed');
    if (viewModel.phase !== 'proposed') return;
    assert.equal(viewModel.title, 'Dummy sync call');
    assert.equal(viewModel.defaultSlotId, 'slot-1');
    assert.equal(viewModel.defaultDuration, 30);
    assert.equal(viewModel.slots.length, 2);
  });

  it('builds a scheduled view model', () => {
    const viewModel = createCallScheduleViewModel(scheduled);
    assert.ok(viewModel);
    assert.equal(viewModel.phase, 'scheduled');
    if (viewModel.phase !== 'scheduled') return;
    assert.equal(viewModel.duration, 45);
    assert.equal(viewModel.start, '2026-09-04T10:00:00.000Z');
  });

  it('rejects invalid proposed payloads', () => {
    assert.equal(
      createCallScheduleViewModel({ type: 'call_schedule', props: { phase: 'proposed' } }),
      null,
    );
    assert.equal(createCallScheduleViewModel({ type: 'plan' }), null);
  });

  it('parses durations and labels', () => {
    assert.equal(parseCallScheduleDuration(60), 60);
    assert.equal(parseCallScheduleDuration(15), null);
    assert.equal(callScheduleDurationLabel(60), '1 hr');
    assert.equal(callScheduleDurationLabel(30), '30 mins');
  });

  it('formats slot labels from start + duration', () => {
    const label = formatCallSlotLabel('2026-09-04T10:00:00.000Z', 30);
    assert.ok(label);
    assert.match(label.dateLabel, /Sep/);
    assert.match(label.rangeLabel, /-/);
  });

  it('reads selection with fallbacks', () => {
    assert.deepEqual(readCallScheduleSelection(undefined, { slotId: 'a', duration: 30 }), {
      slotId: 'a',
      duration: 30,
    });
    assert.deepEqual(
      readCallScheduleSelection({ slotId: 'b', duration: 45 }, { slotId: 'a', duration: 30 }),
      { slotId: 'b', duration: 45 },
    );
  });

  it('detects likely user ids vs display names', () => {
    assert.equal(isLikelyUserId('user-abc12345'), true);
    assert.equal(isLikelyUserId('Deepak Oram'), false);
  });

  it('projects call schedule components to markdown', () => {
    const markdown = callScheduleComponentToMarkdown(proposed);
    assert.match(markdown, /\*\*Dummy sync call\*\*/);
    assert.match(markdown, /Available slots/);
  });
});
