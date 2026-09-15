/**
 * SLA business-hours calculator.
 *
 * Given a start timestamp and a number of SLA hours, this utility computes the
 * deadline timestamp either using:
 *   - Calendar hours: simple addition of milliseconds, or
 *   - Business hours: only counts time between workdayStart and workdayEnd on
 *     Mon-Fri in the configured timezone.
 *
 * The workday is Mon-Fri (ISO day 1–5). Weekend days are skipped entirely.
 * The algorithm works by iterating minute-by-minute in the target timezone to
 * accumulate business minutes until the full SLA window is consumed. For
 * typical SLA values (≤ 200 business hours) this is fast enough (<5 ms).
 */

interface SlaPolicy {
  businessHoursOnly: boolean;
  timezone: string;       // IANA timezone e.g. "Asia/Kolkata"
  workdayStart: number;   // 0-23, e.g. 9 for 9 AM
  workdayEnd: number;     // 0-23, e.g. 18 for 6 PM (exclusive)
}

/**
 * Adds `hours` SLA hours to `start`, respecting the policy's calendar/business
 * hours mode and returns the resulting Date.
 */
export function addSlaHours(start: Date, hours: number, policy: SlaPolicy): Date {
  if (!policy.businessHoursOnly) {
    // Calendar hours: straight millisecond arithmetic
    return new Date(start.getTime() + hours * 60 * 60 * 1000);
  }

  return addBusinessHours(start, hours, policy);
}

/**
 * Returns the local hour (0-23) for a Date in the given IANA timezone.
 */
function getLocalHour(date: Date, timezone: string): number {
  // hourCycle: 'h23' forces the 0-23 range. Without it, some engines (notably
  // Safari) use h24 (1-24) and return "24" for midnight, which corrupts the
  // business-hour comparison below (24 >= workdayStart is always true).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  return parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
}

/**
 * Returns the local ISO weekday (1=Mon, 7=Sun) for a Date in the given timezone.
 */
function getLocalIsoWeekday(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).formatToParts(date);
  const day = parts.find(p => p.type === 'weekday')?.value;
  const map: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[day ?? 'Sun'] ?? 7;
}

/**
 * Core business-hours adder. Iterates forward in 15-minute increments to
 * accumulate the required business minutes. Uses 15-minute steps to keep
 * iteration counts low (max ~3200 steps for a 200-hour SLA).
 */
function addBusinessHours(start: Date, hours: number, policy: SlaPolicy): Date {
  const { timezone, workdayStart, workdayEnd } = policy;

  // Misconfigured policy — workdayEnd must be strictly greater than workdayStart.
  // Returning a calendar-hours fallback is safer than an infinite loop or garbage.
  if (workdayEnd <= workdayStart) {
    return new Date(start.getTime() + hours * 60 * 60 * 1000);
  }

  const minutesPerStep = 15;
  let remaining = hours * 60; // convert to minutes

  let current = new Date(start.getTime());

  // If the start is outside business hours, snap forward to next business window
  current = snapToNextBusinessMinute(current, timezone, workdayStart, workdayEnd);

  const maxIterations = Math.ceil((hours / (workdayEnd - workdayStart)) * 7) * 24 * 4 + 100;
  let iterations = 0;

  while (remaining > 0 && iterations < maxIterations) {
    iterations++;
    const localHour = getLocalHour(current, timezone);
    const isoWeekday = getLocalIsoWeekday(current, timezone);
    const isBusinessDay = isoWeekday >= 1 && isoWeekday <= 5;
    const isBusinessHour = localHour >= workdayStart && localHour < workdayEnd;

    if (isBusinessDay && isBusinessHour) {
      const minutesToConsume = Math.min(remaining, minutesPerStep);
      remaining -= minutesToConsume;
      current = new Date(current.getTime() + minutesToConsume * 60 * 1000);
    } else {
      // Skip to the next potential business window
      current = skipToNextBusinessWindow(current, timezone, workdayStart, workdayEnd);
    }
  }

  return current;
}

/**
 * If `date` is already in a business window, return it unchanged.
 * Otherwise advance to the start of the next business window (next Mon-Fri workdayStart).
 */
function snapToNextBusinessMinute(
  date: Date,
  timezone: string,
  workdayStart: number,
  workdayEnd: number,
): Date {
  let current = new Date(date.getTime());
  let guard = 0;
  while (guard++ < 1000) {
    const localHour = getLocalHour(current, timezone);
    const isoWeekday = getLocalIsoWeekday(current, timezone);
    const isBusinessDay = isoWeekday >= 1 && isoWeekday <= 5;
    const isBusinessHour = localHour >= workdayStart && localHour < workdayEnd;
    if (isBusinessDay && isBusinessHour) return current;
    current = skipToNextBusinessWindow(current, timezone, workdayStart, workdayEnd);
  }
  return current;
}

/**
 * Advances `date` past the current non-business period to the very start of the
 * next business window. Strategy:
 *  - If it's a weekday but after business hours → jump to next day's workdayStart
 *  - If it's a weekday but before business hours → jump to today's workdayStart
 *  - If it's a weekend → jump forward by 1 day at a time until Mon
 */
function skipToNextBusinessWindow(
  date: Date,
  timezone: string,
  workdayStart: number,
  workdayEnd: number,
): Date {
  const localHour = getLocalHour(date, timezone);
  const isoWeekday = getLocalIsoWeekday(date, timezone);

  if (isoWeekday >= 1 && isoWeekday <= 5) {
    if (localHour < workdayStart) {
      // Before start today — jump to workdayStart today
      return setLocalHour(date, timezone, workdayStart);
    } else {
      // After end today — jump to workdayStart tomorrow
      return setLocalHour(addDays(date, 1), timezone, workdayStart);
    }
  } else {
    // Weekend — advance one day and retry
    return skipToNextBusinessWindow(addDays(date, 1), timezone, workdayStart, workdayEnd);
  }
}

/** Returns a new Date that is `n` whole days after `date` (UTC midnight-safe). */
function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * 24 * 60 * 60 * 1000);
}

/**
 * Returns a new Date that represents the given local hour (minute=0, second=0)
 * of the same local calendar day as `date` in `timezone`.
 *
 * Implementation: format the local date string, rebuild at the target hour,
 * then parse back to UTC via Intl.
 */
function setLocalHour(date: Date, timezone: string, hour: number): Date {
  // Format the local date parts
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value ?? '2000';
  const month = parts.find(p => p.type === 'month')?.value ?? '01';
  const day = parts.find(p => p.type === 'day')?.value ?? '01';

  // Build an ISO-like string in the target timezone and convert back to UTC
  // by using a trick: create a Date as if the string is UTC, then correct for offset
  return localToUtc(year, month, day, hour, 0, 0, timezone);
}

/**
 * Convert a local wall-clock time (year, month, day, hour, minute, second) in
 * `timezone` to a UTC Date. Uses a Newton-step iteration on the Intl formatter
 * (accurate to ±1 second, capped at 10 iterations).
 */
function localToUtc(
  year: string,
  month: string,
  day: string,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): Date {
  const target = new Date(`${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}Z`);

  // Start with a naive UTC guess, then nudge based on the observed offset
  let guess = target.getTime();

  for (let i = 0; i < 5; i++) {
    const d = new Date(guess);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);

    const ly = parseInt(parts.find(p => p.type === 'year')?.value ?? '0', 10);
    const lm = parseInt(parts.find(p => p.type === 'month')?.value ?? '0', 10) - 1;
    const ld = parseInt(parts.find(p => p.type === 'day')?.value ?? '0', 10);
    const lh = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const lmin = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
    const ls = parseInt(parts.find(p => p.type === 'second')?.value ?? '0', 10);

    const localMs = Date.UTC(ly, lm, ld, lh, lmin, ls);
    const targetMs = Date.UTC(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      hour,
      minute,
      second,
    );

    const diff = localMs - targetMs;
    if (Math.abs(diff) < 1000) break;
    guess -= diff;
  }

  return new Date(guess);
}

/**
 * Compute both SLA deadlines (response + resolution) for a ticket.
 * Returns null for either if the corresponding policy field is 0 or falsy.
 */
export function computeSlaDueDates(
  receivedAt: Date,
  policy: SlaPolicy & { responseHours: number; resolutionHours: number },
): { slaResponseDue: Date | null; slaResolutionDue: Date | null } {
  const slaResponseDue =
    policy.responseHours > 0
      ? addSlaHours(receivedAt, policy.responseHours, policy)
      : null;

  const slaResolutionDue =
    policy.resolutionHours > 0
      ? addSlaHours(receivedAt, policy.resolutionHours, policy)
      : null;

  return { slaResponseDue, slaResolutionDue };
}
