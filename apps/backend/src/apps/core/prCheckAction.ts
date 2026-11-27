import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { config } from '@/config/env';
import { prepareAppWebhookDispatch } from '@/apps/core/appUrlResolver';
import { safeWebhookFetch } from '@/utils/ssrfGuard';

// Varys bot email - source of truth for finding the installed app
const VARYS_BOT_EMAIL = 'varys@app.xyne.ai';

// Identifies "Run PR Check" buttons; dispatchAction handles them in-process.
const PR_CHECK_ACTION_PATH = '/api/apps/pr-check/callback';

export function prCheckActionableUrl(): string {
  return `${config.backendUrl}${PR_CHECK_ACTION_PATH}`;
}

export function isPrCheckActionableUrl(actionableUrl: string): boolean {
  try {
    const url = new URL(actionableUrl);
    return url.origin === new URL(config.backendUrl).origin && url.pathname === PR_CHECK_ACTION_PATH;
  } catch {
    return false;
  }
}

/**
 * Payload for PR check webhook event
 */
interface PRCheckRequestedPayload {
  eventType: 'PR_CHECK_REQUESTED';
  payload: {
    // Context from AppMentionEvent-like structure
    conversationId: string;
    channelId: string;
    userId: string;           // User who clicked the button
    senderName?: string;
    channelName?: string;
    createdAt: number;
    callerUserId?: string;

    // PR-specific context
    projectKey: string;
    repositorySlug: string;
    prId: string;
    ticketId: string;         // Reference to ticket
    art: boolean;             // Enable ART trigger

    // Metadata
    metadata: {
      triggeredBy: string;
      source: 'xyne_button_click';
    };
  };
}

/**
 * Find Varys installed app by bot email (source of truth)
 */
async function findVarysInstalledApp(): Promise<{ webhookUrl: string; userId: string } | null> {
  try {
    const botUser = await db.user.findFirst({
      where: { email: VARYS_BOT_EMAIL },
    });

    if (!botUser) {
      logger.error(`[PR-Check-Callback] Varys bot user not found with email: ${VARYS_BOT_EMAIL}`);
      return null;
    }

    const installedApp = await db.installedApps.findFirst({
      where: { userId: botUser.id },
      select: { webhookUrl: true, userId: true },
    });

    if (!installedApp || !installedApp.webhookUrl) {
      logger.error('[PR-Check-Callback] Varys installed app not found or webhook URL not configured');
      return null;
    }

    return {
      webhookUrl: installedApp.webhookUrl,
      userId: installedApp.userId,
    };
  } catch (error) {
    logger.error('[PR-Check-Callback] Error finding Varys installed app:', error);
    return null;
  }
}

/**
 * Send PR check webhook to Varys
 */
async function sendVarysWebhook(
  webhookUrl: string,
  payload: PRCheckRequestedPayload,
): Promise<void> {
  const { url, headers, isInternal } = await prepareAppWebhookDispatch(webhookUrl, {
    'Content-Type': 'application/json',
    'X-Xyne-Event': 'PR_CHECK_REQUESTED',
  });

  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    redirect: 'manual',
    // Fail fast if Varys stalls — this runs inside a user-facing request.
    signal: AbortSignal.timeout(10_000),
  };
  // Internal = trusted-config pod URL (plain client); external = user-supplied,
  // so validate + pin the connection (rebinding-safe).
  const response = isInternal
    ? await fetch(url, init)
    : await safeWebhookFetch(url, init);

  if (!response.ok) {
    throw new Error(`Webhook failed with status ${response.status}: ${await response.text()}`);
  }
}

/**
 * Runs a "Run PR Check" button click: sends PR_CHECK_REQUESTED to Varys.
 * Called by dispatchAction() with the authenticated clicker as callerUserId.
 */
export async function runPrCheckAction(params: {
  context: Record<string, unknown>;
  callerUserId?: string;
}): Promise<void> {
  const { context, callerUserId } = params;

  const ticketId = typeof context.ticketId === 'string' ? context.ticketId : '';
  const prId = typeof context.prId === 'string' ? context.prId : '';
  const projectKey = typeof context.projectKey === 'string' ? context.projectKey : '';
  const repositorySlug = typeof context.repositorySlug === 'string' ? context.repositorySlug : '';

  // ticketId is required: buttons are only posted for PRs with a linked
  // ticket, and bitbot's PR_CHECK_REQUESTED contract expects it — fail here
  // rather than sending bitbot a payload it may reject.
  if (!ticketId || !prId || !projectKey || !repositorySlug) {
    throw new Error('Missing required fields in context: ticketId, prId, projectKey, repositorySlug');
  }

  // Resolve conversation/channel: thread buttons carry them in context (the
  // thread where the PR link was posted); ticket buttons derive them from
  // the ticket the PR is linked to. The caller's access to the channel is
  // checked below.
  let conversationId = typeof context.conversationId === 'string' && context.conversationId ? context.conversationId : undefined;
  let channelId = typeof context.channelId === 'string' && context.channelId ? context.channelId : undefined;

  if (!conversationId || !channelId) {
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: {
        conversationId: true,
        channelId: true,
      },
    });

    if (!ticket || !ticket.conversationId) {
      throw new Error(`Ticket ${ticketId} not found or has no conversation`);
    }

    conversationId = ticket.conversationId;
    channelId = ticket.channelId;
  }

  // Object-level authorization: when an acting user is supplied, they must have
  // access to the ticket's channel. (Absent callerUserId falls back to the Varys
  // bot below.)
  //
  // Mirror the app's channel ACL, and always enforce the workspace boundary:
  //   - PRIVATE channel → the caller must be an explicit participant of THIS channel.
  //   - PUBLIC channel  → open to members of the channel's workspace (the "Run PR Check"
  //     button renders to every viewer via showToAll, so ordinary viewers legitimately
  //     have no participant row here) — but the caller must still belong to that workspace.
  if (typeof callerUserId === 'string' && callerUserId.trim() && channelId) {
    const chan = await db.channel.findUnique({
      where: { id: channelId },
      select: { visibility: true, workspaceId: true },
    });

    let authorized = false;
    if (chan && chan.visibility !== 'PRIVATE' && chan.workspaceId) {
      const workspaceMembership = await db.channelParticipant.findFirst({
        where: { userId: callerUserId, channel: { workspaceId: chan.workspaceId } },
        select: { channelId: true },
      });
      authorized = !!workspaceMembership;
    } else {
      // PRIVATE, or a channel with no resolvable workspace → require the specific
      // participant row (fail closed).
      const participant = await db.channelParticipant.findUnique({
        where: { channelId_userId: { channelId, userId: callerUserId } },
        select: { id: true },
      });
      authorized = !!participant;
    }

    if (!authorized) {
      logger.warn(
        `[PR-Check-Callback] Rejected: user ${callerUserId} is not authorized for ticket ${ticketId}'s channel (visibility=${chan?.visibility ?? 'unknown'})`,
      );
      throw new Error('Not authorized for this ticket');
    }
  }

  // Get channel info for channel name
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { name: true },
  });

  // Find Varys installed app
  const varysApp = await findVarysInstalledApp();
  if (!varysApp) {
    throw new Error('Varys app not configured');
  }

  // If the caller user id is absent, fall back to the Varys bot identity.
  const userId = typeof callerUserId === 'string' && callerUserId.trim() ? callerUserId : varysApp.userId;

  logger.info(
    `[PR-Check-Callback] Button clicked — sending webhook to Varys for PR #${prId} in ${repositorySlug} ` +
    `(ticket: ${ticketId}, conversation: ${conversationId})`
  );

  // Build webhook payload
  const webhookPayload: PRCheckRequestedPayload = {
    eventType: 'PR_CHECK_REQUESTED',
    payload: {
      conversationId,
      channelId,
      userId,
      channelName: channel?.name,
      createdAt: Date.now(),
      projectKey,
      repositorySlug,
      prId,
      ticketId,
      art: true,  // Enable ART trigger
      metadata: {
        triggeredBy: 'varys@bot.xyne.ai',
        source: 'xyne_button_click',
      },
    },
  };

  await sendVarysWebhook(varysApp.webhookUrl, webhookPayload);
  logger.info(`[PR-Check-Callback] Webhook sent successfully to Varys`);
}
