import { Router, Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { validateS2SKey } from '@/middleware/validateS2SKey';
import { assertWebhookUrlSafe } from '@/utils/ssrfGuard';

const router = Router();

// Varys bot email - source of truth for finding the installed app
const VARYS_BOT_EMAIL = 'varys@app.xyne.ai';

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
    // Find the Varys bot user by email (source of truth)
    const botUser = await db.user.findFirst({
      where: { email: VARYS_BOT_EMAIL },
    });

    if (!botUser) {
      logger.error(`[PR-Check-Callback] Varys bot user not found with email: ${VARYS_BOT_EMAIL}`);
      return null;
    }

    // Find installed app entry by userId
    const installedApp = await db.installedApps.findFirst({
      where: { userId: botUser.id },
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
  payload: PRCheckRequestedPayload
): Promise<void> {
  // Reject webhook URLs whose host resolves to an internal/private address.
  await assertWebhookUrlSafe(webhookUrl);

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Xyne-Event': 'PR_CHECK_REQUESTED',
    },
    body: JSON.stringify(payload),
    redirect: 'manual',
  });

  if (!response.ok) {
    throw new Error(`Webhook failed with status ${response.status}: ${await response.text()}`);
  }
}

/**
 * PR Check callback endpoint.
 * Called by dispatchAction() when user clicks "Run PR Check" button.
 * Sends a webhook to Varys configured webhook URL.
 *
 * Route: POST /api/apps/pr-check/callback
 */
router.post('/callback', validateS2SKey, async (req: Request, res: Response) => {
  try {
    const { context, callerUserId } = req.body as {
      context?: Record<string, unknown>;
      callerUserId?: string;
    };

    if (!context) {
      res.status(400).json({ error: 'Missing context in request body' });
      return;
    }

    const ticketId = typeof context.ticketId === 'string' ? context.ticketId : '';
    const prId = typeof context.prId === 'string' ? context.prId : '';
    const projectKey = typeof context.projectKey === 'string' ? context.projectKey : '';
    const repositorySlug = typeof context.repositorySlug === 'string' ? context.repositorySlug : '';

    if (!ticketId || !prId || !projectKey || !repositorySlug) {
      res.status(400).json({
        error: 'Missing required fields in context',
        required: ['ticketId', 'prId', 'projectKey', 'repositorySlug'],
      });
      return;
    }

    // Look up the ticket to get conversation and channel info
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: {
        conversationId: true,
        channelId: true,
      },
    });

    if (!ticket || !ticket.conversationId) {
      res.status(404).json({ error: `Ticket ${ticketId} not found or has no conversation` });
      return;
    }

    // Object-level authorization: when an acting user is supplied (the ordinary-user
    // dispatch path), they must have access to the ticket's channel. Without this an
    // authenticated user could drive this S2S callback against a ticket in a channel
    // they have no access to. (Absent callerUserId = the app's own S2S call, which
    // falls back to the Varys bot identity below.)
    //
    // Mirror the app's channel ACL, but always enforce the workspace/tenant boundary:
    //   - PRIVATE channel → the caller must be an explicit participant of THIS channel.
    //   - PUBLIC channel  → accessible to all members of the channel's workspace (the
    //     "Run PR Check" button renders to every viewer via showToAll, so ordinary
    //     viewers legitimately have NO participant row on this specific channel) — but the
    //     caller must still belong to the channel's workspace.
    // Workspace membership is proxied by "participates in >=1 channel of that workspace"
    // (there is no standalone workspace-member table — org membership is email-keyed).
    if (typeof callerUserId === 'string' && callerUserId.trim() && ticket.channelId) {
      const chan = await db.channel.findUnique({
        where: { id: ticket.channelId },
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
          where: { channelId_userId: { channelId: ticket.channelId, userId: callerUserId } },
          select: { id: true },
        });
        authorized = !!participant;
      }

      if (!authorized) {
        logger.warn(
          `[PR-Check-Callback] Rejected: user ${callerUserId} is not authorized for ticket ${ticketId}'s channel (visibility=${chan?.visibility ?? 'unknown'})`,
        );
        res.status(403).json({ error: 'Not authorized for this ticket' });
        return;
      }
    }

    // Get channel info for channel name
    const channel = await db.channel.findUnique({
      where: { id: ticket.channelId },
      select: { name: true },
    });

    // Find Varys installed app
    const varysApp = await findVarysInstalledApp();
    if (!varysApp) {
      res.status(500).json({ error: 'Varys app not configured' });
      return;
    }

    // The dispatcher authenticates the caller and forwards the caller user id.
    // If that field is absent, fall back to the Varys bot identity.
    const userId = typeof callerUserId === 'string' && callerUserId.trim() ? callerUserId : varysApp.userId;

    logger.info(
      `[PR-Check-Callback] Button clicked — sending webhook to Varys for PR #${prId} in ${repositorySlug} ` +
      `(ticket: ${ticketId}, conversation: ${ticket.conversationId})`
    );

    // Build webhook payload
    const webhookPayload: PRCheckRequestedPayload = {
      eventType: 'PR_CHECK_REQUESTED',
      payload: {
        conversationId: ticket.conversationId,
        channelId: ticket.channelId,
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

    // Send webhook to Varys
    try {
      await sendVarysWebhook(varysApp.webhookUrl, webhookPayload);
      logger.info(`[PR-Check-Callback] Webhook sent successfully to Varys`);
      res.status(200).json({ success: true, message: 'PR check webhook sent to Varys' });
    } catch (webhookError) {
      logger.error('[PR-Check-Callback] Failed to send webhook to Varys:', webhookError);
      res.status(500).json({ error: 'Failed to send webhook to Varys' });
    }
  } catch (error) {
    logger.error('[PR-Check-Callback] Error processing callback:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

export default router;
