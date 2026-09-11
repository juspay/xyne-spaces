import { teamIntelligenceUserRepository } from '@/database/repositories/teamIntelligenceUserRepository';
import { logger } from '@/utils/logger';

export interface UserDetailsDateRangeInput {
  from: Date;
  to: Date;
  userEmail: string;
  page: number;
  limit: number;
  orgId?: string | null;
}

class TeamIntelligenceUserDashboardService {
  async getUserDetails(input: UserDetailsDateRangeInput) {
    try {
      return await teamIntelligenceUserRepository.getUserDetailsByDate({
        from: input.from,
        to: input.to,
        userEmail: input.userEmail,
        page: input.page,
        limit: input.limit,
        orgId: input.orgId,
      });
    } catch (error) {
      logger.error('[TeamIntelligenceUser] getUserDetails failed', { error, input });
      throw error;
    }
  }

  async getUserPullRequests(input: UserDetailsDateRangeInput) {
    try {
      return await teamIntelligenceUserRepository.getUserPullRequestsByDate({
        from: input.from,
        to: input.to,
        userEmail: input.userEmail,
        page: input.page,
        limit: input.limit,
        orgId: input.orgId,
      });
    } catch (error) {
      logger.error('[TeamIntelligenceUser] getUserPullRequests failed', { error, input });
      throw error;
    }
  }

  async getUserOverview(input: { from: Date; to: Date; userEmail: string; orgId?: string | null }) {
    try {
      return await teamIntelligenceUserRepository.getUserOverviewByDate({
        from: input.from,
        to: input.to,
        userEmail: input.userEmail,
        orgId: input.orgId,
      });
    } catch (error) {
      logger.error('[TeamIntelligenceUser] getUserOverview failed', { error, input });
      throw error;
    }
  }

  async getUserLeadershipSnapshots(input: { from: Date; to: Date; userEmail: string; orgId?: string | null }) {
    try {
      return await teamIntelligenceUserRepository.getUserLeadershipSnapshotsByDate({
        from: input.from,
        to: input.to,
        userEmail: input.userEmail,
        orgId: input.orgId,
      });
    } catch (error) {
      logger.error('[TeamIntelligenceUser] getUserLeadershipSnapshots failed', { error, input });
      throw error;
    }
  }

  async getUserChannelRecaps(input: { from: Date; to: Date; userEmail: string; page: number; limit: number; orgId?: string | null }) {
    try {
      return await teamIntelligenceUserRepository.getUserChannelRecapsByDate({
        from: input.from,
        to: input.to,
        userEmail: input.userEmail,
        page: input.page,
        limit: input.limit,
      });
    } catch (error) {
      logger.error('[TeamIntelligenceUser] getUserChannelRecaps failed', { error, input });
      throw error;
    }
  }
}

export const teamIntelligenceUserDashboardService = new TeamIntelligenceUserDashboardService();
