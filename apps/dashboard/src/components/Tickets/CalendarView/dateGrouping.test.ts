import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import type { Ticket } from '@xyne/shared';
import { groupTicketsByDate, ticketsWithoutEta } from './dateGrouping';
const createdAt = new Date(2026, 10, 27, 9).getTime();
const eta = new Date(2026, 11, 4, 15).getTime();
// These tests exercise only date grouping, not ticket validation or application ACLs.
const ticket = (id: string, due: number | null = eta) => ({ id, createdAt, eta: due }) as Ticket;
describe('calendar Created / ETA grouping', () => {
  it('retains Created as the default', () => {
    const input = [ticket('one')];
    expect(groupTicketsByDate(input).get('2026-11-27')).toEqual(input);
  });
  it('uses ETA consistently without changing ticket data or identity', () => {
    const item = Object.freeze(ticket('one'));
    const before = JSON.stringify(item);
    expect(groupTicketsByDate([item], 'eta').get('2026-12-04')?.[0]).toBe(item);
    expect(JSON.stringify(item)).toBe(before);
  });
  it('omits tickets with no ETA instead of falling back to creation', () => {
    expect(
      groupTicketsByDate([ticket('dated'), ticket('undated', null)], 'eta')
        .get('2026-12-04')
        ?.map(item => item.id),
    ).toEqual(['dated']);
    expect(groupTicketsByDate([ticket('undated', null)], 'eta').size).toBe(0);
  });
  it('skips invalid dates without crashing the calendar', () => {
    expect(groupTicketsByDate([ticket('invalid', NaN)], 'eta').size).toBe(0);
  });
  it('accepts epoch zero as a real date', () => {
    expect(
      groupTicketsByDate([ticket('epoch', 0)], 'eta').has(format(new Date(0), 'yyyy-MM-dd')),
    ).toBe(true);
  });
});

describe('No ETA tray partition', () => {
  it('keeps absent and invalid dates reachable, without duplicating epoch zero', () => {
    const undated = ticket('undated', null);
    const invalid = ticket('invalid', NaN);
    const epoch = ticket('epoch', 0);
    expect(ticketsWithoutEta([undated, invalid, epoch, ticket('dated')])).toEqual([
      undated,
      invalid,
    ]);
    expect(undated.eta).toBeNull();
  });
});
