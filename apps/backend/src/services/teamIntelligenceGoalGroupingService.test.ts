import { db } from '@/database/client';
import { mettleTeamGoalsService } from '@/services/mettleTeamGoalsService';
import { mettleTeamSyncService } from '@/services/mettleTeamSyncService';
import { teamIntelligenceGoalGroupingService } from '@/services/teamIntelligenceGoalGroupingService';

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

    const result = await teamIntelligenceGoalGroupingService.getTeamGoalGroups(
      'workspace-1',
      new Date('2026-08-10T12:00:00.000Z')
    );

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
