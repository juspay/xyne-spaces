// GitHub Webhook Service
// Handles different GitHub webhook event types based on X-GitHub-Event header

import { PRStatus } from '@xyne/shared';
import { PRMetricsRepository } from '@/database/repositories/pullRequestsRepository';
import { prTicketStatusSyncService } from '@/services/prTicketStatusSyncService';
import { pullRequestValidationService } from '@/services/pullRequestValidationService';
import { logger } from '@/utils/logger';
import { DatabaseClient } from '@/database/client';
import { PRStatusEvent } from '@xyne/shared';
import { commitAnalysisQueue } from '@/queues/commitAnalysisQueue';
import { xyneCommentService } from '@/services/xyneCommentService';
import { prCheckApprovalService } from '@/services/prCheckApprovalService';
import { syncReleaseOnPRMerge } from '@/services/release/releaseWebhookSync';
import { VCSProviderType } from '@xyne/shared';

/**
 * GitHub webhook event types for pull requests
 * Based on GitHub REST API v3 documentation
 */
export enum GitHubPREventType {
  PR_OPENED = 'opened',
  PR_SYNCHRONIZE = 'synchronize', // PR updated with new commits
  PR_REOPENED = 'reopened',
  PR_CLOSED = 'closed', // Can be merged or just closed
  PR_EDITED = 'edited', // Title, body, or base branch changed
}

interface GitHubUser {
  login: string;
  email?: string;
  name?: string;
}

interface GitHubRepository {
  name: string;
  full_name: string; // owner/repo
  owner: GitHubUser;
  clone_url: string;
  html_url: string;
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  merged: boolean;
  user: GitHubUser; // PR author
  head: {
    ref: string; // source branch name
    sha: string; // latest commit
    repo: GitHubRepository | null;
  };
  base: {
    ref: string; // destination branch name
    sha: string;
    repo: GitHubRepository;
  };
  created_at: string;
  updated_at: string;
  closed_at?: string;
  merged_at?: string;
  merge_commit_sha?: string; // resulting branch-head commit after merge
  comments: number;
  review_comments: number;
}

interface GitHubPullRequestPayload {
  action: string;
  number: number;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  sender: GitHubUser;
  installation?: {
    id: number;
  };
}

interface GitHubIssueCommentPayload {
  action: 'created' | 'edited' | 'deleted';
  issue: {
    number: number;
    pull_request?: {
      html_url: string;
    };
  };
  comment: {
    body: string;
    user: GitHubUser;
  };
  repository: GitHubRepository;
}

interface PREventContext {
  pr: GitHubPullRequest;
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

const XYNE_MENTION_EMAIL = 'john.doe@gmail.com';
const XYNE_MENTION_USERNAME = 'xynespaces';

export class GitHubWebhookService {
  private prMetricsRepository: PRMetricsRepository;
  private prisma = DatabaseClient.getInstance();

  constructor() {
    this.prMetricsRepository = new PRMetricsRepository();
  }

  /**
   * Main entry point for handling webhook events
   */
  async handleWebhookEvent(
    eventType: string,
    payload: unknown,
    workspaceId?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`[GitHub-Webhook] Received event: ${eventType}`);

      // PR processing needs the workspaceId only /github/:workspaceId carries;
      // the legacy /github route acknowledges and skips PR events (prior behavior).
      if (eventType === 'pull_request') {
        if (!workspaceId) {
          logger.info(
            '[GitHub-Webhook] pull_request received on legacy /github route (no workspaceId) — skipping. ' +
            'Point the webhook at /webhooks/github/:workspaceId to enable release hotfix sync.',
          );
          return { success: true, message: 'pull_request skipped: no workspaceId on legacy route' };
        }
        return await this.handlePullRequestEvent(payload as GitHubPullRequestPayload, workspaceId);
      }

      if (eventType === 'issue_comment') {
        return await this.handleIssueCommentEvent(payload as GitHubIssueCommentPayload);
      }

      logger.info(`[GitHub-Webhook] Event ${eventType} acknowledged but not processed`);
      return { success: true, message: `Event ${eventType} acknowledged but not processed` };
    } catch (error) {
      logger.error(`[GitHub-Webhook] Error processing event ${eventType}:`, error);
      return { success: true, message: 'Error acknowledged' };
    }
  }

  /**
   * Handle pull_request events
   */
  private async handlePullRequestEvent(
    payload: GitHubPullRequestPayload,
    workspaceId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const action = payload.action;
      const pr = payload.pull_request;

      logger.info(`[GitHub-Webhook] Processing pull_request.${action} for PR #${pr.number}`);

      if (!pr) {
        logger.warn('[GitHub-Webhook] PR event received but pull_request data missing');
        return { success: true, message: 'No pull_request data in payload' };
      }

      const context = this.extractPRContext(payload, workspaceId);

      // Release sync is BRANCH-scoped (matched on base branch + repo), not gated
      // on PR-title validation. A hotfix whose dev ticket doesn't exist in the
      // workspace yet fails validation below — but must still sync — so fire here,
      // before the gate, on merge only. Fire-and-forget (see handlePRMerged note);
      // non-release branches simply no-op inside syncReleaseOnPRMerge.
      if (action === GitHubPREventType.PR_CLOSED && pr.merged) {
        // merge_commit_sha can be absent on some payloads (squash merges) —
        // hotfix detection then degrades to a plain re-run; log so it's diagnosable.
        if (!context.pr.merge_commit_sha) {
          logger.warn(`[GitHub-Webhook] PR #${pr.number} merged with no merge_commit_sha — hotfix delta will fall back to a plain re-run`);
        }
        syncReleaseOnPRMerge({
          workspaceId: context.workspace,
          provider: VCSProviderType.GITHUB,
          projectKey: context.projectName, // repo owner
          repoSlug: context.repoName,
          baseBranch: context.destinationBranch,
          mergeCommitSha: context.pr.merge_commit_sha,
          source: 'GitHub-Webhook',
        }).catch(err => logger.error('[GitHub-Webhook] release sync failed:', err));
      }

      // Validate PR title (same validation as Bitbucket)
      const validationResult = await this.validatePRTitle(context);

      if (!validationResult.isValid) {
        logger.warn(
          `[GitHub-Webhook] PR validation failed for PR ${context.prId}, skipping event processing`
        );
        return { success: true, message: 'PR validation failed, event skipped' };
      }

      await this.routePREvent(action, context, validationResult);

      return { success: true, message: `Event pull_request.${action} processed successfully` };
    } catch (error) {
      logger.error('[GitHub-Webhook] Error handling pull_request event:', error);
      return { success: true, message: 'Error acknowledged' };
    }
  }

  /**
   * Handle issue_comment events (for PR comments with @xyne mentions)
   */
  private async handleIssueCommentEvent(
    payload: GitHubIssueCommentPayload
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (payload.action !== 'created') {
        return { success: true, message: `Comment ${payload.action} acknowledged` };
      }

      // Check if this is a PR comment
      const issueData = payload.issue;
      const prData = issueData?.pull_request;

      if (!prData) {
        logger.info('[GitHub-Webhook] Comment on regular issue (not PR), skipping');
        return { success: true, message: 'Issue comment acknowledged but not processed' };
      }

      const prNumber = issueData.number;
      const prUrl = prData.html_url;
      const commentText = payload.comment.body || '';

      logger.info(`[GitHub-Webhook] Processing comment on PR #${prNumber}`);

      const mentions = this.extractMentions(commentText);

      const isXyneMentioned = mentions.some(
        (m) =>
          m.toLowerCase() === XYNE_MENTION_EMAIL ||
          m.toLowerCase() === XYNE_MENTION_USERNAME
      );

      if (isXyneMentioned) {
        logger.info(`[GitHub-Webhook] Detected XyneSpaces mention in PR #${prNumber}`);

        await xyneCommentService.handleXyneMention({
          prId: prNumber,
          prUrl: prUrl,
          projectName: payload.repository.owner.login,
          repoName: payload.repository.name,
        });
      }

      return { success: true, message: 'Comment event processed successfully' };
    } catch (error) {
      logger.error('[GitHub-Webhook] Error handling issue_comment event:', error);
      return { success: true, message: 'Comment event error acknowledged' };
    }
  }

  /**
   * Extract common PR context from webhook payload
   */
  private extractPRContext(
    payload: GitHubPullRequestPayload,
    workspaceId: string
  ): PREventContext {
    const pr = payload.pull_request;
    const repo = payload.repository;
    const repoName = repo.name;
    const projectName = repo.owner.login;

    // Build repository URL (HTTPS git clone URL)
    const repoUrl = repo.clone_url;

    const prUrl = pr.html_url;

    // Total comments (issue comments + review comments)
    const numberOfComments = pr.comments + pr.review_comments;

    return {
      pr,
      prId: pr.number,
      prUrl,
      repoName,
      repoUrl,
      projectName,
      workspace: workspaceId,
      sourceBranch: pr.head.ref,
      destinationBranch: pr.base.ref,
      numberOfComments,
      prAuthor: pr.user.name || pr.user.login,
      prAuthorEmail: pr.user.email,
    };
  }

  /**
   * Route PR event to appropriate handler
   */
  private async routePREvent(
    action: string,
    context: PREventContext,
    validationResult: { isValid: boolean; ticketId?: string }
  ): Promise<void> {
    switch (action) {
      case GitHubPREventType.PR_OPENED:
      case GitHubPREventType.PR_REOPENED:
        await this.handlePRCreated(context, validationResult);
        break;

      case GitHubPREventType.PR_SYNCHRONIZE:
      case GitHubPREventType.PR_EDITED:
        await this.handlePRUpdated(context, validationResult);
        break;

      case GitHubPREventType.PR_CLOSED:
        // Check if PR was merged or just closed
        if (context.pr.merged) {
          await this.handlePRMerged(context, validationResult);
        } else {
          await this.handlePRClosed(context, validationResult);
        }
        break;

      default:
        logger.info(`[GitHub-Webhook] Unhandled PR action: ${action}`);
    }
  }

  /**
   * Handle PR created/opened event
   */
  private async handlePRCreated(
    context: PREventContext,
    validationResult: { isValid: boolean; ticketId?: string }
  ): Promise<void> {
    logger.info(`[GitHub-Webhook] PR created: ${context.prId} - ${context.prUrl}`);

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
        `[GitHub-Webhook] Stored PR in database: ${context.prUrl} (ticketId: ${validationResult.ticketId}, isNew: ${result.isNew})`
      );

      // Post or update PR check approval button if Varys bot is in channel
      if (validationResult.ticketId) {
        prCheckApprovalService.postOrUpdateApprovalButton({
          ticketId: validationResult.ticketId!,
          prId: context.prId,
          prUrl: context.prUrl,
        }).catch(err => logger.error('[GitHub-Webhook] PR check approval button error:', err));
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
      logger.debug(`[GitHub-Webhook] Skipping invalid/manual PR: ${context.prUrl}`);
    }
  }

  /**
   * Validate PR title using centralized validation service
   */
  private async validatePRTitle(
    context: PREventContext
  ): Promise<{ isValid: boolean; ticketId?: string }> {
    return await pullRequestValidationService.validatePullRequest({
      prTitle: context.pr.title,
      prId: context.prId,
      commitHash: context.pr.head.sha,
      sourceBranch: context.sourceBranch,
      destinationBranch: context.destinationBranch,
      workspaceId: context.workspace,
      repoName: context.repoName,
      repoUrl: context.repoUrl,
      prUrl: context.prUrl,
      numberOfComments: context.numberOfComments,
      // Report the verdict as a GitHub commit status ("Ticket Validation" check on the PR).
      target: { provider: VCSProviderType.GITHUB, owner: context.projectName, repo: context.repoName },
    });
  }

  /**
   * Handle PR updated event (synchronize = new commits, edited = title/description/base changed)
   */
  private async handlePRUpdated(
    context: PREventContext,
    validationResult: { isValid: boolean; ticketId?: string }
  ): Promise<void> {
    logger.info(`[GitHub-Webhook] PR updated: ${context.prId} - ${context.prUrl}`);

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
        `[GitHub-Webhook] 🆕 Created PR from update event: ${context.prUrl} (first seen via ${prEvent})`
      );
    }

    // Post or update PR check approval button if Varys bot is in channel
    if (validationResult.ticketId) {
      prCheckApprovalService.postOrUpdateApprovalButton({
        ticketId: validationResult.ticketId!,
        prId: context.prId,
        prUrl: context.prUrl,
      }).catch(err => logger.error('[GitHub-Webhook] PR check approval button error:', err));
    }

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
    logger.info(`[GitHub-Webhook] PR merged: ${context.prId} - ${context.prUrl}`);

    const result = await this.prMetricsRepository.markMergedPr({
      prId: context.prId,
      prUrl: context.prUrl,
      repoName: context.repoName,
      repoUrl: context.repoUrl,
      sourceBranchName: context.sourceBranch,
      destinationBranchName: context.destinationBranch,
      numberOfComments: context.numberOfComments,
      commitAnalysisStatus: 'PENDING', // Mark for async analysis
    });

    // Enqueue commit analysis job (async, non-blocking)
    if (result?.pr) {
      try {
        // Extract owner/repo from repository URL or name
        const [owner, repo] = context.repoName.includes('/')
          ? context.repoName.split('/')
          : [context.projectName || '', context.repoName];

        await commitAnalysisQueue.enqueueAnalysis({
          workspaceId: result.pr.workspaceId,
          prId: context.prId,
          prInternalId: result.pr.id,
          repositoryUrl: context.repoUrl,
          projectKey: owner,
          repositorySlug: repo,
          vcsProvider: 'github',
        });

        logger.info(`[GitHub-Webhook] Enqueued commit analysis for PR #${String(context.prId).replace(/[\r\n]/g, '')}`);
      } catch (error) {
        // Log but don't fail webhook - analysis can be retried
        logger.error(`[GitHub-Webhook] Failed to enqueue commit analysis for PR #${String(context.prId).replace(/[\r\n]/g, '')}:`, error);
      }
    }

    if (result) {
      if (result.statusChanged) {
        logger.info(
          `[GitHub-Webhook] PR ${context.prId} status: ${result.previousStatus} → MERGED`
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
        `[GitHub-Webhook] ℹ️ Ignored manual PR webhook: ${context.prUrl} (not created by Xyne)`
      );
    }
    // NOTE: release sync is fired in handlePullRequestEvent (before the PR-title
    // validation gate), not here — so it also runs for hotfix PRs whose dev
    // ticket doesn't exist yet.
  }

  /**
   * Handle PR closed (but not merged) event
   */
  private async handlePRClosed(
    context: PREventContext,
    _validationResult: { isValid: boolean; ticketId?: string }
  ): Promise<void> {
    logger.info(`[GitHub-Webhook] PR closed (declined): ${context.prId} - ${context.prUrl}`);

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
        logger.info(`[GitHub-Webhook] PR ${context.prId} status: ${result.previousStatus} → DECLINED`);

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
        `[GitHub-Webhook] ℹ️ Ignored manual PR webhook: ${context.prUrl} (not created by Xyne)`
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
      logger.error('[GitHub-Webhook] Error getting ticketId for PR:', error);
      return null;
    }
  }

  /**
   * Extract mentions from comment text
   */
private extractMentions(text: string): string[] {
    const mentions: string[] = [];
    const emailMentionRegex = /@([\w.-]+@[\w.-]+)/g;
    const simpleMentionRegex = /@([\w-]+)/g;

    let match: RegExpExecArray | null;

    while ((match = emailMentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }

    while ((match = simpleMentionRegex.exec(text)) !== null) {
      const mentionText = match[1];
      if (!mentions.some((m) => m.includes(mentionText))) {
        mentions.push(mentionText);
      }
    }

    return mentions;
  }
}

export const githubWebhookService = new GitHubWebhookService();
