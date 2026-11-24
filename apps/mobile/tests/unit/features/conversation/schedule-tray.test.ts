import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  scheduleTrayChoices,
  scheduleTrayCustomStart,
  scheduleTrayFields,
} from '@/src/features/conversation/model/schedule-tray';

describe('scheduleTrayChoices', () => {
  it('names the presets by day, with the exact time underneath', () => {
    // Tuesday 24 Nov 2026.
    const rows = scheduleTrayChoices(new Date(2026, 10, 24, 15, 40));
    assert.deepEqual(
      rows.map(row => [row.id, row.title, row.subtitle]),
      [
        ['tomorrow-9am', 'Tomorrow', 'Wed 25 Nov, 9:00 am'],
        ['next-monday-9am', 'Next Monday', 'Mon 30 Nov, 9:00 am'],
        ['custom', 'Custom…', 'Pick a date and time'],
      ],
    );
    assert.equal(rows[0]?.scheduledFor, new Date(2026, 10, 25, 9, 0).getTime());
    assert.equal(rows[2]?.scheduledFor, null);
  });

  it('takes next Monday a week out on a Monday, as the classic sheet does', () => {
    const rows = scheduleTrayChoices(new Date(2026, 10, 30, 8, 0));
    assert.equal(rows[1]?.subtitle, 'Mon 7 Dec, 9:00 am');
  });
});

describe('scheduleTrayFields', () => {
  it('shows the chosen date and time under their rows', () => {
    assert.deepEqual(
      scheduleTrayFields(new Date(2026, 10, 24, 15, 41)).map(row => [row.title, row.subtitle]),
      [
        ['Date', 'Tue 24 Nov'],
        ['Time', '3:41 pm'],
      ],
    );
  });
});

describe('scheduleTrayCustomStart', () => {
  it('rounds up to the next quarter hour at least 15 minutes out', () => {
    assert.deepEqual(
      scheduleTrayCustomStart(new Date(2026, 10, 24, 11, 52, 30)),
      new Date(2026, 10, 24, 12, 15),
    );
  });

  it('keeps a time already on a quarter hour 15 minutes out', () => {
    assert.deepEqual(
      scheduleTrayCustomStart(new Date(2026, 10, 24, 11, 45)),
      new Date(2026, 10, 24, 12, 0),
    );
  });

  it('crosses midnight', () => {
    assert.deepEqual(
      scheduleTrayCustomStart(new Date(2026, 10, 24, 23, 50)),
      new Date(2026, 10, 25, 0, 15),
    );
  });
});
