import {
  Prisma,
  PrismaClient,
  TeamIntelligenceBatchStatus,
  TeamIntelligenceIngestionBatch,
  TeamIntelligenceOrgSummary,
  TeamIntelligenceTeamSummary,
  TeamIntelligenceUserIngestion,
  TeamIntelligenceUserIngestionStatus,
} from '@prisma/client';
import { db } from '@/database/client';

export interface CreateTeamIntelligenceBatchData {
  reportDate: Date;
  source: string;
  idempotencyKey: string;
  requestChecksum: string;
  requestPayload: Prisma.InputJsonValue;
  totalUsers: number;
  status: TeamIntelligenceBatchStatus;
}

export interface CreateTeamIntelligenceUserData {
  reportDate: Date;
  source: string;
  userEmail: string;
  userName: string;
  teamName: string | null;
  pullRequests: Prisma.InputJsonValue;
  soloCommits: Prisma.InputJsonValue;
  aiUsage: Prisma.InputJsonValue | null;
  processingStatus: TeamIntelligenceUserIngestionStatus;
  queueJobId: string;
}

export interface TeamIntelligenceBatchWithUsers {
  batch: TeamIntelligenceIngestionBatch;
  users: TeamIntelligenceUserIngestion[];
}

export interface TeamIntelligenceBatchProgress {
  totalUsers: number;
  completedUsers: number;
  failedUsers: number;
  processingUsers: number;
  queuedUsers: number;
}

export interface CreateTeamIntelligenceTeamSummaryData {
  batchId: string;
  reportDate: Date;
  source: string;
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
    const batch = await this.prisma.teamIntelligenceIngestionBatch.findUnique({
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
      const batch = await transaction.teamIntelligenceIngestionBatch.create({
        data: batchData,
      });

      const users = await Promise.all(
        usersData.map((userData) =>
          transaction.teamIntelligenceUserIngestion.create({
            data: {
              ...userData,
              rawPayload: {},
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
  ): Promise<TeamIntelligenceIngestionBatch> {
    return await this.prisma.teamIntelligenceIngestionBatch.update({
      where: { id: batchId },
      data,
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
  ): Promise<TeamIntelligenceUserIngestion> {
    return await this.prisma.teamIntelligenceUserIngestion.update({
      where: { id: userIngestionId },
      data,
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

    const result = await this.prisma.teamIntelligenceUserIngestion.updateMany({
      where: { id: { in: userIngestionIds } },
      data,
    });

    return result.count;
  }

  async findUserIngestionById(userIngestionId: string): Promise<TeamIntelligenceUserIngestion | null> {
    return await this.prisma.teamIntelligenceUserIngestion.findUnique({
      where: { id: userIngestionId },
    });
  }

  async findUsersByStatuses(
    statuses: TeamIntelligenceUserIngestionStatus[]
  ): Promise<TeamIntelligenceUserIngestion[]> {
    return await this.prisma.teamIntelligenceUserIngestion.findMany({
      where: {
        processingStatus: { in: statuses },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async findUsersByBatchAndTeam(
    batchId: string,
    teamName: string,
    statuses?: TeamIntelligenceUserIngestionStatus[]
  ): Promise<TeamIntelligenceUserIngestion[]> {
    return await this.prisma.teamIntelligenceUserIngestion.findMany({
      where: {
        batchId,
        teamName,
        ...(statuses ? { processingStatus: { in: statuses } } : {}),
      },
      orderBy: [{ userEmail: 'asc' }],
    });
  }

  async updateUserIngestionSummary(
    userIngestionId: string,
    data: {
      pullRequests: Prisma.InputJsonValue;
      soloCommits: Prisma.InputJsonValue;
      employeeSummary: Prisma.InputJsonValue;
      summaryMetadata: Prisma.InputJsonValue;
      processingStatus: TeamIntelligenceUserIngestionStatus;
      completedAt?: Date | null;
      failedAt?: Date | null;
      errorMessage?: string | null;
    }
  ): Promise<TeamIntelligenceUserIngestion> {
    return await this.prisma.teamIntelligenceUserIngestion.update({
      where: { id: userIngestionId },
      data,
    });
  }

  async findTeamSummaryByBatchAndTeam(
    batchId: string,
    teamName: string
  ): Promise<TeamIntelligenceTeamSummary | null> {
    return await this.prisma.teamIntelligenceTeamSummary.findUnique({
      where: {
        batchId_teamName: {
          batchId,
          teamName,
        },
      },
    });
  }

  async findTeamSummaryById(teamSummaryId: string): Promise<TeamIntelligenceTeamSummary | null> {
    return await this.prisma.teamIntelligenceTeamSummary.findUnique({
      where: { id: teamSummaryId },
    });
  }

  async findTeamSummariesByBatchId(batchId: string): Promise<TeamIntelligenceTeamSummary[]> {
    return await this.prisma.teamIntelligenceTeamSummary.findMany({
      where: { batchId },
      orderBy: [{ teamName: 'asc' }],
    });
  }

  async findTeamSummariesByStatuses(
    statuses: TeamIntelligenceBatchStatus[]
  ): Promise<TeamIntelligenceTeamSummary[]> {
    return await this.prisma.teamIntelligenceTeamSummary.findMany({
      where: {
        status: { in: statuses },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async createTeamSummary(
    data: CreateTeamIntelligenceTeamSummaryData
  ): Promise<TeamIntelligenceTeamSummary> {
    return await this.prisma.teamIntelligenceTeamSummary.create({
      data,
    });
  }

  async updateTeamSummaryStatus(
    teamSummaryId: string,
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
  ): Promise<TeamIntelligenceTeamSummary> {
    return await this.prisma.teamIntelligenceTeamSummary.update({
      where: { id: teamSummaryId },
      data,
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

    const result = await this.prisma.teamIntelligenceTeamSummary.updateMany({
      where: { id: { in: teamSummaryIds } },
      data,
    });

    return result.count;
  }

  async updateTeamSummaryResult(
    teamSummaryId: string,
    data: {
      summaryText: Prisma.InputJsonValue;
      summaryMetadata: Prisma.InputJsonValue;
      provenance: Prisma.InputJsonValue;
      totalUsers: number;
      completedUsers: number;
      failedUsers: number;
      status: TeamIntelligenceBatchStatus;
      completedAt?: Date | null;
      failedAt?: Date | null;
      errorMessage?: string | null;
    }
  ): Promise<TeamIntelligenceTeamSummary> {
    return await this.prisma.teamIntelligenceTeamSummary.update({
      where: { id: teamSummaryId },
      data,
    });
  }

  async findOrgSummaryByBatchId(batchId: string): Promise<TeamIntelligenceOrgSummary | null> {
    return await this.prisma.teamIntelligenceOrgSummary.findUnique({
      where: { batchId },
    });
  }

  async findOrgSummaryById(orgSummaryId: string): Promise<TeamIntelligenceOrgSummary | null> {
    return await this.prisma.teamIntelligenceOrgSummary.findUnique({
      where: { id: orgSummaryId },
    });
  }

  async findOrgSummariesByStatuses(
    statuses: TeamIntelligenceBatchStatus[]
  ): Promise<TeamIntelligenceOrgSummary[]> {
    return await this.prisma.teamIntelligenceOrgSummary.findMany({
      where: {
        status: { in: statuses },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async createOrgSummary(data: CreateTeamIntelligenceOrgSummaryData): Promise<TeamIntelligenceOrgSummary> {
    return await this.prisma.teamIntelligenceOrgSummary.create({
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
  ): Promise<TeamIntelligenceOrgSummary> {
    return await this.prisma.teamIntelligenceOrgSummary.update({
      where: { id: orgSummaryId },
      data,
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

    const result = await this.prisma.teamIntelligenceOrgSummary.updateMany({
      where: { id: { in: orgSummaryIds } },
      data,
    });

    return result.count;
  }

  async updateOrgSummaryResult(
    orgSummaryId: string,
    data: {
      summaryText: Prisma.InputJsonValue;
      summaryMetadata: Prisma.InputJsonValue;
      provenance: Prisma.InputJsonValue;
      totalTeams: number;
      completedTeams: number;
      failedTeams: number;
      status: TeamIntelligenceBatchStatus;
      completedAt?: Date | null;
      failedAt?: Date | null;
      errorMessage?: string | null;
    }
  ): Promise<TeamIntelligenceOrgSummary> {
    return await this.prisma.teamIntelligenceOrgSummary.update({
      where: { id: orgSummaryId },
      data,
    });
  }

  async getTeamProgress(batchId: string, teamName: string): Promise<TeamIntelligenceTeamProgress> {
    const [totalUsers, completedUsers, failedUsers] = await this.prisma.$transaction([
      this.prisma.teamIntelligenceUserIngestion.count({
        where: { batchId, teamName },
      }),
      this.prisma.teamIntelligenceUserIngestion.count({
        where: {
          batchId,
          teamName,
          processingStatus: TeamIntelligenceUserIngestionStatus.COMPLETED,
        },
      }),
      this.prisma.teamIntelligenceUserIngestion.count({
        where: {
          batchId,
          teamName,
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
      this.prisma.teamIntelligenceUserIngestion.count({ where: { batchId } }),
      this.prisma.teamIntelligenceUserIngestion.count({
        where: {
          batchId,
          processingStatus: TeamIntelligenceUserIngestionStatus.COMPLETED,
        },
      }),
      this.prisma.teamIntelligenceUserIngestion.count({
        where: {
          batchId,
          processingStatus: TeamIntelligenceUserIngestionStatus.FAILED,
        },
      }),
      this.prisma.teamIntelligenceUserIngestion.count({
        where: {
          batchId,
          processingStatus: TeamIntelligenceUserIngestionStatus.PROCESSING,
        },
      }),
      this.prisma.teamIntelligenceUserIngestion.count({
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
      this.prisma.teamIntelligenceTeamSummary.count({
        where: { batchId },
      }),
      this.prisma.teamIntelligenceTeamSummary.count({
        where: {
          batchId,
          status: TeamIntelligenceBatchStatus.COMPLETED,
        },
      }),
      this.prisma.teamIntelligenceTeamSummary.count({
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
