import React, { useState, useMemo, useCallback, useEffect, useRef, useDeferredValue } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { logger, Event } from '../../utils/logger';
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
import { CalendarView } from '../../components/Tickets/CalendarView';
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
import { StageFormModal } from '../../components/Tickets/StageFormModal/StageFormModal';
import { useMachine } from '@xstate/react';
import { ticketFiltersMachine } from '../../machines/ticketFiltersMachine';
import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';
import { KanbanColumns } from '../../components/Tickets/KanbanColumns/KanbanColumns';
import { useDragAndDrop } from '../../hooks/useDragAndDrop';
import { useChannel, useGetChannelUserStatus } from '../../hooks/useChannels';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import type { Ticket, FormEntityValues, TicketStageRequest, TicketAssignment } from '@xyne/shared';
import { TicketStatusV2, FormContextType, FormEntityType, FormFieldType } from '@xyne/shared';
import type { Stage } from './KanbanBoardScreen.types';
import {
  getStageColor,
  getStatusColumns,
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
import {
  getPriorityIcon,
  isStageEtaOverdue,
} from '../../components/Tickets/TicketCard/TicketCard.utils';
import { TicketPriority, SavedConfigVisibility, SavedConfigEntityName } from '@xyne/shared';
import AcOnSlow from '../../assets/icons/AcOnSlowIcon';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useUsers } from '../../hooks/useUsers';
import { useUserGroups } from '../../hooks/useUserGroup';
import { stateMachineActor } from '../../machines/stateMachine';
import { Dialog } from '../../components/ui/Dialog';
import Button from '../../components/ui/Button';
import { useZero } from '../../hooks/useZero';

function valuesToFilters(
  values: ReadonlyArray<{
    entityName: SavedConfigEntityName;
    fieldName: string;
    fieldValue: string;
  }>,
): TicketFilters {
  const result: TicketFilters = {};
  for (const { entityName, fieldName, fieldValue } of values) {
    if (entityName === SavedConfigEntityName.FORM_ENTITY_VALUE) {
      if (!result.dynamicFields) result.dynamicFields = {};
      if (fieldName.endsWith('.start')) {
        const fieldId = fieldName.slice(0, -'.start'.length);
        result.dynamicFields[fieldId] = {
          ...(result.dynamicFields[fieldId] as object | undefined),
          start: Number(fieldValue),
        };
      } else if (fieldName.endsWith('.end')) {
        const fieldId = fieldName.slice(0, -'.end'.length);
        result.dynamicFields[fieldId] = {
          ...(result.dynamicFields[fieldId] as object | undefined),
          end: Number(fieldValue),
        };
      } else {
        result.dynamicFields[fieldName] = [
          ...((result.dynamicFields[fieldName] as string[] | undefined) ?? []),
          fieldValue,
        ];
      }
      continue;
    }
    switch (fieldName) {
      case 'priority':
        result.priority = [...(result.priority ?? []), fieldValue as TicketPriority];
        break;
      case 'assignee':
        result.assignee = [...(result.assignee ?? []), fieldValue];
        break;
      case 'createdBy':
        result.createdBy = [...(result.createdBy ?? []), fieldValue];
        break;
      case 'userGroups':
        result.userGroups = [...(result.userGroups ?? []), fieldValue];
        break;
      case 'prReviewers':
        result.prReviewers = [...(result.prReviewers ?? []), fieldValue];
        break;
      case 'qaAssigned':
        result.qaAssigned = [...(result.qaAssigned ?? []), fieldValue];
        break;
      case 'tags':
        result.tags = [...(result.tags ?? []), fieldValue];
        break;
      case 'stages':
        result.stages = [...(result.stages ?? []), fieldValue];
        break;
      case 'dueDateStart':
        result.dueDateStart = Number(fieldValue);
        break;
      case 'dueDateEnd':
        result.dueDateEnd = Number(fieldValue);
        break;
      case 'createdDateStart':
        result.createdDateStart = Number(fieldValue);
        break;
      case 'createdDateEnd':
        result.createdDateEnd = Number(fieldValue);
        break;
    }
  }
  return result;
}

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

  // ── Latency instrumentation ──────────────────────────────────────────
  const mountTimeRef = useRef(performance.now());
  const latencySessionKeyRef = useRef('');
  const entityTimingsRef = useRef<Record<string, boolean>>({
    allProjectTickets: false,
    tags: false,
    formEntityValues: false,
    filteredTickets: false,
  });

  const logEntityTiming = (entityName: string): void => {
    // Lazy reset: when context changes, reset timings without a useEffect
    const sessionKey = `${viewMode}-${channelId}-${effectiveProjectId}`;
    if (latencySessionKeyRef.current !== sessionKey) {
      latencySessionKeyRef.current = sessionKey;
      mountTimeRef.current = performance.now();
      entityTimingsRef.current = {
        allProjectTickets: false,
        tags: false,
        formEntityValues: false,
        filteredTickets: false,
      };
    }
    const ref = entityTimingsRef.current;
    if (ref[entityName]) return;
    ref[entityName] = true;
    const elapsed = performance.now() - mountTimeRef.current;
    const ctx = { viewMode, channelId, projectId: effectiveProjectId };
    logger.info(Event.KANBAN_ENTITY_LOADED, { entity: entityName, latency: elapsed, ...ctx });
  };

  // ────────────────────────────────────────────────────────────────────
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
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);
  const [deleteViewConfirm, setDeleteViewConfirm] = useState<{
    configId: string;
    name: string;
    isPublic: boolean;
  } | null>(null);

  // Stage form modal state
  const [stageFormModal, setStageFormModal] = useState<{
    ticket: Ticket;
    targetStage: Stage;
    sourceStageName: string;
    formId: string;
    hasApprovers: boolean;
    existingRequest?: TicketStageRequest | null;
  } | null>(null);

  // Backward movement confirmation dialog state
  const [showBackwardConfirmDialog, setShowBackwardConfirmDialog] = useState(false);
  const [backwardStageChange, setBackwardStageChange] = useState<{
    stageName: string;
    fromSequenceNumber: number;
    newStatus?: TicketStatusV2;
    ticketId: string;
  } | null>(null);

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
    { key: 'status', label: 'Status Category', icon: <CircleCheckBig className='h-4 w-4' /> },
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
    return 'project'; // Default to project view
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
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const activeViewKey = `active-view-${state.context.storageKey}`;
  const hasRestoredActiveView = useRef<string | null>(null);

  const searchTerm = searchParams.get('search') ?? '';

  const setSearchTerm = (value: string) => {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set('search', value);
        } else {
          next.delete('search');
        }
        return next;
      },
      { replace: true },
    );
  };

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
  }, [send, channelId, projectIdParam, boardId, viewMode, selectedBoardIdFromDb]);

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
      // Deselect active saved view when user changes filters
      if (selectedViewId) {
        setSelectedViewId(null);
        try {
          sessionStorage.removeItem(activeViewKey);
        } catch (err) {
          console.error('Failed to remove active view from sessionStorage', err);
        }
      }

      // Clear stages filter when board changes since stages are board-specific
      const currentBoardId = filters.boards?.[0] ?? null;
      const newBoardId = nextFilters.boards?.[0] ?? null;
      if (currentBoardId !== newBoardId) {
        delete nextFilters.stages;
      }

      send({
        type: 'SET_FILTERS',
        filters: nextFilters,
      });

      // Persist selected board to DB for channel views
      if (channelId && viewMode === 'project') {
        const selectedBoardId = nextFilters.boards?.[0] ?? null;
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
    [send, channelId, viewMode, filters.boards, zero, selectedViewId, activeViewKey],
  );

  const handleSetGroupBy = useCallback(
    (value: GroupByType) => {
      if (selectedViewId) {
        setSelectedViewId(null);
        try {
          sessionStorage.removeItem(activeViewKey);
        } catch (err) {
          console.error('Failed to remove active view from sessionStorage', err);
        }
      }
      setGroupBy(value);
    },
    [selectedViewId, activeViewKey],
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

  // Determine effective project ID (must be before queries that depend on it)
  const effectiveProjectId = projectIdParam || channel?.projectId;

  // Determine if we should show board-wise view or stage-based grouping
  const shouldShowBoardWiseView = useMemo(() => {
    // Multiple boards selected in filter
    if (filters.boards && filters.boards.length > 1) {
      return true;
    }
    return false;
  }, [filters.boards]);

  // Fetch stages for filtered single board (when exactly one board is in filter)
  // In board view, the path param boardId IS the single board context
  const filteredSingleBoardId = useMemo(() => {
    if (viewMode === 'board' && boardId) return boardId;
    if (filters.boards && filters.boards.length === 1) return filters.boards[0];
    return null;
  }, [viewMode, boardId, filters.boards]);

  // Get all boards for the project (needed for channel stage view and create ticket modal)
  // In my-tickets/user-tickets/group-tickets, fetch ALL boards (no project filter) since tickets can span projects
  const isMyTicketsView =
    viewMode === 'my-tickets' || viewMode === 'user-tickets' || viewMode === 'group-tickets';

  // Fetch full board details only when a single board is selected
  const [selectedBoardDetail] = useCachedQuery(
    queries.boardDetailById({ boardId: filteredSingleBoardId || '' }),
    {
      enabled: !!filteredSingleBoardId,
    },
  );

  // Create memo of form fields eligible for grouping (SINGLE_SELECT, MULTI_SELECT, USER)
  // Uses selectedBoardDetail (lazily fetched when a single board is selected)
  const groupByFormFields = useMemo(
    () => extractGroupableFormFields(filters, selectedBoardDetail ? [selectedBoardDetail] : []),
    [filters.boards, selectedBoardDetail],
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
        label: 'Group by: Status Category',
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

  // Use stages from selectedBoardDetail (full board details) instead of lightweight allBoards
  const stagesDataForFilteredBoard = selectedBoardDetail?.stages;

  const savedViewsBoardId = filteredSingleBoardId;

  const [savedConfigs] = useCachedQuery(
    queries.savedConfigsByBoard({ boardId: savedViewsBoardId ?? '' }),
    { enabled: !!savedViewsBoardId },
  );

  // Restore selectedViewId from sessionStorage on refresh, once per activeViewKey
  useEffect(() => {
    if (state.value !== 'initialized' || !savedConfigs) return;
    if (hasRestoredActiveView.current === activeViewKey) return;
    hasRestoredActiveView.current = activeViewKey;
    try {
      const storedId = sessionStorage.getItem(activeViewKey);
      if (storedId && savedConfigs.some(c => c.id === storedId)) {
        setSelectedViewId(storedId);
      }
    } catch (err) {
      console.error('Failed to read active view from sessionStorage', err);
    }
  }, [state.value, savedConfigs, activeViewKey]);

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
          const formId =
            stage.formContextMappings?.find(
              (m: { contextType: FormContextType; entityType: FormEntityType; formId: string }) =>
                m.contextType === FormContextType.STAGE && m.entityType === FormEntityType.TICKET,
            )?.formId ?? null;
          uniqueStagesMap.set(stageName, {
            id: stage.id, // Use actual stage UUID
            name: stageName,
            color: getStageColor(stageName),
            sequenceNumber: stage.sequenceNumber,
            defaultTicketStatusV2: stage.defaultTicketStatusV2,
            formId,
            approvers: stage.approvers,
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
        // Deduplicate by name to prevent duplicate columns
        const uniqueStagesById = new Map<string, Stage>();

        stagesDataForFilteredBoard.forEach(stage => {
          const stageName = stage.name.trim();

          // Only add if we haven't seen this stage name before (prevents duplicate columns)
          if (!uniqueStagesById.has(stageName)) {
            const formId =
              stage.formContextMappings?.find(
                (m: { contextType: FormContextType; entityType: FormEntityType; formId: string }) =>
                  m.contextType === FormContextType.STAGE && m.entityType === FormEntityType.TICKET,
              )?.formId ?? null;
            uniqueStagesById.set(stageName, {
              id: stage.id, // Use actual stage UUID
              name: stageName,
              color: getStageColor(stageName),
              sequenceNumber: stage.sequenceNumber,
              defaultTicketStatusV2: stage.defaultTicketStatusV2,
              formId,
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
      }
      // Status view for channel tickets
      return getStatusColumns();
    }

    // For project and my-tickets views, use status-based columns
    if (
      viewMode === 'project' ||
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
          const formId =
            stage.formContextMappings?.find(
              (m: { contextType: FormContextType; entityType: FormEntityType; formId: string }) =>
                m.contextType === FormContextType.STAGE && m.entityType === FormEntityType.TICKET,
            )?.formId ?? null;
          uniqueStagesMap.set(stageName, {
            id: stage.id, // Use actual stage UUID
            name: stageName,
            color: getStageColor(stageName),
            sequenceNumber: stage.sequenceNumber,
            defaultTicketStatusV2: stage.defaultTicketStatusV2,
            formId,
            approvers: stage.approvers,
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
    effectiveProjectId,
    filters.boards,
  ]);

  // Determine if we're grouping by a form field — its fieldId must be fetched
  const groupByFieldId = isFormFieldGroup(groupBy) ? groupBy.fieldId : null;

  // Combined set of fieldIds whose FEV rows must be fetched:
  //   - dynamic field filter fieldIds: needed for client-side filter matching
  //   - groupByFieldId: needed so groupTicketsByFormField can read the value directly from the ticket
  const fevFieldIds = useMemo(() => {
    const ids = new Set<string>();
    // Add all dynamic field filter fieldIds
    if (filters.dynamicFields) {
      Object.keys(filters.dynamicFields).forEach(fieldId => ids.add(fieldId));
    }
    // Add groupBy fieldId if grouping by form field
    if (groupByFieldId) ids.add(groupByFieldId);
    return Array.from(ids);
  }, [filters.dynamicFields, groupByFieldId]);

  // CENTRALIZED TICKET QUERY - fetch only tickets relevant to the current context.
  // Dynamic field filtering is done CLIENT-SIDE via applyTicketFilters.
  // When fevFieldIds is non-empty, formEntityValues are fetched as a related query.
  const ticketsQueryParams = useMemo(() => {
    const params: {
      viewMode: 'project' | 'board' | 'my-tickets' | 'user-tickets' | 'group-tickets';
      projectId?: string;
      boardId?: string;
      userId?: string;
      groupId?: string;
      formEntityValueFieldIds?: string[];
    } = {
      viewMode: viewMode,
    };

    // Always pass boardId if it exists (from URL param)
    // Board ID implicitly scopes to project, so no need for projectId in this case
    if (boardId) {
      params.boardId = boardId;
    }

    // If a board is selected via filter, use that (overrides URL boardId if present)
    // BUT: Don't apply board filter in my-tickets view - let client-side filtering handle it
    // so that availableBoards shows all possible boards
    if (!isMyTicketsView && filters.boards && filters.boards.length === 1 && filters.boards[0]) {
      params.boardId = filters.boards[0];
    }

    // Pass projectId ONLY if:
    // 1. No boardId exists (boardId is more specific and implies project)
    // 2. viewMode is not 'my-tickets' (should be cross-project)
    if (!params.boardId && viewMode !== 'my-tickets' && effectiveProjectId) {
      params.projectId = effectiveProjectId;
    }

    // Pass user/group filters for specific viewModes
    if (viewMode === 'user-tickets' && filterByUserId) {
      params.userId = filterByUserId;
    } else if (viewMode === 'group-tickets' && filterByGroupId) {
      params.groupId = filterByGroupId;
    }

    // Pass fieldIds for which to fetch formEntityValues (when filtering/grouping by dynamic fields)
    if (fevFieldIds.length > 0) {
      params.formEntityValueFieldIds = fevFieldIds;
    }

    return params;
  }, [
    viewMode,
    boardId,
    effectiveProjectId,
    filterByUserId,
    filterByGroupId,
    fevFieldIds,
    filters.boards,
  ]);

  const [allProjectTickets, ticketsDetails] = useCachedQuery(
    queries.ticketsQuery(ticketsQueryParams),
    {
      enabled:
        (viewMode === 'board' && !!boardId) ||
        (viewMode === 'project' && !!effectiveProjectId) ||
        viewMode === 'my-tickets' ||
        (viewMode === 'user-tickets' && !!filterByUserId) ||
        (viewMode === 'group-tickets' && !!filterByGroupId),
    },
  );
  if (ticketsDetails.type === 'complete') logEntityTiming('allProjectTickets');

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
      if (Array.isArray(ticket.assignments)) {
        (ticket.assignments as TicketAssignment[]).forEach(assignment => {
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

  // Get available board IDs based on view mode (only needed for my-tickets views)
  // Use allProjectTickets (assigned + created) instead of scopedTickets (only assigned)
  // so that boards from both assigned AND created tickets appear in the dropdown
  const availableBoards = useMemo(() => {
    if (isMyTicketsView) {
      if (!allProjectTickets || allProjectTickets.length === 0) return [];
      const boardIds = allProjectTickets
        .map(ticket => ticket.boardId)
        .filter((id): id is string => id !== null);
      return Array.from(new Set(boardIds));
    }
    return undefined;
  }, [allProjectTickets, isMyTicketsView]);

  // Clear invalid board filters in my-tickets/user-tickets/group-tickets views
  useEffect(() => {
    // Early return if not in my-tickets view
    if (!isMyTicketsView) return;

    // Early return if no filters or boards
    if (!filters.boards || filters.boards.length === 0) return;
    if (!availableBoards || availableBoards.length === 0) return;

    const validBoards = filters.boards.filter(boardId => availableBoards.includes(boardId));

    // If none of the filtered boards are valid, clear the filter
    if (validBoards.length === 0) {
      setFilters({
        ...filters,
        boards: [],
      });
      return;
    }
    // If some but not all are valid, update to only valid ones
    if (validBoards.length !== filters.boards.length) {
      setFilters({
        ...filters,
        boards: validBoards,
      });
    }
  }, [isMyTicketsView, filters.boards, availableBoards, setFilters]);

  const [allTags, allTagsDetails] = useCachedQuery(queries.getAllTicketTags());
  const allUsers = useUsers();
  const allUserGroups = useUserGroups();

  // Create a map of stageId -> formId for quick lookup (from stages.formId)
  const stageFormMap = useMemo(() => {
    const map = new Map<string, string>();
    if (stages) {
      stages.forEach(stage => {
        if (stage.formId) {
          map.set(stage.id, stage.formId);
        }
      });
    }
    return map;
  }, [stages]);

  const tagsByTicketId = useMemo(() => {
    return createTagsByTicketIdMap(allTags);
  }, [allTags]);
  if (allTagsDetails.type === 'complete') logEntityTiming('tags');

  // ============================================================================
  // FORM ENTITY VALUES — fetched as related data on tickets when fevFieldIds is non-empty.
  // Extract formEntityValues from tickets and build lookup maps for filtering/grouping.
  // ============================================================================

  // Build maps used by applyTicketFilters and groupTicketsByFormField.
  //   formValuesByTicketId: ticketId → FEV rows
  //   formFieldsById: fieldId → { fieldType, fieldEnum }
  const { formValuesByTicketId, formFieldsById } = useMemo(() => {
    const valuesMap = new Map<string, FormEntityValues[]>();
    const fieldsMap = new Map<string, { fieldType: FormFieldType; fieldEnum?: string[] | null }>();

    // Extract formEntityValues from tickets (when fetched as related data)
    if (allProjectTickets && fevFieldIds.length > 0) {
      allProjectTickets.forEach(ticket => {
        const ticketFEVs = (
          ticket as Ticket & {
            formEntityValues?: Array<
              FormEntityValues & {
                formField?: { fieldType: FormFieldType; fieldEnum?: unknown } | null;
              }
            >;
          }
        ).formEntityValues;
        if (ticketFEVs && ticketFEVs.length > 0) {
          // Filter to only include FEVs for the fieldIds we're interested in
          if (ticketFEVs.length > 0) {
            valuesMap.set(ticket.id, ticketFEVs);

            // Build field metadata map from the related formField data
            ticketFEVs.forEach(fev => {
              if (fev.formField && !fieldsMap.has(fev.fieldId)) {
                fieldsMap.set(fev.fieldId, {
                  fieldType: fev.formField.fieldType,
                  fieldEnum: (fev.formField.fieldEnum as string[] | null) ?? null,
                });
              }
            });
          }
        }
      });
    }

    return { formValuesByTicketId: valuesMap, formFieldsById: fieldsMap };
  }, [allProjectTickets, fevFieldIds]);
  if (fevFieldIds.length === 0 || ticketsDetails.type === 'complete')
    logEntityTiming('formEntityValues');

  // Filter tickets based on view mode and filters.
  // NOTE: ALL filters including dynamic field filters are applied CLIENT-SIDE.
  // formValuesByTicketId is populated when dynamic filters are active (via allFormEntityValuesForFiltering).
  // Use deferred values to avoid blocking UI updates during board selection
  const deferredFilters = useDeferredValue(filters);

  const filteredTickets = useMemo(() => {
    let tickets = applyTicketFilters(
      allProjectTickets,
      deferredFilters,
      tagsByTicketId,
      formValuesByTicketId,
      formFieldsById,
      user?.id,
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

    // Filter for stage overdue tickets
    if (showOverdueOnly) {
      tickets = tickets.filter(ticket => isStageEtaOverdue(ticket));
    }

    return tickets;
  }, [
    allProjectTickets,
    deferredFilters,
    tagsByTicketId,
    formValuesByTicketId,
    formFieldsById,
    searchTerm,
    user?.id,
    showOverdueOnly,
  ]);

  if (ticketsDetails.type === 'complete' && allTagsDetails.type === 'complete') {
    logEntityTiming('filteredTickets');
  }

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

  const availableStages = useMemo(() => {
    if (!stages || stages.length === 0) return undefined;
    return stages.map(stage => ({
      name: stage.name,
      status: stage.defaultTicketStatusV2,
    }));
  }, [stages]);

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
        map.set(user.id, getUserDisplayName(user));
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

  // Handler for when stage form is required
  const handleStageFormRequired = useCallback(
    async (data: { ticket: Ticket; targetStage: Stage; formId: string; hasApprovers: boolean }) => {
      // Find the source stage (current stage of the ticket)
      const sourceStage = stages.find(s => s.name === data.ticket.stageName);

      // Fetch requests for this ticket on-demand
      const ticketRequests = await zero.run(
        queries.getTicketStageRequests({ ticketId: data.ticket.id }),
        { type: 'complete' },
      );
      const existingRequest = ticketRequests?.find(r => r.stageId === data.targetStage.id);

      setStageFormModal({
        ...data,
        sourceStageName: sourceStage?.name || data.ticket.stageName,
        existingRequest: existingRequest || null,
      });
    },
    [stages, zero],
  );

  // Handler for backward stage change confirmation
  const handleBackwardStageChange = useCallback(
    (data: {
      ticket: Ticket;
      stageName: string;
      fromSequenceNumber: number;
      newStatus?: TicketStatusV2;
    }) => {
      setBackwardStageChange({
        stageName: data.stageName,
        fromSequenceNumber: data.fromSequenceNumber,
        ...(data.newStatus !== undefined && { newStatus: data.newStatus }),
        ticketId: data.ticket.id,
      });
      setShowBackwardConfirmDialog(true);
    },
    [],
  );

  // Use drag and drop hook
  const dragDropMode = useMemo(() => {
    // For channel tickets: use view type to determine mode
    if (channelId && viewMode === 'project') {
      return channelViewType === 'stage' ? 'stage' : 'status';
    }
    // For other views
    return viewMode === 'board' || filteredSingleBoardId ? 'stage' : 'status';
  }, [channelId, viewMode, channelViewType, filteredSingleBoardId]);

  const {
    activeTicket,
    handleDragStart,
    handleDragEnd,
    rejectedApprovalConfirm,
    confirmRejectedApproval,
    cancelRejectedApproval,
  } = useDragAndDrop({
    localTickets,
    setLocalTickets,
    zero,
    stages,
    mode: dragDropMode,
    onStageFormRequired: handleStageFormRequired,
    onBackwardStageChange: handleBackwardStageChange,
    stageFormMap,
  });

  useEffect(() => {
    isDraggingRef.current = !!activeTicket;
  }, [activeTicket]);

  const handleTicketClick = useCallback(
    (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => {
      const isCmdClick = 'metaKey' in e && (e.metaKey || e.ctrlKey);
      const ticketUrl = `/chat/dir/${ticket.channelId}?tab=tickets&ticketId=${ticket.id}&conversationId=${ticket.conversationId}`;

      // Only open in new tab on desktop when Cmd/Ctrl+Click is pressed
      if (!isMobile && isCmdClick) {
        window.open(ticketUrl, '_blank');
        return;
      }

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
  // CreateTicketModal fetches its own boards and auto-selects the first one if needed
  const firstBoardId = boardId || null;

  const processedGroups = useMemo(() => {
    const groupedRows = groupTickets(localTickets, groupBy);
    const shouldGroupByStatus =
      (!filteredSingleBoardId && ['project', 'my-tickets'].includes(viewMode)) ||
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
    if (layoutView === 'calendar') {
      return availableColumns.filter(col => !['stage', 'board', 'createdBy'].includes(col.key));
    }
    return availableColumns.filter(col => col.key !== 'status');
  }, [layoutView, availableColumns]);

  return (
    <div className='flex flex-col h-full w-full bg-muted relative'>
      {/* Header */}
      <div className='flex flex-col lg:flex-row flex-wrap lg:flex-nowrap lg:items-center justify-between px-4 py-3 bg-background flex-shrink-0 gap-3'>
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
              showBoardsFilter={!!channelId || isMyTicketsView}
              availableTags={availableTags}
              availableStages={availableStages}
              hideAssigneeFilter={viewMode === 'my-tickets' ? true : false}
              formMappings={
                filters.boards?.length === 1 && selectedBoardDetail
                  ? selectedBoardDetail.formContextMappings || []
                  : []
              }
              selectedBoardName={selectedBoardDetail?.name ?? undefined}
              searchValue={searchTerm}
              onSearchChange={setSearchTerm}
              {...(channelId ? { channelId } : {})}
              groupBy={typeof groupBy === 'object' ? JSON.stringify(groupBy) : groupBy}
              hasActiveView={!!selectedViewId}
            />
          </div>
        )}

        {/* Create Ticket Button - Right Side */}
        <div className='flex flex-wrap lg:flex-col md:items-end gap-3 ml-auto md:ml-0'>
          {canCreateTicket && channel && !channel.isArchived && (
            <button
              data-testid='kanban-create-ticket-button'
              data-track-event='BUTTON_CLICK'
              data-track-category='TICKETS'
              data-track-name='CREATE_TICKET_KANBAN'
              data-track-metadata={JSON.stringify({ boardId, channelId })}
              onClick={() => setIsCreateModalOpen(true)}
              className='flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary-foreground bg-sidebar-badge-accent rounded-lg transition-colors flex-shrink-0'
            >
              <Plus className='w-4 h-4' />
              <span className='hidden sm:inline font-semibold text-sm'>Create Ticket</span>
              <span className='sm:hidden'>Create</span>
            </button>
          )}
          {/* Layout View Toggle */}
          <div className='flex items-center gap-2'>
            <div className='flex items-center rounded-xl bg-muted border'>
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
                      ? 'bg-background text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title='Kanban View'
                  data-track-category='Tickets'
                  data-track-name='SetKanbanView'
                  data-testid='kanban-view-btn'
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
                  className={`px-3 py-2 transition-colors border-r ${
                    layoutView === 'table'
                      ? 'bg-background text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title='Table View'
                  data-track-category='Tickets'
                  data-track-name='SetTableView'
                  data-testid='table-view-btn'
                >
                  <List className='w-3.5 h-3.5' />
                </button>
              </Tooltip>
              {!isMobile && (
                <Tooltip content='Calendar View'>
                  <button
                    onClick={() => {
                      setSearchParams(prev => {
                        const p = new URLSearchParams(prev);
                        p.set('layout', 'calendar');
                        return p;
                      });
                    }}
                    className={`px-3 py-2 rounded-r-xl transition-colors ${
                      layoutView === 'calendar'
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title='Calendar View'
                    data-track-category='KANBAN'
                    data-track-name='SetCalendarView'
                    data-track-metadata={JSON.stringify({
                      layout: 'calendar',
                      viewMode,
                      channelId,
                    })}
                    data-testid='calendar-view-btn'
                  >
                    <Calendar className='w-3.5 h-3.5' />
                  </button>
                </Tooltip>
              )}
            </div>

            {/* My Tickets Filter Toggles - only show in my-tickets view */}
            {viewMode === 'my-tickets' && (
              /* CHANGE 1: Added 'overflow-hidden' */
              <div className='flex items-center rounded-xl bg-muted border h-8 overflow-hidden'>
                <Tooltip content='Assigned To Me'>
                  <button
                    onClick={() => {
                      const newAssigned = !filters.assigned;
                      setFilters({
                        ...filters,
                        assigned: newAssigned,
                        created: newAssigned ? false : (filters.created ?? false), // If turning assigned on, turn created off
                      });
                    }}
                    /* CHANGE 2: Replaced 'py-2' with 'h-full' */
                    className={`px-3 h-full rounded-l-xl transition-colors border-r ${
                      filters.assigned
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    data-track-category='KANBAN'
                    data-track-name='ToggleAssignedToMeFilter'
                    data-track-metadata={JSON.stringify({ assigned: !filters.assigned })}
                  >
                    <span className='text-xs font-medium'>Assigned To Me</span>
                  </button>
                </Tooltip>
                <Tooltip content='Created By Me'>
                  <button
                    onClick={() => {
                      const newCreated = !filters.created;
                      setFilters({
                        ...filters,
                        created: newCreated,
                        assigned: newCreated ? false : (filters.assigned ?? false), // If turning created on, turn assigned off
                      });
                    }}
                    /* CHANGE 3: Replaced 'py-2' with 'h-full' */
                    className={`px-3 h-full rounded-r-xl transition-colors ${
                      filters.created
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    data-track-category='KANBAN'
                    data-track-name='ToggleCreatedByMeFilter'
                    data-track-metadata={JSON.stringify({ created: !filters.created })}
                  >
                    <span className='text-xs font-medium'>Created By Me</span>
                  </button>
                </Tooltip>
              </div>
            )}
            {/* Stage Overdue Filter Toggle */}
            <Tooltip content={showOverdueOnly ? 'Show All Tickets' : 'Show Only Overdue Tickets'}>
              <button
                onClick={() => setShowOverdueOnly(prev => !prev)}
                className={`px-3 py-2 transition-colors ${
                  showOverdueOnly
                    ? 'bg-red-100 text-red-700 border border-red-300'
                    : 'bg-background text-muted-foreground hover:text-foreground border border-input'
                } rounded-lg flex items-center gap-2`}
                title='Filter Overdue Tickets'
                data-track-category='KANBAN'
                data-track-name='ToggleOverdueFilter'
                data-track-metadata={JSON.stringify({
                  showOverdueOnly: !showOverdueOnly,
                  viewMode,
                  channelId,
                })}
              >
                <svg
                  width='14'
                  height='14'
                  viewBox='0 0 12 12'
                  fill='none'
                  className={showOverdueOnly ? 'text-red-600' : 'text-muted-foreground'}
                >
                  <circle cx='6' cy='6' r='5' stroke='currentColor' strokeWidth='1.5' />
                  <path
                    d='M6 3v3.5M6 8.5h.01'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                  />
                </svg>
              </button>
            </Tooltip>

            <DropdownMenu.Root open={isCustomizeOpen} onOpenChange={setIsCustomizeOpen}>
              <DropdownMenu.Trigger>
                <Tooltip content='Customize View'>
                  <button
                    className='flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-background hover:bg-muted transition-all outline-none focus:ring-2 focus:ring-border shadow-sm'
                    title='Configure Columns'
                  >
                    <Settings2 className='w-3.5 h-3.5 text-muted-foreground' />
                    <span className='sr-only'>Columns</span>
                  </button>
                </Tooltip>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align='end'
                  sideOffset={8}
                  className='z-50 w-[300px] bg-background border border-border rounded-lg shadow-xl animate-in fade-in zoom-in-95'
                >
                  <div className='mb-1 border-b flex items-center justify-between px-4 py-3'>
                    <span className='text-sm font-bold tracking-wide'>Customise view</span>
                    <button
                      onClick={() => setIsCustomizeOpen(false)}
                      className='cursor-pointer hover:bg-muted rounded p-1 transition-colors'
                      data-track-category='Tickets'
                      data-track-name='CloseCustomizeView'
                    >
                      <X className='w-3.5 h-3.5' />
                    </button>
                  </div>

                  {/* Saved Views section */}
                  {savedViewsBoardId && savedConfigs && savedConfigs.length > 0 && (
                    <div className='border-b border-gray-100 px-4 pt-4 pb-3'>
                      <p className='text-sm font-medium text-[#7C8698] mb-1'>Views</p>
                      <div className='py-2 flex flex-wrap gap-2 max-h-[180px] overflow-y-auto'>
                        {savedConfigs.map(config => {
                          const isOwn = config.userId === user?.id;
                          const isPrivate = config.visibility === SavedConfigVisibility.PRIVATE;
                          const isActive = selectedViewId === config.id;
                          return (
                            <button
                              key={config.id}
                              type='button'
                              data-track-category='saved-views'
                              data-track-name='apply-saved-view'
                              className={`group relative flex items-center gap-1.5 px-[10px] py-[6px] rounded-[10px] border cursor-pointer transition-colors ${
                                isActive ? 'border-[#57AB02]' : 'border-[#DBDCDF]'
                              }`}
                              onClick={() => {
                                const allValues = (config.values ?? []) as ReadonlyArray<{
                                  entityName: SavedConfigEntityName;
                                  fieldName: string;
                                  fieldValue: string;
                                }>;
                                const groupByEntry = allValues.find(
                                  v => v.fieldName === '__groupBy',
                                );
                                const filterValues = allValues.filter(
                                  v => v.fieldName !== '__groupBy',
                                );
                                const newFilters = valuesToFilters(filterValues);
                                if (filters.boards) newFilters.boards = filters.boards;
                                setFilters(newFilters);
                                setSelectedViewId(config.id);
                                try {
                                  sessionStorage.setItem(activeViewKey, config.id);
                                } catch (err) {
                                  console.error(
                                    'Failed to persist active view to sessionStorage',
                                    err,
                                  );
                                }
                                if (groupByEntry) {
                                  try {
                                    setGroupBy(JSON.parse(groupByEntry.fieldValue) as GroupByType);
                                  } catch {
                                    setGroupBy(groupByEntry.fieldValue as GroupByType);
                                  }
                                } else {
                                  setGroupBy('none');
                                }
                                setIsCustomizeOpen(false);
                              }}
                            >
                              <span className='text-sm font-medium truncate max-w-[160px] text-[#7C8698]'>
                                {config.name}
                              </span>
                              {isPrivate && (
                                <span className='text-xs text-[#7C8698] font-normal'>Private</span>
                              )}
                              {isOwn && (
                                <button
                                  data-track-category='saved-views'
                                  data-track-name='delete-saved-view'
                                  className='hidden group-hover:flex items-center justify-center absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-200 hover:bg-red-100 transition-colors'
                                  title='Delete view'
                                  onClick={e => {
                                    e.stopPropagation();
                                    setDeleteViewConfirm({
                                      configId: config.id,
                                      name: config.name,
                                      isPublic: !isPrivate,
                                    });
                                  }}
                                >
                                  <X className='w-2.5 h-2.5 text-gray-500 hover:text-red-500' />
                                </button>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {layoutView === 'table' && (
                    <div className='px-4 py-3 border-b border-border'>
                      <div className='flex items-center justify-between gap-2 rounded-lg bg-muted p-1 shadow-inner'>
                        <button
                          onClick={() => setIsComfortView(true)}
                          className={`flex flex-1 flex-col items-center gap-1 rounded-md px-4 py-2 
            transition hover:bg-muted focus:outline-none 
            ${isComfortView ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
                          data-track-event='BUTTON_CLICK'
                          data-track-category='TICKETS'
                          data-track-name='KANBAN_VIEW_COMFORTABLE'
                          data-track-metadata={JSON.stringify({ boardId, viewMode: 'comfortable' })}
                        >
                          <AcOnSlow className='h-4 w-4' />
                          <span className='text-[13px] font-medium tracking-tight'>
                            Comfortable
                          </span>
                        </button>

                        <button
                          onClick={() => setIsComfortView(false)}
                          className={`flex flex-1 flex-col items-center gap-1 rounded-md px-4 py-2 
            transition hover:bg-background hover:text-foreground
            ${!isComfortView ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
                          data-track-event='BUTTON_CLICK'
                          data-track-category='TICKETS'
                          data-track-name='KANBAN_VIEW_COMPACT'
                          data-track-metadata={JSON.stringify({ boardId, viewMode: 'compact' })}
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
                      className='relative flex items-center justify-between py-3 px-4 text-sm text-foreground rounded-lg cursor-pointer outline-none select-none
                     data-[highlighted]:bg-muted data-[highlighted]:text-foreground transition-colors'
                      checked={visibleColumns.has(column.key)}
                      onCheckedChange={checked => handleColumnVisibilityChange(column.key, checked)}
                      onSelect={e => e.preventDefault()}
                    >
                      <div className='flex items-center gap-3'>
                        <span className='text-muted-foreground group-data-[highlighted]:text-muted-foreground h-3 w-3'>
                          {column.icon}
                        </span>
                        <span className='font-medium text-sm'>{column.label}</span>
                      </div>
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          visibleColumns.has(column.key)
                            ? 'bg-sidebar-badge-accent border'
                            : 'border-input bg-background'
                        }`}
                      >
                        {visibleColumns.has(column.key) && (
                          <CheckIcon className='w-3 h-3 text-primary-foreground stroke-[3]' />
                        )}
                      </div>
                    </DropdownMenu.CheckboxItem>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className='flex items-center gap-2 px-3 py-1.5 bg-background border border-border rounded-xl text-sm font-medium outline-none hover:bg-muted transition-all min-w-[160px]'
                  data-testid='group-by-dropdown'
                >
                  <div className='flex items-center gap-2 flex-1'>
                    <span className='text-muted-foreground font-normal'>Group by:</span>
                    {typeof groupBy === 'object' && groupBy.type === 'formField'
                      ? groupBy.fieldName
                      : groupingOptions
                          .find(opt => typeof opt.value === 'string' && opt.value === groupBy)
                          ?.label.replace('Group by: ', '') || 'None'}
                  </div>
                  <ChevronDownIcon className='w-3.5 h-3.5 text-muted-foreground' />
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align='end'
                  sideOffset={8}
                  className='z-50 min-w-[220px] p-1 bg-background border border-border rounded-lg flex flex-col gap-1 shadow-xl animate-in fade-in zoom-in-95'
                >
                  {/* Matching Header Style */}
                  <div className='mb-1 border-b flex items-center justify-between px-4 py-3'>
                    <span className='text-sm font-bold tracking-wide'>Group by</span>
                    {groupBy !== 'none' && (
                      <DropdownMenu.Item
                        className='outline-none'
                        aria-label='Clear grouping'
                        onSelect={() => {
                          handleSetGroupBy('none');
                        }}
                      >
                        <div className='cursor-pointer hover:bg-muted rounded p-1 transition-colors'>
                          <X className='w-3.5 h-3.5' />
                        </div>
                      </DropdownMenu.Item>
                    )}
                  </div>

                  {/* Grouping Options */}
                  {groupingOptions.map(({ value, label, icon }) => (
                    <DropdownMenu.CheckboxItem
                      key={typeof value === 'object' ? `formField-${value.fieldId}` : value}
                      className='relative flex items-center gap-2 justify-between py-3 px-4 text-sm rounded-xl text-foreground cursor-pointer outline-none select-none
      transition-colors
      data-[highlighted]:bg-muted data-[highlighted]:text-foreground
      data-[state=checked]:bg-accent data-[state=checked]:text-black data-[state=checked]:font-semibold'
                      checked={
                        typeof value === 'string'
                          ? groupBy === value
                          : typeof groupBy === 'object' &&
                            groupBy.type === 'formField' &&
                            groupBy.fieldId === value.fieldId
                      }
                      onCheckedChange={() => handleSetGroupBy(value as GroupByType)}
                      data-testid={`group-by-${typeof value === 'string' ? value : value.fieldId}`}
                    >
                      <div className='flex items-center gap-3'>
                        <span className='text-muted-foreground group-data-[highlighted]:text-muted-foreground h-3 w-3'>
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

      {/* Active saved view indicator */}
      {selectedViewId &&
        savedConfigs &&
        (() => {
          const activeView = savedConfigs.find(c => c.id === selectedViewId);
          if (!activeView) return null;
          return (
            <div className='flex items-center px-4 py-2 bg-white border-b border-gray-100 flex-shrink-0'>
              <div className='flex items-center gap-2 px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-700'>
                <span className='font-medium'>{activeView.name}</span>
                <button
                  data-track-category='saved-views'
                  data-track-name='dismiss-active-view'
                  onClick={() => {
                    setSelectedViewId(null);
                    try {
                      sessionStorage.removeItem(activeViewKey);
                    } catch (err) {
                      console.error('Failed to remove active view from sessionStorage', err);
                    }
                    setFilters({ ...(filters.boards ? { boards: filters.boards } : {}) });
                    setGroupBy('none');
                  }}
                  className='flex items-center justify-center hover:text-gray-900 transition-colors'
                  title='Dismiss view'
                >
                  <X className='w-3.5 h-3.5' />
                </button>
              </div>
            </div>
          );
        })()}

      {/* Board-wise View for my-tickets, channel stage view, or multiple boards filter */}
      {/* Board-wise View */}
      {layoutView === 'calendar' ? (
        <div className='flex-1 overflow-hidden bg-background'>
          <CalendarView
            tickets={filteredTickets}
            onTicketClick={(ticket: Ticket) => handleTicketClick({} as React.MouseEvent, ticket)}
          />
        </div>
      ) : layoutView === 'table' ? (
        <div className='flex-1 overflow-y-auto p-4 space-y-4 bg-background pb-14'>
          {processedGroups.map(group => {
            const isExpanded = expandedGroups.has(group.key);
            const showGroupHeader = groupBy !== 'none';
            return (
              <div
                key={group.key}
                className='flex flex-col rounded-lg border border-border overflow-hidden'
              >
                {showGroupHeader && (
                  <button
                    onClick={() => toggleGroupExpansion(group.key)}
                    className={`flex items-center gap-3 px-4 py-3 bg-muted transition-colors w-full text-left ${isExpanded ? 'border-b border-border' : 'border-none'} `}
                    data-track-category='Tickets'
                    data-track-name='ToggleGroupExpansion'
                    data-track-metadata={JSON.stringify({ groupKey: group.key, isExpanded })}
                  >
                    {isExpanded ? (
                      <ChevronDownIcon className='w-4 h-4 text-muted-foreground flex-shrink-0' />
                    ) : (
                      <ChevronRight className='w-4 h-4 text-muted-foreground flex-shrink-0' />
                    )}
                    <div className='flex items-center gap-4 flex-1'>
                      <div className='flex items-center gap-2'>
                        {/* Show avatar for user assignees */}
                        {group.entityType === 'user' && group.entityId && (
                          <Avatar userId={group.entityId} size='sm' className='rounded-md' />
                        )}
                        {/* Show group icon for group assignees */}
                        {group.entityType === 'group' && (
                          <div className='w-5 h-5 rounded-full bg-muted-foreground/50 flex items-center justify-center flex-shrink-0'>
                            <User className='w-3 h-3 text-muted-foreground' />
                          </div>
                        )}
                        {/* Show priority icon when grouping by priority */}
                        {group.priority && (
                          <div className='flex items-center justify-center'>
                            {getPriorityIcon(group.priority)}
                          </div>
                        )}
                        <h3 className='font-semibold text-foreground capitalize  text-sm'>
                          {group.displayName}
                        </h3>
                      </div>
                      <span className='text-xs font-medium bg-background text-muted-foreground px-2 py-0.5 rounded-lg'>
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
                      isComfortView={isComfortView}
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
            onDragEnd={event => void handleDragEnd(event)}
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
                        data-track-category='KanbanBoard'
                        data-track-name='ToggleGroupExpansion'
                        data-track-metadata={JSON.stringify({ groupKey: group.key, groupBy })}
                        className={`flex items-center gap-3 p-4 bg-muted hover:bg-border transition-colors sticky left-0 z-10 w-full text-left border-b border-border ${isExpanded ? 'rounded-t-lg ' : 'rounded-lg'}`}
                      >
                        {isExpanded ? (
                          <ChevronDownIcon className='w-4 h-4 text-muted-foreground' />
                        ) : (
                          <ChevronRight className='w-4 h-4 text-muted-foreground' />
                        )}
                        <div className='flex items-center gap-4'>
                          <div className='flex items-center gap-2'>
                            {/* Show avatar for user assignees */}
                            {group.entityType === 'user' && group.entityId && (
                              <Avatar userId={group.entityId} size='sm' className='rounded-lg' />
                            )}
                            {/* Show group icon for group assignees */}
                            {group.entityType === 'group' && (
                              <div className='w-5 h-5 rounded-full bg-muted-foreground/50 flex items-center justify-center flex-shrink-0'>
                                <User className='w-3 h-3 text-muted-foreground' />
                              </div>
                            )}
                            {/* Show priority icon when grouping by priority */}
                            {group.priority && (
                              <div className='flex items-center justify-center'>
                                {getPriorityIcon(group.priority)}
                              </div>
                            )}
                            <h3 className='font-semibold text-foreground capitalize  text-sm'>
                              {group.displayName}
                            </h3>
                          </div>
                          <span className='text-xs font-medium bg-background text-muted-foreground px-2 py-0.5 rounded-lg'>
                            {group.count}
                          </span>
                        </div>
                      </button>
                    )}

                    {/* Only show Kanban columns if expanded OR if no grouping is applied */}
                    {(isExpanded || !showGroupHeader) && (
                      <div
                        className={
                          showGroupHeader ? 'h-[calc(100vh-300px)] bg-background' : 'h-full'
                        }
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

      {/* Stage Form Modal */}
      {stageFormModal && (
        <StageFormModal
          isOpen={!!stageFormModal}
          onClose={() => setStageFormModal(null)}
          ticket={stageFormModal.ticket}
          targetStage={stageFormModal.targetStage}
          sourceStageName={stageFormModal.sourceStageName}
          existingRequest={stageFormModal.existingRequest ?? null}
          formId={stageFormModal.formId}
          hasApprovers={stageFormModal.hasApprovers ?? false}
          onSuccess={() => {
            setStageFormModal(null);
          }}
        />
      )}

      {/* Backward movement confirmation dialog */}
      {backwardStageChange && (
        <Dialog
          open={showBackwardConfirmDialog}
          onOpenChange={setShowBackwardConfirmDialog}
          title='Confirm Stage Change'
        >
          <div className='p-6'>
            <p className='text-sm text-muted-foreground mb-6'>
              Moving to a previous stage will clear all status change requests for status after this
              one. These requests will need to be submitted again. Do you want to continue?
            </p>

            <div className='flex justify-end gap-3'>
              <Button
                variant='secondary'
                onClick={() => setShowBackwardConfirmDialog(false)}
                data-track-category='Tickets'
                data-track-name='CancelBackwardStageChange'
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (backwardStageChange) {
                    // Clean up stage approvals and form entity values for stages being skipped
                    void zero.mutate(
                      mutators.cleanupStageApprovals({
                        ticketId: backwardStageChange.ticketId,
                        fromSequenceNumber: backwardStageChange.fromSequenceNumber,
                      }),
                    );

                    // Directly update the stage for backward movement
                    void zero.mutate(
                      mutators.ticket.update({
                        id: backwardStageChange.ticketId,
                        stageName: backwardStageChange.stageName,
                        ...(backwardStageChange.newStatus && {
                          statusV2: backwardStageChange.newStatus,
                        }),
                        updatedAt: Date.now(),
                      }),
                    );

                    setShowBackwardConfirmDialog(false);
                  }
                }}
                className='bg-sidebar-badge-accent text-primary-foreground hover:bg-blue-700'
                data-track-category='Tickets'
                data-track-name='ConfirmBackwardStageChange'
                data-track-metadata={JSON.stringify({
                  ticketId: backwardStageChange?.ticketId,
                  stageName: backwardStageChange?.stageName,
                })}
              >
                Confirm
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Rejected approval confirmation dialog */}
      {rejectedApprovalConfirm && (
        <Dialog
          open={!!rejectedApprovalConfirm}
          onOpenChange={() => cancelRejectedApproval()}
          title='Approve Rejected Request'
        >
          <div className='p-6'>
            <p className='text-sm text-muted-foreground mb-6'>
              This request was previously rejected. Approving now will mark the request as Approved
              and update the ticket stage to {rejectedApprovalConfirm.targetStage.name}. Do you want
              to continue?
            </p>

            <div className='flex justify-end gap-3'>
              <Button variant='secondary' onClick={cancelRejectedApproval}>
                Cancel
              </Button>
              <Button
                onClick={confirmRejectedApproval}
                className='bg-sidebar-badge-accent text-primary-foreground hover:bg-blue-700'
              >
                Approve
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Delete saved view confirmation dialog */}
      {deleteViewConfirm && (
        <Dialog
          open={!!deleteViewConfirm}
          onOpenChange={open => {
            if (!open) setDeleteViewConfirm(null);
          }}
          title='Delete Saved View'
        >
          <div className='p-6'>
            <p className='text-sm text-gray-600 mb-6'>
              {deleteViewConfirm.isPublic
                ? `"${deleteViewConfirm.name}" is a public view visible to all members. Deleting it will remove it for everyone. Are you sure you want to delete it?`
                : `Are you sure you want to delete the saved view "${deleteViewConfirm.name}"? This action cannot be undone.`}
            </p>
            <div className='flex justify-end gap-3'>
              <Button variant='secondary' onClick={() => setDeleteViewConfirm(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (selectedViewId === deleteViewConfirm.configId) {
                    setSelectedViewId(null);
                    try {
                      sessionStorage.removeItem(activeViewKey);
                    } catch (err) {
                      console.error('Failed to remove active view from sessionStorage', err);
                    }
                  }
                  const configId = deleteViewConfirm.configId;
                  setDeleteViewConfirm(null);
                  const run = async (): Promise<void> => {
                    try {
                      const result = zero.mutate(
                        mutators.savedUserConfiguration.delete({ configId }),
                      );
                      const res = await result.server;
                      if (res.type === 'error') {
                        toast.error(res.error?.message ?? 'Failed to delete view');
                      } else {
                        toast.success('View deleted');
                      }
                    } catch (err: unknown) {
                      toast.error(err instanceof Error ? err.message : 'Failed to delete view');
                    }
                  };
                  void run();
                }}
                className='bg-red-500 text-white hover:bg-red-600'
              >
                Delete
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};

KanbanBoardScreen.displayName = 'KanbanBoardScreen';

export default KanbanBoardScreen;
