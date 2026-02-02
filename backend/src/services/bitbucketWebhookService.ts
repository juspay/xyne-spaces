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
/**
 * Bitbucket webhook event types for pull requests
 */
export enum BitbucketPREventType {
  PR_CREATED = 'pullrequest:created',
  PR_UPDATED = 'pullrequest:updated',
  PR_FULFILLED = 'pullrequest:fulfilled', // Merged
  PR_REJECTED = 'pullrequest:rejected', // Declined
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
        logger.info(`[Bitbucket-Webhook] Non-PR event received: ${eventKey}, skipping`);
        return { success: true, message: `Event ${eventKey} acknowledged but not processed` };
      }

      // Validate PR data exists
      if (!payload.pullrequest) {
        logger.warn(
          `[Bitbucket-Webhook] PR event ${eventKey} received but pullrequest data missing`
        );
        return { success: true, message: 'No pullrequest data in payload' };
      }

      // Extract PR context
      const context = this.extractPRContext(payload);

      // Check if PR exists in database and has workflowExecutionId - skip validation if so
      const existingPr = await this.prisma.pullRequests.findUnique({
        where: {
          prId_prUrl: {
            prId: context.prId,
            prUrl: context.prUrl,
          },
        },
        select: {
          workflowExecutionId: true,
          ticketId: true,
        },
      });

      let validationResult: { isValid: boolean; ticketId?: string };

      if (existingPr && existingPr.workflowExecutionId) {
        // PR exists and was created by a workflow - skip validation
        logger.info(
          `[Bitbucket-Webhook] PR ${context.prId} created by workflow, skipping validation`
        );

        // Get ticketId - either from PR directly or via workflow chain
        let ticketId = existingPr.ticketId;
        if (!ticketId) {
          logger.debug(
            `[Bitbucket-Webhook] ticketId not set on PR ${context.prId}, fetching via workflow chain`
          );
          ticketId = await this.getTicketIdForPR({
            workflowExecutionId: existingPr.workflowExecutionId,
          });
        }

        validationResult = {
          isValid: true,
          ticketId: ticketId || undefined,
        };
      } else {
        // PR doesn't exist or wasn't created by workflow - run full validation
        logger.debug(
          `[Bitbucket-Webhook] PR ${context.prId} is manual or new, running validation`
        );
        validationResult = await this.validatePRTitle(context);

        if (!validationResult.isValid) {
          // Validation failed, already posted failed build status, skip further processing
          logger.warn(
            `[Bitbucket-Webhook] PR validation failed for PR ${context.prId}, skipping event processing`
          );
          return { success: true, message: 'PR validation failed, event skipped' };
        }
      }

      // Route to appropriate handler based on event type, passing validation result
      await this.routePREvent(eventKey as BitbucketPREventType, context, validationResult);

      logger.info(
        `[Bitbucket-Webhook] Successfully processed event: ${eventKey} for PR ${context.prId}`
      );
      return { success: true, message: `Event ${eventKey} processed successfully` };
    } catch (error) {
      logger.error(`[Bitbucket-Webhook] Error processing event ${eventKey}:`, error);
      // Return success to prevent Bitbucket retries
      return { success: true, message: 'Error acknowledged' };
    }
  }

  /**
   * Check if event is a pull request event
   */
  private isPullRequestEvent(eventKey: string): boolean {
    return eventKey.startsWith('pullrequest:');
  }

  /**
   * Extract common PR context from webhook payload
   */
  private extractPRContext(payload: BitbucketWebhookEnvelope): PREventContext {
    const pr = payload.pullrequest!;
    const repoName = payload.repository.name;
    const projectName = payload.repository.project?.key || 'unknown';
    const workspace = payload.repository.workspace?.slug || 'unknown';

    return {
      pr,
      prId: pr.id,
      prUrl: pr.links.html.href,
      repoName,
      repoUrl: `${config.bitbucket.sshBaseUrl}/${workspace}/${repoName}.git`.toLowerCase(),
      projectName,
      workspace,
      sourceBranch: pr.source.branch.name,
      destinationBranch: pr.destination.branch.name,
      numberOfComments: pr.comment_count,
      prAuthor: pr.author?.display_name || 'Unknown User',
      prAuthorEmail: pr.author?.email,
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
      case BitbucketPREventType.PR_CREATED:
        await this.handlePRCreated(context, validationResult);
        break;

      case BitbucketPREventType.PR_UPDATED:
        await this.handlePRUpdated(context, validationResult);
        break;

      case BitbucketPREventType.PR_FULFILLED:
        await this.handlePRFulfilled(context, validationResult);
        break;

      case BitbucketPREventType.PR_REJECTED:
        await this.handlePRRejected(context, validationResult);
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
    logger.info(`[Bitbucket-Webhook] Validation result:`, validationResult);

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
      logger.info(
        `[Bitbucket-Webhook] ✅ Stored PR in database: ${context.prUrl} (ticketId: ${validationResult.ticketId}, isNew: ${result.isNew})`
      );

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
      logger.warn(`[Bitbucket-Webhook] Skipping storage of invalid manual PR: ${context.prUrl}`);
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
      context.pr.source.commit.hash,
      context.sourceBranch,
      context.destinationBranch,
      context.repoName,
      context.repoUrl,
      context.prUrl,
      context.numberOfComments,
      context.workspace
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
      logger.info(`[Bitbucket-Webhook] PR update ignored (validation failed): ${context.prUrl}`);
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
        `[Bitbucket-Webhook] 🆕 Created PR from update event: ${context.prUrl} (first time stored in DB) - Event: ${prEvent}`
      );
    } else {
      logger.info(
        `[Bitbucket-Webhook] ♻️  Updated PR metadata: ${context.prUrl} - Event: ${prEvent}`
      );
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
   * Handle PR fulfilled (merged) event
   */
  private async handlePRFulfilled(
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
      logger.info(`[Bitbucket-Webhook] ✅ Updated Xyne PR to MERGED: ${context.prUrl}`);

      // Sync ticket status if PR status changed
      if (result.statusChanged) {
        logger.info(
          `[Bitbucket-Webhook] 📊 PR status changed from ${result.previousStatus} to MERGED, syncing ticket`
        );

        // Check for remaining open PRs before changing ticket status
        let remainingOpenPRs = 0;
        const ticketId = result.pr.ticketId;

        if (ticketId) {
          remainingOpenPRs = await this.prMetricsRepository.countOpenPRsForTicket(
            ticketId,
            context.prId,
            context.prUrl
          );
          logger.debug(
            `[Bitbucket-Webhook] Found ${remainingOpenPRs} remaining open PRs for ticket ${ticketId}`
          );
        } else {
          // Try to get ticketId via workflowExecutionId chain
          const prTicketId = await this.getTicketIdForPR(result.pr);
          if (prTicketId) {
            remainingOpenPRs = await this.prMetricsRepository.countOpenPRsForTicket(
              prTicketId,
              context.prId,
              context.prUrl
            );
            logger.debug(
              `[Bitbucket-Webhook] Found ${remainingOpenPRs} remaining open PRs for ticket ${prTicketId} (via workflow chain)`
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
      } else {
        logger.info(
          `[Bitbucket-Webhook] PR status unchanged (already MERGED), skipping ticket sync`
        );
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
      logger.info(`[Bitbucket-Webhook] ✅ Updated Xyne PR to DECLINED: ${context.prUrl}`);

      // Sync ticket status if PR status changed
      if (result.statusChanged) {
        logger.info(
          `[Bitbucket-Webhook] 📊 PR status changed from ${result.previousStatus} to DECLINED, syncing ticket`
        );
        await prTicketStatusSyncService.syncTicketStatusOnPRChange({
          prId: context.prId,
          prUrl: context.prUrl,
          newStatus: PRStatus.DECLINED,
          prAuthor: context.prAuthor,
          prAuthorEmail: context.prAuthorEmail,
          prEvent: PRStatusEvent.DECLINED,
        });
      } else {
        logger.info(
          `[Bitbucket-Webhook] PR status unchanged (already DECLINED), skipping ticket sync`
        );
      }
    } else {
      logger.info(
        `[Bitbucket-Webhook] ℹ️ Ignored manual PR webhook: ${context.prUrl} (not created by Xyne)`
      );
    }
  }
}

// Singleton instance
export const bitbucketWebhookService = new BitbucketWebhookService();
