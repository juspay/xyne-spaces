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
  ticketId?: string;
}

interface PRInsertProps extends BasePRProps {
  childExecutionId: string;
  ticketId?: string;
}

interface PRCrudProps extends BasePRProps {
  numberOfComments: number;
}


export class PRMetricsRepository {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = db;
  }

  /**
   * Get ticketId from workflowExecutionId by traversing the chain:
   * WorkflowExecution → Workflow → Ticket
   * Returns null if chain lookup fails
   */
  async getTicketIdForWorkflowExecution(workflowExecutionId: string): Promise<string | null> {
    try {
      console.log(`[PR-Repository] Looking up ticketId via workflowExecutionId: ${workflowExecutionId}`);

      const workflowExecution = await this.prisma.workflowExecution.findUnique({
        where: { id: workflowExecutionId },
        select: { workflowId: true }
      });

      if (!workflowExecution) {
        console.log(`[PR-Repository] WorkflowExecution ${workflowExecutionId} not found`);
        return null;
      }

      const workflow = await this.prisma.workflow.findUnique({
        where: { id: workflowExecution.workflowId },
        select: { ticketId: true }
      });

      if (!workflow || !workflow.ticketId) {
        console.log(`[PR-Repository] Workflow or ticketId not found for workflowExecutionId ${workflowExecutionId}`);
        return null;
      }

      console.log(`[PR-Repository] Found ticketId ${workflow.ticketId} via workflow chain`);
      return workflow.ticketId;
    } catch (error) {
      console.error(`[PR-Repository] Error looking up ticketId from workflowExecutionId ${workflowExecutionId}:`, error);
      return null;
    }
  }

  async insertPRIfNotPresent({
    prUrl,
    prId,
    childExecutionId,
    repoName,
    sourceBranchName,
    destinationBranchName,
    repoUrl: repositoryUrl,
    ticketId
  }: PRInsertProps): Promise<PullRequests> {
    const today = new Date();
    // today.setHours(0, 0, 0, 0);
    console.log(`[PR-Repository] Inserting/updating PR ${prId} with ticketId: ${ticketId || 'none'}`);

    // First find by workflowExecutionId
    const existingPr = await this.prisma.pullRequests.findFirst({
      where: { workflowExecutionId: childExecutionId }
    });

    if (existingPr) {
      // Update existing PR
      return await this.prisma.pullRequests.update({
        where: { id: existingPr.id },
        data: {
          date: today,
          status: 'OPEN',
          repositoryUrl,
          prUrl,
          prId,
          repoName,
          sourceBranchName,
          destinationBranchName,
          ...(ticketId ? { ticketId } : {})
        }
      });
    }

    // Create new PR
    return await this.prisma.pullRequests.create({
      data: {
        date: today,
        sourceBranchName,
        destinationBranchName,
        status: 'OPEN',
        prUrl,
        prId: prId,
        repositoryUrl,
        repoName,
        workflowExecutionId: childExecutionId,
        ticketId
      }
    });
  }

  async markMergedPr({
    prId,
    repoUrl,
    prUrl,
    numberOfComments
  }: PRCrudProps): Promise<{ pr: PullRequests; statusChanged: boolean; previousStatus: string } | null> {
    try {
      // Get the current PR to check if status is changing
      const currentPr = await this.prisma.pullRequests.findFirst({
        where: { prId, prUrl }
      });

      if (!currentPr) {
        console.log(`Ignoring webhook for manual PR: ${prUrl} (not created by Xyne)`);
        return null;
      }

      const previousStatus = currentPr.status;
      const statusChanged = previousStatus !== 'MERGED';

      await this.prisma.pullRequests.updateMany({
        where: { prId, prUrl },
        data: {
          status: 'MERGED',
          numberOfComments,
          repositoryUrl: repoUrl
        }
      });

      return { pr: currentPr, statusChanged, previousStatus };
    } catch (err) {
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
    numberOfComments,
    ticketId
  }: PRCrudProps & { ticketId?: string }): Promise<{isNew: boolean; statusChanged: boolean; previousStatus: string | null }> {
    const today = new Date();
    // today.setHours(0, 0, 0, 0);

    // Check if PR exists to determine if this is a create or update
    const existingPr = await this.prisma.pullRequests.findFirst({
      where: { prId, prUrl }
    });

    const isNew = !existingPr;
    const previousStatus = existingPr?.status ?? null;
    const statusChanged = existingPr ? existingPr.status !== 'OPEN' : false;

    if (existingPr) {
      await this.prisma.pullRequests.updateMany({
        where: { prId, prUrl },
        data: {
          status: 'OPEN',
          numberOfComments,
          ...(ticketId ? { ticketId } : {})
        }
      });
      return {
        isNew,
        statusChanged,
        previousStatus
      };
    } else {
      await this.prisma.pullRequests.create({
        data: {
          date: today,
          sourceBranchName,
          destinationBranchName,
          prUrl,
          repoName,
          status: 'OPEN',
          prId,
          repositoryUrl: repoUrl,
          numberOfComments,
          ticketId
        }
      });
      return { isNew, statusChanged, previousStatus };
    }
  }

  async markDeclinedPr({
    prId,
    repoUrl,
    numberOfComments,
    prUrl
  }: PRCrudProps): Promise<{ statusChanged: boolean; previousStatus: string } | null> {
    try {
      // Get the current PR to check if status is changing
      const currentPr = await this.prisma.pullRequests.findFirst({
        where: { prId, prUrl }
      });

      if (!currentPr) {
        console.log(`Ignoring webhook for manual PR: ${prUrl} (not created by Xyne)`);
        return null;
      }

      const previousStatus = currentPr.status;
      const statusChanged = previousStatus !== 'DECLINED';

      await this.prisma.pullRequests.updateMany({
        where: { prId, prUrl },
        data: {
          status: 'DECLINED',
          repositoryUrl: repoUrl,
          numberOfComments
        }
      });

      return { statusChanged, previousStatus };
    } catch (err) {
      // PR doesn't exist in our DB (manual PR), ignore it
      logger.info(`Ignoring webhook for manual PR: ${prUrl} (not created by Xyne)`);
      return null;
    }
  }

  async findDuplicatePR(
    ticketId: string,
    sourceBranch: string,
    destBranch: string,
    excludePrId?: number
  ): Promise<PullRequests | null> {
    const duplicatePR = await this.prisma.pullRequests.findFirst({
      where: {
        ticketId,
        sourceBranchName: sourceBranch,
        destinationBranchName: destBranch,
        status: 'OPEN',
        ...(excludePrId !== undefined && { NOT: { prId: excludePrId } })
      }
    });

    if (duplicatePR) {
      console.log(`[PR-Repository] Found duplicate PR ${duplicatePR.prId} for ticket ${ticketId}, ` +
        `workflowExecutionId: ${duplicatePR.workflowExecutionId || 'none'}`);
    }

    return duplicatePR;
  }

  /**
   * Count all OPEN PRs for a ticket, excluding the current PR being merged
   * Uses groupBy to count unique PRs by prId + prUrl (since multiple entries can exist)
   */
  async countOpenPRsForTicket(
    ticketId: string,
    excludePrId: number,
    excludePrUrl: string
  ): Promise<number> {
    // Count PRs with direct ticketId link
    const directPRs = await this.prisma.pullRequests.groupBy({
      by: ['prId', 'prUrl'],
      where: {
        ticketId,
        status: 'OPEN',
        NOT: {
          AND: [
            { prId: excludePrId },
            { prUrl: excludePrUrl }
          ]
        }
      }
    });

    // Find PRs linked via workflowExecutionId chain
    // First, get all workflow executions for the ticket
    const workflowsForTicket = await this.prisma.workflow.findMany({
      where: { ticketId },
      select: { id: true }
    });

    const workflowIds = workflowsForTicket.map(w => w.id);

    // Get workflow execution IDs for these workflows
    const workflowExecutions = await this.prisma.workflowExecution.findMany({
      where: { workflowId: { in: workflowIds } },
      select: { id: true }
    });

    const workflowExecutionIds = workflowExecutions.map(we => we.id);

    // Count PRs linked via workflowExecutionId that don't have direct ticketId
    // (to avoid double counting)
    const chainedPRs = await this.prisma.pullRequests.groupBy({
      by: ['prId', 'prUrl'],
      where: {
        workflowExecutionId: { in: workflowExecutionIds },
        ticketId: null, // Only count if not already linked directly
        status: 'OPEN',
        NOT: {
          AND: [
            { prId: excludePrId },
            { prUrl: excludePrUrl }
          ]
        }
      }
    });

    const allPRs = [...directPRs, ...chainedPRs];
    const uniquePRs = new Set(allPRs.map(p => `${p.prId}:${p.prUrl}`));

    const totalCount = uniquePRs.size;
    console.log(`[PR-Repository] Found ${totalCount} unique open PRs for ticket ${ticketId} ` +
      `(direct: ${directPRs.length}, chained: ${chainedPRs.length}), excluding PR ${excludePrId}`);

    return totalCount;
  }

  async createOrUpdatePR({
    prId,
    prUrl,
    repoName,
    repoUrl: repositoryUrl,
    sourceBranchName,
    destinationBranchName,
    numberOfComments,
    ticketId
  }: {
    prId: number;
    prUrl: string;
    repoName: string;
    repoUrl: string;
    sourceBranchName: string;
    destinationBranchName: string;
    numberOfComments: number;
    ticketId: string;
  }): Promise<void> {
    const today = new Date();
    
    const existingPr = await this.prisma.pullRequests.findFirst({
      where: { prId, prUrl }
    });

    if (existingPr) {
      await this.prisma.pullRequests.updateMany({
        where: { prId, prUrl },
        data: {
          numberOfComments,
          ticketId,
          updatedAt: today
        }
      });
      return;
    }

    await this.prisma.pullRequests.create({
      data: {
        date: today,
        sourceBranchName,
        destinationBranchName,
        status: 'OPEN',
        prUrl,
        prId,
        repositoryUrl,
        repoName,
        numberOfComments,
        ticketId
      }
    });
  }

  /**
   * Find the most recent PR record by workflow execution ID
   * Returns the PR with the latest updatedAt timestamp
   */
  async findByWorkflowExecutionId(workflowExecutionId: string): Promise<PullRequests | null> {
    return await this.prisma.pullRequests.findFirst({
      where: { workflowExecutionId },
      orderBy: { updatedAt: 'desc' }
    });
  }

}
