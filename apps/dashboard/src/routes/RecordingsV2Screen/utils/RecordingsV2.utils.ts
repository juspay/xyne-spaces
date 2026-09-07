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
import { CallStatus } from '@xyne/shared';
import type { User } from '@xyne/shared/machines';
import type { OatsRecordingEntry } from '../../../hooks/usePaginatedOatsRecordings';
import type { RecordingTitleInput } from '../../../utils/recordingUtils';
import { getUserDisplayName } from '../../../utils/userDisplayName';

export type RecordingDatePreset =
  | 'all-time'
  | 'today'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month';

export type RecordingOwnershipTab = 'all' | 'created' | 'shared';

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
 * the selected Created/Shared scope. An empty list means "every creator".
 *
 * @example
 * filterRecordingsByOwnership(recordings, ['user-1', 'user-2']);
 */
export function filterRecordingsByOwnership(
  recordings: OatsRecordingEntry[],
  selectedCreatorIds: string[],
): OatsRecordingEntry[] {
  if (selectedCreatorIds.length === 0) return recordings;

  const wanted = new Set(selectedCreatorIds);
  return recordings.filter(recording => wanted.has(recording.createdByUserId));
}

/**
 * Renders the people a recording is about: "Just you", "Alice", "Alice & you",
 * "Alice, Bob & 2 others".
 */
export function formatRecordingParticipants(
  participantIds: string[],
  usersById: Map<string, User>,
  currentUserId: string | undefined,
): string {
  const names: string[] = [];
  let includesSelf = false;

  for (const id of participantIds) {
    if (id === currentUserId) {
      includesSelf = true;
      continue;
    }
    const user = usersById.get(id);
    if (user) names.push(getUserDisplayName(user));
  }
  if (includesSelf) names.push('you');

  const [first, second, ...rest] = names;
  if (first === undefined) return 'Unknown creator';
  if (second === undefined) return includesSelf ? 'Just you' : first;
  if (rest.length === 0) return `${first} & ${second}`;
  return `${first}, ${second} & ${rest.length} ${rest.length === 1 ? 'other' : 'others'}`;
}

/**
 * Keeps recordings carrying at least one of the selected labels, so picking more
 * labels widens the result set rather than narrowing it.
 *
 * @example
 * filterRecordingsByLabels(recordings, ['infra']);
 */
export function filterRecordingsByLabels(
  recordings: OatsRecordingEntry[],
  selectedLabels: string[],
): OatsRecordingEntry[] {
  if (selectedLabels.length === 0) return recordings;

  const wanted = new Set(selectedLabels);
  return recordings.filter(recording => recording.labels.some(label => wanted.has(label)));
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

export function toRecordingTitleInput(
  recording: Pick<OatsRecordingEntry, 'title' | 'status' | 'endedAt' | 'aiSummary' | 'transcript'>,
): RecordingTitleInput {
  return {
    title: recording.title,
    isEnded: recording.status === CallStatus.ENDED,
    endedAtMs: recording.endedAt,
    hasTranscript: !!recording.transcript?.trim(),
    hasSummary: !!recording.aiSummary,
  };
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
 * A recording's quick `aiSummary` is generated asynchronously by the AI pipeline
 * after the call ends (see `call.trigger.ts`: "aiSummary and transcript are
 * generated asynchronously after the call ends"). While it is in flight the row
 * shows a small loader instead of blank space.
 *
 * The window is bounded so recordings that predate summaries — or whose
 * generation silently failed — don't strand the loader forever: past the window
 * with no summary, the row simply shows nothing.
 */
export const SUMMARY_GENERATING_WINDOW_MS = 15 * 60 * 1000;

export function isRecordingSummaryGenerating(
  recording: Pick<OatsRecordingEntry, 'status' | 'endedAt' | 'aiSummary'>,
): boolean {
  if (recording.aiSummary?.trim()) return false;
  if (recording.status !== CallStatus.ENDED) return false;
  if (!recording.endedAt) return false;
  return Date.now() - recording.endedAt < SUMMARY_GENERATING_WINDOW_MS;
}

/**
 * Flattens the stored `aiSummary` (markdown or HTML) into a single plain-text
 * line for the list preview. The row clamps it to two lines with CSS, so this
 * only needs to strip markup and collapse whitespace, not truncate.
 */
export function toRecordingSummaryPreview(summary: string | null | undefined): string {
  if (!summary) return '';
  return summary
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // md images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // md links -> link text
    .replace(/<[^>]+>/g, ' ') // html tags
    .replace(/[#>*_`~]+/g, ' ') // md emphasis / heading / quote markers
    .replace(/^\s*[-+]\s+/gm, ' ') // list bullets
    .replace(/\s+/g, ' ')
    .trim();
}
