/**
 * Dashboard wrapper for ETA calculation utilities.
 * Uses shared implementation from @xyne/shared.
 */

import {
  calculateETADeadline as sharedCalculateETADeadline,
  calculateWorkingDurationMs as sharedCalculateWorkingDurationMs,
} from '@xyne/shared';
import { WORKING_HOUR_START, WORKING_HOUR_END } from '../config';

// Working hours configuration (in IST)
const workingHoursConfig = {
  start: WORKING_HOUR_START,
  end: WORKING_HOUR_END,
};

/**
 * Calculate ETA deadline based on working hours (IST)
 *
 * @param assignedAt - When the ticket was assigned (UTC)
 * @param totalEtaHours - Total hours estimated for all stages
 * @returns Date - The calculated ETA deadline (UTC)
 */
export function calculateETADeadline(assignedAt: Date, totalEtaHours: number): Date {
  return sharedCalculateETADeadline(assignedAt, totalEtaHours, workingHoursConfig);
}

/**
 * Calculate effective working duration between two timestamps (UTC) in milliseconds,
 * considering configured working hours in IST and skipping weekends.
 */
export function calculateWorkingDurationMs(startUtc: Date, endUtc: Date): number {
  return sharedCalculateWorkingDurationMs(startUtc, endUtc, workingHoursConfig);
}
