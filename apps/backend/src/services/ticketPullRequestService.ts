// TicketPullRequestService
//
// Owns the ticket-INITIATED Bitbucket PR flow: create a PR from a ticket, link
// an existing PR by URL, list linked PRs, refresh metadata, and unlink. The
// webhook-INITIATED flow (Bitbucket -> ticket status/assignment) already lives
// in bitbucketWebhookService + prTicketStatusSyncService and is unchanged here;
// both paths converge on the same `pull_requests` persistence.
//
// Security: every method takes an authenticated actor and enforces that the
// ticket belongs to the actor's workspace before mutating linkage. Repository
// credentials and raw provider errors are never returned to callers.

import type { PullRequests, Ticket } from '@prisma/client';
import { PRStatus, ActivityType } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { PRMetricsRepository } from '@/database/repositories/pullRequestsRepository';
import { getBitbucketManager } from '@/git-providers/factory';
import type { BitbucketPullRequestDetails } from '@/git-providers/bitbucket/apis';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { isTicketPrFlagEnabled, TICKET_PR_FLAGS } from '@/services/ticketPrFeatureFlags';
import {
  parseBitbucketPrUrl,
  parseBitbucketRepoUrl,
  computeValidation,
} from '@/services/ticketPrValidation';
import {
  TicketPullRequestError,
  type CreateTicketPRInput,
  type LinkTicketPRInput,
  type TicketPullRequestDto,
  type TicketPullRequestValidation,
} from '@/types/ticketPullRequest';
import { logger } from '@/utils/logger';

interface Actor {
  userId: string;
  workspaceId: string;
}

/** Map a raw Bitbucket PR state to our PRStatus enum. */
function mapBitbucketStateToPRStatus(state: string): PRStatus {
  switch ((state || '').toUpperCase()) {
    case 'MERGED':
      return PRStatus.MERGED;
    case 'DECLINED':
    case 'REJECTED':
      return PRStatus.DECLINED;
    case 'DELETED':
      return PRStatus.DELETED;
    default:
      return PRStatus.OPEN;
  }
}

export class TicketPullRequestService {
  private readonly prisma = DatabaseClient.getInstance();
  private readonly ticketRepository: TicketRepository;
  private readonly prMetricsRepository: PRMetricsRepository;

  constructor(
    ticketRepository: TicketRepository = new TicketRepository(),
    prMetricsRepository: PRMetricsRepository = new PRMetricsRepository(),
  ) {
    this.ticketRepository = ticketRepository;
    this.prMetricsRepository = prMetricsRepository;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async listPullRequestsForTicket(
    ticketId: string,
    actor: Actor,
  ): Promise<TicketPullRequestDto[]> {
    await this.requirePanelEnabled(actor);
    const ticket = await this.requireTicketAccess(ticketId, actor);

    const rows = await this.prisma.pullRequests.findMany({
      where: { ticketId, workspaceId: actor.workspaceId },
      orderBy: { updatedAt: 'desc' },
    });

    return rows.map((row) => this.toDto(row, ticket, /* validation */ undefined));
  }

  async createPullRequestFromTicket(
    ticketId: string,
    input: CreateTicketPRInput,
    actor: Actor,
  ): Promise<TicketPullRequestDto> {
    await this.requireFlag(TICKET_PR_FLAGS.CREATE, actor);
    const ticket = await this.requireTicketAccess(ticketId, actor);

    const parsedRepo = parseBitbucketRepoUrl(input.repositoryUrl);
    if (!parsedRepo) {
      throw new TicketPullRequestError(
        'INVALID_INPUT',
        'repositoryUrl is not a recognizable Bitbucket repository URL.',
        400,
      );
    }
    if (!input.sourceBranchName || !input.destinationBranchName) {
      throw new TicketPullRequestError(
        'INVALID_INPUT',
        'sourceBranchName and destinationBranchName are required.',
        400,
      );
    }

    const manager = getBitbucketManager();
    // raisePr persists the PR row (with ticketId) via PRMetricsRepository and
    // returns the PR URL. It also handles the duplicate-PR (409) case.
    const prUrl = await manager.raisePr(
      input.repositoryUrl,
      /* childExecutionId */ `ticket-${ticket.id}`,
      input.destinationBranchName,
      input.sourceBranchName,
      parsedRepo.projectKey,
      parsedRepo.repoSlug,
      input.title ?? ticket.title,
      input.description ?? this.buildDescription(ticket),
      ticket.xyneId,
      ticket.id,
    );

    if (!prUrl) {
      throw new TicketPullRequestError(
        'PROVIDER_ERROR',
        'Failed to create the pull request in Bitbucket. Check repository access and branch names.',
        502,
      );
    }

    const parsedPr = parseBitbucketPrUrl(prUrl);
    const row = parsedPr
      ? await this.prMetricsRepository.findPrByIdAndUrl(parsedPr.prId, parsedPr.prUrl)
      : null;

    await this.recordActivity(ticket, `raised pull request ${prUrl}`, actor.userId);
    logger.info(
      `[TicketPR] Created PR for ticket ${ticket.xyneId} (${ticket.id}) by ${actor.userId}: ${prUrl}`,
    );

    if (!row) {
      // PR created in Bitbucket but the row wasn't found (e.g. race). Return a
      // minimal DTO so the UI can still render the created PR.
      return this.syntheticDto(ticket, prUrl, parsedPr?.prId ?? 0, input);
    }
    return this.toDto(row, ticket, undefined);
  }

  async linkExistingPullRequest(
    ticketId: string,
    input: LinkTicketPRInput,
    actor: Actor,
  ): Promise<TicketPullRequestDto> {
    await this.requireFlag(TICKET_PR_FLAGS.LINK, actor);
    const ticket = await this.requireTicketAccess(ticketId, actor);

    const parsed = parseBitbucketPrUrl(input.pullRequestUrl);
    if (!parsed) {
      throw new TicketPullRequestError(
        'INVALID_PR_URL',
        'pullRequestUrl is not a recognizable Bitbucket pull-request URL.',
        400,
      );
    }

    const details = await this.fetchPrDetails(parsed.projectKey, parsed.repoSlug, parsed.prId);

    await this.prMetricsRepository.createOrUpdatePR({
      prId: details.prId,
      prUrl: parsed.prUrl,
      repoName: parsed.repoSlug,
      repoUrl: this.repoUrlFromPrUrl(parsed.prUrl),
      sourceBranchName: details.sourceBranchName,
      destinationBranchName: details.destinationBranchName,
      numberOfComments: details.commentCount,
      ticketId: ticket.id,
    });

    const row = await this.prMetricsRepository.findPrByIdAndUrl(details.prId, parsed.prUrl);
    const validation = await this.validateForTicket(ticket, details);

    await this.recordActivity(ticket, `linked pull request ${parsed.prUrl}`, actor.userId);
    logger.info(
      `[TicketPR] Linked PR ${parsed.prUrl} to ticket ${ticket.xyneId} (${ticket.id}) by ${actor.userId}`,
    );

    if (!row) {
      return this.syntheticDto(ticket, parsed.prUrl, details.prId, {
        repositoryUrl: this.repoUrlFromPrUrl(parsed.prUrl),
        sourceBranchName: details.sourceBranchName,
        destinationBranchName: details.destinationBranchName,
      });
    }
    return this.toDto(row, ticket, validation, details);
  }

  async refreshPullRequest(
    ticketId: string,
    pullRequestRowId: string,
    actor: Actor,
  ): Promise<TicketPullRequestDto> {
    await this.requirePanelEnabled(actor);
    const ticket = await this.requireTicketAccess(ticketId, actor);
    const row = await this.requireLinkedPr(ticketId, pullRequestRowId, actor);

    const parsed = parseBitbucketPrUrl(row.prUrl);
    if (!parsed) {
      // Nothing to refresh from provider; return the stored row.
      return this.toDto(row, ticket, undefined);
    }

    const details = await this.fetchPrDetails(parsed.projectKey, parsed.repoSlug, parsed.prId);

    await this.prMetricsRepository.createOrUpdatePR({
      prId: details.prId,
      prUrl: parsed.prUrl,
      repoName: parsed.repoSlug,
      repoUrl: row.repositoryUrl,
      sourceBranchName: details.sourceBranchName,
      destinationBranchName: details.destinationBranchName,
      numberOfComments: details.commentCount,
      ticketId: ticket.id,
    });

    const updated =
      (await this.prMetricsRepository.findPrByIdAndUrl(details.prId, parsed.prUrl)) ?? row;
    const validation = await this.validateForTicket(ticket, details);
    logger.info(`[TicketPR] Refreshed PR ${parsed.prUrl} on ticket ${ticket.xyneId}`);
    return this.toDto(updated, ticket, validation, details);
  }

  async unlinkPullRequest(
    ticketId: string,
    pullRequestRowId: string,
    actor: Actor,
  ): Promise<void> {
    await this.requirePanelEnabled(actor);
    const ticket = await this.requireTicketAccess(ticketId, actor);
    const row = await this.requireLinkedPr(ticketId, pullRequestRowId, actor);

    // Detach from ticket (do NOT delete the PR metric row — it is still valid
    // history). Scope by workspace + row id to prevent cross-tenant writes.
    await this.prisma.pullRequests.updateMany({
      where: { id: row.id, ticketId, workspaceId: actor.workspaceId },
      data: { ticketId: null },
    });

    await this.recordActivity(ticket, `unlinked pull request ${row.prUrl}`, actor.userId);
    logger.info(
      `[TicketPR] Unlinked PR ${row.prUrl} from ticket ${ticket.xyneId} by ${actor.userId}`,
    );
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async requireTicketAccess(ticketId: string, actor: Actor): Promise<Ticket> {
    const ticket = await this.ticketRepository.getTicketById(ticketId);
    if (!ticket) {
      throw new TicketPullRequestError('TICKET_NOT_FOUND', 'Ticket not found', 404);
    }
    if (ticket.workspaceId !== actor.workspaceId) {
      // Do not distinguish "not found" from "forbidden" beyond the code.
      throw new TicketPullRequestError('PERMISSION_DENIED', 'Access denied', 403);
    }
    return ticket;
  }

  private async requireLinkedPr(
    ticketId: string,
    pullRequestRowId: string,
    actor: Actor,
  ): Promise<PullRequests> {
    const row = await this.prisma.pullRequests.findFirst({
      where: { id: pullRequestRowId, ticketId, workspaceId: actor.workspaceId },
    });
    if (!row) {
      throw new TicketPullRequestError('PR_NOT_FOUND', 'Pull request not linked to this ticket', 404);
    }
    return row;
  }

  private async requirePanelEnabled(actor: Actor): Promise<void> {
    const enabled = await isTicketPrFlagEnabled(TICKET_PR_FLAGS.PANEL, {
      workspaceId: actor.workspaceId,
      userId: actor.userId,
    });
    if (!enabled) {
      throw new TicketPullRequestError('FEATURE_DISABLED', 'Ticket PR panel is not enabled', 403);
    }
  }

  private async requireFlag(flag: string, actor: Actor): Promise<void> {
    await this.requirePanelEnabled(actor);
    const enabled = await isTicketPrFlagEnabled(flag as never, {
      workspaceId: actor.workspaceId,
      userId: actor.userId,
    });
    if (!enabled) {
      throw new TicketPullRequestError('FEATURE_DISABLED', 'This action is not enabled', 403);
    }
  }

  private async fetchPrDetails(
    projectKey: string,
    repoSlug: string,
    prId: number,
  ): Promise<BitbucketPullRequestDetails> {
    const manager = getBitbucketManager();
    const details = await manager.getPullRequestById(projectKey, repoSlug, prId);
    if (!details) {
      throw new TicketPullRequestError(
        'REPOSITORY_INACCESSIBLE',
        'Unable to read the pull request from Bitbucket. Check the URL and repository access.',
        502,
      );
    }
    return details;
  }

  private async validateForTicket(
    ticket: Ticket,
    details: BitbucketPullRequestDetails,
  ): Promise<TicketPullRequestValidation> {
    const strict = await isTicketPrFlagEnabled(TICKET_PR_FLAGS.STRICT_VALIDATION, {
      workspaceId: ticket.workspaceId,
      boardId: ticket.boardId,
    });
    return computeValidation({
      ticketXyneId: ticket.xyneId,
      prTitle: details.title,
      prStatus: mapBitbucketStateToPRStatus(details.state),
      ticketResolved: ticket.status === 'RESOLVED',
      strict,
    });
  }

  private toDto(
    row: PullRequests,
    ticket: Ticket,
    validation?: TicketPullRequestValidation,
    details?: BitbucketPullRequestDetails,
  ): TicketPullRequestDto {
    return {
      id: row.id,
      prId: row.prId,
      repoName: row.repoName,
      repositoryUrl: row.repositoryUrl ?? null,
      sourceBranchName: row.sourceBranchName,
      destinationBranchName: row.destinationBranchName,
      status: row.status,
      prUrl: row.prUrl ?? null,
      ticketId: ticket.id,
      validation: validation ?? this.cheapValidation(row, ticket),
      reviewers: details?.reviewers,
      commentCount: details?.commentCount ?? row.numberOfComments,
      lastSyncedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
    };
  }

  /**
   * Best-effort validation on list without a provider round-trip: we only know
   * ticket-resolved and status. Title-based checks require refresh.
   */
  private cheapValidation(row: PullRequests, ticket: Ticket): TicketPullRequestValidation {
    if (ticket.status === 'RESOLVED') {
      return {
        state: 'warning',
        reason: 'ticket-resolved',
        message: `Ticket ${ticket.xyneId} is already resolved.`,
      };
    }
    if (row.status === PRStatus.DELETED) {
      return { state: 'unknown' };
    }
    return { state: 'unknown' };
  }

  private syntheticDto(
    ticket: Ticket,
    prUrl: string,
    prId: number,
    input: {
      repositoryUrl?: string;
      sourceBranchName?: string;
      destinationBranchName?: string;
    },
  ): TicketPullRequestDto {
    return {
      id: `pending-${prId}`,
      prId,
      repoName: parseBitbucketRepoUrl(input.repositoryUrl ?? prUrl)?.repoSlug ?? '',
      repositoryUrl: input.repositoryUrl ?? this.repoUrlFromPrUrl(prUrl),
      sourceBranchName: input.sourceBranchName ?? '',
      destinationBranchName: input.destinationBranchName ?? '',
      status: PRStatus.OPEN,
      prUrl,
      ticketId: ticket.id,
      validation: { state: 'unknown' },
    };
  }

  private repoUrlFromPrUrl(prUrl: string): string {
    // Strip the /pull-requests/<id> suffix to get the repo URL.
    return prUrl.replace(/\/pull-requests\/\d+.*$/i, '');
  }

  private buildDescription(ticket: Ticket): string {
    return [
      `Xyne ticket: ${ticket.xyneId}`,
      '',
      ticket.description ?? '',
    ].join('\n');
  }

  private async recordActivity(ticket: Ticket, value: string, actorUserId: string): Promise<void> {
    try {
      await recordTicketTimelineEvent({
        activity: {
          ticketId: ticket.id,
          updatedBy: actorUserId,
          activityType: ActivityType.PR,
          value,
          workspaceId: ticket.workspaceId,
          channelId: ticket.channelId,
        },
        message: {
          conversationId: ticket.conversationId,
          senderId: actorUserId,
          content: value,
          workspaceId: ticket.workspaceId,
          activityType: ActivityType.PR,
        },
      });
    } catch (error) {
      // Activity is best-effort; never fail the PR operation because the
      // timeline write failed.
      logger.error(`[TicketPR] Failed to record activity for ticket ${ticket.id}:`, error);
    }
  }
}

export const ticketPullRequestService = new TicketPullRequestService();
