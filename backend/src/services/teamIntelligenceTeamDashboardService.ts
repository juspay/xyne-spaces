import { teamIntelligenceTeamRepository } from '@/database/repositories/teamIntelligenceTeamRepository';

export interface TeamBulletsDateRangeInput {
  from: Date;
  to: Date;
  teamName: string;
  page: number;
  limit: number;
}

class TeamIntelligenceTeamDashboardService {
  async getTeamBullets(input: TeamBulletsDateRangeInput) {
    return await teamIntelligenceTeamRepository.getTeamBulletsByDate({
      from: input.from,
      to: input.to,
      teamName: input.teamName,
      page: input.page,
      limit: input.limit,
    });
  }

  async getPrByDate(input: { from: Date; to: Date; prId: number }) {
    return await teamIntelligenceTeamRepository.getPrByDate({
      from: input.from,
      to: input.to,
      prId: input.prId,
    });
  }

  async getTeamUsageSummary(input: { from: Date; to: Date; teamName: string }) {
    return await teamIntelligenceTeamRepository.getTeamUsageSummary({
      from: input.from,
      to: input.to,
      teamName: input.teamName,
    });
  }
}

export const teamIntelligenceTeamDashboardService = new TeamIntelligenceTeamDashboardService();
