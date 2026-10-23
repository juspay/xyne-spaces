export interface CallTimeErrors {
  startsAtError: string | null;
  endsAtError: string | null;
}

/**
 * Returns a new Date with the calendar date from `newDate` and the
 * hours/minutes from `existingDateTime`, so changing only the date
 * in the picker preserves the previously selected time.
 */
export function mergeDateWithTime(newDate: Date, existingDateTime?: Date | null): Date {
  const merged = new Date(newDate);
  if (existingDateTime) {
    merged.setHours(existingDateTime.getHours(), existingDateTime.getMinutes(), 0, 0);
  }
  return merged;
}

/**
 * Validates start/end Date values for a scheduled call.
 * - startsAt must be strictly in the future.
 * - endsAt must be strictly after startsAt.
 */
export function validateCallDateTimes(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
): CallTimeErrors {
  const now = new Date();
  let startsAtError: string | null = null;
  let endsAtError: string | null = null;

  if (startsAt && startsAt <= now) {
    startsAtError = 'Start date and time must be in the future';
  }

  if (startsAt && endsAt && endsAt <= startsAt) {
    endsAtError = 'End time must be after start time';
  }

  return { startsAtError, endsAtError };
}

/**
 * Validates HH:mm time strings for recurring call series.
 * Returns an error message if endTime is not after startTime, otherwise null.
 */
export function validateRecurringCallTimes(startTime: string, endTime: string): string | null {
  return endTime <= startTime ? 'End time must be after start time' : null;
}
