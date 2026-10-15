import type {
  DailyBriefHistoryItem,
  DailyBriefLatest,
  DailyBriefPayload,
} from '../api/dailyBriefApi';

/**
 * Pure derivations for the Morning Brief screen.
 * Ported from dashboard/src/routes/DailyBriefScreen/DailyBriefScreen.tsx and
 * BriefListView.tsx. Date formatting avoids `toLocaleDateString` options so it
 * behaves identically on Hermes builds without full ICU.
 */

export type SectionKey = keyof Pick<
  DailyBriefPayload,
  'what_needs_you' | 'overdue' | 'waiting_on_others' | 'assigned_to_you' | 'todays_schedule'
>;

export interface SectionSpec {
  field: SectionKey;
  label: string;
  /** Rows get a leading dot bullet. */
  checkable: boolean;
  /** Vertical gap between rows, px. */
  itemGap: number;
}

export const SECTIONS: SectionSpec[] = [
  { field: 'what_needs_you', label: 'What needs you', checkable: false, itemGap: 12 },
  { field: 'overdue', label: 'Overdue', checkable: true, itemGap: 12 },
  { field: 'waiting_on_others', label: 'Waiting on others', checkable: true, itemGap: 16 },
  { field: 'assigned_to_you', label: 'Assigned to you', checkable: true, itemGap: 12 },
  { field: 'todays_schedule', label: "Today's schedule", checkable: false, itemGap: 12 },
];

export const BRIEF_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SelectedBrief {
  date: string | undefined;
  status: string;
  content: string;
  data: DailyBriefPayload | null;
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-07-29" → local-midnight Date, or null when unparseable. */
export function parseBucket(date: string | undefined): Date | null {
  if (!date || !BRIEF_DATE_RE.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function monthShort(d: Date): string {
  return MONTHS_SHORT[d.getMonth()] ?? '';
}

export function weekdayShort(d: Date): string {
  return WEEKDAYS_SHORT[d.getDay()] ?? '';
}

/** "Brief // Jul 29" — the serif page title. */
export function formatBriefTitle(date: string | undefined): string {
  if (!date) return 'Brief';
  const parsed = parseBucket(date);
  if (!parsed) return `Brief // ${date}`;
  return `Brief // ${monthShort(parsed)} ${parsed.getDate()}`;
}

/** "Morning Brief 29 Jul" — a history menu row. */
export function briefMenuLabel(date: string): string {
  const parsed = parseBucket(date);
  if (!parsed) return `Morning Brief ${date}`;
  return `Morning Brief ${parsed.getDate()} ${monthShort(parsed)}`;
}

/**
 * The brief the screen shows for a selection. `selectedDate === null` means
 * the today/latest view. A date outside the loaded history window resolves
 * through `fetched` (pulled on demand by the date picker).
 */
export function selectBrief(
  selectedDate: string | null,
  history: DailyBriefHistoryItem[],
  latest: DailyBriefLatest | null,
  fetched: SelectedBrief | null,
): SelectedBrief | null {
  if (selectedDate) {
    const fromHistory = history.find(h => h.date === selectedDate);
    if (fromHistory) {
      return {
        date: fromHistory.date,
        status: fromHistory.status,
        content: fromHistory.content,
        data: fromHistory.data ?? null,
      };
    }
    return fetched?.date === selectedDate ? fetched : null;
  }
  if (latest && latest.status !== 'none') {
    return {
      date: latest.date,
      status: latest.status,
      content: latest.content ?? '',
      data: latest.data ?? null,
    };
  }
  return null;
}

export interface BriefSectionLines {
  spec: SectionSpec;
  lines: string[];
}

/** Non-empty sections with their non-blank lines, in display order. */
export function computeSections(data: DailyBriefPayload | null | undefined): BriefSectionLines[] {
  if (!data) return [];
  return SECTIONS.map(spec => ({
    spec,
    lines: (data[spec.field] ?? []).filter(line => line.trim().length > 0),
  })).filter(entry => entry.lines.length > 0);
}

/** Header action label — mirrors the web's Generate/Regenerate cycle. */
export function briefActionLabel(args: {
  loadingWithoutBrief: boolean;
  fetching: boolean;
  regenerating: boolean;
  briefGenerating: boolean;
  hasBrief: boolean;
}): string {
  if (args.loadingWithoutBrief || args.fetching) return 'Loading…';
  if (args.regenerating) return args.hasBrief ? 'Regenerating…' : 'Generating…';
  if (args.briefGenerating) return 'Generating…';
  return args.hasBrief ? 'Regenerate' : 'Generate';
}
