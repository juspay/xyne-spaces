// Bitbucket Webhook Service
// Handles different Bitbucket webhook event types based on X-Event-Key header

import { PRMetricsRepository } from '@/database/repositories/pullRequestsRepository';
import { PRStatus, PRStatusEvent } from '@xyne/shared';
import { prTicketStatusSyncService } from '@/services/prTicketStatusSyncService';
import { pullRequestValidationService } from '@/services/pullRequestValidationService';
import { logger } from '@/utils/logger';
import { BitbucketWebhookEnvelope, BitbucketPullRequest } from '@/routes/webhooks';
import { DatabaseClient } from '@/database/client';
import { config } from '@/config/env';
import { xyneCommentService } from '@/services/xyneCommentService';
import { prCheckApprovalService } from '@/services/prCheckApprovalService';
import { syncReleaseOnPRMerge } from '@/services/release/releaseWebhookSync';
import { VCSProviderType } from '@xyne/shared';
import { runAsServiceActor } from '@/database/tenant/context';
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
    payload: BitbucketWebhookEnvelope,
    workspaceId: string,
  ): Promise<{ success: boolean; message: string }> {
    // Unauthenticated webhook (no req.user): open an explicit tenant scope from the
    // internal workspaceId in the request URL so the workspaceId stamper fills the
    // ticket_assignments / user_workload_mappings writes this event triggers downstream.
    return runAsServiceActor('bitbucket-webhook', workspaceId, async () => {
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

        // Release sync is BRANCH-scoped, not gated on PR-title validation: fire on
        // merge BEFORE the validation gate so a hotfix whose dev ticket doesn't
        // exist yet still syncs. Fire-and-forget — analysis can outlast the webhook
        // timeout and syncReleaseOnPRMerge handles its own errors.
        if (eventKey === BitbucketPREventType.PR_MERGED) {
          // No latestCommit fallback: if mergeCommit.id is absent, leave it
          // undefined so syncReleaseOnPRMerge does a plain re-run rather than
          // inventing a hotfix delta from the destination-branch tip.
          if (!context.pr.properties?.mergeCommit?.id) {
            logger.warn(`[Bitbucket-Webhook] PR #${context.prId} merged with no mergeCommit.id — hotfix delta will fall back to a plain re-run`);
          }
          syncReleaseOnPRMerge({
            workspaceId: context.workspace,
            provider: VCSProviderType.BITBUCKET_SERVER,
            projectKey: context.projectName,
            repoSlug: context.pr.toRef.repository.slug,
            baseBranch: context.destinationBranch,
            mergeCommitSha: context.pr.properties?.mergeCommit?.id,
            source: 'Bitbucket-Webhook',
          }).catch(err => logger.error('[Bitbucket-Webhook] release sync failed:', err));
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
    return await pullRequestValidationService.validatePullRequest({
      prTitle: context.pr.title,
      prId: context.prId,
      commitHash: context.pr.fromRef.latestCommit,
      sourceBranch: context.sourceBranch,
      destinationBranch: context.destinationBranch,
      workspaceId: context.workspace,
      repoName: context.repoName,
      repoUrl: context.repoUrl,
      prUrl: context.prUrl,
      numberOfComments: context.numberOfComments,
    });
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

    // Also post a fresh PR status card into the originating Spaces thread (if an
    // agent opened this PR). Fully decoupled from the ticket sync below.
    this.forwardPrCardStatus(context, 'merged');

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
    // NOTE: release sync fires in handleWebhookEvent (before the PR-title
    // validation gate), so it also runs for hotfix PRs whose dev ticket
    // doesn't exist yet.
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

    // Also post a fresh PR status card into the originating Spaces thread (if an
    // agent opened this PR). Fully decoupled from the ticket sync below.
    this.forwardPrCardStatus(context, 'declined');

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

    // Also post a fresh PR status card into the originating Spaces thread (if an
    // agent opened this PR). Fully decoupled from the ticket sync below.
    this.forwardPrCardStatus(context, 'deleted');

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
      newStatus: trackedPr.status as PRStatus,
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

  /**
   * Fire-and-forget forward of a PR status change to xyne-claw-auth, which posts
   * a FRESH PR status card into the originating Spaces thread — but only if an
   * agent originally opened a card for this PR (matched there via a durable
   * AgentWidgetBinding keyed on the PR URL). Fully decoupled from the ticket
   * sync: it must NEVER block or fail this webhook handler, so it swallows every
   * error. A PR with no agent card ⇒ silent no-op on the claw-auth side.
   */
  private forwardPrCardStatus(
    context: PREventContext,
    status: 'merged' | 'declined' | 'deleted',
  ): void {
    const base = config.xyneClaw?.webhookUrl;
    const s2sKey = config.xyneClaw?.s2sKey;
    if (!base || !s2sKey) return; // not wired in this env → skip silently

    const url = `${base.replace(/\/+$/, '')}/pr-event`;
    const body = JSON.stringify({
      provider: 'bitbucket',
      status,
      prUrl: context.prUrl,
      number: context.prId,
      repo: `${context.projectName}/${context.repoName}`,
    });

    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-s2s-key': s2sKey },
      body,
      signal: AbortSignal.timeout(10_000),
    })
      .then((res) => {
        if (!res.ok) {
          logger.warn(
            `[Bitbucket-Webhook] pr-card forward non-OK (HTTP ${res.status}) for PR ${context.prUrl}`,
          );
        }
      })
      .catch((err) => {
        logger.warn(
          `[Bitbucket-Webhook] pr-card forward failed for PR ${context.prUrl}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}

// Singleton instance
export const bitbucketWebhookService = new BitbucketWebhookService();
