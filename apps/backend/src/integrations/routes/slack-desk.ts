/**
 * Slack Desk routes — list available Slack channels and disconnect.
 *
 * Channel creation is handled by POST /api/channels with type: 'SLACK'.
 * These routes provide Slack-specific operations:
 * 1. GET  /channels              — list Slack channels the bot is a member of
 * 2. POST /:channelId/disconnect — deactivate one of the desk's Slack ExternalSources
 */

import express, { Request, Response } from 'express';
import { SlackDeskTriggerMode } from '@xyne/shared';
import { WORKSPACE_LEVEL } from '@/integrations/core/sourceScope';
import { authV2Middleware } from '@/middleware/authV2Middleware';
import { db } from '@/database/client';
import { WebClient } from '@slack/web-api';
import { logger } from '@/utils/logger';
import { slackDeskService } from '@/services/slackDeskService';
import { authorizeAppDeskManager } from '@/integrations/routes/app-desk';
import {
  DESK_SOURCE_PREFIXES,
  buildSlackDeskSourceName,
  extractSlackChannelId,
} from '@/integrations/core/deskSources';
import { decrypt, encrypt } from '@/services/encryptionService';
import { redisService } from '@/services/redisService';
import { validateZod } from '@/middleware/validation';
import { z } from 'zod';

const TAG = '[SlackDesk]';
const router = express.Router();
router.use(express.json());

/**
 * GET /api/integrations/slack-desk/channels
 * Lists Slack channels the bot is already a member of.
 */
router.get(
  '/channels',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      const slackSource = await db.externalSource.findFirst({
        where: { workspaceId, ...WORKSPACE_LEVEL, sourceType: 'slack', isActive: true },
      });
      if (!slackSource) {
        res.status(503).json({ error: 'Slack is not connected for this workspace. Please connect Slack first.' });
        return;
      }
      const slackCreds = JSON.parse(decrypt(slackSource.credentials));
      const botToken = slackCreds.botOauthToken;
      if (!botToken) {
        res.status(503).json({ error: 'Slack bot token not found in workspace credentials' });
        return;
      }

      // Fetch only channels (not DMs) the bot is a member of
      const params = new URLSearchParams({
        types: 'public_channel,private_channel',
        exclude_archived: 'true',
        limit: '200',
      });

      const response = await fetch(`https://slack.com/api/users.conversations?${params}`, {
        headers: { Authorization: `Bearer ${botToken}` },
      });

      const data = (await response.json()) as {
        ok: boolean;
        error?: string;
        channels?: Array<{
          id: string;
          name: string;
          is_private: boolean;
          num_members: number;
        }>;
      };

      if (!data.ok) {
        logger.error(`${TAG} Slack users.conversations failed`, { error: data.error });
        res.status(502).json({ error: `Slack API error: ${data.error}` });
        return;
      }

      const channels = (data.channels || []).map(ch => ({
        id: ch.id,
        name: ch.name,
        is_private: ch.is_private,
        num_members: ch.num_members,
      }));

      // Mark channels that already have an active slack-desk ExternalSource
      const existingSources = await db.externalSource.findMany({
        where: {
          name: { startsWith: DESK_SOURCE_PREFIXES.SLACK },
          isActive: true,
        },
        select: { name: true },
      });

      const claimedChannelIds = new Set(
        existingSources
          .map(s => extractSlackChannelId(s.name))
          .filter((id): id is string => id !== null)
      );

      const available = channels.map(ch => ({
        ...ch,
        alreadyConnected: claimedChannelIds.has(ch.id),
      }));

      res.json({ channels: available });
    } catch (error) {
      logger.error(`${TAG} Error listing Slack channels`, { error });
      res.status(500).json({ error: 'Failed to list Slack channels' });
    }
  }
);

/**
 * POST /api/integrations/slack-desk/:conversationId/reply
 * Sends a reply to a Slack thread from the Desk UI.
 *
 * Body: { body: string }
 */
router.post(
  '/:conversationId/reply',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { conversationId } = req.params;
      const { body, attachmentIds } = req.body as { body?: string; attachmentIds?: string[] };
      const userId = req.user!.id;

      const ids = Array.isArray(attachmentIds) ? attachmentIds : [];
      if ((!body || typeof body !== 'string' || body.trim().length === 0) && ids.length === 0) {
        res.status(400).json({ error: 'body or at least one attachment is required' });
        return;
      }

      const result = await slackDeskService.sendSlackReply({
        conversationId,
        body: (body ?? '').trim(),
        userId,
        attachmentIds: ids,
      });

      res.json(result);
    } catch (error) {
      logger.error(`${TAG} Error sending Slack reply`, { error });
      const message = error instanceof Error ? error.message : 'Failed to send Slack reply';
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /api/integrations/slack-desk/:channelId/disconnect
 * Deactivates the ExternalSource for a Slack desk channel.
 */
router.post(
  '/:channelId/disconnect',
  authV2Middleware.authenticate,
  validateZod(z.object({ slackChannelId: z.string().trim().min(1).optional() })),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const { slackChannelId } = req.body as { slackChannelId?: string };

      if (!(await authorizeAppDeskManager(channelId, req.user!.id, req.user!.workspaceId!, res)))
        return;

      // Deactivate ExternalSource. The name is unique, so with an id this matches at most one row;
      // clients from before per-channel disconnect send none, and could only ever show one channel —
      // honour them while the desk still has a single binding rather than dropping an arbitrary one.
      const matches = await db.externalSource.findMany({
        where: {
          channelId,
          isActive: true,
          sourceType: 'slack-desk',
          ...(slackChannelId && { name: buildSlackDeskSourceName(slackChannelId) }),
        },
        select: { id: true },
        take: 2,
      });
      const source = matches.length === 1 ? matches[0] : undefined;

      if (!source) {
        res.status(404).json({ error: 'No active integration found for this channel' });
        return;
      }

      await db.externalSource.update({
        where: { id: source.id },
        data: { isActive: false },
      });

      res.json({ message: 'Slack desk disconnected' });
    } catch (error) {
      logger.error(`${TAG} Error disconnecting Slack desk`, { error });
      res.status(500).json({ error: 'Failed to disconnect Slack desk' });
    }
  }
);

/**
 * GET /api/integrations/slack-desk/users
 * Returns Slack workspace members (cached in Redis for 12 hours).
 * Used by the SlackComposer for @mention support.
 */
const SLACK_USERS_CACHE_PREFIX = 'slack_workspace_users:';
const SLACK_USERS_CACHE_TTL = 43200; // 12 hours

interface SlackUserItem {
  id: string;
  name: string;
  displayName: string;
  avatar: string;
}

router.get(
  '/users',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user!.workspaceId!;
      const cacheKey = `${SLACK_USERS_CACHE_PREFIX}${workspaceId}`;

      // Check Redis cache first
      const cached = await redisService.get(cacheKey);
      if (cached) {
        res.json({ users: JSON.parse(cached) as SlackUserItem[] });
        return;
      }

      // Cache miss — fetch from Slack API
      const slackSource = await db.externalSource.findFirst({
        where: { workspaceId, ...WORKSPACE_LEVEL, sourceType: 'slack', isActive: true },
      });
      if (!slackSource) {
        res.status(503).json({ error: 'Slack is not connected for this workspace' });
        return;
      }

      const slackCreds = JSON.parse(decrypt(slackSource.credentials));
      const botToken = slackCreds.botOauthToken;
      if (!botToken) {
        res.status(503).json({ error: 'Slack bot token not found' });
        return;
      }

      const client = new WebClient(botToken);
      const users: SlackUserItem[] = [];
      let cursor: string | undefined;

      do {
        const result = await client.users.list({
          limit: 200,
          ...(cursor && { cursor }),
        });

        if (!result.ok) {
          logger.error(`${TAG} Slack users.list failed`, { error: result.error });
          res.status(502).json({ error: `Slack API error: ${result.error}` });
          return;
        }

        for (const member of result.members || []) {
          // Skip bots, deleted users, and Slackbot
          if (member.deleted || member.is_bot || member.id === 'USLACKBOT') continue;

          users.push({
            id: member.id!,
            name: member.profile?.real_name || member.name || '',
            displayName: member.profile?.display_name || member.profile?.real_name || member.name || '',
            avatar: member.profile?.image_72 || '',
          });
        }

        cursor = result.response_metadata?.next_cursor || undefined;
      } while (cursor);

      // Cache in Redis
      await redisService.set(cacheKey, JSON.stringify(users), SLACK_USERS_CACHE_TTL);

      res.json({ users });
    } catch (error) {
      logger.error(`${TAG} Error fetching Slack users`, { error });
      res.status(500).json({ error: 'Failed to fetch Slack users' });
    }
  }
);

router.get(
  '/channels/:channelId/slack',
  authV2Middleware.authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      if (!(await authorizeAppDeskManager(channelId, req.user!.id, req.user!.workspaceId!, res)))
        return;

      const [sources, pref] = await Promise.all([
        db.externalSource.findMany({
          where: { channelId, sourceType: 'slack-desk', isActive: true },
          select: { id: true, name: true },
        }),
        db.emailChannelPreference.findUnique({
          where: { channelId },
          select: { slackDeskTriggerMode: true },
        }),
      ]);
      res.json({
        slackChannels: sources.map(s => ({
          sourceId: s.id,
          slackChannelId: extractSlackChannelId(s.name),
        })),
        triggerMode:
          pref?.slackDeskTriggerMode === SlackDeskTriggerMode.MENTION_ONLY
            ? SlackDeskTriggerMode.MENTION_ONLY
            : SlackDeskTriggerMode.ALL_MESSAGES,
      });
    } catch (error) {
      logger.error(`${TAG} Error listing desk Slack bindings`, { error });
      res.status(500).json({ error: 'Failed to list Slack channels for this desk' });
    }
  }
);

router.patch(
  '/channels/:channelId/slack/trigger-mode',
  authV2Middleware.authenticate,
  validateZod(z.object({ triggerMode: z.nativeEnum(SlackDeskTriggerMode) })),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const { triggerMode } = req.body as { triggerMode: SlackDeskTriggerMode };

      if (!(await authorizeAppDeskManager(channelId, req.user!.id, req.user!.workspaceId!, res)))
        return;

      await db.emailChannelPreference.update({
        where: { channelId },
        data: { slackDeskTriggerMode: triggerMode },
      });

      res.json({ triggerMode });
    } catch (error) {
      logger.error(`${TAG} Error updating Slack desk trigger mode`, { error });
      res.status(500).json({ error: 'Failed to update trigger mode' });
    }
  }
);

router.post(
  '/channels/:channelId/slack',
  authV2Middleware.authenticate,
  validateZod(z.object({ slackChannelId: z.string().trim().min(1) })),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelId } = req.params;
      const { slackChannelId } = req.body as { slackChannelId: string };
      const workspaceId = req.user!.workspaceId!;

      const desk = await authorizeAppDeskManager(channelId, req.user!.id, workspaceId, res);
      if (!desk) return;

      const workspaceSource = await db.externalSource.findFirst({
        where: { workspaceId, ...WORKSPACE_LEVEL, sourceType: 'slack', isActive: true },
      });
      if (!workspaceSource) {
        res.status(503).json({ error: 'Slack is not connected for this workspace. Please connect Slack first.' });
        return;
      }
      const creds = JSON.parse(decrypt(workspaceSource.credentials)) as {
        signingSecret?: string;
        botOauthToken?: string;
      };
      const credentials = encrypt(JSON.stringify({
        signingSecret: creds.signingSecret,
        botOauthToken: creds.botOauthToken,
      }));

      // A desk can hold many Slack channels, but each Slack channel feeds one desk (ingest resolves by name).
      const name = buildSlackDeskSourceName(slackChannelId);
      const clash = await db.externalSource.findFirst({
        where: {
          workspaceId,
          sourceType: 'slack-desk',
          isActive: true,
          name,
          NOT: { channelId },
        },
        select: { name: true },
      });
      if (clash) {
        res.status(409).json({ error: 'This Slack channel is already connected to another desk' });
        return;
      }

      const source = await db.externalSource.upsert({
        where: { name },
        update: { isActive: true, credentials, channelId, displayName: desk.name },
        create: {
          name,
          sourceType: 'slack-desk',
          displayName: desk.name,
          channelId,
          credentials,
          isActive: true,
          workspaceId,
        },
      });

      res.status(201).json({ slackChannel: { sourceId: source.id, slackChannelId } });
    } catch (error) {
      logger.error(`${TAG} Error connecting Slack channel to desk`, { error });
      res.status(500).json({ error: 'Failed to connect Slack channel' });
    }
  }
);

export default router;
