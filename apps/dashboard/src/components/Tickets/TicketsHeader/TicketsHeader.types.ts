import type { ReactElement, ReactNode } from 'react';
import type { FormContextMapping, TicketPriority, TicketStatusV2 } from '@xyne/shared';
import type { BoardOption, TicketFilters } from '../TicketFilters/types';

export type HeaderLayoutView = 'kanban' | 'table' | 'calendar' | 'flow';

export interface HeaderGroupingOption {
  value:
    | 'assignee'
    | 'createdBy'
    | 'status'
    | 'priority'
    | 'merchantId'
    | { type: 'formField'; fieldId: string; fieldName: string };
  label: string;
  icon: ReactNode;
}

export interface HeaderColumnOption {
  key: string;
  label: string;
  icon: ReactNode;
}

export interface HeaderSavedFilter {
  id: string;
  name: string;
  isPrivate: boolean;
  isOwn: boolean;
}

export interface FilterPickerContext {
  projectId: string;
  channelId?: string | undefined;
  availablePriorities?: TicketPriority[] | undefined;
  availableUsers?: string[] | undefined;
  availableBoards?: string[] | undefined;
  availableBoardDetails?: BoardOption[] | undefined;
  sourceChannelProjectIds?: string[] | undefined;
  /**
   * Whether the board picker offers "All boards" (an empty selection). Channels
   * pass false: their boards come from channel_board_mappings and an empty
   * selection would leave the ticket query with no scope at all.
   */
  allowAllBoards?: boolean;
  availableTags?: string[] | undefined;
  onLoadMoreTags?: () => void;
  hasMoreTags?: boolean;
  onSearchTags?: (query: string) => void;
  availableStages?: { name: string; status?: TicketStatusV2 | undefined }[] | undefined;
  formMappings?: readonly FormContextMapping[] | undefined;
  selectedBoardName?: string | undefined;
  isNonLinearBoard?: boolean;
  onBoardDropdownOpenChange?: (open: boolean) => void;
  onSourceChannelsOpenChange?: (open: boolean) => void;
  onFiltersDropdownOpenChange?: (open: boolean) => void;
}

export interface FilterChipNames {
  userNamesById: Map<string, string>;
  userGroupNamesById: Map<string, string>;
  channelNamesById: Map<string, string>;
}

export interface HeaderViewSave {
  isDirty: boolean;
  ready: boolean;
  saving: boolean;
  canSaveInPlace: boolean;
  onReset: () => void;
  onSave: () => void;
  namePopoverOpen: boolean;
  onNamePopoverOpenChange: (open: boolean) => void;
  nameDraft: string;
  onNameDraftChange: (value: string) => void;
  onConfirmSave: () => void;
}

export interface TicketsHeaderProps {
  startSlot?: ReactElement | null | undefined;
  title: string;
  ticketCount: number | null;
  isFiltered: boolean;
  star?: { isStarred: boolean; onToggle: () => void } | null;
  searchValue: string;
  onSearchChange: (value: string) => void;
  isExactSearch: boolean;
  onExactSearchChange: (exact: boolean) => void;
  share?: { viewId: string; viewName: string } | null;
  onCreateTicket?: (() => void) | null;
  createTicketMetadata?: string;
  /** Channel surfaces only: opens the dialog that links boards to the channel. */
  onLinkBoards?: (() => void) | null;
  linkBoardsMetadata?: string;
  onBulkCreateTicket?: (() => void) | null;
  bulkCreateTicketMetadata?: string;

  layoutView: HeaderLayoutView;
  onLayoutChange: (layout: HeaderLayoutView) => void;
  showLayoutPicker: boolean;
  showCalendarLayout: boolean;
  groupBy: HeaderGroupingOption['value'] | 'none';
  groupingOptions: HeaderGroupingOption[];
  onGroupByChange: (value: HeaderGroupingOption['value'] | 'none') => void;
  columns: HeaderColumnOption[];
  visibleColumns: Set<string>;
  onColumnVisibilityChange: (key: string, visible: boolean) => void;
  onResetColumns: () => void;
  isComfortView: boolean;
  onComfortViewChange: (comfort: boolean) => void;
  savedFilters?: {
    items: HeaderSavedFilter[];
    activeId: string | null;
    onApply: (id: string) => void;
    onDismiss: () => void;
    onDelete: (item: HeaderSavedFilter) => void;
  } | null;

  showFilters: boolean;
  filters: TicketFilters;
  onFiltersChange: (filters: TicketFilters) => void;
  pickerContext: FilterPickerContext;
  names: FilterChipNames;
  workspaceView: boolean;
  hideAssigneeFilter: boolean;
  showFlagFilters: boolean;
  showOverdueOnly: boolean;
  onOverdueChange: (on: boolean) => void;
  onClearFilters: () => void;
  viewSave?: HeaderViewSave | null;
  onExport: ((action: 'download-csv' | 'download-json' | 'copy-csv' | 'copy-json') => void) | null;
  onOpenTicketReport?: (() => void) | null;
}
