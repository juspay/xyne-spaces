import { RotationInterval } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Get the number of days for a given rotation interval
 */
export function getIntervalDays(interval: RotationInterval): number {
  switch (interval) {
    case RotationInterval.WEEKLY:
      return 7;
    case RotationInterval.BIWEEKLY:
      return 14;
    case RotationInterval.MONTHLY:
      return 30;
    default:
      return 7;
  }
}

function getSetNumbers(mapping: { onCallSetNumbers?: number[] | null }): number[] {
  if (mapping.onCallSetNumbers && mapping.onCallSetNumbers.length > 0) {
    return mapping.onCallSetNumbers;
  }
  return [1];
}

/**
 * Get the total number of sets for a user group
 * Returns the max onCallSetNumber, defaulting to 1 if no mappings exist
 */
export async function getTotalSets(userGroupId: string): Promise<number> {
  const prisma = DatabaseClient.getInstance();
  const mappings = await prisma.userGroupMapping.findMany({
    where: { userGroupId },
    select: { onCallSetNumbers: true },
  });

  let maxSet = 1;
  for (const mapping of mappings) {
    const setNumbers = getSetNumbers(mapping);
    for (const n of setNumbers) {
      if (n > maxSet) maxSet = n;
    }
  }
  return maxSet;
}

/**
 * Calculate the current active set based on start date, total sets, and interval
 */
export function calculateActiveSet(
  rotationStartDate: Date,
  totalSets: number,
  interval: RotationInterval,
  preCalculatedDaysElapsed?: number
): number {
  const intervalDays = getIntervalDays(interval);
  const daysElapsed = preCalculatedDaysElapsed ?? Math.round((Date.now() - rotationStartDate.getTime()) / MS_PER_DAY);
  const intervalsElapsed = Math.floor(daysElapsed / intervalDays);

  return (intervalsElapsed % totalSets) + 1;
}

/**
 * Apply rotation for a specific target set in a user group.
 * Sets onCall=true for users in the target set (if isActiveForAssignment is true),
 * and onCall=false for all other users.
 * @returns The number of users whose onCall status was updated
 */
export async function applyRotationForSet(
  userGroupId: string,
  targetSet: number
): Promise<number> {
  const prisma = DatabaseClient.getInstance();

  // Fetch all user group mappings with their assignment states
  const mappings = await prisma.userGroupMapping.findMany({
    where: { userGroupId },
    include: {
      user: {
        include: {
          userAssignmentStates: {
            where: { userGroupId },
          },
        },
      },
    },
  });

  // Process each user
  let updatedCount = 0;
  for (const mapping of mappings) {
    const userSetNumbers = getSetNumbers(mapping);
    const assignmentState = mapping.user.userAssignmentStates[0];

    if (!assignmentState) continue;

    const shouldBeOnCall = userSetNumbers.includes(targetSet) && assignmentState.isActiveForAssignment;

    // Update only if changed
    if (assignmentState.onCall !== shouldBeOnCall) {
      await prisma.userAssignmentState.update({
        where: { id: assignmentState.id },
        data: { onCall: shouldBeOnCall },
      });
      updatedCount++;
    }
  }

  return updatedCount;
}

/**
 * Initialize rotation for a group - sets set 1 as onCall (called when rotation is first enabled)
 */
export async function initializeRotationForGroup(userGroupId: string): Promise<void> {
  logger.info(`[ON-CALL-ROTATION] Initializing rotation for group ${userGroupId}`);
  const updatedCount = await applyRotationForSet(userGroupId, 1);
  logger.info(`[ON-CALL-ROTATION] Initialized rotation for group ${userGroupId}: ${updatedCount} users updated`);
}