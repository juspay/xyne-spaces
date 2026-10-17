import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CUSTOM_REMINDER_DEFAULT_DELAY_MS,
  REMINDER_PRESETS,
} from '@/src/features/chat/v2/components/message-actions-sheet/message-reminder-config';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

describe('message-reminder-config constants', () => {
  it('defaults a custom reminder to one hour out', () => {
    assert.equal(CUSTOM_REMINDER_DEFAULT_DELAY_MS, HOUR_MS);
  });

  it('exposes the expected preset ids in order', () => {
    assert.deepEqual(
      REMINDER_PRESETS.map(preset => preset.id),
      ['20m', '1h', 'tomorrow', 'next-week'],
    );
  });

  it('gives every preset a label and a getTime function', () => {
    for (const preset of REMINDER_PRESETS) {
      assert.equal(typeof preset.label, 'string');
      assert.ok(preset.label.length > 0);
      assert.equal(typeof preset.getTime, 'function');
    }
  });
});

const presetById = (id: string) => {
  const preset = REMINDER_PRESETS.find(p => p.id === id);
  assert.ok(preset, `missing preset ${id}`);
  return preset;
};

describe('relative reminder presets', () => {
  it('computes the 20-minute offset from now', () => {
    const before = Date.now();
    const time = presetById('20m').getTime();
    const after = Date.now();
    assert.ok(time >= before + 20 * MINUTE_MS);
    assert.ok(time <= after + 20 * MINUTE_MS);
  });

  it('computes the 1-hour offset from now', () => {
    const before = Date.now();
    const time = presetById('1h').getTime();
    const after = Date.now();
    assert.ok(time >= before + HOUR_MS);
    assert.ok(time <= after + HOUR_MS);
  });

  it('computes the next-week offset from now', () => {
    const before = Date.now();
    const time = presetById('next-week').getTime();
    const after = Date.now();
    assert.ok(time >= before + 7 * DAY_MS);
    assert.ok(time <= after + 7 * DAY_MS);
  });
});

describe('tomorrow-morning preset', () => {
  it('lands on a future 09:00 local time', () => {
    const time = presetById('tomorrow').getTime();
    const when = new Date(time);
    assert.ok(time > Date.now());
    assert.equal(when.getHours(), 9);
    assert.equal(when.getMinutes(), 0);
    assert.equal(when.getSeconds(), 0);
  });
});
