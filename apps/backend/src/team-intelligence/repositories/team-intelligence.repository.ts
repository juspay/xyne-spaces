import {
  Prisma,
  PrismaClient,
  TeamIntelligenceIngestionBatchV2,
  TeamIntelligenceOrgSummaryV2,
  TeamIntelligenceTeamSummaryV2,
  TeamIntelligenceUserIngestionV2,
} from '@prisma/client';
import { db } from '@/database/client';
import { TeamIntelligenceBatchStatus, TeamIntelligenceUserIngestionStatus } from '@xyne/shared';

export interface CreateTeamIntelligenceBatchData {
  orgId?: string | null;
  reportDate: Date;
  source: string;
  idempotencyKey: string;
  requestChecksum: string;
  requestPayload: Prisma.InputJsonValue | null;
  contentUrl: string | null;
  contentSize: number | null;
  contentChecksum: string | null;
  totalUsers: number;
  status: TeamIntelligenceBatchStatus;
}

export interface CreateTeamIntelligenceUserData {
  orgId?: string | null;
  reportDate: Date;
  source: string;
  userEmail: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  aiUsage: Prisma.InputJsonValue | null;
  contentUrl: string | null;
  contentSize: number | null;
  contentChecksum: string | null;
  processingStatus: TeamIntelligenceUserIngestionStatus;
  queueJobId: string;
}

export interface TeamIntelligenceBatchWithUsers {
  batch: TeamIntelligenceIngestionBatchV2;
  users: TeamIntelligenceUserIngestionV2[];
}

export interface TeamIntelligenceBatchProgress {
  totalUsers: number;
  completedUsers: number;
  failedUsers: number;
  processingUsers: number;
  queuedUsers: number;
}

export interface CreateTeamIntelligenceTeamSummaryData {
  orgId?: string | null;
  batchId: string;
  reportDate: Date;
  source: string;
  teamId: string;
  teamName: string;
  idempotencyKey: string;
  totalUsers: number;
  completedUsers: number;
  failedUsers: number;
  status: TeamIntelligenceBatchStatus;
  queueJobId?: string | null;
  queuedAt?: Date | null;
  errorMessage?: string | null;
}

export interface TeamIntelligenceTeamProgress {
  totalUsers: number;
  completedUsers: number;
  failedUsers: number;
}

export interface CreateTeamIntelligenceOrgSummaryData {
  orgId?: string | null;
  batchId: string;
  reportDate: Date;
  source: string;
  idempotencyKey: string;
  totalTeams: number;
  completedTeams: number;
  failedTeams: number;
  status: TeamIntelligenceBatchStatus;
  queueJobId?: string | null;
  queuedAt?: Date | null;
  errorMessage?: string | null;
}

export interface TeamIntelligenceOrgProgress {
  totalTeams: number;
  completedTeams: number;
  failedTeams: number;
}

class TeamIntelligenceRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = db;
  }

  async findBatchWithUsersByIdempotencyKey(
    idempotencyKey: string
  ): Promise<TeamIntelligenceBatchWithUsers | null> {
    const batch = await this.prisma.teamIntelligenceIngestionBatchV2.findUnique({
      where: { idempotencyKey },
      include: {
        users: {
          orderBy: [{ userEmail: 'asc' }],
        },
      },
    });

    if (!batch) {
      return null;
    }

    const { users, ...rest } = batch;
    return {
      batch: rest,
      users,
    };
  }

  async createBatchWithUsers(
    batchData: CreateTeamIntelligenceBatchData,
    usersData: CreateTeamIntelligenceUserData[]
  ): Promise<TeamIntelligenceBatchWithUsers> {
    return await this.prisma.$transaction(async (transaction) => {
      const batch = await transaction.teamIntelligenceIngestionBatchV2.create({
        data: {
          ...batchData,
          requestPayload: batchData.requestPayload ?? Prisma.JsonNull,
        },
      });

      const users = await Promise.all(
        usersData.map((userData) =>
          transaction.teamIntelligenceUserIngestionV2.create({
            data: {
              ...userData,
              aiUsage: userData.aiUsage ?? Prisma.JsonNull,
              batchId: batch.id,
            },
          })
        )
      );

      return { batch, users };
    });
  }

  async updateBatchStatus(
    batchId: string,
    data: Partial<{
      status: TeamIntelligenceBatchStatus;
      queuedUsers: number;
      failedUsers: number;
      queuedAt: Date | null;
      completedAt: Date | null;
      errorMessage: string | null;
    }>
  ): Promise<TeamIntelligenceIngestionBatchV2 | null> {
    const result = await this.prisma.teamIntelligenceIngestionBatchV2.updateMany({
      where: { id: batchId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return await this.prisma.teamIntelligenceIngestionBatchV2.findUnique({
      where: { id: batchId },
    });
  }

  async updateUserStatus(
    userIngestionId: string,
    data: Partial<{
      processingStatus: TeamIntelligenceUserIngestionStatus;
      queuedAt: Date | null;
      startedAt: Date | null;
      completedAt: Date | null;
      failedAt: Date | null;
      errorMessage: string | null;
    }>
  ): Promise<TeamIntelligenceUserIngestionV2 | null> {
    const result = await this.prisma.teamIntelligenceUserIngestionV2.updateMany({
      where: { id: userIngestionId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return await this.prisma.teamIntelligenceUserIngestionV2.findUnique({
      where: { id: userIngestionId },
    });
  }

  async updateUserStatuses(
    userIngestionIds: string[],
    data: Partial<{
      processingStatus: TeamIntelligenceUserIngestionStatus;
      queuedAt: Date | null;
      startedAt: Date | null;
      completedAt: Date | null;
      failedAt: Date | null;
      errorMessage: string | null;
    }>
  ): Promise<number> {
    if (userIngestionIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.teamIntelligenceUserIngestionV2.updateMany({
      where: { id: { in: userIngestionIds } },
      data,
    });

    return result.count;
  }

  async findUserIngestionById(userIngestionId: string): Promise<TeamIntelligenceUserIngestionV2 | null> {
    return await this.prisma.teamIntelligenceUserIngestionV2.findUnique({
      where: { id: userIngestionId },
    });
  }

  async findUsersByStatuses(
    statuses: TeamIntelligenceUserIngestionStatus[]
  ): Promise<TeamIntelligenceUserIngestionV2[]> {
    return await this.prisma.teamIntelligenceUserIngestionV2.findMany({
      where: {
        processingStatus: { in: statuses },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async findUsersByBatchAndTeam(
    batchId: string,
    teamId: string,
    statuses?: TeamIntelligenceUserIngestionStatus[]
  ): Promise<TeamIntelligenceUserIngestionV2[]> {
    return await this.prisma.teamIntelligenceUserIngestionV2.findMany({
      where: {
        batchId,
        teamId,
        ...(statuses ? { processingStatus: { in: statuses } } : {}),
      },
      orderBy: [{ userEmail: 'asc' }],
    });
  }

  async findUsersByBatchId(batchId: string): Promise<TeamIntelligenceUserIngestionV2[]> {
    return await this.prisma.teamIntelligenceUserIngestionV2.findMany({
      where: { batchId },
      orderBy: [{ teamName: 'asc' }, { userEmail: 'asc' }],
    });
  }

  async updateUserIngestionSummary(
    userIngestionId: string,
    data: {
      contentUrl?: string | null;
      contentSize?: number | null;
      contentChecksum?: string | null;
      processingStatus: TeamIntelligenceUserIngestionStatus;
      completedAt?: Date | null;
      failedAt?: Date | null;
      errorMessage?: string | null;
    }
  ): Promise<TeamIntelligenceUserIngestionV2 | null> {
    const result = await this.prisma.teamIntelligenceUserIngestionV2.updateMany({
      where: { id: userIngestionId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return await this.prisma.teamIntelligenceUserIngestionV2.findUnique({
      where: { id: userIngestionId },
    });
  }

  async findTeamSummaryByBatchAndTeam(
    batchId: string,
    teamId: string
  ): Promise<TeamIntelligenceTeamSummaryV2 | null> {
    return await this.prisma.teamIntelligenceTeamSummaryV2.findFirst({
      where: {
        batchId,
        teamId,
      },
    });
  }

  async findTeamSummaryById(teamSummaryId: string): Promise<TeamIntelligenceTeamSummaryV2 | null> {
    return await this.prisma.teamIntelligenceTeamSummaryV2.findUnique({
      where: { id: teamSummaryId },
    });
  }

  async findPreviousCompletedTeamSummary(
    teamId: string,
    beforeReportDate: Date
  ): Promise<TeamIntelligenceTeamSummaryV2 | null> {
    return await this.prisma.teamIntelligenceTeamSummaryV2.findFirst({
      where: {
        teamId,
        status: TeamIntelligenceBatchStatus.COMPLETED,
        reportDate: { lt: beforeReportDate },
        contentUrl: { not: null },
      },
      orderBy: [{ reportDate: 'desc' }, { completedAt: 'desc' }],
    });
  }

  async findTeamSummariesByBatchId(batchId: string): Promise<TeamIntelligenceTeamSummaryV2[]> {
    return await this.prisma.teamIntelligenceTeamSummaryV2.findMany({
      where: { batchId },
      orderBy: [{ teamName: 'asc' }],
    });
  }

  async findTeamSummariesByStatuses(
    statuses: TeamIntelligenceBatchStatus[]
  ): Promise<TeamIntelligenceTeamSummaryV2[]> {
    return await this.prisma.teamIntelligenceTeamSummaryV2.findMany({
      where: {
        status: { in: statuses },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async createTeamSummary(
    data: CreateTeamIntelligenceTeamSummaryData
  ): Promise<TeamIntelligenceTeamSummaryV2> {
    return await this.prisma.teamIntelligenceTeamSummaryV2.create({
      data,
    });
  }

  async updateTeamSummaryStatus(
    teamSummaryId: string,
    data: Partial<{
      teamName: string;
      totalUsers: number;
      completedUsers: number;
      failedUsers: number;
      status: TeamIntelligenceBatchStatus;
      queueJobId: string | null;
      queuedAt: Date | null;
      startedAt: Date | null;
      completedAt: Date | null;
      failedAt: Date | null;
      errorMessage: string | null;
    }>
  ): Promise<TeamIntelligenceTeamSummaryV2 | null> {
    const result = await this.prisma.teamIntelligenceTeamSummaryV2.updateMany({
      where: { id: teamSummaryId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return await this.prisma.teamIntelligenceTeamSummaryV2.findUnique({
      where: { id: teamSummaryId },
    });
  }

  async updateTeamSummaryStatuses(
    teamSummaryIds: string[],
    data: Partial<{
      totalUsers: number;
      completedUsers: number;
      failedUsers: number;
      status: TeamIntelligenceBatchStatus;
      queueJobId: string | null;
      queuedAt: Date | null;
      startedAt: Date | null;
      completedAt: Date | null;
      failedAt: Date | null;
      errorMessage: string | null;
    }>
  ): Promise<number> {
    if (teamSummaryIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.teamIntelligenceTeamSummaryV2.updateMany({
      where: { id: { in: teamSummaryIds } },
      data,
    });

    return result.count;
  }

  async updateTeamSummaryResult(
    teamSummaryId: string,
    data: {
      contentUrl?: string | null;
      contentSize?: number | null;
      contentChecksum?: string | null;
      totalUsers: number;
      completedUsers: number;
      failedUsers: number;
      status: TeamIntelligenceBatchStatus;
      completedAt?: Date | null;
      failedAt?: Date | null;
      errorMessage?: string | null;
    }
  ): Promise<TeamIntelligenceTeamSummaryV2 | null> {
    const result = await this.prisma.teamIntelligenceTeamSummaryV2.updateMany({
      where: { id: teamSummaryId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return await this.prisma.teamIntelligenceTeamSummaryV2.findUnique({
      where: { id: teamSummaryId },
    });
  }

  async findOrgSummaryByBatchId(batchId: string): Promise<TeamIntelligenceOrgSummaryV2 | null> {
    return await this.prisma.teamIntelligenceOrgSummaryV2.findUnique({
      where: { batchId },
    });
  }

  async findOrgSummaryById(orgSummaryId: string): Promise<TeamIntelligenceOrgSummaryV2 | null> {
    return await this.prisma.teamIntelligenceOrgSummaryV2.findUnique({
      where: { id: orgSummaryId },
    });
  }

  async findPreviousCompletedOrgSummary(
    orgId: string,
    beforeReportDate: Date
  ): Promise<TeamIntelligenceOrgSummaryV2 | null> {
    return await this.prisma.teamIntelligenceOrgSummaryV2.findFirst({
      where: {
        orgId,
        status: TeamIntelligenceBatchStatus.COMPLETED,
        reportDate: { lt: beforeReportDate },
        contentUrl: { not: null },
      },
      orderBy: [{ reportDate: 'desc' }, { completedAt: 'desc' }],
    });
  }

  async findOrgSummariesByStatuses(
    statuses: TeamIntelligenceBatchStatus[]
  ): Promise<TeamIntelligenceOrgSummaryV2[]> {
    return await this.prisma.teamIntelligenceOrgSummaryV2.findMany({
      where: {
        status: { in: statuses },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async createOrgSummary(data: CreateTeamIntelligenceOrgSummaryData): Promise<TeamIntelligenceOrgSummaryV2> {
    return await this.prisma.teamIntelligenceOrgSummaryV2.create({
      data,
    });
  }

  async updateOrgSummaryStatus(
    orgSummaryId: string,
    data: Partial<{
      totalTeams: number;
      completedTeams: number;
      failedTeams: number;
      status: TeamIntelligenceBatchStatus;
      queueJobId: string | null;
      queuedAt: Date | null;
      startedAt: Date | null;
      completedAt: Date | null;
      failedAt: Date | null;
      errorMessage: string | null;
    }>
  ): Promise<TeamIntelligenceOrgSummaryV2 | null> {
    const result = await this.prisma.teamIntelligenceOrgSummaryV2.updateMany({
      where: { id: orgSummaryId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return await this.prisma.teamIntelligenceOrgSummaryV2.findUnique({
      where: { id: orgSummaryId },
    });
  }

  async updateOrgSummaryStatuses(
    orgSummaryIds: string[],
    data: Partial<{
      totalTeams: number;
      completedTeams: number;
      failedTeams: number;
      status: TeamIntelligenceBatchStatus;
      queueJobId: string | null;
      queuedAt: Date | null;
      startedAt: Date | null;
      completedAt: Date | null;
      failedAt: Date | null;
      errorMessage: string | null;
    }>
  ): Promise<number> {
    if (orgSummaryIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.teamIntelligenceOrgSummaryV2.updateMany({
      where: { id: { in: orgSummaryIds } },
      data,
    });

    return result.count;
  }

  async updateOrgSummaryResult(
    orgSummaryId: string,
    data: {
      contentUrl?: string | null;
      contentSize?: number | null;
      contentChecksum?: string | null;
      totalTeams: number;
      completedTeams: number;
      failedTeams: number;
      status: TeamIntelligenceBatchStatus;
      completedAt?: Date | null;
      failedAt?: Date | null;
      errorMessage?: string | null;
    }
  ): Promise<TeamIntelligenceOrgSummaryV2 | null> {
    const result = await this.prisma.teamIntelligenceOrgSummaryV2.updateMany({
      where: { id: orgSummaryId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return await this.prisma.teamIntelligenceOrgSummaryV2.findUnique({
      where: { id: orgSummaryId },
    });
  }

  async getTeamProgress(batchId: string, teamId: string): Promise<TeamIntelligenceTeamProgress> {
    const [totalUsers, completedUsers, failedUsers] = await this.prisma.$transaction([
      this.prisma.teamIntelligenceUserIngestionV2.count({
        where: { batchId, teamId },
      }),
      this.prisma.teamIntelligenceUserIngestionV2.count({
        where: {
          batchId,
          teamId,
          processingStatus: TeamIntelligenceUserIngestionStatus.COMPLETED,
        },
      }),
      this.prisma.teamIntelligenceUserIngestionV2.count({
        where: {
          batchId,
          teamId,
          processingStatus: TeamIntelligenceUserIngestionStatus.FAILED,
        },
      }),
    ]);

    return {
      totalUsers,
      completedUsers,
      failedUsers,
    };
  }

  async getBatchProgress(batchId: string): Promise<TeamIntelligenceBatchProgress> {
    const [
      totalUsers,
      completedUsers,
      failedUsers,
      processingUsers,
      queuedUsers,
    ] = await this.prisma.$transaction([
      this.prisma.teamIntelligenceUserIngestionV2.count({ where: { batchId } }),
      this.prisma.teamIntelligenceUserIngestionV2.count({
        where: {
          batchId,
          processingStatus: TeamIntelligenceUserIngestionStatus.COMPLETED,
        },
      }),
      this.prisma.teamIntelligenceUserIngestionV2.count({
        where: {
          batchId,
          processingStatus: TeamIntelligenceUserIngestionStatus.FAILED,
        },
      }),
      this.prisma.teamIntelligenceUserIngestionV2.count({
        where: {
          batchId,
          processingStatus: TeamIntelligenceUserIngestionStatus.PROCESSING,
        },
      }),
      this.prisma.teamIntelligenceUserIngestionV2.count({
        where: {
          batchId,
          processingStatus: TeamIntelligenceUserIngestionStatus.QUEUED,
        },
      }),
    ]);

    return {
      totalUsers,
      completedUsers,
      failedUsers,
      processingUsers,
      queuedUsers,
    };
  }

  async getOrgProgress(batchId: string): Promise<TeamIntelligenceOrgProgress> {
    const [totalTeams, completedTeams, failedTeams] = await this.prisma.$transaction([
      this.prisma.teamIntelligenceTeamSummaryV2.count({
        where: { batchId },
      }),
      this.prisma.teamIntelligenceTeamSummaryV2.count({
        where: {
          batchId,
          status: TeamIntelligenceBatchStatus.COMPLETED,
        },
      }),
      this.prisma.teamIntelligenceTeamSummaryV2.count({
        where: {
          batchId,
          status: TeamIntelligenceBatchStatus.FAILED,
        },
      }),
    ]);

    return {
      totalTeams,
      completedTeams,
      failedTeams,
    };
  }
}

export const teamIntelligenceRepository = new TeamIntelligenceRepository();
