import { Router, Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';

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
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Xyne-Event': 'PR_CHECK_REQUESTED',
    },
    body: JSON.stringify(payload),
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
router.post('/callback', async (req: Request, res: Response) => {
  try {
    const { context } = req.body;

    if (!context) {
      res.status(400).json({ error: 'Missing context in request body' });
      return;
    }

    const { ticketId, prId, projectKey, repositorySlug } = context;

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

    // Get channel info for channel name
    const channel = await db.channel.findUnique({
      where: { id: ticket.channelId },
      select: { name: true },
    });

    // Get current user from auth middleware
    const userId = req.body.userId || req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Find Varys installed app
    const varysApp = await findVarysInstalledApp();
    if (!varysApp) {
      res.status(500).json({ error: 'Varys app not configured' });
      return;
    }

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
        userId: userId,
        channelName: channel?.name,
        createdAt: Date.now(),
        projectKey,
        repositorySlug,
        prId: String(prId),
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
