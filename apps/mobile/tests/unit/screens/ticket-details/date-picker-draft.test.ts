import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampPickerSelection,
  isSameMinute,
  startOfDraft,
  toMinutePrecision,
} from '@/src/screens/ticket-details/date-picker-draft';

describe('startOfDraft', () => {
  it('preserves an existing overdue value instead of clamping to minimumDate', () => {
    const overdue = new Date(2024, 0, 1, 9, 30, 15).getTime();
    const minimumDate = new Date(2024, 8, 17, 12, 0, 0);
    const draft = startOfDraft(overdue, minimumDate);
    assert.equal(draft.getTime(), overdue);
  });

  it('seeds empty values from minimumDate when provided', () => {
    const minimumDate = new Date(2024, 8, 17, 12, 0, 0);
    assert.equal(startOfDraft(null, minimumDate).getTime(), minimumDate.getTime());
  });

  it('seeds empty values from now when minimumDate is absent', () => {
    const before = Date.now();
    const draft = startOfDraft(null);
    const after = Date.now();
    assert.ok(draft.getTime() >= before && draft.getTime() <= after);
  });
});

describe('clampPickerSelection', () => {
  const minimumDate = new Date(2024, 8, 17, 12, 0, 0);
  const past = new Date(2024, 8, 17, 11, 0, 0);
  const future = new Date(2024, 8, 17, 13, 0, 0);

  it('does not rewrite past drafts while editing an existing overdue value', () => {
    const overdueValue = new Date(2024, 0, 1, 9, 15).getTime();
    const next = clampPickerSelection(past, { value: overdueValue, minimumDate });
    assert.equal(next.getTime(), past.getTime());
  });

  it('still clamps past picks when the opened value is unset or in the future', () => {
    assert.equal(
      clampPickerSelection(past, { value: null, minimumDate }).getTime(),
      minimumDate.getTime(),
    );
    assert.equal(
      clampPickerSelection(past, {
        value: future.getTime(),
        minimumDate,
      }).getTime(),
      minimumDate.getTime(),
    );
  });

  it('allows future selections unchanged', () => {
    assert.equal(
      clampPickerSelection(future, { value: null, minimumDate }).getTime(),
      future.getTime(),
    );
  });
});

describe('isSameMinute', () => {
  it('matches dashboard minute precision used by Due Date / Status Deadline', () => {
    const base = new Date(2024, 8, 17, 15, 30, 0).getTime();
    const sameMinute = base + 45_000;
    const nextMinute = base + 60_000;
    assert.equal(toMinutePrecision(base), toMinutePrecision(sameMinute));
    assert.equal(isSameMinute(base, sameMinute), true);
    assert.equal(isSameMinute(base, nextMinute), false);
  });
});
