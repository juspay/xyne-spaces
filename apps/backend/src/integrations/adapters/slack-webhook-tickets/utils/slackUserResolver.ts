import { UserRepository } from '../../../../database/repositories/users';
import { AuthProvider, ChannelScopeType } from '@xyne/shared';
import { UserGroupRepository } from '../../../../database/repositories/userGroups';
import { ChannelRepository } from '../../../../database/repositories/channelRepository';
import { DatabaseClient } from '../../../../database/client';
import { config } from '../../../../config/env';

import { logger } from '../../../../utils/logger';
import { getAllBotTokens } from '../../../../migration/slack/slackMigrationBotConfig';
import { slackOfflineReference } from './slackOfflineReference';
import { WebClient } from '@slack/web-api';

/**
 * Builds the ordered list of bot tokens to try for a Slack API call: the caller's
 * primary token first, then every other configured token (deduped).
 *
 * Slack only returns a user's email / a usergroup's members when the requesting
 * bot is in the same workspace as that entity. In multi-workspace setups the
 * mentioned entity may live in a different workspace than the primary token, so
 * we fall back to the other tokens to fill in the missing info. With a single
 * workspace configured this returns just the primary token (zero extra calls).
 */
function buildTokenFallbackList(primaryToken: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const token of [primaryToken, ...getAllBotTokens()]) {
    if (token && !seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

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

export function extractAllSlackChannelIds(text: string): { id: string; name?: string }[] {
  const matches = text.matchAll(/<#([^>|]+)(?:\|([^>]*))?>/g);
  const seen = new Set<string>();
  const results: { id: string; name?: string }[] = [];
  for (const match of matches) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      results.push({ id, name: match[2] || undefined });
    }
  }
  return results;
}

/**
 * Low-level: one `users.info` call with a single bot token.
 * Most callers should use the fallback-aware `fetchSlackUserInfo` below instead;
 * this only exists so that wrapper can try each configured token in turn.
 */
async function requestSlackUserInfo(
  slackUserId: string,
  botOauthToken: string
): Promise<SlackUserInfo | null> {
  try {
    const client = new WebClient(botOauthToken);

    const result = await client.users.info({
      user: slackUserId,
    });

    logger.info('[fetchSlackUserInfo] Got result from Slack', { slackUserId, resultOk: result.ok, hasUser: !!result.user, error: result.error });

    if (!result.ok || !result.user) {
      logger.warn('[fetchSlackUserInfo] Failed to fetch Slack user info - invalid result', { slackUserId, error: result.error, resultOk: result.ok, hasUser: !!result.user });
      return null;
    }

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

/**
 * Fetches Slack user info, falling back across every configured bot token when
 * the primary token cannot resolve the user's email (the cross-workspace case).
 *
 * Returns the first result that carries an email; if no token yields an email,
 * returns the best result we did get (so display name etc. is still available).
 */
export async function fetchSlackUserInfo(
  slackUserId: string,
  botOauthToken: string
): Promise<SlackUserInfo | null> {
  const offline = slackOfflineReference();
  if (offline) return (offline.users.get(slackUserId) as SlackUserInfo) ?? null;
  const tokens = buildTokenFallbackList(botOauthToken);
  let bestResult: SlackUserInfo | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const result = await requestSlackUserInfo(slackUserId, tokens[i]);
    if (result?.profile?.email) {
      if (i > 0) {
        logger.info('[fetchSlackUserInfo] Resolved email via fallback token', { slackUserId, tokenIndex: i });
      }
      return result;
    }
    if (result && !bestResult) {
      bestResult = result;
    }
  }

  if (!bestResult?.profile?.email) {
    logger.warn('[fetchSlackUserInfo] No configured token returned an email', { slackUserId, tokensTried: tokens.length });
  }
  return bestResult;
}

/**
 * Low-level: one `conversations.info` call with a single bot token.
 * Most callers should use the fallback-aware `fetchSlackChannelInfo` below instead;
 * this only exists so that wrapper can try each configured token in turn.
 */
async function requestSlackChannelInfo(
  channelId: string,
  botOauthToken: string
): Promise<{ id: string; name: string; isPrivate: boolean } | null> {
  try {
    const client = new WebClient(botOauthToken);
    const result = await client.conversations.info({ channel: channelId });
    if (!result.ok || !result.channel) {
      logger.warn('[fetchSlackChannelInfo] Failed to fetch channel info', { channelId, error: result.error });
      return null;
    }
    const ch = result.channel as { id: string; name?: string; is_private?: boolean };
    return {
      id: ch.id,
      name: ch.name || channelId,
      isPrivate: ch.is_private === true,
    };
  } catch (error) {
    logger.error('[fetchSlackChannelInfo] Error fetching Slack channel info', { channelId, error });
    return null;
  }
}

/**
 * Fetches Slack channel info, falling back across every configured bot token.
 *
 * `conversations.info` only succeeds for a bot that is in the channel's
 * workspace, so in multi-workspace setups the primary token may not resolve a
 * cross-workspace channel. Returns the first token that resolves it.
 */
async function fetchSlackChannelInfo(
  channelId: string,
  botOauthToken: string
): Promise<{ id: string; name: string; isPrivate: boolean } | null> {
  const offline = slackOfflineReference();
  if (offline) return offline.channels.get(channelId) ?? null;
  const tokens = buildTokenFallbackList(botOauthToken);

  for (let i = 0; i < tokens.length; i++) {
    const result = await requestSlackChannelInfo(channelId, tokens[i]);
    if (result) {
      if (i > 0) {
        logger.info('[fetchSlackChannelInfo] Resolved channel via fallback token', { channelId, tokenIndex: i });
      }
      return result;
    }
  }

  logger.warn('[fetchSlackChannelInfo] No configured token resolved the channel', { channelId, tokensTried: tokens.length });
  return null;
}

/**
 * Low-level: one `usergroups.list` call with a single bot token.
 * Most callers should use the fallback-aware `fetchSlackGroupInfo` below instead;
 * this only exists so that wrapper can try each configured token in turn.
 */
async function requestSlackGroupInfo(slackGroupId: string, botOauthToken: string): Promise<SlackGroupInfo | null> {
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

/**
 * Fetches Slack usergroup info, falling back across every configured bot token.
 *
 * A usergroup only appears in `usergroups.list` for a bot in the same workspace,
 * so in multi-workspace setups the primary token may not see it. Returns the
 * first token that resolves the group with members; otherwise the best result.
 */
async function fetchSlackGroupInfo(slackGroupId: string, botOauthToken: string): Promise<SlackGroupInfo | null> {
  const offline = slackOfflineReference();
  if (offline) return (offline.groups.get(slackGroupId) as SlackGroupInfo) ?? null;
  const tokens = buildTokenFallbackList(botOauthToken);
  let bestResult: SlackGroupInfo | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const result = await requestSlackGroupInfo(slackGroupId, tokens[i]);
    if (result && result.users && result.users.length > 0) {
      if (i > 0) {
        logger.info('[fetchSlackGroupInfo] Resolved group via fallback token', { slackGroupId, tokenIndex: i });
      }
      return result;
    }
    if (result && !bestResult) {
      bestResult = result;
    }
  }

  if (!bestResult) {
    logger.warn('[fetchSlackGroupInfo] No configured token resolved the group', { slackGroupId, tokensTried: tokens.length });
  }
  return bestResult;
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
    // Offline migration: an author with no email (deactivated / external / missing scope) still has
    // a name in the dump — create a best-effort placeholder so the message keeps its sender instead
    // of being silently dropped. The live path (no offline ref) is unchanged.
    const offline = slackOfflineReference();
    if (offline?.createUser) {
      const name = displayName || `Slack user ${slackUserId}`;
      const dbUserId = await offline.createUser(`slack-${slackUserId}@migrated.invalid`, name, !!slackUser?.deleted);
      if (dbUserId) return { dbUserId, displayName: name };
    }
    return { displayName };
  }
  const userRepo = new UserRepository();
  const user = await userRepo.findByEmail(slackUser.profile.email, workspaceId);
  if (user) return { dbUserId: user.id, displayName };
  const offline = slackOfflineReference();
  if (offline?.createUser) {
    const dbUserId = await offline.createUser(slackUser.profile.email, displayName || slackUser.profile.email, !!slackUser.deleted);
    return { dbUserId, displayName };
  }
  return { displayName };
}

/**
 * Runs `fn` over `items` with at most `limit` promises in flight at once.
 *
 * Used to import Slack usergroup members concurrently without firing an unbounded
 * number of `users.info` calls (Slack rate limits) or DB writes (connection pool)
 * at the same time. Results preserve input order; `fn` errors reject the whole run,
 * so callers that want per-item resilience must catch inside `fn`.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(limit, 1), items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) break;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function resolveApiGroup(slackGroupId: string, botOauthToken: string, workspaceId?: string): Promise<string | undefined> {
  if (!slackGroupId || !botOauthToken) {
    return undefined;
  }
  const resolvedWorkspaceId = workspaceId ?? config.defaultWorkspaceId;
  const groupRepo = new UserGroupRepository();
  const userRepo = new UserRepository();
  const dbClient = DatabaseClient.getInstance();

  const slackGroup = await fetchSlackGroupInfo(slackGroupId, botOauthToken);
  if (!slackGroup) {
    return undefined;
  }

  // Upsert the group in the TARGET workspace (not just wherever it was first found)
  const group = await groupRepo.upsertGroupsWithMetadata({
    name: slackGroup.name,
    description: slackGroup.description,
    alias: slackGroup.handle,
    metadata: {
      slackGroupId: slackGroup.id,
    },
    workspace: { connect: { id: resolvedWorkspaceId } },
  });

  // Resolve each group member — create if not in DB. Members are imported with
  // bounded concurrency (rather than one-by-one) so a large group doesn't serialize
  // N `users.info` round-trips; the concurrency cap keeps us under Slack rate limits
  // and the DB connection pool. Each member is fully self-contained and returns its
  // resolved DB user id (or undefined if it should be skipped).
  const importMember = async (slackUserId: string): Promise<string | undefined> => {
    // First try: find by slackId metadata in the target workspace
    const existingBySlackId = await userRepo.findByMetadataField('slackId', slackUserId, resolvedWorkspaceId);
    if (existingBySlackId) {
      return existingBySlackId.id;
    }

    // Second try: find by fetching Slack user info (they may not have slackId metadata yet)
    const slackUserInfo = await fetchSlackUserInfo(slackUserId, botOauthToken);
    if (!slackUserInfo || slackUserInfo.is_bot) {
      logger.debug('[resolveApiGroup] Skipping bot or unfetchable user', { slackUserId });
      return undefined;
    }

    const userName = slackUserInfo.profile?.real_name || slackUserInfo.profile?.display_name || slackUserId;
    const hasRealEmail = !!slackUserInfo.profile?.email;
    const email = hasRealEmail
      ? slackUserInfo.profile!.email!.toLowerCase()
      : `${slackUserId}@cross-platform.in`;

    // For a real email, an existing user may already be present — link slackId to it.
    if (hasRealEmail) {
      const existingByEmail = await userRepo.findByEmailCaseInsensitive(email, resolvedWorkspaceId);
      if (existingByEmail) {
        await userRepo.upsertMetaDataField(existingByEmail.id, 'slackId', slackUserId);
        return existingByEmail.id;
      }
    }

    // Create OrgMember + User. Guard against a concurrent import (the same member can
    // appear in two groups resolved in parallel) creating the row first — on a failure
    // re-fetch by email and link to the now-existing user instead of throwing.
    try {
      let orgMember = await dbClient.orgMember.findUnique({
        where: { email },
        select: { memberId: true, orgId: true },
      });
      const workspace = await dbClient.workspace.findUnique({
        where: { id: resolvedWorkspaceId },
        select: { orgId: true },
      });
      if (!workspace) {
        logger.warn('[resolveApiGroup] Workspace not found', { workspaceId: resolvedWorkspaceId });
        return undefined;
      }
      // Never pull a Slack member who already belongs to a DIFFERENT org into this
      // workspace: buildTokenFallbackList tries every configured bot token, so a fallback
      // token can resolve an identity that belongs elsewhere. New members of THIS org are
      // still auto-created; existing members of THIS org are still linked by email.
      if (orgMember && orgMember.orgId !== workspace.orgId) {
        logger.warn('[resolveApiGroup] Skipping cross-org Slack member (email belongs to another org)', { email });
        return undefined;
      }
      if (!orgMember) {
        orgMember = await dbClient.orgMember.create({
          data: {
            orgId: workspace.orgId,
            email,
            role: 'MEMBER',
          },
          select: { memberId: true, orgId: true },
        });
        logger.info('[resolveApiGroup] OrgMember created for group member', { email });
      }
      const user = await userRepo.create({
        email,
        name: userName,
        providerUserId: `slack-migrated-${email}`,
        authProvider: AuthProvider.GOOGLE,
        status: slackUserInfo.deleted ? 'INACTIVE' : 'ACTIVE',
        workspace: { connect: { id: resolvedWorkspaceId } },
        orgMember: { connect: { memberId: orgMember.memberId } },
      });
      logger.info('[resolveApiGroup] User created for group member', { userId: user.id, email, hasRealEmail });
      await userRepo.upsertMetaDataField(user.id, 'slackId', slackUserId);
      return user.id;
    } catch (error) {
      const existing = await userRepo.findByEmailCaseInsensitive(email, resolvedWorkspaceId);
      if (existing) {
        await userRepo.upsertMetaDataField(existing.id, 'slackId', slackUserId);
        return existing.id;
      }
      logger.error('[resolveApiGroup] Failed to import group member', { slackUserId, email, error });
      return undefined;
    }
  };

  const memberResults = await mapWithConcurrency(slackGroup.users, 6, importMember);
  const dbUserIds: string[] = memberResults.filter((id): id is string => !!id);

  // Add all resolved users to the group
  if (dbUserIds.length > 0) {
    await dbClient.userGroupMapping.createMany({
      data: dbUserIds.map((userId) => ({
        workspaceId: resolvedWorkspaceId,
        userGroupId: group.id,
        userId,
      })),
      skipDuplicates: true,
    });
  }

  logger.info('[resolveApiGroup] Group resolved', {
    slackGroupId,
    xyneGroupId: group.id,
    totalSlackMembers: slackGroup.users.length,
    resolvedMembers: dbUserIds.length,
    workspaceId: resolvedWorkspaceId,
  });

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

  // DB-first for both users and groups: a Slack-native id is matched by stored metadata
  // (scoped to this workspace), a Xyne CUID is looked up directly by primary key.
  // The Slack API is only hit as a fallback for a Slack-native id not yet in the DB —
  // which, for groups, imports the group + members into the TARGET workspace.
  const userSlackIdsToFetch: string[] = [];
  if (type === 'user') {
    const dbResults = await Promise.allSettled(
      slackUserId.map((slackId) =>
        isSlackNativeId(slackId)
          ? userRepo.findByMetadataField('slackId', slackId, workspaceId)
          : userRepo.findById(slackId)
      )
    );

    slackUserId.forEach((slackId, i) => {
      const result = dbResults[i];
      if (result.status === 'fulfilled' && result.value) {
        userMapper.set(slackId, { dbId: result.value.id });
      } else if (isSlackNativeId(slackId)) {
        userSlackIdsToFetch.push(slackId);
      } else {
        userMapper.set(slackId, {});
      }
    });
  } else {
    const dbResults = await Promise.allSettled(
      slackUserId.map((slackId) =>
        isSlackNativeId(slackId)
          ? groupRepo.findByMetadataField('slackGroupId', slackId, workspaceId)
          : groupRepo.findById(slackId)
      )
    );

    slackUserId.forEach((slackId, i) => {
      const result = dbResults[i];
      if (result.status === 'fulfilled' && result.value) {
        userMapper.set(slackId, { dbId: result.value.id });
      } else if (isSlackNativeId(slackId)) {
        // Slack usergroup not imported yet — fall back to the API to create it in the
        // target workspace (cross-workspace matches were excluded by the workspace filter).
        userSlackIdsToFetch.push(slackId);
      } else {
        // A Xyne CUID that isn't in the DB can't be resolved via Slack — mark unknown.
        userMapper.set(slackId, {});
      }
    });
  }

  if (userSlackIdsToFetch.length > 0) {
    const apiResults = await Promise.allSettled(
      userSlackIdsToFetch.map((slackId) =>
        type === 'user'
          ? resolveApiUser(slackId, botOauthToken, workspaceId ?? '')
          : resolveApiGroup(slackId, botOauthToken, workspaceId).then((id) => ({ dbUserId: id, displayName: undefined }))
      )
    );

    userSlackIdsToFetch.forEach((slackId, i) => {
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
  const isPrivate = channel.visibility === 'PRIVATE' || channel.scopeType === ChannelScopeType.DM || channel.scopeType === ChannelScopeType.GROUP_DM;
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

/**
 * Resolves each `<#C…>` channel mention to its replacement HTML, concurrently.
 * The DB read (and Slack `conversations.info` fallback) for each channel is
 * independent, so they run in parallel; the caller applies the replacements after.
 */
async function resolveChannelReplacements(
  channelIds: { id: string; name?: string }[],
  channelRepo: ChannelRepository,
  botOauthToken: string,
  quote: string,
): Promise<{ channelId: string; html: string }[]> {
  return Promise.all(
    channelIds.map(async ({ id: channelId, name: slackChannelName }) => {
      const channel = await channelRepo.findById(channelId);
      if (channel) {
        return { channelId, html: buildChannelMentionSpan(channel, quote) };
      }
      if (slackChannelName) {
        return { channelId, html: `<span>#${escapeHtml(slackChannelName)}</span>` };
      }
      if (botOauthToken) {
        const slackChannel = await fetchSlackChannelInfo(channelId, botOauthToken);
        if (slackChannel) {
          return { channelId, html: `<span>#${escapeHtml(slackChannel.name)}</span>` };
        }
      }
      return { channelId, html: `<span>#${escapeHtml(channelId)}</span>` };
    }),
  );
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
  const quote = isStringified ? "'" : '"'
  const userRepo = new UserRepository();
  const groupRepo = new UserGroupRepository();
  const channelRepo = new ChannelRepository();

  // Users, groups and channels are independent — resolve them concurrently instead
  // of one phase after another. (resolveSlackIds only writes for groups; user
  // resolution is read-only, so there is no cross-write race between these.)
  const [userMapper, groupMapper, channelReplacements] = await Promise.all([
    resolveSlackIds(userIds, botOauthToken, 'user', resolvedWorkspaceId),
    resolveSlackIds(groupIds, botOauthToken, 'group', resolvedWorkspaceId),
    resolveChannelReplacements(channelIds, channelRepo, botOauthToken, quote),
  ]);

  // Batch-load every resolved user/group row in a single query each, instead of a
  // per-entity findById in the render loops below.
  const userDbIds = userMapper
    ? [...userMapper.values()].map((v) => v.dbId).filter((id): id is string => !!id)
    : [];
  const groupDbIds = groupMapper
    ? [...groupMapper.values()].map((v) => v.dbId).filter((id): id is string => !!id)
    : [];
  const [userRows, groupRows] = await Promise.all([
    userDbIds.length ? userRepo.findMany({ where: { id: { in: userDbIds } } }) : Promise.resolve([]),
    groupDbIds.length ? groupRepo.findMany({ where: { id: { in: groupDbIds } } }) : Promise.resolve([]),
  ]);
  const userById = new Map(userRows.map((u) => [u.id, u]));
  const groupById = new Map(groupRows.map((g) => [g.id, g]));

  if (userMapper) {
    for (const [slackId, { dbId, displayName }] of userMapper.entries()) {
      const user = dbId ? userById.get(dbId) : undefined;
      if (user) {
        text = replaceSlackUserMention(text, slackId, `<span ${buildMentionAttrs(user.id, user.name, false, quote, undefined, undefined, user.email, user.picture || undefined).join(' ')}>@${escapeHtml(user.name)}</span>`);
      } else {
        const name = displayName ?? 'unknown user';
        text = replaceSlackUserMention(text, slackId, `<span>@${escapeHtml(name)}</span>`);
      }
    }
  }
  if (groupMapper) {
    for (const [slackId, { dbId, displayName }] of groupMapper.entries()) {
      const group = dbId ? groupById.get(dbId) : undefined;
      if (group) {
        text = replaceSlackGroupMention(text, slackId, `<span ${buildMentionAttrs(group.id, group.name, true, quote, group.alias || undefined, group.description || undefined).join(' ')}>@${escapeHtml(group.alias || group.name)}</span>`);
      } else {
        const name = displayName ?? 'unknown group';
        text = replaceSlackGroupMention(text, slackId, `<span>@${escapeHtml(name)}</span>`);
      }
    }
  }
  for (const { channelId, html } of channelReplacements) {
    text = replaceSlackChannelMention(text, channelId, html);
  }
  return resolveSpecialMentions(text, isStringified);
}