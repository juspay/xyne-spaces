import { ReactElement, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { Button } from '../../ui/Button';
import {
  PrioritySubmenu,
  UserSubmenu,
  UserGroupSubmenu,
  DateRangeSubmenu,
  BoardSubmenu,
  TagsSubmenu,
  DynamicFieldSubmenu,
} from './Submenus';
import { TicketFiltersProps, DateRange } from './types';
import type { TicketFilters } from './types';
import { FormFieldType } from '@xyne/shared';
import type { TicketPriority, FormFields } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import * as Popover from '@radix-ui/react-popover';
import { useSearchMetrics } from '../../../hooks/useSearchMetrics';
import { TabType } from '../../Chat/ChatDirectory/ChannelCommandMenu.types';

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

const FILTER_MENU_ITEMS: FilterMenuItem[] = [
  { id: 'userGroups', label: 'User Groups', icon: Users, filterKey: 'userGroups' },
  { id: 'createdBy', label: 'Created by', icon: User, filterKey: 'createdBy' },
  { id: 'prReviewers', label: 'PR Reviewer', icon: User, filterKey: 'prReviewers' },
  { id: 'qaAssigned', label: 'QA', icon: User, filterKey: 'qaAssigned' },
  { id: 'dueDate', label: 'Due Date', icon: Calendar, filterKey: 'dueDate' },
  { id: 'createdAt', label: 'Created At', icon: Calendar, filterKey: 'createdAt' },
  { id: 'tags', label: 'Tags', icon: Tag, filterKey: 'tags' },
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
  allBoardsList,
  showBoardsFilter = false,
  selectedBoard,
  availableTags,
  hideAssigneeFilter = false,
  formMappings,
  onSearchChange,
}: TicketFiltersProps & { onSearchChange?: (searchTerm: string) => void }): ReactElement => {
  const [boardOpen, setBoardOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const menuItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

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
  // Remove all 'more filters' (dynamicFields and others except boards) when 'All Boards' is selected
  const selectedBoards = useMemo(() => {
    if (!filters.boards || filters.boards.length === 0) {
      // Only call onFiltersChange if any non-board filter is present
      const hasOtherFilters = !!(
        filters.priority?.length ||
        filters.assignee?.length ||
        filters.userGroups?.length ||
        filters.createdBy?.length ||
        filters.prReviewers?.length ||
        filters.qaAssigned?.length ||
        filters.dueDateStart !== undefined ||
        filters.dueDateEnd !== undefined ||
        filters.createdDateStart !== undefined ||
        filters.createdDateEnd !== undefined ||
        filters.tags?.length ||
        (filters.dynamicFields && Object.keys(filters.dynamicFields).length > 0)
      );
      if (hasOtherFilters) {
        onFiltersChange({ boards: [] });
      }
      return [];
    }
    return filters.boards;
  }, [filters]);

  // Close submenu when main popover closes
  useEffect(() => {
    if (!isOpen) {
      setActiveSubmenu(null);
    }
  }, [isOpen]);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { setActiveTab, setUseVespaSearch } = useSearchMetrics({ allChannels: [] });

  useEffect(() => {
    setActiveTab(TabType.TICKETS);
    setUseVespaSearch(false);
  }, [setActiveTab, setUseVespaSearch]);

  const boardLabel =
    selectedBoards.length === 0
      ? 'All Boards'
      : selectedBoards.length === 1 && selectedBoard
        ? selectedBoard.name
        : `${selectedBoards.length} Boards`;

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

  const getFilterPriorityCount = (): number => {
    let count = 0;
    if (filters.priority?.length) count++;
    return count;
  };

  const getMoreFiltersActiveCount = (): number => {
    let count = 0;
    // Excludes boards (auto-selected), assignee and priority (have their own indicators)
    if (filters.userGroups?.length) count++;
    if (filters.createdBy?.length) count++;
    if (filters.prReviewers?.length) count++;
    if (filters.qaAssigned?.length) count++;
    if (filters.dueDateStart !== undefined || filters.dueDateEnd !== undefined) count++;
    if (filters.createdDateStart !== undefined || filters.createdDateEnd !== undefined) count++;
    if (filters.tags?.length) count++;
    if (filters.dynamicFields && Object.keys(filters.dynamicFields).length > 0) {
      count += Object.keys(filters.dynamicFields).length;
    }
    return count;
  };

  const getActiveFilterCount =
    getMoreFiltersActiveCount() + getFilterAssigneeCount() + getFilterPriorityCount();

  const hasActiveFilters = getActiveFilterCount > 0;
  const hasMoreFiltersActive = getMoreFiltersActiveCount() > 0;
  const hasAssigneeFilter = getFilterAssigneeCount() > 0;
  const hasPriorityFilter = getFilterPriorityCount() > 0;

  const handleClearAllFilters = useCallback((): void => {
    onFiltersChange({});
  }, [onFiltersChange]);

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
            availableBoards={availableBoards}
            projectId={projectId}
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
        <Popover.Root open={boardOpen} onOpenChange={setBoardOpen}>
          <Popover.Trigger asChild>
            <Button
              variant='ghost'
              onClick={() => setBoardOpen(!boardOpen)}
              className={cn('rounded-[10px] mb-3')}
            >
              <span className='font-semibold text-base'>{boardLabel}</span>
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
            className='z-[60] min-w-[220px] bg-white border border-gray-200 rounded-lg shadow-lg'
          >
            <BoardSubmenu
              selectedBoards={filters.boards || []}
              onChange={(boards: string[]) => handleFilterChange('boards', boards)}
              onClose={() => setBoardOpen(false)}
              availableBoards={availableBoards}
              projectId={projectId}
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
                className='rounded-[10px] border-gray-200 hover:bg-gray-50'
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
              className='z-[60] min-w-[200px] bg-white border border-gray-200 rounded-lg shadow-lg'
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
        <Popover.Root open={priorityOpen} onOpenChange={setPriorityOpen}>
          <Popover.Trigger asChild>
            <Button
              variant='outline'
              size='sm'
              className='rounded-[10px] font-normal border-gray-200 hover:bg-gray-50'
            >
              <div className='flex items-center gap-1.5'>
                <BarChart4Icon className='w-3 h-3 p-px font-medium' />
                <span className='font-medium'>Priority</span>
                {hasPriorityFilter && <span className='w-1.5 h-1.5 rounded-full bg-blue-500' />}
                <ChevronDown
                  className={cn('w-4 h-4 ml-1 transition-transform', priorityOpen && 'rotate-180')}
                />
              </div>
            </Button>
          </Popover.Trigger>

          <Popover.Content
            side='bottom'
            align='start'
            sideOffset={6}
            className='z-[60] min-w-[180px] bg-white border border-gray-200 rounded-lg shadow-lg'
          >
            <PrioritySubmenu
              selectedPriorities={filters.priority || []}
              onChange={priorities => handleFilterChange('priority', priorities)}
              availablePriorities={availablePriorities || []}
            />
          </Popover.Content>
        </Popover.Root>
        <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
          <Popover.Trigger asChild>
            <Button
              variant='outline'
              size='sm'
              className={cn(hasActiveFilters ? 'border-gray-200' : '', 'rounded-[10px]')}
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
            className='w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-[400px] overflow-y-auto'
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
                .filter(item => item.id !== 'boards' || showBoardsFilter)
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
                        'w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-100',
                        isActive ? 'bg-gray-100 font-medium' : '',
                      )}
                    >
                      <div className='flex items-center gap-3'>
                        <Icon className='w-4 h-4' />
                        <span>{item.label}</span>
                        {isFilterActive(item) && (
                          <span className='w-1.5 h-1.5 rounded-full bg-blue-500' />
                        )}
                      </div>
                      <ChevronRight className='w-4 h-4 text-gray-400' />
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
        <Button
          variant='outline'
          className='bg-white border border-gray-200 rounded-[10px] h-8'
          onClick={() => void navigate('/analytics-dashboard')}
        >
          <BarChart3 className='w-4 h-4' />
          <span>Analytics</span>
        </Button>

        {/* Clear Filters Button */}
        {hasActiveFilters && (
          <Button
            variant='outline'
            className='bg-white border border-gray-200 rounded-[10px] h-8'
            onClick={handleClearAllFilters}
          >
            <X className='w-4 h-4' />
            <span>Clear Filters</span>
          </Button>
        )}

        {/* ticket search */}
        <div className=' w-full max-w-56'>
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400' />
            <input
              ref={inputRef}
              type='text'
              placeholder='Search Tickets'
              value={searchTerm}
              onChange={e => {
                const value = e.target.value;
                setSearchTerm(value);
                if (onSearchChange) {
                  onSearchChange(value);
                }
              }}
              className='w-full text-sm bg-white border border-gray-200 text-gray-900 rounded-lg pl-10 pr-3 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500'
              aria-label='Search Tickets'
            />
          </div>
        </div>
      </div>
    </div>
  );
};
