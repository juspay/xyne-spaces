// Bitbucket Webhook Service
// Handles different Bitbucket webhook event types based on X-Event-Key header

import { PRStatus } from '@prisma/client';
import { PRMetricsRepository } from '@/database/repositories/pullRequestsRepository';
import { prTicketStatusSyncService } from '@/services/prTicketStatusSyncService';
import { pullRequestValidationService } from '@/services/pullRequestValidationService';
import { logger } from '@/utils/logger';
import { BitbucketWebhookEnvelope, BitbucketPullRequest } from '@/routes/webhooks';
import { DatabaseClient } from '@/database/client';
import { config } from '@/config/env';
import { PRStatusEvent } from '@prisma/client';
import { xyneCommentService } from '@/services/xyneCommentService';
import { prCheckApprovalService } from '@/services/prCheckApprovalService';
/**
 * Bitbucket Server webhook event types for pull requests
 * Based on Bitbucket Server 8.6 documentation
 */
export enum BitbucketPREventType {
  PR_OPENED = 'pr:opened',
  PR_MODIFIED = 'pr:modified',
  PR_FROM_REF_UPDATED = 'pr:from_ref_updated',
  PR_MERGED = 'pr:merged',
  PR_DECLINED = 'pr:declined',
  PR_COMMENT_ADDED = 'pr:comment:added',
  PR_DELETED = 'pr:deleted'
}

interface PREventContext {
  pr: BitbucketPullRequest;
  prId: number;
  prUrl: string;
  repoName: string;
  repoUrl: string;
  projectName: string;
  workspace: string;
  sourceBranch: string;
  destinationBranch: string;
  numberOfComments: number;
  prAuthor?: string;
  prAuthorEmail?: string;
}

export class BitbucketWebhookService {
  private prMetricsRepository: PRMetricsRepository;
  private prisma = DatabaseClient.getInstance();

  constructor() {
    this.prMetricsRepository = new PRMetricsRepository();
  }

  /**
   * Main entry point for handling webhook events
   */
  async handleWebhookEvent(
    eventKey: string,
    payload: BitbucketWebhookEnvelope
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`[Bitbucket-Webhook] Received event: ${eventKey}`);

      // Check if this is a PR event
      if (!this.isPullRequestEvent(eventKey)) {
        return { success: true, message: `Event ${eventKey} acknowledged but not processed` };
      }

      // Handle comment events separately
      if (this.isCommentEvent(eventKey)) {
        return await this.handleCommentEvent(eventKey as BitbucketPREventType, payload);
      }

      // Validate PR data exists (Bitbucket Server uses 'pullRequest' with capital R)
      if (!payload.pullRequest) {
        logger.warn(
          `[Bitbucket-Webhook] PR event ${eventKey} received but pullRequest data missing`
        );
        return { success: true, message: 'No pullRequest data in payload' };
      }

      // Extract PR context
      const context = this.extractPRContext(payload);

      // pr:deleted bypasses title validation — we just need to remove the PR row
      if (eventKey === BitbucketPREventType.PR_DELETED) {
        await this.handlePRDeleted(context);
        return { success: true, message: `Event ${eventKey} processed successfully` };
      }

      let validationResult: { isValid: boolean; ticketId?: string };

        // PR doesn't exist or wasn't created by workflow - run full validation
        validationResult = await this.validatePRTitle(context);

        if (!validationResult.isValid) {
          // Validation failed, already posted failed build status, skip further processing
          logger.warn(
            `[Bitbucket-Webhook] PR validation failed for PR ${context.prId}, skipping event processing`
          );
          return { success: true, message: 'PR validation failed, event skipped' };
        }

      // Route to appropriate handler based on event type, passing validation result
      await this.routePREvent(eventKey as BitbucketPREventType, context, validationResult);

      return { success: true, message: `Event ${eventKey} processed successfully` };
    } catch (error) {
      logger.error(`[Bitbucket-Webhook] Error processing event ${eventKey}:`, error);
      // Return success to prevent Bitbucket retries
      return { success: true, message: 'Error acknowledged' };
    }
  }

  /**
   * Check if event is a pull request event (Bitbucket Server format)
   */
  private isPullRequestEvent(eventKey: string): boolean {
    return eventKey.startsWith('pr:');
  }

  /**
   * Check if event is a comment event
   */
  private isCommentEvent(eventKey: string): boolean {
    return eventKey.startsWith('pr:comment:');
  }

  /**
   * Handle PR comment events
   */
  private async handleCommentEvent(
    eventKey: BitbucketPREventType,
    payload: BitbucketWebhookEnvelope
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (!payload.comment || !payload.pullRequest) {
        logger.warn(`[Bitbucket-Webhook] Comment event ${eventKey} missing comment or PR data`);
        return { success: true, message: 'Missing comment or PR data' };
      }

      const comment = payload.comment;
      const pr = payload.pullRequest;
      const commentText = comment.text || '';

      logger.info(`[Bitbucket-Webhook] Processing comment event ${eventKey} on PR #${pr.id}`);
      logger.debug(`[Bitbucket-Webhook] Comment text: ${commentText.substring(0, 100)}...`);

      const mentions = this.extractMentions(commentText);
      
      if (mentions.some(m => m.toLowerCase() === 'john.doe@gmail.com')) {
        logger.info(`[Bitbucket-Webhook] Detected @john.doe@gmail.com mention in PR #${pr.id} comment #${comment.id}`);
        
        const context = this.extractPRContext(payload);
        
        await xyneCommentService.handleXyneMention({
          prId: context.prId,
          prUrl: context.prUrl,
          projectName: context.projectName,
          repoName: context.repoName,
        });
      }

      return { 
        success: true, 
        message: `Comment event ${eventKey} processed successfully` 
      };
    } catch (error) {
      logger.error(`[Bitbucket-Webhook] Error handling comment event:`, error);
      return { success: true, message: 'Comment event error acknowledged' };
    }
  }

  /**
   * Extract mentions from comment text (e.g., @john.doe@gmail.com or @"john.doe@gmail.com")
   */
  private extractMentions(text: string): string[] {
    const emailMentionRegex = /@"?([\w.-]+@[\w.-]+)"?/g;
    const simpleMentionRegex = /@"?([\w.-]+)"?/g;
    
    const mentions: string[] = [];
    let match: RegExpExecArray | null;
    
    while ((match = emailMentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }
    
    while ((match = simpleMentionRegex.exec(text)) !== null) {
      const mentionText = match[1];
      if (!mentions.some(m => m.includes(mentionText))) {
        mentions.push(mentionText);
      }
    }
    
    return mentions;
  }

  /**
   * Extract common PR context from webhook payload (Bitbucket Server format)
   */
  private extractPRContext(payload: BitbucketWebhookEnvelope): PREventContext {
    const pr = payload.pullRequest!;
    const repo = pr.toRef.repository;
    const repoName =repo.name;
    const projectName = repo.project.key; 
    const repoSlug = repo.slug;

    // Build repository URL (web URL, not SSH)
    const repositoryURL = pr.links?.self?.[0]?.href?.replace(`/pull-requests/${pr.id}`, '') ||
      `https://bitbucket.example.com/projects/${projectName}/repos/${repoSlug}`;
    
    // Build PR URL from repository URL
    const prUrl = `${repositoryURL}/pull-requests/${pr.id}`;
    
    // Build git clone URL (SSH format)
    const repoUrl = `${config.bitbucket.sshBaseUrl}/${projectName}/${repoSlug}.git`.toLowerCase();

    return {
      pr,
      prId: pr.id,
      prUrl,
      repoName,
      repoUrl,
      projectName,
      workspace: projectName, // In Server, project key serves as workspace
      sourceBranch: pr.fromRef.displayId,
      destinationBranch: pr.toRef.displayId,
      numberOfComments: pr.properties?.commentCount || 0,
      prAuthor: pr.author.user.displayName,
      prAuthorEmail: pr.author.user.emailAddress,
    };
  }

  /**
   * Route PR event to appropriate handler
   */
  private async routePREvent(
    eventType: BitbucketPREventType,
    context: PREventContext,
    validationResult: { isValid: boolean; ticketId?: string }
  ): Promise<void> {
    switch (eventType) {
      case BitbucketPREventType.PR_OPENED:
        await this.handlePRCreated(context, validationResult);
        break;

      case BitbucketPREventType.PR_MODIFIED:
      case BitbucketPREventType.PR_FROM_REF_UPDATED:
        await this.handlePRUpdated(context, validationResult);
        break;

      case BitbucketPREventType.PR_MERGED:
        await this.handlePRMerged(context, validationResult);
        break;

      case BitbucketPREventType.PR_DECLINED:
        await this.handlePRRejected(context, validationResult);
        break;

      case BitbucketPREventType.PR_DELETED:
        await this.handlePRDeleted(context);
        break;

      default:
        logger.info(`[Bitbucket-Webhook] Unhandled PR event type: ${eventType}`);
    }
  }

  /**
   * Handle PR created event
   */
  private async handlePRCreated(
    context: PREventContext,
    validationResult: { isValid: boolean; ticketId?: string }
  ): Promise<void> {
    logger.info(`[Bitbucket-Webhook] PR created: ${context.prId} - ${context.prUrl}`);

    // Only store in DB if validation passed
    if (validationResult.isValid) {
      const result = await this.prMetricsRepository.markOrCreateOpenPr({
        prId: context.prId,
        prUrl: context.prUrl,
        repoName: context.repoName,
        repoUrl: context.repoUrl,
        sourceBranchName: context.sourceBranch,
        destinationBranchName: context.destinationBranch,
        numberOfComments: context.numberOfComments,
        ticketId: validationResult.ticketId,
      });
      logger.debug(
        `[Bitbucket-Webhook] Stored PR in database: ${context.prUrl} (ticketId: ${validationResult.ticketId}, isNew: ${result.isNew})`
      );

      // Post or update PR check approval button if Varys bot is in channel
      if (validationResult.ticketId) {
        prCheckApprovalService.postOrUpdateApprovalButton({
          ticketId: validationResult.ticketId!,
          prId: context.prId,
          prUrl: context.prUrl,
        }).catch(err => logger.error('[Bitbucket-Webhook] PR check approval button error:', err));
      }

      // Always use CREATED event for new PRs
      await prTicketStatusSyncService.syncTicketStatusOnPRChange({
        prId: context.prId,
        prUrl: context.prUrl,
        newStatus: PRStatus.OPEN,
        prAuthor: context.prAuthor,
        prAuthorEmail: context.prAuthorEmail,
        prEvent: PRStatusEvent.CREATED,
      });
    } else {
      logger.debug(`[Bitbucket-Webhook] Skipping invalid/manual PR: ${context.prUrl}`);
    }
  }

  /**
   * Validate PR title using centralized validation service
   * Delegates to pullRequestValidationService to avoid duplication
   */
  private async validatePRTitle(
    context: PREventContext
  ): Promise<{ isValid: boolean; ticketId?: string }> {
    return await pullRequestValidationService.validatePullRequest(
      context.pr.title,
      context.prId,
      context.pr.fromRef.latestCommit,
      context.sourceBranch,
      context.destinationBranch,
      context.repoName,
      context.repoUrl,
      context.prUrl,
      context.numberOfComments,
    );
  }

  /**
   * Handle PR updated event (title, description, branches changed)
   * Updates all PRs and handles ticketId changes when PR title is updated
   */
  private async handlePRUpdated(
    context: PREventContext,
    validationResult: { isValid: boolean; ticketId?: string }
  ): Promise<void> {
    logger.info(`[Bitbucket-Webhook] PR updated: ${context.prId} - ${context.prUrl}`);

    // Check if validation passed before processing
    if (!validationResult.isValid) {
      return;
    }

    // Store or update PR and get result to determine if it's new or existing
    const result = await this.prMetricsRepository.markOrCreateOpenPr({
      prId: context.prId,
      prUrl: context.prUrl,
      repoName: context.repoName,
      repoUrl: context.repoUrl,
      sourceBranchName: context.sourceBranch,
      destinationBranchName: context.destinationBranch,
      numberOfComments: context.numberOfComments,
      ticketId: validationResult.ticketId,
    });

    // Determine event type: CREATED if PR is new, UPDATED if it existed
    const prEvent = result.isNew ? PRStatusEvent.CREATED : PRStatusEvent.UPDATED;

    if (result.isNew) {
      logger.info(
        `[Bitbucket-Webhook] 🆕 Created PR from update event: ${context.prUrl} (first seen via ${prEvent})`
      );
    }

    // Post or update PR check approval button if Varys bot is in channel
    if (validationResult.ticketId) {
      prCheckApprovalService.postOrUpdateApprovalButton({
        ticketId: validationResult.ticketId!,
        prId: context.prId,
        prUrl: context.prUrl,
      }).catch(err => logger.error('[Bitbucket-Webhook] PR check approval button error:', err));
    }

    // Sync ticket status with the appropriate event type
    await prTicketStatusSyncService.syncTicketStatusOnPRChange({
      prId: context.prId,
      prUrl: context.prUrl,
      newStatus: PRStatus.OPEN,
      prAuthor: context.prAuthor,
      prAuthorEmail: context.prAuthorEmail,
      prEvent,
    });
  }

  /**
   * Handle PR merged event
   */
  private async handlePRMerged(
    context: PREventContext,
    _validationResult: { isValid: boolean; ticketId?: string }
  ): Promise<void> {
    logger.info(`[Bitbucket-Webhook] PR merged: ${context.prId} - ${context.prUrl}`);

    const result = await this.prMetricsRepository.markMergedPr({
      prId: context.prId,
      prUrl: context.prUrl,
      repoName: context.repoName,
      repoUrl: context.repoUrl,
      sourceBranchName: context.sourceBranch,
      destinationBranchName: context.destinationBranch,
      numberOfComments: context.numberOfComments,
    });

    if (result) {
      if (result.statusChanged) {
        logger.info(
          `[Bitbucket-Webhook] PR ${context.prId} status: ${result.previousStatus} → MERGED`
        );

        // Check for remaining open PRs before changing ticket status
        let remainingOpenPRs = 0;
        const ticketId = result.pr.ticketId;

        if (ticketId) {
          remainingOpenPRs = await this.prMetricsRepository.countPRsForTicket(
            ticketId,
            context.prId,
            context.prUrl,
            [PRStatus.OPEN, PRStatus.UPDATED]
          );
        } else {
          const prTicketId = await this.getTicketIdForPR(result.pr);
          if (prTicketId) {
            remainingOpenPRs = await this.prMetricsRepository.countPRsForTicket(
              prTicketId,
              context.prId,
              context.prUrl,
              [PRStatus.OPEN, PRStatus.UPDATED]
            );
          }
        }

        await prTicketStatusSyncService.syncTicketStatusOnPRChange({
          prId: context.prId,
          prUrl: context.prUrl,
          newStatus: PRStatus.MERGED,
          prAuthor: context.prAuthor,
          prAuthorEmail: context.prAuthorEmail,
          prEvent: PRStatusEvent.MERGED,
          remainingOpenPRs,
        });
      }
    } else {
      logger.info(
        `[Bitbucket-Webhook] ℹ️ Ignored manual PR webhook: ${context.prUrl} (not created by Xyne)`
      );
    }
  }

  /**
   * Get ticketId for a PR by traversing workflowExecutionId chain
   */
  private async getTicketIdForPR(pr: {
    workflowExecutionId: string | null;
  }): Promise<string | null> {
    if (!pr.workflowExecutionId) {
      return null;
    }

    try {
      const workflowExecution = await this.prisma.workflowExecution.findUnique({
        where: { id: pr.workflowExecutionId },
        select: { workflowId: true },
      });

      if (!workflowExecution) {
        return null;
      }

      const workflow = await this.prisma.workflow.findUnique({
        where: { id: workflowExecution.workflowId },
        select: { ticketId: true },
      });

      return workflow?.ticketId ?? null;
    } catch (error) {
      logger.error('[Bitbucket-Webhook] Error getting ticketId for PR:', error);
      return null;
    }
  }

  /**
   * Handle PR rejected (declined) event
   */
  private async handlePRRejected(
    context: PREventContext,
    _validationResult: { isValid: boolean; ticketId?: string }
  ): Promise<void> {
    logger.info(`[Bitbucket-Webhook] PR declined: ${context.prId} - ${context.prUrl}`);

    const result = await this.prMetricsRepository.markDeclinedPr({
      prId: context.prId,
      prUrl: context.prUrl,
      repoName: context.repoName,
      repoUrl: context.repoUrl,
      sourceBranchName: context.sourceBranch,
      destinationBranchName: context.destinationBranch,
      numberOfComments: context.numberOfComments,
    });

    if (result) {
      if (result.statusChanged) {
        logger.info(`[Bitbucket-Webhook] PR ${context.prId} status: ${result.previousStatus} → DECLINED`);
        await prTicketStatusSyncService.syncTicketStatusOnPRChange({
          prId: context.prId,
          prUrl: context.prUrl,
          newStatus: PRStatus.DECLINED,
          prAuthor: context.prAuthor,
          prAuthorEmail: context.prAuthorEmail,
          prEvent: PRStatusEvent.DECLINED,
        });
      }
    } else {
      logger.info(
        `[Bitbucket-Webhook] ℹ️ Ignored manual PR webhook: ${context.prUrl} (not created by Xyne)`
      );
    }
  }

  /**
   * Handle PR deleted event.
   * Syncs the ticket status to DELETED (only when no other open PRs remain),
   * then soft-deletes all matching PR rows by setting status to DELETED.
   */
  private async handlePRDeleted(context: PREventContext): Promise<void> {
    logger.info(`[Bitbucket-Webhook] PR deleted: ${context.prId} - ${context.prUrl}`);

    const trackedPr = await this.prMetricsRepository.findPrByIdAndUrl(
      context.prId,
      context.prUrl
    );

    if (!trackedPr) {
      logger.info(
        `[Bitbucket-Webhook] ℹ️ Ignored manual PR delete webhook: ${context.prUrl} (not tracked by Xyne)`
      );
      return;
    }

    // Already soft-deleted — nothing more to do
    if (trackedPr.status === PRStatus.DELETED) {
      logger.info(
        `[Bitbucket-Webhook] ℹ️ PR ${context.prUrl} is already marked as DELETED, ignoring`
      );
      return;
    }

    // Count remaining active PRs (excluding DECLINED and DELETED) for the same ticket
    let remainingOpenPRs = 0;
    const ticketId = trackedPr.ticketId;

    if (ticketId) {
      remainingOpenPRs = await this.prMetricsRepository.countPRsForTicket(
        ticketId,
        context.prId,
        context.prUrl,
        [PRStatus.OPEN, PRStatus.UPDATED, PRStatus.MERGED]
      );
    } else {
      const prTicketId = await this.getTicketIdForPR(trackedPr);
      if (prTicketId) {
        remainingOpenPRs = await this.prMetricsRepository.countPRsForTicket(
          prTicketId,
          context.prId,
          context.prUrl,
          [PRStatus.OPEN, PRStatus.UPDATED, PRStatus.MERGED]
        );
      }
    }

    // Sync ticket status before marking the PR as deleted
    await prTicketStatusSyncService.syncTicketStatusOnPRChange({
      prId: context.prId,
      prUrl: context.prUrl,
      newStatus: trackedPr.status,
      prAuthor: context.prAuthor,
      prAuthorEmail: context.prAuthorEmail,
      prEvent: PRStatusEvent.DELETED,
      remainingOpenPRs,
    });

    // Soft-delete: mark status as DELETED instead of removing the row
    await this.prMetricsRepository.markDeletedPr({
      prId: context.prId,
      prUrl: context.prUrl,
    });

    logger.info(`[Bitbucket-Webhook] ✅ Marked PR as DELETED in database: ${context.prUrl}`);
  }
}

// Singleton instance
export const bitbucketWebhookService = new BitbucketWebhookService();
