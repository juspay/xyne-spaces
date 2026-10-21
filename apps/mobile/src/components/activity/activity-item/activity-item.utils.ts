import { ActivityWithRelated, ActivityIconType } from '@/src/types/activity';
import { decodeBasicEntitiesWithApos, stripHtmlTags } from '@/src/utils/htmlText';

type ActivityPreviewSegment =
  | { type: 'text'; text: string }
  | { type: 'userMention'; userId: string; label: string }
  | { type: 'groupMention'; groupId: string; label: string }
  | { type: 'channelMention'; channelId: string; label: string }
  | { type: 'specialMention'; special: 'here' | 'channel'; label: string };

function normalizePreviewText(s: string): string {
  // Keep it readable in a 3-line preview: collapse whitespace and treat breaks as spaces.
  const withBreaks = s
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<\s*\/\s*p\s*>/gi, ' ')
    .replace(/<\s*p\b[^>]*>/gi, ' ')
    .replace(/[\t\n\r]+/g, ' ');
  return decodeBasicEntitiesWithApos(stripHtmlTags(withBreaks)).replace(/\s+/g, ' ').trim();
}

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pairRegex = /(\w+(?:-\w+)*)\s*=\s*["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = pairRegex.exec(attrString)) !== null) {
    attrs[m[1] ?? ''] = m[2] ?? '';
  }
  return attrs;
}

function ensurePrefix(label: string, prefix: '@' | '#'): string {
  const trimmed = label.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
}

/**
 * Parse stored message HTML into segments for ActivityItem previews.
 * Only preserves mention spans; everything else becomes plain text.
 */
export function getActivityPreviewSegmentsFromHtml(
  html: string | null | undefined,
): ActivityPreviewSegment[] {
  if (!html || typeof html !== 'string' || html.trim() === '') return [];

  const segments: ActivityPreviewSegment[] = [];
  const re =
    /<span\b([^>]*?(?:data-channel-mention|data-channel-id|data-user-id|data-group-id|data-mention-type)[^>]*)>([\s\S]*?)<\/span>/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const full = match[0] ?? '';
    const attrStr = match[1] ?? '';
    const inner = match[2] ?? '';
    const start = match.index;
    const end = start + full.length;

    const before = html.slice(lastIndex, start);
    const beforeText = normalizePreviewText(before);
    if (beforeText) segments.push({ type: 'text', text: beforeText + ' ' });

    const attrs = parseAttrs(attrStr);
    const mentionType = attrs['data-mention-type'] ?? '';

    // Channel mention (#channel)
    if (attrStr.includes('data-channel-mention') || attrs['data-channel-id']) {
      const channelId = attrs['data-channel-id'] ?? '';
      const label = normalizePreviewText(inner);
      if (channelId && label) {
        segments.push({
          type: 'channelMention',
          channelId,
          label: ensurePrefix(label, '#'),
        });
      } else if (label) {
        segments.push({ type: 'text', text: label + ' ' });
      }
      lastIndex = end;
      continue;
    }

    // User mention (@user)
    if (attrs['data-user-id']) {
      const userId = attrs['data-user-id'];
      const label = normalizePreviewText(inner);
      if (userId && label) {
        segments.push({ type: 'userMention', userId, label: ensurePrefix(label, '@') });
      } else if (label) {
        segments.push({ type: 'text', text: label + ' ' });
      }
      lastIndex = end;
      continue;
    }

    // Group mention (@group)
    if (mentionType === 'group' && attrs['data-group-id']) {
      const groupId = attrs['data-group-id'];
      const label = normalizePreviewText(inner);
      if (groupId && label) {
        segments.push({ type: 'groupMention', groupId, label: ensurePrefix(label, '@') });
      } else if (label) {
        segments.push({ type: 'text', text: label + ' ' });
      }
      lastIndex = end;
      continue;
    }

    // Special mentions (@here / @channel)
    if ((mentionType === 'here' || mentionType === 'channel') && inner) {
      const labelRaw = normalizePreviewText(inner);
      const label = ensurePrefix(labelRaw || mentionType, '@');
      segments.push({ type: 'specialMention', special: mentionType, label });
      lastIndex = end;
      continue;
    }

    // Fallback: treat unknown spans as plain text.
    const fallback = normalizePreviewText(inner);
    if (fallback) segments.push({ type: 'text', text: fallback + ' ' });
    lastIndex = end;
  }

  const after = html.slice(lastIndex);
  const afterText = normalizePreviewText(after);
  if (afterText) segments.push({ type: 'text', text: afterText });

  // Merge adjacent text segments to keep render tree small.
  const merged: ActivityPreviewSegment[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (seg.type === 'text' && prev?.type === 'text') {
      prev.text += seg.text;
      continue;
    }
    merged.push(seg);
  }

  // Split plain text segments for special mentions in case they weren't stored as spans.
  const expanded: ActivityPreviewSegment[] = [];
  for (const seg of merged) {
    if (seg.type !== 'text') {
      expanded.push(seg);
      continue;
    }

    const text = seg.text;
    const reSpecial = /(^|\s)(@here|@channel)\b/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = reSpecial.exec(text)) !== null) {
      const prefix = m[1] ?? '';
      const token = (m[2] ?? '').toLowerCase();
      const start = m.index;
      const end = start + (m[0]?.length ?? 0);

      const before = text.slice(last, start);
      if (before) expanded.push({ type: 'text', text: before });
      if (prefix) expanded.push({ type: 'text', text: prefix });

      if (token === '@here') {
        expanded.push({ type: 'specialMention', special: 'here', label: '@here' });
        expanded.push({ type: 'text', text: ' ' });
      } else if (token === '@channel') {
        expanded.push({ type: 'specialMention', special: 'channel', label: '@channel' });
        expanded.push({ type: 'text', text: ' ' });
      }

      last = end;
    }
    const after = text.slice(last);
    if (after) expanded.push({ type: 'text', text: after });
  }

  // Merge adjacent text segments again.
  const finalSegments: ActivityPreviewSegment[] = [];
  for (const seg of expanded) {
    const prev = finalSegments[finalSegments.length - 1];
    if (seg.type === 'text' && prev?.type === 'text') {
      prev.text += seg.text;
      continue;
    }
    finalSegments.push(seg);
  }

  return finalSegments;
}

/**
 * Get the icon type for the activity type badge shown at the bottom-right of the avatar.
 */
const getActivityIconType = (activity: ActivityWithRelated): ActivityIconType => {
  switch (activity.actorAction) {
    case 'mentioned_user':
    case 'group_mention':
      return 'mention';
    case 'replied':
    case 'replied_v2':
      return 'reply';
    case 'added':
    case 'added_v2':
    case 'removed':
    case 'removed_v2':
      return 'reaction';
    case 'direct_message':
      return 'message';
    case 'eta_warning':
    case 'eta_breach':
    case 'stage_eta_breach':
      return 'warning';
    case 'ticket_assigned':
    case 'ticket_status':
    case 'ticket_eta':
    case 'ticket_board':
      return 'ticket';
    default:
      return 'default';
  }
};

/**
 * Check if message content contains a mention of the user
 * Mentions are stored as HTML with data-mention-type="user" and data-user-id="..."
 */
const containsMention = (content: string | null | undefined, userId: string): boolean => {
  if (!content || !userId) return false;
  // Check for data-user-id attribute in the content
  return (
    content.includes(`data-user-id="${userId}"`) || content.includes(`data-user-id='${userId}'`)
  );
};

/**
 * Get the action text to display between actor name and channel name.
 * Examples: " mentioned you", " replied", " reacted"
 */
const getActivityActionText = (activity: ActivityWithRelated, currentUserId?: string): string => {
  switch (activity.actorAction) {
    case 'mentioned_user':
      return ' mentioned you';
    case 'group_mention':
      return ' mentioned a group';
    case 'replied':
    case 'replied_v2':
      return ' replied';
    case 'added':
    case 'added_v2':
      return ' reacted to your message';
    case 'removed':
    case 'removed_v2':
      return ' removed reaction from your message';
    case 'direct_message':
      // For DMs, check if it contains a mention of the user
      if (currentUserId && containsMention(activity.message?.content, currentUserId)) {
        return ' mentioned you';
      }
      return ' replied';
    case 'ticket_assigned':
    case 'ticket_assigned_to':
      return ' assigned you a ticket';
    case 'ticket_status':
      return ' updated ticket status';
    case 'ticket_eta':
      return ' updated ticket ETA';
    case 'ticket_board':
      return ' moved a ticket';
    case 'eta_warning':
      return ' ETA warning';
    case 'eta_breach':
      return ' ETA breached';
    case 'stage_eta_breach':
      return ' stage ETA breached';
    case 'ticket_pr_created':
      return ' created a PR';
    case 'ticket_pr_updated':
      return ' updated a PR';
    case 'ticket_pr_merged':
      return ' merged a PR';
    case 'ticket_pr_declined':
      return ' declined a PR';
    case 'ticket_pr_reviewer_assigned':
      return ' assigned you as PR reviewer';
    case 'ticket_qa_assigned':
      return ' assigned you QA';
    case 'workflow_question':
      return ' asked a question';
    default:
      return '';
  }
};

const getActivityDescription = (activity: ActivityWithRelated): string => {
  const content = activity.message?.content;
  if (content) {
    try {
      const parsed = JSON.parse(content);
      const text = parsed.text || parsed.body || content;
      return text.length > 100 ? `${text.slice(0, 100)}...` : text;
    } catch {
      return content.length > 100 ? `${content.slice(0, 100)}...` : content;
    }
  }

  if (activity.ticket?.title) {
    return activity.ticket.title;
  }

  if (activity.canvas?.title) {
    return activity.canvas.title;
  }

  return '';
};

const getChannelName = (channel: { name?: string | null } | null | undefined): string => {
  return channel?.name || '';
};

/**
 * Truncate channel name for activity items to show max 2 names + others.
 * Simple rule: show first 2 names, then "and X others" if there are more.
 * Always adds # prefix.
 */
const truncateChannelNameForActivity = (channelName: string | null | undefined): string => {
  if (!channelName) return '';

  // Remove the leading # if present (we'll add it back)
  const nameWithoutHash = channelName.startsWith('#') ? channelName.slice(1) : channelName;

  // Split by comma to get individual names
  const names = nameWithoutHash
    .split(',')
    .map(n => n.trim())
    .filter(Boolean);

  // Show all names if 2 or fewer
  if (names.length <= 2) {
    return `#${nameWithoutHash}`;
  }

  // Show first 2 names + "and X others"
  const firstTwo = names.slice(0, 2).join(', ');
  const remainingCount = names.length - 2;
  return `#${firstTwo} and ${remainingCount} others`;
};

export {
  getActivityIconType,
  getActivityActionText,
  getActivityDescription,
  getChannelName,
  truncateChannelNameForActivity,
};
