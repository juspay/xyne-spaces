// Bitbucket Webhook Service
// Handles different Bitbucket webhook event types based on X-Event-Key header

import { PRStatus } from '@prisma/client';
import { PRStatusEvent } from '@xyne/shared';
import { PRMetricsRepository } from '@/database/repositories/pullRequestsRepository';
import { prTicketStatusSyncService, type ReadyToMergeTransition } from '@/services/prTicketStatusSyncService';
import { pullRequestValidationService } from '@/services/pullRequestValidationService';
import { logger } from '@/utils/logger';
import { BitbucketWebhookEnvelope, BitbucketPullRequest } from '@/routes/webhooks';
import { DatabaseClient } from '@/database/client';
import { config } from '@/config/env';
import { xyneCommentService } from '@/services/xyneCommentService';
import { prCheckApprovalService } from '@/services/prCheckApprovalService';
import { runWithContext } from '@/database/tenant/context';
import { bitbucketManager } from '@/git-providers/bitbucket/apis';
/**
 * Bitbucket Server webhook event types for pull requests
 * Based on Bitbucket Server 8.6 documentation
 */
export enum BitbucketPREventType {
  PR_OPENED = 'pr:opened',
  PR_MODIFIED = 'pr:modified',
  PR_FROM_REF_UPDATED = 'pr:from_ref_updated',
  PR_REVIEWER_APPROVED = 'pr:reviewer:approved',
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
  repoSlug: string;
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
    payload: BitbucketWebhookEnvelope,
    workspaceId: string,
  ): Promise<{ success: boolean; message: string }> {
    // Unauthenticated webhook (no req.user): open an explicit tenant scope from the
    // internal workspaceId in the request URL so the workspaceId stamper fills the
    // ticket_assignments / user_workload_mappings writes this event triggers downstream.
    return runWithContext({ userId: 'bitbucket-webhook', workspaceId }, async () => {
      try {
        logger.info(`[Bitbucket-Webhook] Received event: ${eventKey} for workspace: ${workspaceId}`);

        // Check if this is a PR event
        if (!this.isPullRequestEvent(eventKey)) {
          return { success: true, message: `Event ${eventKey} acknowledged but not processed` };
        }

        // Handle comment events separately
        if (this.isCommentEvent(eventKey)) {
          return await this.handleCommentEvent(eventKey as BitbucketPREventType, payload, workspaceId);
        }

        // Validate PR data exists (Bitbucket Server uses 'pullRequest' with capital R)
        if (!payload.pullRequest) {
          logger.warn(
            `[Bitbucket-Webhook] PR event ${eventKey} received but pullRequest data missing`
          );
          return { success: true, message: 'No pullRequest data in payload' };
        }

        // Extract PR context
        const context = this.extractPRContext(payload, workspaceId);
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
    });
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
    payload: BitbucketWebhookEnvelope,
    workspaceId: string,
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
        
        const context = this.extractPRContext(payload, workspaceId);
        
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
  private extractPRContext(payload: BitbucketWebhookEnvelope, workspaceId: string): PREventContext {
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
      repoSlug,
      workspace: workspaceId, // In Server, project key serves as workspace
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

      case BitbucketPREventType.PR_REVIEWER_APPROVED:
        await this.handleMergeReadinessRecheck(context, validationResult);
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
      context.workspace,
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

    // Fold merge-readiness into the single sync below (READY_TO_MERGE supersedes UPDATED, not CREATED).
    // When it applies, reuse the objects the gate already resolved so sync doesn't re-query.
    const mergeReady = prEvent === PRStatusEvent.UPDATED
      ? await this.evaluateMergeReadiness(context.prId, context.prUrl, context.projectName, context.repoSlug)
      : null;

    await prTicketStatusSyncService.syncTicketStatusOnPRChange(
      mergeReady
        ? {
            prId: context.prId,
            prUrl: context.prUrl,
            newStatus: PRStatus.OPEN,
            prAuthor: context.prAuthor,
            prAuthorEmail: context.prAuthorEmail,
            prEvent: PRStatusEvent.READY_TO_MERGE,
            pr: mergeReady.pr,
            ticket: mergeReady.ticket,
            targetStage: mergeReady.targetStage,
          }
        : {
            prId: context.prId,
            prUrl: context.prUrl,
            newStatus: PRStatus.OPEN,
            prAuthor: context.prAuthor,
            prAuthorEmail: context.prAuthorEmail,
            prEvent,
          }
    );
  }

  private async evaluateMergeReadiness(
    prId: number,
    prUrl: string,
    projectKey: string,
    repoSlug: string
  ): Promise<ReadyToMergeTransition | null> {
    try {
      const transition = await prTicketStatusSyncService.wouldTransitionToReadyToMerge(prId, prUrl);
      if (!transition) {
        logger.debug(
          `[Bitbucket-Webhook] PR ${prId}: no READY_TO_MERGE transition (unmapped or ticket already in stage) → skipping merge-status check`
        );
        return null;
      }

      const mergeStatus = await bitbucketManager.getMergeStatus(projectKey, repoSlug, prId);
      if (!mergeStatus) return null;
      if (!mergeStatus.canMerge) {
        logger.debug(
          `[Bitbucket-Webhook] PR ${prId} not merge-ready yet (${mergeStatus.vetoes.length} veto(s))`
        );
        return null;
      }
      logger.info(
        `[Bitbucket-Webhook] PR ${prId} is merge-ready (canMerge=true) → READY_TO_MERGE`
      );
      return transition;
    } catch (error) {
      logger.error(`[Bitbucket-Webhook] Error evaluating merge readiness for PR ${prId}:`, error);
      return null;
    }
  }

  // XYNE-17075: reviewer-approval events don't reach handlePRUpdated — re-check merge readiness and move the ticket if the PR just became mergeable.
  private async handleMergeReadinessRecheck(
    context: PREventContext,
    validationResult: { isValid: boolean; ticketId?: string }
  ): Promise<void> {
    if (!validationResult.isValid) return;
    await this.recheckMergeReadinessForPR(
      context.prId,
      context.prUrl,
      context.projectName,
      context.repoSlug,
      context.prAuthor,
      context.prAuthorEmail
    );
  }

  // XYNE-17075: shared merge-readiness re-check for out-of-band triggers (reviewer approval, Jenkins build success). Idempotent; returns true if the ticket transitioned to READY_TO_MERGE.
  async recheckMergeReadinessForPR(
    prId: number,
    prUrl: string,
    projectKey: string,
    repoSlug: string,
    prAuthor?: string,
    prAuthorEmail?: string
  ): Promise<boolean> {
    const mergeReady = await this.evaluateMergeReadiness(prId, prUrl, projectKey, repoSlug);
    if (!mergeReady) return false;

    await prTicketStatusSyncService.syncTicketStatusOnPRChange({
      prId,
      prUrl,
      newStatus: PRStatus.OPEN,
      prAuthor,
      prAuthorEmail,
      prEvent: PRStatusEvent.READY_TO_MERGE,
      pr: mergeReady.pr,
      ticket: mergeReady.ticket,
      targetStage: mergeReady.targetStage,
    });
    return true;
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

        const ticketId = result.pr.ticketId ?? await this.getTicketIdForPR(result.pr);

        let openCount = 0;
        let mergedCount = 0;

        if (ticketId) {
          openCount = await this.prMetricsRepository.countPRsForTicket(
            ticketId,
            context.prId,
            context.prUrl,
            [PRStatus.OPEN, PRStatus.UPDATED]
          );
          if (openCount === 0) {
            mergedCount = await this.prMetricsRepository.countPRsForTicket(
              ticketId,
              context.prId,
              context.prUrl,
              [PRStatus.MERGED]
            );
          }
        }

        // If no open PRs remain and merged PRs exist, move to the MERGED stage instead
        const stageEvent = openCount === 0 && mergedCount > 0 ? PRStatusEvent.MERGED : undefined;

        await prTicketStatusSyncService.syncTicketStatusOnPRChange({
          prId: context.prId,
          prUrl: context.prUrl,
          newStatus: PRStatus.DECLINED,
          prAuthor: context.prAuthor,
          prAuthorEmail: context.prAuthorEmail,
          prEvent: PRStatusEvent.DECLINED,
          stageEvent,
          remainingOpenPRs: openCount,
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

    const ticketId = trackedPr.ticketId ?? await this.getTicketIdForPR(trackedPr);

    let openCount = 0;
    let mergedCount = 0;

    if (ticketId) {
      // Count only active (open/updated) PRs — MERGED is handled separately below
      openCount = await this.prMetricsRepository.countPRsForTicket(
        ticketId,
        context.prId,
        context.prUrl,
        [PRStatus.OPEN, PRStatus.UPDATED]
      );
      // Only check for merged PRs when no open/updated ones remain
      if (openCount === 0) {
        mergedCount = await this.prMetricsRepository.countPRsForTicket(
          ticketId,
          context.prId,
          context.prUrl,
          [PRStatus.MERGED]
        );
      }
    }

    // If no open PRs remain and merged PRs exist, move to the MERGED stage instead
    const stageEvent = openCount === 0 && mergedCount > 0 ? PRStatusEvent.MERGED : undefined;

    // Sync ticket status before marking the PR as deleted
    await prTicketStatusSyncService.syncTicketStatusOnPRChange({
      prId: context.prId,
      prUrl: context.prUrl,
      newStatus: trackedPr.status,
      prAuthor: context.prAuthor,
      prAuthorEmail: context.prAuthorEmail,
      prEvent: PRStatusEvent.DELETED,
      stageEvent,
      remainingOpenPRs: openCount,
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
