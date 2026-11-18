import type { ExtractorOutput } from '../enc-contracts/extractors.js';
import { stripCodeRegions } from '../utils/mentionParser.js';

const ZWSP = '​';

/**
 * Parsing half of the backend's extractAllUsersForNotification (utils/mentionUtils.ts):
 * the same token formats, with every DB/Redis lookup left to the caller. `handles` are
 * the ZWSP `@name` tokens, which the backend resolves as user names and group
 * aliases/names exactly as it does today.
 */
export function extractMentions(text: string): ExtractorOutput['mentions'] {
  // A mention inside <pre>/<code> is a false positive and must not notify.
  const content = stripCodeRegions(text);
  const userIds = new Set<string>();
  const groupIds = new Set<string>();
  const handles = new Set<string>();

  // <userid:ID> mrkdwn tokens (FlowJSON text components).
  for (const match of content.matchAll(/<userid:([\w-]+)>/g)) {
    userIds.add(match[1]);
  }

  // User mention spans: data-user-id with data-username (spans missing either are skipped).
  for (const match of content.matchAll(/<span\b[^>]*\bdata-user-id=["'][^"']+["'][^>]*>(?:[^<]*)<\/span>/gi)) {
    const spanTag = match[0];
    const userId = spanTag.match(/data-user-id=["']([^"']+)["']/i)?.[1];
    const username = spanTag.match(/data-username=["']([^"']+)["']/i)?.[1];
    if (userId && username) userIds.add(userId);
  }

  // <groupid:ID(:alias)> mrkdwn tokens.
  for (const match of content.matchAll(/<groupid:([\w-]+)(?::([^>]+))?>/g)) {
    groupIds.add(match[1]);
  }

  // Group mention spans: data-group-id with data-group-name.
  for (const match of content.matchAll(/<span\b[^>]*\bdata-group-id=["'][^"']+["'][^>]*>(?:[^<]*)<\/span>/gi)) {
    const spanTag = match[0];
    const groupId = spanTag.match(/data-group-id=["']([^"']+)["']/i)?.[1];
    const groupName = spanTag.match(/data-group-name=["']([^"']+)["']/i)?.[1];
    if (groupId && groupName) groupIds.add(groupId);
  }

  // Legacy ZWSP-delimited `@name` tokens; need a name lookup, so they stay unresolved here.
  for (const match of content.matchAll(new RegExp(`${ZWSP}@([^${ZWSP}]+)${ZWSP}`, 'g'))) {
    handles.add(match[1]);
  }

  const { channel, here } = extractSpecialMentionFlags(text);

  return {
    userIds: [...userIds],
    groupIds: [...groupIds],
    handles: [...handles],
    channel,
    here,
  };
}

/** Same detection as the backend's extractSpecialMentions, without its logging. */
export function extractSpecialMentionFlags(content: string): { channel: boolean; here: boolean } {
  let channel =
    /<span[^>]*class="[^"]*chat-input-special-mention[^"]*"[^>]*data-mention-type="channel"[^>]*>@channel<\/span>/i.test(content);
  let here =
    /<span[^>]*class="[^"]*chat-input-special-mention[^"]*"[^>]*data-mention-type="here"[^>]*>@here<\/span>/i.test(content);

  // Plain `@channel`/`@here`, or the FlowJSON broadcast tokens, outside code regions.
  const contentWithoutCode = stripCodeRegions(content);
  if (!channel && (/@channel\b/i.test(contentWithoutCode) || /<broadcast:channel>/i.test(contentWithoutCode))) {
    channel = true;
  }
  if (!here && (/@here\b/i.test(contentWithoutCode) || /<broadcast:here>/i.test(contentWithoutCode))) {
    here = true;
  }

  return { channel, here };
}
