/**
 * Slack Migration Command Handler
 * Handles multiple slash commands: /sync, and others
 */

import { Router, Request, Response } from 'express';
import { WebClient } from '@slack/web-api';
import { logger } from '../../utils/logger';
import { getSyncModal, getSyncJiraffeModal } from './utils/blockKit';
import { verifySlackRequest } from './middleware/verifySlackRequest';
import { handleSyncParticipantsCommand } from './syncParticipants';
import { config } from '../../config/env';
import { getBotConfigByTeamId } from './slackMigrationBotConfig';
import { UserRepository } from '../../database/repositories/users';
import { UserGroupRepository } from '../../database/repositories/userGroups';
import { UserGroupMappingRepository } from '../../database/repositories/userGroupMappingRepository';
import { handleSyncPinnedMessagesCommand } from './syncPinnedMessagesService';
import { handleSyncDmCommand } from './syncDmService';

const router = Router();

/**
 * Check if user is authorized to run migration commands
 */
export async function checkUserAuthorization(
  user_id: string,
  teamId?: string
): Promise<{ authorized: boolean; message?: string }> {
  const botConfig = teamId ? getBotConfigByTeamId(teamId) : null;
  const approvedUsers = botConfig?.migrationApprovals ?? config.slackMigrationApprovals;

  if (approvedUsers.length > 0) {
    if (!user_id) {
      return {
        authorized: false,
        message: '❌ User ID is required for authorization.',
      };
    }

    if (!approvedUsers.includes(user_id)) {
      let messageText = ':sadblob: You are not authorized to perform this action.\n\n';
      messageText += 'Approved users:\n';
      messageText += approvedUsers.map((userId: string) => `<@${userId}>`).join(',');
      messageText += '\n\nPlease contact them to run this migration.';

      const userRepo = new UserRepository();
      const userGroupRepo = new UserGroupRepository();
      const userGroupMappingRepo = new UserGroupMappingRepository();
      const userGroupId = 'cml9ekof80268qqgsz9de3m6d'; // User Group ID for Slack Migration Admins

      const user = await userRepo.findByMetadataField('slackId', user_id);
      const userGroup = await userGroupRepo.findById(userGroupId);

      if (!user || !userGroup) {
        return {
          authorized: false,
          message: messageText,
        };
      }

      const userGroupMapping = await userGroupMappingRepo.exists(userGroupId, user.id);

      if (!userGroupMapping) {
        return {
          authorized: false,
          message: messageText,
        };
      }
    }
  }

  return { authorized: true };
}

/**
 * Handle /sync command - opens sync modal
 */
async function handleSyncCommand(req: Request, res: Response): Promise<Response> {
  try {
    const { trigger_id, channel_id, user_id, team_id } = req.body as {
      trigger_id: string;
      channel_id: string;
      user_id: string;
      team_id: string;
    };

    const token = getBotConfigByTeamId(team_id).slackBotToken;
    if (!token) {
      logger.error('[Migration] slackBotToken is not set for team', { team_id });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: 'Slack integration is not configured.',
      });
    }

    // Check authorization
    const authResult = await checkUserAuthorization(user_id, team_id);
    if (!authResult.authorized) {
      logger.warn('[Migration] Unauthorized user attempted /sync command', { user_id, team_id });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: authResult.message || 'You are not authorized to perform this action.',
      });
    }

    const client = new WebClient(token);
    const modalView = getSyncModal(channel_id);

    await client.views.open({
      trigger_id,
      view: modalView as any,
    });

    return res.status(200).send();
  } catch (error) {
    logger.error('[Migration] Error handling /sync command', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(200).json({
      response_type: 'ephemeral',
      text: 'Failed to open modal. Please try again.',
    });
  }
}

/**
 * Handle /sync-jiraffe command - opens sync jiraffe modal
 */
async function handleSyncJiraffeCommand(req: Request, res: Response): Promise<Response> {
  try {
    const { trigger_id, channel_id, user_id, team_id } = req.body as {
      trigger_id: string;
      channel_id: string;
      user_id: string;
      team_id: string;
    };

    const token = getBotConfigByTeamId(team_id).slackBotToken;
    if (!token) {
      logger.error('[Migration] slackBotToken is not set for team', { team_id });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: 'Slack integration is not configured.',
      });
    }

    // Check authorization
    const authResult = await checkUserAuthorization(user_id, team_id);
    if (!authResult.authorized) {
      logger.warn('[Migration] Unauthorized user attempted /sync-jiraffe command', { user_id, team_id });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: authResult.message || 'You are not authorized to perform this action.',
      });
    }

    const client = new WebClient(token);
    const modalView = getSyncJiraffeModal(channel_id);

    await client.views.open({
      trigger_id,
      view: modalView as any,
    });

    return res.status(200).send();
  } catch (error) {
    logger.error('[Migration] Error handling /sync-jiraffe command', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(200).json({
      response_type: 'ephemeral',
      text: 'Failed to open modal. Please try again.',
    });
  }
}


/**
 * Main command router - routes to appropriate handler based on command name
 */
router.post('/command', verifySlackRequest, async (req: Request, res: Response) => {
  try {
    const { command } = req.body;

    if (!command) {
      logger.warn('[Migration] No command specified in request');
      return res.status(200).json({
        response_type: 'ephemeral',
        text: '❌ No command specified.',
      });
    }

    // Route to appropriate handler based on command
    switch (command) {
      case '/sync':
        return await handleSyncCommand(req, res);
      
      case '/sync-jiraffe':
        return await handleSyncJiraffeCommand(req, res);

      case '/sync-participants':
        return await handleSyncParticipantsCommand(req, res);
      
      case '/sync-pinned-messages':
        return await handleSyncPinnedMessagesCommand(req, res);

      case '/sync-dm':
        return await handleSyncDmCommand(req, res);

      default:
        logger.warn('[Migration] Unknown command received', { command });
        return res.status(200).json({
          response_type: 'ephemeral',
          text: `❌ Unknown command: ${command}\n\nAvailable commands: /sync, /sync-jiraffe, /sync-pinned-messages, /sync-participants, /sync-dm`,
        });
    }
  } catch (error) {
    logger.error('[Migration] Error routing command', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(200).json({
      response_type: 'ephemeral',
      text: 'Failed to process command. Please try again.',
    });
  }
});

export default router;
