import type { Channel } from '@xyne/shared';
import { ChannelUserStatus } from '@xyne/shared';

export interface ChatDirectoryProps {
  channelData: Channel[] | undefined;
  allChannelsUserStatus: ChannelUserStatus[];
}

export type DraftMessage = {
  html: string;
  text: string;
};

export type DraftMessages = Record<string, DraftMessage>;

// Channel category types (using const objects due to erasableSyntaxOnly)
export const ChannelCategory = {
  STARRED: 'starred',
  CHANNELS: 'channels',
  DIRECT_MESSAGES: 'direct-messages',
  GROUP_DMS: 'group-dms',
} as const;

export type ChannelCategory = (typeof ChannelCategory)[keyof typeof ChannelCategory];
