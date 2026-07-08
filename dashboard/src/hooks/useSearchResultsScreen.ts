export interface SearchResultsFilters {
  docType: 'all' | 'messages' | 'files' | 'tickets' | 'channels' | 'desk' | 'people';
  fromUserIds: string[];
  fromEmails: string[];
  toEmails: string[];
  inChannelIds: string[];
  assigneeIds: string[];
  // Bare @user / #channel mention filters (no prefix) — searched as message mentions.
  mentionUserIds: string[];
  mentionChannelIds: string[];
  sortBy: 'relevance' | 'newest' | 'oldest';
  includeBotMessages: boolean;
  onlyMyChannels: boolean;
  rankProfile: string;
}

export const DEFAULT_SEARCH_FILTERS: SearchResultsFilters = {
  docType: 'all',
  fromUserIds: [],
  fromEmails: [],
  toEmails: [],
  inChannelIds: [],
  assigneeIds: [],
  mentionUserIds: [],
  mentionChannelIds: [],
  sortBy: 'relevance',
  includeBotMessages: false,
  onlyMyChannels: true,
  rankProfile: '',
};
