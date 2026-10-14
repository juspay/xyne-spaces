import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TicketPriority } from '@xyne/shared';

import {
  sortPrioritiesForFilterLabel,
  formatPriorityFilterLabel,
} from '@/src/features/xyne-desks/tickets/utils/format-priority-filter-label';

describe('sortPrioritiesForFilterLabel', () => {
  it('orders priorities canonically Low → Medium → High → Critical', () => {
    assert.deepEqual(
      sortPrioritiesForFilterLabel([
        TicketPriority.CRITICAL,
        TicketPriority.LOW,
        TicketPriority.HIGH,
      ]),
      [TicketPriority.LOW, TicketPriority.HIGH, TicketPriority.CRITICAL],
    );
  });

  it('does not mutate the input array', () => {
    const input = [TicketPriority.HIGH, TicketPriority.LOW];
    const copy = [...input];
    sortPrioritiesForFilterLabel(input);
    assert.deepEqual(input, copy);
  });

  it('returns an empty array unchanged', () => {
    assert.deepEqual(sortPrioritiesForFilterLabel([]), []);
  });
});

describe('formatPriorityFilterLabel', () => {
  it('returns "Priority" when there are no priorities', () => {
    assert.equal(formatPriorityFilterLabel([]), 'Priority');
  });

  it('returns the human label for a single priority', () => {
    assert.equal(formatPriorityFilterLabel([TicketPriority.HIGH]), 'High');
  });

  it('labels using the canonically-lowest priority first, then "+ N more"', () => {
    // input order [CRITICAL, LOW] sorts to [LOW, CRITICAL] → "Low + 1 more"
    assert.equal(
      formatPriorityFilterLabel([TicketPriority.CRITICAL, TicketPriority.LOW]),
      'Low + 1 more',
    );
  });

  it('counts the remaining priorities for the suffix', () => {
    assert.equal(
      formatPriorityFilterLabel([
        TicketPriority.LOW,
        TicketPriority.MEDIUM,
        TicketPriority.HIGH,
        TicketPriority.CRITICAL,
      ]),
      'Low + 3 more',
    );
  });

  it('maps every priority value to its capitalised label', () => {
    assert.equal(formatPriorityFilterLabel([TicketPriority.LOW]), 'Low');
    assert.equal(formatPriorityFilterLabel([TicketPriority.MEDIUM]), 'Medium');
    assert.equal(formatPriorityFilterLabel([TicketPriority.HIGH]), 'High');
    assert.equal(formatPriorityFilterLabel([TicketPriority.CRITICAL]), 'Critical');
  });
});
