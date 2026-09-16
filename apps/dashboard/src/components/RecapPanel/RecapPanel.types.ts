// Time-range modes for the recap panel header pills
export type RecapRangeMode = 'yesterday' | 'last7' | 'last14' | 'custom';

// A recap point before clustering. recapDate is sort metadata only — never rendered.
export interface RawPoint {
  text: string;
  recapDate: number;
  // In-day ordering hint
  order: number;
  topicTitle?: string;
  conversationId?: string;
  messageId?: string;
}

// Points citing the same thread
export interface RecapTopic {
  key: string; // conversationId
  conversationId: string;
  // Latest day's topicTitle, else thread initial-message preview, else null
  title: string | null;
  lastActivityAt: number | null;
  // Newest recapDate in the topic — what earned it a place in the window
  anchorDate: number;
  points: TopicPoint[];
}

export interface TopicPoint {
  text: string;
  conversationId?: string;
  messageId?: string;
  recapDate: number;
  // Predates the window — rendered as dimmed prior context
  isContext: boolean;
  // 1-based, in render order across the whole card
  citationNumber: number;
}

// Per-thread lookup for the title fallback
export interface ThreadMeta {
  preview: string | null;
  lastActivityAt: number | null;
}

export interface RecapCard {
  channelId: string;
  channelName: string;
  messageCount: number;
  summary: string[];
  drilldown: {
    conversationId: string | null;
    messageId: string | null;
  };
  // Per-point citation data embedded directly (like ask AI) — new format
  pointCitations?: Record<string, { conversationId?: string; messageId?: string }>;
  // Source entity index per point (for citation button label, like ask AI's messageIndex)
  citationIndices?: Record<string, number>;
  // Day-span labels, e.g. "Sep 4" / "Sep 7"
  spanStart?: string;
  spanEnd?: string;
  // Latest recap day in the card — drives read state and mark-as-read
  maxRecapDate?: number;
  // Custom recap fields — present only when the user has a custom recap for this channel
  hasCustomRecap?: boolean;
  customSummary?: string[];
  customMessageCount?: number;
  customPointCitations?: Record<string, { conversationId?: string; messageId?: string }>;
  customCitationIndices?: Record<string, number>;
  customDrilldown?: { conversationId: string | null; messageId: string | null };
  // Thread-clustered view. The flat fields above are kept for other consumers.
  topics?: RecapTopic[];
  ungroupedPoints?: TopicPoint[];
  customTopics?: RecapTopic[];
  customUngroupedPoints?: TopicPoint[];
}

export interface RecapSubscription {
  id: string;
  userId: string;
  channelId: string;
  lastSeenRecapDate: number | null;
  isRecapSubscribed: boolean;
}

export interface RecapMeta {
  totalMessages: number;
  date: string;
  estimatedTimeSavedMinutes: number;
  // Display label for the current range in browse modes (e.g. "Sep 1 – Sep 7")
  rangeLabel?: string;
}

export interface RecapData {
  cards: RecapCard[];
  meta: RecapMeta;
  date: string;
  configured: boolean;
  hasUnreadRecap: boolean;
}

export interface UseRecapDataReturn {
  recapData: RecapData | null;
  isLoading: boolean;
  subscriptions: RecapSubscription[];
  isLoadingSubscriptions: boolean;
  isFirstTime: boolean;
  unreadCount: number;
}

export interface YesterdayDateResult {
  dateStr: string;
  dateObj: Date;
}

// Types for RecapSettings component
import type { Channel } from '@xyne/shared';

export interface ChannelListItemProps {
  channel: Channel;
  isSelected: boolean;
  onToggle: () => void;
  currentUserId: string | undefined;
}

export interface RecapSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}
