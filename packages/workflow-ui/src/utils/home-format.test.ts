import { describe, expect, it } from 'vitest';
import {
  endOfToday,
  formatDue,
  formatRaisedAt,
  formatWaiting,
  greetingFor,
} from './home-format.js';

const HOUR = 3_600_000;
const NOW = new Date('2026-08-24T10:00:00Z').getTime();

describe('formatWaiting', () => {
  it('renders days with zero-padded hours', () => {
    expect(formatWaiting(new Date(NOW - 52 * HOUR), NOW)).toBe('2d 04h');
  });

  it('renders hours with zero-padded minutes', () => {
    expect(formatWaiting(new Date(NOW - (4 * HOUR + 5 * 60_000)), NOW)).toBe('4h 05m');
  });

  it('renders minutes alone under an hour', () => {
    expect(formatWaiting(new Date(NOW - 12 * 60_000), NOW)).toBe('12m');
  });

  it('clamps a future timestamp to zero rather than going negative', () => {
    expect(formatWaiting(new Date(NOW + 5 * HOUR), NOW)).toBe('0m');
  });
});

describe('formatDue', () => {
  it('names the countdown so it cannot be read as lateness', () => {
    expect(formatDue(new Date(NOW + (HOUR + 30 * 60_000)), NOW)).toBe('1h 30m before due');
  });

  it('names the overrun once the deadline has passed', () => {
    expect(formatDue(new Date(NOW - 52 * HOUR), NOW)).toBe('2d 04h past due');
  });
});

describe('formatRaisedAt', () => {
  // Locale-agnostic: the glyph order is Intl's business, so check the parts.
  it('includes day, month and year but no clock time', () => {
    const out = formatRaisedAt(new Date(NOW));
    expect(out).toMatch(/\d{2}/);
    expect(out).toMatch(/[A-Za-z]{3}/);
    expect(out).toContain('2026');
    expect(out).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('greetingFor', () => {
  it('picks the word from the local hour', () => {
    const at = (h: number) => {
      const d = new Date(NOW);
      d.setHours(h, 0, 0, 0);
      return d.getTime();
    };
    expect(greetingFor(at(9))).toBe('Good morning');
    expect(greetingFor(at(14))).toBe('Good afternoon');
    expect(greetingFor(at(20))).toBe('Good evening');
  });

  describe('endOfToday', () => {
    it('returns midnight tonight, not the end of the current hour', () => {
      const noon = new Date('2026-09-28T12:00:00').getTime();
      const end = new Date(endOfToday(noon));
      expect(end.getDate()).toBe(29);
      expect(end.getHours()).toBe(0);
      expect(end.getMinutes()).toBe(0);
    });

    it('is exclusive, so the last millisecond of the day is still today', () => {
      const now = new Date('2026-09-28T09:00:00').getTime();
      const lastMoment = new Date('2026-09-28T23:59:59.999').getTime();
      expect(lastMoment).toBeLessThan(endOfToday(now));
    });

    it('rolls over with the date', () => {
      const a = endOfToday(new Date('2026-09-28T23:00:00').getTime());
      const b = endOfToday(new Date('2026-09-29T01:00:00').getTime());
      expect(b).toBeGreaterThan(a);
    });
  });

});
