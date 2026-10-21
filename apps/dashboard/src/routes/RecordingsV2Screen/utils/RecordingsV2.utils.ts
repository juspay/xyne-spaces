import {
  format,
  formatDistanceToNow,
  isToday,
  isYesterday,
  startOfDay,
  startOfMonth,
  startOfWeek,
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
