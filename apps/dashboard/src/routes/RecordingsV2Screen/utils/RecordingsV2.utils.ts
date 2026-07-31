import {
  format,
  formatDistanceToNow,
  isSameDay,
  isToday,
  isYesterday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns';
import type { OatsRecordingEntry } from '../../../hooks/usePaginatedOatsRecordings';

export type RecordingDatePreset =
  | 'all-time'
  | 'today'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month';

export type RecordingOwnershipTab = 'created' | 'shared';

type FixedRecordingDateGroupId = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month';

export interface RecordingDateGroup {
  id: FixedRecordingDateGroupId | `month-${string}`;
  label: string;
  recordings: OatsRecordingEntry[];
}

export type RecordingListRow =
  | {
      id: string;
      type: 'group';
      label: string;
    }
  | {
      id: string;
      type: 'recording';
      recording: OatsRecordingEntry;
    };

export const LIST_TAB_CLASS_NAME =
  'flex h-8 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-muted sm:flex-none';

export const RECORDING_DATE_PRESETS: ReadonlyArray<{
  value: RecordingDatePreset;
  label: string;
}> = [
  { value: 'all-time', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'this-week', label: 'This week' },
  { value: 'last-week', label: 'Last week' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
];

const FIXED_GROUP_DEFINITIONS: ReadonlyArray<{
  id: FixedRecordingDateGroupId;
  label: string;
}> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this-week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: 'this-month', label: 'This month' },
];

const TAG_DOT_COLORS = [
  'bg-cyan-600',
  'bg-yellow-600',
  'bg-purple-600',
  'bg-green-600',
  'bg-pink-600',
  'bg-blue-600',
] as const;

/**
 * Checks whether a recording falls inside a calendar preset.
 * Weeks start on Monday, and completed periods use an exclusive upper bound.
 *
 * @example
 * isRecordingInDatePreset(startedAt, 'this-week', now); // true
 */
export function isRecordingInDatePreset(
  startedAt: number,
  preset: RecordingDatePreset,
  now = new Date(),
): boolean {
  if (preset === 'all-time') return true;

  const recordingDate = new Date(startedAt);
  const thisWeekStartedAt = startOfWeek(now, { weekStartsOn: 1 });
  const thisMonthStartedAt = startOfMonth(now);

  switch (preset) {
    case 'today':
      return recordingDate >= startOfDay(now) && recordingDate <= now;
    case 'this-week':
      return recordingDate >= thisWeekStartedAt && recordingDate <= now;
    case 'last-week':
      return recordingDate >= subWeeks(thisWeekStartedAt, 1) && recordingDate < thisWeekStartedAt;
    case 'this-month':
      return recordingDate >= thisMonthStartedAt && recordingDate <= now;
    case 'last-month':
      return (
        recordingDate >= subMonths(thisMonthStartedAt, 1) && recordingDate < thisMonthStartedAt
      );
  }
}

export function getRecordingDatePresetLabel(preset: RecordingDatePreset): string {
  return RECORDING_DATE_PRESETS.find(option => option.value === preset)?.label ?? 'All time';
}

/**
 * Groups a newest-first recording list without sorting or discarding entries.
 * More specific calendar periods take precedence over broader ones.
 *
 * @example
 * groupRecordingsByDate(recordings, now).map(group => group.label);
 * // ['Today', 'This week', 'June 2026']
 */
export function groupRecordingsByDate(
  recordings: OatsRecordingEntry[],
  now = new Date(),
): RecordingDateGroup[] {
  const todayStartedAt = startOfDay(now);
  const yesterday = subDays(todayStartedAt, 1);
  const thisWeekStartedAt = startOfWeek(todayStartedAt, { weekStartsOn: 1 }).getTime();
  const lastWeekStartedAt = subWeeks(thisWeekStartedAt, 1).getTime();
  const thisMonthStartedAt = startOfMonth(todayStartedAt).getTime();

  const fixedGroups = new Map<FixedRecordingDateGroupId, OatsRecordingEntry[]>(
    FIXED_GROUP_DEFINITIONS.map(({ id }) => [id, []]),
  );
  const previousMonthGroups = new Map<string, OatsRecordingEntry[]>();

  for (const recording of recordings) {
    const startedAt = new Date(recording.startedAt);
    let fixedGroupId: FixedRecordingDateGroupId | null = null;

    if (isSameDay(startedAt, todayStartedAt)) {
      fixedGroupId = 'today';
    } else if (isSameDay(startedAt, yesterday)) {
      fixedGroupId = 'yesterday';
    } else if (recording.startedAt >= thisWeekStartedAt) {
      fixedGroupId = 'this-week';
    } else if (recording.startedAt >= lastWeekStartedAt) {
      fixedGroupId = 'last-week';
    } else if (recording.startedAt >= thisMonthStartedAt) {
      fixedGroupId = 'this-month';
    }

    if (fixedGroupId) {
      fixedGroups.get(fixedGroupId)?.push(recording);
      continue;
    }

    const monthKey = format(startedAt, 'yyyy-MM');
    const monthRecordings = previousMonthGroups.get(monthKey);
    if (monthRecordings) {
      monthRecordings.push(recording);
    } else {
      previousMonthGroups.set(monthKey, [recording]);
    }
  }

  const groups: RecordingDateGroup[] = FIXED_GROUP_DEFINITIONS.flatMap(({ id, label }) => {
    const groupedRecordings = fixedGroups.get(id) ?? [];
    return groupedRecordings.length > 0 ? [{ id, label, recordings: groupedRecordings }] : [];
  });

  for (const [monthKey, monthRecordings] of previousMonthGroups) {
    groups.push({
      id: `month-${monthKey}`,
      label: format(new Date(monthRecordings[0]!.startedAt), 'MMMM yyyy'),
      recordings: monthRecordings,
    });
  }

  return groups;
}

/**
 * Interleaves each date heading with its recording rows for the virtualized list.
 *
 * @example
 * buildRecordingListRows(groups).map(row => row.type);
 * ['group', 'recording', 'recording', 'group', 'recording']
 */
export function buildRecordingListRows(groups: RecordingDateGroup[]): RecordingListRow[] {
  return groups.flatMap<RecordingListRow>(group => [
    {
      id: `group-${group.id}`,
      type: 'group',
      label: group.label,
    },
    ...group.recordings.map(
      (recording): RecordingListRow => ({
        id: `recording-${recording.id}`,
        type: 'recording',
        recording,
      }),
    ),
  ]);
}

export function buildRecordingRows(recordings: OatsRecordingEntry[]): RecordingListRow[] {
  return buildRecordingListRows(groupRecordingsByDate(recordings));
}

/**
 * Applies the optional creator filter after the server has already enforced
 * the selected Created/Shared scope.
 */
export function filterRecordingsByOwnership(
  recordings: OatsRecordingEntry[],
  selectedCreatorId: string | null,
): OatsRecordingEntry[] {
  return selectedCreatorId
    ? recordings.filter(recording => recording.createdByUserId === selectedCreatorId)
    : recordings;
}

/**
 * Finds the closest recording row at or after a visible index, falling back to the row before it.
 *
 * @example
 * findNearestVisibleRecording(rows, 3); // Recording | undefined
 */
export function findNearestVisibleRecording(
  rows: RecordingListRow[],
  startIndex: number,
): OatsRecordingEntry | undefined {
  const row =
    rows.slice(startIndex).find(candidate => candidate.type === 'recording') ??
    rows
      .slice(0, startIndex)
      .reverse()
      .find(candidate => candidate.type === 'recording');

  return row?.type === 'recording' ? row.recording : undefined;
}

/**
 * Formats list timestamps with progressively broader context as recordings get older.
 *
 * @example
 * formatRecordingTimestamp(startedAt); // '5 minutes ago', 'Yesterday, 2:30 PM', or 'Mon, Jul 20'
 */
export function formatRecordingTimestamp(startedAt: number): string {
  const startedDate = new Date(startedAt);

  if (isToday(startedDate)) {
    return formatDistanceToNow(startedDate, { addSuffix: true });
  }
  if (isYesterday(startedDate)) {
    return format(startedDate, "'Yesterday,' h:mm a");
  }
  return format(startedDate, 'EEE, MMM d');
}

/**
 * Assigns the same palette color to a tag on every render using a stable string hash.
 *
 * @example
 * getRecordingTagDotColor('customer-call'); // e.g. 'bg-purple-600'
 */
export function getRecordingTagDotColor(tag: string): (typeof TAG_DOT_COLORS)[number] {
  let hash = 0;
  for (let index = 0; index < tag.length; index += 1) {
    hash = tag.charCodeAt(index) + ((hash << 5) - hash);
  }

  return TAG_DOT_COLORS[Math.abs(hash) % TAG_DOT_COLORS.length] ?? TAG_DOT_COLORS[0];
}

export function normalizeRecordingTags(tags: string[]): string[] {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
}
