// Types for ChannelCommandMenu component (using const objects due to erasableSyntaxOnly)
import type { Channel } from '@xyne/shared';
import type { ContextItem } from '../ThreadContextPanel/ThreadContextPanel.types';

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
  FILE: 'file',
} as const;

export type VespaApps = (typeof VespaApps)[keyof typeof VespaApps];

export const VespaDocTypes = {
  MESSAGES: 'messages',
  ATTACHMENTS: 'attachments',
  TICKETS: 'tickets',
  FILES: 'files',
} as const;

export type VespaDocTypes = (typeof VespaDocTypes)[keyof typeof VespaDocTypes];

export const MentionType = {
  USER: 'user',
  CHANNEL: 'channel',
} as const;

export type MentionType = (typeof MentionType)[keyof typeof MentionType];

export type { ContextItem };

export interface ChannelCommandMenuProps {
  channels: Channel[];
  starred: Channel[];
  directMessages: Channel[];
  currentUserID: string;
  unreadCounts: Record<string, number>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true, clicking items adds them to context instead of navigating */
  contextSelectionMode?: boolean;
  /** Currently selected context items (used to show checkmarks) */
  contextItems?: ContextItem[];
  /** Called when user toggles an item in/out of context */
  onContextItemToggle?: (item: ContextItem) => void;
  /** Called when user confirms selection ("Add to Thread") */
  onContextSelectionConfirm?: () => void;
}
