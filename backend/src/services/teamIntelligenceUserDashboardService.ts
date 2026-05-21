import { teamIntelligenceUserRepository } from '@/database/repositories/teamIntelligenceUserRepository';

export interface UserDetailsDateRangeInput {
  from: Date;
  to: Date;
  userEmail: string;
  page: number;
  limit: number;
}

class TeamIntelligenceUserDashboardService {
  async getUserDetails(input: UserDetailsDateRangeInput) {
    return await teamIntelligenceUserRepository.getUserDetailsByDate({
      from: input.from,
      to: input.to,
      userEmail: input.userEmail,
      page: input.page,
      limit: input.limit,
    });
  }

  async getUserPullRequests(input: UserDetailsDateRangeInput) {
    return await teamIntelligenceUserRepository.getUserPullRequestsByDate({
      from: input.from,
      to: input.to,
      userEmail: input.userEmail,
      page: input.page,
      limit: input.limit,
    });
  }

  async getUserOverview(input: { from: Date; to: Date; userEmail: string }) {
    return await teamIntelligenceUserRepository.getUserOverviewByDate({
      from: input.from,
      to: input.to,
      userEmail: input.userEmail,
    });
  }
}

export const teamIntelligenceUserDashboardService = new TeamIntelligenceUserDashboardService();
