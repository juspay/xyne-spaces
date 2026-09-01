import { TicketPriority, TicketStatusV2, FormContextMapping } from '@xyne/shared';

export interface BoardOption {
  id: string;
  name: string;
}

export interface TicketFilters {
  priority?: TicketPriority[];
  assignee?: string[]; // user IDs
  userGroups?: string[]; // user group IDs
  createdBy?: string[]; // user IDs
  roleAssignments?: Array<{ roleId: string; userIds: string[] }>;
  dueDateStart?: number;
  dueDateEnd?: number;
  createdDateStart?: number;
  createdDateEnd?: number;
  lastEmailAtStart?: number;
  lastEmailAtEnd?: number;
  boards?: string[];
  sourceChannels?: string[];
  tags?: string[];
  assigned?: boolean; // filter to show only tickets assigned to current user
  created?: boolean; // filter to show only tickets created by current user
  stages?: string[];
  ticketTypes?: string[];
  aiCategory?: string[]; // AI classification categories (e.g. "Mandate", "Refund")
  generatedTags?: string[]; // AI-generated tags in "category:tag" format (e.g. "priority:high")
  hasAiDraft?: boolean; // filter to show only tickets with AI-generated email drafts
  hasSubTickets?: boolean; // filter to show only tickets that have sub-tickets
  conversationLabelId?: string; // desk-only: single Gmail-style conversation label id
  // Dynamic form fields: fieldId -> filter value
  // For SELECT fields: string array of selected values
  // For DATE fields: { start?: number, end?: number }
  // For STRING/NUMBER/BOOLEAN/USER fields: string array with single value
  dynamicFields?: Record<string, string[] | { start?: number; end?: number }>;
}

export interface DateRange {
  start?: number;
  end?: number;
}

export interface TicketFiltersProps {
  filters: TicketFilters;
  onFiltersChange: (filters: TicketFilters) => void;
  projectId?: string;
  className?: string;
  availablePriorities?: TicketPriority[] | undefined;
  availableUsers?: string[] | undefined;
  availableBoards?: string[] | undefined;
  availableBoardDetails?: BoardOption[] | undefined;
  sourceChannelProjectIds?: string[] | undefined;
  showBoardsFilter?: boolean;
  availableTags?: string[] | undefined;
  availableStages?: { name: string; status?: TicketStatusV2 | undefined }[] | undefined;
  hideAssigneeFilter?: boolean;
  hasPrReviewers?: boolean;
  hasQaAssigned?: boolean;
  formMappings?: readonly FormContextMapping[] | undefined;
  /** Board name from parent (avoids waiting for lazy board list fetch) */
  selectedBoardName?: string | undefined;
  onBoardDropdownOpenChange?: (open: boolean) => void;
  /** True while the Source channels submenu is open; drives lazy board→project resolution in the parent */
  onSourceChannelsOpenChange?: (open: boolean) => void;
  isTicketsSyncing?: boolean;
  /** True when the selected board is a non-linear board */
  isNonLinearBoard?: boolean;
  channelId?: string;
  groupBy?: string; // serialized groupBy — included in save view and hasActiveFilters check
  hasActiveView?: boolean; // hides Save view button when a saved view is already active
  // Hide the board selector + the dropdown's own Save view (the Views builder has its own).
  workspaceView?: boolean;
}

export interface PriorityFilterProps {
  selectedPriorities: TicketPriority[];
  onChange: (priorities: TicketPriority[]) => void;
  className?: string;
}

export interface UserFilterProps {
  selectedUsers: string[];
  onChange: (userIds: string[]) => void;
  placeholder?: string;
  className?: string;
}

export interface DateRangeFilterProps {
  dateRange: DateRange;
  onChange: (dateRange: DateRange) => void;
  label: string;
  placeholder?: string;
  className?: string;
}
