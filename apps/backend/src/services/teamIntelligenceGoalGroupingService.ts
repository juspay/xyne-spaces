import { db } from '@/database/client';
import { MettleTeamGoal, mettleTeamGoalsService } from '@/services/mettleTeamGoalsService';
import { MettleTeam, mettleTeamSyncService } from '@/services/mettleTeamSyncService';
import { teamIntelligenceContentStorageService } from '@/team-intelligence/services/team-intelligence-content-storage.service';
import { logger } from '@/utils/logger';

export type TeamGoalGroupKey = '10X' | '5X' | '2X' | 'READY_TO_ACCELERATE' | 'NO_GOAL_DATA';

export interface TeamGoalGroupTeam extends MettleTeam {
  highestTrack: '10X' | '5X' | '2X' | null;
  activeGoalCount: number;
  matchedGoalCount: number;
}

export interface TeamGoalGroupsResponse {
  totalTeams: number;
  groups: Record<TeamGoalGroupKey, TeamGoalGroupTeam[]>;
  warnings: TeamGoalGroupsWarning[];
}

export interface TeamGoalGroupsWarning {
  code: 'GOAL_FETCH_FAILED';
  teamId: string;
  teamName: string;
}

export interface StoredGoalAlignment {
  goalId?: unknown;
  track?: unknown;
  isTeamWorkingTowardsGoal?: unknown;
}

const GROUP_ORDER: Array<'10X' | '5X' | '2X'> = ['10X', '5X', '2X'];

const normalizeTrack = (track: unknown): '10X' | '5X' | '2X' | null => {
  if (typeof track !== 'string') return null;
  const normalized = track.trim().toUpperCase();
  return normalized === '10X' || normalized === '5X' || normalized === '2X' ? normalized : null;
};

const highestTrack = (goals: MettleTeamGoal[]): '10X' | '5X' | '2X' | null => {
  const tracks = new Set(goals.map((goal) => normalizeTrack(goal.track)).filter(Boolean));
  return GROUP_ORDER.find((track) => tracks.has(track)) ?? null;
};

export const classifyTeamGoalGroup = (
  activeGoals: MettleTeamGoal[],
  alignments: StoredGoalAlignment[]
): {
  group: TeamGoalGroupKey;
  highestTrack: '10X' | '5X' | '2X' | null;
  matchedGoalCount: number;
} => {
  const highestActiveTrack = highestTrack(activeGoals);
  if (activeGoals.length === 0 || !highestActiveTrack) {
    return {
      group: 'NO_GOAL_DATA',
      highestTrack: null,
      matchedGoalCount: 0,
    };
  }

  const activeGoalIds = new Set(activeGoals.map((goal) => goal.id));
  const matchedGoalIds = new Set(
    alignments
      .filter(
        (alignment) =>
          alignment.isTeamWorkingTowardsGoal === true &&
          typeof alignment.goalId === 'string' &&
          activeGoalIds.has(alignment.goalId)
      )
      .map((alignment) => alignment.goalId as string)
  );

  const matchedGoals = activeGoals.filter((goal) => matchedGoalIds.has(goal.id));
  const highestMatchedTrack = highestTrack(matchedGoals);

  return {
    group: highestMatchedTrack ?? 'READY_TO_ACCELERATE',
    highestTrack: highestMatchedTrack,
    matchedGoalCount: matchedGoalIds.size,
  };
};

const mapWithConcurrency = async <T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>
): Promise<U[]> => {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
};

class TeamIntelligenceGoalGroupingService {
  async getTeamGoalGroups(orgId: string): Promise<TeamGoalGroupsResponse> {
    const { teams } = await mettleTeamSyncService.fetchTeamsFromMettle();
    const sortedTeams = [...(teams ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const teamIds = sortedTeams.map((team) => team.id);

    const [goalFetchResults, summaryRows] = await Promise.all([
      mapWithConcurrency(sortedTeams, 5, async (team) => {
        try {
          const goals = await mettleTeamGoalsService.fetchActiveTeamGoals(team.id, {
            throwOnError: true,
          });
          return { team, goals, warning: null };
        } catch (error) {
          logger.warn('[TeamIntelligenceGoalGrouping] Could not fetch goals for team', {
            teamId: team.id,
            teamName: team.name,
            error,
          });
          return {
            team,
            goals: [],
            warning: {
              code: 'GOAL_FETCH_FAILED' as const,
              teamId: team.id,
              teamName: team.name,
            },
          };
        }
      }),
      teamIds.length === 0
        ? Promise.resolve([])
        : db.teamIntelligenceTeamSummaryV2.findMany({
            where: {
              orgId,
              teamId: { in: teamIds },
              status: 'COMPLETED',
              contentUrl: { not: null },
            },
            select: { teamId: true, contentUrl: true },
          }),
    ]);
    const goalsByTeam = new Map(
      goalFetchResults.map(({ team, goals }) => [team.id, goals] as const)
    );
    const warnings = goalFetchResults
      .map(({ warning }) => warning)
      .filter((warning): warning is TeamGoalGroupsWarning => warning !== null);

    const alignmentEntries = await mapWithConcurrency(summaryRows, 8, async (row) => {
      try {
        const content = await teamIntelligenceContentStorageService.hydrateJsonPayload<{
          teamSummary?: { team10xGoal?: StoredGoalAlignment[] };
        }>(null, row.contentUrl);
        return [row.teamId, content?.teamSummary?.team10xGoal ?? []] as const;
      } catch (error) {
        logger.warn('[TeamIntelligenceGoalGrouping] Could not hydrate team summary', {
          teamId: row.teamId,
          error,
        });
        return [row.teamId, []] as const;
      }
    });

    const alignmentsByTeam = new Map<string, StoredGoalAlignment[]>();
    for (const [teamId, alignments] of alignmentEntries) {
      if (!teamId) continue;
      alignmentsByTeam.set(teamId, [...(alignmentsByTeam.get(teamId) ?? []), ...alignments]);
    }

    const groups: TeamGoalGroupsResponse['groups'] = {
      '10X': [],
      '5X': [],
      '2X': [],
      READY_TO_ACCELERATE: [],
      NO_GOAL_DATA: [],
    };

    for (const team of sortedTeams) {
      const activeGoals = goalsByTeam.get(team.id) ?? [];
      const classification = classifyTeamGoalGroup(
        activeGoals,
        alignmentsByTeam.get(team.id) ?? []
      );
      const classifiedTeam: TeamGoalGroupTeam = {
        ...team,
        highestTrack: classification.highestTrack,
        activeGoalCount: activeGoals.length,
        matchedGoalCount: classification.matchedGoalCount,
      };
      groups[classification.group].push(classifiedTeam);
    }

    return {
      totalTeams: sortedTeams.length,
      groups,
      warnings,
    };
  }
}

export const teamIntelligenceGoalGroupingService = new TeamIntelligenceGoalGroupingService();
