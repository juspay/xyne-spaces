import type { DisplayEntityType, DisplaySearchResult } from '../../../types/search';

export interface ContextItem {
  id: string; // unique key: searchResult.id + '-' + type
  title: string;
  type: DisplayEntityType;
  url: string; // app-relative path, derived from searchContext
  searchResult: DisplaySearchResult;
}

export interface ThreadContextPanelProps {
  items: ContextItem[];
  onRemove: (id: string) => void;
  onConfirm: () => void;
}
