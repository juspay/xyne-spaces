import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TicketStatusV2 } from '@xyne/shared';

import { formatTicketAge } from '@/src/features/channel-tickets/utils/format-ticket-age';
import { formatTicketDate } from '@/src/features/channel-tickets/utils/format-ticket-date';
import { isEtaUrgent } from '@/src/features/channel-tickets/utils/is-eta-urgent';
import { parseAssigneeRef } from '@/src/features/channel-tickets/utils/parse-assignee-ref';
import { getTicketStatusStyle } from '@/src/features/channel-tickets/utils/ticket-status-style';

const DAY_MS = 86_400_000;
const NOW = new Date(2026, 8, 4, 12, 0, 0).getTime();

describe('formatTicketAge', () => {
  it('renders whole days', () => {
    assert.equal(formatTicketAge(NOW - 12 * DAY_MS, NOW), '12d');
    assert.equal(formatTicketAge(NOW - 0.5 * DAY_MS, NOW), '0d');
  });

  it('never goes negative for future createdAt (clock skew)', () => {
    assert.equal(formatTicketAge(NOW + DAY_MS, NOW), '0d');
  });

  it('renders the em dash for missing input', () => {
    assert.equal(formatTicketAge(null, NOW), '—');
    assert.equal(formatTicketAge(0, NOW), '—');
    assert.equal(formatTicketAge(Number.NaN, NOW), '—');
  });
});

describe('formatTicketDate', () => {
  it('formats as "MMM d, yyyy"', () => {
    assert.equal(formatTicketDate(new Date(2026, 0, 9).getTime()), 'Jan 9, 2026');
  });

  it('renders the em dash for missing input', () => {
    assert.equal(formatTicketDate(null), '—');
    assert.equal(formatTicketDate(undefined), '—');
    assert.equal(formatTicketDate(0), '—');
  });
});

describe('isEtaUrgent', () => {
  it('is urgent when due before today and not terminal', () => {
    assert.equal(isEtaUrgent(NOW - DAY_MS, TicketStatusV2.STARTED, NOW), true);
    assert.equal(isEtaUrgent(NOW - DAY_MS, null, NOW), true);
  });

  it('is not urgent when due today or later', () => {
    assert.equal(isEtaUrgent(NOW - 60_000, TicketStatusV2.STARTED, NOW), false);
    assert.equal(isEtaUrgent(NOW + DAY_MS, TicketStatusV2.STARTED, NOW), false);
  });

  it('is not urgent for completed / cancelled tickets', () => {
    assert.equal(isEtaUrgent(NOW - DAY_MS, TicketStatusV2.COMPLETED, NOW), false);
    assert.equal(isEtaUrgent(NOW - DAY_MS, TicketStatusV2.CANCELLED, NOW), false);
  });

  it('is not urgent without a due date', () => {
    assert.equal(isEtaUrgent(null, TicketStatusV2.STARTED, NOW), false);
    assert.equal(isEtaUrgent(0, TicketStatusV2.STARTED, NOW), false);
  });
});

describe('parseAssigneeRef', () => {
  it('parses prefixed and bare ids', () => {
    assert.deepEqual(parseAssigneeRef('user:u-1'), { kind: 'user', id: 'u-1' });
    assert.deepEqual(parseAssigneeRef('group:g-1'), { kind: 'group', id: 'g-1' });
    assert.deepEqual(parseAssigneeRef('userGroup:g-2'), { kind: 'group', id: 'g-2' });
    assert.deepEqual(parseAssigneeRef('u-9'), { kind: 'user', id: 'u-9' });
  });

  it('returns null for empty values', () => {
    assert.equal(parseAssigneeRef(null), null);
    assert.equal(parseAssigneeRef('   '), null);
    assert.equal(parseAssigneeRef('user:'), null);
  });
});

describe('getTicketStatusStyle', () => {
  it('maps every TicketStatusV2 to a label and colour tokens', () => {
    for (const status of Object.values(TicketStatusV2)) {
      const style = getTicketStatusStyle(status);
      assert.ok(style.label && style.label !== '—', status);
      assert.match(style.colorVar, /^--color-ticket-status-/);
      assert.match(style.softBgVar, /-soft$/);
    }
    assert.equal(getTicketStatusStyle(TicketStatusV2.TODO).label, 'Todo');
    assert.equal(getTicketStatusStyle(TicketStatusV2.COMPLETED).label, 'Completed');
  });

  it('humanises unknown values and falls back to neutral colours', () => {
    const style = getTicketStatusStyle('IN_REVIEW');
    assert.equal(style.label, 'In Review');
    assert.equal(style.colorVar, '--color-secondary-foreground');
  });

  it('renders the em dash for null', () => {
    assert.equal(getTicketStatusStyle(null).label, '—');
  });
});
