import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatETADisplay,
  isStageDeadlineOverdue,
  isTicketDueDateOverdue,
} from '@/src/screens/ticket-details/eta-display';

describe('formatETADisplay', () => {
  it('returns an em dash when eta is missing', () => {
    assert.equal(formatETADisplay(null), '—');
    assert.equal(formatETADisplay(undefined), '—');
    assert.equal(formatETADisplay(0), '—');
  });

  it('formats local date and 12-hour time like the dashboard', () => {
    const afternoon = new Date(2024, 0, 5, 14, 5).getTime();
    assert.equal(formatETADisplay(afternoon), '5 Jan, 2:05 PM');

    const midnight = new Date(2024, 8, 17, 0, 0).getTime();
    assert.equal(formatETADisplay(midnight), '17 Sep, 12:00 AM');

    const noon = new Date(2024, 8, 17, 12, 7).getTime();
    assert.equal(formatETADisplay(noon), '17 Sep, 12:07 PM');
  });
});

describe('isTicketDueDateOverdue', () => {
  const now = new Date(2024, 8, 17, 12, 0).getTime();
  const past = now - 60_000;
  const future = now + 60_000;

  it('is true when due is in the past and status is active', () => {
    assert.equal(isTicketDueDateOverdue(past, 'TODO', now), true);
    assert.equal(isTicketDueDateOverdue(past, 'IN_PROGRESS', now), true);
    assert.equal(isTicketDueDateOverdue(past, '  paused  ', now), true);
  });

  it('is false for terminal statuses even when due is past', () => {
    assert.equal(isTicketDueDateOverdue(past, 'COMPLETED', now), false);
    assert.equal(isTicketDueDateOverdue(past, 'cancelled', now), false);
    assert.equal(isTicketDueDateOverdue(past, ' CANCELLED ', now), false);
  });

  it('is false when due is missing, invalid, or still in the future', () => {
    assert.equal(isTicketDueDateOverdue(null, 'TODO', now), false);
    assert.equal(isTicketDueDateOverdue(undefined, 'TODO', now), false);
    assert.equal(isTicketDueDateOverdue(Number.NaN, 'TODO', now), false);
    assert.equal(isTicketDueDateOverdue(future, 'TODO', now), false);
  });
});

describe('isStageDeadlineOverdue', () => {
  it('shares the same overdue rule as ticket due date', () => {
    const now = Date.now();
    assert.equal(isStageDeadlineOverdue, isTicketDueDateOverdue);
    assert.equal(isStageDeadlineOverdue(now - 1, 'TODO', now), true);
    assert.equal(isStageDeadlineOverdue(now - 1, 'COMPLETED', now), false);
  });
});
