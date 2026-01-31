import { ReactElement, useState, useRef, useMemo, useEffect } from 'react';
import {
  ListFilter,
  ChevronRight,
  BarChart3,
  User,
  Users,
  Calendar,
  ChevronDown,
  BarChart4Icon,
  Tag,
  FileText,
  Hash,
  ToggleLeft,
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
import type { TicketPriority, FormFields } from '@xyne/shared';
import { FormContextType, FormEntityType, FormFieldType } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import * as Popover from '@radix-ui/react-popover';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useNavigate } from 'react-router-dom';

interface FilterMenuItem {
  id: string;
  label: string;
  icon: typeof BarChart3;
  filterKey: string; // Can be keyof TicketFilters, date range identifiers, or dynamic field paths
  // For dynamic fields
  isDynamic?: boolean;
  fieldType?: FormFieldType;
  fieldEnum?: string[] | null;
  boardName?: string;
}

const FILTER_MENU_ITEMS: FilterMenuItem[] = [
  { id: 'userGroups', label: 'User Groups', icon: Users, filterKey: 'userGroups' },
  { id: 'createdBy', label: 'Created by', icon: User, filterKey: 'createdBy' },
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
}: TicketFiltersProps): ReactElement => {
  const [boardOpen, setBoardOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const menuItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const selectedBoards = useMemo(() => filters.boards || [], [filters.boards]);
  const navigate = useNavigate();

  // Close submenu when main popover closes
  useEffect(() => {
    if (!isOpen) {
      setActiveSubmenu(null);
    }
  }, [isOpen]);

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

  // Determine which boards to fetch form mappings for
  const boardIdsForFormMappings = useMemo(() => {
    // If specific boards are selected, use them
    if (selectedBoards.length > 0) {
      return selectedBoards;
    }
    // If "All Boards" is selected, use all available boards
    return availableBoards || [];
  }, [selectedBoards, availableBoards]);

  // Fetch form mappings for selected or all boards
  const [formMappings] = useCachedQuery(
    queries.getFormMappingsByContextIds({
      contextIds: boardIdsForFormMappings,
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    }),
    { enabled: boardIdsForFormMappings.length > 0 },
  );

  // Generate dynamic filter menu items from form fields
  // Aggregate all form fields from selected boards, deduplicating by field ID
  const dynamicFilterItems = useMemo(() => {
    if (!formMappings || formMappings.length === 0) return [];

    // Create board name lookup
    const boardNameMap = new Map<string, string>();
    allBoardsList?.forEach(board => {
      boardNameMap.set(board.id, board.name);
    });

    // Check if showing multiple boards
    const isMultipleBoards = boardIdsForFormMappings.length > 1;

    // Collect all unique form fields by field ID with board info
    const fieldsMap = new Map<string, { field: FormFields; boardId: string }>();
    formMappings.forEach(mapping => {
      const mappingWithFields = mapping as unknown as {
        formFields?: FormFields[];
        contextId: string;
      };
      const fields = mappingWithFields.formFields;
      const boardId = mappingWithFields.contextId;

      fields?.forEach((field: FormFields) => {
        // Use field ID as key to ensure uniqueness
        if (!fieldsMap.has(field.id)) {
          fieldsMap.set(field.id, { field, boardId });
        }
      });
    });

    return Array.from(fieldsMap.values()).map(({ field, boardId }) => {
      const boardName = boardNameMap.get(boardId);
      const label =
        isMultipleBoards && boardName ? `${field.fieldName} \u00b7 ${boardName}` : field.fieldName;

      return {
        id: `dynamic-${field.id}`,
        label,
        icon: getIconForFieldType(field.fieldType),
        filterKey: `dynamicFields.${field.id}`,
        isDynamic: true,
        fieldType: field.fieldType,
        fieldEnum: field.fieldEnum as string[] | null,
        boardName: isMultipleBoards ? boardName : undefined,
      };
    });
  }, [formMappings, allBoardsList, boardIdsForFormMappings]);

  // Combine static and dynamic filters
  const allFilterItems = useMemo(() => {
    return [...FILTER_MENU_ITEMS, ...dynamicFilterItems];
  }, [dynamicFilterItems]);

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

  const getActiveFilterCount = (): number => {
    let count = 0;
    if (filters.boards?.length) count++;
    if (filters.priority?.length) count++;
    if (filters.assignee?.length) count++;
    if (filters.userGroups?.length) count++;
    if (filters.createdBy?.length) count++;
    if (filters.dueDateStart !== undefined || filters.dueDateEnd !== undefined) count++;
    if (filters.createdDateStart !== undefined || filters.createdDateEnd !== undefined) count++;
    if (filters.tags?.length) count++;
    if (filters.dynamicFields && Object.keys(filters.dynamicFields).length > 0) {
      count += Object.keys(filters.dynamicFields).length;
    }
    return count;
  };

  const hasActiveFilters = getActiveFilterCount() > 0;

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
    <div className={`relative flex  flex-col sm:w-max ${className}`}>
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
      <div className='flex flex-wrap px-1 sm:items-center gap-1 sm:gap-3'>
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
                        {item.boardName ? (
                          <span>
                            <span>{item.label.split(' · ')[0]}</span>
                            <span className='text-gray-400 mx-1'>·</span>
                            <span className='text-gray-400 font-normal'>{item.boardName}</span>
                          </span>
                        ) : (
                          <span>{item.label}</span>
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
      </div>
    </div>
  );
};
