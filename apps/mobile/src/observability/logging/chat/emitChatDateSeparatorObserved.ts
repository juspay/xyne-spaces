import { flushRemoteLogs, logger as structuredLogger } from '../appLogger';
import type { AppLogEventMap } from '../events';

export type DateSeparatorSurface =
  'channel-inline' | 'channel-floating' | 'thread-inline' | 'thread-floating';

export type DateSeparatorPhase = 'initial-open' | 'interaction';

export type DateSeparatorLayout = Readonly<{
  width: number;
  height: number;
}>;

export type DateSeparatorObservation = Readonly<{
  surface: DateSeparatorSurface;
  phase: DateSeparatorPhase;
  channelId: string;
  conversationId: string | null;
  boundaryId: string | null;
  createdAtMs: number | null;
  formattedLabel: string;
  layout: DateSeparatorLayout;
  screenWidthDp: number;
  fontScale: number;
}>;

export type DateSeparatorObservationRecorder = Readonly<{
  record: (observation: DateSeparatorObservation) => void;
  reset: () => void;
}>;

type DateSeparatorLogFields = AppLogEventMap['chat_date_separator_observed'];
type DateSeparatorLogWriter = (level: 'info' | 'warn', fields: DateSeparatorLogFields) => void;

const MAX_PRIORITY_OBSERVATIONS_PER_SCREEN = 8;
const MAX_LONG_DATE_OBSERVATIONS_PER_SCREEN = 16;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const WEEKDAY_PATTERN = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/;
const DAY_PATTERN = /\b\d{1,2}\b/;

type TimestampStatus = 'valid-ms' | 'seconds-like' | 'invalid';
type LabelShape =
  | 'relative'
  | 'weekday-day-month'
  | 'weekday-month-day'
  | 'weekday-day-only'
  | 'unavailable'
  | 'empty'
  | 'other';

const roundForTelemetry = (value: number, fractionDigits: number): number => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** fractionDigits;
  return Math.round(value * factor) / factor;
};

const getTimestampStatus = (createdAtMs: number | null): TimestampStatus => {
  if (createdAtMs === null || !Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    return 'invalid';
  }
  if (createdAtMs >= 1_000_000_000 && createdAtMs < 100_000_000_000) {
    return 'seconds-like';
  }
  return Number.isFinite(new Date(createdAtMs).getTime()) ? 'valid-ms' : 'invalid';
};

const getLabelShape = (formattedLabel: string): LabelShape => {
  const label = formattedLabel.trim();
  if (label.length === 0) return 'empty';
  if (label === 'Date unavailable') return 'unavailable';
  if (label === 'Today' || label === 'Yesterday') return 'relative';

  const hasWeekday = WEEKDAY_PATTERN.test(label);
  const hasDay = DAY_PATTERN.test(label);
  const monthIndex = MONTH_NAMES.findIndex(month => label.includes(month));
  if (hasWeekday && hasDay && monthIndex >= 0) {
    const monthName = MONTH_NAMES[monthIndex];
    if (monthName === undefined) return 'other';
    const dayIndex = label.search(DAY_PATTERN);
    return dayIndex < label.indexOf(monthName) ? 'weekday-day-month' : 'weekday-month-day';
  }
  if (hasWeekday && hasDay) return 'weekday-day-only';
  return 'other';
};

const getObservationKey = (
  observation: DateSeparatorObservation,
  measurementStatus: 'measured' | 'zero-size',
): string =>
  [
    observation.surface,
    observation.boundaryId ?? String(observation.createdAtMs ?? 'unknown'),
    measurementStatus,
  ].join(':');

const getBoundaryKey = (observation: DateSeparatorObservation): string =>
  [
    observation.surface,
    observation.boundaryId ?? String(observation.createdAtMs ?? 'unknown'),
  ].join(':');

const writeStructuredDateSeparatorLog: DateSeparatorLogWriter = (level, fields): void => {
  if (level === 'warn') {
    structuredLogger.warn('chat_date_separator_observed', fields);
    void flushRemoteLogs().catch(() => {
      // A diagnostic flush failure must not create an unhandled rejection or
      // interfere with the chat UI; the transport keeps the batch for retry.
    });
    return;
  }
  structuredLogger.info('chat_date_separator_observed', fields);
};

export const createDateSeparatorObservationRecorder = (
  writeLog: DateSeparatorLogWriter = writeStructuredDateSeparatorLog,
): DateSeparatorObservationRecorder => {
  const emittedBaselineSurfaces = new Set<DateSeparatorSurface>();
  const emittedPriorityKeys = new Set<string>();
  const emittedLongDateKeys = new Set<string>();
  let priorityObservationCount = 0;
  let longDateObservationCount = 0;

  const reset = (): void => {
    emittedBaselineSurfaces.clear();
    emittedPriorityKeys.clear();
    emittedLongDateKeys.clear();
    priorityObservationCount = 0;
    longDateObservationCount = 0;
  };

  const record = (observation: DateSeparatorObservation): void => {
    const createdAtMs =
      typeof observation.createdAtMs === 'number' && Number.isFinite(observation.createdAtMs)
        ? observation.createdAtMs
        : null;
    const formattedLabel = observation.formattedLabel.trim();
    const timestampStatus = getTimestampStatus(createdAtMs);
    const labelShape = getLabelShape(formattedLabel);
    const measurementStatus =
      observation.layout.width > 0 && observation.layout.height > 0 ? 'measured' : 'zero-size';

    const priority =
      timestampStatus !== 'valid-ms' ||
      labelShape === 'empty' ||
      labelShape === 'unavailable' ||
      labelShape === 'weekday-day-only' ||
      measurementStatus === 'zero-size';
    const longDateLabel = labelShape === 'weekday-day-month' || labelShape === 'weekday-month-day';
    const key = getObservationKey(observation, measurementStatus);
    const boundaryKey = getBoundaryKey(observation);
    let reason: DateSeparatorLogFields['reason'];
    if (priority) {
      if (
        emittedPriorityKeys.has(key) ||
        priorityObservationCount >= MAX_PRIORITY_OBSERVATIONS_PER_SCREEN
      ) {
        return;
      }
      emittedPriorityKeys.add(key);
      priorityObservationCount += 1;
      reason = 'anomaly';
    } else {
      if (!emittedBaselineSurfaces.has(observation.surface)) {
        emittedBaselineSurfaces.add(observation.surface);
        if (longDateLabel) {
          emittedLongDateKeys.add(boundaryKey);
          longDateObservationCount += 1;
        }
        reason = 'baseline';
      } else {
        if (
          !longDateLabel ||
          emittedLongDateKeys.has(boundaryKey) ||
          longDateObservationCount >= MAX_LONG_DATE_OBSERVATIONS_PER_SCREEN
        ) {
          return;
        }
        emittedLongDateKeys.add(boundaryKey);
        longDateObservationCount += 1;
        reason = 'long-date-boundary';
      }
    }

    const fields = {
      surface: observation.surface,
      phase: observation.phase,
      reason,
      channelId: observation.channelId,
      conversationId: observation.conversationId,
      boundaryId: observation.boundaryId,
      createdAtMs,
      timestampStatus,
      formattedLabel,
      labelShape,
      measurementStatus,
      badgeWidthDp: roundForTelemetry(observation.layout.width, 1),
      badgeHeightDp: roundForTelemetry(observation.layout.height, 1),
      screenWidthDp: roundForTelemetry(observation.screenWidthDp, 1),
      fontScale: roundForTelemetry(observation.fontScale, 2),
    } as const;

    writeLog(priority ? 'warn' : 'info', fields);
  };

  return { record, reset };
};
