// Types for ChannelCommandMenu component (using const objects due to erasableSyntaxOnly)
import type { Channel } from '@xyne/shared';

export const TabType = {
  ALL: 'all',
  USERS: 'users',
  CHANNELS: 'channels',
  MESSAGES: 'messages',
  TICKETS: 'tickets',
  ATTACHMENTS: 'attachments',
} as const;

export type TabType = (typeof TabType)[keyof typeof TabType];

export const VespaApps = {
  CHAT: 'chat',
  TICKET: 'ticket',
} as const;

export type VespaApps = (typeof VespaApps)[keyof typeof VespaApps];

export const VespaDocTypes = {
  MESSAGES: 'messages',
  ATTACHMENTS: 'attachments',
  TICKETS: 'tickets',
} as const;

export type VespaDocTypes = (typeof VespaDocTypes)[keyof typeof VespaDocTypes];

export const MentionType = {
  USER: 'user',
  CHANNEL: 'channel',
} as const;

export type MentionType = (typeof MentionType)[keyof typeof MentionType];

export interface ChannelCommandMenuProps {
  channels: Channel[];
  starred: Channel[];
  directMessages: Channel[];
  currentUserID: string;
  unreadCounts: Record<string, number>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
