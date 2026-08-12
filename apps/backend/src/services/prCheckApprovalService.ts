import { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { randomUUID } from 'crypto';
import { MessageType } from '@xyne/shared';
import { parseBitbucketPrUrl } from '@/utils/repoUrlParser';

const VARYS_BOT_EMAIL = 'varys@app.xyne.ai';
const PR_CHECK_MESSAGE_SUBTYPE = 'pr_check_approval';
const PR_CHECK_NO_TICKET_SUBTYPE = 'pr_check_no_ticket';

interface ApprovalButtonParams {
  ticketId: string;
  prId: number;
  prUrl: string;
}

interface PrLinkMessageParams {
  messageId: string;
  conversationId: string;
  channelId: string;
  senderId: string;
  content: string;
  workspaceId: string;
}

interface ParsedPrLink {
  prUrl: string; // canonical
  prId: number;
  projectKey: string;
  repositorySlug: string;
}

/**
 * Extract the first Bitbucket PR link from message content (HTML or plain
 * text). Only a URL on the configured Bitbucket host (or a subdomain) is
 * accepted — a substring host check would match attacker-controlled lookalike
 * domains. Returns the canonical form (query params / trailing segments like
 * /overview stripped). Exported for tests.
 */
export function extractPrLink(content: string): ParsedPrLink | null {
  const bitbucketHost = (config.bitbucket.baseUrl
    ? new URL(config.bitbucket.baseUrl).hostname
    : ''
  ).toLowerCase();
  if (!bitbucketHost) return null;

  const urlPattern = /https?:\/\/[^\s"'<>]+\/pull-requests\/\d+/g;
  for (const match of content.matchAll(urlPattern)) {
    const parsed = parseBitbucketPrUrl(match[0]);
    if (!parsed) continue;
    if (parsed.hostname !== bitbucketHost && !parsed.hostname.endsWith(`.${bitbucketHost}`)) continue;

    return parsed;
  }

  return null;
}

/**
 * Build the "Run PR Check" button message content (YAML appActions frontmatter).
 */
function buildButtonContent(params: {
  prId: number;
  prUrl: string;
  projectKey: string;
  repositorySlug: string;
  ticketId: string;
  conversationId?: string;
  channelId?: string;
}): string {
  const actionableUrl = `${config.backendUrl}/api/apps/pr-check/callback`;
  const actionId = randomUUID();

  const contextLines = [
    `    ticketId: "${params.ticketId}"`,
    `    prId: "${params.prId}"`,
    `    projectKey: "${params.projectKey}"`,
    `    repositorySlug: "${params.repositorySlug}"`,
    ...(params.conversationId ? [`    conversationId: "${params.conversationId}"`] : []),
    ...(params.channelId ? [`    channelId: "${params.channelId}"`] : []),
    `    showToAll: true`,
  ].join('\n');

  return `---
appActions:
- actionId: "${actionId}"
  label: "Run PR Check"
  type: "button"
  color: "#3b82f6"
  reusable: true
  actionableUrl: "${actionableUrl}"
  context:
${contextLines}
---

🔍 **PR Check Available**

PR [#${params.prId}](${params.prUrl}) in \`${params.repositorySlug}\`

Click **Run PR Check** to trigger Bit-Bot analysis.`;
}

/**
 * Find the Varys bot user if it is a participant of the given channel.
 * Channel membership of the bot is the per-channel feature flag.
 */
async function findBotInChannel(channelId: string): Promise<{ id: string } | null> {
  const botUser = await db.user.findFirst({ where: { email: VARYS_BOT_EMAIL } });
  if (!botUser) {
    logger.debug('[PR-Check-Approval] Varys bot user not found — app not installed yet');
    return null;
  }

  const participation = await db.channelParticipant.findUnique({
    where: {
      channelId_userId: {
        channelId,
        userId: botUser.id,
      },
    },
  });
  if (!participation) {
    logger.debug(`[PR-Check-Approval] Varys bot not in channel ${channelId} — skipping`);
    return null;
  }

  return botUser;
}

/**
 * Create the button message as the bot user and bump conversation activity.
 * All writes (message, conversation counters, and the optional PR-thread
 * subscription row) commit atomically in one transaction.
 */
async function createButtonMessage(params: {
  conversationId: string;
  botUserId: string;
  content: string;
  prId: number;
  prUrl: string;
  workspaceId: string;
  threadLink?: {
    projectKey: string;
    repositorySlug: string;
    channelId: string;
    workspaceId: string;
  };
}): Promise<string> {
  const messageId = randomUUID();
  const replyNow = new Date();

  await db.$transaction([
    db.message.create({
      data: {
        messageId,
        conversationId: params.conversationId,
        workspaceId: params.workspaceId,
        senderId: params.botUserId,
        content: params.content,
        msgType: MessageType.BOT,
        showInChannel: false,
        metadata: {
          hasAppActions: true,
          contentFormat: 'markdown',
          messageSubtype: PR_CHECK_MESSAGE_SUBTYPE,
          prId: params.prId,
          prUrl: params.prUrl,
        },
      },
    }),
    db.conversation.update({
      where: { conversationId: params.conversationId },
      data: {
        replyCount: { increment: 1 },
        lastActivityAt: replyNow,
      },
    }),
    db.conversationParticipant.updateMany({
      where: { conversationId: params.conversationId },
      data: { lastReplyAt: replyNow },
    }),
    ...(params.threadLink
      ? [
          db.prThreadLink.create({
            data: {
              prUrl: params.prUrl,
              prId: params.prId,
              projectKey: params.threadLink.projectKey,
              repositorySlug: params.threadLink.repositorySlug,
              conversationId: params.conversationId,
              channelId: params.threadLink.channelId,
              messageId,
              workspaceId: params.threadLink.workspaceId,
              createdAt: replyNow,
              updatedAt: replyNow,
            },
          }),
        ]
      : []),
  ]);

  return messageId;
}

/**
 * Reply in the poster's thread when their PR link has no linked ticket, so
 * the missing button is explained rather than silent. No PrThreadLink is
 * written for the no-ticket case, so the button pre-check can't dedupe this;
 * guard on a prior notice message instead — the side-effect queue re-delivers
 * the same message insert, which would otherwise re-post on every redelivery.
 */
async function postNoTicketNotice(params: {
  conversationId: string;
  botUserId: string;
  workspaceId: string;
  link: ParsedPrLink;
}): Promise<void> {
  const existingNotice = await db.message.findFirst({
    where: {
      conversationId: params.conversationId,
      isDeleted: false,
      AND: [
        { metadata: { path: ['messageSubtype'], equals: PR_CHECK_NO_TICKET_SUBTYPE } },
        { metadata: { path: ['prUrl'], equals: params.link.prUrl } },
      ],
    },
    select: { messageId: true },
  });
  if (existingNotice) {
    logger.debug(
      `[PR-Check-Approval] No-ticket notice already posted for PR #${params.link.prId} in conversation ${params.conversationId} — skipping`
    );
    return;
  }

  const content = `⚠️ No linked ticket found for PR [#${params.link.prId}](${params.link.prUrl}) in \`${params.link.repositorySlug}\` — PR checks can't run.

Make sure the PR title starts with a valid ticket ID (e.g. \`XYNE-1234: your title\`), then post the PR link again.`;

  const replyNow = new Date();
  await db.$transaction([
    db.message.create({
      data: {
        messageId: randomUUID(),
        conversationId: params.conversationId,
        workspaceId: params.workspaceId,
        senderId: params.botUserId,
        content,
        msgType: MessageType.BOT,
        showInChannel: false,
        metadata: {
          contentFormat: 'markdown',
          messageSubtype: PR_CHECK_NO_TICKET_SUBTYPE,
          prId: params.link.prId,
          prUrl: params.link.prUrl,
        },
      },
    }),
    db.conversation.update({
      where: { conversationId: params.conversationId },
      data: {
        replyCount: { increment: 1 },
        lastActivityAt: replyNow,
      },
    }),
    db.conversationParticipant.updateMany({
      where: { conversationId: params.conversationId },
      data: { lastReplyAt: replyNow },
    }),
  ]);
}

/**
 * Post or update the "Run PR Check" approval button in a ticket conversation.
 * Called from bitbucketWebhookService when a PR is linked to a ticket.
 *
 * Silently returns if:
 * - Varys app bot user is not found (app not installed)
 * - Ticket or conversation doesn't exist
 * - Bot is not a channel participant (feature not enabled for this channel)
 * - PR URL can't be parsed
 */
async function postOrUpdateApprovalButton(params: ApprovalButtonParams): Promise<void> {
  const { ticketId, prId, prUrl } = params;

  // 1. Find ticket → get channelId, conversationId
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { channelId: true, conversationId: true, workspaceId: true },
  });
  if (!ticket?.conversationId || !ticket?.channelId) {
    logger.debug(`[PR-Check-Approval] Ticket ${ticketId} not found or has no conversation`);
    return;
  }

  // 2. Bot must be installed and a participant of the ticket's channel
  const botUser = await findBotInChannel(ticket.channelId);
  if (!botUser) return;

  // 3. Parse prUrl
  const parsed = parseBitbucketPrUrl(prUrl);
  if (!parsed) {
    logger.warn(`[PR-Check-Approval] Could not parse prUrl: ${prUrl}`);
    return;
  }

  const content = buildButtonContent({
    prId,
    prUrl,
    projectKey: parsed.projectKey,
    repositorySlug: parsed.repositorySlug,
    ticketId,
  });

  // 4. Check for existing approval message for this PR
  const existing = await db.message.findFirst({
    where: {
      conversationId: ticket.conversationId,
      senderId: botUser.id,
      metadata: {
        path: ['messageSubtype'],
        equals: PR_CHECK_MESSAGE_SUBTYPE,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    // 5a. Update existing message (refreshes button with new actionId)
    await db.message.update({
      where: { messageId: existing.messageId },
      data: { content, edited: true },
    });
    logger.info(`[PR-Check-Approval] Updated approval button for PR #${prId} in ticket ${ticketId}`);
  } else {
    // 5b. Create new message
    const messageId = await createButtonMessage({
      conversationId: ticket.conversationId,
      botUserId: botUser.id,
      content,
      prId,
      prUrl,
      workspaceId: ticket.workspaceId,
    });
    logger.info(`[PR-Check-Approval] Created approval button ${messageId} for PR #${prId} in ticket ${ticketId}`);
  }
}

/**
 * Post "Run PR Check" buttons in a channel thread where a user posted Bitbucket
 * PR link(s) — e.g. the -merge channels. Lets devs trigger checks on their
 * existing PR without creating a duplicate ticket in the merge channel.
 *
 * Called from the messages side-effect handler for top-level, user-authored
 * messages in channels where the Varys bot is a participant.
 *
 * Also records a PrThreadLink per PR so later lifecycle updates (merged, build
 * status) can be mirrored into this thread.
 */
async function postApprovalButtonForPrLinkMessage(params: PrLinkMessageParams): Promise<void> {
  const link = extractPrLink(params.content);
  if (!link) return;

  const botUser = await findBotInChannel(params.channelId);
  if (!botUser) return;

  try {
    // Idempotency: the side-effect queue can re-deliver a message insert.
    // The (prUrl, conversationId) unique constraint is the backstop; this
    // pre-check avoids posting a duplicate button in the common case.
    const existingLink = await db.prThreadLink.findUnique({
      where: { prUrl_conversationId: { prUrl: link.prUrl, conversationId: params.conversationId } },
      select: { id: true },
    });
    if (existingLink) {
      logger.debug(
        `[PR-Check-Approval] Button already posted for PR #${link.prId} in conversation ${params.conversationId} — skipping`
      );
      return;
    }

    // The PR row (created by the Bitbucket webhook) carries the original
    // ticket link. link.prUrl is canonicalized but the webhook stores the raw
    // Bitbucket self href, so a divergent-casing row must still match —
    // case-insensitive. prId alone would NOT do — it's per-repo in Bitbucket.
    const pr = await db.pullRequests.findFirst({
      where: { prUrl: { equals: link.prUrl, mode: 'insensitive' } },
      orderBy: { updatedAt: 'desc' },
      select: { ticketId: true },
    });

    // No ticket linkage → no button. bitbot's PR_CHECK_REQUESTED contract
    // requires ticketId, so a button here would be guaranteed to fail on
    // click. Rare in practice (PR title validation enforces the ticket) —
    // tell the poster in their thread instead of failing silently.
    if (!pr?.ticketId) {
      logger.info(
        `[PR-Check-Approval] PR #${link.prId} (${link.repositorySlug}) has no linked ticket — posting notice in conversation ${params.conversationId}`
      );
      await postNoTicketNotice({
        conversationId: params.conversationId,
        botUserId: botUser.id,
        workspaceId: params.workspaceId,
        link,
      });
      return;
    }

    const content = buildButtonContent({
      prId: link.prId,
      prUrl: link.prUrl,
      projectKey: link.projectKey,
      repositorySlug: link.repositorySlug,
      ticketId: pr.ticketId,
      conversationId: params.conversationId,
      channelId: params.channelId,
    });

    // Message + counters + subscription row commit atomically; a concurrent
    // duplicate hits the unique constraint and rolls back the whole button.
    const buttonMessageId = await createButtonMessage({
      conversationId: params.conversationId,
      botUserId: botUser.id,
      content,
      prId: link.prId,
      prUrl: link.prUrl,
      workspaceId: params.workspaceId,
      threadLink: {
        projectKey: link.projectKey,
        repositorySlug: link.repositorySlug,
        channelId: params.channelId,
        workspaceId: params.workspaceId,
      },
    });

    logger.info(
      `[PR-Check-Approval] Posted thread button ${buttonMessageId} for PR #${link.prId} (${link.repositorySlug}) in conversation ${params.conversationId}`
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      logger.debug(
        `[PR-Check-Approval] Concurrent duplicate button for PR #${link.prId} in conversation ${params.conversationId} — skipped`
      );
      return;
    }
    logger.error(
      `[PR-Check-Approval] Failed to post thread button for PR #${link.prId} in conversation ${params.conversationId}:`,
      error
    );
  }
}

export const prCheckApprovalService = {
  postOrUpdateApprovalButton,
  postApprovalButtonForPrLinkMessage,
};
