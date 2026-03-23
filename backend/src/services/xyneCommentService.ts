import { logger } from '@/utils/logger';
import { DatabaseClient } from '@/database/client';
import { BitbucketService } from '@/services/bitbucketService';
import { CommentData } from '@/types/bitbucket';
import { config } from '@/config/env';
import { workflowManager } from '@/workflows/services/workflowManager';
import { WorkflowType, WorkflowExecutionStatus, isActiveStatus } from '@/workflows/types/workflow-enums';
import { buildPRWorkflowContext } from './prWorkflowContextBuilder';
import { randomUUID } from 'crypto';

export class XyneCommentService {
  private db: ReturnType<typeof DatabaseClient.getInstance>;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  async handleXyneMention(
    context: { prId: number; projectName: string; repoName: string; prUrl: string },
  ): Promise<void> {
    const { prId, projectName, repoName, prUrl } = context;
    
    // Check if there's already an active workflow execution for this PR
    const hasActiveExecution = await this.hasActiveExecutionForPR(prId);
    if (hasActiveExecution) {
      logger.info(`[Xyne-Comment] Skipping - active workflow already running for PR #${prId}`, {
        version: '1.0',
      });
      return;
    }

    logger.info(`[Xyne-Comment] @xyne.spaces mentioned in PR #${prId}, fetching tasks...`, {
      version: '1.0',
    });

    // Step 1: Fetch all activities from Bitbucket (with pagination)
    const bitbucketService = new BitbucketService({
      baseUrl: config.bitbucket.baseUrl,
      username: config.bitbucket.apiUsername,
      password: config.bitbucket.password,
      token: config.bitbucket.apiToken,
      projectKey: projectName,
      repositorySlug: repoName,
    });
    const allActivities: any[] = [];
    let start = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await bitbucketService.getPullRequestActivities(prId, limit, start);
      allActivities.push(...(response.values || []));
      
      if (response.isLastPage || response.values.length === 0) {
        hasMore = false;
      } else {
        start = response.nextPageStart ?? (start + limit);
      }
    }

    logger.info(`[Xyne-Comment] Fetched ${allActivities.length} activities for PR #${prId}`, {
      version: '1.0',
    });

    // Step 2: Extract comments and filter for open blocker tasks
    const filteredComments = this.filterOpenBlockerTasks(allActivities);

    logger.info(`[Xyne-Comment] Found ${filteredComments.length} open tasks to process`, {
      version: '1.0',
    });

    if (filteredComments.length === 0) {
      logger.info('[Xyne-Comment] No open tasks found, skipping workflow rerun', {
        version: '1.0',
      });
      return;
    }

    // Step 3: Find the workflow associated with this PR
    const workflowInfo = await this.findWorkflowForPR(prId);

    if (!workflowInfo) {
      logger.warn(`[Xyne-Comment] No workflow found for PR #${prId}`, {
        version: '1.0',
      });
      return;
    }

    logger.info(
      `[Xyne-Comment] Found workflow ${workflowInfo.workflowId} execution ${workflowInfo.executionId} for PR #${prId}`,
      { version: '1.0' }
    );

    // Step 4: Continue workflow with PR comments
    await this.continueWorkflowWithPRComments(
      workflowInfo.ticketId,
      filteredComments,
      prId,
      prUrl
    );

    logger.info(`[Xyne-Comment] Triggered workflow continuation with ${filteredComments.length} PR comments`, {
      version: '1.0',
    });
  }

  private async hasActiveExecutionForPR(prId: number): Promise<boolean> {
    try {
      const prEntries = await this.db.pullRequests.findMany({
        where: { prId },
        select: { workflowExecutionId: true }
      });

      const executionIds = prEntries
        .map(pr => pr.workflowExecutionId)
        .filter((id): id is string => id !== null);

      if (executionIds.length === 0) {
        return false;
      }

      const executions = await this.db.workflowExecution.findMany({
        where: { id: { in: executionIds } },
        select: { status: true }
      });

      return executions.some(exec => isActiveStatus(exec.status as WorkflowExecutionStatus));
    } catch (error) {
      logger.error(`[Xyne-Comment] Error checking active execution for PR #${prId}:`, error);
      return false;
    }
  }

  /**
   * Extract comments from activities and filter for open blocker tasks
   */
  private filterOpenBlockerTasks(activities: any[]): CommentData[] {
    return activities
      .filter((activity: any) => activity.action === 'COMMENTED' && activity.comment)
      .map((activity: any) => ({
        ...activity.comment,
        anchor: activity.commentAnchor || null
      }))
      .filter((comment: CommentData) => 
        comment.severity === 'BLOCKER' && comment.state === 'OPEN'
      );
  }

  /**
   * Find the workflow execution associated with a PR
   */
  private async findWorkflowForPR(prId: number): Promise<{
    executionId: string;
    workflowId: string;
    ticketId: string;
  } | null> {
    try {
      const pr = await this.db.pullRequests.findFirst({
        where: { prId: prId },
        select: {
          workflowExecutionId: true,
          ticketId: true,
        },
      });

      if (!pr || !pr.workflowExecutionId || !pr.ticketId) {
        return null;
      }

      const execution = await this.db.workflowExecution.findUnique({
        where: { id: pr.workflowExecutionId },
        select: { workflowId: true },
      });

      if (!execution) {
        return null;
      }

      return {
        executionId: pr.workflowExecutionId,
        workflowId: execution.workflowId,
        ticketId: pr.ticketId,
      };
    } catch (error) {
      logger.error(`[Xyne-Comment] Error finding workflow for PR: ${error}`, {
        version: '1.0',
      });
      return null;
    }
  }

  /**
   * Continue workflow execution with PR comments
   */
  private async continueWorkflowWithPRComments(
    ticketId: string,
    comments: CommentData[],
    prId: number,
    prUrl: string
  ): Promise<void> {
    const ticket = await this.db.ticket.findUnique({
      where: { id: ticketId },
      select: { 
        conversationId: true, 
        createdBy: true,
        title: true,
        description: true,
      },
    });

    if (!ticket || !ticket.conversationId) {
      logger.warn(`[Xyne-Comment] No conversation found for ticket ${ticketId}`, {
        version: '1.0',
      });
      return;
    }

    const pr = await this.db.pullRequests.findFirst({
      where: { prId: prId },
      select: {
        workflowExecutionId: true,
        sourceBranchName: true,
        destinationBranchName: true,
        repositoryUrl: true,
        repoName: true
      },
    });

    if (!pr?.workflowExecutionId) {
      logger.warn(`[Xyne-Comment] No workflow execution found for PR #${prId}`, {
        version: '1.0',
      });
      return;
    }

    try {
      // Step 1: Find the original workflow execution and its workflow
      const originalExecution = await this.db.workflowExecution.findUnique({
        where: { id: pr.workflowExecutionId },
        include: { workflow: true },
      });

      if (!originalExecution) {
        throw new Error(`Original workflow execution ${pr.workflowExecutionId} not found`);
      }

      const originalWorkflowContext = originalExecution.workflow?.context
        ? JSON.parse(originalExecution.workflow.context as string)
        : {};

      // Step 2: Get the branch from the PR (the PR's source branch has the code)
      const workflowBranch = pr.sourceBranchName;

      if (!workflowBranch) {
        throw new Error(`PR #${prId} does not have a source branch`);
      }

      logger.info(`[Xyne-Comment] Using branch ${workflowBranch} for PR #${prId} workflow`, {
        version: '1.0',
        originalExecutionId: originalExecution.id,
      });

      // Step 3: Format PR comments as the description
      const commentsWithDetails = comments.map(c => ({
        id: c.id,
        text: c.text,
        author: c.author?.displayName || c.author?.name || 'Unknown',
        severity: c.severity,
        state: c.state,
        filePath: c.anchor?.path,
        lineNumber: c.anchor?.line,
        createdDate: c.createdDate,
      }));

      const prCommentsDescription = this.formatPRCommentsForDescription(commentsWithDetails, prId, prUrl);

      // Step 4: Build workflow context based on workflow type
      const workflowType = (originalExecution.workflowType || originalExecution.workflow?.workflowType) as WorkflowType;

      if (!workflowType) {
        logger.error(`[Xyne-Comment] No workflowType found on execution or workflow`, {
          version: '1.0',
          executionId: originalExecution.id,
          workflowId: originalExecution.workflowId,
        });
        return;
      }

      let workflowContext: Record<string, unknown>;
      try {
        workflowContext = buildPRWorkflowContext(
          workflowType,
          {
            title: `PR Review Fixes: ${ticket.title}`,
            description: prCommentsDescription,
            repoBranch: workflowBranch,
            originalContext: originalWorkflowContext,
          }
        );
      } catch (error) {
        logger.error(`[Xyne-Comment] Failed to build workflow context: ${error instanceof Error ? error.message : String(error)}`, {
          version: '1.0',
          workflowType,
        });
        return;
      }

      const result = await workflowManager.startWorkflow({
        ticketId: ticketId,
        workflowType: workflowType,
        context: workflowContext,
        createdBy: originalExecution.createdBy ?? undefined,
        metadata: {
          originalRequest: {
            title: `PR Review Fixes: ${ticket.title}`,
            description: prCommentsDescription,
          },
        },
      });

      // Immediately create PR entry to prevent duplicate entries when workflow later calls insertPRIfNotPresent
      await this.db.pullRequests.create({
        data: {
          prId: prId,
          prUrl: prUrl,
          workflowExecutionId: result.executionId,
          repoName: pr.repoName || '',
          sourceBranchName: pr.sourceBranchName || workflowBranch,
          destinationBranchName: pr.destinationBranchName || '',
          repositoryUrl: pr.repositoryUrl || '',
          status: 'OPEN',
          ticketId: ticketId,
          date: new Date(),
        },
      });
      logger.info(`[Xyne-Comment] Created PR entry immediately for execution ${result.executionId}`, {
        version: '1.0',
        prId,
        executionId: result.executionId,
      });

      // Step 5: Create SYSTEM message in conversation so workflow appears in ticket thread
      try {
        const messageMetadata = {
          workflowId: result.workflowId,
          workflowName: `PR Review Fixes: ${ticket.title}`,
          workflowType: workflowType,
          ticketId: ticketId,
          xyneId: ticketId,
          source: 'pr_comment',
        };

        await this.db.message.create({
          data: {
            messageId: randomUUID(),
            conversationId: ticket.conversationId,
            senderId: ticket.createdBy || 'system',
            content: ``,
            msgType: 'SYSTEM',
            metadata: messageMetadata,
          },
        });
        logger.info(`[Xyne-Comment] Created SYSTEM message for workflow in conversation`, {
          version: '1.0',
          workflowId: result.workflowId,
          conversationId: ticket.conversationId,
        });
      } catch (messageError) {
        logger.error('[Xyne-Comment] Failed to create SYSTEM message for workflow:', messageError);
      }

      logger.info(`[Xyne-Comment] Created new workflow execution for PR comments`, {
        version: '1.0',
        newExecutionId: result.executionId,
        workflowId: result.workflowId,
        ticketId,
        prId,
        workflowBranch,
        workflowType: workflowType,
        commentsProcessed: commentsWithDetails.length,
      });
    } catch (error) {
      logger.error(`[Xyne-Comment] Failed to create workflow for PR comments:`, {
        version: '1.0',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Format PR comments as a description for workflow context (this becomes the primary task description)
   */
  private formatPRCommentsForDescription(
    comments: Array<{
      id: number;
      text: string;
      author: string;
      severity?: string;
      filePath?: string;
      lineNumber?: number;
    }>,
    prId: number,
    prUrl: string
  ): string {
    const header = `Address the following PR review comments from PR #${prId}:\n\n`;
    
    const commentsList = comments
      .map((comment, index) => {
        const parts = [`${index + 1}. ${comment.text}`];
        
        if (comment.filePath) {
          parts.push(`   File: ${comment.filePath}${comment.lineNumber ? ` (Line ${comment.lineNumber})` : ''}`);
        }
        
        if (comment.author) {
          parts.push(`   Reviewer: ${comment.author}`);
        }
        
        return parts.join('\n');
      })
      .join('\n\n');

    const footer = `\n\nPR URL: ${prUrl}\n\nPlease address each comment by making the necessary code changes.`;

    return `${header}${commentsList}${footer}`;
  }
}

export const xyneCommentService = new XyneCommentService();
