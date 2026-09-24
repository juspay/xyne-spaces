import { PrismaClient, PullRequests } from '@prisma/client';
import { PRStatus } from '@xyne/shared';
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

type PRStatusUpdateProps = Pick<
  PRCrudProps,
  'prId' | 'repoUrl' | 'prUrl' | 'numberOfComments'
> & Partial<Pick<PRCrudProps, 'repoName' | 'destinationBranchName' | 'sourceBranchName'>>;


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
      logger.debug(`[PR-Repository] Looking up ticketId via workflowExecutionId: ${workflowExecutionId}`);

      const workflowExecution = await this.prisma.workflowExecution.findUnique({
        where: { id: workflowExecutionId },
        select: { workflowId: true }
      });

      if (!workflowExecution) {
        logger.debug(`[PR-Repository] WorkflowExecution ${workflowExecutionId} not found`);
        return null;
      }

      const workflow = await this.prisma.workflow.findUnique({
        where: { id: workflowExecution.workflowId },
        select: { ticketId: true }
      });

      if (!workflow || !workflow.ticketId) {
        logger.debug(`[PR-Repository] No ticketId found for workflowExecutionId ${workflowExecutionId}`);
        return null;
      }

      logger.debug(`[PR-Repository] Resolved ticketId ${workflow.ticketId} via workflow chain`);
      return workflow.ticketId;
    } catch (error) {
      logger.error(`[PR-Repository] Error looking up ticketId from workflowExecutionId ${workflowExecutionId}:`, error);
      return null;
    }
  }

  /**
   * Resolve the workspaceId to denormalize onto a PullRequests row from its
   * linked ticket, or (failing that) from its workflow execution. Throws when
   * neither can supply one so we never persist a PR without a real tenant key.
   */
  private async resolvePrWorkspaceId(opts: {
    ticketId?: string | null;
    workflowExecutionId?: string | null;
  }): Promise<string> {
    if (opts.ticketId) {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: opts.ticketId },
        select: { workspaceId: true },
      });
      if (ticket) return ticket.workspaceId;
    }
    if (opts.workflowExecutionId) {
      const execution = await this.prisma.workflowExecution.findUnique({
        where: { id: opts.workflowExecutionId },
        select: { workspaceId: true },
      });
      if (execution) return execution.workspaceId;
    }
    throw new Error('workspaceId required: cannot resolve from ticket or workflow execution');
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
    logger.debug(`[PR-Repository] Inserting/updating PR ${prId} for workflowExecutionId: ${childExecutionId}`);

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
          status: PRStatus.OPEN,
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
    const workspaceId = await this.resolvePrWorkspaceId({ ticketId, workflowExecutionId: childExecutionId });
    return await this.prisma.pullRequests.create({
      data: {
        date: today,
        sourceBranchName,
        destinationBranchName,
        status: PRStatus.OPEN,
        prUrl,
        prId: prId,
        repositoryUrl,
        repoName,
        workflowExecutionId: childExecutionId,
        ticketId,
        workspaceId
      }
    });
  }

  async markMergedPr({
    prId,
    repoUrl,
    prUrl,
    numberOfComments,
    // Commit authorship tracking fields
    botCommitCount,
    humanCommitCount,
    unknownCommitCount,
    commitAnalysisStatus,
    commitAnalysisError,
  }: PRStatusUpdateProps & {
    botCommitCount?: number;
    humanCommitCount?: number;
    unknownCommitCount?: number;
    commitAnalysisStatus?: string;
    commitAnalysisError?: string | null;
  }): Promise<{ pr: PullRequests; statusChanged: boolean; previousStatus: string } | null> {
    try {
      // Get the current PR to check if status is changing
      const currentPr = await this.prisma.pullRequests.findFirst({
        where: { prId, prUrl }
      });

      if (!currentPr) {
        logger.debug(`[PR-Repository] Ignoring merge webhook for untracked PR: ${prUrl}`);
        return null;
      }

      const previousStatus = currentPr.status;
      const statusChanged = previousStatus !== 'MERGED';

      await this.prisma.pullRequests.updateMany({
        where: { prId, prUrl },
        data: {
          status: PRStatus.MERGED,
          numberOfComments,
          repositoryUrl: repoUrl,
          // Conditionally include authorship fields
          ...(botCommitCount !== undefined && { botCommitCount }),
          ...(humanCommitCount !== undefined && { humanCommitCount }),
          ...(unknownCommitCount !== undefined && { unknownCommitCount }),
          ...(commitAnalysisStatus && { commitAnalysisStatus }),
          ...(commitAnalysisError !== undefined && { commitAnalysisError }),
          ...(commitAnalysisStatus && { commitAnalyzedAt: new Date() }),
        }
      });

      return { pr: currentPr, statusChanged, previousStatus };
    } catch (err) {
      logger.error(`[PR-Repository] Error marking PR as merged for ${prUrl}:`, err);
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
          status: PRStatus.OPEN,
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
      const workspaceId = await this.resolvePrWorkspaceId({ ticketId });
      await this.prisma.pullRequests.create({
        data: {
          date: today,
          sourceBranchName,
          destinationBranchName,
          prUrl,
          repoName,
          status: PRStatus.OPEN,
          prId,
          repositoryUrl: repoUrl,
          numberOfComments,
          ticketId,
          workspaceId
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
  }: PRStatusUpdateProps): Promise<{ pr: PullRequests; statusChanged: boolean; previousStatus: string } | null> {
    try {
      // Get the current PR to check if status is changing
      const currentPr = await this.prisma.pullRequests.findFirst({
        where: { prId, prUrl }
      });

      if (!currentPr) {
        logger.debug(`[PR-Repository] Ignoring decline webhook for untracked PR: ${prUrl}`);
        return null;
      }

      const previousStatus = currentPr.status;
      const statusChanged = previousStatus !== 'DECLINED';

      await this.prisma.pullRequests.updateMany({
        where: { prId, prUrl },
        data: {
          status: PRStatus.DECLINED,
          repositoryUrl: repoUrl,
          numberOfComments
        }
      });

      return { pr: currentPr, statusChanged, previousStatus };
    } catch (err) {
      logger.error(`[PR-Repository] Error marking PR as declined for ${prUrl}:`, err);
      return null;
    }
  }

  /**
   * Find a single PR record by prId + prUrl. Returns null if not tracked.
   */
  async findPrByIdAndUrl(prId: number, prUrl: string): Promise<PullRequests | null> {
    return this.prisma.pullRequests.findFirst({ where: { prId, prUrl } });
  }

  /**
   * Soft-delete all PR records matching prId + prUrl by setting status to DELETED.
   * Returns one record (used for ticket sync), or null if none were tracked by Xyne.
   */
  async markDeletedPr({
    prId,
    prUrl,
  }: Pick<BasePRProps, 'prId' | 'prUrl'>): Promise<PullRequests | null> {
    try {
      const prs = await this.prisma.pullRequests.findMany({
        where: { prId, prUrl },
      });

      if (prs.length === 0) {
        logger.debug(`[PR-Repository] Ignoring delete webhook for untracked PR: ${prUrl}`);
        return null;
      }

      await this.prisma.pullRequests.updateMany({
        where: { prId, prUrl },
        data: { status: PRStatus.DELETED },
      });

      // Return the first record — enough for ticket sync (ticketId / workflowExecutionId)
      return prs[0];
    } catch (err) {
      logger.error(`[PR-Repository] Error marking PR as deleted for ${prUrl}:`, err);
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
        status: PRStatus.OPEN,
        ...(excludePrId !== undefined && { NOT: { prId: excludePrId } })
      }
    });

    if (duplicatePR) {
      logger.debug(`[PR-Repository] Found duplicate PR ${duplicatePR.prId} for ticket ${ticketId} ` +
        `(workflowExecutionId: ${duplicatePR.workflowExecutionId || 'none'})`);
    }

    return duplicatePR;
  }

  /**
   * Count PRs for a ticket, excluding the specified PR.
   * Pass a `status` to restrict to that status (e.g. 'OPEN' for merge checks),
   * or omit it to count all PRs regardless of status (e.g. for delete checks).
   */
  async countPRsForTicket(
    ticketId: string,
    excludePrId: number,
    excludePrUrl: string,
    statuses?: PRStatus[]
  ): Promise<number> {
    const statusFilter = statuses && statuses.length > 0 ? { status: { in: statuses } } : {};
    const exclude = { NOT: { AND: [{ prId: excludePrId }, { prUrl: excludePrUrl }] } };

    const directPRs = await this.prisma.pullRequests.groupBy({
      by: ['prId', 'prUrl'],
      where: { ticketId, ...statusFilter, ...exclude },
    });

    const workflowsForTicket = await this.prisma.workflow.findMany({
      where: { ticketId },
      select: { id: true },
    });
    const workflowIds = workflowsForTicket.map(w => w.id);

    const workflowExecutions = await this.prisma.workflowExecution.findMany({
      where: { workflowId: { in: workflowIds } },
      select: { id: true },
    });
    const workflowExecutionIds = workflowExecutions.map(we => we.id);

    const chainedPRs = await this.prisma.pullRequests.groupBy({
      by: ['prId', 'prUrl'],
      where: {
        workflowExecutionId: { in: workflowExecutionIds },
        ticketId: null,
        ...statusFilter,
        ...exclude,
      },
    });

    const uniquePRs = new Set([...directPRs, ...chainedPRs].map(p => `${p.prId}:${p.prUrl}`));
    const totalCount = uniquePRs.size;
    logger.debug(
      `[PR-Repository] Found ${totalCount} active PR(s)` +
      `${statuses && statuses.length > 0 ? ` with status [${statuses.join(', ')}]` : ''} ` +
      `for ticket ${ticketId}, excluding PR ${excludePrId}`
    );
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

    const workspaceId = await this.resolvePrWorkspaceId({ ticketId });
    await this.prisma.pullRequests.create({
      data: {
        date: today,
        sourceBranchName,
        destinationBranchName,
        status: PRStatus.OPEN,
        prUrl,
        prId,
        repositoryUrl,
        repoName,
        numberOfComments,
        ticketId,
        workspaceId
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
