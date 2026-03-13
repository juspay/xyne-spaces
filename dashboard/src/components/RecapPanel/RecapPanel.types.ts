// Backend citationMetadata structure (from recapGenerationService)
export interface CitationMetadata {
  entityIdMapping: Record<number, string>;
  entityTypeMapping: Record<
    number,
    'message' | 'attachment' | 'call' | 'canvas' | 'ticket' | 'web_search'
  >;
  conversationIdMapping: Record<number, string>;
  messageIdMapping: Record<number, string>;
  canvasIdMapping: Record<number, string>;
  callIdMapping: Record<number, string>;
  ticketIdMapping: Record<number, string>;
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
  citations: Record<string, string[]>; // Maps point number to message indices or conversationIds
  messageIds: Record<string, string>; // Maps message index to message ID (legacy format)
  citationMetadata?: CitationMetadata; // Mappings from message index to actual IDs
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
