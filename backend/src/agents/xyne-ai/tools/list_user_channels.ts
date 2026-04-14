/**
 * List User Channels Tool
 *
 * Returns the list of DEFAULT-scope channels the current user is a member of,
 * grouped by visibility (public / private).  No input required — userId is
 * taken from the agent context.
 */

import { z } from 'zod';
import { type Tool } from '@juspay-jaf/jaf';
import { db } from '../../../database/client.js';
import { logger } from '../../../utils/logger.js';
import { getDescription } from './helpers.js';
import type { XyneAIAgentContext } from './types.js';

interface ChannelEntry {
  id: string;
  name: string;
}

interface UserChannelsResult {
  public: ChannelEntry[];
  private: ChannelEntry[];
}

async function getUserChannels(userId: string): Promise<UserChannelsResult> {
  // Mirror the home page `userVisibleChannels` Zero query:
  // channelUserStatus where isClosed=false, isDeleted=false, userId=userId
  // then join to channel where scopeType=DEFAULT
  const statuses = await db.channelUserStatus.findMany({
    where: { userId, isClosed: false, isDeleted: false },
    select: { channelId: true },
  });

  if (statuses.length === 0) {
    return { public: [], private: [] };
  }

  const channelIds = statuses.map(s => s.channelId);

  const channels = await db.channel.findMany({
    where: { id: { in: channelIds }, scopeType: 'DEFAULT' },
    select: { id: true, name: true, visibility: true },
    orderBy: { name: 'asc' },
  });

  const result: UserChannelsResult = { public: [], private: [] };
  for (const ch of channels) {
    const entry: ChannelEntry = { id: ch.id, name: ch.name };
    if (ch.visibility === 'PUBLIC') {
      result.public.push(entry);
    } else {
      result.private.push(entry);
    }
  }

  return result;
}

function formatResult(result: UserChannelsResult): string {
  const publicList =
    result.public.length > 0
      ? result.public.map(c => `  - ${c.name}`).join('\n')
      : '  (none)';

  const privateList =
    result.private.length > 0
      ? result.private.map(c => `  - ${c.name}`).join('\n')
      : '  (none)';

  const total = result.public.length + result.private.length;

  return [
    `User is a member of ${total} channel(s):`,
    '',
    `Public channels (${result.public.length}):`,
    publicList,
    '',
    `Private channels (${result.private.length}):`,
    privateList,
  ].join('\n');
}

export function createListUserChannelsTool(): Tool<Record<string, never>, XyneAIAgentContext> {
  return {
    schema: {
      name: 'list_user_channels',
      description: getDescription('list_user_channels'),
      parameters: z.object({}),
    },
    execute: async (_args, context) => {
      logger.info(`[ListUserChannels] Fetching channels for userId=${context.userId}`);
      try {
        const result = await getUserChannels(context.userId);
        const formatted = formatResult(result);
        logger.info(
          `[ListUserChannels] Found ${result.public.length} public, ${result.private.length} private channels`
        );
        return formatted;
      } catch (error) {
        logger.error('[ListUserChannels] Error fetching user channels:', error);
        return `Error fetching channels: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    },
  };
}
