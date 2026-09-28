import type { VisibleChannel } from '../../../machines/stateMachine';
import { ChannelUserStatus, ChannelSection } from '@xyne/shared';

export interface ChatDirectoryProps {
  channelData: VisibleChannel[] | undefined;
  allChannelsUserStatus: ChannelUserStatus[];
}

export type DraftMessage = {
  html: string;
  text: string;
};
// Channel category types (using const objects due to erasableSyntaxOnly)
export const ChannelCategory = {
  STARRED: 'starred',
  CHANNELS: 'channels',
  DIRECT_MESSAGES: 'direct-messages',
  GROUP_DMS: 'group-dms',
} as const;

export type ChannelCategory = (typeof ChannelCategory)[keyof typeof ChannelCategory];

// Non-starred browse categories, in display order.
export const NON_STARRED_CATEGORIES: ChannelCategory[] = [
  ChannelCategory.CHANNELS,
  ChannelCategory.DIRECT_MESSAGES,
  ChannelCategory.GROUP_DMS,
];

export interface SectionBucket {
  section: ChannelSection;
  channels: VisibleChannel[];
}
