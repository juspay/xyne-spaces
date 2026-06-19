import { format, startOfMonth, startOfWeek, subDays } from 'date-fns';

export const TimeRange = {
  YESTERDAY: 'yesterday',
  THIS_WEEK: 'this-week',
  LAST_WEEK: 'last-week',
  THIS_MONTH: 'this-month',
} as const;

export type TimeRange = (typeof TimeRange)[keyof typeof TimeRange];

export type TeamColor = {
  primary: string;
  accentLight: string;
  accentDark: string;
};

const TEAM_COLOR_PALETTE: TeamColor[] = [
  {
    primary: '#2563EB',
    accentLight: '#DBEAFE',
    accentDark: '#1E3A8A',
  }, // blue
  {
    primary: '#7C3AED',
    accentLight: '#EDE9FE',
    accentDark: '#4C1D95',
  }, // violet
  {
    primary: '#059669',
    accentLight: '#D1FAE5',
    accentDark: '#064E3B',
  }, // emerald
  {
    primary: '#DC2626',
    accentLight: '#FEE2E2',
    accentDark: '#7F1D1D',
  }, // red
  {
    primary: '#EA580C',
    accentLight: '#FFEDD5',
    accentDark: '#7C2D12',
  }, // orange
  {
    primary: '#0891B2',
    accentLight: '#CFFAFE',
    accentDark: '#164E63',
  }, // cyan
  {
    primary: '#4F46E5',
    accentLight: '#E0E7FF',
    accentDark: '#312E81',
  }, // indigo
  {
    primary: '#BE185D',
    accentLight: '#FCE7F3',
    accentDark: '#831843',
  }, // pink
  {
    primary: '#65A30D',
    accentLight: '#ECFCCB',
    accentDark: '#365314',
  }, // lime
  {
    primary: '#9333EA',
    accentLight: '#F3E8FF',
    accentDark: '#581C87',
  }, // purple
];

const hashString = (str: string): number => {
  let hash = 0;

  for (const char of str) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash;
};

/**
 * Deterministically returns a color palette for a team.
 *
 * Same team name will always return the same colors.
 */
export const getTeamColor = (teamName: string): TeamColor => {
  const index = hashString(teamName) % TEAM_COLOR_PALETTE.length;

  return TEAM_COLOR_PALETTE[index]!;
};

/**
 * Extracts initials from a person's name using only the first and last name parts.
 *
 * @example
 * extractInitials('John Doe') // 'JD'
 * extractInitials('John  Doe') // 'JD' (handles double spaces)
 * extractInitials('Mary Jane Watson') // 'MW'
 * extractInitials('John') // 'J'
 */
export const extractInitials = (name: string): string => {
  const parts = name.split(' ').filter(Boolean);
  const relevant = parts.length > 1 ? [parts[0]!, parts[parts.length - 1]!] : [parts[0] ?? ''];
  return relevant
    .map(part => part[0])
    .join('')
    .toUpperCase();
};

export const removeFormattedPrefix = (text: string): string => {
  return text.replace(/^\*\*\[[^\]]+\]:\*\*\s*/, '');
};

// Pretty-print an ISO date string (e.g. "2026-06-04") → "Jun 4, 2026"
export const formatReportDate = (date: string): string => {
  try {
    return format(date, 'MMM d, yyyy');
  } catch {
    return date;
  }
};

export const getDateRange = (timeRange: TimeRange): { from: string; to: string } => {
  const today = new Date();

  switch (timeRange) {
    case TimeRange.YESTERDAY: {
      const yesterday = subDays(today, 1);
      return { from: format(yesterday, 'yyyy-MM-dd'), to: format(yesterday, 'yyyy-MM-dd') };
    }
    case TimeRange.THIS_WEEK: {
      const fromDate = startOfWeek(today, { weekStartsOn: 1 });
      return { from: format(fromDate, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
    }
    case TimeRange.LAST_WEEK: {
      const lastWeekStart = startOfWeek(subDays(today, 7), { weekStartsOn: 1 });
      const lastWeekEnd = subDays(startOfWeek(today, { weekStartsOn: 1 }), 1);
      return { from: format(lastWeekStart, 'yyyy-MM-dd'), to: format(lastWeekEnd, 'yyyy-MM-dd') };
    }
    case TimeRange.THIS_MONTH: {
      const fromDate = startOfMonth(today);
      return { from: format(fromDate, 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
    }
    default: {
      const now = format(today, 'yyyy-MM-dd');
      return { from: now, to: now };
    }
  }
};

// ── Recap summary parsing ────────────────────────────────────────────────────

export interface RecapPoint {
  text: string;
  messageId?: string;
  conversationId?: string;
  citationIndex?: number;
  entityType?: string;
  channelId?: string;
}

export interface RecapSummary {
  points: RecapPoint[];
  messageCount: number;
}

/**
 * Parses a recap summary JSON string into a structured object.
 * Falls back to empty points on malformed JSON.
 */
export const parseRecapSummary = (summary: string): RecapSummary => {
  try {
    const parsed = JSON.parse(summary) as RecapSummary;
    const points = Array.isArray(parsed.points)
      ? parsed.points.filter(
          (point): point is RecapPoint =>
            point !== null && typeof point === 'object' && typeof point.text === 'string',
        )
      : [];

    return {
      points,
      messageCount: parsed.messageCount ?? 0,
    };
  } catch {
    return { points: [], messageCount: 0 };
  }
};
