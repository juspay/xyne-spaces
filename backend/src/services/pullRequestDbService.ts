import { PrismaClient, PRStatus } from '@prisma/client';
import { PullRequestDataWithRepo } from '../types/bitbucket.js';
import { DatabaseClient } from '@/database/client';
import {logger} from '@/utils/logger';

export class PullRequestDbService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  /**
   * Map Bitbucket status to database PRStatus enum
   */
  private mapStatusToPRStatus(status: string): PRStatus {
    switch (status) {
      case 'Merged':
        return PRStatus.MERGED;
      case 'Rejected':
        return PRStatus.DECLINED;
      case 'Pending':
      case 'Commented':
      case 'Approved':
      case 'OPEN':
      default:
        return PRStatus.OPEN;
    }
  }

  /**
   * Save or update pull requests in the database
   */
  async savePullRequests(pullRequests: PullRequestDataWithRepo[]): Promise<{
    created: number;
    updated: number;
    errors: Array<{ prId: number; error: string }>;
  }> {
    const results = {
      created: 0,
      updated: 0,
      errors: [] as Array<{ prId: number; error: string }>
    };

    for (const pr of pullRequests) {
      try {
        const existingPR = await this.prisma.pullRequests.findUnique({
          where: {
            prId_prUrl: {
              prId: pr.pr_id,
              prUrl: pr.prUrl
            }
          }
        });

        const prData = {
          prId: pr.pr_id,
          repoName: pr.repositorySlug,
          sourceBranchName: pr.sourceBranchName,
          destinationBranchName: pr.destinationBranchName,
          date: new Date(pr.date),
          numberOfComments: pr.numberOfComments,
          repositoryUrl: pr.repositoryURL,
          prUrl: pr.prUrl,
          status: this.mapStatusToPRStatus(pr.status)
        };

        if (existingPR) {
          // Update existing record
          await this.prisma.pullRequests.update({
            where: {
              prId_prUrl: {
                prId: pr.pr_id,
                prUrl: pr.prUrl
              }
            },
            data: {
              numberOfComments: prData.numberOfComments,
              status: prData.status,
              updatedAt: new Date()
            }
          });
          results.updated++;
        } else {
          // Create new record
          await this.prisma.pullRequests.create({
            data: prData
          });
          results.created++;
        }
      } catch (error) {
        logger.error(`Error saving PR ${pr.pr_id}:`, error);
        results.errors.push({
          prId: pr.pr_id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  }

  /**
   * Get pull requests from database with filters
   */
  async getPullRequestsFromDb(filters: {
    days?: number;
    repositorySlugs?: string[];
    status?: PRStatus;
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<any[]> {
    const where: any = {};

    // Date filtering
    if (filters.days) {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - filters.days);
      where.date = {
        gte: fromDate
      };
    }

    if (filters.startDate && filters.endDate) {
      where.date = {
        gte: filters.startDate,
        lte: filters.endDate
      };
    }


    // Repository filtering
    if (filters.repositorySlugs && filters.repositorySlugs.length > 0) {
      where.repoName = {
        in: filters.repositorySlugs
      };
    }

    // Status filtering
    if (filters.status) {
      where.status = filters.status;
    }

    return await this.prisma.pullRequests.findMany({
      where,
      orderBy: {
        date: 'desc'
      }
    });
  }

  /**
   * Get pull request statistics from database
   */
  async getPullRequestStatsFromDb(filters: {
    days?: number;
    repositorySlugs?: string[];
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byRepository: Record<string, number>;
    totalComments: number;
    averageCommentsPerPR: number;
  }> {
    const where: any = {};

    // Date filtering
    if (filters.days) {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - filters.days);
      where.date = {
        gte: fromDate
      };
    }

    if (filters.startDate && filters.endDate) {
      where.date = {
        gte: filters.startDate,
        lte: filters.endDate
      };
    }


    // Repository filtering
    if (filters.repositorySlugs && filters.repositorySlugs.length > 0) {
      where.repoName = {
        in: filters.repositorySlugs
      };
    }

    const pullRequests = await this.prisma.pullRequests.findMany({
      where,
      select: {
        status: true,
        repoName: true,
        numberOfComments: true
      }
    });

    const stats = {
      total: pullRequests.length,
      byStatus: {} as Record<string, number>,
      byRepository: {} as Record<string, number>,
      totalComments: 0,
      averageCommentsPerPR: 0
    };

    pullRequests.forEach(pr => {
      // Count by status
      stats.byStatus[pr.status] = (stats.byStatus[pr.status] || 0) + 1;

      // Count by repository
      stats.byRepository[pr.repoName] = (stats.byRepository[pr.repoName] || 0) + 1;

      // Sum comments
      stats.totalComments += pr.numberOfComments;
    });

    stats.averageCommentsPerPR = stats.total > 0 ? stats.totalComments / stats.total : 0;

    return stats;
  }

  /**
   * Get repository list from database
   */
  async getRepositoriesFromDb(): Promise<Array<{ repoName: string; count: number }>> {
    const result = await this.prisma.pullRequests.groupBy({
      by: ['repoName'],
      _count: {
        prId: true
      },
      orderBy: {
        repoName: 'asc'
      }
    });

    return result.map(item => ({
      repoName: item.repoName,
      count: item._count.prId || 0
    }));
  }

  /**
   * Clean up old pull requests (optional - for data maintenance)
   */
  async cleanupOldPullRequests(olderThanDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.prisma.pullRequests.deleteMany({
      where: {
        date: {
          lt: cutoffDate
        }
      }
    });

    return result.count;
  }

  /**
   * Close the database connection
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
