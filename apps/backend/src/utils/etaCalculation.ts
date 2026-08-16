/**
 * Backend wrapper for ETA calculation utilities.
 * Uses shared implementation from @xyne/shared .
 */

import {
  calculateETADeadline as sharedCalculateETADeadline,
  calculateWorkingDurationMs as sharedCalculateWorkingDurationMs,
  getWorkingHoursConfig as sharedGetWorkingHoursConfig,
} from '@xyne/shared';
import { logger } from './logger';
import { config } from '@/config/env';

// Working hours from config (in IST)
const workingHoursConfig = {
  start: config.workingHours.start,
  end: config.workingHours.end,
};

/**
 * Calculate ETA deadline based on working hours (IST)
 *
 * @param assignedAt - When the ticket was assigned (UTC)
 * @param totalEtaHours - Total hours estimated for all stages
 * @returns Date - The calculated ETA deadline (UTC)
 */
export function calculateETADeadline(assignedAt: Date, totalEtaHours: number): Date {
  const result = sharedCalculateETADeadline(assignedAt, totalEtaHours, workingHoursConfig);
  logger.info(`[ETA] Assigned=${assignedAt.toISOString()}, TotalHours=${totalEtaHours}, ETA=${result.toISOString()}`);
  return result;
}

/**
 * Calculate effective working duration between two timestamps (UTC) in milliseconds,
 * considering configured working hours in IST and skipping weekends.
 */
export function calculateWorkingDurationMs(startUtc: Date, endUtc: Date): number {
  return sharedCalculateWorkingDurationMs(startUtc, endUtc, workingHoursConfig);
}

/**
 * Get working hours configuration for debugging/display
 */
export function getWorkingHoursConfig(): { start: number; end: number; perDay: number; offset: number } {
  return sharedGetWorkingHoursConfig(workingHoursConfig);
}

/**
 * Recompute the overall Ticket.eta from the current stage's own deadline plus the hours
 * budgeted for stages still ahead of it, so Ticket.eta can never land before the current
 * stage's deadline (calculateETADeadline only ever moves forward in time).
 *
 * Returns null when neither the current stage nor any future stage has an ETA configured —
 * callers should leave Ticket.eta untouched in that case rather than overwriting it with `now`.
 */
export function recomputeOverallTicketEta(
  currentStageEta: Date,
  stageEnteredAt: Date,
  futureStagesEtaHours: number,
): Date | null {
  const currentStageHasEta = currentStageEta.getTime() > stageEnteredAt.getTime();
  if (!currentStageHasEta && futureStagesEtaHours <= 0) {
    return null;
  }
  return calculateETADeadline(currentStageEta, futureStagesEtaHours);
}
