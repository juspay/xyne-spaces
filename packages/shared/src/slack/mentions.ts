// Slack mentions in message text (`<@U…>`, `<!subteam^S…>`, `<#C…>`, `<!here>`): finding them and
// turning them into Xyne mention spans. Pure: what each id refers to (a Xyne user, group or
// channel) is looked up by the backend (database, Slack API) and passed in as targets, so the
// encryption extractor can apply them to decrypted text (compose template slackMessageContent).
// Moved from the backend's slackUserResolver.ts; the HTML is byte-for-byte what it built.

/** The Slack ids a text mentions. Channels carry the name Slack put in the link, if any. */
export type SlackMentionIds = {
  users: string[];
  groups: string[];
  channels: { id: string; name?: string }[];
};

/** What one mentioned id refers to, or the name to show when it refers to nothing in Xyne. */
export type SlackUserTarget = { id: string; name: string; email?: string; picture?: string } | { unknownName: string };
export type SlackGroupTarget = { id: string; name: string; alias?: string; description?: string } | { unknownName: string };
export type SlackChannelTarget = { id: string; name: string; isPrivate: boolean } | { unknownName: string };

/** Targets by Slack id. An id with no entry is left as Slack wrote it. */
export type SlackMentionTargets = {
  users: Record<string, SlackUserTarget>;
  groups: Record<string, SlackGroupTarget>;
  channels: Record<string, SlackChannelTarget>;
};

export const NO_SLACK_MENTION_TARGETS: SlackMentionTargets = { users: {}, groups: {}, channels: {} };

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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMentionAttrs(
  id: string,
  name: string,
  isGroup: boolean = false,
  quote: string = '"',
  alias?: string,
  description?: string,
  email?: string,
  picture?: string,
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

function userSpan(target: SlackUserTarget, quote: string): string {
  if ('unknownName' in target) return `<span>@${escapeHtml(target.unknownName)}</span>`;
  return `<span ${buildMentionAttrs(target.id, target.name, false, quote, undefined, undefined, target.email, target.picture).join(' ')}>@${escapeHtml(target.name)}</span>`;
}

function groupSpan(target: SlackGroupTarget, quote: string): string {
  if ('unknownName' in target) return `<span>@${escapeHtml(target.unknownName)}</span>`;
  return `<span ${buildMentionAttrs(target.id, target.name, true, quote, target.alias, target.description).join(' ')}>@${escapeHtml(target.alias || target.name)}</span>`;
}

function channelSpan(target: SlackChannelTarget, quote: string): string {
  if ('unknownName' in target) return `<span>#${escapeHtml(target.unknownName)}</span>`;
  const channelName = target.name || target.id;
  return `<span data-channel-mention=${quote}${quote} data-channel-id=${quote}${escapeHtml(target.id)}${quote} data-channel-name=${quote}${escapeHtml(channelName)}${quote} data-is-private=${quote}${String(target.isPrivate)}${quote} class=${quote}chat-input-channel-mention${quote}>#${escapeHtml(channelName)}</span>`;
}

function resolveSpecialMentions(text: string, isStringified: boolean = false): string {
  const broadcastRegex = /<!channel>|<!here>|<!everyone>|@channel|@here|@everyone/g;
  const quote = isStringified ? "'" : '"';
  return text.replace(broadcastRegex, (match: string) => {
    const display = match.startsWith('<!') ? `@${match.slice(2, -1)}` : match;
    const mentionType = display.slice(1);
    return `<span class=${quote}chat-input-special-mention${quote} data-mention-type=${quote}${mentionType}${quote}>${display}</span>`;
  });
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

/** Every Slack id `text` mentions (users, user groups, channels), each once. */
export function findSlackMentionIds(text: string): SlackMentionIds {
  return {
    users: extractAllSlackIds(text, true),
    groups: extractAllSlackIds(text, false),
    channels: extractAllSlackChannelIds(text),
  };
}

/** `findSlackMentionIds` over several texts, merged, each id once (first channel name kept). */
export function mergeSlackMentionIds(all: SlackMentionIds[]): SlackMentionIds {
  const users = new Set<string>();
  const groups = new Set<string>();
  const channels = new Map<string, { id: string; name?: string }>();
  for (const ids of all) {
    ids.users.forEach((id) => users.add(id));
    ids.groups.forEach((id) => groups.add(id));
    ids.channels.forEach((c) => {
      if (!channels.has(c.id)) channels.set(c.id, c);
    });
  }
  return { users: [...users], groups: [...groups], channels: [...channels.values()] };
}

/**
 * `text` with every mention of an id in `targets` replaced by its Xyne mention span, and
 * `<!here>` / `<!channel>` / `<!everyone>` (and `@here`…) by special-mention spans.
 * `isStringified`: `text` is JSON (stringified blocks / attachments), so attribute quotes are `'`.
 */
export function applySlackMentions(text: string, targets: SlackMentionTargets, isStringified: boolean = false): string {
  const quote = isStringified ? "'" : '"';
  for (const [slackId, target] of Object.entries(targets.users)) {
    text = text.replace(new RegExp(`<@${escapeRegExp(slackId)}(?:\\|[^>]*)?>`, 'g'), userSpan(target, quote));
  }
  for (const [slackId, target] of Object.entries(targets.groups)) {
    text = text.replace(new RegExp(`<!subteam\\^${escapeRegExp(slackId)}(?:\\|[^>]*)?>`, 'g'), groupSpan(target, quote));
  }
  for (const [channelId, target] of Object.entries(targets.channels)) {
    text = text.replace(new RegExp(`<#${escapeRegExp(channelId)}(?:\\|[^>]*)?>`, 'g'), channelSpan(target, quote));
  }
  return resolveSpecialMentions(text, isStringified);
}
