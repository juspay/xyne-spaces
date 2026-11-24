import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clockLabel,
  dayMonthOf,
  lowerMeridiem,
} from '@/src/features/conversation/model/message-time';

describe('lowerMeridiem', () => {
  it('lower-cases the meridiem', () => {
    assert.equal(lowerMeridiem('2:22 PM'), '2:22 pm');
    assert.equal(lowerMeridiem('11:05 AM'), '11:05 am');
  });

  it('leaves other labels alone', () => {
    assert.equal(lowerMeridiem('14:22'), '14:22');
    assert.equal(lowerMeridiem(''), '');
  });
});

describe('clockLabel', () => {
  it('writes a 12-hour clock with a lower-case meridiem', () => {
    assert.equal(clockLabel(new Date(2026, 9, 12, 9, 5)), '9:05 am');
    assert.equal(clockLabel(new Date(2026, 9, 12, 14, 22)), '2:22 pm');
  });

  it('writes midnight and noon as 12', () => {
    assert.equal(clockLabel(new Date(2026, 9, 12, 0, 0)), '12:00 am');
    assert.equal(clockLabel(new Date(2026, 9, 12, 12, 30)), '12:30 pm');
  });
});

describe('dayMonthOf', () => {
  it('writes the day then the short month', () => {
    assert.equal(dayMonthOf(new Date(2026, 9, 12)), '12 Oct');
    assert.equal(dayMonthOf(new Date(2026, 0, 1)), '1 Jan');
  });
});
