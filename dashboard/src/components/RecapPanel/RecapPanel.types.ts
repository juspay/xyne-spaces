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
