import { ReactElement, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { Switch } from '../../ui/Switch';
import { SavedConfigContextType, SavedConfigVisibility, SavedConfigEntityName } from '@xyne/shared';
import {
  ListFilter,
  ChevronRight,
  BarChart3,
  User,
  Users,
  Calendar,
  ChevronDown,
  BarChart4Icon,
  Search,
  Tag,
  FileText,
  Hash,
  ToggleLeft,
  X,
  Circle,
  Loader2,
} from 'lucide-react';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { Button } from '../../ui/Button';
import {
  PrioritySubmenu,
  UserSubmenu,
  UserGroupSubmenu,
  DateRangeSubmenu,
  BoardSubmenu,
  TagsSubmenu,
  DynamicFieldSubmenu,
  StagesSubmenu,
} from './Submenus';
import { TicketFiltersProps, DateRange } from './types';
import type { TicketFilters } from './types';
import { FormFieldType } from '@xyne/shared';
import type { TicketPriority, FormFields } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import * as Popover from '@radix-ui/react-popover';
import { useSearchMetrics } from '../../../hooks/useSearchMetrics';
import { TabType } from '../../Chat/ChatDirectory/ChannelCommandMenu.types';
import { logger, Event } from '../../../utils/logger';
import { usePlatform } from '../../../hooks/usePlatform';
import { useCanViewAnalytics } from '../../../hooks/usePermissions';

interface FilterMenuItem {
  id: string;
  label: string;
  icon: typeof BarChart3;
  filterKey: string; // Can be keyof TicketFilters, date range identifiers, or dynamic field paths
  // For dynamic fields
  isDynamic?: boolean;
  fieldType?: FormFieldType;
  fieldEnum?: string[] | null;
}

const ARRAY_FILTER_KEYS = [
  'priority',
  'assignee',
  'createdBy',
  'userGroups',
  'prReviewers',
  'qaAssigned',
  'tags',
  'stages',
] as const satisfies (keyof TicketFilters)[];

const NUMERIC_FILTER_KEYS = [
  'dueDateStart',
  'dueDateEnd',
  'createdDateStart',
  'createdDateEnd',
] as const satisfies (keyof TicketFilters)[];

const FILTER_MENU_ITEMS: FilterMenuItem[] = [
  { id: 'priority', label: 'Priority', icon: BarChart4Icon, filterKey: 'priority' },
  { id: 'userGroups', label: 'User Groups', icon: Users, filterKey: 'userGroups' },
  { id: 'createdBy', label: 'Created by', icon: User, filterKey: 'createdBy' },
  { id: 'prReviewers', label: 'PR Reviewer', icon: User, filterKey: 'prReviewers' },
  { id: 'qaAssigned', label: 'QA', icon: User, filterKey: 'qaAssigned' },
  { id: 'dueDate', label: 'Due Date', icon: Calendar, filterKey: 'dueDate' },
  { id: 'createdAt', label: 'Created At', icon: Calendar, filterKey: 'createdAt' },
  { id: 'tags', label: 'Tags', icon: Tag, filterKey: 'tags' },
  { id: 'stages', label: 'Stages', icon: Circle, filterKey: 'stages' },
];

export const TicketFiltersDropdown = ({
  filters,
  onFiltersChange,
  projectId,
  className = '',
  availablePriorities,
  availableUsers,
  availableUserGroups,
  availableBoards,
  showBoardsFilter = false,
  availableTags,
  availableStages,
  hideAssigneeFilter = false,
  formMappings,
  searchValue,
  onSearchChange,
  selectedBoardName,
  isTicketsSyncing = false,
  channelId,
  groupBy,
  hasActiveView,
}: TicketFiltersProps & {
  searchValue?: string;
  onSearchChange?: (searchTerm: string) => void;
}): ReactElement => {
  const [boardOpen, setBoardOpen] = useState(false);
  const [hasBoardDropdownOpened, setHasBoardDropdownOpened] = useState(false);

  // Latency tracking for boards loading
  const boardsLoadStartRef = useRef<number | null>(null);
  const boardsLoggedRef = useRef(false);

  // Start timing when dropdown first opens
  useEffect(() => {
    if (hasBoardDropdownOpened && boardsLoadStartRef.current === null) {
      boardsLoadStartRef.current = performance.now();
      boardsLoggedRef.current = false;
    }
  }, [hasBoardDropdownOpened]);

  // When availableBoards is provided (my-tickets/user-tickets/group-tickets), we already know
  // exactly which board IDs the user has tickets in — fetch only those instead of loading all
  // boards globally or by project.
  const isMyTicketsMode = availableBoards !== undefined;

  // my-tickets path: fetch only the boards the user actually has tickets in, lazily when the
  // dropdown opens. Skip the query entirely when availableBoards is empty (no tickets loaded yet).
  const [boardsByIdsResult, boardsByIdsDetails] = useCachedQuery(
    queries.boardsByIds({ boardIds: availableBoards ?? [] }),
    {
      enabled: isMyTicketsMode && hasBoardDropdownOpened && (availableBoards?.length ?? 0) > 0,
    },
  );

  // project/channel path: lazily fetch boards scoped to the project (always project-scoped).
  const [allBoardsProject, allBoardsProjectDetails] = useCachedQuery(
    queries.boardsListByProject({ projectId: projectId || '' }),
    {
      enabled: !isMyTicketsMode && hasBoardDropdownOpened && !!projectId,
    },
  );

  const allBoardsRaw = isMyTicketsMode ? boardsByIdsResult : allBoardsProject;
  const boardsDetails = isMyTicketsMode ? boardsByIdsDetails : allBoardsProjectDetails;

  // Log boards loading latency when complete
  useEffect(() => {
    if (
      boardsDetails.type === 'complete' &&
      boardsLoadStartRef.current !== null &&
      !boardsLoggedRef.current
    ) {
      const latency = performance.now() - boardsLoadStartRef.current;
      boardsLoggedRef.current = true;

      logger.info(Event.KANBAN_ENTITY_LOADED, {
        entity: 'boards',
        latency,
        context: 'TicketFiltersDropdown',
        projectId: projectId || 'global',
      });
    }
  }, [boardsDetails, projectId]);

  // In my-tickets mode the boardsByIds query is already scoped to the user's boards, so no
  // further filtering is needed. In project/channel modes, allBoardsRaw is already correct.
  const allBoardsList = useMemo(() => {
    if (isMyTicketsMode) {
      // If tickets haven't loaded yet (availableBoards is empty), show no boards in dropdown
      if (!availableBoards || availableBoards.length === 0) return [];
      return allBoardsRaw ?? [];
    }
    return allBoardsRaw;
  }, [allBoardsRaw, availableBoards, isMyTicketsMode]);

  // Derive selectedBoard from fetched boards
  const selectedBoard = useMemo(() => {
    const selectedBoards = filters.boards || [];
    if (selectedBoards.length === 1 && allBoardsList) {
      return allBoardsList.find(b => b.id === selectedBoards[0]) ?? null;
    }
    return null;
  }, [filters.boards, allBoardsList]);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const menuItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [showSavePopover, setShowSavePopover] = useState(false);
  const [viewName, setViewName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const zero = useZero();
  const { isMobile } = usePlatform();

  // Memoized filter active check for menu items
  const isFilterActive = useCallback(
    (item: FilterMenuItem): boolean => {
      // Handle date range filters which use separate Start/End keys
      if (item.filterKey === 'dueDate') {
        return !!(filters.dueDateStart !== undefined || filters.dueDateEnd !== undefined);
      }
      if (item.filterKey === 'createdAt') {
        return !!(filters.createdDateStart !== undefined || filters.createdDateEnd !== undefined);
      }
      const filterValue = filters[item.filterKey as keyof TicketFilters];
      if (Array.isArray(filterValue)) {
        return filterValue.length > 0;
      }
      if (typeof filterValue === 'object' && filterValue !== null) {
        return Object.keys(filterValue).length > 0;
      }
      return !!filterValue;
    },
    [filters],
  );
  const selectedBoards = useMemo(() => filters.boards || [], [filters.boards]);

  // When "All Boards" is selected, clear only dynamic field filters,
  // but keep common filters intact.
  useEffect(() => {
    if (selectedBoards.length > 0) return;

    if (filters.dynamicFields && Object.keys(filters.dynamicFields).length > 0) {
      const { dynamicFields: _dynamicFields, ...remainingFilters } = filters;
      onFiltersChange(remainingFilters);
    }
  }, [selectedBoards, filters, onFiltersChange]);

  // Close submenu when main popover closes
  useEffect(() => {
    if (!isOpen) {
      setActiveSubmenu(null);
    }
  }, [isOpen]);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const canViewAnalytics = useCanViewAnalytics();
  const { setActiveTab, setUseVespaSearch } = useSearchMetrics({ allChannels: [] });

  useEffect(() => {
    setActiveTab(TabType.TICKETS);
    setUseVespaSearch(false);
  }, [setActiveTab, setUseVespaSearch]);

  const totalBoardCount = allBoardsList?.length || 0;
  // In my-tickets mode, totalBoardCount reflects only boards for which the user has tickets.
  // We must NOT auto-collapse to a single board name when there's only 1 available board,
  // because the user may have "All Boards" selected and we don't want to hide that intent.
  // In project/channel modes, auto-showing the single board name is fine (project has 1 board).
  const boardLabel =
    !isMyTicketsMode && totalBoardCount === 1 && allBoardsList?.[0]
      ? allBoardsList[0].name
      : selectedBoards.length === 0
        ? 'All Boards'
        : selectedBoards.length === 1
          ? (selectedBoard?.name ?? selectedBoardName ?? 'Board')
          : `${selectedBoards.length} Boards`;

  // Track when board dropdown is opened for lazy loading
  const handleBoardDropdownOpenChange = (open: boolean): void => {
    setBoardOpen(open);
    if (open && !hasBoardDropdownOpened) {
      setHasBoardDropdownOpened(true);
    }
  };

  // Helper to get icon for field type
  const getIconForFieldType = (fieldType: FormFieldType): typeof BarChart3 => {
    switch (fieldType) {
      case FormFieldType.STRING:
      case FormFieldType.NUMBER:
        return FileText;
      case FormFieldType.DATE:
        return Calendar;
      case FormFieldType.BOOLEAN:
        return ToggleLeft;
      case FormFieldType.SINGLE_SELECT:
      case FormFieldType.MULTI_SELECT:
        return BarChart3;
      case FormFieldType.USER:
        return User;
      default:
        return Hash;
    }
  };

  // Generate dynamic filter menu items from form fields
  // Aggregate all form fields from selected boards, deduplicating by field ID
  const dynamicFilterItems = useMemo(() => {
    if (!formMappings || formMappings.length === 0) return [];

    // Collect all unique form fields by field ID
    const fieldsMap = new Map<string, { field: FormFields }>();
    formMappings.forEach(mapping => {
      const mappingWithFields = mapping as unknown as {
        formFields?: FormFields[];
      };
      const fields = mappingWithFields.formFields;

      fields?.forEach((field: FormFields) => {
        // Use field ID as key to ensure uniqueness
        if (!fieldsMap.has(field.id)) {
          fieldsMap.set(field.id, { field });
        }
      });
    });

    return Array.from(fieldsMap.values()).map(({ field }) => {
      return {
        id: `dynamic-${field.id}`,
        label: field.fieldName,
        icon: getIconForFieldType(field.fieldType),
        filterKey: `dynamicFields.${field.id}`,
        isDynamic: true,
        fieldType: field.fieldType,
        fieldEnum: field.fieldEnum as string[] | null,
      };
    });
  }, [formMappings, allBoardsList, selectedBoards]);

  // Only show dynamic filters if a specific board is selected
  const allFilterItems = useMemo(() => {
    if (!selectedBoards.length) {
      // Only show static filters when All Boards is selected
      return FILTER_MENU_ITEMS;
    }
    return [...FILTER_MENU_ITEMS, ...dynamicFilterItems];
  }, [dynamicFilterItems, selectedBoards]);

  const handleFilterChange = (key: keyof TicketFilters, value: unknown): void => {
    const newFilters = {
      ...filters,
      [key]: value,
    };

    // Clear stages filter when board changes since stages are board-specific
    if (key === 'boards') {
      delete newFilters.stages;
    }

    // Remove undefined values to keep filters clean
    Object.keys(newFilters).forEach((filterKey: string) => {
      const k = filterKey as keyof TicketFilters;
      const filterValue = newFilters[k];
      if (
        filterValue === undefined ||
        filterValue === null ||
        (Array.isArray(filterValue) && filterValue.length === 0)
      ) {
        delete newFilters[k];
      }
    });

    onFiltersChange(newFilters);
  };

  const handleDynamicFieldChange = (
    fieldId: string,
    value: string[] | { start?: number; end?: number },
  ): void => {
    const newFilters = { ...filters };

    if (!newFilters.dynamicFields) {
      newFilters.dynamicFields = {};
    }

    const isEmpty = Array.isArray(value) ? value.length === 0 : !value.start && !value.end;

    if (isEmpty) {
      // Remove empty filters
      delete newFilters.dynamicFields[fieldId];
      if (Object.keys(newFilters.dynamicFields).length === 0) {
        delete newFilters.dynamicFields;
      }
    } else {
      newFilters.dynamicFields[fieldId] = value;
    }

    onFiltersChange(newFilters);
  };

  const handleDateRangeChange = (dateRange: DateRange, isCreatedDate: boolean): void => {
    const newFilters = { ...filters };

    if (isCreatedDate) {
      // Handle created date range
      if (dateRange.start !== undefined) {
        newFilters.createdDateStart = dateRange.start;
      } else {
        delete newFilters.createdDateStart;
      }

      if (dateRange.end !== undefined) {
        newFilters.createdDateEnd = dateRange.end;
      } else {
        delete newFilters.createdDateEnd;
      }
    } else {
      // Handle due date range
      if (dateRange.start !== undefined) {
        newFilters.dueDateStart = dateRange.start;
      } else {
        delete newFilters.dueDateStart;
      }

      if (dateRange.end !== undefined) {
        newFilters.dueDateEnd = dateRange.end;
      } else {
        delete newFilters.dueDateEnd;
      }
    }

    onFiltersChange(newFilters);
  };

  const getFilterAssigneeCount = (): number => {
    let count = 0;
    if (filters.assignee?.length) count++;
    return count;
  };

  const getMoreFiltersActiveCount = (): number => {
    let count = 0;
    // Excludes boards (auto-selected) and assignee (has its own indicator)
    if (filters.priority?.length) count++;
    if (filters.userGroups?.length) count++;
    if (filters.createdBy?.length) count++;
    if (filters.prReviewers?.length) count++;
    if (filters.qaAssigned?.length) count++;
    if (filters.dueDateStart !== undefined || filters.dueDateEnd !== undefined) count++;
    if (filters.createdDateStart !== undefined || filters.createdDateEnd !== undefined) count++;
    if (filters.tags?.length) count++;
    if (filters.stages?.length) count++;
    if (filters.dynamicFields && Object.keys(filters.dynamicFields).length > 0) {
      count += Object.keys(filters.dynamicFields).length;
    }
    return count;
  };

  const getActiveFilterCount = getMoreFiltersActiveCount() + getFilterAssigneeCount();

  const hasActiveFilters = getActiveFilterCount > 0;
  const hasActiveFiltersOrGroupBy =
    hasActiveFilters || (groupBy !== undefined && groupBy !== 'none');
  const hasMoreFiltersActive = getMoreFiltersActiveCount() > 0;
  const hasAssigneeFilter = getFilterAssigneeCount() > 0;

  const handleClearAllFilters = useCallback((): void => {
    onFiltersChange({});
  }, [onFiltersChange]);

  // Serialize current filters (excluding boards) into config values rows
  const filtersToValues = useCallback((): {
    id: string;
    entityName: SavedConfigEntityName;
    fieldName: string;
    fieldValue: string;
  }[] => {
    const values: {
      id: string;
      entityName: SavedConfigEntityName;
      fieldName: string;
      fieldValue: string;
    }[] = [];
    const addTicket = (fieldName: string, fieldValue: string) =>
      values.push({
        id: uuidv4(),
        entityName: SavedConfigEntityName.TICKET,
        fieldName,
        fieldValue,
      });
    const addFormEntity = (fieldName: string, fieldValue: string) =>
      values.push({
        id: uuidv4(),
        entityName: SavedConfigEntityName.FORM_ENTITY_VALUE,
        fieldName,
        fieldValue,
      });

    for (const key of ARRAY_FILTER_KEYS) {
      (filters[key] as string[] | undefined)?.forEach(v => addTicket(key, v));
    }
    for (const key of NUMERIC_FILTER_KEYS) {
      const v = filters[key];
      if (v !== undefined) addTicket(key, String(v));
    }
    if (filters.dynamicFields) {
      Object.entries(filters.dynamicFields).forEach(([fieldId, val]) => {
        if (Array.isArray(val)) {
          val.forEach(v => addFormEntity(fieldId, v));
        } else {
          if (val.start !== undefined) addFormEntity(`${fieldId}.start`, String(val.start));
          if (val.end !== undefined) addFormEntity(`${fieldId}.end`, String(val.end));
        }
      });
    }
    if (groupBy && groupBy !== 'none') addTicket('__groupBy', groupBy);
    return values;
  }, [filters, groupBy]);

  const handleSaveView = useCallback((): void => {
    if (!viewName.trim() || !selectedBoard) return;
    setIsSaving(true);
    const name = viewName.trim();
    setShowSavePopover(false);
    setViewName('');
    setIsPublic(false);

    const run = async (): Promise<void> => {
      try {
        const result = zero.mutate(
          mutators.savedUserConfiguration.create({
            id: uuidv4(),
            name,
            contextType: SavedConfigContextType.BOARD,
            contextId: selectedBoard.id,
            channelId: channelId ?? '',
            visibility: isPublic ? SavedConfigVisibility.PUBLIC : SavedConfigVisibility.PRIVATE,
            timestamp: Date.now(),
            values: filtersToValues(),
          }),
        );
        const res = await result.server;
        if (res.type === 'error') {
          toast.error(res.error?.message ?? 'Failed to save view');
        } else {
          toast.success('View saved');
        }
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to save view');
      } finally {
        setIsSaving(false);
      }
    };
    void run();
  }, [viewName, selectedBoard, channelId, isPublic, filtersToValues, zero]);

  const handleMenuItemClick = (category: string): void => {
    const newActiveSubmenu = activeSubmenu === category ? null : category;
    setActiveSubmenu(newActiveSubmenu);
  };

  const renderSubmenu = (): ReactElement | null => {
    if (!activeSubmenu) return null;

    switch (activeSubmenu) {
      case 'boards':
        return (
          <BoardSubmenu
            selectedBoards={filters.boards || []}
            onChange={(boards: string[]) => handleFilterChange('boards', boards)}
            onClose={() => setActiveSubmenu(null)}
            boards={allBoardsList ?? []}
          />
        );
      case 'priority':
        return (
          <PrioritySubmenu
            selectedPriorities={filters.priority || []}
            onChange={(priorities: TicketPriority[]) => handleFilterChange('priority', priorities)}
            availablePriorities={availablePriorities || []}
          />
        );
      case 'assignee':
        return (
          <UserSubmenu
            selectedUsers={filters.assignee || []}
            onChange={(users: string[]) => handleFilterChange('assignee', users)}
            label='Assignee'
            availableUsers={availableUsers || []}
          />
        );
      case 'userGroups':
        return (
          <UserGroupSubmenu
            selectedGroups={filters.userGroups || []}
            onChange={(groups: string[]) => handleFilterChange('userGroups', groups)}
            onClose={() => setActiveSubmenu(null)}
            availableUserGroups={availableUserGroups || []}
          />
        );
      case 'prReviewers':
        return (
          <UserSubmenu
            selectedUsers={filters.prReviewers || []}
            onChange={(users: string[]) => handleFilterChange('prReviewers', users)}
            label='PR Reviewer'
            availableUsers={availableUsers || []}
          />
        );
      case 'qaAssigned':
        return (
          <UserSubmenu
            selectedUsers={filters.qaAssigned || []}
            onChange={(users: string[]) => handleFilterChange('qaAssigned', users)}
            label='QA'
            availableUsers={availableUsers || []}
          />
        );
      case 'createdBy':
        return (
          <UserSubmenu
            selectedUsers={filters.createdBy || []}
            onChange={(users: string[]) => handleFilterChange('createdBy', users)}
            label='Created by'
            availableUsers={availableUsers || []}
          />
        );
      case 'dueDate': {
        const dueDateRange: DateRange = {};
        if (filters.dueDateStart !== undefined) dueDateRange.start = filters.dueDateStart;
        if (filters.dueDateEnd !== undefined) dueDateRange.end = filters.dueDateEnd;
        return (
          <DateRangeSubmenu
            dateRange={dueDateRange}
            onChange={(dateRange: DateRange) => handleDateRangeChange(dateRange, false)}
            onClose={() => setActiveSubmenu(null)}
            label='Due Date'
            allowFutureDates={true}
          />
        );
      }
      case 'createdAt': {
        const createdDateRange: DateRange = {};
        if (filters.createdDateStart !== undefined)
          createdDateRange.start = filters.createdDateStart;
        if (filters.createdDateEnd !== undefined) createdDateRange.end = filters.createdDateEnd;
        return (
          <DateRangeSubmenu
            dateRange={createdDateRange}
            onChange={(dateRange: DateRange) => handleDateRangeChange(dateRange, true)}
            onClose={() => setActiveSubmenu(null)}
            label='Created At'
          />
        );
      }
      case 'tags':
        return (
          <TagsSubmenu
            selectedTags={filters.tags || []}
            onChange={(tags: string[]) => handleFilterChange('tags', tags)}
            availableTags={availableTags || []}
          />
        );
      case 'stages':
        return (
          <StagesSubmenu
            selectedStages={filters.stages || []}
            onChange={(stages: string[]) => handleFilterChange('stages', stages)}
            availableStages={availableStages ?? []}
          />
        );
      default:
        // Handle dynamic fields
        if (activeSubmenu.startsWith('dynamic-')) {
          const fieldId = activeSubmenu.replace('dynamic-', '');
          // Find the field across all form mappings
          let field: FormFields | undefined;
          for (const mapping of formMappings || []) {
            // Type assertion needed because Zero ORM doesn't auto-infer related fields
            const fields = (mapping as unknown as { formFields?: FormFields[] }).formFields;
            field = fields?.find((f: FormFields) => f.id === fieldId);
            if (field) break;
          }

          if (field) {
            const currentValue = filters.dynamicFields?.[fieldId] as
              | string[]
              | { start?: number; end?: number }
              | undefined;

            return (
              <DynamicFieldSubmenu
                fieldId={fieldId}
                fieldName={field.fieldName}
                fieldType={field.fieldType}
                fieldEnum={field.fieldEnum as string[] | null}
                selectedValue={currentValue}
                onChange={value =>
                  handleDynamicFieldChange(
                    fieldId,
                    value as string[] | { start?: number; end?: number },
                  )
                }
                onClose={() => setActiveSubmenu(null)}
              />
            );
          }
        }
        return null;
    }
  };

  return (
    <div className={`relative flex  flex-col w-full ${className}`}>
      <div className='w-max'>
        <Popover.Root open={boardOpen} onOpenChange={handleBoardDropdownOpenChange}>
          <Popover.Trigger asChild>
            <Button
              variant='ghost'
              onClick={() => handleBoardDropdownOpenChange(!boardOpen)}
              className={cn('rounded-[10px] mb-3')}
              data-track-category='Tickets'
              data-track-name='ToggleBoardDropdown'
            >
              <span className='font-semibold text-base'>
                {isTicketsSyncing ? 'Loading tickets' : boardLabel}
              </span>
              {isTicketsSyncing && <Loader2 className='w-4 h-4 animate-spin' />}
              <ChevronDown
                className={cn(
                  'w-5 h-5 transition-transform font-semibold',
                  boardOpen && 'rotate-180',
                )}
              />
            </Button>
          </Popover.Trigger>

          <Popover.Content
            side='bottom'
            align='start'
            sideOffset={6}
            className='z-[60] min-w-[220px] bg-background border border-border rounded-lg shadow-lg'
          >
            <BoardSubmenu
              selectedBoards={filters.boards || []}
              onChange={(boards: string[]) => handleFilterChange('boards', boards)}
              onClose={() => setBoardOpen(false)}
              boards={allBoardsList ?? []}
            />
          </Popover.Content>
        </Popover.Root>
      </div>
      <div className='flex flex-wrap items-center gap-2 sm:gap-3'>
        {!hideAssigneeFilter && (
          <Popover.Root open={assigneeOpen} onOpenChange={setAssigneeOpen}>
            <Popover.Trigger asChild>
              <Button
                variant='outline'
                size='sm'
                className='rounded-[10px] border-border hover:bg-muted'
              >
                <div className='flex items-center gap-1.5'>
                  <User className='w-3 h-3 p-px font-medium' />
                  <span className='font-medium'>Assignee</span>
                  {hasAssigneeFilter && <span className='w-1.5 h-1.5 rounded-full bg-blue-500' />}
                  <ChevronDown
                    className={cn(
                      'w-3 h-3 ml-1 transition-transform',
                      assigneeOpen && 'rotate-180',
                    )}
                  />
                </div>
              </Button>
            </Popover.Trigger>
            <Popover.Content
              side='bottom'
              align='start'
              sideOffset={6}
              className='z-[60] min-w-[200px] bg-background border border-border rounded-lg shadow-lg'
            >
              <UserSubmenu
                selectedUsers={filters.assignee || []}
                onChange={(users: string[]) => handleFilterChange('assignee', users)}
                label='Assignee'
                availableUsers={availableUsers || []}
              />
            </Popover.Content>
          </Popover.Root>
        )}
        <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
          <Popover.Trigger asChild>
            <Button
              variant='outline'
              size='sm'
              className={cn(hasActiveFilters ? 'border-border' : '', 'rounded-[10px]')}
              data-testid='more-filters-btn'
            >
              <div className='flex items-center gap-1.5'>
                <ListFilter className='w-3 h-3 font-medium' />
                <span className='font-medium'>More Filters</span>
                {hasMoreFiltersActive && <span className='w-1.5 h-1.5 rounded-full bg-blue-500' />}
              </div>
            </Button>
          </Popover.Trigger>

          <Popover.Content
            side='bottom'
            align='start'
            sideOffset={6}
            className='w-56 bg-background border border-border rounded-lg shadow-lg z-50 max-h-[400px] overflow-y-auto'
            onInteractOutside={e => {
              // Prevent closing when clicking on the submenu
              if (
                submenuRef.current &&
                e.target instanceof Node &&
                submenuRef.current.contains(e.target)
              ) {
                e.preventDefault();
              } else {
                // Close submenu when clicking outside
                setActiveSubmenu(null);
              }
            }}
          >
            <div className='py-1'>
              {allFilterItems
                .filter(
                  item =>
                    (item.id !== 'boards' || showBoardsFilter) &&
                    (item.id !== 'stages' || selectedBoards.length > 0),
                )
                .map(item => {
                  const Icon = item.icon;
                  const isActive = activeSubmenu === item.id;
                  return (
                    <button
                      key={item.id}
                      ref={el => {
                        menuItemRefs.current[item.id] = el;
                      }}
                      onClick={() => handleMenuItemClick(item.id)}
                      className={cn(
                        'w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-muted',
                        isActive ? 'bg-muted font-medium' : '',
                      )}
                      data-track-category='Tickets'
                      data-track-name='OpenFilterSubmenu'
                      data-track-metadata={JSON.stringify({
                        filterId: item.id,
                        filterLabel: item.label,
                      })}
                      data-testid={`filter-menu-${item.id}`}
                    >
                      <div className='flex items-center gap-3'>
                        <Icon className='w-4 h-4' />
                        <span>{item.label}</span>
                        {isFilterActive(item) && (
                          <span className='w-1.5 h-1.5 rounded-full bg-blue-500' />
                        )}
                      </div>
                      <ChevronRight className='w-4 h-4 text-muted-foreground' />
                    </button>
                  );
                })}
            </div>
          </Popover.Content>
          {activeSubmenu && menuItemRefs.current[activeSubmenu] && (
            <div
              ref={submenuRef}
              className='fixed z-[60]'
              style={{
                left: (menuItemRefs.current[activeSubmenu]?.getBoundingClientRect().right || 0) + 4,
                top: menuItemRefs.current[activeSubmenu]?.getBoundingClientRect().top || 0,
              }}
            >
              {renderSubmenu()}
            </div>
          )}
        </Popover.Root>
        {/* Analytics Dashboard Button */}
        {canViewAnalytics && (
          <Button
            variant='outline'
            className='bg-background border border-border rounded-[10px] h-8'
            onClick={() => void navigate('/analytics-dashboard')}
            data-track-category='Tickets'
            data-track-name='OpenAnalyticsDashboard'
          >
            <BarChart3 className='w-4 h-4' />
            <span>Analytics</span>
          </Button>
        )}

        {/* Clear Filters Button */}
        {hasActiveFilters && (
          <Button
            variant='outline'
            className='bg-background border border-border rounded-[10px] h-8'
            onClick={handleClearAllFilters}
            data-track-category='Tickets'
            data-track-name='ClearAllFiltersDropdown'
            data-testid='clear-filters-btn'
          >
            <X className='w-4 h-4' />
            <span>Clear Filters</span>
          </Button>
        )}

        {/* Save View Button — shown when a specific board is selected and filters are active */}
        {selectedBoard && hasActiveFiltersOrGroupBy && !hasActiveView && !isMobile && (
          <Popover.Root
            open={showSavePopover}
            onOpenChange={open => {
              setShowSavePopover(open);
              if (!open) {
                setViewName('');
                setIsPublic(false);
              }
            }}
          >
            <Popover.Trigger asChild>
              <Button
                variant='outline'
                className='bg-background border border-border rounded-[10px] h-8'
                data-track-category='Tickets'
                data-track-name='OpenSaveViewPopover'
              >
                <span className='text-foreground'>Save view</span>
              </Button>
            </Popover.Trigger>
            <Popover.Content
              side='bottom'
              align='end'
              sideOffset={6}
              className='z-[60] w-72 bg-popover border border-border rounded-xl shadow-lg p-4 flex flex-col gap-4'
            >
              <input
                type='text'
                placeholder='Name this view'
                value={viewName}
                data-track-category='saved-views'
                data-track-name='view-name-input'
                onChange={e => setViewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && viewName.trim()) handleSaveView();
                }}
                className='w-full text-sm border-0 border-b border-border focus:outline-none focus:border-border pb-1 placeholder-muted-foreground'
              />
              <div className='flex items-center justify-between'>
                <Switch
                  checked={isPublic}
                  onCheckedChange={setIsPublic}
                  label='Public'
                  id='save-view-public-toggle'
                />
                <div className='flex items-center gap-1'>
                  <button
                    data-track-category='saved-views'
                    data-track-name='cancel-save-view'
                    onClick={() => setShowSavePopover(false)}
                    className='text-sm font-medium text-foreground px-2 h-8'
                  >
                    Cancel
                  </button>
                  <button
                    data-track-category='saved-views'
                    data-track-name='confirm-save-view'
                    onClick={handleSaveView}
                    disabled={!viewName.trim() || isSaving}
                    className='text-sm font-semibold px-4 h-8 rounded-[8px] bg-sidebar-badge-accent text-white disabled:opacity-50 disabled:cursor-not-allowed'
                  >
                    Save
                  </button>
                </div>
              </div>
            </Popover.Content>
          </Popover.Root>
        )}

        {/* ticket search */}
        <div className=' w-full max-w-56'>
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground' />
            <input
              ref={inputRef}
              type='text'
              placeholder='Search Tickets'
              value={searchValue ?? ''}
              onChange={e => {
                if (onSearchChange) {
                  onSearchChange(e.target.value);
                }
              }}
              className='w-full text-sm bg-background border border-border text-foreground rounded-lg pl-10 pr-3 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500'
              aria-label='Search Tickets'
              data-track-category='Tickets'
              data-track-name='SearchTickets'
            />
          </div>
        </div>
      </div>
    </div>
  );
};
