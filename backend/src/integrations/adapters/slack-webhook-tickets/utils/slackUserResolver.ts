import { UserRepository } from '../../../../database/repositories/users';
import { UserGroupRepository } from '../../../../database/repositories/userGroups';
import { DatabaseClient } from '../../../../database/client';

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
  deleted?: boolean; 
  profile: {
    email?: string;
    real_name?: string;
    display_name?: string;
  };
}

export interface SlackGroupInfo {
  id: string;
  name: string;
  description: string;
  handle: string;
  users: string[];
}

function extractAllSlackIds(text: string, isUser: boolean): string[] {
  const regex = isUser ? /<@([A-Z0-9]+)>/g : /<!subteam\^([A-Z0-9]+)>/g;
  const matches = text.matchAll(new RegExp(regex, 'g'));
  const ids = Array.from(matches, (match) => match[1]);
  return [...new Set(ids)];
}

export async function fetchSlackUserInfo(
  slackUserId: string,
  botOauthToken: string
): Promise<SlackUserInfo | null> {
  try {
    const client = new WebClient(botOauthToken);

    const result = await client.users.info({
      user: slackUserId,
    });

    if (!result.ok || !result.user) {
      logger.warn('Failed to fetch Slack user info', { slackUserId, error: result.error });
      return null;
    }

    return result.user as SlackUserInfo;
  } catch (error) {
    logger.error('Error fetching Slack user info', { slackUserId, error });
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

async function resolveApiUser(slackUserId: string, botOauthToken: string): Promise<string | undefined> {
  if (!slackUserId || !botOauthToken) {
    return undefined;
  }
  const userRepo = new UserRepository();
  const slackUser = await fetchSlackUserInfo(slackUserId, botOauthToken);
  if (!slackUser || !slackUser.profile?.email) {
    return undefined;
  }
  const user = await userRepo.findByEmail(slackUser.profile.email);
  if (!user) {
    return undefined;
  }
  return user.id;
}

async function resolveApiGroup(slackGroupId: string, botOauthToken: string): Promise<string | undefined> {
  if (!slackGroupId || !botOauthToken) {
    return undefined;
  }
  const groupRepo = new UserGroupRepository();
  const slackGroup = await fetchSlackGroupInfo(slackGroupId, botOauthToken);
  if (!slackGroup) {
    return undefined;
  }
  const group = await groupRepo.create({
    name: slackGroup.name,
    description: slackGroup.description,
    alias: slackGroup.handle,
    metadata: {
      slackGroupId: slackGroup.id,
    },
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


async function resolveSlackIds(slackUserId: Array<string>, botOauthToken: string, type: 'user' | 'group'): Promise<Map<string, string | null> | undefined> {
  if (slackUserId.length === 0 || (type !== 'user' && type !== 'group')) {
    return undefined;
  }
  const userRepo = new UserRepository();
  const groupRepo = new UserGroupRepository();
  const userMapper = new Map<string, string | null>();
  
  const dbResults = await Promise.allSettled(
    slackUserId.map((slackId) => type === 'user' ? userRepo.findByMetadataField('slackId', slackId) : groupRepo.findByMetadataField('slackGroupId', slackId))
  );
  
  const slackIdsToFetch: string[] = [];
  
  slackUserId.forEach((slackId, i) => {
    const result = dbResults[i];
    if (result.status === 'fulfilled' && result.value) {
      userMapper.set(slackId, result.value.id);
    } else {
      slackIdsToFetch.push(slackId);
    }
  });

  if (slackIdsToFetch.length > 0) {
    const apiResults = await Promise.allSettled(
      slackIdsToFetch.map((slackId) => type === 'user' ? resolveApiUser(slackId, botOauthToken) : resolveApiGroup(slackId, botOauthToken))
    );
    
    slackIdsToFetch.forEach((slackId, i) => {
      const result = apiResults[i];
      if (result.status === 'fulfilled' && result.value) {
        userMapper.set(slackId, result.value);
      } else {
        userMapper.set(slackId, null);
      }
    });
  }

  return userMapper;
}


function resolveSpecialMentions(text: string): string {
  const regex = /<!channel>|<!here>|@channel|@here/g;
  return text.replace(regex, (match: string) => {
    return `<span class="chat-input-special-mention" data-mention-type="${match.toLowerCase()}">${match}</span>`;
  });
}

export async function resolveSlackMentions(
  text: string,
  botOauthToken: string,
  isStringified: boolean = false
): Promise<string> {
  const userIds = extractAllSlackIds(text, true);
  const groupIds = extractAllSlackIds(text, false);
  if (userIds.length === 0 && groupIds.length === 0) {
    return resolveSpecialMentions(text);
  }

  const userMapper = await resolveSlackIds(userIds, botOauthToken, 'user');
  const groupMapper = await resolveSlackIds(groupIds, botOauthToken, 'group');
  const quote = isStringified ? "'" : '"'
  const userRepo = new UserRepository();
  const groupRepo = new UserGroupRepository();

  function replaceMention(currentText: string, isUser: boolean, slackId: string, newValue: string): string {
    const regex = isUser ? new RegExp(`<@${slackId}>`, 'g') : new RegExp(`<!subteam\\^${slackId}>`, 'g');
    return currentText.replace(regex, newValue);
  }

  if (userMapper) {
    for (const [slackId, userId] of userMapper.entries()) {
      if (userId) {
        const user = await userRepo.findById(userId);
        if (user) {
          text = replaceMention(text, true, slackId, `<span ${buildMentionAttrs(user.id, user.name, false, quote, undefined, undefined, user.email, user.picture || undefined).join(' ')}>@${user.name}</span>`);
        } else {
          text = replaceMention(text, true, slackId, `<span>@unknown user</span>`);
        }
      } else {
        text = replaceMention(text, true, slackId, `<span>@unknown user</span>`);
      }
    }
  }
  if (groupMapper) {
    for (const [slackId, groupId] of groupMapper.entries()) {
      if (groupId) {
        const group = await groupRepo.findById(groupId);
        if (group) {
          text = replaceMention(text, false, slackId, `<span ${buildMentionAttrs(group.id, group.name, true, quote, group.alias || undefined, group.description || undefined).join(' ')}>@${group.alias}</span>`);
        } else {
          text = replaceMention(text, false, slackId, `<span>@unknown group</span>`);
        }
      } else {
        text = replaceMention(text, false, slackId, `<span>@unknown group</span>`);
      }
    }
  }
  return resolveSpecialMentions(text);
}