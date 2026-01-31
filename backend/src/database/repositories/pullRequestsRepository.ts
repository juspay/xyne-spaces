import { PrismaClient, PullRequests } from '@prisma/client';
import { db } from '../client';
import {logger} from '@/utils/logger';

// Base interface with common PR properties
interface BasePRProps {
  prId: number;
  repoUrl: string;
  prUrl: string;
  repoName: string;
  destinationBranchName: string;
  sourceBranchName: string;
}

interface PRInsertProps extends BasePRProps {
  childExecutionId: string;
}

interface PRCrudProps extends BasePRProps {
  numberOfComments: number;
}


export class PRMetricsRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = db;
  }

  async insertPRIfNotPresent({
    prUrl,
    prId,
    childExecutionId,
    repoName,
    sourceBranchName,
    destinationBranchName,
    repoUrl: repositoryUrl
  }: PRInsertProps): Promise<PullRequests> {
    const today = new Date();
    // today.setHours(0, 0, 0, 0);
    return await this.prisma.pullRequests.upsert({
      where: {
        prId_prUrl: {
          prId,
          prUrl
        }
      },
      update: {
        date: today,
        status: 'OPEN',
        repositoryUrl,
        workflowExecutionId: childExecutionId
      },
      create: {
        date: today,
        sourceBranchName,
        destinationBranchName,
        status: 'OPEN',
        prUrl,
        prId: prId,
        repositoryUrl,
        repoName,
        workflowExecutionId: childExecutionId
      }
    })
  }

  async markMergedPr({
    prId,
    repoUrl,
    prUrl,
    numberOfComments
  }: PRCrudProps): Promise<PullRequests | null> {
    try {
      return await this.prisma.pullRequests.update({
        where: {
          prId_prUrl: {
            prId,
            prUrl
          }
        },
        data: {
          status: 'MERGED',
          numberOfComments,
          repositoryUrl: repoUrl
        }
      });
    } catch (err) {
      // PR doesn't exist in our DB (manual PR), ignore it
      logger.info(`Ignoring webhook for manual PR: ${prUrl} (not created by Xyne)`);
      return null;
    }
  }

  async markOrCreateOpenPr({
    repoName,
    sourceBranchName,
    destinationBranchName,
    prId,
    repoUrl,
    prUrl,
    numberOfComments
  }: PRCrudProps): Promise<PullRequests> {
    const today = new Date();
    // today.setHours(0, 0, 0, 0);
    return await this.prisma.pullRequests.upsert({
      where: {
        prId_prUrl: {
          prId,
          prUrl
        }
      },
      create: {
        date: today,
        sourceBranchName,
        destinationBranchName,
        prUrl,
        repoName,
        status: 'OPEN',
        prId,
        repositoryUrl: repoUrl,
        numberOfComments
      },
      update: {
        status: 'OPEN',
        numberOfComments
      }
    })
  }

  async markDeclinedPr({
    prId,
    repoUrl,
    numberOfComments,
    prUrl
  }: PRCrudProps): Promise<PullRequests | null> {
    try {
      return await this.prisma.pullRequests.update({
        where: {
          prId_prUrl: {
            prId,
            prUrl
          }
        },
        data: {
          status: 'DECLINED',
          repositoryUrl: repoUrl,
          numberOfComments
        }
      });
    } catch (err) {
      // PR doesn't exist in our DB (manual PR), ignore it
      logger.info(`Ignoring webhook for manual PR: ${prUrl} (not created by Xyne)`);
      return null;
    }
  }

}
