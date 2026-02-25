import { TicketPriority, TicketStatusV2, FormContextMapping } from '@xyne/shared';

export interface TicketFilters {
  priority?: TicketPriority[];
  assignee?: string[]; // user IDs
  userGroups?: string[]; // user group IDs
  createdBy?: string[]; // user IDs
  prReviewers?: string[]; // user IDs (from ticket_assignments with responsibility PR_REVIEWER)
  qaAssigned?: string[]; // user IDs (from ticket_assignments with responsibility QA)
  dueDateStart?: number;
  dueDateEnd?: number;
  createdDateStart?: number;
  createdDateEnd?: number;
  boards?: string[];
  tags?: string[];
  assigned?: boolean; // filter to show only tickets assigned to current user
  created?: boolean; // filter to show only tickets created by current user
  stages?: string[];
  // Dynamic form fields: fieldId -> filter value
  // For SELECT fields: string array of selected values
  // For DATE fields: { start?: number, end?: number }
  // For STRING/NUMBER/BOOLEAN/USER fields: string array with single value
  dynamicFields?: Record<string, string[] | { start?: number; end?: number }>;
}

export interface FilterConfig {
  label: string;
  field: keyof TicketFilters;
  type: 'multi-select' | 'date-range';
  placeholder?: string;
}

export interface UserOption {
  id: string;
  name: string;
  email?: string;
  picture?: string;
}

export interface UserGroupOption {
  id: string;
  name: string;
  alias?: string;
  memberCount?: number;
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
  availableUserGroups?: string[] | undefined;
  availableBoards?: string[] | undefined;
  allBoardsList?: Array<{ id: string; name: string }> | undefined;
  showBoardsFilter?: boolean;
  selectedBoard?: { id: string; name: string } | null | undefined;
  availableTags?: string[] | undefined;
  availableStages?: { name: string; status?: TicketStatusV2 | undefined }[] | undefined;
  hideAssigneeFilter?: boolean;
  formMappings?: readonly FormContextMapping[] | undefined;
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

export interface UserGroupFilterProps {
  selectedGroups: string[];
  onChange: (groupIds: string[]) => void;
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
