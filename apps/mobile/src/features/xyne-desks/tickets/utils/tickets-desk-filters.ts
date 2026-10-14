import type { TicketPriority } from '@xyne/shared';

import type { TicketMailboxFolder } from '../types';
import type { DynamicFieldFilterValue } from './dynamic-field-filters';
import type { TicketsDateRange } from './format-date-filter-label';

/** Every filter that belongs to one desk (not shared across channel routes). */
export type TicketsDeskFilterState = {
  myTicketsOnly: boolean;
  assigneeIds: string[];
  createdByIds: string[];
  priorities: TicketPriority[];
  stageNames: string[];
  hasAiDraft: boolean;
  hasSubTickets: boolean;
  aiCategories: string[];
  generatedTags: string[];
  userGroupIds: string[];
  conversationLabelId: string | undefined;
  dynamicFields: Record<string, DynamicFieldFilterValue>;
  lastUpdatedRange: TicketsDateRange;
  dateRange: TicketsDateRange;
  activeFolder: TicketMailboxFolder;
};

export function emptyTicketsDeskFilters(): TicketsDeskFilterState {
  return {
    myTicketsOnly: false,
    assigneeIds: [],
    createdByIds: [],
    priorities: [],
    stageNames: [],
    hasAiDraft: false,
    hasSubTickets: false,
    aiCategories: [],
    generatedTags: [],
    userGroupIds: [],
    conversationLabelId: undefined,
    dynamicFields: {},
    lastUpdatedRange: {},
    dateRange: {},
    activeFolder: 'inbox',
  };
}
