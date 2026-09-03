/**
 * ETA Calculation Utilities
 * 
 * Calculate ETA deadlines and working duration considering configured working hours in IST
 * and skipping weekends. This code is shared between backend and dashboard.
 */

// IST is UTC+5:30
const IST_OFFSET_HOURS = 5.5;

/**
 * Safety cap on the day-stepping loops in `calculateETADeadline` and
 * `calculateWorkingDurationMs`. Both walk forward one working day at a
 * time, so a bogus or unbounded input (e.g. a multi-year estimate, or a
 * corrupted date range) could otherwise loop indefinitely.
 */
const MAX_WORKING_DAY_ITERATIONS = 1000;

/**
 * Working hours configuration interface
 */
export interface WorkingHoursConfig {
  start: number; // Start hour in IST (0-23)
  end: number;   // End hour in IST (0-23)
}

/**
 * Convert UTC Date to IST Date
 */
function utcToIST(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_HOURS * 60 * 60 * 1000);
}

/**
 * Convert IST Date back to UTC Date
 */
function istToUTC(date: Date): Date {
  return new Date(date.getTime() - IST_OFFSET_HOURS * 60 * 60 * 1000);
}

/**
 * Format for logging (IST)
 */
function formatIST(date: Date): string {
  const istDate = utcToIST(date);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[istDate.getUTCDay()]} ${istDate.getUTCHours()}:${istDate.getUTCMinutes().toString().padStart(2, '0')}`;
}

/**
 * Check if a date is a weekend (Saturday or Sunday) in IST
 */
function isWeekend(date: Date): boolean {
  const istDate = utcToIST(date);
  const day = istDate.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Get remaining working hours in IST for today
 */
function getRemainingWorkingHoursToday(
  utcDate: Date,
  config: WorkingHoursConfig
): number {
  const istDate = utcToIST(utcDate);
  const currentHourIST = istDate.getUTCHours();
  const currentMinuteIST = istDate.getUTCMinutes();
  const workingHoursPerDay = config.end - config.start;

  if (currentHourIST < config.start) {
    return workingHoursPerDay;
  }

  if (currentHourIST >= config.end) {
    return 0;
  }

  const hoursRemaining = config.end - currentHourIST;
  const minutesRemaining = currentMinuteIST / 60;
  return hoursRemaining - minutesRemaining;
}

/**
 * Move date to start of next working day (in IST)
 * Skips weekends - if next day is weekend, moves to Monday
 */
function moveToNextWorkingDay(date: Date, config: WorkingHoursConfig): Date {
  const istDate = utcToIST(date);
  istDate.setUTCDate(istDate.getUTCDate() + 1);
  istDate.setUTCHours(config.start, 0, 0, 0);

  while (istDate.getUTCDay() === 0 || istDate.getUTCDay() === 6) {
    istDate.setUTCDate(istDate.getUTCDate() + 1);
  }

  return istToUTC(istDate);
}

/**
 * Move date to start of current working day (in IST)
 */
function moveToCurrentWorkingDayStart(date: Date, config: WorkingHoursConfig): Date {
  const istDate = utcToIST(date);
  istDate.setUTCHours(config.start, 0, 0, 0);
  return istToUTC(istDate);
}

/**
 * Skip weekends and move to next working day
 */
function skipWeekends(date: Date, config: WorkingHoursConfig): Date {
  let current = new Date(date);
  let iterations = 0;
  const MAX_ITERATIONS = 10; // Safety limit

  while (isWeekend(current) && iterations < MAX_ITERATIONS) {
    current = moveToNextWorkingDay(current, config);
    current = moveToCurrentWorkingDayStart(current, config);
    iterations++;
  }

  if (iterations >= MAX_ITERATIONS) {
    throw new Error('Maximum iterations reached in skipWeekends - possible infinite loop');
  }

  return current;
}

/**
 * Calculate ETA deadline based on working hours (IST)
 *
 * @param assignedAt - When the ticket was assigned (UTC)
 * @param totalEtaHours - Total hours estimated for all stages
 * @param config - Working hours configuration
 * @returns Date - The calculated ETA deadline (UTC)
 */
export function calculateETADeadline(
  assignedAt: Date,
  totalEtaHours: number,
  config: WorkingHoursConfig
): Date {
  if (totalEtaHours <= 0) {
    return new Date(assignedAt);
  }

  const workingHoursPerDay = config.end - config.start;

  let remainingHours = totalEtaHours;
  let current = new Date(assignedAt);

  // If assigned on weekend, start from Monday
  if (isWeekend(current)) {
    current = skipWeekends(current, config);
  }

  const istDate = utcToIST(current);

  // If assigned after working hours, start from next day
  if (istDate.getUTCHours() >= config.end) {
    current = moveToNextWorkingDay(current, config);
  }

  // If assigned before working hours, adjust to start of day
  if (istDate.getUTCHours() < config.start) {
    current = moveToCurrentWorkingDayStart(current, config);
  }

  current = skipWeekends(current, config);

  // Calculate remaining hours for first day
  const firstDayRemaining = getRemainingWorkingHoursToday(current, config);

  if (remainingHours <= firstDayRemaining) {
    const istForCalc = utcToIST(current);
    const totalMinutesNeeded = remainingHours * 60;
    istForCalc.setUTCMinutes(istForCalc.getUTCMinutes() + totalMinutesNeeded);
    current = istToUTC(istForCalc);
    return current;
  }

  remainingHours -= firstDayRemaining;
  current = moveToNextWorkingDay(current, config);
  current = skipWeekends(current, config);

  // Leaves remainingHours in (0, workingHoursPerDay] rather than consuming every full day, so
  // an exact multi-day estimate pins to the end of the last working day instead of the start
  // of the next - matching how a single exact day is pinned above.
  let dayIterations = 0;
  while (remainingHours > workingHoursPerDay) {
    if (dayIterations >= MAX_WORKING_DAY_ITERATIONS) {
      throw new Error(
        'Maximum iterations reached in calculateETADeadline - possible infinite loop'
      );
    }
    remainingHours -= workingHoursPerDay;
    current = moveToNextWorkingDay(current, config);
    dayIterations++;
  }

  if (remainingHours === workingHoursPerDay) {
    // Estimate exactly fills this day - pin to end of working day.
    const istForCalc = utcToIST(current);
    istForCalc.setUTCHours(config.end, 0, 0, 0);
    current = istToUTC(istForCalc);
  } else if (remainingHours > 0) {
    const istForPartial = utcToIST(current);
    const totalMinutesNeeded = remainingHours * 60;
    istForPartial.setUTCMinutes(istForPartial.getUTCMinutes() + totalMinutesNeeded);
    current = istToUTC(istForPartial);
  }

  current = skipWeekends(current, config);

  return current;
}

/**
 * Calculate effective working duration between two timestamps (UTC) in milliseconds,
 * considering configured working hours in IST and skipping weekends.
 */
export function calculateWorkingDurationMs(
  startUtc: Date,
  endUtc: Date,
  config: WorkingHoursConfig
): number {
  if (endUtc <= startUtc) return 0;

  let current = new Date(startUtc);
  const end = new Date(endUtc);
  let totalMs = 0;
  let iterations = 0;

  while (current < end && iterations < MAX_WORKING_DAY_ITERATIONS) {
    iterations++;

    // 1. Skip weekends
    if (isWeekend(current)) {
      current = moveToNextWorkingDay(current, config);
      current = moveToCurrentWorkingDayStart(current, config);
      continue;
    }

    const currentIst = utcToIST(current);
    const endIst = utcToIST(end);

    const dayStartIst = new Date(currentIst);
    dayStartIst.setUTCHours(config.start, 0, 0, 0);

    const dayEndIst = new Date(currentIst);
    dayEndIst.setUTCHours(config.end, 0, 0, 0);

    // 2. Snap to Start if before working hours
    if (currentIst < dayStartIst) {
      current = istToUTC(dayStartIst);
      continue;
    }

    // 3. Jump to Next Day if after working hours
    if (currentIst >= dayEndIst) {
      current = moveToNextWorkingDay(current, config);
      // Ensure we don't land on a weekend immediately
      current = skipWeekends(current, config);
      continue;
    }

    // 4. Calculate Duration for the current segment
    const segmentEndIst = endIst < dayEndIst ? endIst : dayEndIst;
    if (segmentEndIst > currentIst) {
      totalMs += segmentEndIst.getTime() - currentIst.getTime();
    }

    // 5. Logic Correction:
    // If the 'end' date is within today's shift, we stop here.
    // Otherwise, move to the next day to continue the calculation.
    if (endIst <= dayEndIst) {
      break;
    } else {
      current = moveToNextWorkingDay(current, config);
      current = skipWeekends(current, config);
    }
  }

  if (iterations >= MAX_WORKING_DAY_ITERATIONS) {
    throw new Error(
      `Maximum iterations reached in calculateWorkingDurationMs - possible infinite loop. Range: ${startUtc.toISOString()} to ${endUtc.toISOString()}`
    );
  }

  return totalMs;
}

/**
 * Get working hours configuration for debugging/display
 */
export function getWorkingHoursConfig(config: WorkingHoursConfig): {
  start: number;
  end: number;
  perDay: number;
  offset: number;
} {
  return {
    start: config.start,
    end: config.end,
    perDay: config.end - config.start,
    offset: IST_OFFSET_HOURS,
  };
}
