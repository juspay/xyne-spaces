import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useZero } from '../../hooks/useZero';
import { toast } from 'sonner';
import { useAuth } from '../../hooks/useAuth';
import { useCanCreateTicket } from '../../hooks/usePermissions';
import { usePlatform } from '../../hooks/usePlatform';
import { useRouteContext } from '../../hooks/useRouteContext';
import {
  Plus,
  List,
  SquareKanban,
  Settings2,
  ChevronDownIcon,
  ChevronRight,
  User,
  Calendar,
  CircleCheckBig,
  Vote,
  Tag,
  CheckIcon,
  X,
  Clock,
  TextAlignJustify,
  BarChart3,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
} from '@dnd-kit/core';
import { TicketCard } from '../../components/Tickets/TicketCard/TicketCard';
import { TicketFiltersDropdown } from '../../components/Tickets/TicketFilters';
import { CreateTicketModal } from '../../components/Tickets/CreateTicketModal/CreateTicketModal';
import { useMachine } from '@xstate/react';
import { ticketFiltersMachine } from '../../machines/ticketFiltersMachine';
import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';
import { KanbanColumns } from '../../components/Tickets/KanbanColumns/KanbanColumns';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import { useChannel, useGetChannelUserStatus } from '../../hooks/useChannels';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import type { Ticket, FormEntityValues } from '@xyne/shared';
import { TicketStatusV2, FormFieldType } from '@xyne/shared';
import type { Stage } from './KanbanBoardScreen.types';
import {
  getStageColor,
  getStatusColumns,
  filterTicketsByBoard,
  createTagsByTicketIdMap,
  groupTicketsByStage,
  groupTicketsByStatus,
  applyTicketFilters,
  groupTicketsByFormField,
  extractGroupableFormFields,
} from './KanbanBoardScreen.utils';
import { TicketTable } from '../../components/Tickets/TicketTable/TicketTable';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Tooltip from '../../components/ui/Tooltip';
import Avatar from '../../components/ui/Avatar/Avatar';
import { getPriorityIcon } from '../../components/Tickets/TicketCard/TicketCard.utils';
import { TicketPriority } from '@xyne/shared';
import AcOnSlow from '../../assets/icons/AcOnSlowIcon';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useUsers } from '../../hooks/useUsers';
import { useUserGroups } from '../../hooks/useUserGroup';
import { stateMachineActor } from '../../machines/stateMachine';

interface BoardKanbanScreenProps {
  viewMode?: 'my-tickets' | `user-tickets` | 'group-tickets';
  channelId?: string;
  filterByUserId?: string;
  filterByGroupId?: string;
}

type GroupByType = 'none' | 'assignee' | 'status' | 'priority' | FormFieldGroup;

interface FormFieldGroup {
  type: 'formField';
  fieldId: string;
  fieldName: string;
  fieldType: FormFieldType;
}

function isFormFieldGroup(value: GroupByType): value is FormFieldGroup {
  return (
    typeof value === 'object' && value !== null && 'type' in value && value.type === 'formField'
  );
}

const KanbanBoardScreen: React.FC<BoardKanbanScreenProps> = ({
  viewMode: viewModeProp,
  channelId,
  filterByUserId,
  filterByGroupId,
}) => {
  const { projectId: projectIdParam, boardId } = useParams<{
    projectId?: string;
    boardId?: string;
  }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isMobile } = usePlatform();
  const { baseRoute, buildChannelRoute } = useRouteContext();
  const canCreateTicket = useCanCreateTicket(); // Check ticket permissions
  const zero = useZero();
  const isDraggingRef = useRef(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [localTickets, setLocalTickets] = useState<Ticket[]>([]);
  const [groupBy, setGroupBy] = useState<GroupByType>('none');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const channel = useChannel(channelId || '');
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(['assignee', 'dueDate', 'status', 'priority', 'tags']),
  );
  const [isComfortView, setIsComfortView] = useState(false);
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Dynamic grouping options based on form fields
  const groupTickets = (tickets: Ticket[], criterion: GroupByType) => {
    if (criterion === 'none') {
      return { 'All Tickets': tickets };
    }

    // Handle form field grouping
    if (isFormFieldGroup(criterion)) {
      return groupTicketsByFormField(tickets, criterion, formValuesByTicketId, userNamesById);
    }

    // Original logic for assignee, status, priority
    return tickets.reduce(
      (acc, ticket) => {
        const key =
          criterion === 'assignee'
            ? (ticket.assignedTo ?? 'Unassigned')
            : criterion === 'status'
              ? ticket.statusV2
              : (ticket.priority ?? 'No Priority');

        (acc[key] ??= []).push(ticket);
        return acc;
      },
      {} as Record<string, Ticket[]>,
    );
  };

  const toggleGroupExpansion = (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  // available columns
  const availableColumns = [
    { key: 'assignee', label: 'Assignee', icon: <User className='h-4 w-4' /> },
    { key: 'dueDate', label: 'Due Date', icon: <Calendar className='h-4 w-4' /> },
    { key: 'status', label: 'Status', icon: <CircleCheckBig className='h-4 w-4' /> },
    { key: 'priority', label: 'Priority', icon: <Vote className='h-4 w-4' /> },
    { key: 'tags', label: 'Tags', icon: <Tag className='h-4 w-4' /> },
    { key: 'stage', label: 'Sub-status', icon: <CircleCheckBig className='h-4 w-4' /> },
    { key: 'createdAt', label: 'Created At', icon: <Clock className='h-4 w-4' /> },
    { key: 'createdBy', label: 'Created By', icon: <User className='h-4 w-4' /> },
  ];

  const handleColumnVisibilityChange = (columnKey: string, isVisible: boolean) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (isVisible) {
        next.add(columnKey);
      } else {
        next.delete(columnKey);
      }
      return next;
    });
  };

  // Determine view mode based on URL params or prop
  const viewMode = useMemo(() => {
    if (viewModeProp === 'my-tickets') return 'my-tickets'; // Show user's tickets
    if (boardId && projectIdParam) return 'board'; // Show specific board
    if (projectIdParam || channel) return 'project'; // Show all boards in project
    if (viewModeProp === 'user-tickets') return 'user-tickets'; // Show specific user's tickets
    if (viewModeProp === 'group-tickets') return 'group-tickets'; // Show specific group's tickets
    return 'all'; // Show all projects
  }, [viewModeProp, projectIdParam, boardId, channel]);

  // Get user's channel status for selectedBoardId persistence
  const channelUserStatus = useGetChannelUserStatus(channelId || '') as
    | { selectedBoardId?: string }
    | undefined;
  const selectedBoardIdFromDb: string | undefined = channelUserStatus?.selectedBoardId;

  // Use XState machine for filter persistence
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, send] = useMachine(ticketFiltersMachine);
  const layoutView = searchParams.get('layout') ?? 'kanban';

  // Initialize machine on mount or when dependencies change
  useEffect(() => {
    send({
      type: 'INIT',
      channelId,
      projectId: projectIdParam,
      boardId: boardId,
      viewMode: viewMode,
      enabled: true,
      selectedBoardIdFromDb,
      searchParams,
      setSearchParams,
    });
  }, [
    send,
    channelId,
    projectIdParam,
    boardId,
    viewMode,
    selectedBoardIdFromDb,
    searchParams,
    setSearchParams,
  ]);

  // Sync URL changes to machine (browser back/forward)
  useEffect(() => {
    if (state.value === 'initialized') {
      send({
        type: 'URL_CHANGED',
        searchParams,
      });
    }
  }, [searchParams, send, state.value]);

  // Extract filters and viewType from machine context
  const filters = state.context.filters;
  const channelViewType = state.context.viewType;

  // Automatically show Board column when "All Boards" is selected
  useEffect(() => {
    const isAllBoardsSelected = !filters.boards || filters.boards.length === 0;

    if (isAllBoardsSelected && channelId && viewMode === 'project') {
      // Add "board" column when All Boards is selected
      setVisibleColumns(prev => {
        if (!prev.has('board')) {
          const next = new Set(prev);
          next.add('board');
          return next;
        }
        return prev;
      });
    } else {
      // Remove "board" column when a specific board is selected
      setVisibleColumns(prev => {
        if (prev.has('board')) {
          const next = new Set(prev);
          next.delete('board');
          return next;
        }
        return prev;
      });
    }
  }, [filters.boards, channelId, viewMode]);

  // Wrapper functions to send events to machine
  const setFilters = useCallback(
    (nextFilters: TicketFilters) => {
      send({
        type: 'SET_FILTERS',
        filters: nextFilters,
      });

      // Persist selected board to DB for channel views
      if (channelId && viewMode === 'project') {
        const selectedBoardId = nextFilters.boards?.[0] ?? null;
        const currentBoardId = filters.boards?.[0] ?? null;
        if (selectedBoardId !== currentBoardId) {
          void zero.mutate(
            mutators.channel.updateSelectedBoardId({
              channelId,
              boardId: selectedBoardId,
            }),
          );
        }
      }
    },
    [send, channelId, viewMode, filters.boards, zero],
  );

  // Setup sensors for drag and drop
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor),
  );

  // Fetch board details (only when boardId is present)
  const [ticketsForAll] = useCachedQuery(queries.allTickets());

  // Determine effective project ID
  const effectiveProjectId = projectIdParam || channel?.projectId || ticketsForAll?.[0]?.projectId;

  // Determine if we should show board-wise view or stage-based grouping
  const shouldShowBoardWiseView = useMemo(() => {
    // Multiple boards selected in filter
    if (filters.boards && filters.boards.length > 1) {
      return true;
    }
    return false;
  }, [filters.boards]);

  // Fetch stages for filtered single board (when exactly one board is in filter)
  const filteredSingleBoardId = useMemo(() => {
    if (filters.boards && filters.boards.length === 1) {
      return filters.boards[0];
    }
    return null;
  }, [filters.boards]);

  // Get all boards for the project (needed for channel stage view and create ticket modal)
  // In my-tickets/user-tickets/group-tickets, fetch ALL boards (no project filter) since tickets can span projects
  const isMyTicketsView =
    viewMode === 'my-tickets' || viewMode === 'user-tickets' || viewMode === 'group-tickets';

  const [allBoardsGlobal] = useCachedQuery(queries.getAllBoards(), {
    enabled: isMyTicketsView,
  });

  const [allBoardsProject] = useCachedQuery(
    queries.boardsByProject({ projectId: effectiveProjectId || '' }),
    {
      enabled: !isMyTicketsView && !!effectiveProjectId,
    },
  );

  const allBoards = isMyTicketsView ? allBoardsGlobal : allBoardsProject;

  // Create memo of form fields eligible for grouping (SINGLE_SELECT, MULTI_SELECT, USER)
  const groupByFormFields = useMemo(
    () => extractGroupableFormFields(filters, allBoards),
    [filters.boards, allBoards],
  );

  // Dynamic grouping options based on form fields
  const groupingOptions = useMemo(() => {
    const baseOptions = [
      {
        value: 'assignee' as const,
        label: 'Group by: Assignee',
        icon: <User className='h-4 w-4' />,
      },
      {
        value: 'status' as const,
        label: 'Group by: Status',
        icon: <CircleCheckBig className='h-4 w-4' />,
      },
      {
        value: 'priority' as const,
        label: 'Group by: Priority',
        icon: <Vote className='h-4 w-4' />,
      },
    ];

    const formFieldOptions = groupByFormFields.map(field => ({
      value: {
        type: 'formField' as const,
        fieldId: field.id,
        fieldName: field.fieldName,
        fieldType: field.fieldType,
      },
      label: `Group by: ${field.fieldName}`,
      icon:
        field.fieldType === FormFieldType.USER ? (
          <User className='h-4 w-4' />
        ) : (
          <BarChart3 className='h-4 w-4' />
        ),
    }));

    return [...baseOptions, ...formFieldOptions];
  }, [groupByFormFields]);

  const stagesDataForFilteredBoard = useMemo(
    () => allBoards.find(b => b.id === filteredSingleBoardId)?.stages,
    [allBoards, filteredSingleBoardId],
  );

  const selectedBoard = useMemo(() => {
    if (filters.boards?.length === 1 && allBoards) {
      return allBoards.find(b => b.id === filters.boards![0]);
    }
    return null;
  }, [filters.boards, allBoards]);

  // Aggregate stages/columns based on view mode and board filter
  const stages = useMemo<Stage[]>(() => {
    // Check if "All Boards" is selected (no board filter)
    const isAllBoardsSelected = !filters.boards || filters.boards.length === 0;

    // If "All Boards" is selected, always use status columns
    if (isAllBoardsSelected && channelId && viewMode === 'project') {
      return getStatusColumns();
    }

    // If multiple boards selected, use status-based columns
    if (shouldShowBoardWiseView) {
      return getStatusColumns();
    }

    // If single board selected in filter, use its stages
    if (
      filteredSingleBoardId &&
      stagesDataForFilteredBoard &&
      stagesDataForFilteredBoard.length > 0
    ) {
      const uniqueStagesMap = new Map<string, Stage>();
      stagesDataForFilteredBoard.forEach(stage => {
        const stageName = stage.name;
        if (!uniqueStagesMap.has(stageName)) {
          uniqueStagesMap.set(stageName, {
            id: stageName.toLowerCase().replace(/\s+/g, '_'),
            name: stageName,
            color: getStageColor(stageName),
          });
        }
      });
      return Array.from(uniqueStagesMap.values());
    }

    // For channel tickets: check view type (status vs stage)
    if (channelId && viewMode === 'project') {
      if (
        channelViewType === 'stage' &&
        stagesDataForFilteredBoard &&
        stagesDataForFilteredBoard.length > 0
      ) {
        // Aggregate unique stages from all boards in the channel's project
        // Deduplicate by normalized ID to prevent duplicate columns
        const uniqueStagesById = new Map<string, Stage>();

        stagesDataForFilteredBoard.forEach(stage => {
          const stageName = stage.name.trim();
          const normalizedId = stageName.toLowerCase().replace(/\s+/g, '_');

          // Only add if we haven't seen this ID before (prevents duplicate columns)
          if (!uniqueStagesById.has(normalizedId)) {
            uniqueStagesById.set(normalizedId, {
              id: normalizedId,
              name: stageName,
              color: getStageColor(stageName),
            });
          }
        });

        const stagesArray = Array.from(uniqueStagesById.values());
        // If no stages found, return default stages
        return stagesArray.length > 0
          ? stagesArray
          : [
              { id: 'backlog', name: 'Backlog', color: '#9CA3AF' },
              { id: 'todo', name: 'To Do', color: '#3B82F6' },
              { id: 'in_progress', name: 'In Progress', color: '#F59E0B' },
              { id: 'review', name: 'Review', color: '#8B5CF6' },
              { id: 'completed', name: 'Completed', color: '#10B981' },
            ];
      } else {
        // Status view for channel tickets
        return getStatusColumns();
      }
    }

    // For project, all, and my-tickets views, use status-based columns
    if (
      viewMode === 'project' ||
      viewMode === 'all' ||
      viewMode === 'my-tickets' ||
      viewMode === 'user-tickets' ||
      viewMode === 'group-tickets'
    ) {
      return getStatusColumns();
    }

    // For board view, use stage-based columns
    if (
      viewMode === 'board' &&
      stagesDataForFilteredBoard &&
      stagesDataForFilteredBoard.length > 0
    ) {
      // Create unique stages by name
      const uniqueStagesMap = new Map<string, Stage>();
      stagesDataForFilteredBoard.forEach(stage => {
        const stageName = stage.name;
        if (!uniqueStagesMap.has(stageName)) {
          uniqueStagesMap.set(stageName, {
            id: stageName.toLowerCase().replace(/\s+/g, '_'),
            name: stageName,
            color: getStageColor(stageName),
          });
        }
      });
      return Array.from(uniqueStagesMap.values());
    }

    // Default stages for board view
    return [
      { id: 'backlog', name: 'Backlog', color: '#9CA3AF' },
      { id: 'todo', name: 'To Do', color: '#3B82F6' },
      { id: 'in_progress', name: 'In Progress', color: '#F59E0B' },
      { id: 'review', name: 'In Review', color: '#8B5CF6' },
      { id: 'done', name: 'Done', color: '#10B981' },
    ];
  }, [
    viewMode,
    shouldShowBoardWiseView,
    filteredSingleBoardId,
    stagesDataForFilteredBoard,
    channelId,
    channelViewType,
    allBoards,
    effectiveProjectId,
    filters.boards,
  ]);

  const projectIdForQuery =
    (viewMode === 'project' || viewMode === 'board') && effectiveProjectId
      ? effectiveProjectId
      : undefined;

  const ticketsForProject = useMemo(
    () => ticketsForAll.filter(ticket => ticket.projectId === projectIdForQuery),
    [ticketsForAll, projectIdForQuery],
  );

  // Get ALL tickets (unfiltered) for calculating available filter options
  const allProjectTickets = useMemo(() => {
    if (viewMode === 'board') {
      return filterTicketsByBoard(ticketsForProject, boardId);
    }
    if (viewMode === 'project') {
      return ticketsForProject || [];
    }
    if (viewMode === 'my-tickets') {
      return (ticketsForAll || []).filter(
        ticket => ticket.assignedTo === `user:${user?.id}` || ticket.assignedTo === `${user?.id}`,
      );
    }
    if (viewMode === 'user-tickets' && filterByUserId) {
      return (ticketsForAll || []).filter(
        ticket =>
          ticket.assignedTo === `user:${filterByUserId}` ||
          ticket.assignedTo === `${filterByUserId}`,
      );
    }
    if (viewMode === 'group-tickets' && filterByGroupId) {
      return (ticketsForAll || []).filter(
        ticket =>
          ticket.userGroupId === `group:${filterByGroupId}` ||
          ticket.userGroupId === `${filterByGroupId}`,
      );
    }
    return ticketsForAll || [];
  }, [
    viewMode,
    ticketsForProject,
    ticketsForAll,
    boardId,
    user?.id,
    filterByUserId,
    filterByGroupId,
  ]);

  // Calculate available priorities, users, and user groups from ALL project tickets (not filtered)
  // Return undefined if tickets haven't loaded yet to prevent filtering out all options
  const availablePriorities = useMemo(() => {
    if (!allProjectTickets || allProjectTickets.length === 0) return undefined;
    const uniquePriorities = new Set(allProjectTickets.map(ticket => ticket.priority));
    return Array.from(uniquePriorities);
  }, [allProjectTickets]);

  const availableUsers = useMemo(() => {
    if (!allProjectTickets || allProjectTickets.length === 0) return undefined;
    const userIds = new Set<string>();
    allProjectTickets.forEach(ticket => {
      if (ticket.assignedTo) {
        userIds.add(ticket.assignedTo);
      }
      userIds.add(ticket.createdBy);
      // Collect from ticket.assignments (PR reviewers, QA, etc.)
      const assignments = (ticket as Ticket & { assignments?: Array<{ userId: string }> })
        .assignments;
      if (Array.isArray(assignments)) {
        assignments.forEach(assignment => {
          if (assignment.userId) {
            userIds.add(assignment.userId);
          }
        });
      }
    });
    return Array.from(userIds);
  }, [allProjectTickets]);

  const availableUserGroups = useMemo(() => {
    if (!allProjectTickets || allProjectTickets.length === 0) return undefined;
    const groups = allProjectTickets
      .map(ticket => ticket.userGroupId)
      .filter((id): id is string => id !== null);
    return Array.from(new Set(groups));
  }, [allProjectTickets]);

  // Get available board IDs based on view mode
  const availableBoards = useMemo(() => {
    // For my-tickets/user-tickets/group-tickets, get boards from the filtered tickets
    if (isMyTicketsView) {
      if (!allProjectTickets || allProjectTickets.length === 0) return undefined;
      const boardIds = allProjectTickets
        .map(ticket => ticket.boardId)
        .filter((id): id is string => id !== null);
      return Array.from(new Set(boardIds));
    }
    // For other views, use boards from the project
    if (!allBoards || allBoards.length === 0) return undefined;
    return allBoards.map(board => board.id);
  }, [allBoards, allProjectTickets, viewMode, filters]);

  // Clear invalid board filters in my-tickets/user-tickets/group-tickets views
  useEffect(() => {
    if (isMyTicketsView) {
      // If there's a board filter set but it doesn't match any available boards, clear it
      if (
        filters.boards &&
        filters.boards.length > 0 &&
        availableBoards &&
        availableBoards.length > 0
      ) {
        const validBoards = filters.boards.filter(boardId => availableBoards.includes(boardId));

        // If none of the filtered boards are valid, clear the filter
        if (validBoards.length === 0) {
          setFilters({
            ...filters,
            boards: [],
          });
        }
        // If some but not all are valid, update to only valid ones
        else if (validBoards.length !== filters.boards.length) {
          setFilters({
            ...filters,
            boards: validBoards,
          });
        }
      }
    }
  }, [viewMode, filters.boards, availableBoards, filters, setFilters]);

  const [allTags] = useCachedQuery(queries.getAllTicketTags());
  const allUsers = useUsers();
  const allUserGroups = useUserGroups();

  // Fetch all form entity values (cached and used across all boards)
  const [allFormEntityValues] = useCachedQuery(queries.getAllFormEntityValues());

  const tagsByTicketId = useMemo(() => {
    return createTagsByTicketIdMap(allTags);
  }, [allTags]);

  // Create map of form entity values by ticket ID and field info by field ID
  const { formValuesByTicketId, formFieldsById } = useMemo(() => {
    const valuesMap = new Map<string, FormEntityValues[]>();
    const fieldsMap = new Map<string, { fieldType: FormFieldType; fieldEnum?: string[] | null }>();

    if (allFormEntityValues) {
      allFormEntityValues.forEach(value => {
        if (!valuesMap.has(value.entityId)) {
          valuesMap.set(value.entityId, []);
        }
        valuesMap.get(value.entityId)!.push(value);

        // Store field info from the related formField
        if (value.formField && !fieldsMap.has(value.fieldId)) {
          fieldsMap.set(value.fieldId, {
            fieldType: value.formField.fieldType,
            fieldEnum: value.formField.fieldEnum as string[] | null,
          });
        }
      });
    }

    return { formValuesByTicketId: valuesMap, formFieldsById: fieldsMap };
  }, [allFormEntityValues]);

  // Filter tickets based on view mode and filters
  const filteredTickets = useMemo(() => {
    let tickets = applyTicketFilters(
      allProjectTickets,
      filters,
      tagsByTicketId,
      formValuesByTicketId,
      formFieldsById,
    );

    // Apply search filter
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase().trim();
      tickets = tickets.filter(ticket => {
        const searchableText = [
          ticket.title || '',
          ticket.description || '',
          ticket.xyneId || '',
          ticket.merchantId || '',
          ticket.statusV2 || '',
          ticket.priority || '',
        ]
          .join(' ')
          .toLowerCase();

        return searchableText.includes(searchLower);
      });
    }

    // Hide Rejected tickets when viewing stage view across all contexts
    const isStageView =
      // Channel stage view
      (channelId && viewMode === 'project' && channelViewType === 'stage') ||
      // Board view (always stage view)
      viewMode === 'board' ||
      // Single board filtered (stage view)
      !!filteredSingleBoardId ||
      // My-tickets board/stage view
      viewMode === 'my-tickets';

    if (isStageView) {
      tickets = tickets.filter(ticket => ticket.statusV2 !== TicketStatusV2.CANCELLED);
    }

    return tickets;
  }, [
    allProjectTickets,
    filters,
    channelId,
    viewMode,
    channelViewType,
    filteredSingleBoardId,
    tagsByTicketId,
    formValuesByTicketId,
    formFieldsById,
    searchTerm,
  ]);

  useEffect(() => {
    if (!isDraggingRef.current && filteredTickets) {
      setLocalTickets(filteredTickets); // 🔄 SYNC!
    }
  }, [filteredTickets]);

  const availableTags = useMemo(() => {
    if (!allTags || allTags.length === 0) return undefined;
    const uniqueTags = new Set(allTags.map(tag => tag.name));
    return Array.from(uniqueTags).sort();
  }, [allTags]);

  useEffect(() => {
    if (!isDraggingRef.current && filteredTickets) {
      const ids = filteredTickets.map(t => t.id);
      stateMachineActor.send({ type: 'SET_FILTERED_TICKET_IDS', ids });
    }
  }, [filteredTickets]);

  // Create a map of user ID to user name for display
  const userNamesById = useMemo(() => {
    const map = new Map<string, string>();
    if (allUsers) {
      allUsers.forEach(user => {
        map.set(user.id, user.name || user.email || 'Unknown User');
      });
    }
    return map;
  }, [allUsers]);

  // Create a map of user group ID to group name for display
  const groupNamesById = useMemo(() => {
    const map = new Map<string, string>();
    if (allUserGroups) {
      allUserGroups.forEach(group => {
        map.set(group.id, group.name || 'Unknown Group');
      });
    }
    return map;
  }, [allUserGroups]);

  // Use drag and drop hook
  const dragDropMode = useMemo(() => {
    // For channel tickets: use view type to determine mode
    if (channelId && viewMode === 'project') {
      return channelViewType === 'stage' ? 'stage' : 'status';
    }
    // For other views
    return viewMode === 'board' || filteredSingleBoardId ? 'stage' : 'status';
  }, [channelId, viewMode, channelViewType, filteredSingleBoardId]);

  const { activeTicket, handleDragStart, handleDragEnd } = useDragAndDrop({
    localTickets,
    setLocalTickets,
    zero,
    stages,
    mode: dragDropMode,
  });

  useEffect(() => {
    isDraggingRef.current = !!activeTicket;
  }, [activeTicket]);

  // Handle navigation for ticket click
  const handleTicketClick = useCallback(
    (ticket: Ticket) => {
      const currentUrl = window.location.pathname + window.location.search;

      // On mobile: navigate directly to ThreadMessages route with details tab
      // On desktop: use tab-based route for expanded view in ConversationPannel
      if (isMobile) {
        void navigate(
          `${baseRoute}/${ticket.channelId}/${ticket.conversationId}/${ticket.id}?selectedTab=details`,
          {
            state: {
              fromMyTickets: false,
              returnToUrl: currentUrl,
            },
          },
        );
      } else {
        void navigate(
          buildChannelRoute(ticket.channelId, {
            tab: 'tickets',
            ticketId: ticket.id,
            conversationId: ticket.conversationId,
          }),
          {
            state: {
              fromMyTickets: false,
              returnToUrl: currentUrl,
            },
          },
        );
      }
    },
    [navigate, channel, isMobile, baseRoute, buildChannelRoute],
  );

  // Handle ticket creation success
  const handleTicketCreated = useCallback(
    (ticket: { id: string; conversationId?: string }) => {
      if (!channel) return;

      toast.success('Ticket created successfully', {
        action: {
          label: 'View Details',
          onClick: () => {
            void navigate(
              buildChannelRoute(channel.id, {
                tab: 'tickets',
                ticketId: ticket.id,
                conversationId: ticket.conversationId || '',
              }),
            );
          },
        },
        duration: 5000,
      });
    },
    [navigate, channel, buildChannelRoute],
  );

  // Get first board for create ticket modal
  const firstBoardId = useMemo(() => {
    if (boardId) return boardId;
    if (allBoards && allBoards.length > 0) return allBoards[0]?.id || null;
    return null;
  }, [boardId, allBoards]);

  const processedGroups = useMemo(() => {
    const groupedRows = groupTickets(localTickets, groupBy);
    const shouldGroupByStatus =
      (!filteredSingleBoardId && ['project', 'all', 'my-tickets'].includes(viewMode)) ||
      (channelId && viewMode === 'project' && channelViewType !== 'stage');

    const entries = Object.entries(groupedRows);

    return entries.map(([groupName, groupTickets]) => {
      const ticketsByColumn = shouldGroupByStatus
        ? groupTicketsByStatus(groupTickets, stages)
        : groupTicketsByStage(groupTickets, stages);

      // Get display name based on group type
      let displayName = groupName;
      let entityType: 'user' | 'group' | null = null;
      let entityId: string | null = null;
      let priority: TicketPriority | null = null;

      // If grouping by assignee, use user name instead of ID
      if (groupBy === 'assignee' && groupName !== 'Unassigned') {
        // assignedTo can be "user:${userId}" or "group:${groupId}"
        const isUser = groupName.startsWith('user:');
        const isGroup = groupName.startsWith('group:') || groupName.startsWith('userGroup:');
        const extractedEntityId = groupName.replace(/^(user:|group:|userGroup:)/, '');

        if (isUser) {
          entityType = 'user';
          entityId = extractedEntityId;
          displayName = userNamesById.get(extractedEntityId) || extractedEntityId;
        } else if (isGroup) {
          entityType = 'group';
          entityId = extractedEntityId;
          displayName = groupNamesById.get(extractedEntityId) || extractedEntityId;
        } else {
          entityType = 'user';
          entityId = extractedEntityId;
          displayName = userNamesById.get(extractedEntityId) || extractedEntityId;
        }
      } else if (groupBy === 'priority' && groupName !== 'No Priority') {
        // Store the priority value for icon rendering
        priority = groupName as TicketPriority;
        displayName = groupName.charAt(0).toUpperCase() + groupName.slice(1).toLowerCase();
      } else {
        // For other grouping types, just clean up the display name
        displayName = groupName
          .replace('user:', '')
          .replace('group:', '')
          .replace('Unassigned', 'Unassigned');
      }

      return {
        key: groupName,
        displayName,
        count: groupTickets.length,
        allTickets: groupTickets,
        columnData: ticketsByColumn,
        entityType,
        entityId,
        priority,
      };
    });
  }, [
    localTickets,
    groupBy,
    stages,
    filteredSingleBoardId,
    viewMode,
    channelId,
    channelViewType,
    userNamesById,
    groupNamesById,
  ]);

  // Auto-expand the first group when groups change
  useEffect(() => {
    if (processedGroups.length > 0 && groupBy !== 'none') {
      setExpandedGroups(new Set([processedGroups[0]!.key]));
    }
  }, [processedGroups, groupBy]);

  const filteredAvailableColumns = useMemo(() => {
    if (layoutView === 'table') {
      // In table mode, hide TicketCard metadata columns
      return availableColumns.filter(
        col => !['stage', 'board', 'createdAt', 'createdBy'].includes(col.key),
      );
    }
    return availableColumns.filter(col => col.key !== 'status');
  }, [layoutView, availableColumns]);

  return (
    <div className='flex flex-col h-full w-full bg-gray-50 relative'>
      {/* Header */}
      <div className='flex flex-col lg:flex-row flex-wrap lg:flex-nowrap lg:items-center justify-between px-4 py-3 bg-white flex-shrink-0 gap-3'>
        {/* Filters - Left Side */}
        {(effectiveProjectId || viewMode === 'my-tickets') && (
          <div className='flex-1 min-w-0'>
            <TicketFiltersDropdown
              filters={filters}
              onFiltersChange={setFilters}
              projectId={
                isMyTicketsView
                  ? '' // Don't filter by project in my-tickets - tickets can span multiple projects
                  : effectiveProjectId || ''
              }
              availablePriorities={availablePriorities}
              availableUsers={availableUsers}
              availableUserGroups={availableUserGroups}
              availableBoards={availableBoards}
              allBoardsList={allBoards}
              showBoardsFilter={!!channelId || isMyTicketsView}
              selectedBoard={selectedBoard}
              availableTags={availableTags}
              hideAssigneeFilter={viewMode === 'my-tickets' ? true : false}
              formMappings={
                filters.boards?.length === 1 && allBoardsProject
                  ? allBoardsProject.find(b => b.id === filters.boards?.[0])?.formContextMappings ||
                    []
                  : []
              }
              onSearchChange={setSearchTerm}
            />
          </div>
        )}

        {/* Create Ticket Button - Right Side */}
        <div className='flex lg:flex-col md:items-end gap-3 ml-auto md:ml-0'>
          {canCreateTicket && channel && (
            <button
              data-testid='kanban-create-ticket-button'
              onClick={() => setIsCreateModalOpen(true)}
              className='flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-sidebar-badge-accent rounded-lg transition-colors flex-shrink-0'
            >
              <Plus className='w-4 h-4' />
              <span className='hidden sm:inline font-semibold text-sm'>Create Ticket</span>
              <span className='sm:hidden'>Create</span>
            </button>
          )}
          {/* Layout View Toggle */}
          <div className='flex items-center gap-2'>
            <div className='flex items-center rounded-xl bg-[#F9F9F9] border'>
              <Tooltip content='Kanban'>
                <button
                  onClick={() => {
                    setSearchParams(prev => {
                      const p = new URLSearchParams(prev);
                      p.set('layout', 'kanban');
                      return p;
                    });
                  }}
                  className={`px-3 py-2 rounded-l-xl transition-colors border-r ${
                    layoutView === 'kanban'
                      ? 'bg-white text-gray-900'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title='Kanban View'
                >
                  <SquareKanban className='w-3.5 h-3.5' />
                </button>
              </Tooltip>
              <Tooltip content='Table'>
                <button
                  onClick={() => {
                    setSearchParams(prev => {
                      const p = new URLSearchParams(prev);
                      p.set('layout', 'table');
                      return p;
                    });
                  }}
                  className={`px-3 py-2 rounded-r-xl transition-colors ${
                    layoutView === 'table'
                      ? 'bg-white text-gray-900'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title='Table View'
                >
                  <List className='w-3.5 h-3.5' />
                </button>
              </Tooltip>
            </div>

            <DropdownMenu.Root open={isCustomizeOpen} onOpenChange={setIsCustomizeOpen}>
              <DropdownMenu.Trigger>
                <Tooltip content='Customize View'>
                  <button
                    className='flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-all outline-none focus:ring-2 focus:ring-gray-200 shadow-sm'
                    title='Configure Columns'
                  >
                    <Settings2 className='w-3.5 h-3.5 text-gray-600' />
                    <span className='sr-only'>Columns</span>
                  </button>
                </Tooltip>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align='end'
                  sideOffset={8}
                  className='z-50 min-w-[250px] bg-white border border-gray-200 rounded-lg shadow-xl animate-in fade-in zoom-in-95'
                >
                  <div className='mb-1 border-b flex items-center justify-between px-4 py-3'>
                    <span className='text-sm font-bold tracking-wide'>Customise view</span>
                    <button
                      onClick={() => setIsCustomizeOpen(false)}
                      className='cursor-pointer hover:bg-gray-100 rounded p-1 transition-colors'
                    >
                      <X className='w-3.5 h-3.5' />
                    </button>
                  </div>

                  {layoutView === 'table' && (
                    <div className='px-4 py-3 border-b border-gray-50'>
                      <div className='flex items-center justify-between gap-2 rounded-lg bg-[#F9F9F9] p-1 shadow-inner'>
                        <button
                          onClick={() => setIsComfortView(true)}
                          className={`flex flex-1 flex-col items-center gap-1 rounded-md px-4 py-2 
            transition hover:bg-gray-100 focus:outline-none 
            ${isComfortView ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                        >
                          <AcOnSlow className='h-4 w-4' />
                          <span className='text-[13px] font-medium tracking-tight'>
                            Comfortable
                          </span>
                        </button>

                        <button
                          onClick={() => setIsComfortView(false)}
                          className={`flex flex-1 flex-col items-center gap-1 rounded-md px-4 py-2 
            transition hover:bg-white hover:text-gray-900
            ${!isComfortView ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                        >
                          <TextAlignJustify className='h-4 w-4' />
                          <span className='text-[13px] tracking-tight'>Compact</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {filteredAvailableColumns.map(column => (
                    <DropdownMenu.CheckboxItem
                      key={column.key}
                      className='relative flex items-center justify-between py-3 px-4 text-sm text-gray-700 rounded-lg cursor-pointer outline-none select-none
                     data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900 transition-colors'
                      checked={visibleColumns.has(column.key)}
                      onCheckedChange={checked => handleColumnVisibilityChange(column.key, checked)}
                      onSelect={e => e.preventDefault()}
                    >
                      <div className='flex items-center gap-3'>
                        <span className='text-gray-600 group-data-[highlighted]:text-gray-600 h-3 w-3'>
                          {column.icon}
                        </span>
                        <span className='font-medium text-sm'>{column.label}</span>
                      </div>
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          visibleColumns.has(column.key)
                            ? 'bg-sidebar-badge-accent border'
                            : 'border-gray-300 bg-white'
                        }`}
                      >
                        {visibleColumns.has(column.key) && (
                          <CheckIcon className='w-3 h-3 text-white stroke-[3]' />
                        )}
                      </div>
                    </DropdownMenu.CheckboxItem>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className='flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-sm font-medium outline-none hover:bg-gray-50 transition-all min-w-[160px]'>
                  <div className='flex items-center gap-2 flex-1'>
                    <span className='text-gray-500 font-normal'>Group by:</span>
                    {typeof groupBy === 'object' && groupBy.type === 'formField'
                      ? groupBy.fieldName
                      : groupingOptions
                          .find(opt => typeof opt.value === 'string' && opt.value === groupBy)
                          ?.label.replace('Group by: ', '') || 'None'}
                  </div>
                  <ChevronDownIcon className='w-3.5 h-3.5 text-gray-400' />
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align='end'
                  sideOffset={8}
                  className='z-50 min-w-[220px] p-1 bg-white border border-gray-200 rounded-lg flex flex-col gap-1 shadow-xl animate-in fade-in zoom-in-95'
                >
                  {/* Matching Header Style */}
                  <div className='mb-1 border-b flex items-center justify-between px-4 py-3'>
                    <span className='text-sm font-bold tracking-wide'>Group by</span>
                    {groupBy !== 'none' && (
                      <DropdownMenu.Item
                        className='outline-none'
                        aria-label='Clear grouping'
                        onSelect={() => {
                          setGroupBy('none');
                        }}
                      >
                        <div className='cursor-pointer hover:bg-gray-100 rounded p-1 transition-colors'>
                          <X className='w-3.5 h-3.5' />
                        </div>
                      </DropdownMenu.Item>
                    )}
                  </div>

                  {/* Grouping Options */}
                  {groupingOptions.map(({ value, label, icon }) => (
                    <DropdownMenu.CheckboxItem
                      key={typeof value === 'object' ? `formField-${value.fieldId}` : value}
                      className='relative flex items-center gap-2 justify-between py-3 px-4 text-sm rounded-xl text-gray-700 cursor-pointer outline-none select-none
      transition-colors
      data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900
      data-[state=checked]:bg-[#F2F2F3] data-[state=checked]:text-black data-[state=checked]:font-semibold'
                      checked={
                        typeof value === 'string'
                          ? groupBy === value
                          : typeof groupBy === 'object' &&
                            groupBy.type === 'formField' &&
                            groupBy.fieldId === value.fieldId
                      }
                      onCheckedChange={() => setGroupBy(value as GroupByType)}
                    >
                      <div className='flex items-center gap-3'>
                        <span className='text-gray-600 group-data-[highlighted]:text-gray-600 h-3 w-3'>
                          {icon}
                        </span>
                        <span className='font-medium'>{label.replace('Group by: ', '')}</span>
                      </div>
                    </DropdownMenu.CheckboxItem>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>

      {/* Board-wise View for my-tickets, channel stage view, or multiple boards filter */}
      {/* Board-wise View */}
      {layoutView === 'table' ? (
        <div className='flex-1 overflow-y-auto p-4 space-y-4 bg-white pb-14'>
          {processedGroups.map(group => {
            const isExpanded = expandedGroups.has(group.key);
            const showGroupHeader = groupBy !== 'none';
            return (
              <div
                key={group.key}
                className='flex flex-col rounded-lg border border-gray-200 overflow-hidden'
              >
                {showGroupHeader && (
                  <button
                    onClick={() => toggleGroupExpansion(group.key)}
                    className={`flex items-center gap-3 px-4 py-3 bg-[#F7F7F8] transition-colors w-full text-left ${isExpanded ? 'border-b border-gray-200' : 'border-none'} `}
                  >
                    {isExpanded ? (
                      <ChevronDownIcon className='w-4 h-4 text-gray-500 flex-shrink-0' />
                    ) : (
                      <ChevronRight className='w-4 h-4 text-gray-500 flex-shrink-0' />
                    )}
                    <div className='flex items-center gap-4 flex-1'>
                      <div className='flex items-center gap-2'>
                        {/* Show avatar for user assignees */}
                        {group.entityType === 'user' && group.entityId && (
                          <Avatar userId={group.entityId} size='sm' className='rounded-md' />
                        )}
                        {/* Show group icon for group assignees */}
                        {group.entityType === 'group' && (
                          <div className='w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0'>
                            <User className='w-3 h-3 text-gray-600' />
                          </div>
                        )}
                        {/* Show priority icon when grouping by priority */}
                        {group.priority && (
                          <div className='flex items-center justify-center'>
                            {getPriorityIcon(group.priority)}
                          </div>
                        )}
                        <h3 className='font-semibold text-gray-700 capitalize  text-sm'>
                          {group.displayName}
                        </h3>
                      </div>
                      <span className='text-xs font-medium bg-white text-gray-600 px-2 py-0.5 rounded-lg'>
                        {group.count}
                      </span>
                    </div>
                  </button>
                )}

                {(isExpanded || !showGroupHeader) && (
                  <div>
                    <TicketTable
                      tickets={group.allTickets}
                      ticketTags={tagsByTicketId}
                      projectId={effectiveProjectId || ''}
                      visibleColumns={visibleColumns}
                      selectedBoardIds={filters.boards || []}
                      isComfortView={isComfortView}
                      onBoardFilterChange={newBoardIds => {
                        setFilters({
                          ...filters,
                          boards: newBoardIds,
                        });
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Accordion-style Kanban View */
        <div
          className={`flex-1 min-h-0 overflow-auto relative ${groupBy !== 'none' ? 'p-4' : 'p-0'}`}
        >
          <DndContext
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            sensors={sensors}
          >
            <div className='h-full flex flex-col space-y-5 mb-12'>
              {processedGroups.map(group => {
                const isExpanded = expandedGroups.has(group.key);
                const showGroupHeader = groupBy !== 'none';
                return (
                  <div key={group.key} className={isExpanded || !showGroupHeader ? 'h-full' : ''}>
                    {showGroupHeader && (
                      <button
                        onClick={() => toggleGroupExpansion(group.key)}
                        className={`flex items-center gap-3 p-4 bg-[#F0F0F0] hover:bg-gray-200 transition-colors sticky left-0 z-10 w-full text-left border-b border-gray-200 ${isExpanded ? 'rounded-t-lg ' : 'rounded-lg'}`}
                      >
                        {isExpanded ? (
                          <ChevronDownIcon className='w-4 h-4 text-gray-500' />
                        ) : (
                          <ChevronRight className='w-4 h-4 text-gray-500' />
                        )}
                        <div className='flex items-center gap-4'>
                          <div className='flex items-center gap-2'>
                            {/* Show avatar for user assignees */}
                            {group.entityType === 'user' && group.entityId && (
                              <Avatar userId={group.entityId} size='sm' className='rounded-lg' />
                            )}
                            {/* Show group icon for group assignees */}
                            {group.entityType === 'group' && (
                              <div className='w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0'>
                                <User className='w-3 h-3 text-gray-600' />
                              </div>
                            )}
                            {/* Show priority icon when grouping by priority */}
                            {group.priority && (
                              <div className='flex items-center justify-center'>
                                {getPriorityIcon(group.priority)}
                              </div>
                            )}
                            <h3 className='font-semibold text-gray-700 capitalize  text-sm'>
                              {group.displayName}
                            </h3>
                          </div>
                          <span className='text-xs font-medium bg-white text-gray-600 px-2 py-0.5 rounded-lg'>
                            {group.count}
                          </span>
                        </div>
                      </button>
                    )}

                    {/* Only show Kanban columns if expanded OR if no grouping is applied */}
                    {(isExpanded || !showGroupHeader) && (
                      <div
                        className={showGroupHeader ? 'h-[calc(100vh-300px)] bg-white' : 'h-full'}
                      >
                        <KanbanColumns
                          stages={stages}
                          ticketsByStage={group.columnData}
                          tagsByTicketId={tagsByTicketId}
                          onTicketClick={handleTicketClick}
                          visibleColumns={visibleColumns}
                          availableTags={availableTags || []}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <DragOverlay>
              {activeTicket && (
                <TicketCard
                  ticket={activeTicket}
                  isCompact={true}
                  tags={tagsByTicketId.get(activeTicket.id) || []}
                  visibleColumns={visibleColumns}
                  availableTags={availableTags || []}
                />
              )}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {/* Create Ticket Modal */}
      {effectiveProjectId && channel && isCreateModalOpen && (
        <CreateTicketModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          channelId={channel.id}
          projectId={effectiveProjectId}
          selectedBoardId={firstBoardId}
          onTicketCreated={handleTicketCreated}
        />
      )}
    </div>
  );
};

KanbanBoardScreen.displayName = 'KanbanBoardScreen';

export default KanbanBoardScreen;
