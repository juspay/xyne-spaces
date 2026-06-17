export interface SearchResultsFilters {
  docType: 'all' | 'messages' | 'files' | 'tickets' | 'channels' | 'desk' | 'people';
  fromUserIds: string[];
  inChannelIds: string[];
  assigneeIds: string[];
  sortBy: 'relevance' | 'newest' | 'oldest';
  includeBotMessages: boolean;
  onlyMyChannels: boolean;
  rankProfile: string;
}

export const DEFAULT_SEARCH_FILTERS: SearchResultsFilters = {
  docType: 'messages',
  fromUserIds: [],
  inChannelIds: [],
  assigneeIds: [],
  sortBy: 'relevance',
  includeBotMessages: false,
  onlyMyChannels: true,
  rankProfile: '',
};
