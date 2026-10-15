import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';

const MAX_MENTION_ITEMS = 10;

type MentionUserOption = {
  id: string;
  name: string;
  avatar?: string;
  email?: string;
  type: 'user' | 'special' | 'group';
  mentionType?: 'channel' | 'here';
  alias?: string;
  description?: string;
};

type MentionChannelOption = {
  id: string;
  name: string;
  type: 'channel';
  isPrivate?: boolean;
};

type MentionListItem = MentionUserOption | MentionChannelOption;

type ChannelLite = {
  id: string;
  name?: string | null;
  scopeType?: ChannelScopeType | null;
  visibility?: ChannelVisibility | null;
};

const toMentionChannels = (
  channels: ChannelLite[],
  normalizedQuery: string,
): MentionChannelOption[] => {
  const mapped = channels
    .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
    .map(channel => ({
      id: channel.id,
      name: channel.name ?? 'Unknown',
      type: 'channel' as const,
      isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
    }));

  if (normalizedQuery.length === 0) return mapped.slice(0, MAX_MENTION_ITEMS);
  return mapped
    .filter(channel => channel.name.toLowerCase().includes(normalizedQuery))
    .slice(0, MAX_MENTION_ITEMS);
};

const toMentionItems = (
  mentionMode: '@' | '#',
  users: MentionUserOption[],
  channels: MentionChannelOption[],
): MentionListItem[] => {
  return mentionMode === '#' ? channels : users;
};

const closeMentionPicker = (
  setMentionOpen: (visible: boolean) => void,
  setMentionQuery: (query: string) => void,
): void => {
  setMentionOpen(false);
  setMentionQuery('');
};

const buildSpecialMentionAttributes = (mentionType: 'channel' | 'here'): Record<string, string> => {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    'data-mention-type': mentionType,
  };
  /* eslint-enable @typescript-eslint/naming-convention */
};

const buildGroupMentionAttributes = (group: MentionUserOption): Record<string, string> => {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    'data-mention-type': 'group',
    'data-group-id': group.id,
    'data-group-name': group.name,
    'data-group-alias': group.alias ?? '',
    'data-description': group.description ?? '',
    'data-member-count': '0',
  };
  /* eslint-enable @typescript-eslint/naming-convention */
};

const buildUserMentionAttributes = (user: MentionUserOption): Record<string, string> => {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    'data-user-id': user.id,
    'data-username': user.name,
    'data-user-email': user.email ?? '',
    'data-user-picture': user.avatar ?? '',
    'data-mention-type': 'user',
  };
  /* eslint-enable @typescript-eslint/naming-convention */
};

const buildChannelMentionAttributes = (channel: MentionChannelOption): Record<string, string> => {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    'data-channel-id': channel.id,
    'data-channel-name': channel.name,
    'data-is-private': String(channel.isPrivate === true),
  };
  /* eslint-enable @typescript-eslint/naming-convention */
};

export {
  buildChannelMentionAttributes,
  buildGroupMentionAttributes,
  buildSpecialMentionAttributes,
  buildUserMentionAttributes,
  closeMentionPicker,
  toMentionChannels,
  toMentionItems,
};
export type { MentionChannelOption, MentionListItem, MentionUserOption };
