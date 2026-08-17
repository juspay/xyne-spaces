import { db } from '@/database/client';
import { mettleTeamGoalsService } from '@/services/mettleTeamGoalsService';
import { mettleTeamSyncService } from '@/services/mettleTeamSyncService';
import {
  classifyTeamGoalGroup,
  teamIntelligenceGoalGroupingService,
} from '@/services/teamIntelligenceGoalGroupingService';

jest.mock('@/database/client', () => ({
  db: {
    teamIntelligenceTeamSummaryV2: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/services/mettleTeamGoalsService', () => ({
  mettleTeamGoalsService: {
    fetchActiveTeamGoals: jest.fn(),
  },
}));

jest.mock('@/services/mettleTeamSyncService', () => ({
  mettleTeamSyncService: {
    fetchTeamsFromMettle: jest.fn(),
  },
}));

jest.mock('@/team-intelligence/services/team-intelligence-content-storage.service', () => ({
  teamIntelligenceContentStorageService: {
    hydrateJsonPayload: jest.fn(),
  },
}));

describe('TeamIntelligenceGoalGroupingService', () => {
  it('uses the highest evidence-matched track instead of the highest active track', () => {
    const classification = classifyTeamGoalGroup(
      [
        { id: 'goal-10x', title: 'Unmatched 10X goal', track: '10X' },
        { id: 'goal-2x', title: 'Matched 2X goal', track: '2X' },
      ],
      [
        {
          goalId: 'goal-10x',
          track: '10X',
          isTeamWorkingTowardsGoal: false,
        },
        {
          goalId: 'goal-2x',
          track: '2X',
          isTeamWorkingTowardsGoal: true,
        },
      ]
    );

    expect(classification).toEqual({
      group: '2X',
      highestTrack: '2X',
      matchedGoalCount: 1,
    });
  });

  it('returns the other teams when one Mettle goal request fails', async () => {
    jest.mocked(mettleTeamSyncService.fetchTeamsFromMettle).mockResolvedValue({
      teams: [
        { id: 'team-a', name: 'Alpha', description: '', owner_id: null },
        { id: 'team-b', name: 'Beta', description: '', owner_id: null },
        { id: 'team-c', name: 'Gamma', description: '', owner_id: null },
      ],
    });
    jest.mocked(mettleTeamGoalsService.fetchActiveTeamGoals).mockImplementation(async (teamId) => {
      if (teamId === 'team-b') {
        throw new Error('Mettle timed out');
      }
      return [
        {
          id: `goal-${teamId}`,
          title: `${teamId} goal`,
          track: teamId === 'team-a' ? '10X' : '5X',
        },
      ];
    });
    jest.mocked(db.teamIntelligenceTeamSummaryV2.findMany).mockResolvedValue([]);

    const result = await teamIntelligenceGoalGroupingService.getTeamGoalGroups('workspace-1');

    expect(result.totalTeams).toBe(3);
    expect(result.groups.READY_TO_ACCELERATE.map((team) => team.id)).toEqual(['team-a', 'team-c']);
    expect(result.groups.NO_GOAL_DATA.map((team) => team.id)).toEqual(['team-b']);
    expect(result.warnings).toEqual([
      {
        code: 'GOAL_FETCH_FAILED',
        teamId: 'team-b',
        teamName: 'Beta',
      },
    ]);
  });
});
