/**
 * Type definitions for the browser extension.
 */

// Re-export SDK types
export type {
  User,
  UserProfile,
  Channel,
  ChannelUserStatus,
  ChannelParticipant,
  Message,
  Conversation,
  Ticket,
  SearchResult,
  SearchResponse,
  SearchOptions,
} from '@xyne/spaces-sdk';

// Extension-specific types
export interface ExtensionMessage {
  type: string;
  payload?: unknown;
}

export interface SearchQueryMessage extends ExtensionMessage {
  type: 'SEARCH_QUERY';
  query: string;
}

export interface GetPendingSearchMessage extends ExtensionMessage {
  type: 'GET_PENDING_SEARCH';
}

export type BackgroundMessage = SearchQueryMessage | GetPendingSearchMessage;
