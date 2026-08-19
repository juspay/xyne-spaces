import { repositories } from '@/database/repositories';
import { UserResponsibility } from '@xyne/shared';
import { withWorkspaceScope } from '@/database/tenant/context';
import { notificationService } from '@/services/notificationService';
import { logger } from './logger';
import type {
  UserGroupMapping,
  UserExpertiseMapping,
  UserAssignmentState,
  UserWorkloadMapping,
} from '@prisma/client';

export interface AssignmentResult {
  assignedUserId?: string;
  reason?: 'NO_ON_CALL_USERS' | 'EXCLUDED_USER_ONLY_CANDIDATE';
}

export interface AssignmentCandidate {
  userId: string;
  score: number;
  details?: Record<string, any>;
}

/**
 * Assignment type determines which user responsibilities are eligible
 * This is for the assignment engine - NOT a UserResponsibility
 */
export enum AssignmentType {
  TICKET_ASSIGNEE = 'TICKET_ASSIGNEE',  // For ticket.assignedTo field - everyone EXCEPT QA (MANAGER, TEAM_LEAD, MEMBER, PR_REVIEWER)
  MANAGER = 'MANAGER',                   // Only MANAGER responsibility
  TEAM_LEAD = 'TEAM_LEAD',               // Only TEAM_LEAD responsibility
  MEMBER = 'MEMBER',                     // Only MEMBER (Dev) responsibility
  PR_REVIEWER = 'PR_REVIEWER',           // For ticket.prReviewerId field - only PR_REVIEWER
  QA = 'QA',                             // For ticket.qaId field - only QA
}

/**
 * Helper function to filter users by responsibility based on assignment type
 */
function filterUsersByResponsibility(
  userGroupMappings: UserGroupMapping[],
  assignmentType: AssignmentType
): string[] {
  return userGroupMappings
    .filter(mapping => {
      const responsibility = mapping.responsibility as UserResponsibility;
      
      switch (assignmentType) {
        case AssignmentType.TICKET_ASSIGNEE:
          // Everyone EXCEPT QA can be assigned regular tickets (assignedTo field)
          return responsibility !== 'QA';

        case AssignmentType.MANAGER:
          return responsibility === 'MANAGER';

        case AssignmentType.TEAM_LEAD:
          return responsibility === 'TEAM_LEAD';

        case AssignmentType.MEMBER:
          return responsibility === 'MEMBER';

        
        case AssignmentType.PR_REVIEWER:
          // Only PR_REVIEWER can be assigned for PR review
          return responsibility === 'PR_REVIEWER';
        
        case AssignmentType.QA:
          // Only QA can be assigned for QA tasks
          return responsibility === 'QA';
        
        default:
          return false;
      }
    })
    .map(mapping => mapping.userId);
}

/**
 * Fires (fire-and-forget, never blocks or fails assignment) whenever the
 * maxWorkload cap left no one eligible. Recipients are subscribers
 * (user_group_mappings.isNotified) — this is unrelated to who was capped.
 */
function notifyMaxWorkloadReached(
  userGroupId: string,
  userGroup: { name: string; workspaceId: string } | null | undefined,
  userGroupMappings: UserGroupMapping[],
): void {
  if (!userGroup) return;
  const recipientUserIds = userGroupMappings
    .filter((m: UserGroupMapping) => m.isNotified === true)
    .map((m: UserGroupMapping) => m.userId);
  if (recipientUserIds.length === 0) return;
  notificationService
    .sendMaxWorkloadReachedNotification(userGroupId, userGroup.name, userGroup.workspaceId, recipientUserIds)
    .catch(err => logger.error(`[Assignment] Failed to send maxWorkload notification for userGroupId ${userGroupId}`, err));
}

async function resolveStartOffsets(
  pool: string[],
  workloadMap: Map<string, number>,
  hasWorkloadHistory: (userId: string) => boolean,
  userGroupMappingByUserId: Map<string, UserGroupMapping>,
): Promise<Map<string, number>> {
  const offsets = new Map<string, number>();
  const newcomers: string[] = [];

  for (const userId of pool) {
    const mapping = userGroupMappingByUserId.get(userId);
    if (!mapping) continue;
    if (mapping.startOffset != null) {
      offsets.set(userId, mapping.startOffset);
      continue;
    }
    if (hasWorkloadHistory(userId)) continue;
    newcomers.push(userId);
  }

  if (newcomers.length === 0) return offsets;

  // Baseline is the frontier of the virtual schedule, so peers count at their
  // effective position (raw load + the offset they were given), not raw load.
  // Reading raw here would let each newcomer reset the floor below the last one.
  const establishedLoads = pool
    .filter(id => hasWorkloadHistory(id))
    .map(id => (workloadMap.get(id) ?? 0) + (offsets.get(id) ?? 0));
  const baseline = establishedLoads.length > 0 ? Math.round(Math.min(...establishedLoads)) : 0;

  for (const userId of newcomers) {
    const mapping = userGroupMappingByUserId.get(userId)!;
    offsets.set(userId, baseline);
    try {
      const persisted = await repositories.userGroupMapping.setStartOffsetIfNull(mapping.id, baseline);
      logger.info(`[Assignment] startOffset resolved for userId ${userId}: ${baseline} (persisted=${persisted})`);
    } catch (err) {
      logger.error(`[Assignment] Failed to persist startOffset for userId ${userId}`, err);
    }
  }

  return offsets;
}

async function filterMappingsToChannelParticipants(
  userGroupMappings: UserGroupMapping[],
  channelId: string,
): Promise<UserGroupMapping[]> {
  const channel = await repositories.channels.findById(channelId);
  if (!channel || String(channel.visibility) !== 'PRIVATE') {
    return userGroupMappings;
  }
  const participants = await repositories.channelParticipants.getChannelParticipants(channelId);
  const participantIds = new Set(participants.map(p => p.userId));
  const filtered = userGroupMappings.filter(m => participantIds.has(m.userId));
  logger.info(
    `[Assignment] Private channel ${channelId} participant filter: ${userGroupMappings.length} group members → ${filtered.length} eligible participants`,
  );
  return filtered;
}

/**
 * Auto-assignment system that selects the most suitable user for a board or ticket.
 * Uses existing database tables only - no expression-based rules or configuration.
 *
 * Eligibility Flow (Filtering Phase):
 * 1. Fetch all users in the group
 * 2. Filter by responsibility based on assignment type:
 *    - TICKET_ASSIGNEE: Everyone except QA (MANAGER, TEAM_LEAD, MEMBER, PR_REVIEWER)
 *    - PR_REVIEWER: Only users with PR_REVIEWER responsibility
 *    - QA: Only users with QA responsibility
 * 3. Filter users where isActiveForAssignment = true AND onCall = true
 * 4. If no users found → Fallback to users where isActiveForAssignment = true (ignore onCall)
 * 5. If still no users → STOP (no auto-assignment)
 * 6. If board has expertise mappings: keep only users with expertise for the board
 *
 * Scoring Strategy (Ranking Phase):
 * For each user, calculate weighted workload across ALL boards:
 *   weightedActiveTasks = sum(activeTasks * boardWeight) for all boards
 * finalScore = weightedActiveTasks - expertiseBonus
 * expertiseBonus = 10 if user has expertise else 0
 *
 * Lower score = higher priority (fewer active tasks = more available).
 *
 * Exclusion rule:
 * - If excludeUserId is provided, that user cannot be selected for the assignment
 * - The system picks the second-lowest score candidate if the lowest is the excluded user
 * - If no other candidates exist after exclusion, returns { reason: 'EXCLUDED_USER_ONLY_CANDIDATE' }
 *
 * Returns: { assignedUserId } or { reason: "NO_ON_CALL_USERS" | "EXCLUDED_USER_ONLY_CANDIDATE" }
 * @param projectId - Optional project ID to scope workload calculation to boards in the same project only
 */
export async function evaluateAssignmentRule(
  userGroupId: string,
  boardId: string,
  assignmentType: AssignmentType = AssignmentType.TICKET_ASSIGNEE,
  excludeUserId?: string,
  projectId?: string,
  channelId?: string,
): Promise<AssignmentResult> {
  logger.info(`[Assignment] Evaluating for userGroupId: ${userGroupId}, boardId: ${boardId}, type: ${assignmentType}${excludeUserId ? `, excludeUserId: ${excludeUserId}` : ''}${projectId ? `, projectId: ${projectId}` : ''}${channelId ? `, channelId: ${channelId}` : ''}`);

  // Fetch user group mappings
  let userGroupMappings = await repositories.userGroupMapping.findMany({
    where: { userGroupId },
  });

  // Only consider members who can actually access the desk's channel.
  if (channelId) {
    userGroupMappings = await filterMappingsToChannelParticipants(userGroupMappings, channelId);
  }

  if (userGroupMappings.length === 0) {
    logger.info(`[Assignment] No eligible users in userGroupId: ${userGroupId}${channelId ? ` for channel ${channelId}` : ''}`);
    return { reason: 'NO_ON_CALL_USERS' };
  }

  // Filter users by responsibility based on assignment type
  const userIds = filterUsersByResponsibility(userGroupMappings, assignmentType);

  if (userIds.length === 0) {
    logger.info(`[Assignment] No users with eligible responsibility (${assignmentType}) in userGroupId: ${userGroupId}`);
    return { reason: 'NO_ON_CALL_USERS' };
  }

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

  const userGroupMappingByUserId = new Map<string, UserGroupMapping>(
    userGroupMappings.map((m: UserGroupMapping) => [m.userId, m])
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

  // If projectId is provided, fetch all boards in that project
  let projectBoardIds: Set<string> | undefined;
  if (projectId) {
    const projectBoards = await repositories.boards.findBoardsByProject(projectId);
    projectBoardIds = new Set(projectBoards.map(b => b.id));

    // Sanity check: verify the target board belongs to this project
    if (!projectBoardIds.has(boardId)) {
      logger.warn(`[Assignment] Board ${boardId} does not belong to project ${projectId}. Falling back to all boards.`);
      projectBoardIds = undefined;
    }
  }

  // Get workload mappings and board scores for boards in this user group
  let [allWorkloadMappings, allBoardScores, userGroup] = await Promise.all([
    withWorkspaceScope(() =>
      repositories.userWorkloadMapping.findMany({
        where: {
          userGroupId,
          userId: { in: finalEligibleUserIds },
        },
      }),
    ),
    repositories.boardComplexityScore.findMany({
      where: { userGroupId },
    }),
    repositories.userGroups.findById(userGroupId),
  ]);

  const maxWorkload = userGroup?.maxWorkload ?? null;

  // Filter workload and board scores to project boards only
  if (projectBoardIds) {
    allWorkloadMappings = allWorkloadMappings.filter(w => projectBoardIds!.has(w.boardId));
    allBoardScores = allBoardScores.filter(s => projectBoardIds!.has(s.boardId));
  }

  // Create a map of board weights (default to 1 if not configured)
  const boardWeightMap = new Map<string, number>(
    allBoardScores.map(score => [score.boardId, score.weight])
  );

  // The percentDiff term only applies when "Use percentage assignment" is enabled
  // for this board; otherwise it silently skews scoring toward whoever holds the
  // smallest share of the board (see boardComplexityScore.usePercentage).
  const usePercentageForBoard =
    allBoardScores.find(s => s.boardId === boardId)?.usePercentage === true;

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

  const workloadHistoryUserIds = new Set(allWorkloadMappings.map((w: UserWorkloadMapping) => w.userId));
  const hasWorkloadHistory = (userId: string) => workloadHistoryUserIds.has(userId);
  const offsetMap = await resolveStartOffsets(finalEligibleUserIds, workloadMap, hasWorkloadHistory, userGroupMappingByUserId);

  for (const userId of finalEligibleUserIds) {
    const weightedActiveTasks = workloadMap.get(userId) || 0;
    const startOffset = offsetMap.get(userId) ?? 0;
    const effectiveActiveTasks = weightedActiveTasks + startOffset;
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
    const percentDiff = usePercentageForBoard ? percentage - currentPercent : 0;

    // Scoring formula: effectiveActiveTasks - expertiseBonus - percentDiff
    const expertiseBonus = hasExpertise ? 10 : 0;
    const score = effectiveActiveTasks - expertiseBonus - percentDiff;

    candidates.push({
      userId,
      score,
      details: {
        weightedActiveTasks,
        startOffset,
        effectiveActiveTasks,
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
  // Exclude excludeUserId from assignment and pick the next-best candidate when possible.
  let selectedUser: AssignmentCandidate | undefined = undefined;
  let excludedCandidate: AssignmentCandidate | undefined = undefined;

  let cappedCount = 0;
  for (const candidate of candidates) {
    const { maxTickets, userTickets, weightedActiveTasks } = candidate.details || {};
    // -1 means unlimited, so only skip if maxTickets >= 0 and user has exceeded the limit
    if (typeof maxTickets === 'number' && maxTickets >= 0 && userTickets > maxTickets) {
      continue; // skip, above maxTickets
    }

    // Group-level workload cap: compare against raw weighted load (never the
    // cold-start-adjusted value, which is queue position rather than real work).
    if (maxWorkload !== null && (weightedActiveTasks ?? 0) >= maxWorkload) {
      cappedCount++;
      continue;
    }

    if (excludeUserId && candidate.userId === excludeUserId) {
      excludedCandidate = candidate;
      continue;
    }

    selectedUser = candidate;
    break;
  }

  if (!selectedUser && cappedCount > 0) {
    logger.info(
      `[Assignment] ${cappedCount}/${candidates.length} candidates at or above maxWorkload ${maxWorkload} for userGroupId: ${userGroupId} — no assignment yet, trying fallback`,
    );
  }

  // If no valid candidate found after filtering, and we skipped the excluded user,
  // it means only the excluded user was available
  if (!selectedUser && excludedCandidate) {
    logger.info(`[Assignment] Only excluded user (${excludeUserId}) available for assignment`);
    return { reason: 'EXCLUDED_USER_ONLY_CANDIDATE' };
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
      if (cappedCount > 0) {
        notifyMaxWorkloadReached(userGroupId, userGroup, userGroupMappings);
      }
      return { reason: 'NO_ON_CALL_USERS' };
    }

    // Calculate scores for fallback candidates
    const fallbackCandidates: AssignmentCandidate[] = [];
    const fallbackOffsetMap = await resolveStartOffsets(fallbackUserIds, workloadMap, hasWorkloadHistory, userGroupMappingByUserId);
    for (const userId of fallbackUserIds) {
      const weightedActiveTasks = workloadMap.get(userId) || 0;
      const startOffset = fallbackOffsetMap.get(userId) ?? 0;
      const effectiveActiveTasks = weightedActiveTasks + startOffset;
      const expertiseMapping = expertiseMap.get(userId);
      const hasExpertise = expertiseMapping?.hasExpertise === true;
      const percentage = expertiseMapping?.percentage ?? 100;
      const maxTickets = expertiseMapping?.maxTickets ?? -1;

      const userWorkload = allWorkloadMappings.find(
        (w: UserWorkloadMapping) => w.userId === userId && w.boardId === boardId
      );
      const userTickets = userWorkload?.activeTasks || 0;

      const currentPercent = totalTicketsOnBoard > 0 ? (userTickets / totalTicketsOnBoard) * 100 : 0;
      const percentDiff = usePercentageForBoard ? percentage - currentPercent : 0;

      const expertiseBonus = hasExpertise ? 10 : 0;
      const score = effectiveActiveTasks - expertiseBonus - percentDiff;

      fallbackCandidates.push({
        userId,
        score,
        details: {
          weightedActiveTasks,
          startOffset,
          effectiveActiveTasks,
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
    // Exclude excludeUserId from fallback assignment and pick the next-best candidate when possible.
    let fallbackExcludedCandidate: AssignmentCandidate | undefined = undefined;

    let fallbackCappedCount = 0;
    for (const candidate of fallbackCandidates) {
      const { maxTickets, userTickets, weightedActiveTasks } = candidate.details || {};
      if (typeof maxTickets === 'number' && maxTickets >= 0 && userTickets > maxTickets) {
        continue;
      }

      if (maxWorkload !== null && (weightedActiveTasks ?? 0) >= maxWorkload) {
        fallbackCappedCount++;
        continue;
      }

      if (excludeUserId && candidate.userId === excludeUserId) {
        fallbackExcludedCandidate = candidate;
        continue;
      }

      selectedUser = candidate;
      break;
    }

    // If no valid candidate found after filtering, and we skipped the excluded user,
    // it means only the excluded user was available
    if (!selectedUser && fallbackExcludedCandidate) {
      logger.info(`[Assignment] Only excluded user (${excludeUserId}) available for assignment (fallback)`);
      return { reason: 'EXCLUDED_USER_ONLY_CANDIDATE' };
    }

    if (!selectedUser) {
      if (fallbackCappedCount > 0) {
        logger.info(
          `[Assignment] ${fallbackCappedCount}/${fallbackCandidates.length} fallback candidates at or above maxWorkload ${maxWorkload} for userGroupId: ${userGroupId} — no assignment`,
        );
      }
      if (cappedCount > 0 || fallbackCappedCount > 0) {
        notifyMaxWorkloadReached(userGroupId, userGroup, userGroupMappings);
      }
      return { reason: 'NO_ON_CALL_USERS' };
    }
  }

  logger.info(`[Assignment] Selected userId: ${selectedUser.userId} with score: ${selectedUser.score.toFixed(2)}`);

  return { assignedUserId: selectedUser.userId };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AllRolesResult {
  manager:    AssignmentResult;
  teamLead:   AssignmentResult;
  member:     AssignmentResult;
  prReviewer: AssignmentResult;
  qa:         AssignmentResult;
}

// ─── Shared context fetched once ─────────────────────────────────────────────

interface SharedContext {
  userGroupMappings:        UserGroupMapping[];
  userStates:               UserAssignmentState[];
  userStateMap:             Map<string, UserAssignmentState>;
  expertiseMappings:        UserExpertiseMapping[];
  allWorkloadMappings:      UserWorkloadMapping[];
  boardWeightMap:           Map<string, number>;
  workloadsByUserId:        Map<string, UserWorkloadMapping[]>;
  workloadByUserAndBoard:   Map<string, UserWorkloadMapping>;
  expertiseMap:             Map<string, UserExpertiseMapping>;
  userGroupMappingByUserId: Map<string, UserGroupMapping>;
  usePercentageForBoard:    boolean;
  maxWorkload:              number | null;
  userGroup:                { name: string; workspaceId: string } | null;
  totalTicketsOnBoard:      number;
}

/**
 * Score a pool of userIds against pre-fetched shared context.
 * Exact same scoring/fallback logic as evaluateAssignmentRule — no behaviour change.
 */
async function pickBest(
  userIds: string[],
  assignmentType: AssignmentType,
  ctx: SharedContext,
  boardId: string,
  excludeUserId?: string,
): Promise<AssignmentResult> {
  const { userGroupMappings, userStateMap, expertiseMappings, boardWeightMap, workloadsByUserId, workloadByUserAndBoard, expertiseMap, userGroupMappingByUserId, usePercentageForBoard, maxWorkload, userGroup, totalTicketsOnBoard } = ctx;
  const userGroupId = userGroupMappings[0]?.userGroupId;

  const getUserState   = (id: string) => userStateMap.get(id);
  const hasExpertise   = (id: string) => expertiseMap.get(id)?.hasExpertise === true;

  // Build workloadMap for this role's userIds using pre-computed workloadsByUserId
  const workloadMap = new Map<string, number>();
  for (const userId of userIds) {
    const userMappings = workloadsByUserId.get(userId) ?? [];
    let weighted = 0;
    for (const m of userMappings) {
      weighted += m.activeTasks * (boardWeightMap.get(m.boardId) ?? 1);
    }
    workloadMap.set(userId, weighted);
  }

  // 4-level availability fallback — single pass, pick highest non-empty tier
  // Tier 1: on-call + active + expertise  (best)
  // Tier 2: on-call + active
  // Tier 3: active + expertise
  // Tier 4: active only                   (minimum bar)
  const t1: string[] = [], t2: string[] = [], t3: string[] = [], t4: string[] = [];
  for (const id of userIds) {
    const s = getUserState(id);
    if (s?.isActiveForAssignment !== true) continue;
    const onCall  = s.onCall === true;
    const expert  = hasExpertise(id);
    if (onCall && expert)  { t1.push(id); continue; }
    if (onCall)            { t2.push(id); continue; }
    if (expert)            { t3.push(id); continue; }
    t4.push(id);
  }
  const eligible = t1.length ? t1 : t2.length ? t2 : t3.length ? t3 : t4;
  if (eligible.length === 0) {
    return { reason: 'NO_ON_CALL_USERS' };
  }

  const finalEligible = (expertiseMappings.length > 0)
    ? eligible.slice().sort((a, b) => (hasExpertise(b) ? 1 : 0) - (hasExpertise(a) ? 1 : 0))
    : eligible;

  const hasWorkloadHistory = (id: string) => (workloadsByUserId.get(id)?.length ?? 0) > 0;
  const offsetMap = await resolveStartOffsets(finalEligible, workloadMap, hasWorkloadHistory, userGroupMappingByUserId);

  // Score candidates
  const score = (userId: string): AssignmentCandidate => {
    const weightedActiveTasks = workloadMap.get(userId) ?? 0;
    const startOffset   = offsetMap.get(userId) ?? 0;
    const effectiveActiveTasks = weightedActiveTasks + startOffset;
    const em            = expertiseMap.get(userId);
    const expert        = em?.hasExpertise === true;
    const percentage    = em?.percentage ?? 100;
    const maxTickets    = em?.maxTickets ?? -1;
    const userWorkload  = workloadByUserAndBoard.get(`${userId}#${boardId}`);
    const userTickets   = userWorkload?.activeTasks ?? 0;
    const currentPct    = totalTicketsOnBoard > 0 ? (userTickets / totalTicketsOnBoard) * 100 : 0;
    const percentDiff   = usePercentageForBoard ? percentage - currentPct : 0;
    const expertBonus   = expert ? 10 : 0;
    return {
      userId,
      score: effectiveActiveTasks - expertBonus - percentDiff,
      details: { weightedActiveTasks, startOffset, effectiveActiveTasks, expertBonus, hasExpertise: expert, percentage, maxTickets, userTickets, currentPct, percentDiff },
    };
  };

  const selectFrom = (candidates: AssignmentCandidate[]): AssignmentResult => {
    candidates.sort((a, b) => a.score - b.score);
    let excluded: AssignmentCandidate | undefined;
    let cappedCount = 0;
    for (const c of candidates) {
      const { maxTickets, userTickets, weightedActiveTasks } = c.details ?? {};
      if (typeof maxTickets === 'number' && maxTickets >= 0 && (userTickets ?? 0) > maxTickets) continue;
      // Group-level workload cap: raw weighted load, not the cold-start-adjusted value.
      if (maxWorkload !== null && (weightedActiveTasks ?? 0) >= maxWorkload) {
        cappedCount++;
        continue;
      }
      if (assignmentType === AssignmentType.PR_REVIEWER && excludeUserId && c.userId === excludeUserId) {
        excluded = c;
        continue;
      }
      return { assignedUserId: c.userId };
    }
    if (excluded) return { reason: 'EXCLUDED_USER_ONLY_CANDIDATE' };
    if (cappedCount > 0) {
      logger.info(
        `[Assignment] ${cappedCount}/${candidates.length} candidates at or above maxWorkload ${maxWorkload} for ${assignmentType} — no assignment`,
      );
      if (userGroupId) {
        notifyMaxWorkloadReached(userGroupId, userGroup, userGroupMappings);
      }
    }
    return { reason: 'NO_ON_CALL_USERS' };
  };

  return selectFrom(finalEligible.map(score));
}

/**
 * Evaluates all 5 roles (MANAGER, TEAM_LEAD, MEMBER, PR_REVIEWER, QA) for a
 * given user group + board in a single DB round-trip.
 *
 * Shared data (userGroupMappings, userStates, expertiseMappings, workloadMappings,
 * boardComplexityScores) is fetched once and reused across all role pools.
 * Per-role scoring logic is identical to evaluateAssignmentRule — no behaviour change.
 *
 * PR_REVIEWER exclusion: member's userId is excluded from PR_REVIEWER pool to
 * prevent self-review (same as calling evaluateAssignmentRule 5× sequentially).
 */
export async function evaluateAllRoles(
  userGroupId: string,
  boardId: string,
  projectId?: string,
  channelId?: string,
): Promise<AllRolesResult> {
  logger.info(`[Assignment] evaluateAllRoles for userGroupId: ${userGroupId}, boardId: ${boardId}${projectId ? `, projectId: ${projectId}` : ''}${channelId ? `, channelId: ${channelId}` : ''}`);

  // ── Single round of DB fetches ─────────────────────────────────────────────
  let userGroupMappings = await repositories.userGroupMapping.findMany({ where: { userGroupId } });

  // Only consider members who can actually access the desk's channel.
  if (channelId) {
    userGroupMappings = await filterMappingsToChannelParticipants(userGroupMappings, channelId);
  }

  if (userGroupMappings.length === 0) {
    const empty: AssignmentResult = { reason: 'NO_ON_CALL_USERS' };
    return { manager: empty, teamLead: empty, member: empty, prReviewer: empty, qa: empty };
  }

  const allUserIds = userGroupMappings.map(m => m.userId);

  // Fetch project boards if projectId is provided
  let projectBoardIds: Set<string> | undefined;
  if (projectId) {
    const projectBoards = await repositories.boards.findBoardsByProject(projectId);
    projectBoardIds = new Set(projectBoards.map(b => b.id));

    if (!projectBoardIds.has(boardId)) {
      logger.warn(`[Assignment] Board ${boardId} does not belong to project ${projectId}. Falling back to all boards.`);
      projectBoardIds = undefined;
    }
  }

  let [userStates, expertiseMappings, allWorkloadMappings, allBoardScores, userGroup] = await Promise.all([
    repositories.userAssignmentState.findMany({ where: { userGroupId, userId: { in: allUserIds } } }),
    repositories.userExpertiseMapping.findMany({ where: { userGroupId, boardId, userId: { in: allUserIds } } }),
    withWorkspaceScope(() =>
      repositories.userWorkloadMapping.findMany({ where: { userGroupId, userId: { in: allUserIds } } }),
    ),
    repositories.boardComplexityScore.findMany({ where: { userGroupId } }),
    repositories.userGroups.findById(userGroupId),
  ]);

  const maxWorkload = userGroup?.maxWorkload ?? null;

  // Filter workload and board scores to project boards only
  if (projectBoardIds) {
    allWorkloadMappings = allWorkloadMappings.filter(w => projectBoardIds!.has(w.boardId));
    allBoardScores = allBoardScores.filter(s => projectBoardIds!.has(s.boardId));
  }

  const boardWeightMap = new Map<string, number>(allBoardScores.map(s => [s.boardId, s.weight]));
  const usePercentageForBoard =
    allBoardScores.find(s => s.boardId === boardId)?.usePercentage === true;

  // Pre-compute userStateMap for O(1) lookups across all 5 roles
  const userStateMap = new Map<string, UserAssignmentState>(userStates.map(s => [s.userId, s]));
  
  // Pre-compute workloadsByUserId once for all roles
  const workloadsByUserId = new Map<string, UserWorkloadMapping[]>();
  for (const w of allWorkloadMappings) {
    if (!workloadsByUserId.has(w.userId)) {
      workloadsByUserId.set(w.userId, []);
    }
    workloadsByUserId.get(w.userId)!.push(w);
  }
  
  // Pre-compute user+board workload lookup for O(1) access
  const workloadByUserAndBoard = new Map<string, UserWorkloadMapping>();
  for (const w of allWorkloadMappings) {
    const key = `${w.userId}#${w.boardId}`;
    workloadByUserAndBoard.set(key, w);
  }
  
  // Pre-compute expertise lookup for O(1) access across all 5 roles
  const expertiseMap = new Map<string, UserExpertiseMapping>(
    expertiseMappings.map(e => [e.userId, e])
  );

  const userGroupMappingByUserId = new Map<string, UserGroupMapping>(
    userGroupMappings.map(m => [m.userId, m])
  );

  const totalTicketsOnBoard = allWorkloadMappings
    .filter(w => w.boardId === boardId)
    .reduce((sum, w) => sum + (w.activeTasks ?? 0), 0);

  const ctx: SharedContext = {
    userGroupMappings,
    userStates,
    userStateMap,
    expertiseMappings,
    allWorkloadMappings,
    boardWeightMap,
    workloadsByUserId,
    workloadByUserAndBoard,
    expertiseMap,
    userGroupMappingByUserId,
    usePercentageForBoard,
    maxWorkload,
    userGroup,
    totalTicketsOnBoard,
  };

  // ── Per-role pools ─────────────────────────────────────────────────────────
  const poolFor = (type: AssignmentType) =>
    filterUsersByResponsibility(userGroupMappings, type);

  // Round 1: MANAGER, TEAM_LEAD, MEMBER, QA
  const [manager, teamLead, member, qa] = await Promise.all([
    pickBest(poolFor(AssignmentType.MANAGER),   AssignmentType.MANAGER,   ctx, boardId),
    pickBest(poolFor(AssignmentType.TEAM_LEAD), AssignmentType.TEAM_LEAD, ctx, boardId),
    pickBest(poolFor(AssignmentType.MEMBER),    AssignmentType.MEMBER,    ctx, boardId),
    pickBest(poolFor(AssignmentType.QA),        AssignmentType.QA,        ctx, boardId),
  ]);

  // Round 2: PR_REVIEWER — exclude MEMBER to prevent self-review
  const prReviewer = await pickBest(
    poolFor(AssignmentType.PR_REVIEWER),
    AssignmentType.PR_REVIEWER,
    ctx,
    boardId,
    member.assignedUserId,
  );

  logger.info(`[Assignment] evaluateAllRoles results — manager:${manager.assignedUserId} teamLead:${teamLead.assignedUserId} member:${member.assignedUserId} prReviewer:${prReviewer.assignedUserId} qa:${qa.assignedUserId}`);

  return { manager, teamLead, member, prReviewer, qa };
}

// ─── Role-driven evaluation (board.metadata.assignmentRoles) ─────────────────
// Returns one AssignmentResult per roleId the board configured for auto-assignment.
// Each slot is scored independently against the same shared context, reusing the
// `pickBest` scoring/fallback logic. The slot keyed by `roleId` maps to the user
// whose `UserGroupMapping.roleId === roleId`.

export type RoleSlotsResult = Record<string, AssignmentResult>;

function filterUsersByRoleId(
  userGroupMappings: UserGroupMapping[],
  roleId: string,
): string[] {
  return userGroupMappings
    .filter(mapping => mapping.roleId === roleId)
    .map(mapping => mapping.userId);
}

export async function evaluateRoleSlots(
  userGroupId: string,
  boardId: string,
  roleIds: string[],
  projectId?: string,
  channelId?: string,
  excludeUserId?: string,
): Promise<RoleSlotsResult> {
  logger.info(
    `[Assignment] evaluateRoleSlots for userGroupId: ${userGroupId}, boardId: ${boardId}, roleIds: [${roleIds.join(', ')}]${projectId ? `, projectId: ${projectId}` : ''}${channelId ? `, channelId: ${channelId}` : ''}${excludeUserId ? `, excludeUserId: ${excludeUserId}` : ''}`,
  );

  const result: RoleSlotsResult = {};
  if (roleIds.length === 0) return result;

  let userGroupMappings = await repositories.userGroupMapping.findMany({ where: { userGroupId } });

  if (channelId) {
    userGroupMappings = await filterMappingsToChannelParticipants(userGroupMappings, channelId);
  }

  if (userGroupMappings.length === 0) {
    for (const roleId of roleIds) result[roleId] = { reason: 'NO_ON_CALL_USERS' };
    return result;
  }

  if (excludeUserId) {
    userGroupMappings = userGroupMappings.filter(m => m.userId !== excludeUserId);
  }

  const allUserIds = userGroupMappings.map(m => m.userId);

  let projectBoardIds: Set<string> | undefined;
  if (projectId) {
    const projectBoards = await repositories.boards.findBoardsByProject(projectId);
    projectBoardIds = new Set(projectBoards.map(b => b.id));
    if (!projectBoardIds.has(boardId)) {
      logger.warn(`[Assignment] Board ${boardId} does not belong to project ${projectId}. Falling back to all boards.`);
      projectBoardIds = undefined;
    }
  }

  let [userStates, expertiseMappings, allWorkloadMappings, allBoardScores, userGroup] = await Promise.all([
    repositories.userAssignmentState.findMany({ where: { userGroupId, userId: { in: allUserIds } } }),
    repositories.userExpertiseMapping.findMany({ where: { userGroupId, boardId, userId: { in: allUserIds } } }),
    withWorkspaceScope(() =>
      repositories.userWorkloadMapping.findMany({ where: { userGroupId, userId: { in: allUserIds } } }),
    ),
    repositories.boardComplexityScore.findMany({ where: { userGroupId } }),
    repositories.userGroups.findById(userGroupId),
  ]);

  const maxWorkload = userGroup?.maxWorkload ?? null;

  if (projectBoardIds) {
    allWorkloadMappings = allWorkloadMappings.filter(w => projectBoardIds!.has(w.boardId));
    allBoardScores = allBoardScores.filter(s => projectBoardIds!.has(s.boardId));
  }

  const boardWeightMap = new Map<string, number>(allBoardScores.map(s => [s.boardId, s.weight]));
  const usePercentageForBoard =
    allBoardScores.find(s => s.boardId === boardId)?.usePercentage === true;
  const userStateMap = new Map<string, UserAssignmentState>(userStates.map(s => [s.userId, s]));
  const workloadsByUserId = new Map<string, UserWorkloadMapping[]>();
  for (const w of allWorkloadMappings) {
    if (!workloadsByUserId.has(w.userId)) workloadsByUserId.set(w.userId, []);
    workloadsByUserId.get(w.userId)!.push(w);
  }
  const workloadByUserAndBoard = new Map<string, UserWorkloadMapping>();
  for (const w of allWorkloadMappings) workloadByUserAndBoard.set(`${w.userId}#${w.boardId}`, w);
  const expertiseMap = new Map<string, UserExpertiseMapping>(expertiseMappings.map(e => [e.userId, e]));
  const userGroupMappingByUserId = new Map<string, UserGroupMapping>(userGroupMappings.map(m => [m.userId, m]));
  const totalTicketsOnBoard = allWorkloadMappings
    .filter(w => w.boardId === boardId)
    .reduce((sum, w) => sum + (w.activeTasks ?? 0), 0);

  const ctx: SharedContext = {
    userGroupMappings,
    userStates,
    userStateMap,
    expertiseMappings,
    allWorkloadMappings,
    boardWeightMap,
    workloadsByUserId,
    workloadByUserAndBoard,
    expertiseMap,
    userGroupMappingByUserId,
    usePercentageForBoard,
    maxWorkload,
    userGroup,
    totalTicketsOnBoard,
  };

  // Score each roleId's pool independently. `excludeUserId` (if set) removes
  // that user from every pool — used by the PR-webhook flow to avoid self-review
  // (the ticket assignee shouldn't be picked as the PR reviewer).
  const summary: string[] = [];
  for (const roleId of roleIds) {
    const pool = filterUsersByRoleId(userGroupMappings, roleId);
    const res = await pickBest(pool, AssignmentType.TICKET_ASSIGNEE, ctx, boardId);
    result[roleId] = res;
    summary.push(`${roleId}:${res.assignedUserId ?? 'none'}`);
  }

  logger.info(`[Assignment] evaluateRoleSlots results — ${summary.join(' ')}`);

  return result;
}
