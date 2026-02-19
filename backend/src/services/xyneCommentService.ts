import { logger } from '@/utils/logger';
import { DatabaseClient } from '@/database/client';
import { BitbucketService } from '@/services/bitbucketService';
import { CommentData } from '@/types/bitbucket';
import { config } from '@/config/env';
import { workflowRestoreService } from '@/workflows/services/workflow-restore-service';

export class XyneCommentService {
  private db: ReturnType<typeof DatabaseClient.getInstance>;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  async handleXyneMention(
    context: { prId: number; projectName: string; repoName: string; prUrl: string },
  ): Promise<void> {
    const { prId, projectName, repoName, prUrl } = context;
    
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
      select: { workflowExecutionId: true },
    });

    if (!pr?.workflowExecutionId) {
      logger.warn(`[Xyne-Comment] No workflow execution found for PR #${prId}`, {
        version: '1.0',
      });
      return;
    }

    let sourceExecutionId = pr.workflowExecutionId;
    logger.info(`[Xyne-Comment] Found workflow execution ${sourceExecutionId}, initiating rerun with PR comments`, {
      version: '1.0',
    });

    try {
      // Step 1: Get the source execution and traverse up if it's a child execution
      let sourceExecution = await this.db.workflowExecution.findUnique({
        where: { id: sourceExecutionId },
      });

      if (!sourceExecution) {
        throw new Error(`Workflow execution ${sourceExecutionId} not found`);
      }

      let currentExec = sourceExecution;
      while (currentExec && !currentExec.workflowType && currentExec.parentWorkflowExecutionId) {
        logger.info(`[Xyne-Comment] Execution ${currentExec.id} is a child, traversing to parent ${currentExec.parentWorkflowExecutionId}`, {
          version: '1.0',
        });
        
        const parentExecution = await this.db.workflowExecution.findUnique({
          where: { id: currentExec.parentWorkflowExecutionId },
        });

        if (!parentExecution) break;
        
        currentExec = parentExecution;
        sourceExecution = parentExecution;
        sourceExecutionId = parentExecution.id;
      }

      if (!sourceExecution || !sourceExecution.workflowType) {
        throw new Error(`Could not find workflow type for execution chain starting at ${pr.workflowExecutionId}`);
      }

      logger.info(`[Xyne-Comment] Source execution workflow type: ${sourceExecution.workflowType}`, {
        version: '1.0',
      });

      // Step 2: Format PR comments with details
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

      logger.info(`[Xyne-Comment] Formatted ${commentsWithDetails.length} PR comments`, {
        version: '1.0',
      });

      // Step 3: Format PR comments as modified input
      const continuationMessage = this.formatPRCommentsForDescription(commentsWithDetails, prId, prUrl);

      logger.info(`[Xyne-Comment] Creating continuation rerun for PR comments`, {
        version: '1.0',
        workflowType: sourceExecution.workflowType,
        messageLength: continuationMessage.length,
      });

      // Step 4: Find the agentic step using the webhook mapper
      const stepName = await workflowRestoreService.getStepNameForWebhook('bitbucket', sourceExecution.workflowType);
      
      const agenticSteps = await this.db.workflowStep.findMany({
        where: {
          workflowExecutionId: sourceExecutionId,
          stepName: stepName,
          type: 'input',
          stepExecutorType: 'agent'
        },
        orderBy: { createdAt: 'asc' }
      });

      if (agenticSteps.length === 0) {
        throw new Error(`No agentic step '${stepName}' found in workflow execution ${sourceExecutionId}`);
      }

      const agenticStepId = agenticSteps[0].id;

      logger.info(`[Xyne-Comment] Found agentic step: ${agenticStepId} (${stepName})`, {
        version: '1.0',
      });

      // Step 5: Use createContinuationRerun to continue from the agentic step with PR comments
      const rerunResult = await workflowRestoreService.createContinuationRerun({
        sourceExecutionId,
        agenticStepId,
        continuationMessage,
      });

      logger.info(`[Xyne-Comment] Created continuation rerun: ${rerunResult.rerunExecutionId}`, {
        version: '1.0',
        prId,
        commentsProcessed: commentsWithDetails.length,
        actualStepName: rerunResult.actualRestoreStepName,
      });
    } catch (error) {
      logger.error(`[Xyne-Comment] Failed to trigger workflow rerun:`, {
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
