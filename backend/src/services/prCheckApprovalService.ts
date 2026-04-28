import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { randomUUID } from 'crypto';
import { MessageType } from '@xyne/shared';

const VARYS_BOT_EMAIL = 'varys@app.xyne.ai';
const PR_CHECK_MESSAGE_SUBTYPE = 'pr_check_approval';

interface ApprovalButtonParams {
  ticketId: string;
  prId: number;
  prUrl: string;
}

/**
 * Parse Bitbucket PR URL to extract projectKey + repositorySlug.
 * URL format: https://bitbucket.example.com/projects/{PROJECT_KEY}/repos/{REPO_SLUG}/pull-requests/{PR_ID}
 */
function parsePrUrl(prUrl: string): { projectKey: string; repositorySlug: string } | null {
  const match = prUrl.match(/\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/);
  if (!match) return null;
  return { projectKey: match[1], repositorySlug: match[2] };
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

  // 1. Find Varys bot user
  const botUser = await db.user.findFirst({ where: { email: VARYS_BOT_EMAIL } });
  if (!botUser) {
    logger.debug('[PR-Check-Approval] Varys bot user not found — app not installed yet');
    return;
  }

  // 2. Find ticket → get channelId, conversationId
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { channelId: true, conversationId: true },
  });
  if (!ticket?.conversationId || !ticket?.channelId) {
    logger.debug(`[PR-Check-Approval] Ticket ${ticketId} not found or has no conversation`);
    return;
  }

  // 3. Check bot is channel participant
  const participation = await db.channelParticipant.findUnique({
    where: {
      channelId_userId: {
        channelId: ticket.channelId,
        userId: botUser.id,
      },
    },
  });
  if (!participation) {
    logger.debug(`[PR-Check-Approval] Varys bot not in channel ${ticket.channelId} — skipping`);
    return;
  }

  // 4. Parse prUrl
  const parsed = parsePrUrl(prUrl);
  if (!parsed) {
    logger.warn(`[PR-Check-Approval] Could not parse prUrl: ${prUrl}`);
    return;
  }

  // 5. Build actionableUrl
  const actionableUrl = `${config.backendUrl}/api/apps/pr-check/callback`;

  // 6. Build message with YAML frontmatter
  const actionId = randomUUID();
  const content = `---
appActions:
- actionId: "${actionId}"
  label: "Run PR Check"
  type: "button"
  color: "#3b82f6"
  reusable: true
  actionableUrl: "${actionableUrl}"
  context:
    ticketId: "${ticketId}"
    prId: "${prId}"
    projectKey: "${parsed.projectKey}"
    repositorySlug: "${parsed.repositorySlug}"
    showToAll: true
---

🔍 **PR Check Available**

PR [#${prId}](${prUrl}) in \`${parsed.repositorySlug}\`

Click **Run PR Check** to trigger Bit-Bot analysis.`;

  // 7. Check for existing approval message for this PR
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
    // 8a. Update existing message (refreshes button with new actionId)
    await db.message.update({
      where: { messageId: existing.messageId },
      data: { content, edited: true },
    });
    logger.info(`[PR-Check-Approval] Updated approval button for PR #${prId} in ticket ${ticketId}`);
  } else {
    // 8b. Create new message
    const messageId = randomUUID();
    await db.message.create({
      data: {
        messageId,
        conversationId: ticket.conversationId,
        senderId: botUser.id,
        content,
        msgType: MessageType.BOT,
        showInChannel: false,
        metadata: {
          hasAppActions: true,
          contentFormat: 'markdown',
          messageSubtype: PR_CHECK_MESSAGE_SUBTYPE,
          prId,
          prUrl,
        },
      },
    });

    // Increment conversation reply count
    await db.conversation.update({
      where: { conversationId: ticket.conversationId },
      data: {
        replyCount: { increment: 1 },
        lastActivityAt: new Date(),
      },
    });

    logger.info(`[PR-Check-Approval] Created approval button ${messageId} for PR #${prId} in ticket ${ticketId}`);
  }
}

export const prCheckApprovalService = { postOrUpdateApprovalButton };
