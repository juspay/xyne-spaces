import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TicketPriority } from '@xyne/shared';

import {
  sortPrioritiesForFilterLabel,
  formatPriorityFilterLabel,
} from '@/src/features/xyne-desks/tickets/utils/format-priority-filter-label';

describe('sortPrioritiesForFilterLabel', () => {
  it('orders priorities Low → Medium → High → Critical regardless of input order', () => {
    assert.deepEqual(
      sortPrioritiesForFilterLabel([
        TicketPriority.CRITICAL,
        TicketPriority.LOW,
        TicketPriority.MEDIUM,
      ]),
      [TicketPriority.LOW, TicketPriority.MEDIUM, TicketPriority.CRITICAL],
    );
  });
});

describe('formatPriorityFilterLabel', () => {
  it('falls back to "Priority" when nothing is selected', () => {
    assert.equal(formatPriorityFilterLabel([]), 'Priority');
  });

  it('shows the single selected priority label', () => {
    assert.equal(formatPriorityFilterLabel([TicketPriority.HIGH]), 'High');
  });

  it('shows the canonical-first label plus a "+ N more" suffix', () => {
    assert.equal(
      formatPriorityFilterLabel([TicketPriority.CRITICAL, TicketPriority.LOW]),
      'Low + 1 more',
    );
    assert.equal(
      formatPriorityFilterLabel([TicketPriority.HIGH, TicketPriority.LOW, TicketPriority.CRITICAL]),
      'Low + 2 more',
    );
  });
});
