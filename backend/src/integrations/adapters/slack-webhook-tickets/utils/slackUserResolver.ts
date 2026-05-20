import { UserRepository } from '../../../../database/repositories/users';
import { UserGroupRepository } from '../../../../database/repositories/userGroups';
import { ChannelRepository } from '../../../../database/repositories/channelRepository';
import { DatabaseClient } from '../../../../database/client';
import { config } from '../../../../config/env';

import { logger } from '../../../../utils/logger';
import { WebClient } from '@slack/web-api';

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

function buildMentionAttrs(
  id: string,
  name: string,
  isGroup: boolean = false,
  quote: string = '"',
  alias?: string,
  description?: string,
  email?: string,
  picture?: string
): string[] {
  const attrs = [
    `data-mention`,
    `data-mention-type=${quote}${isGroup ? 'group' : 'user'}${quote}`,
    `data-${isGroup ? 'group' : 'user'}-id=${quote}${escapeHtml(id)}${quote}`,
    `data-${isGroup ? 'group-' : 'user'}name=${quote}${escapeHtml(name)}${quote}`,
  ];
  if (email) attrs.push(`data-email=${quote}${escapeHtml(email)}${quote}`);
  if (picture) attrs.push(`data-picture=${quote}${escapeHtml(picture)}${quote}`);
  if (description) attrs.push(`data-description=${quote}${escapeHtml(description)}${quote}`);
  if (alias) attrs.push(`data-group-alias=${quote}${escapeHtml(alias)}${quote}`);
  return attrs;
}

export interface SlackUserInfo {
  id: string;
  is_bot?: boolean;
  deleted?: boolean; 
  profile: {
    email?: string;
    real_name?: string;
    display_name?: string;
    bot_id?: string;
  };
}

export interface SlackGroupInfo {
  id: string;
  name: string;
  description: string;
  handle: string;
  users: string[];
}

// Slack-native IDs are uppercase (e.g. U099FJD9QC8); xyne DB CUIDs are lowercase (e.g. cmp4d91bd005uvldnmch36fll)
function isSlackNativeId(id: string): boolean {
  return /^[A-Z][A-Z0-9]+$/.test(id);
}

export function extractAllSlackIds(text: string, isUser: boolean): string[] {
  const regex = isUser ? /<@([^>|]+)(?:\|[^>]*)?>/g : /<!subteam\^([^>|]+)(?:\|[^>]*)?>/g;
  const matches = text.matchAll(new RegExp(regex, 'g'));
  const ids = Array.from(matches, (match) => match[1]);
  return [...new Set(ids)];
}

export function extractAllSlackChannelIds(text: string): string[] {
  const matches = text.matchAll(/<#([^>|]+)(?:\|[^>]*)?>/g);
  const ids = Array.from(matches, (match) => match[1]);
  return [...new Set(ids)];
}

export async function fetchSlackUserInfo(
  slackUserId: string,
  botOauthToken: string
): Promise<SlackUserInfo | null> {
  try {
    logger.info('[fetchSlackUserInfo] Creating WebClient', { slackUserId });
    const client = new WebClient(botOauthToken);

    logger.info('[fetchSlackUserInfo] Calling client.users.info', { slackUserId });
    const result = await client.users.info({
      user: slackUserId,
    });

    logger.info('[fetchSlackUserInfo] Got result from Slack', { slackUserId, resultOk: result.ok, hasUser: !!result.user, error: result.error });

    if (!result.ok || !result.user) {
      logger.warn('[fetchSlackUserInfo] Failed to fetch Slack user info - invalid result', { slackUserId, error: result.error, resultOk: result.ok, hasUser: !!result.user });
      return null;
    }

    logger.info('[fetchSlackUserInfo] Success', { slackUserId, userId: result.user.id, isBot: result.user.is_bot });
    return result.user as SlackUserInfo;
  } catch (error) {
    const errorDetails = error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name,
    } : { error };

    logger.error('Error fetching Slack user info', {
      slackUserId,
      ...errorDetails,
    });
    return null;
  }
}

async function fetchSlackGroupInfo(slackGroupId: string, botOauthToken: string): Promise<SlackGroupInfo | null> {
  try {
    const client = new WebClient(botOauthToken);
    const result = await client.usergroups.list({
      include_users: true,
    });
    if (!result.ok || !result.usergroups) {
      logger.warn('Failed to fetch Slack user groups list', { slackGroupId, error: result.error });
      return null;
    }
    const userGroup = result.usergroups.find((userGroup) => userGroup.id === slackGroupId);
    if (!userGroup) {
      logger.warn('User group not found', { slackGroupId });
      return null;
    }
    return userGroup as SlackGroupInfo;
  } catch (error) {
    logger.error('Error fetching Slack group info', { slackGroupId, error });
    return null;
  }
}

async function resolveApiUser(
  slackUserId: string,
  botOauthToken: string
, workspaceId: string): Promise<{ dbUserId?: string; displayName?: string }> {
  if (!slackUserId || !botOauthToken) {
    return {};
  }
  const slackUser = await fetchSlackUserInfo(slackUserId, botOauthToken);
  const displayName =
    slackUser?.profile?.real_name ||
    slackUser?.profile?.display_name ||
    undefined;

  if (!slackUser?.profile?.email) {
    return { displayName };
  }
  const userRepo = new UserRepository();
  const user = await userRepo.findByEmail(slackUser.profile.email, workspaceId);
  return { dbUserId: user?.id, displayName };
}

async function resolveApiGroup(slackGroupId: string, botOauthToken: string, workspaceId?: string): Promise<string | undefined> {
  if (!slackGroupId || !botOauthToken) {
    return undefined;
  }
  const groupRepo = new UserGroupRepository();
  const slackGroup = await fetchSlackGroupInfo(slackGroupId, botOauthToken);
  if (!slackGroup) {
    return undefined;
  }
  const group = await groupRepo.upsertGroupsWithMetadata({
    name: slackGroup.name,
    description: slackGroup.description,
    alias: slackGroup.handle,
    metadata: {
      slackGroupId: slackGroup.id,
    },
    workspace: { connect: { id: workspaceId ?? config.defaultWorkspaceId } },
  });
  const userRepo = new UserRepository();
  const userResults = await Promise.allSettled(
    slackGroup.users.map((slackUserId) => userRepo.findByMetadataField('slackId', slackUserId))
  );
  const dbUserIds: string[] = [];
  userResults.forEach((result) => {
    if (result.status === 'fulfilled' && result.value) {
      dbUserIds.push(result.value.id);
    }
  });
  if (dbUserIds.length > 0) {
    const db = DatabaseClient.getInstance();
    await db.userGroupMapping.createMany({
      data: dbUserIds.map((userId) => ({
        userGroupId: group.id,
        userId,
      })),
      skipDuplicates: true, 
    });
  }

  return group.id;
}


type ResolvedEntry = { dbId?: string; displayName?: string };

export async function resolveSlackIds(
  slackUserId: string[],
  botOauthToken: string,
  type: 'user' | 'group'
, workspaceId?: string): Promise<Map<string, ResolvedEntry> | undefined> {
  if (slackUserId.length === 0 || (type !== 'user' && type !== 'group')) {
    return undefined;
  }
  const userRepo = new UserRepository();
  const groupRepo = new UserGroupRepository();
  const userMapper = new Map<string, ResolvedEntry>();

  const dbResults = await Promise.allSettled(
    slackUserId.map((slackId) =>
      type === 'user'
        ? isSlackNativeId(slackId)
          ? userRepo.findByMetadataField('slackId', slackId)
          : userRepo.findById(slackId)
        : groupRepo.findByMetadataField('slackGroupId', slackId)
    )
  );

  const slackIdsToFetch: string[] = [];

  slackUserId.forEach((slackId, i) => {
    const result = dbResults[i];
    if (result.status === 'fulfilled' && result.value) {
      userMapper.set(slackId, { dbId: result.value.id });
    } else if (type !== 'user' || isSlackNativeId(slackId)) {
      slackIdsToFetch.push(slackId);
    } else {
      userMapper.set(slackId, {});
    }
  });

  if (slackIdsToFetch.length > 0) {
    const apiResults = await Promise.allSettled(
      slackIdsToFetch.map((slackId) =>
        type === 'user'
          ? resolveApiUser(slackId, botOauthToken, workspaceId ?? '')
          : resolveApiGroup(slackId, botOauthToken, workspaceId).then((id) => ({ dbUserId: id, displayName: undefined }))
      )
    );

    slackIdsToFetch.forEach((slackId, i) => {
      const result = apiResults[i];
      if (result.status === 'fulfilled') {
        userMapper.set(slackId, { dbId: result.value.dbUserId, displayName: result.value.displayName });
      } else {
        userMapper.set(slackId, {});
      }
    });
  }

  return userMapper;
}


function resolveSpecialMentions(text: string, isStringified: boolean = false): string {
  const broadcastRegex = /<!channel>|<!here>|<!everyone>|@channel|@here|@everyone/g;
  const quote = isStringified ? "'" : '"';
  text = text.replace(broadcastRegex, (match: string) => {
    const display = match.startsWith('<!') ? `@${match.slice(2, -1)}` : match;
    const mentionType = display.slice(1);
    return `<span class=${quote}chat-input-special-mention${quote} data-mention-type=${quote}${mentionType}${quote}>${display}</span>`;
  });

  return text;
}

function buildChannelMentionSpan(
  channel: { id: string; name: string; visibility?: string | null; scopeType?: string | null },
  quote: string,
): string {
  const isPrivate = channel.visibility === 'PRIVATE' || channel.scopeType === 'DM' || channel.scopeType === 'GROUP_DM';
  const channelName = channel.name || channel.id;
  return `<span data-channel-mention=${quote}${quote} data-channel-id=${quote}${escapeHtml(channel.id)}${quote} data-channel-name=${quote}${escapeHtml(channelName)}${quote} data-is-private=${quote}${String(isPrivate)}${quote} class=${quote}chat-input-channel-mention${quote}>#${escapeHtml(channelName)}</span>`;
}

function replaceSlackUserMention(currentText: string, slackId: string, newValue: string): string {
  return currentText.replace(new RegExp(`<@${escapeRegExp(slackId)}(?:\\|[^>]*)?>`, 'g'), newValue);
}

function replaceSlackGroupMention(currentText: string, slackId: string, newValue: string): string {
  return currentText.replace(new RegExp(`<!subteam\\^${escapeRegExp(slackId)}(?:\\|[^>]*)?>`, 'g'), newValue);
}

function replaceSlackChannelMention(currentText: string, channelId: string, newValue: string): string {
  return currentText.replace(new RegExp(`<#${escapeRegExp(channelId)}(?:\\|[^>]*)?>`, 'g'), newValue);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function resolveSlackMentions(
  text: string,
  botOauthToken: string = '',
  isStringified: boolean = false,
  workspaceId?: string,
): Promise<string> {
  const userIds = extractAllSlackIds(text, true);
  const groupIds = extractAllSlackIds(text, false);
  const channelIds = extractAllSlackChannelIds(text);
  if (userIds.length === 0 && groupIds.length === 0 && channelIds.length === 0) {
    return resolveSpecialMentions(text, isStringified);
  }

  // Use provided workspaceId or fall back to default
  const resolvedWorkspaceId = workspaceId ?? config.defaultWorkspaceId;

  const userMapper = await resolveSlackIds(userIds, botOauthToken, 'user', resolvedWorkspaceId);
  const groupMapper = await resolveSlackIds(groupIds, botOauthToken, 'group', resolvedWorkspaceId);
  const quote = isStringified ? "'" : '"'
  const userRepo = new UserRepository();
  const groupRepo = new UserGroupRepository();
  const channelRepo = new ChannelRepository();

  if (userMapper) {
    for (const [slackId, { dbId, displayName }] of userMapper.entries()) {
      if (dbId) {
        const user = await userRepo.findById(dbId);
        if (user) {
          text = replaceSlackUserMention(text, slackId, `<span ${buildMentionAttrs(user.id, user.name, false, quote, undefined, undefined, user.email, user.picture || undefined).join(' ')}>@${escapeHtml(user.name)}</span>`);
      } else {
        const name = displayName ?? 'unknown user';
        text = replaceSlackUserMention(text, slackId, `<span>@${escapeHtml(name)}</span>`);
      }
      } else {
        const name = displayName ?? 'unknown user';
        text = replaceSlackUserMention(text, slackId, `<span>@${escapeHtml(name)}</span>`);
      }
    }
  }
  if (groupMapper) {
    for (const [slackId, { dbId, displayName }] of groupMapper.entries()) {
      if (dbId) {
        const group = await groupRepo.findById(dbId);
        if (group) {
          text = replaceSlackGroupMention(text, slackId, `<span ${buildMentionAttrs(group.id, group.name, true, quote, group.alias || undefined, group.description || undefined).join(' ')}>@${escapeHtml(group.alias || group.name)}</span>`);
        } else {
          const name = displayName ?? 'unknown group';
          text = replaceSlackGroupMention(text, slackId, `<span>@${escapeHtml(name)}</span>`);
        }
      } else {
        const name = displayName ?? 'unknown group';
        text = replaceSlackGroupMention(text, slackId, `<span>@${escapeHtml(name)}</span>`);
      }
    }
  }
  for (const channelId of channelIds) {
    const channel = await channelRepo.findById(channelId);
    if (channel) {
      text = replaceSlackChannelMention(text, channelId, buildChannelMentionSpan(channel, quote));
    } else {
      text = replaceSlackChannelMention(text, channelId, `<span>#${escapeHtml(channelId)}</span>`);
    }
  }
  return resolveSpecialMentions(text, isStringified);
}
