import type { NonParticipantPreview } from './chatRow.types';

const nonEmptyStrings = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(item => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const userId = (item as { userId?: unknown }).userId;
      return typeof userId === 'string' && userId.length > 0 ? userId : null;
    })
    .filter((userId): userId is string => userId !== null);
};

/**
 * Builds the action payload for v2's `user_not_in_channel` system message.
 * Keeping metadata parsing in the model prevents row components from making
 * decisions from raw server-shaped objects while LegendList recycles them.
 */
export const nonParticipantPreviewFromMetadata = (
  metadata: Record<string, unknown> | null,
  fallbackChannelId: string,
): NonParticipantPreview | null => {
  if (metadata?.['messageSubtype'] !== 'user_not_in_channel') {
    return null;
  }

  const channelId =
    typeof metadata['channelId'] === 'string' && metadata['channelId'].length > 0
      ? metadata['channelId']
      : fallbackChannelId;
  if (!channelId) {
    return null;
  }

  return {
    userIds: nonEmptyStrings(metadata['mentionedUsers']),
    channelId,
    canAddMembers: metadata['canAddUsers'] !== false,
  };
};

/** V2 inserts two spaces around mention links so adjacent names do not run together. */
export const formatNonParticipantMarkdown = (markdown: string): string =>
  markdown.replace(/,\s*(?=\[\*\*@)/g, ',  ').replace(/(?<=\))(?=\[\*\*@)/g, '  ');
