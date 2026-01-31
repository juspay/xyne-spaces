import { repositories } from '@/database/repositories';
import { logger } from './logger';
import type {
  UserGroupMapping,
  UserExpertiseMapping,
  UserAssignmentState,
  UserWorkloadMapping,
} from '@prisma/client';

export interface AssignmentResult {
  assignedUserId?: string;
  reason?: 'NO_ON_CALL_USERS';
}

export interface AssignmentCandidate {
  userId: string;
  score: number;
  details?: Record<string, any>;
}

/**
 * Auto-assignment system that selects the most suitable user for a board or ticket.
 * Uses existing database tables only - no expression-based rules or configuration.
 *
 * Eligibility Flow (Filtering Phase):
 * 1. Fetch all users in the group
 * 2. Filter users where isActiveForAssignment = true AND onCall = true
 * 3. If no users found → Fallback to users where isActiveForAssignment = true (ignore onCall)
 * 4. If still no users → STOP (no auto-assignment)
 * 5. If board has expertise mappings: keep only users with expertise for the board
 *
 * Scoring Strategy (Ranking Phase):
 * For each user, calculate weighted workload across ALL boards:
 *   weightedActiveTasks = sum(activeTasks * boardWeight) for all boards
 * finalScore = weightedActiveTasks - expertiseBonus
 * expertiseBonus = 10 if user has expertise else 0
 *
 * Lower score = higher priority (fewer active tasks = more available).
 *
 * Returns: { assignedUserId } or { reason: "NO_ON_CALL_USERS" }
 */
export async function evaluateAssignmentRule(
  userGroupId: string,
  boardId: string
): Promise<AssignmentResult> {
  logger.info(`[Assignment] Evaluating for userGroupId: ${userGroupId}, boardId: ${boardId}`);

  // Fetch user group mappings
  const userGroupMappings = await repositories.userGroupMapping.findMany({
    where: { userGroupId },
  });

  if (userGroupMappings.length === 0) {
    logger.info(`[Assignment] No users in userGroupId: ${userGroupId}`);
    return { reason: 'NO_ON_CALL_USERS' };
  }

  const userIds = userGroupMappings.map((m: UserGroupMapping) => m.userId);

  // Get user assignment states and expertise mappings in parallel
  const [userStates, expertiseMappings] = await Promise.all([
    repositories.userAssignmentState.findMany({
      where: {
        userGroupId,
        userId: { in: userIds },
      },
    }),
    repositories.userExpertiseMapping.findMany({
      where: {
        userGroupId,
        boardId,
        userId: { in: userIds },
      },
    }),
  ]);

  // Store full mapping objects for scoring
  const expertiseMap = new Map<string, UserExpertiseMapping>(
    expertiseMappings.map((e: UserExpertiseMapping) => [e.userId, e])
  );


  // Helper to get user state
  const getUserState = (userId: string) => userStates.find((s: UserAssignmentState) => s.userId === userId);
  // Helper to get expertise
  const hasExpertiseForBoard = (userId: string) => expertiseMap.get(userId)?.hasExpertise === true;

  // 1. On-call + active + expertise
  let eligibleUserIds = userIds.filter(userId => {
    const state = getUserState(userId);
    return state?.isActiveForAssignment === true && state?.onCall === true && hasExpertiseForBoard(userId);
  });
  if (eligibleUserIds.length === 0) {
    // 2. On-call + active (any expertise)
    eligibleUserIds = userIds.filter(userId => {
      const state = getUserState(userId);
      return state?.isActiveForAssignment === true && state?.onCall === true;
    });
  }
  if (eligibleUserIds.length === 0) {
    // 3. Active + expertise
    eligibleUserIds = userIds.filter(userId => {
      const state = getUserState(userId);
      return state?.isActiveForAssignment === true && hasExpertiseForBoard(userId);
    });
  }
  if (eligibleUserIds.length === 0) {
    // 4. Active (any expertise)
    eligibleUserIds = userIds.filter(userId => {
      const state = getUserState(userId);
      return state?.isActiveForAssignment === true;
    });
  }
  if (eligibleUserIds.length === 0) {
    logger.info(`[Assignment] No eligible users (on-call or active) in userGroupId: ${userGroupId}`);
    return { reason: 'NO_ON_CALL_USERS' };
  }
  // At this point, eligibleUserIds is the best fallback group
  // If expertise mappings exist, sort so that expertise users are preferred
  if (expertiseMappings.length > 0) {
    eligibleUserIds = eligibleUserIds.sort((a, b) => {
      const aExpert = hasExpertiseForBoard(a) ? 1 : 0;
      const bExpert = hasExpertiseForBoard(b) ? 1 : 0;
      return bExpert - aExpert; // experts first
    });
  }
  const finalEligibleUserIds = eligibleUserIds;

  // Get workload mappings and board scores for ALL boards in this user group
  const [allWorkloadMappings, allBoardScores] = await Promise.all([
    repositories.userWorkloadMapping.findMany({
      where: {
        userGroupId,
        userId: { in: finalEligibleUserIds },
      },
    }),
    repositories.boardComplexityScore.findMany({
      where: { userGroupId },
    }),
  ]);

  // Create a map of board weights (default to 1 if not configured)
  const boardWeightMap = new Map<string, number>(
    allBoardScores.map(score => [score.boardId, score.weight])
  );

  // Aggregate WEIGHTED workload (active tasks only) across all boards for each user
  const workloadMap = new Map<string, number>();

  for (const userId of finalEligibleUserIds) {
    const userMappings = allWorkloadMappings.filter((w: UserWorkloadMapping) => w.userId === userId);
    
    let weightedActiveTasks = 0;
    
    for (const mapping of userMappings) {
      const weight = boardWeightMap.get(mapping.boardId) || 1;
      weightedActiveTasks += mapping.activeTasks * weight;
    }
    
    workloadMap.set(userId, weightedActiveTasks);
  }

  // Calculate scores for each eligible user, including percentage and maxTickets logic
  const candidates: AssignmentCandidate[] = [];

  // Get total tickets assigned for this board in this group
  const totalTicketsOnBoard = allWorkloadMappings
    .filter((w: UserWorkloadMapping) => w.boardId === boardId)
    .reduce((sum, w) => sum + (w.activeTasks || 0), 0);

  for (const userId of finalEligibleUserIds) {
    const weightedActiveTasks = workloadMap.get(userId) || 0;
    const expertiseMapping = expertiseMap.get(userId);
    const hasExpertise = expertiseMapping?.hasExpertise === true;
    const percentage = expertiseMapping?.percentage ?? 100;
    const maxTickets = expertiseMapping?.maxTickets ?? -1;

    // Tickets assigned to this user on this board
    const userWorkload = allWorkloadMappings.find(
      (w: UserWorkloadMapping) => w.userId === userId && w.boardId === boardId
    );
    const userTickets = userWorkload?.activeTasks || 0;

    // Current percentage of tickets assigned to this user on this board
    const currentPercent = totalTicketsOnBoard > 0 ? (userTickets / totalTicketsOnBoard) * 100 : 0;
    const percentDiff = percentage - currentPercent;

    // Scoring formula: weightedActiveTasks - expertiseBonus - percentDiff
    const expertiseBonus = hasExpertise ? 10 : 0;
    const score = weightedActiveTasks - expertiseBonus - percentDiff;

    candidates.push({
      userId,
      score,
      details: {
        weightedActiveTasks,
        expertiseBonus,
        hasExpertise,
        percentage,
        maxTickets,
        userTickets,
        currentPercent,
        percentDiff,
      },
    });
  }

  if (candidates.length === 0) {
    logger.info(`[Assignment] No eligible candidates for userGroupId: ${userGroupId}`);
    return { reason: 'NO_ON_CALL_USERS' };
  }

  // Sort by new score ascending (lowest wins)
  candidates.sort((a, b) => a.score - b.score);

  // Pick the first candidate who has not exceeded their maxTickets (if set)
  let selectedUser: AssignmentCandidate | undefined = undefined;
  for (const candidate of candidates) {
    const { maxTickets, userTickets } = candidate.details || {};
    // -1 means unlimited, so only skip if maxTickets >= 0 and user has exceeded the limit
    if (typeof maxTickets === 'number' && maxTickets >= 0 && userTickets > maxTickets) {
      continue; // skip, above maxTickets
    }
    selectedUser = candidate;
    break;
  }

  if (!selectedUser) {
    // Try Level 2: On-call + active (any expertise)
    let fallbackUserIds = userIds.filter(userId => {
      const state = getUserState(userId);
      return state?.isActiveForAssignment === true && state?.onCall === true;
    });
    
    if (fallbackUserIds.length === 0) {
      // Try Level 3: Active + expertise
      fallbackUserIds = userIds.filter(userId => {
        const state = getUserState(userId);
        return state?.isActiveForAssignment === true && hasExpertiseForBoard(userId);
      });
    }
    
    if (fallbackUserIds.length === 0) {
      // Try Level 4: Active (any expertise)
      fallbackUserIds = userIds.filter(userId => {
        const state = getUserState(userId);
        return state?.isActiveForAssignment === true;
      });
    }
    
    if (fallbackUserIds.length === 0) {
      return { reason: 'NO_ON_CALL_USERS' };
    }
    
    // Calculate scores for fallback candidates
    const fallbackCandidates: AssignmentCandidate[] = [];
    for (const userId of fallbackUserIds) {
      const weightedActiveTasks = workloadMap.get(userId) || 0;
      const expertiseMapping = expertiseMap.get(userId);
      const hasExpertise = expertiseMapping?.hasExpertise === true;
      const percentage = expertiseMapping?.percentage ?? 100;
      const maxTickets = expertiseMapping?.maxTickets ?? -1;

      const userWorkload = allWorkloadMappings.find(
        (w: UserWorkloadMapping) => w.userId === userId && w.boardId === boardId
      );
      const userTickets = userWorkload?.activeTasks || 0;

      const currentPercent = totalTicketsOnBoard > 0 ? (userTickets / totalTicketsOnBoard) * 100 : 0;
      const percentDiff = percentage - currentPercent;

      const expertiseBonus = hasExpertise ? 10 : 0;
      const score = weightedActiveTasks - expertiseBonus - percentDiff;

      fallbackCandidates.push({
        userId,
        score,
        details: {
          weightedActiveTasks,
          expertiseBonus,
          hasExpertise,
          percentage,
          maxTickets,
          userTickets,
          currentPercent,
          percentDiff,
        },
      });
    }
    
    fallbackCandidates.sort((a, b) => a.score - b.score);
    
    // Pick first fallback candidate who hasn't exceeded maxTickets
    for (const candidate of fallbackCandidates) {
      const { maxTickets, userTickets } = candidate.details || {};
      if (typeof maxTickets === 'number' && maxTickets >= 0 && userTickets > maxTickets) {
        continue;
      }
      selectedUser = candidate;
      break;
    }
    
    if (!selectedUser) {
      return { reason: 'NO_ON_CALL_USERS' };
    }
  }

  logger.info(`[Assignment] Selected userId: ${selectedUser.userId} with score: ${selectedUser.score.toFixed(2)}`);

  return { assignedUserId: selectedUser.userId };
}
