// Types for ChannelCommandMenu component (using const objects due to erasableSyntaxOnly)
import type { Channel } from '@xyne/shared';
import type { ContextItem } from '../ThreadContextPanel/ThreadContextPanel.types';

/**
 * Searchable type constants for the type: filter
 * These are the valid type values that can be used with the type filter
 */
export const SearchableTypes = {
  MESSAGES: 'messages',
  CHANNELS: 'channels',
  USERS: 'users',
  PEOPLE: 'people',
  TICKETS: 'tickets',
  FILES: 'files',
  ATTACHMENTS: 'attachments',
  CANVAS: 'canvas',
  TRANSCRIPT: 'transcript',
  RCA: 'rca',
} as const;

export type SearchableType = (typeof SearchableTypes)[keyof typeof SearchableTypes];

/**
 * Type suggestions for the type: filter autocomplete
 * These are the available types that can be used with the type filter
 */
export const TYPE_SUGGESTIONS = [
  { id: SearchableTypes.MESSAGES, name: SearchableTypes.MESSAGES },
  { id: SearchableTypes.CHANNELS, name: SearchableTypes.CHANNELS },
  { id: SearchableTypes.USERS, name: SearchableTypes.USERS },
  { id: SearchableTypes.PEOPLE, name: SearchableTypes.PEOPLE, aliasFor: SearchableTypes.USERS },
  { id: SearchableTypes.TICKETS, name: SearchableTypes.TICKETS },
  { id: SearchableTypes.FILES, name: SearchableTypes.FILES },
  { id: SearchableTypes.ATTACHMENTS, name: SearchableTypes.ATTACHMENTS },
  { id: SearchableTypes.CANVAS, name: SearchableTypes.CANVAS, subApp: 'canvas' },
  { id: SearchableTypes.TRANSCRIPT, name: SearchableTypes.TRANSCRIPT, subApp: 'transcript' },
  { id: SearchableTypes.RCA, name: SearchableTypes.RCA, subApp: 'RCA' },
] as const;

/**
 * Type suggestion item type
 */
export type TypeSuggestion = (typeof TYPE_SUGGESTIONS)[number];

export const TabType = {
  ALL: 'all',
  USERS: 'users',
  CHANNELS: 'channels',
  MESSAGES: 'messages',
  TICKETS: 'tickets',
  ATTACHMENTS: 'attachments',
  CANVAS: 'canvas',
  CALL: 'call',
  RECORDING: 'recording',
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
  CHANNELS: 'channels',
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

export interface ContextPickerItem {
  id: string;
  title: string;
  isPrivate?: boolean; // relevant for channels only
}

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
  /**
   * Controls which tabs are visible. When omitted, defaults to all
   * pre-existing tabs (users, channels, messages, gmail, tickets, attachments).
   * Pass an explicit array to show only those tabs — e.g.
   * [TabType.CHANNELS, TabType.TICKETS, TabType.CANVAS] for the AskAI context picker.
   */
  enabledTabs?: TabType[];
  /**
   * When true, renders as a plain inline panel (<Command>) instead of a
   * full-screen dialog (<Command.Dialog>). Parent controls visibility by
   * conditionally mounting/unmounting this component.
   */
  inline?: boolean;
  /** Called whenever the active tab changes; used to track active tab for call/recording disambiguation. */
  onTabChange?: (tab: TabType) => void;
}
