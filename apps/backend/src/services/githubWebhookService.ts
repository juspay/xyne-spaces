import { PrismaClient, FormFieldType } from '@prisma/client';
import { logger } from '@/utils/logger';
import { xyneCommentService } from '@/services/xyneCommentService';
import { config } from '@/config/env';
import { createTicketWithConversation } from '@/apps/core/ticketutils';
import { DatabaseClient } from '@/database/client';
import { githubAppClient } from '@/services/githubAppClient';
import { ticketService } from '@/services/ticketService';

// Board custom fields that store the GitHub issue metadata. Resolved (and
// auto-created if missing) by name at runtime — ids differ per environment.
const FIELD_ISSUE_NUMBER = 'githubIssueNumber'; // 134
const FIELD_REPORTER = 'githubReporter'; // login, e.g. sirajshaik-code
const FIELD_REPORTER_ID = 'githubReporterId'; // numeric id — dedup + link key
const FIELD_REPOSITORY = 'githubRepository'; // owner/repo

interface GitHubUser {
  login: string;
  email?: string;
}

interface GitHubRepository {
  name: string;
  owner: GitHubUser;
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
}

interface GitHubIssue {
  number: number;
  pull_request?: {
    html_url: string;
  };
}

interface GitHubPRReviewCommentPayload {
  action: 'created' | 'edited' | 'deleted';
  comment: {
    body: string;
    user: GitHubUser;
  };
  issue?: GitHubIssue;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
}

interface GitHubIssueEventPayload {
  action: string;
  issue: {
    number: number;
    title: string;
    body?: string;
    html_url: string;
    state_reason?: string | null;
  };
  repository: GitHubRepository;
  sender: {
    login: string;
    id: number;
  };
}

const XYNE_MENTION_EMAIL = 'john.doe@gmail.com';
const XYNE_MENTION_USERNAME = 'xynespaces';

export class GitHubWebhookService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  async handleWebhookEvent(
    eventType: string,
    payload: unknown
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`[GitHub-Webhook] Received event: ${eventType}`);

      if (eventType === 'issue_comment') {
        return await this.handlePRReviewCommentEvent(payload as GitHubPRReviewCommentPayload);
      }

      if (eventType === 'issues') {
        return await this.handleIssueEvent(payload as GitHubIssueEventPayload);
      }

      logger.info(`[GitHub-Webhook] Non-handled event received: ${eventType}, skipping`);
      return { success: true, message: `Event ${eventType} acknowledged but not processed` };
    } catch (error) {
      logger.error(`[GitHub-Webhook] Error processing event ${eventType}:`, error);
      return { success: true, message: 'Error acknowledged' };
    }
  }

  private async handlePRReviewCommentEvent(
    payload: GitHubPRReviewCommentPayload
  ): Promise<{ success: boolean; message: string }> {
    if (payload.action !== 'created') {
      return { success: true, message: `Comment ${payload.action} acknowledged` };
    }

    // issue_comment events on regular issues don't have pull_request property
    // For PR comments, the PR data is in payload.issue (PRs are also issues in GitHub's API)
    const issueData = payload.issue;
    const prSpecificData = issueData?.pull_request;

    if (!prSpecificData) {
      logger.info('[GitHub-Webhook] Comment on regular issue (not PR), skipping');
      return { success: true, message: 'Issue comment acknowledged but not processed' };
    }

    const prNumber = issueData.number;
    const prUrl = prSpecificData.html_url;
    const commentText = payload.comment.body || '';

    logger.info(`[GitHub-Webhook] Processing comment on PR #${prNumber}`);
    logger.info(`[GitHub-Webhook] Comment body: ${commentText}`);

    const mentions = this.extractMentions(commentText);
    logger.info(`[GitHub-Webhook] Extracted mentions: ${mentions.join(', ')}`);

    const isXyneMentioned = mentions.some(
      (m) => m.toLowerCase() === XYNE_MENTION_EMAIL || m.toLowerCase() === XYNE_MENTION_USERNAME
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
  }

  private async handleIssueEvent(
    payload: GitHubIssueEventPayload
  ): Promise<{ success: boolean; message: string }> {
    const { action, issue, sender, repository } = payload;
    const repoFullName = `${repository?.owner?.login}/${repository?.name}`;
    logger.info(
      `[GitHub-Webhook] issues.${action} #${issue?.number} "${issue?.title}" ` +
        `by @${sender?.login} (id ${sender?.id}) in ${repoFullName}`
    );

    // Act on: opened (create), reopened (create-or-reopen), closed (close the
    // tracked ticket). Everything else (edited, labeled, assigned, …) is a no-op.
    if (action !== 'opened' && action !== 'reopened' && action !== 'closed') {
      return { success: true, message: `issues.${action} acknowledged (no-op)` };
    }

    const c = config.community;
    if (!c?.intakeBoardId || !c?.intakeChannelId || !c?.systemUserId) {
      logger.warn(
        '[GitHub-Webhook] Community intake is not fully configured ' +
          '(COMMUNITY_INTAKE_BOARD_ID / _CHANNEL_ID / _SYSTEM_USER_ID); skipping ticket creation'
      );
      return { success: true, message: 'Community intake not configured' };
    }

    const [intakeBoard, intakeChannel] = await Promise.all([
      this.prisma.board.findUnique({
        where: { id: c.intakeBoardId },
        select: { projectId: true, workspaceId: true },
      }),
      this.prisma.channel.findUnique({
        where: { id: c.intakeChannelId },
        select: { projectId: true, workspaceId: true, name: true },
      }),
    ]);
    if (
      !intakeBoard ||
      !intakeChannel ||
      intakeBoard.projectId !== intakeChannel.projectId ||
      intakeBoard.workspaceId !== intakeChannel.workspaceId
    ) {
      logger.warn(
        `[GitHub-Webhook] Invalid community board/channel configuration ` +
          `(board=${c.intakeBoardId}, channel=${c.intakeChannelId}); skipping ticket creation`
      );
      return { success: true, message: 'Community intake board/channel mismatch' };
    }

    const { projectId, workspaceId } = intakeBoard;

    // Ensure the board's GitHub custom fields exist (auto-create if missing).
    const fields = await this.ensureIssueCustomFields(c.intakeBoardId, projectId, workspaceId);

    // Dedup on (repository, issue number): don't create a second ticket for the
    // same repo + issue.
    if (fields) {
      const existingTicketId = await this.findTicketIdByRepoIssue(
        fields.contextId,
        fields.issueNumberFieldId,
        issue.number,
        fields.repositoryFieldId,
        repoFullName
      );
      if (existingTicketId) {
        // Issue reopened/closed on an already-tracked ticket → sync its status.
        if (action === 'reopened' || action === 'closed') {
          return await this.syncTicketStatus(
            existingTicketId,
            action,
            issue,
            repoFullName,
            c.systemUserId
          );
        }
        logger.info(
          `[GitHub-Webhook] ${repoFullName}#${issue.number} already tracked as ticket ` +
            `${existingTicketId}; skipping create`
        );
        return { success: true, message: `Issue #${issue.number} already tracked` };
      }
    }

    // A close event for an issue we never tracked: nothing to create or sync.
    if (action === 'closed') {
      logger.info(
        `[GitHub-Webhook] ${repoFullName}#${issue.number} closed but not tracked; nothing to sync`
      );
      return { success: true, message: `Issue #${issue.number} closed; not tracked` };
    }

    // Community-intake tickets are always authored by the community system bot;
    // the reporter's GitHub identity is captured in the custom fields below.
    const createdByUserId = c.systemUserId;

    const description =
      (issue?.body?.trim() || '_No description provided._') +
      `\n\n---\n` +
      `Reported by **@${sender?.login}** (GitHub user id \`${sender?.id}\`) via ` +
      `[${repoFullName}#${issue?.number}](${issue?.html_url}).`;

    // Fill the board custom fields (issue number, reporter, reporter id, repository).
    const fieldValues: Array<{ fieldId: string; fieldValue: string; actualFieldValue: string }> =
      [];
    if (fields) {
      fieldValues.push(
        {
          fieldId: fields.issueNumberFieldId,
          fieldValue: String(issue.number),
          actualFieldValue: String(issue.number),
        },
        {
          fieldId: fields.reporterFieldId,
          fieldValue: sender.login,
          actualFieldValue: sender.login,
        },
        {
          fieldId: fields.reporterIdFieldId,
          fieldValue: String(sender.id),
          actualFieldValue: String(sender.id),
        },
        {
          fieldId: fields.repositoryFieldId,
          fieldValue: repoFullName,
          actualFieldValue: repoFullName,
        }
      );
    }

    const result = await createTicketWithConversation({
      title: issue.title,
      description,
      projectId,
      boardId: c.intakeBoardId,
      channelId: c.intakeChannelId,
      userId: createdByUserId,
    });

    // Write the board custom-field values ourselves with version=1. The ticket
    // read path resolves currentVersion = (max(version) ?? 1) and filters
    // `version === currentVersion`, so values must be version 1 to render.
    if (fields && fieldValues.length > 0) {
      await this.prisma.formEntityValues.createMany({
        data: fieldValues.map((fv) => ({
          formId: fields.formId,
          entityId: result.ticketId,
          entityType: 'TICKET',
          fieldId: fv.fieldId,
          contextId: fields.contextId,
          version: 1,
          fieldValue: fv.fieldValue,
          actualFieldValue: fv.actualFieldValue,
          workspaceId,
        })),
      });
    }

    logger.info(
      `[GitHub-Webhook] Created community ticket for ${repoFullName}#${issue?.number} ` +
        `(githubIssueNumber=${issue.number}, githubReporterId=${sender?.id})`
    );

    // Acknowledge the reporter on the GitHub issue and point them to the community.
    const communityUrl = config.community?.url || '';
    const followLine = communityUrl ? ` Follow along here: ${communityUrl}` : '';
    const posted = await githubAppClient.postIssueComment(
      repository.owner.login,
      repository.name,
      issue.number,
      `👋 Thanks @${sender.login} — this issue is now tracked in the Xyne community ` +
        `#${intakeChannel.name} as ${result.xyneId}.${followLine}`
    );
    if (posted) {
      logger.info(
        `[GitHub-Webhook] Posted acknowledgement comment on ${repoFullName}#${issue.number}`
      );
    }

    return { success: true, message: `Ticket created for issue #${issue?.number}` };
  }

  /**
   * Sync a tracked ticket's status from a GitHub issue state change.
   *
   * Mapping (reopened ignores state_reason; close uses GitHub's three reasons):
   *   - reopened              → TODO
   *   - closed 'completed'    → COMPLETED
   *   - closed 'duplicate'    → COMPLETED  (resolved elsewhere; treated as done)
   *   - closed 'not_planned'  → CANCELLED  (won't be worked)
   *
   * Routed through ticketService.updateTicket so the change writes a STATUS
   * TicketActivity row and broadcasts the kanban-count delta (same side effects
   * as an in-app status change). Attributed to the community system bot.
   */
  private async syncTicketStatus(
    ticketId: string,
    action: 'reopened' | 'closed',
    issue: GitHubIssueEventPayload['issue'],
    repoFullName: string,
    updatedByUserId: string
  ): Promise<{ success: boolean; message: string }> {
    // Only 'not_planned' cancels; 'completed', 'duplicate', and any unset reason
    // resolve as COMPLETED.
    const newStatus =
      action === 'reopened'
        ? 'TODO'
        : issue.state_reason === 'not_planned'
          ? 'CANCELLED'
          : 'COMPLETED';

    await ticketService.updateTicket(ticketId, updatedByUserId, { status: newStatus });
    logger.info(
      `[GitHub-Webhook] ${repoFullName}#${issue.number} ${action} → ticket ${ticketId} status ${newStatus}`
    );
    return { success: true, message: `Issue #${issue.number} ${action} → ${newStatus}` };
  }

  /**
   * Ensure the board's GitHub custom fields exist (creating any that are missing)
   * and return the global definition ids used by form_entity_values. Fields are
   * keyed by name so ids can differ per environment.
   */
  private async ensureIssueCustomFields(
    boardId: string,
    projectId: string,
    workspaceId: string
  ): Promise<{
    formId: string;
    contextId: string;
    issueNumberFieldId: string;
    reporterFieldId: string;
    reporterIdFieldId: string;
    repositoryFieldId: string;
  } | null> {
    const mapping = await this.prisma.formContextMapping.findFirst({
      where: { contextId: boardId, contextType: 'BOARD' },
    });
    if (!mapping) {
      logger.warn(
        `[GitHub-Webhook] No form mapped to board ${boardId}; cannot create custom fields`
      );
      return null;
    }
    // Create sequentially (avoids sequenceNumber races within a single call).
    const issueNumberFieldId = await this.ensureBoardField(
      mapping.formId,
      workspaceId,
      projectId,
      FIELD_ISSUE_NUMBER
    );
    const reporterFieldId = await this.ensureBoardField(
      mapping.formId,
      workspaceId,
      projectId,
      FIELD_REPORTER
    );
    const reporterIdFieldId = await this.ensureBoardField(
      mapping.formId,
      workspaceId,
      projectId,
      FIELD_REPORTER_ID
    );
    const repositoryFieldId = await this.ensureBoardField(
      mapping.formId,
      workspaceId,
      projectId,
      FIELD_REPOSITORY
    );

    return {
      formId: mapping.formId,
      contextId: mapping.contextId,
      issueNumberFieldId,
      reporterFieldId,
      reporterIdFieldId,
      repositoryFieldId,
    };
  }

  /**
   * Ensure a STRING custom field exists on a board's form (global definition +
   * per-form membership), returning the global field definition id used by
   * form_entity_values. Idempotent via upsert.
   */
  private async ensureBoardField(
    formId: string,
    workspaceId: string,
    projectId: string,
    fieldName: string
  ): Promise<string> {
    const global = await this.prisma.globalField.upsert({
      where: {
        projectId_fieldName_fieldType: { projectId, fieldName, fieldType: FormFieldType.STRING },
      },
      create: { projectId, workspaceId, fieldName, fieldType: FormFieldType.STRING },
      update: {},
    });

    const existing = await this.prisma.formFields.findFirst({
      where: { formId, globalFieldId: global.id },
      select: { id: true },
    });
    if (existing) {
      return global.id;
    }

    const maxSeq = await this.prisma.formFields.aggregate({
      where: { formId },
      _max: { sequenceNumber: true },
    });
    await this.prisma.formFields.create({
      data: {
        formId,
        globalFieldId: global.id,
        workspaceId,
        isOptional: true,
        sequenceNumber: (maxSeq._max.sequenceNumber ?? 0) + 1,
      },
    });
    return global.id;
  }

  /**
   * Find an existing ticket for a GitHub issue, keyed on repository and issue number.
   */
  private async findTicketIdByRepoIssue(
    contextId: string,
    issueIdFieldId: string,
    issueNumber: number,
    repositoryFieldId: string | undefined,
    repoFullName: string
  ): Promise<string | null> {
    const prisma = this.prisma;
    // Tickets carrying this issue_id.
    const issueMatches = await prisma.formEntityValues.findMany({
      where: { fieldId: issueIdFieldId, contextId, fieldValue: String(issueNumber) },
      select: { entityId: true },
    });
    if (issueMatches.length === 0) {
      return null;
    }
    const candidateIds = issueMatches.map((m) => m.entityId);

    // If a repository field exists, require it to match too (repo-scoped dedup).
    if (repositoryFieldId) {
      const repoMatch = await prisma.formEntityValues.findFirst({
        where: {
          fieldId: repositoryFieldId,
          contextId,
          fieldValue: repoFullName,
          entityId: { in: candidateIds },
        },
        select: { entityId: true },
      });
      return repoMatch?.entityId ?? null;
    }

    // No repository field yet → issue_id-only dedup.
    return candidateIds[0] ?? null;
  }

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
