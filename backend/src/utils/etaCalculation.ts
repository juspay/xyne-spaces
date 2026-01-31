import { logger } from './logger';
import { config } from '@/config/env';

// IST is UTC+5:30
const IST_OFFSET_HOURS = 5.5;

// Working hours from config (in IST)
const WORKING_HOUR_START_IST = config.workingHours.start;
const WORKING_HOUR_END_IST = config.workingHours.end;
const WORKING_HOURS_PER_DAY = WORKING_HOUR_END_IST - WORKING_HOUR_START_IST;

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
function getRemainingWorkingHoursToday(utcDate: Date): number {
  const istDate = utcToIST(utcDate);
  const currentHourIST = istDate.getUTCHours();
  const currentMinuteIST = istDate.getUTCMinutes();

  if (currentHourIST < WORKING_HOUR_START_IST) {
    return WORKING_HOURS_PER_DAY;
  }

  if (currentHourIST >= WORKING_HOUR_END_IST) {
    return 0;
  }

  const hoursRemaining = WORKING_HOUR_END_IST - currentHourIST;
  const minutesRemaining = currentMinuteIST / 60;
  return hoursRemaining - minutesRemaining;
}

/**
 * Move date to start of next working day (in IST)
 * Skips weekends - if next day is weekend, moves to Monday
 */
function moveToNextWorkingDay(date: Date): Date {
  const istDate = utcToIST(date);
  istDate.setUTCDate(istDate.getUTCDate() + 1);
  istDate.setUTCHours(WORKING_HOUR_START_IST, 0, 0, 0);

  while (istDate.getUTCDay() === 0 || istDate.getUTCDay() === 6) {
    istDate.setUTCDate(istDate.getUTCDate() + 1);
  }

  return istToUTC(istDate);
}

/**
 * Move date to start of current working day (in IST)
 */
function moveToCurrentWorkingDayStart(date: Date): Date {
  const istDate = utcToIST(date);
  istDate.setUTCHours(WORKING_HOUR_START_IST, 0, 0, 0);
  return istToUTC(istDate);
}

/**
 * Skip weekends and move to next working day
 */
function skipWeekends(date: Date): Date {
  let current = new Date(date);
  while (isWeekend(current)) {
    current = moveToNextWorkingDay(current);
    current = moveToCurrentWorkingDayStart(current);
  }
  return current;
}

/**
 * Calculate ETA deadline based on working hours (IST)
 *
 * @param assignedAt - When the ticket was assigned (UTC)
 * @param totalEtaHours - Total hours estimated for all stages
 * @returns Date - The calculated ETA deadline (UTC)
 */
export function calculateETADeadline(assignedAt: Date, totalEtaHours: number): Date {
  if (totalEtaHours <= 0) {
    return new Date(assignedAt);
  }

  logger.info(`[ETA] Assigned=${formatIST(assignedAt)}, TotalHours=${totalEtaHours}, WorkingHours=${WORKING_HOUR_START_IST}-${WORKING_HOUR_END_IST} IST`);

  let remainingHours = totalEtaHours;
  let current = new Date(assignedAt);

  // If assigned on weekend, start from Monday
  if (isWeekend(current)) {
    current = skipWeekends(current);
    logger.info(`[ETA] Weekend assignment, start=${formatIST(current)}`);
  }

  const istDate = utcToIST(current);

  // If assigned after working hours, start from next day
  if (istDate.getUTCHours() >= WORKING_HOUR_END_IST) {
    current = moveToNextWorkingDay(current);
    logger.info(`[ETA] After hours, start=${formatIST(current)}`);
  }

  // If assigned before working hours, adjust to start of day
  if (istDate.getUTCHours() < WORKING_HOUR_START_IST) {
    current = moveToCurrentWorkingDayStart(current);
    logger.info(`[ETA] Before hours, start=${formatIST(current)}`);
  }

  current = skipWeekends(current);

  // Calculate remaining hours for first day
  const firstDayRemaining = getRemainingWorkingHoursToday(current);

  if (remainingHours <= firstDayRemaining) {
    const istForCalc = utcToIST(current);
    const totalMinutesNeeded = remainingHours * 60;
    istForCalc.setUTCMinutes(istForCalc.getUTCMinutes() + totalMinutesNeeded);
    current = istToUTC(istForCalc);
    logger.info(`[ETA] ETA=${formatIST(current)} (same day)`);
    return current;
  }

  remainingHours -= firstDayRemaining;
  current = moveToNextWorkingDay(current);
  current = skipWeekends(current);

  // Calculate full working days needed
  const fullDaysNeeded = Math.floor(remainingHours / WORKING_HOURS_PER_DAY);
  if (fullDaysNeeded > 0) {
    let workingDaysAdded = 0;
    while (workingDaysAdded < fullDaysNeeded) {
      current = moveToNextWorkingDay(current);
      workingDaysAdded++;
    }
    remainingHours -= fullDaysNeeded * WORKING_HOURS_PER_DAY;
  }

  // Handle remaining partial day
  if (remainingHours > 0) {
    const istForPartial = utcToIST(current);
    const totalMinutesNeeded = remainingHours * 60;
    istForPartial.setUTCMinutes(istForPartial.getUTCMinutes() + totalMinutesNeeded);
    current = istToUTC(istForPartial);
  }

  current = skipWeekends(current);

  logger.info(`[ETA] ETA=${formatIST(current)}`);
  return current;
}

/**
 * Get working hours configuration for debugging/display
 */
export function getWorkingHoursConfig(): { start: number; end: number; perDay: number; offset: number } {
  return {
    start: WORKING_HOUR_START_IST,
    end: WORKING_HOUR_END_IST,
    perDay: WORKING_HOURS_PER_DAY,
    offset: IST_OFFSET_HOURS,
  };
}
