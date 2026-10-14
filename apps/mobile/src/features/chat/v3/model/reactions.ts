type ReactionMap = Record<string, string[]>;

/** Parses the persisted reaction block without loading the shared Zero barrel. */
export const parseReactionsMd = (md: string | null | undefined): ReactionMap => {
  if (!md) {
    return {};
  }

  const reactions: ReactionMap = {};
  let inBlock = false;
  for (const line of md.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === ':::reactions') {
      inBlock = true;
      continue;
    }
    if (trimmed === ':::') {
      inBlock = false;
      continue;
    }
    if (!inBlock || !trimmed.includes(':')) {
      continue;
    }

    const separator = ': [';
    const separatorIndex = trimmed.lastIndexOf(separator);
    const splitIndex = separatorIndex >= 0 ? separatorIndex : trimmed.indexOf(':');
    const emoji = trimmed.slice(0, splitIndex).trim();
    const userIds = trimmed
      .slice(splitIndex + 1)
      .trim()
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map(userId => userId.trim())
      .filter(Boolean);

    if (emoji && userIds.length > 0) {
      reactions[emoji] = userIds;
    }
  }
  return reactions;
};
