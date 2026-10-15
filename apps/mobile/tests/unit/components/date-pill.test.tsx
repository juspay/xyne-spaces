import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DatePill, DatePillBadge, formatDatePill } from '@/src/components/chat/date-pill/date-pill';
import { formatChatDateLabel } from '@/src/components/chat/date-pill/date-pill.utils';

describe('formatDatePill', () => {
  it('returns "Today" for the current date', () => {
    const now = new Date();
    expect(formatDatePill(now)).toBe('Today');
  });

  it('returns "Yesterday" for the previous date', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatDatePill(yesterday)).toBe('Yesterday');
  });

  it('returns "EEEE, MMMM d" for a date in the same year (not today/yesterday)', () => {
    const date = new Date(new Date().getFullYear(), 0, 15); // Jan 15 this year
    const result = formatDatePill(date);
    // Should be day-of-week + month + day, no year
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Yesterday');
    expect(result).not.toMatch(/,\s*\d{4}$/); // no year suffix
    expect(result).toMatch(/January 15/);
  });

  it('returns "EEEE, MMMM d, yyyy" for a date in a different year', () => {
    const date = new Date(2023, 5, 10); // Jun 10, 2023
    const result = formatDatePill(date);
    expect(result).toMatch(/2023$/);
    expect(result).toMatch(/June 10/);
  });
});

describe('formatChatDateLabel', () => {
  it('preserves complete date parts for both existing surfaces', () => {
    const date = new Date(2026, 8, 13, 12, 0, 0);

    expect(
      formatChatDateLabel(date, {
        relativeLabels: false,
        order: 'day-month',
        year: 'never',
      }),
    ).toBe('Sunday, 13 September');
    expect(
      formatChatDateLabel(date, {
        relativeLabels: false,
        order: 'month-day',
        year: 'auto',
      }),
    ).toBe('Sunday, September 13');
  });

  it('shows a visible fallback for an invalid timestamp', () => {
    expect(formatChatDateLabel(Number.NaN)).toBe('Date unavailable');
  });
});

describe('DatePillBadge', () => {
  it('renders the provided date text', () => {
    render(<DatePillBadge dateText='Today' />);
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('renders the complete date label without shortening it', () => {
    render(<DatePillBadge dateText='Sunday, 13 September' />);
    expect(screen.getByText('Sunday, 13 September')).toBeTruthy();
  });

  it('keeps the date on a single non-wrapping line', () => {
    render(<DatePillBadge dateText='Sunday, 13 September' />);
    const label = screen.getByText('Sunday, 13 September');
    expect(label.props['numberOfLines']).toBe(1);
    expect(StyleSheet.flatten(label.props['style']).flexShrink).toBe(0);
  });
});

describe('DatePill', () => {
  it('renders the provided date text inside the badge', () => {
    render(<DatePill dateText='Yesterday' />);
    expect(screen.getByText('Yesterday')).toBeTruthy();
  });
});
