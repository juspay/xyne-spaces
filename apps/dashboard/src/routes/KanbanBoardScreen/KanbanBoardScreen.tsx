import React, { useState, useMemo, useCallback, useEffect, useRef, useDeferredValue } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { QueryResultType } from '@rocicorp/zero';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { logger, Event } from '../../utils/logger';
import { useAuth } from '../../hooks/useAuth';
import { useCanCreateTicket, usePermissions } from '../../hooks/usePermissions';
import { usePlatform } from '../../hooks/usePlatform';
import { useRouteContext } from '../../hooks/useRouteContext';
import { TextAlignJustify, FileSpreadsheet, Archive } from 'lucide-react';
import {
  PlusDefault as Plus,
  FilterHorizontal as Settings2,
  ChevronDown as ChevronDownIcon,
  ChevronRight,
  UserDefault as User,
  CalendarDefault as Calendar,
  CheckTickCircle as CircleCheckBig,
  Poll as Vote,
  Tag,
  CheckTickSingle as CheckIcon,
  MultipleCrossCancelDefault as X,
  ClockDefault as Clock,
  BarchartDefault as BarChart3,
  BookmarkDefault as Bookmark,
  Share02 as Share2,
  GitBranch,
  PencilEdit as Pencil,
  CheckTickCircle as CheckCircle2,
  MultipleCrossCancelCircle as XCircle,
  DownloadDown as Download,
  FileText,
  ArrowLeft,
  SearchDefault as Search,
  KanbanBoard as SquareKanban,
  GridTable,
} from '@xyne/icons';
import { CalendarView } from '../../components/Tickets/CalendarView';
import TicketReportsScreen from '../../routes/TicketReportsScreen/TicketReportsScreen';
import ReactFlow, {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  type Node,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
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
import {
  clearCreateTicketParams,
  hasCreateTicketFlag,
} from '../../components/Tickets/CreateTicketModal/createTicket.utils';
import { StageFormModal } from '../../components/Tickets/StageFormModal/StageFormModal';
import { useMachine } from '@xstate/react';
import { ticketFiltersMachine } from '../../machines/ticketFiltersMachine';
import { setBoardNavParams } from '../../components/Tickets/boardNavStore';
import type { KanbanTicketsPageBaseArgs } from './useKanbanTicketsPage';
import { withTicketChannelScope } from './ticketChannelScope';
import type { TicketFilters } from '../../components/Tickets/TicketFilters/types';
import { KanbanColumns } from '../../components/Tickets/KanbanColumns/KanbanColumns';
import { ViewBoardPicker } from '../../components/Project/ViewBoardPicker/ViewBoardPicker';
import { useDragAndDrop, type StageTransitionInfo } from '../../hooks/useDragAndDrop';
import {
  useAllChannels,
  useChannel,
  useChannelsByProjectId,
  useGetChannelUserStatus,
} from '../../hooks/useChannels';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { surfaceMutationError } from '../../utils/zeroMutationToast';
import { apiInstance } from '../../services/clients/apiClient';
import type {
  Ticket,
  FormEntityValues,
  TicketStageRequest,
  TicketAssignment,
  BoardMetadata,
  FlowStepVisibilityOptions,
} from '@xyne/shared';
import {
  TicketStatusV2,
  ActivityType,
  FormContextType,
  AccessType,
  FormEntityType,
  FormFieldType,
  ChannelType,
  BoardType,
  TicketStageRequestStatus,
  isDeskChannelType,
  parseFieldOptions,
  type FieldEnumOption,
  FLOW_STAGE_NAMES,
  FlowPlanModel,
  deserializeFlowPlan,
  type FlowDecisionOutcome,
  type FlowPlanNode,
} from '@xyne/shared';
import {
  FlowNodeSidePanel,
  type FlowNodeSelection,
} from '../../components/Board/FlowRun/FlowNodeSidePanel';
import {
  mapPlanToRunTickets,
  getFlowMeta,
  flowRuntimeStatusOf,
  isFlowStepBacklogged,
  nextFlowWaitingNode,
  type FlowRunTicket,
} from '../../components/Board/FlowRun/flowRun.utils';
import {
  buildFlowRunModel,
  runPlanNode,
  sameFlowPlanNode,
  sameFlowRunTicket,
  summarizeFlowRuns,
  type FlowRunSummary,
} from '../../components/Board/FlowRun/flowRunModel';
import {
  buildFlowRunExportRows,
  downloadFlowRunsExcel,
  downloadFlowRunsPdf,
} from '../../components/Board/FlowRun/flowRunExport';
import {
  FLOW_NODE_TYPES,
  type FlowTicketNodeData,
} from '../../components/Board/FlowRun/FlowTicketNodeCard';
import { flowGroupColor } from '../../components/Board/FlowRun/FlowGroupNode';
import { useFlowRunGraph } from '../../components/Board/FlowRun/useFlowRunGraph';
import { STATUS_OPTIONS } from '../../components/Board/BoardStageConfigScreen/BoardStageConfigScreen.types';
import { VIRTUAL_ROOT_ID as FLOW_VIRTUAL_ROOT_ID } from '../../components/Board/FlowPlanEditor/FlowPlanEditor.utils';
import type { Stage } from './KanbanBoardScreen.types';
import {
  getStageColor,
  getStatusColumns,
  groupTicketsByStage,
  groupTicketsByStatus,
  applyTicketFilters,
  groupTicketsByFormField,
  extractBoardFormFields,
  extractGroupableFormFields,
  ticketsHaveSameBoardSnapshot,
} from './KanbanBoardScreen.utils';
import { TicketTable } from '../../components/Tickets/TicketTable/TicketTable';
import {
  getActivityDescription,
  getActivityIcon,
} from '../../components/Tickets/TicketActivity/TicketActivity';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Tooltip from '../../components/ui/Tooltip';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import ThreadMessages from '../../components/Chat/ThreadPannel';
import { xyneAIActor, type ThreadInfo } from '../../machines/xyneAIMachine';
import { useFlowRunPersistence } from './useFlowRunPersistence';
import { flowGroupCoverId } from '../../components/Board/FlowRun/useFlowRunGraph';
import Avatar from '../../components/ui/Avatar/Avatar';
import {
  getPriorityIcon,
  isStageOverdue,
} from '../../components/Tickets/TicketCard/TicketCard.utils';
import {
  TicketPriority,
  SavedConfigVisibility,
  SavedConfigEntityName,
  UserResponsibility,
  SavedConfigContextType,
  ApproverType,
} from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import AcOnSlow from '../../assets/icons/AcOnSlowIcon';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useUsers } from '../../hooks/useUsers';
import { useUserGroups } from '../../hooks/useUserGroup';
import { stateMachineActor } from '../../machines/stateMachine';
import { Dialog } from '../../components/ui/Dialog';
import Button from '../../components/ui/Button';
import { Popover } from '../../components/ui/Popover/Popover';
import { cn } from '../../utils/classNames';
import { useZero } from '../../hooks/useZero';
import { useIntersectionObserver } from '../../hooks/useIntersectionObserver';
import { useBoardsSlaPolicies } from '../../hooks/useChannelSlaPolicy';
import { useKanbanCounts } from './useKanbanCounts';
import { valuesToFilters } from '../../utils/savedViewSerialization';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { getApiErrorMessage } from '../../utils/apiError';

type SavedConfigValue = {
  id: string;
  entityName: SavedConfigEntityName;
  fieldName: string;
  fieldValue: string;
};

// Serialize filters (incl. boards) + groupBy into saved-config value rows.
const WORKSPACE_VIEW_ARRAY_KEYS = [
  'boards',
  'priority',
  'assignee',
  'createdBy',
  'userGroups',
  'tags',
  'stages',
  'ticketTypes',
  'sourceChannels',
] as const satisfies (keyof TicketFilters)[];

const WORKSPACE_VIEW_NUMERIC_KEYS = [
  'dueDateStart',
  'dueDateEnd',
  'createdDateStart',
  'createdDateEnd',
] as const satisfies (keyof TicketFilters)[];

const DERIVED_COLUMNS = ['stage', 'board'];

const DEFAULT_VISIBLE_COLUMNS = ['assignee', 'dueDate', 'status', 'priority', 'tags'];

function mergeSavedColumns(prev: Set<string>, saved: string[]): Set<string> {
  const next = new Set(saved);
  for (const key of DERIVED_COLUMNS) {
    if (prev.has(key)) next.add(key);
  }
  return next;
}

function filtersToValues(
  filters: TicketFilters,
  groupBy?: string,
  columns?: string[],
): SavedConfigValue[] {
  const values: SavedConfigValue[] = [];
  const addTicket = (fieldName: string, fieldValue: string): void => {
    values.push({ id: uuidv4(), entityName: SavedConfigEntityName.TICKET, fieldName, fieldValue });
  };
  const addForm = (fieldName: string, fieldValue: string): void => {
    values.push({
      id: uuidv4(),
      entityName: SavedConfigEntityName.FORM_ENTITY_VALUE,
      fieldName,
      fieldValue,
    });
  };

  for (const key of WORKSPACE_VIEW_ARRAY_KEYS) {
    (filters[key] as string[] | undefined)?.forEach(v => addTicket(key, v));
  }
  for (const key of WORKSPACE_VIEW_NUMERIC_KEYS) {
    const v = filters[key];
    if (v !== undefined) addTicket(key, String(v));
  }
  if (filters.dynamicFields) {
    Object.entries(filters.dynamicFields).forEach(([fieldId, val]) => {
      if (Array.isArray(val)) {
        val.forEach(v => addForm(fieldId, v));
      } else {
        if (val.start !== undefined) addForm(`${fieldId}.start`, String(val.start));
        if (val.end !== undefined) addForm(`${fieldId}.end`, String(val.end));
      }
    });
  }
  if (groupBy && groupBy !== 'none') addTicket('__groupBy', groupBy);
  if (columns) addTicket('__columns', columns.join(','));
  return values;
}

interface BoardKanbanScreenProps {
  viewMode?:
    | 'my-tickets'
    | 'user-tickets'
    | 'group-tickets'
    | 'board'
    | 'project'
    | 'workspace-view';
  channelId?: string;
  filterByUserId?: string;
  filterByGroupId?: string;
  // Project Views builder (workspace-view mode):
  workspaceId?: string;
  viewId?: string;
  initialName?: string;
  initialFilters?: TicketFilters;
  initialGroupBy?: string;
  initialColumns?: string[];
}

type GroupByType = 'none' | 'assignee' | 'status' | 'priority' | FormFieldGroup;

interface FormFieldGroup {
  type: 'formField';
  fieldId: string;
  fieldName: string;
  fieldType: FormFieldType;
}

function isFormFieldGroup(value: unknown): value is FormFieldGroup {
  return (
    typeof value === 'object' && value !== null && 'type' in value && value.type === 'formField'
  );
}

type KanbanLocalTicket = Ticket & {
  assignments?: TicketAssignment[];
  tagMappings?: Array<{ id: string; tagId: string; tagName: string; ticketId: string }>;
  tags?: Array<{ id: string; name: string; ticketId?: string }>;
  formEntityValues?: Array<
    FormEntityValues & {
      formField?: { fieldType: FormFieldType; fieldEnum?: unknown; fieldOptions?: unknown } | null;
    }
  >;
};

// 'flow' is the dedicated mode for FLOW boards (plan-driven run graph); it is
// never offered in the layout toggle and only reachable on flow boards.
type LayoutView = 'kanban' | 'table' | 'calendar' | 'flow';
type TicketGraphMapping = QueryResultType<typeof queries.subTicketMappingsForTickets>[number];
type TicketGraphSubTicket = NonNullable<TicketGraphMapping['subTicket']>;
type FlowRunActivity = QueryResultType<typeof queries.ticketActivitiesForTickets>[number];

const FLOW_RUN_ACTIVITY_PAGE_SIZE = 25;

function mergeFlowRunActivities(
  existing: readonly FlowRunActivity[],
  incoming: readonly FlowRunActivity[],
): FlowRunActivity[] {
  const byId = new Map(existing.map(activity => [activity.id, activity]));
  incoming.forEach(activity => byId.set(activity.id, activity));
  return Array.from(byId.values()).sort(
    (left, right) => right.timestamp - left.timestamp || right.id.localeCompare(left.id),
  );
}

interface TicketGraphNode {
  key: string;
  ticket?: Ticket;
  subTicket?: TicketGraphSubTicket;
  displayId: string;
  title: string;
  statusLabel?: string;
  priority?: TicketPriority | null;
  assignedTo?: string | null;
  depth: number;
  children: TicketGraphNode[];
}

function parseGroupBy(raw: string): GroupByType {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isFormFieldGroup(parsed)) return parsed;
  } catch {
    // not JSON, fall through
  }
  return raw as GroupByType;
}

function uniqueProjectIds(boards: readonly { projectId?: string | null }[]): string[] {
  const ids = new Set<string>();
  boards.forEach(board => {
    if (board.projectId) ids.add(board.projectId);
  });
  return Array.from(ids);
}

const availableColumns = [
  { key: 'assignee', label: 'Assignee', icon: <User className='h-4 w-4' /> },
  { key: 'dueDate', label: 'Due Date', icon: <Calendar className='h-4 w-4' /> },
  { key: 'status', label: 'Status Category', icon: <CircleCheckBig className='h-4 w-4' /> },
  { key: 'priority', label: 'Priority', icon: <Vote className='h-4 w-4' /> },
  { key: 'tags', label: 'Labels', icon: <Tag className='h-4 w-4' /> },
  { key: 'stage', label: 'Sub-status', icon: <CircleCheckBig className='h-4 w-4' /> },
  { key: 'createdAt', label: 'Created At', icon: <Clock className='h-4 w-4' /> },
  { key: 'createdBy', label: 'Created By', icon: <User className='h-4 w-4' /> },
  { key: 'updatedAt', label: 'Updated At', icon: <Clock className='h-4 w-4' /> },
];

const KanbanBoardScreen: React.FC<BoardKanbanScreenProps> = ({
  viewMode: viewModeProp,
  channelId,
  filterByUserId,
  filterByGroupId,
  workspaceId,
  viewId,
  initialName,
  initialFilters,
  initialGroupBy,
  initialColumns,
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
  const permissions = usePermissions();
  const canExportTickets = permissions.some(
    permission =>
      permission.resourceName === 'TICKET-REPORTS' &&
      (permission.accessType === AccessType.WRITE || permission.accessType === AccessType.ADMIN),
  );
  const zero = useZero();
  const { confirm, ConfirmDialog } = useConfirmDialog();
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
  const [createTicketSeed, setCreateTicketSeed] = useState<{
    status?: TicketStatusV2 | undefined;
    stageName?: string | undefined;
    assignee?: { type: 'assigneeTo' | 'userGroup'; value: string } | null;
  } | null>(null);
  const [localTickets, setLocalTickets] = useState<Ticket[] | null>([]);
  const [kanbanTicketsByColumn, setKanbanTicketsByColumn] = useState<Record<string, Ticket[]>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [flowSelection, setFlowSelection] = useState<FlowNodeSelection | null>(null);
  const [collapsedFlowGroups, setCollapsedFlowGroups] = useState<Set<string>>(new Set());
  const [flowLegendOpen, setFlowLegendOpen] = useState(false);
  const [flowActivityOpen, setFlowActivityOpen] = useState(false);
  const [flowRunExporting, setFlowRunExporting] = useState<'excel' | 'pdf' | null>(null);
  const [flowRunSearchQuery, setFlowRunSearchQuery] = useState('');
  const [flowThreadTicket, setFlowThreadTicket] = useState<FlowRunTicket | null>(null);
  const [flowGroupBacklogPendingId, setFlowGroupBacklogPendingId] = useState<string | null>(null);
  const collapseInitRunRef = useRef<string | null>(null);
  // When mounted from the project route (AppRoot.tsx → :projectId / :projectId/:boardId),
  // no channelId prop is passed. The Create Ticket button at the bottom of this file
  // gates on `channel`, so without a fallback the button stays hidden on that route.
  // Fall back to the first non-archived channel of the project so the modal has a
  // channel to write into.
  const projectChannels = useChannelsByProjectId(channelId ? undefined : projectIdParam);
  const fallbackChannelId = projectChannels.find(c => !c.isArchived)?.id ?? '';
  const channel = useChannel(channelId || fallbackChannelId);
  const isEmailChannel = channel?.type === ChannelType.EMAIL;

  // Aggregate views (My Tickets, saved views) mix tickets from many channels,
  // so we can't rely on the single `channel` above to know a ticket's origin.
  // Build a channelId -> channel map to resolve each ticket's channel type on
  // click and route desk/support tickets to the Support desk instead of chat.
  const allChannels = useAllChannels();
  const channelsById = useMemo(() => new Map(allChannels.map(c => [c.id, c])), [allChannels]);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() =>
    initialColumns ? new Set(initialColumns) : new Set(DEFAULT_VISIBLE_COLUMNS),
  );
  // The tickets table always surfaces the Stage column (parity with the Support
  // desk table, which renders TicketTable with its stage-inclusive defaults).
  // Kanban cards keep using `visibleColumns` unchanged, so the "Sub-status"
  // toggle still governs card sub-status without affecting the table.
  // Forcing the column does not strand a dead control: `filteredAvailableColumns`
  // drops 'stage' from the Customize panel in table view, so there is no visible
  // toggle contradicting it. Note the table's Stage cell is editable (it routes
  // through `routeStageChange`), matching the Support desk table.
  const tableVisibleColumns = useMemo(
    () => new Set([...visibleColumns, 'stage']),
    [visibleColumns],
  );
  const [isComfortView, setIsComfortView] = useState(false);
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

  const handleKanbanTicketsChange = useCallback((columnKey: string, tickets: Ticket[]) => {
    setKanbanTicketsByColumn(prev => {
      if (tickets.length === 0) {
        if (!(columnKey in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[columnKey];
        return next;
      }

      if (ticketsHaveSameBoardSnapshot(prev[columnKey] ?? [], tickets)) {
        return prev;
      }
      return {
        ...prev,
        [columnKey]: tickets,
      };
    });
  }, []);

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

  const handleColumnVisibilityChange = (columnKey: string, isVisible: boolean) => {
    if (columnKey === 'stage') {
      send({ type: 'SET_SUB_STATUS', showSubStatus: isVisible });
      return;
    }
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
    if (viewModeProp === 'workspace-view') return 'workspace-view';
    if (viewModeProp === 'my-tickets') return 'my-tickets'; // Show user's tickets
    if (viewModeProp === 'user-tickets') return 'user-tickets'; // Show specific user's tickets
    if (viewModeProp === 'group-tickets') return 'group-tickets'; // Show specific group's tickets
    if (viewModeProp === 'board') return 'board';
    if (boardId) return 'board'; // Show specific board
    if (viewModeProp === 'project') return 'project';
    if (projectIdParam || channel) return 'project'; // Show all boards in project
    return 'project'; // Default to project view
  }, [viewModeProp, projectIdParam, boardId, channel]);

  const isWorkspaceView = viewMode === 'workspace-view';
  // A workspace view queries as a project view with no projectId; scope comes from filters.boards.
  const queryViewMode: 'project' | 'board' | 'my-tickets' | 'user-tickets' | 'group-tickets' =
    viewMode === 'workspace-view' ? 'project' : viewMode;

  // Get user's channel status for selectedBoardId persistence
  const channelUserStatus = useGetChannelUserStatus(channelId || '') as
    | { selectedBoardId?: string }
    | undefined;
  const selectedBoardIdFromDb: string | undefined = channelUserStatus?.selectedBoardId;

  // Use XState machine for filter persistence
  const [searchParams, setSearchParams] = useSearchParams();

  const createTicketLinkConsumedRef = useRef(false);
  useEffect(() => {
    if (!hasCreateTicketFlag(searchParams)) {
      createTicketLinkConsumedRef.current = false;
      return;
    }
    if (createTicketLinkConsumedRef.current) return;
    createTicketLinkConsumedRef.current = true;
    setIsCreateModalOpen(true);
  }, [searchParams]);
  const [state, send] = useMachine(ticketFiltersMachine);
  const requestedLayoutView = searchParams.get('layout');
  const layoutView: LayoutView =
    requestedLayoutView === 'table' ||
    requestedLayoutView === 'calendar' ||
    requestedLayoutView === 'flow'
      ? requestedLayoutView
      : 'kanban';
  const isKanbanLayout = layoutView === 'kanban';
  const showTicketReport = searchParams.get('ticketReport') === '1';
  // Flow view: the open run lives in the URL so browser back returns to the
  // main-tickets grid and run links are shareable.
  const selectedGraphRootTicketId = layoutView === 'flow' ? searchParams.get('run') : null;
  // The sessionStorage mirror is owned by useFlowRunPersistence; this setter
  // only owns the URL.
  const setSelectedGraphRootTicketId = useCallback(
    (ticketId: string | null, opts?: { replace?: boolean }) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (ticketId) {
            next.set('run', ticketId);
          } else {
            next.delete('run');
          }
          return next;
        },
        opts?.replace ? { replace: true } : undefined,
      );
    },
    [setSearchParams],
  );
  const groupBy: GroupByType = useMemo(
    () => parseGroupBy(state.context.groupBy),
    [state.context.groupBy],
  );
  const shouldUseLegacyTicketsQuery = !isKanbanLayout;
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const activeViewKey = `active-view-${state.context.storageKey}`;
  const hasRestoredActiveView = useRef<string | null>(null);
  const groupByKey = typeof groupBy === 'object' ? JSON.stringify(groupBy) : groupBy;
  const expandedGroupsStorageKey = `kanban-expanded-groups-${state.context.storageKey}`;

  const toggleGroupExpansion = useCallback(
    (groupKey: string) => {
      setExpandedGroups(prev => {
        const next = new Set(prev);
        if (next.has(groupKey)) {
          next.delete(groupKey);
        } else {
          next.add(groupKey);
        }
        try {
          const raw = sessionStorage.getItem(expandedGroupsStorageKey);
          const map = (raw ? JSON.parse(raw) : {}) as Record<string, string[]>;
          map[groupByKey] = [...next];
          sessionStorage.setItem(expandedGroupsStorageKey, JSON.stringify(map));
        } catch (err) {
          logger.error(Event.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('Failed to persist expanded groups to sessionStorage'),
            error: err,
          });
        }
        return next;
      });
    },
    [expandedGroupsStorageKey, groupByKey],
  );

  useEffect(() => {
    if (groupBy === 'none') return;
    try {
      const raw = sessionStorage.getItem(expandedGroupsStorageKey);
      const map = (raw ? JSON.parse(raw) : {}) as Record<string, string[]>;
      setExpandedGroups(new Set(map[groupByKey] ?? []));
    } catch (err) {
      logger.error(Event.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Failed to read expanded groups from sessionStorage'),
        error: err,
      });
      setExpandedGroups(new Set());
    }
  }, [expandedGroupsStorageKey, groupByKey, groupBy]);

  const searchTerm = searchParams.get('search') ?? '';
  const [isBoardDropdownOpen, setIsBoardDropdownOpen] = useState(false);
  const [isSourceChannelsOpen, setIsSourceChannelsOpen] = useState(false);

  const myTicketBoardsQuery = useQuery({
    queryKey: ['tickets', 'my-board-ids', user?.id],
    queryFn: async (): Promise<{
      boardIds: string[];
      boards: { id: string; name: string; projectId?: string }[];
    }> => {
      const response = await apiInstance.get<{
        boardIds: string[];
        boards: { id: string; name: string; projectId?: string }[];
      }>('/tickets/my-board-ids');
      return {
        boardIds: response.data.boardIds ?? [],
        boards: response.data.boards ?? [],
      };
    },
    // Source channels also needs board data (boards -> projects -> channels),
    // so opening that submenu enables this fetch too.
    enabled:
      viewMode === 'my-tickets' && (isBoardDropdownOpen || isSourceChannelsOpen) && !!user?.id,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const handleBoardDropdownOpenChange = useCallback((open: boolean) => {
    setIsBoardDropdownOpen(open);
  }, []);

  const handleSourceChannelsOpenChange = useCallback((open: boolean) => {
    setIsSourceChannelsOpen(open);
  }, []);

  const setGroupBy = useCallback(
    (value: GroupByType) => {
      const serialized = typeof value === 'object' ? JSON.stringify(value) : value;
      send({ type: 'SET_GROUP_BY', groupBy: serialized });
    },
    [send],
  );

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
  const showOverdueOnly = state.context.showOverdueOnly;

  // Don't query a workspace view until a board is picked (else it fans out across the workspace).
  const workspaceViewReady = !isWorkspaceView || (filters.boards?.length ?? 0) > 0;
  const showSubStatus = state.context.showSubStatus;

  const setShowOverdueOnly = useCallback(
    (next: boolean) => {
      send({ type: 'SET_OVERDUE_ONLY', showOverdueOnly: next });
    },
    [send],
  );

  // Sync persisted sub-status preference into visibleColumns
  useEffect(() => {
    setVisibleColumns(prev => {
      const hasStage = prev.has('stage');
      if (showSubStatus === hasStage) return prev;
      const next = new Set(prev);
      if (showSubStatus) {
        next.add('stage');
      } else {
        next.delete('stage');
      }
      return next;
    });
  }, [showSubStatus]);

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
          logger.error(Event.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('Failed to remove active view from sessionStorage'),
            error: err,
          });
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
              updatedAt: Date.now(),
            }),
          );
        }
      }

      // When "All Boards" is selected while in board view, navigate to the project view so
      // the sidebar correctly shows only the project highlighted (not the old board).
      if (viewMode === 'board' && projectIdParam && !nextFilters.boards?.length) {
        void navigate(`/projects/${projectIdParam}`);
      }
    },
    [
      send,
      channelId,
      viewMode,
      filters.boards,
      zero,
      selectedViewId,
      activeViewKey,
      projectIdParam,
      navigate,
      filters,
      boardId,
      channelId,
    ],
  );

  const handleSetGroupBy = useCallback(
    (value: GroupByType) => {
      if (selectedViewId) {
        setSelectedViewId(null);
        try {
          sessionStorage.removeItem(activeViewKey);
        } catch (err) {
          logger.error(Event.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('Failed to remove active view from sessionStorage'),
            error: err,
          });
        }
      }
      setGroupBy(value);
    },
    [selectedViewId, activeViewKey, setGroupBy],
  );

  // Seed filters/groupBy once when a workspace view mounts.
  const hasSeededViewRef = useRef(false);
  useEffect(() => {
    if (!isWorkspaceView || hasSeededViewRef.current) return;
    if (state.value !== 'initialized') return;
    hasSeededViewRef.current = true;
    const urlHasFilters = Object.keys(state.context.urlFilters ?? {}).length > 0;
    if (urlHasFilters) return;
    setFilters(initialFilters ? { ...initialFilters } : {});
    setGroupBy(initialGroupBy ? parseGroupBy(initialGroupBy) : 'none');
  }, [
    isWorkspaceView,
    state.value,
    state.context.urlFilters,
    initialFilters,
    initialGroupBy,
    setFilters,
    setGroupBy,
  ]);

  const [isSavingWorkspaceView, setIsSavingWorkspaceView] = useState(false);
  const [isSavePopoverOpen, setIsSavePopoverOpen] = useState(false);
  const [workspaceViewNameDraft, setWorkspaceViewNameDraft] = useState('');

  const persistWorkspaceView = useCallback(
    async (name: string): Promise<void> => {
      const values = filtersToValues(
        filters,
        groupByKey,
        Array.from(visibleColumns).filter(key => !DERIVED_COLUMNS.includes(key)),
      );
      setIsSavingWorkspaceView(true);
      try {
        if (viewId) {
          const res = await zero.mutate(
            mutators.savedUserConfiguration.update({
              configId: viewId,
              name,
              timestamp: Date.now(),
              values,
            }),
          ).server;
          if (res.type === 'error') toast.error(res.error?.message ?? 'Failed to save view');
          else toast.success('View updated');
        } else {
          const newId = uuidv4();
          const res = await zero.mutate(
            mutators.savedUserConfiguration.create({
              id: newId,
              name,
              contextType: SavedConfigContextType.BOARD,
              contextId: workspaceId ?? '',
              channelId: '',
              visibility: SavedConfigVisibility.PRIVATE,
              timestamp: Date.now(),
              values,
            }),
          ).server;
          if (res.type === 'error') {
            toast.error(res.error?.message ?? 'Failed to save view');
          } else {
            toast.success('View saved');
            void navigate(`/projects/views/${newId}`);
          }
        }
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Failed to save view');
      } finally {
        setIsSavingWorkspaceView(false);
      }
    },
    [filters, groupByKey, visibleColumns, viewId, workspaceId, zero, navigate],
  );

  const handleSavePopoverOpenChange = useCallback(
    (open: boolean): void => {
      if (open) setWorkspaceViewNameDraft(initialName ?? '');
      setIsSavePopoverOpen(open);
    },
    [initialName],
  );

  const handleConfirmSaveWorkspaceView = useCallback((): void => {
    const name = workspaceViewNameDraft.trim();
    if (!name) return;
    setIsSavePopoverOpen(false);
    setWorkspaceViewNameDraft('');
    void persistWorkspaceView(name);
  }, [workspaceViewNameDraft, persistWorkspaceView]);

  const handleShareWorkspaceView = useCallback((): void => {
    if (!filters.boards?.length) {
      toast.error('Pick at least one board to share');
      return;
    }
    const cfg = { name: initialName ?? '', filters, groupBy: groupByKey };
    const encoded = btoa(encodeURIComponent(JSON.stringify(cfg)));
    const base = window.location.pathname.split('/projects')[0];
    const link = `${window.location.origin}${base}/projects/views/new#cfg=${encoded}`;
    void navigator.clipboard.writeText(link).then(
      () => toast.success('Share link copied to clipboard'),
      () => toast.error('Failed to copy link'),
    );
  }, [filters, groupByKey, initialName]);

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

  // Split board form metadata into two independent views:
  // - groupable fields: only the subset that can be used for group-by
  // - dynamic fields: all board fields used to drive Vespa-backed filters
  const boardFormFields = useMemo(
    () => extractBoardFormFields(filters, selectedBoardDetail ? [selectedBoardDetail] : []),
    [filters.boards, selectedBoardDetail],
  );

  // Detect non-linear board type
  const isNonLinearBoard = selectedBoardDetail?.boardType === BoardType.NON_LINEAR;

  // Flow actions need a project id even where the URL has none (e.g. the
  // my-tickets view with a flow board selected in the filter) — fall back to
  // the board's own project.
  const isFlowBoard = selectedBoardDetail?.boardType === BoardType.FLOW;
  const flowProjectId = effectiveProjectId || selectedBoardDetail?.projectId || null;
  const flowModel = useMemo((): FlowPlanModel | null => {
    if (!isFlowBoard) return null;
    const flowPlan = selectedBoardDetail?.flowPlan;
    return flowPlan ? new FlowPlanModel(deserializeFlowPlan(flowPlan)) : null;
  }, [isFlowBoard, selectedBoardDetail]);

  // On a fresh mount the filters machine is still 'idle', so isFlowBoard/
  // filteredSingleBoardId read false/null for one effect pass — demoting the
  // layout on that snapshot would tear down the flow view on every remount.
  const filtersInitialized = state.matches('initialized');
  useEffect(() => {
    if (isFlowBoard && layoutView !== 'flow') {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          next.set('layout', 'flow');
          return next;
        },
        { replace: true },
      );
    } else if (
      !isFlowBoard &&
      layoutView === 'flow' &&
      filtersInitialized &&
      // no single board selected (e.g. All Boards) — flow view is meaningless;
      // with a single board, wait for its detail to load before deciding
      (!filteredSingleBoardId || selectedBoardDetail)
    ) {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          next.set('layout', 'kanban');
          next.delete('run');
          return next;
        },
        { replace: true },
      );
    }
  }, [
    filtersInitialized,
    isFlowBoard,
    selectedBoardDetail,
    filteredSingleBoardId,
    layoutView,
    setSearchParams,
  ]);
  const handleFlowStatusChange = useCallback(
    async (ticketId: string, statusV2: TicketStatusV2): Promise<void> => {
      const result = zero.mutate(
        mutators.ticket.update({
          id: ticketId,
          statusV2,
          stageName: FLOW_STAGE_NAMES[statusV2],
          updatedAt: Date.now(),
        }),
      );
      const response = await result.server;
      if (response?.type === 'error') {
        throw new Error(response.error.message || 'Failed to update status');
      }
    },
    [zero],
  );

  const handleFlowStepBacklog = useCallback(
    async (ticketId: string): Promise<void> => {
      const result = zero.mutate(
        mutators.ticket.update({
          id: ticketId,
          statusV2: TicketStatusV2.PAUSED,
          stageName: FLOW_STAGE_NAMES.BACKLOG,
          updatedAt: Date.now(),
        }),
      );
      const response = await result.server;
      if (response?.type === 'error') {
        throw new Error(response.error.message || 'Failed to move step to backlog');
      }
    },
    [zero],
  );

  // Transitions (with approvers) are fetched via the dedicated query, not embedded in boardDetailById.
  const [boardStageTransitions] = useCachedQuery(
    queries.getStageTransitionsByBoardId({ boardId: filteredSingleBoardId || '' }),
    {
      enabled: !!filteredSingleBoardId && isNonLinearBoard,
    },
  );

  const transitions: StageTransitionInfo[] = useMemo(() => {
    // Only NON_LINEAR boards use transition-based gating; linear boards keep the legacy path.
    if (!isNonLinearBoard || !boardStageTransitions) return [];
    return boardStageTransitions.map(t => ({
      id: t.id,
      fromStageId: t.fromStageId,
      toStageId: t.toStageId,
      formId: t.formId,
      requiresApproval: t.requiresApproval ?? false, // NULL treated as false
      approvers: (t.transitionApprovers ?? []).map(
        (a: {
          userId: string | null;
          roleId: string | null;
          approverType?: ApproverType | null;
        }) => ({
          approverId: a.userId ?? a.roleId ?? '',
          // NULL approverType (legacy rows) is treated as USER.
          approverType: a.approverType ?? ApproverType.USER,
        }),
      ),
    }));
  }, [isNonLinearBoard, boardStageTransitions]);

  // Create memo of form fields eligible for grouped kanban pagination.
  const groupByFormFields = useMemo(
    () => extractGroupableFormFields(filters, selectedBoardDetail ? [selectedBoardDetail] : []),
    [filters.boards, selectedBoardDetail],
  );
  const boardFieldTypesById = useMemo(
    () => new Map(boardFormFields.map(field => [field.id, field.fieldType])),
    [boardFormFields],
  );
  const dynamicFieldDateRanges = useMemo(() => {
    if (!filters.dynamicFields) return {};

    const ranges: Record<string, { start?: number; end?: number }> = {};
    for (const [fieldId, value] of Object.entries(filters.dynamicFields)) {
      const fieldType = boardFieldTypesById.get(fieldId);
      if (fieldType !== FormFieldType.DATE || Array.isArray(value)) continue;

      const range = value as { start?: number; end?: number };
      if (range.start === undefined && range.end === undefined) continue;
      ranges[fieldId] = {
        ...(range.start !== undefined ? { start: range.start } : {}),
        ...(range.end !== undefined ? { end: range.end } : {}),
      };
    }
    return ranges;
  }, [filters.dynamicFields, boardFieldTypesById]);
  const dynamicFieldVespaTokens = useMemo(() => {
    if (!filters.dynamicFields) return [];

    const tokens = new Set<string>();
    for (const [fieldId, value] of Object.entries(filters.dynamicFields)) {
      if (!Array.isArray(value)) continue;
      value.forEach(item => {
        if (item !== '') tokens.add(`${fieldId}::${item}`);
      });
    }
    const result = Array.from(tokens).sort();
    return result;
  }, [filters.dynamicFields]);
  const zeroOnlyDynamicFieldIds = useMemo<string[]>(() => [], []);

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
      logger.error(Event.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Failed to read active view from sessionStorage'),
        error: err,
      });
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

    // If single board selected in filter, use its stages.
    // Workspace-views always group by status (shouldUseStatusColumns), so never
    // return board stage UUIDs here or columns/counts/drag mode would mismatch.
    if (
      !isWorkspaceView &&
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
      viewMode === 'workspace-view' ||
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
    isWorkspaceView,
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
    // Add only dynamic field filter fieldIds that still need Zero-side filtering.
    if (filters.dynamicFields) {
      zeroOnlyDynamicFieldIds.forEach(fieldId => ids.add(fieldId));
    }
    // Add groupBy fieldId if grouping by form field
    if (groupByFieldId) ids.add(groupByFieldId);
    return Array.from(ids);
  }, [groupByFieldId, zeroOnlyDynamicFieldIds]);

  // CENTRALIZED TICKET QUERY - fetch only tickets relevant to the current context.
  // Dynamic field filtering is done CLIENT-SIDE via applyTicketFilters.
  // When fevFieldIds is non-empty, formEntityValues are fetched as a related query.
  const ticketsQueryParams = useMemo(() => {
    const params: FlowStepVisibilityOptions & {
      viewMode: 'project' | 'board' | 'my-tickets' | 'user-tickets' | 'group-tickets';
      channelId?: string;
      projectId?: string;
      boardId?: string;
      userId?: string;
      groupId?: string;
      formEntityValueFieldIds?: string[];
    } = withTicketChannelScope({ viewMode: queryViewMode }, channelId);

    // Always pass boardId if it exists (from URL param)
    // Board ID implicitly scopes to project, so no need for projectId in this case
    if (boardId) {
      params.boardId = boardId;
    }

    // If a board is selected via filter, use that (overrides URL boardId if present).
    // my-tickets can still scope by boardId, but it should never receive projectId.
    if (filters.boards && filters.boards.length === 1 && filters.boards[0]) {
      params.boardId = filters.boards[0];
    }

    // Pass projectId ONLY if:
    // 1. No boardId exists (boardId is more specific and implies project)
    // 2. viewMode is not 'my-tickets' (should be cross-project)
    if (!params.boardId && viewMode !== 'my-tickets' && effectiveProjectId) {
      params.projectId = effectiveProjectId;
    }

    // rootId is reserved for materialized FLOW step tickets. Aggregate board
    // views show the run's root ticket once instead of every generated step.
    if (!filteredSingleBoardId) {
      params.excludeFlowSteps = true;
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
    queryViewMode,
    boardId,
    effectiveProjectId,
    filterByUserId,
    filterByGroupId,
    filteredSingleBoardId,
    fevFieldIds,
    filters.boards,
    channelId,
  ]);

  const [allProjectTickets, ticketsDetails] = useCachedQuery(
    queries.ticketsQueryV2(ticketsQueryParams),
    {
      enabled:
        !isKanbanLayout &&
        ((viewMode === 'board' && !!boardId) ||
          (viewMode === 'project' && !!effectiveProjectId) ||
          viewMode === 'my-tickets' ||
          (viewMode === 'user-tickets' && !!filterByUserId) ||
          (viewMode === 'group-tickets' && !!filterByGroupId)),
    },
  );
  if (shouldUseLegacyTicketsQuery && ticketsDetails.type === 'complete') {
    logEntityTiming('allProjectTickets');
  }

  const kanbanSourceTickets = useMemo(() => {
    if (!isKanbanLayout) {
      return allProjectTickets ?? undefined;
    }

    return localTickets ?? [];
  }, [allProjectTickets, isKanbanLayout, localTickets]);

  // Collect the unique board IDs visible on screen.
  //
  // Priority:
  //  1. Single-board view (URL param or single filter entry) — cheapest, no ticket scan.
  //  2. Explicit multi-board filter — boards are already known from filter state.
  //  3. All-boards channel/project view — derive from loaded tickets. Returns [] while
  //     tickets are still loading; Zero reactively re-fetches once they arrive.
  const visibleBoardIds = useMemo((): string[] => {
    if (!isEmailChannel) return [];
    if (filteredSingleBoardId) return [filteredSingleBoardId];
    if (filters.boards && filters.boards.length > 0) return filters.boards;
    return Array.from(
      new Set((kanbanSourceTickets ?? []).map(t => t.boardId).filter((id): id is string => !!id)),
    );
  }, [isEmailChannel, filteredSingleBoardId, filters.boards, kanbanSourceTickets]);

  // Fetch lightweight board metadata for all visible boards so we can determine
  // which ones use priority-based SLA. Only needed for EMAIL channels that
  // support SLA policies. In single-board view selectedBoardDetail already
  // contains metadata, so boardsByIds is disabled to avoid a duplicate
  // subscription. In multi-board view boardsByIds is the only source.
  const [visibleBoards] = useCachedQuery(queries.boardsByIds({ boardIds: visibleBoardIds }), {
    enabled: isEmailChannel && visibleBoardIds.length > 1,
  });

  // Narrow the visible board IDs to only those configured for priority-based SLA.
  // Only applicable for EMAIL channels; non-EMAIL channels have no SLA policies.
  const prioritySlaBoardIds = useMemo((): string[] => {
    if (!isEmailChannel) return [];
    if (filteredSingleBoardId) {
      // Single-board: metadata is already in selectedBoardDetail.
      const meta = selectedBoardDetail?.metadata as BoardMetadata | null | undefined;
      return meta?.slaPolicyType === 'priority' ? [filteredSingleBoardId] : [];
    }
    // Multi-board: filter using metadata returned by boardsByIds.
    return (visibleBoards ?? [])
      .filter(b => (b.metadata as BoardMetadata | null | undefined)?.slaPolicyType === 'priority')
      .map(b => b.id);
  }, [isEmailChannel, filteredSingleBoardId, selectedBoardDetail, visibleBoards]);

  // One subscription for all priority-SLA boards on screen. TicketCard looks up
  // the policy by boardId + priority, so no per-card fetches are needed.
  const kanbanSlaPolicies = useBoardsSlaPolicies(prioritySlaBoardIds);
  const allUsers = useUsers();
  const allUserGroups = useUserGroups();

  // Calculate available priorities, users, and user groups from ALL project tickets (not filtered)
  // Return undefined if tickets haven't loaded yet to prevent filtering out all options
  const availablePriorities = useMemo(() => {
    return Object.values(TicketPriority);
  }, []);

  const { availableUsers, hasPrReviewers, hasQaAssigned } = useMemo(() => {
    const userIds = new Set<string>();
    let hasPrReviewers = false;
    let hasQaAssigned = false;
    (kanbanSourceTickets as KanbanLocalTicket[] | undefined)?.forEach(ticket => {
      if (ticket.assignedTo) userIds.add(ticket.assignedTo);
      userIds.add(ticket.createdBy);
      if (Array.isArray(ticket.assignments)) {
        ticket.assignments.forEach(assignment => {
          if (assignment.userId) userIds.add(assignment.userId);
          const responsibility = assignment.userResponsibility as UserResponsibility;
          if (!hasPrReviewers && responsibility === UserResponsibility.PR_REVIEWER) {
            hasPrReviewers = true;
          } else if (!hasQaAssigned && responsibility === UserResponsibility.QA) {
            hasQaAssigned = true;
          }
        });
      }
    });
    return { availableUsers: Array.from(userIds), hasPrReviewers, hasQaAssigned };
  }, [kanbanSourceTickets]);

  // Get available board IDs based on view mode (only needed for my-tickets views)
  // Hydrate from the dedicated API call and merge in any boards from loaded tickets
  // so the dropdown can fill in progressively.
  const availableBoards = useMemo(() => {
    if (isMyTicketsView) {
      const boardIds = new Set<string>(myTicketBoardsQuery.data?.boardIds ?? []);
      if (kanbanSourceTickets && kanbanSourceTickets.length > 0) {
        kanbanSourceTickets.forEach(ticket => {
          if (ticket.boardId) boardIds.add(ticket.boardId);
        });
      }
      return Array.from(boardIds);
    }
    return undefined;
  }, [kanbanSourceTickets, isMyTicketsView, myTicketBoardsQuery.data?.boardIds]);

  const availableBoardDetails = useMemo(() => {
    if (viewMode === 'my-tickets') {
      return myTicketBoardsQuery.data?.boards ?? [];
    }
    return undefined;
  }, [myTicketBoardsQuery.data, viewMode]);

  const [workspaceSelectedBoards] = useCachedQuery(
    queries.boardsByIds({ boardIds: filters.boards ?? [] }),
    {
      enabled: isWorkspaceView && isSourceChannelsOpen && (filters.boards?.length ?? 0) > 0,
    },
  );
  const sourceChannelProjectIds = useMemo(() => {
    if (isMyTicketsView) {
      const selected = filters.boards ?? [];
      const details = availableBoardDetails ?? [];
      // No board selected -> all projects behind the boards dropdown; otherwise only the selected boards' projects.
      return uniqueProjectIds(
        selected.length === 0 ? details : details.filter(board => selected.includes(board.id)),
      );
    }
    if (isWorkspaceView) {
      return uniqueProjectIds(workspaceSelectedBoards ?? []);
    }
    return [];
  }, [
    isMyTicketsView,
    isWorkspaceView,
    filters.boards,
    availableBoardDetails,
    workspaceSelectedBoards,
  ]);

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

  const [projectTags, projectTagsDetails] = useCachedQuery(
    queries.projectTagsByProjectId({ projectId: effectiveProjectId || '' }),
    { enabled: !!effectiveProjectId },
  );

  // Create a map of stageId -> formId for quick lookup (from stages.formId).
  // NON_LINEAR boards also include transition-level forms (toStageId -> formId).
  const stageFormMap = useMemo(() => {
    const map = new Map<string, string>();
    if (stages) {
      stages.forEach(stage => {
        if (stage.formId) {
          map.set(stage.id, stage.formId);
        }
      });
    }
    if (isNonLinearBoard && boardStageTransitions) {
      boardStageTransitions.forEach(t => {
        if (t.formId) {
          map.set(t.toStageId, t.formId);
        }
      });
    }
    return map;
  }, [stages, isNonLinearBoard, boardStageTransitions]);

  const tagsByTicketId = useMemo(() => {
    const map = new Map<
      string,
      { workspaceId: string; id: string; name: string; ticketId: string }[]
    >();
    if (!kanbanSourceTickets) return map;
    for (const ticket of kanbanSourceTickets as KanbanLocalTicket[]) {
      const ticketTags =
        ticket.tagMappings && ticket.tagMappings.length > 0
          ? ticket.tagMappings.map((m: { id: string; tagName: string; ticketId: string }) => ({
              workspaceId: ticket.workspaceId ?? null,
              id: m.id,
              name: m.tagName,
              ticketId: m.ticketId,
            }))
          : Array.isArray(ticket.tags)
            ? ticket.tags
                .map((tag: { id: string; name: string; ticketId?: string }) => ({
                  workspaceId: ticket.workspaceId,
                  id: tag.id,
                  name: tag.name,
                  ticketId: ticket.id,
                }))
                .filter((tag: { id: string; name: string; ticketId: string }) => Boolean(tag.name))
            : [];
      if (ticketTags.length > 0) {
        map.set(ticket.id, ticketTags);
      }
    }
    return map;
  }, [kanbanSourceTickets]);
  if (projectTagsDetails.type === 'complete') logEntityTiming('tags');

  // ============================================================================
  // FORM ENTITY VALUES — fetched as related data on tickets when fevFieldIds is non-empty.
  // Extract formEntityValues from tickets and build lookup maps for filtering/grouping.
  // ============================================================================

  // Build maps used by applyTicketFilters and groupTicketsByFormField.
  //   formValuesByTicketId: ticketId → FEV rows
  //   formFieldsById: fieldId → { fieldType, fieldEnum }
  const { formValuesByTicketId, formFieldsById } = useMemo(() => {
    const valuesMap = new Map<string, FormEntityValues[]>();
    const fieldsMap = new Map<
      string,
      { fieldType: FormFieldType; fieldEnum?: FieldEnumOption[] | null }
    >();

    // Extract formEntityValues from tickets (when fetched as related data)
    if (kanbanSourceTickets && fevFieldIds.length > 0) {
      (kanbanSourceTickets as KanbanLocalTicket[]).forEach(ticket => {
        const ticketFEVs = ticket.formEntityValues;
        if (ticketFEVs && ticketFEVs.length > 0) {
          // Filter to only include FEVs for the fieldIds we're interested in
          if (ticketFEVs.length > 0) {
            valuesMap.set(ticket.id, ticketFEVs);

            // Build field metadata map from the related formField data
            ticketFEVs.forEach(fev => {
              if (fev.formField && !fieldsMap.has(fev.fieldId)) {
                fieldsMap.set(fev.fieldId, {
                  fieldType: fev.formField.fieldType,
                  fieldEnum: parseFieldOptions(
                    fev.formField.fieldOptions ?? fev.formField.fieldEnum,
                  ),
                });
              }
            });
          }
        }
      });
    }

    return { formValuesByTicketId: valuesMap, formFieldsById: fieldsMap };
  }, [fevFieldIds, kanbanSourceTickets]);
  if (
    shouldUseLegacyTicketsQuery &&
    (fevFieldIds.length === 0 || ticketsDetails.type === 'complete')
  )
    logEntityTiming('formEntityValues');

  // Filter tickets based on view mode and filters.
  // NOTE: ALL filters including dynamic field filters are applied CLIENT-SIDE.
  //
  // In a channel Kanban view a board can be shared across multiple channels, so
  // the board's tickets are not all "this channel's" tickets. Scope every ticket
  // path (page fetch, counts, board-nav args, legacy client filter) to tickets
  // created in this channel by forcing `sourceChannels` to the current channel.
  // This applies both when a specific board is selected and in the "All Boards"
  // view. The filter dropdown UI still reads the raw `filters`, so this scoping
  // stays invisible there.
  const scopedFilters = useMemo(() => {
    if (channelId && viewMode === 'project') {
      return { ...filters, sourceChannels: [channelId] };
    }
    return filters;
  }, [filters, channelId, viewMode]);

  const deferredFilters = useDeferredValue(scopedFilters);

  const filteredTickets = useMemo(() => {
    if (!shouldUseLegacyTicketsQuery || !allProjectTickets) {
      return undefined;
    }

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
      tickets = tickets.filter(ticket => isStageOverdue(ticket));
    }

    return tickets;
  }, [
    shouldUseLegacyTicketsQuery,
    allProjectTickets,
    deferredFilters,
    tagsByTicketId,
    formValuesByTicketId,
    formFieldsById,
    searchTerm,
    user?.id,
    showOverdueOnly,
  ]);

  if (
    shouldUseLegacyTicketsQuery &&
    ticketsDetails.type === 'complete' &&
    projectTagsDetails.type === 'complete'
  ) {
    logEntityTiming('filteredTickets');
  }

  const graphTickets = useMemo(() => filteredTickets ?? [], [filteredTickets]);
  const graphTicketIds = useMemo(
    () => (layoutView === 'flow' ? graphTickets.map(ticket => ticket.id) : []),
    [graphTickets, layoutView],
  );
  const flowRunActivityTicketIds = useMemo(() => {
    if (!flowActivityOpen || !isFlowBoard || !selectedGraphRootTicketId) return [];
    return graphTickets
      .filter(
        ticket =>
          ticket.id === selectedGraphRootTicketId || ticket.rootId === selectedGraphRootTicketId,
      )
      .map(ticket => ticket.id)
      .sort();
  }, [flowActivityOpen, graphTickets, isFlowBoard, selectedGraphRootTicketId]);
  const flowRunActivityScopeKey = `${selectedGraphRootTicketId ?? ''}:${flowRunActivityTicketIds.join(',')}`;
  const [flowRunActivityPageState, setFlowRunActivityPageState] = useState<{
    scopeKey: string;
    activities: FlowRunActivity[];
    hasMore: boolean;
  }>({ scopeKey: '', activities: [], hasMore: true });
  const flowRunActivityFetchScopeRef = useRef<string | null>(null);
  const [flowRunActivityLoadingScope, setFlowRunActivityLoadingScope] = useState<string | null>(
    null,
  );
  const [firstFlowRunActivityPage, firstFlowRunActivityPageDetails] = useCachedQuery(
    queries.ticketActivitiesForTickets({
      ticketIds: flowRunActivityTicketIds,
      limit: FLOW_RUN_ACTIVITY_PAGE_SIZE,
      start: null,
    }),
    {
      enabled:
        flowActivityOpen &&
        isFlowBoard &&
        !!selectedGraphRootTicketId &&
        flowRunActivityTicketIds.length > 0,
    },
  );
  useEffect(() => {
    if (
      flowRunActivityTicketIds.length === 0 ||
      firstFlowRunActivityPageDetails.type !== 'complete'
    ) {
      return;
    }
    const firstPage = firstFlowRunActivityPage ?? [];
    setFlowRunActivityPageState(previous => {
      const sameScope = previous.scopeKey === flowRunActivityScopeKey;
      return {
        scopeKey: flowRunActivityScopeKey,
        activities: mergeFlowRunActivities(sameScope ? previous.activities : [], firstPage),
        hasMore: sameScope ? previous.hasMore : firstPage.length === FLOW_RUN_ACTIVITY_PAGE_SIZE,
      };
    });
  }, [
    firstFlowRunActivityPage,
    firstFlowRunActivityPageDetails.type,
    flowRunActivityScopeKey,
    flowRunActivityTicketIds.length,
  ]);
  const loadedFlowRunActivities = useMemo(
    () =>
      flowRunActivityPageState.scopeKey === flowRunActivityScopeKey
        ? flowRunActivityPageState.activities
        : [],
    [
      flowRunActivityPageState.activities,
      flowRunActivityPageState.scopeKey,
      flowRunActivityScopeKey,
    ],
  );
  const flowRunHasMoreActivities =
    flowRunActivityPageState.scopeKey === flowRunActivityScopeKey
      ? flowRunActivityPageState.hasMore
      : true;
  const loadMoreFlowRunActivities = useCallback(() => {
    if (
      loadedFlowRunActivities.length === 0 ||
      !flowRunHasMoreActivities ||
      flowRunActivityFetchScopeRef.current === flowRunActivityScopeKey
    ) {
      return;
    }
    const oldestActivity = loadedFlowRunActivities.at(-1);
    if (!oldestActivity) return;

    const requestedScopeKey = flowRunActivityScopeKey;
    const requestedTicketIds = [...flowRunActivityTicketIds];
    flowRunActivityFetchScopeRef.current = requestedScopeKey;
    setFlowRunActivityLoadingScope(requestedScopeKey);
    void zero
      .run(
        queries.ticketActivitiesForTickets({
          ticketIds: requestedTicketIds,
          limit: FLOW_RUN_ACTIVITY_PAGE_SIZE,
          start: { timestamp: oldestActivity.timestamp, id: oldestActivity.id },
        }),
        { type: 'complete' },
      )
      .then(nextPage => {
        setFlowRunActivityPageState(previous => {
          if (previous.scopeKey !== requestedScopeKey) return previous;
          const page = nextPage ?? [];
          return {
            ...previous,
            activities: mergeFlowRunActivities(previous.activities, page),
            hasMore: page.length === FLOW_RUN_ACTIVITY_PAGE_SIZE,
          };
        });
      })
      .catch(error => {
        logger.error(Event.ZERO_RUN_ERROR, {
          error,
          query: 'ticketActivitiesForTickets',
        });
      })
      .finally(() => {
        if (flowRunActivityFetchScopeRef.current === requestedScopeKey) {
          flowRunActivityFetchScopeRef.current = null;
        }
        setFlowRunActivityLoadingScope(current => (current === requestedScopeKey ? null : current));
      });
  }, [
    flowRunActivityScopeKey,
    flowRunActivityTicketIds,
    flowRunHasMoreActivities,
    loadedFlowRunActivities,
    zero,
  ]);
  const flowRunActivityLoadMoreRef = useIntersectionObserver<HTMLDivElement>(
    loadMoreFlowRunActivities,
    { threshold: 0.1, triggerOnce: false },
  );
  const flowRunTimelineActivities = useMemo(
    () =>
      loadedFlowRunActivities.filter(activity => {
        if (activity.activityType !== ActivityType.STATUS) return true;
        const value = activity.value as { field?: string } | null;
        return value?.field === 'stageName';
      }),
    [loadedFlowRunActivities],
  );
  const flowRunTicketById = useMemo(
    () => new Map(graphTickets.map(ticket => [ticket.id, ticket])),
    [graphTickets],
  );
  const [graphSubTicketMappings] = useCachedQuery(
    queries.subTicketMappingsForTickets({ ticketIds: graphTicketIds }),
    {
      enabled: layoutView === 'flow' && graphTicketIds.length > 0,
    },
  );
  const ticketGraphNodes = useMemo(() => {
    const ticketsById = new Map<string, Ticket>();
    graphTickets.forEach(ticket => ticketsById.set(ticket.id, ticket));
    const mappingsByParent = new Map<string, TicketGraphMapping[]>();
    const childTicketIds = new Set<string>();
    graphSubTicketMappings?.forEach(mapping => {
      const mappings = mappingsByParent.get(mapping.ticketId);
      if (mappings) {
        mappings.push(mapping);
      } else {
        mappingsByParent.set(mapping.ticketId, [mapping]);
      }
      const subTicket = mapping.subTicket;
      if (subTicket?.mappedTicketId) {
        childTicketIds.add(subTicket.mappedTicketId);
      }
      if (subTicket?.mappedTicket && !ticketsById.has(subTicket.mappedTicket.id)) {
        ticketsById.set(subTicket.mappedTicket.id, subTicket.mappedTicket as Ticket);
      }
    });
    const toTicketNode = (
      ticket: Ticket,
      depth: number,
      visitedTicketIds: Set<string>,
      subTicket?: TicketGraphSubTicket,
    ): TicketGraphNode => {
      const childMappings = mappingsByParent.get(ticket.id) ?? [];
      const children = childMappings
        .map(mapping => {
          const childSubTicket = mapping.subTicket;
          if (!childSubTicket) return null;
          const mappedTicket = childSubTicket.mappedTicketId
            ? ticketsById.get(childSubTicket.mappedTicketId)
            : undefined;
          if (mappedTicket && !visitedTicketIds.has(mappedTicket.id)) {
            return toTicketNode(
              mappedTicket,
              depth + 1,
              new Set([...visitedTicketIds, mappedTicket.id]),
              childSubTicket,
            );
          }
          return {
            key: `sub-ticket:${childSubTicket.id}`,
            subTicket: childSubTicket,
            displayId: childSubTicket.id.substring(0, 8).toUpperCase(),
            title: childSubTicket.title || 'Untitled sub-ticket',
            depth: depth + 1,
            children: [],
          } satisfies TicketGraphNode;
        })
        .filter((node): node is TicketGraphNode => node !== null);
      return {
        key: ticket.id,
        ticket,
        ...(subTicket ? { subTicket } : {}),
        displayId: ticket.xyneId || ticket.id.substring(0, 8).toUpperCase(),
        title: ticket.title || 'Untitled Ticket',
        statusLabel: ticket.stageName || ticket.statusV2,
        priority: ticket.priority ?? null,
        assignedTo: ticket.assignedTo ?? null,
        depth,
        children,
      };
    };
    const rootTickets = graphTickets.filter(ticket => !childTicketIds.has(ticket.id));
    const roots = rootTickets.length > 0 ? rootTickets : graphTickets;
    return roots.map(ticket => toTicketNode(ticket, 0, new Set([ticket.id])));
  }, [graphSubTicketMappings, graphTickets]);
  useEffect(() => {
    if (!selectedGraphRootTicketId || ticketsDetails.type !== 'complete' || !filtersInitialized) {
      return;
    }
    // An empty node list is usually a reloading artifact (queries restart on
    // remount), not proof the run is gone — clear only when other roots have
    // loaded, or when the settled unfiltered project list lacks the run
    // entirely (deleted run / bad shared link on an empty board).
    if (
      !ticketGraphNodes.some(root => root.key === selectedGraphRootTicketId) &&
      (ticketGraphNodes.length > 0 ||
        !(allProjectTickets ?? []).some(ticket => ticket.id === selectedGraphRootTicketId))
    ) {
      setSelectedGraphRootTicketId(null, { replace: true });
    }
  }, [
    allProjectTickets,
    filtersInitialized,
    selectedGraphRootTicketId,
    setSelectedGraphRootTicketId,
    ticketGraphNodes,
    ticketsDetails.type,
  ]);
  useEffect(() => {
    if (!selectedGraphRootTicketId) setFlowSelection(null);
    // Search and the thread panel are scoped to one run
    setFlowRunSearchQuery('');
    setFlowThreadTicket(null);
  }, [selectedGraphRootTicketId]);
  // The two floating panels are mutually exclusive
  useEffect(() => {
    if (flowSelection) setFlowThreadTicket(null);
  }, [flowSelection]);
  const handleShowFlowTicketDetails = useCallback((ticket: FlowRunTicket): void => {
    setFlowSelection(null);
    setFlowThreadTicket(ticket);
  }, []);
  const selectedFlowRunRootTicket = useMemo(() => {
    if (!selectedGraphRootTicketId) return null;
    return (
      (graphTickets as unknown as FlowRunTicket[]).find(
        ticket => ticket.id === selectedGraphRootTicketId,
      ) ?? null
    );
  }, [graphTickets, selectedGraphRootTicketId]);
  const selectedFlowRunModel = useMemo(() => {
    if (!flowModel || !selectedGraphRootTicketId || !selectedFlowRunRootTicket) return null;
    const flowTickets = graphTickets as unknown as FlowRunTicket[];
    return buildFlowRunModel(
      flowModel,
      selectedFlowRunRootTicket,
      mapPlanToRunTickets(flowTickets, selectedGraphRootTicketId),
    );
  }, [flowModel, graphTickets, selectedFlowRunRootTicket, selectedGraphRootTicketId]);
  const handleFlowGroupBacklog = useCallback(
    async (groupId: string): Promise<void> => {
      if (!selectedFlowRunModel || !selectedGraphRootTicketId || flowGroupBacklogPendingId) return;
      const group = selectedFlowRunModel.getGroup(groupId);
      if (!group) return;
      const memberCount = selectedFlowRunModel.descendantMembersOf(groupId).length;
      const accepted = await confirm({
        title: `Move "${group.name || 'Group'}" to backlog?`,
        description: `This will create any missing tickets and move all ${memberCount} non-terminal steps${selectedFlowRunModel.childGroupsOf(groupId).length > 0 ? ', including nested groups,' : ''} to backlog. Completed, cancelled, and skipped steps stay unchanged.`,
        confirmLabel: 'Move to backlog',
      });
      if (!accepted) return;
      setFlowGroupBacklogPendingId(groupId);
      try {
        const response = await apiInstance.post<{
          createdCount: number;
          backloggedCount: number;
          unchangedCount: number;
        }>(
          `/tickets/${encodeURIComponent(selectedGraphRootTicketId)}/flow-groups/${encodeURIComponent(groupId)}/backlog`,
        );
        const { backloggedCount, createdCount } = response.data;
        toast.success(
          `${backloggedCount} ${backloggedCount === 1 ? 'step' : 'steps'} moved to backlog`,
          createdCount > 0
            ? {
                description: `${createdCount} missing ${createdCount === 1 ? 'ticket was' : 'tickets were'} created.`,
              }
            : undefined,
        );
      } catch (error) {
        toast.error('Failed to move group to backlog', {
          description: getApiErrorMessage(error, 'Please retry.'),
        });
      } finally {
        setFlowGroupBacklogPendingId(null);
      }
    },
    [confirm, flowGroupBacklogPendingId, selectedFlowRunModel, selectedGraphRootTicketId],
  );
  const selectedFlowRunBacklogs = useMemo((): FlowNodeSelection[] => {
    if (!selectedFlowRunModel || !selectedGraphRootTicketId) return [];
    const runTickets = mapPlanToRunTickets(
      graphTickets as unknown as FlowRunTicket[],
      selectedGraphRootTicketId,
    );
    const hasWaitingStep = [...runTickets.values()].some(
      ticket =>
        !isFlowStepBacklogged(ticket) &&
        (ticket.statusV2 === TicketStatusV2.PAUSED || ticket.statusV2 === TicketStatusV2.STARTED),
    );
    if (hasWaitingStep) return [];
    return selectedFlowRunModel.nodes
      .map(planNode => ({ planNode, ticket: runTickets.get(planNode.id) ?? null, skipped: false }))
      .filter((step): step is { planNode: FlowPlanNode; ticket: FlowRunTicket; skipped: boolean } =>
        isFlowStepBacklogged(step.ticket),
      )
      .sort((left, right) => left.planNode.order - right.planNode.order);
  }, [graphTickets, selectedFlowRunModel, selectedGraphRootTicketId]);
  const flowRunGraph = useFlowRunGraph({
    isFlowBoard,
    selectedFlowRunModel,
    selectedGraphRootTicketId,
    graphTickets,
    collapsedFlowGroups,
    setCollapsedFlowGroups,
    flowSelection,
    setFlowSelection,
    flowGroupBacklogPendingId,
    handleFlowGroupBacklog,
  });
  // On entering a run, auto-open the panel for the first step waiting at its
  // gate (or the main ticket when nothing is waiting yet) — once per run.
  const flowTicketNodes = useMemo(
    () =>
      flowRunGraph.nodes.filter(
        (graphNode): graphNode is Node<FlowTicketNodeData> => graphNode.type === 'flowTicketNode',
      ),
    [flowRunGraph],
  );
  // null = search inactive, so nothing is dimmed
  const flowRunSearchMatches = useMemo((): Set<string> | null => {
    const query = flowRunSearchQuery.trim().toLowerCase();
    if (!query || !selectedGraphRootTicketId || !selectedFlowRunModel) return null;
    const matchesQuery = (...values: Array<string | null | undefined>): boolean =>
      values.some(value => value?.toLowerCase().includes(query));
    const matches = new Set<string>();
    if (
      selectedFlowRunRootTicket &&
      matchesQuery(selectedFlowRunRootTicket.xyneId, selectedFlowRunRootTicket.title)
    ) {
      matches.add(FLOW_VIRTUAL_ROOT_ID);
    }
    const runTickets = mapPlanToRunTickets(
      graphTickets as unknown as FlowRunTicket[],
      selectedGraphRootTicketId,
    );
    for (const planNode of selectedFlowRunModel.nodes) {
      const ticket = runTickets.get(planNode.id);
      // `||`: an empty ticket title must fall back to the plan node's title,
      // which is what the card renders.
      if (matchesQuery(ticket?.xyneId, ticket?.title || planNode.title)) {
        matches.add(planNode.id);
      }
    }
    return matches;
  }, [
    flowRunSearchQuery,
    graphTickets,
    selectedFlowRunModel,
    selectedFlowRunRootTicket,
    selectedGraphRootTicketId,
  ]);
  // A cover counts as a hit when any descendant step matches, so a match stays
  // visible while its group is collapsed.
  const flowRunSearchHitNodeIds = useMemo((): Set<string> | null => {
    if (!flowRunSearchMatches) return null;
    const hits = new Set(flowRunSearchMatches);
    for (const group of selectedFlowRunModel?.groups ?? []) {
      if (
        selectedFlowRunModel
          ?.descendantMembersOf(group.id)
          .some(member => flowRunSearchMatches.has(member.id))
      ) {
        hits.add(flowGroupCoverId(group.id));
      }
    }
    return hits;
  }, [flowRunSearchMatches, selectedFlowRunModel]);
  const searchedFlowRunNodes = useMemo(() => {
    if (!flowRunSearchHitNodeIds) return flowRunGraph.nodes;
    return flowRunGraph.nodes.map(graphNode => ({
      ...graphNode,
      className: flowRunSearchHitNodeIds.has(graphNode.id) ? 'flow-search-hit' : 'flow-search-miss',
    }));
  }, [flowRunGraph.nodes, flowRunSearchHitNodeIds]);
  const flowRunSummaries = useMemo<Map<string, FlowRunSummary>>(
    () =>
      isFlowBoard && flowModel
        ? summarizeFlowRuns(flowModel, graphTickets as unknown as FlowRunTicket[])
        : new Map<string, FlowRunSummary>(),
    [isFlowBoard, flowModel, graphTickets],
  );
  const userNamesById = useMemo(() => {
    const map = new Map<string, string>();
    if (allUsers) {
      allUsers.forEach(user => {
        map.set(user.id, getUserDisplayName(user));
      });
    }
    return map;
  }, [allUsers]);
  const flowRunExportRows = useMemo(() => {
    if (!isFlowBoard || !flowModel) return [];
    return buildFlowRunExportRows({
      currentModel: flowModel,
      visibleTickets: graphTickets as unknown as FlowRunTicket[],
      allTickets: (allProjectTickets ?? graphTickets) as unknown as FlowRunTicket[],
      userNamesById,
    });
  }, [allProjectTickets, flowModel, graphTickets, isFlowBoard, userNamesById]);
  const flowRunExportTitle = `${selectedBoardDetail?.name ?? 'Flow board'} — Ticket Tracker`;
  const selectedRunExportRows = useMemo(() => {
    if (!isFlowBoard || !flowModel || !selectedFlowRunRootTicket) return [];
    return buildFlowRunExportRows({
      currentModel: flowModel,
      visibleTickets: [selectedFlowRunRootTicket],
      allTickets: (allProjectTickets ?? graphTickets) as unknown as FlowRunTicket[],
      userNamesById,
    });
  }, [
    allProjectTickets,
    flowModel,
    graphTickets,
    isFlowBoard,
    selectedFlowRunRootTicket,
    userNamesById,
  ]);
  const selectedRunExportTitle = selectedFlowRunRootTicket
    ? `${selectedFlowRunRootTicket.xyneId} ${selectedFlowRunRootTicket.title} — Ticket Tracker`
    : flowRunExportTitle;
  const flowAskAIThreadInfo = useMemo((): ThreadInfo | null => {
    if (!selectedFlowRunRootTicket?.conversationId) return null;
    return {
      conversationId: selectedFlowRunRootTicket.conversationId,
      ...(selectedFlowRunRootTicket.channelId && {
        channelId: selectedFlowRunRootTicket.channelId,
      }),
      previewText: `${selectedFlowRunRootTicket.xyneId} ${selectedFlowRunRootTicket.title}`,
    };
  }, [selectedFlowRunRootTicket]);
  const handleFlowRunExport = useCallback(
    async (format: 'excel' | 'pdf'): Promise<void> => {
      const rows = selectedGraphRootTicketId ? selectedRunExportRows : flowRunExportRows;
      const title = selectedGraphRootTicketId ? selectedRunExportTitle : flowRunExportTitle;
      if (rows.length === 0 || flowRunExporting) return;
      setFlowRunExporting(format);
      try {
        if (format === 'excel') {
          await downloadFlowRunsExcel(title, rows);
        } else {
          await downloadFlowRunsPdf(title, rows);
        }
        toast.success(`${format === 'excel' ? 'Excel' : 'PDF'} downloaded`);
      } catch {
        toast.error(`Failed to download ${format === 'excel' ? 'Excel' : 'PDF'}`);
      } finally {
        setFlowRunExporting(null);
      }
    },
    [
      flowRunExportRows,
      flowRunExportTitle,
      flowRunExporting,
      selectedGraphRootTicketId,
      selectedRunExportRows,
      selectedRunExportTitle,
    ],
  );
  // Shared by both flow headers — only the triggers differ per screen
  const flowExportDropdownMenu = (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align='end'
        sideOffset={6}
        className='z-50 min-w-40 rounded-lg border border-border bg-background p-1 shadow-xl'
      >
        <DropdownMenu.Item
          onSelect={() => void handleFlowRunExport('excel')}
          className='flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-xs text-foreground outline-none data-[highlighted]:bg-muted'
        >
          <FileSpreadsheet className='h-4 w-4 text-emerald-600' />
          Excel (.xlsx)
        </DropdownMenu.Item>
        <DropdownMenu.Item
          onSelect={() => void handleFlowRunExport('pdf')}
          className='flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-xs text-foreground outline-none data-[highlighted]:bg-muted'
        >
          <FileText className='h-4 w-4 text-red-500' />
          PDF (.pdf)
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
  // Auto-advance: jump to the next waiting step ONLY on a transition we
  // witnessed while the selection stayed put — a viewed step settling
  // (completes/cancels), or the main ticket going to STARTED (start/resume).
  // Manual clicks never move the selection: clicking the main ticket to pause
  // it, or an already-finished step, leaves it exactly where the user put it.
  const flowRunInstanceRef = useRef<ReactFlowInstance | null>(null);
  const pendingFlowFocusRef = useRef<string | null>(null);
  // The node the viewport is parked on, so a canvas resize restores that
  // framing instead of a whole-graph fit. Cleared when the user pans/zooms.
  const focusedFlowNodeRef = useRef<string | null>(null);
  // Animate the viewport only after React Flow has measured the destination.
  // A pending request stays armed when its containing group is still collapsed;
  // the graph-nodes effect below retries after expansion renders the member.
  const focusFlowNode = useCallback((nodeId: string): void => {
    pendingFlowFocusRef.current = nodeId;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const instance = flowRunInstanceRef.current;
        if (!instance || pendingFlowFocusRef.current !== nodeId || !instance.getNode(nodeId))
          return;
        pendingFlowFocusRef.current = null;
        focusedFlowNodeRef.current = nodeId;
        void instance.fitView({
          nodes: [{ id: nodeId }],
          maxZoom: 1,
          padding: 0.4,
          duration: 500,
        });
      });
    });
  }, []);
  useEffect(() => {
    const pendingNodeId = pendingFlowFocusRef.current;
    if (pendingNodeId) focusFlowNode(pendingNodeId);
  }, [flowRunGraph.nodes, focusFlowNode]);
  // React Flow only fits its content on mount — re-fit whenever the canvas
  // changes width (side panels docking, divider drags, window resizes). A
  // callback ref, not an effect: the canvas mounts only once board detail AND
  // tickets resolve, and an effect can't reliably know when that happens.
  const flowCanvasObserverRef = useRef<ResizeObserver | null>(null);
  const flowResizeFrameRef = useRef(0);
  const attachFlowCanvas = useCallback((node: HTMLDivElement | null): void => {
    flowCanvasObserverRef.current?.disconnect();
    flowCanvasObserverRef.current = null;
    window.cancelAnimationFrame(flowResizeFrameRef.current);
    if (!node) return;
    let lastWidth = node.clientWidth;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (Math.abs(width - lastWidth) < 1) return;
      lastWidth = width;
      window.cancelAnimationFrame(flowResizeFrameRef.current);
      // Two frames: fitView reads dimensions stored by React Flow's own
      // ResizeObserver, which haven't updated yet in ours.
      flowResizeFrameRef.current = window.requestAnimationFrame(() => {
        flowResizeFrameRef.current = window.requestAnimationFrame(() => {
          const instance = flowRunInstanceRef.current;
          if (!instance) return;
          // Defer to a queued node focus only while it is resolvable — a
          // request for a node that never rendered stays pending forever and
          // must not block the fit.
          const pendingNodeId = pendingFlowFocusRef.current;
          if (pendingNodeId && instance.getNode(pendingNodeId)) return;
          const focusedNodeId = focusedFlowNodeRef.current;
          if (focusedNodeId && instance.getNode(focusedNodeId)) {
            void instance.fitView({
              nodes: [{ id: focusedNodeId }],
              maxZoom: 1,
              padding: 0.4,
            });
            return;
          }
          void instance.fitView({ padding: 0.25, maxZoom: 1 });
        });
      });
    });
    observer.observe(node);
    flowCanvasObserverRef.current = observer;
  }, []);
  // Pan once per distinct first hit, so status updates or node clicks while a
  // query is active don't yank the viewport.
  const lastSearchFocusRef = useRef<string | null>(null);
  // Keyed by run + node: plan node ids repeat across runs of the same plan.
  const firstSearchHit = useMemo((): { key: string; nodeId: string } | null => {
    if (!flowRunSearchHitNodeIds || flowRunSearchHitNodeIds.size === 0) return null;
    const firstHit =
      flowRunGraph.nodes.find(
        node => node.type === 'flowTicketNode' && flowRunSearchHitNodeIds.has(node.id),
      ) ?? flowRunGraph.nodes.find(node => flowRunSearchHitNodeIds.has(node.id));
    if (!firstHit) return null;
    return { key: `${selectedGraphRootTicketId ?? ''}:${firstHit.id}`, nodeId: firstHit.id };
  }, [flowRunGraph.nodes, flowRunSearchHitNodeIds, selectedGraphRootTicketId]);
  useEffect(() => {
    if (!firstSearchHit) {
      lastSearchFocusRef.current = null;
      return;
    }
    if (lastSearchFocusRef.current === firstSearchHit.key) return;
    lastSearchFocusRef.current = firstSearchHit.key;
    focusFlowNode(firstSearchHit.nodeId);
  }, [firstSearchHit, focusFlowNode]);
  const handleSelectFlowBacklog = useCallback(
    (step: FlowNodeSelection): void => {
      if (!step.planNode) return;
      if (step.planNode.groupId) {
        setCollapsedFlowGroups(previous => {
          const next = new Set(previous);
          for (const groupId of selectedFlowRunModel?.groupAndAncestorIds(
            step.planNode!.groupId!,
          ) ?? []) {
            next.delete(groupId);
          }
          return next;
        });
      }
      setFlowSelection(step);
      focusFlowNode(step.planNode.id);
    },
    [focusFlowNode, selectedFlowRunModel],
  );
  const witnessedActiveNodeRef = useRef<string | null>(null);
  const witnessedRootStatusRef = useRef<TicketStatusV2 | null>(null);
  const pendingRootAdvanceRef = useRef(false);
  const lastFlowSelectionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isFlowBoard || !selectedGraphRootTicketId || !selectedFlowRunModel || !flowSelection)
      return;
    const selectedPlanNode = flowSelection.planNode;
    // Moving the selection to a different node (manual click) invalidates any
    // watch armed on the previous node — no surprise jumps later.
    const selectionKey = selectedPlanNode?.id ?? FLOW_VIRTUAL_ROOT_ID;
    if (lastFlowSelectionKeyRef.current !== selectionKey) {
      lastFlowSelectionKeyRef.current = selectionKey;
      if (witnessedActiveNodeRef.current !== selectedPlanNode?.id) {
        witnessedActiveNodeRef.current = null;
      }
    }
    const ticketsByPlanNodeId = mapPlanToRunTickets(
      graphTickets as unknown as FlowRunTicket[],
      selectedGraphRootTicketId,
    );
    const runRootTicket = (graphTickets as unknown as FlowRunTicket[]).find(
      ticket => ticket.id === selectedGraphRootTicketId,
    );
    const statusByPlanNodeId = new Map(
      [...ticketsByPlanNodeId].map(([planNodeId, ticket]) => [
        planNodeId,
        flowRuntimeStatusOf(ticket),
      ]),
    );
    const decisionOutcomeById = new Map<string, FlowDecisionOutcome>();
    for (const decision of selectedFlowRunModel.decisions) {
      const outcome = getFlowMeta(ticketsByPlanNodeId.get(decision.parentNodeId) ?? {})
        ?.decisionOutcomes?.[decision.id];
      if (outcome) decisionOutcomeById.set(decision.id, outcome);
    }
    const skippedPlanNodeIds = selectedFlowRunModel.skippedPlanNodeIds(
      statusByPlanNodeId,
      runRootTicket?.statusV2 === TicketStatusV2.CANCELLED,
      decisionOutcomeById,
    );
    const findWaiting = (): FlowPlanNode | undefined => {
      const candidates: FlowPlanNode[] = [];
      for (const [planNodeId, ticket] of ticketsByPlanNodeId) {
        if (
          isFlowStepBacklogged(ticket) ||
          (ticket.statusV2 !== TicketStatusV2.PAUSED && ticket.statusV2 !== TicketStatusV2.STARTED)
        ) {
          continue;
        }
        const node = runPlanNode(selectedFlowRunModel, planNodeId, ticket);
        if (node) candidates.push(node);
      }
      return nextFlowWaitingNode(
        selectedFlowRunModel,
        candidates,
        selectedPlanNode,
        statusByPlanNodeId,
        skippedPlanNodeIds,
      );
    };
    const advanceTo = (next: FlowPlanNode): void => {
      const prevGroupId = selectedPlanNode?.groupId ?? null;
      const nextGroupId = next.groupId ?? null;
      setCollapsedFlowGroups(prev => {
        const updated = new Set(prev);
        if (prevGroupId && prevGroupId !== nextGroupId) {
          updated.add(prevGroupId); // collapse only the direct group we left
        }
        if (nextGroupId) {
          for (const groupId of selectedFlowRunModel.groupAndAncestorIds(nextGroupId)) {
            updated.delete(groupId); // reveal the destination and every containing group
          }
        }
        return updated;
      });
      setFlowSelection({
        planNode: next,
        ticket: ticketsByPlanNodeId.get(next.id) ?? null,
        skipped: false,
      });
      // Same entry treatment: glide the viewport onto the newly waiting step.
      focusFlowNode(next.id);
    };
    if (!selectedPlanNode) {
      // Main ticket selected. Watch its status: a transition INTO STARTED
      // (start/resume clicked here) advances to the first waiting step —
      // possibly a tick later, once the cascade instantiates it. Pausing or
      // merely parking on the main ticket never moves the selection.
      const rootStatus =
        (graphTickets as unknown as FlowRunTicket[]).find(
          ticket => ticket.id === selectedGraphRootTicketId,
        )?.statusV2 ?? null;
      const previousStatus = witnessedRootStatusRef.current;
      witnessedRootStatusRef.current = rootStatus;
      if (
        previousStatus !== null &&
        previousStatus !== TicketStatusV2.STARTED &&
        rootStatus === TicketStatusV2.STARTED
      ) {
        pendingRootAdvanceRef.current = true;
      }
      if (!pendingRootAdvanceRef.current) return;
      const next = findWaiting();
      if (!next) return; // step not instantiated yet — retry on the next tickets update
      pendingRootAdvanceRef.current = false;
      advanceTo(next);
      return;
    }
    // A step is selected — the user moved off the main ticket, so drop any
    // pending root-advance and re-seed root watching on the next main select.
    witnessedRootStatusRef.current = null;
    pendingRootAdvanceRef.current = false;
    const selectedTicket = ticketsByPlanNodeId.get(selectedPlanNode.id);
    const settled =
      !!selectedTicket &&
      (isFlowStepBacklogged(selectedTicket) ||
        selectedTicket.statusV2 === TicketStatusV2.COMPLETED ||
        selectedTicket.statusV2 === TicketStatusV2.CANCELLED);
    if (!settled) {
      // Remember we saw this node active so we can detect it settling later.
      if (selectedTicket) witnessedActiveNodeRef.current = selectedPlanNode.id;
      return;
    }
    // Advance only on a transition we actually watched — not a click onto a
    // step that was already finished.
    if (witnessedActiveNodeRef.current !== selectedPlanNode.id) return;
    const next = findWaiting();
    // The cascade may not have instantiated the next step yet — keep the
    // witness armed and retry on the next tickets update.
    if (!next || next.id === selectedPlanNode.id) return;
    witnessedActiveNodeRef.current = null;
    advanceTo(next);
  }, [
    isFlowBoard,
    selectedGraphRootTicketId,
    selectedFlowRunModel,
    graphTickets,
    flowSelection,
    focusFlowNode,
  ]);
  const autoSelectedRunRef = useRef<string | null>(null);
  // Re-arm on run close so reopening a run re-focuses its waiting step (the
  // ref otherwise remembers we already auto-selected and skips it).
  useEffect(() => {
    if (!selectedGraphRootTicketId) {
      autoSelectedRunRef.current = null;
      collapseInitRunRef.current = null;
    }
    // Run changed/closed — stale watching must not leak into the next run.
    focusedFlowNodeRef.current = null;
    witnessedRootStatusRef.current = null;
    pendingRootAdvanceRef.current = false;
    witnessedActiveNodeRef.current = null;
    lastFlowSelectionKeyRef.current = null;
  }, [selectedGraphRootTicketId]);
  // Must stay above the entry-default effects: a restore claims their
  // once-per-run refs before they fire.
  const { forgetRunUiState } = useFlowRunPersistence({
    isFlowBoard,
    layoutView,
    filteredSingleBoardId,
    selectedGraphRootTicketId,
    setSelectedGraphRootTicketId,
    selectedFlowRunModel,
    flowTickets: graphTickets as unknown as FlowRunTicket[],
    flowSelection,
    setFlowSelection,
    collapsedFlowGroups,
    setCollapsedFlowGroups,
    flowRunSearchQuery,
    setFlowRunSearchQuery,
    flowThreadTicket,
    setFlowThreadTicket,
    focusFlowNode,
    collapseInitRunRef,
    autoSelectedRunRef,
  });
  // Entering a run collapses every group by default. Must stay AFTER the
  // persistence hook and gated on the same root ticket, so a restore claims
  // collapseInitRunRef before this can.
  useEffect(() => {
    if (!isFlowBoard || !selectedGraphRootTicketId || !selectedFlowRunModel) return;
    if (!selectedFlowRunRootTicket) return;
    if (collapseInitRunRef.current === selectedGraphRootTicketId) return;
    collapseInitRunRef.current = selectedGraphRootTicketId;
    setCollapsedFlowGroups(new Set(selectedFlowRunModel.groups.map(group => group.id)));
  }, [isFlowBoard, selectedGraphRootTicketId, selectedFlowRunModel, selectedFlowRunRootTicket]);
  useEffect(() => {
    if (!isFlowBoard || !selectedGraphRootTicketId || !selectedFlowRunModel) return;
    if (autoSelectedRunRef.current === selectedGraphRootTicketId) return;
    const rootTicket =
      (graphTickets as unknown as FlowRunTicket[]).find(
        ticket => ticket.id === selectedGraphRootTicketId,
      ) ?? null;
    // Tickets not loaded yet — don't consume the once-per-run slot.
    if (!rootTicket) return;
    autoSelectedRunRef.current = selectedGraphRootTicketId;
    const ticketsByPlanNodeId = mapPlanToRunTickets(
      graphTickets as unknown as FlowRunTicket[],
      selectedGraphRootTicketId,
    );
    // Search the PLAN (not the rendered nodes) — the waiting step may sit
    // inside a group that entry collapsed; expand it so the node is visible.
    const waitingCandidates: FlowPlanNode[] = [];
    for (const [planNodeId, stepTicket] of ticketsByPlanNodeId) {
      if (
        !isFlowStepBacklogged(stepTicket) &&
        (stepTicket.statusV2 === TicketStatusV2.PAUSED ||
          stepTicket.statusV2 === TicketStatusV2.STARTED)
      ) {
        const candidate = runPlanNode(selectedFlowRunModel, planNodeId, stepTicket);
        if (candidate) waitingCandidates.push(candidate);
      }
    }
    const waiting = nextFlowWaitingNode(
      selectedFlowRunModel,
      waitingCandidates,
      null,
      new Map(),
      new Set(),
    );
    if (waiting) {
      const groupId = waiting.groupId;
      if (groupId) {
        setCollapsedFlowGroups(prev => {
          const updated = new Set(prev);
          for (const visibleGroupId of selectedFlowRunModel.groupAndAncestorIds(groupId)) {
            updated.delete(visibleGroupId);
          }
          return updated;
        });
      }
      setFlowSelection({
        planNode: waiting,
        ticket: ticketsByPlanNodeId.get(waiting.id) ?? null,
        skipped: false,
      });
      focusFlowNode(waiting.id);
    } else {
      setFlowSelection({ planNode: null, ticket: rootTicket, skipped: false });
      focusFlowNode(FLOW_VIRTUAL_ROOT_ID);
    }
  }, [isFlowBoard, selectedGraphRootTicketId, selectedFlowRunModel, graphTickets, focusFlowNode]);
  // Keep the open side panel in sync with live ticket updates (Zero sync /
  // cascade-created steps) — the selection is otherwise a snapshot. Functional
  // update: reading the selection from a closure here could revert an
  // auto-advance queued in the same commit (stale-selection race).
  useEffect(() => {
    setFlowSelection(previous => {
      if (!previous) return previous;
      const key = previous.planNode?.id ?? FLOW_VIRTUAL_ROOT_ID;
      const fresh = flowTicketNodes.find(node => node.id === key)?.data;
      if (
        !fresh ||
        (sameFlowRunTicket(fresh.ticket, previous.ticket) &&
          fresh.skipped === previous.skipped &&
          fresh.skipReason === previous.skipReason &&
          sameFlowPlanNode(fresh.planNode, previous.planNode))
      ) {
        return previous;
      }
      return {
        planNode: fresh.planNode,
        ticket: fresh.ticket,
        skipped: fresh.skipped,
        ...(fresh.skipReason && { skipReason: fresh.skipReason }),
      };
    });
  }, [flowTicketNodes]);

  const shouldUseStatusColumns =
    isWorkspaceView ||
    (!filteredSingleBoardId && ['project', 'my-tickets'].includes(viewMode)) ||
    (channelId && viewMode === 'project' && channelViewType !== 'stage');

  const navBaseArgs = useMemo<KanbanTicketsPageBaseArgs>(
    () => ({
      ...ticketsQueryParams,
      searchTerm,
      filters: deferredFilters,
      formEntityValueFieldIds: fevFieldIds,
      dynamicFieldVespaTokens,
      dynamicFieldDateRanges,
      zeroOnlyDynamicFieldIds,
      showOverdueOnly,
      groupBy,
    }),
    [
      ticketsQueryParams,
      searchTerm,
      deferredFilters,
      fevFieldIds,
      dynamicFieldVespaTokens,
      dynamicFieldDateRanges,
      zeroOnlyDynamicFieldIds,
      showOverdueOnly,
      groupBy,
    ],
  );
  useEffect(() => {
    if (!isKanbanLayout || !channelId) return;
    setBoardNavParams({
      channelId,
      baseArgs: navBaseArgs,
      columnType: shouldUseStatusColumns ? 'status' : 'stage',
    });
  }, [isKanbanLayout, channelId, navBaseArgs, shouldUseStatusColumns]);

  const kanbanColumnQueryKey = useMemo(
    () =>
      JSON.stringify({
        ticketsQueryParams,
        searchTerm: searchTerm.trim(),
        columnType: shouldUseStatusColumns ? 'status' : 'stage',
        filters: deferredFilters,
        groupBy,
        showOverdueOnly,
        dynamicFieldVespaTokens,
        dynamicFieldDateRanges,
        zeroOnlyDynamicFieldIds,
        formEntityValueFieldIds: fevFieldIds,
      }),
    [
      deferredFilters,
      dynamicFieldVespaTokens,
      dynamicFieldDateRanges,
      zeroOnlyDynamicFieldIds,
      fevFieldIds,
      groupBy,
      shouldUseStatusColumns,
      showOverdueOnly,
      searchTerm,
      ticketsQueryParams,
    ],
  );
  const lastKanbanColumnQueryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isKanbanLayout) {
      lastKanbanColumnQueryKeyRef.current = null;
      return;
    }

    if (lastKanbanColumnQueryKeyRef.current === null) {
      lastKanbanColumnQueryKeyRef.current = kanbanColumnQueryKey;
      return;
    }

    if (lastKanbanColumnQueryKeyRef.current === kanbanColumnQueryKey) return;

    lastKanbanColumnQueryKeyRef.current = kanbanColumnQueryKey;
    setLocalTickets(null);
    setKanbanTicketsByColumn({});
  }, [isKanbanLayout, kanbanColumnQueryKey]);

  useEffect(() => {
    if (isKanbanLayout) {
      if (isDraggingRef.current) {
        return;
      }

      const mergedTickets = Object.values(kanbanTicketsByColumn).flat();
      const seen = new Set<string>();
      const uniqueTickets: Ticket[] = [];

      for (const ticket of mergedTickets) {
        if (seen.has(ticket.id)) continue;
        seen.add(ticket.id);
        uniqueTickets.push(ticket);
      }

      if (localTickets === null && Object.keys(kanbanTicketsByColumn).length === 0) {
        return;
      }

      if (localTickets !== null && ticketsHaveSameBoardSnapshot(localTickets, uniqueTickets)) {
        return;
      }

      setLocalTickets(uniqueTickets);
      return;
    }

    if (!isDraggingRef.current && filteredTickets) {
      if (localTickets !== null && ticketsHaveSameBoardSnapshot(localTickets, filteredTickets)) {
        return;
      }
      setLocalTickets(filteredTickets); // 🔄 SYNC!
    }
  }, [filteredTickets, isKanbanLayout, kanbanTicketsByColumn, localTickets]);

  useEffect(() => {
    if (!isKanbanLayout) {
      setKanbanTicketsByColumn({});
    }
  }, [isKanbanLayout]);

  const lastSentFilteredTicketIdsRef = useRef<string | null>(null);

  const availableTags = useMemo(() => {
    if (!projectTags || projectTags.length === 0) return undefined;
    const uniqueTags = new Set(projectTags.map(tag => tag.name));
    return Array.from(uniqueTags).sort();
  }, [projectTags]);

  const availableStages = useMemo(() => {
    if (!stages || stages.length === 0) return undefined;
    return stages.map(stage => ({
      name: stage.name,
      status: stage.defaultTicketStatusV2,
    }));
  }, [stages]);

  useEffect(() => {
    const sourceTickets = isKanbanLayout ? localTickets : filteredTickets;
    if (!isDraggingRef.current && sourceTickets) {
      const ids = sourceTickets.map(t => t.id);
      const idsSignature = ids.join(',');
      if (lastSentFilteredTicketIdsRef.current === idsSignature) return;
      lastSentFilteredTicketIdsRef.current = idsSignature;

      stateMachineActor.send({ type: 'SET_FILTERED_TICKET_IDS', ids });
    }
  }, [filteredTickets, isKanbanLayout, localTickets]);

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
      const sourceStage = stages.find(s => s.name === data.ticket.stageName);
      // Open immediately so the form never blocks on a network call
      setStageFormModal({
        ...data,
        sourceStageName: sourceStage?.name || data.ticket.stageName || '',
        existingRequest: null,
      });
      // Then enrich with any existing request for pre-fill / status display
      try {
        const ticketRequests = await zero.run(
          queries.getTicketStageRequests({ ticketId: data.ticket.id }),
          { type: 'complete' },
        );
        // Only enrich with active (SUBMITTED/DRAFT) requests — APPROVED/REJECTED would block revisits.
        const existingRequest = ticketRequests?.find(
          r =>
            r.stageId === data.targetStage.id &&
            (r.status === TicketStageRequestStatus.SUBMITTED ||
              r.status === TicketStageRequestStatus.DRAFT),
        );
        if (existingRequest) {
          setStageFormModal(prev => (prev ? { ...prev, existingRequest } : prev));
        }
      } catch {
        // Modal already open — existing request stays null, which is safe
      }
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

  const canReorder = !!filteredSingleBoardId;
  const setDragLocalTickets = useCallback<React.Dispatch<React.SetStateAction<Ticket[]>>>(value => {
    setLocalTickets(prev => {
      const previousTickets = prev ?? [];
      return typeof value === 'function' ? value(previousTickets) : value;
    });
  }, []);

  const {
    activeTicket,
    handleDragStart,
    handleDragEnd,
    rejectedApprovalConfirm,
    confirmRejectedApproval,
    cancelRejectedApproval,
  } = useDragAndDrop({
    localTickets: localTickets ?? [],
    setLocalTickets: setDragLocalTickets,
    zero,
    stages,
    mode: dragDropMode,
    canReorder,
    onStageFormRequired: handleStageFormRequired,
    onBackwardStageChange: handleBackwardStageChange,
    stageFormMap,
    isNonLinearBoard,
    transitions,
  });

  useEffect(() => {
    isDraggingRef.current = !!activeTicket;
  }, [activeTicket]);

  const handleTicketClick = useCallback(
    (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => {
      const isCmdClick = 'metaKey' in e && (e.metaKey || e.ctrlKey);
      const ws = window.location.pathname.split('/').find(s => s.length > 0) ?? '';

      // Desk tickets open in the Support screen, not the chat ticket panel.
      const ticketChannel = allChannels.find(c => c.id === ticket.channelId);
      if (isDeskChannelType(ticketChannel?.type) && ticket.xyneId) {
        const supportUrl = `/support/${ticket.channelId}/${ticket.xyneId}`;
        if (!isMobile && isCmdClick) {
          window.open(`${ws ? `/${ws}` : ''}${supportUrl}`, '_blank');
          return;
        }
        void navigate(supportUrl, {
          state: { conversationId: ticket.conversationId, ticketId: ticket.id },
        });
        return;
      }

      // Desk/support tickets (EMAIL / SLACK / APP channels) belong to the Support
      // desk experience, not the chat conversation panel. Route those to the desk
      // email view (/support/:channelId/:xyneId — the :ticketId segment is the
      // xyneId). All other tickets keep the existing chat-panel behavior.
      const ticketChannelType = channelsById.get(ticket.channelId)?.type;
      const isDeskTicket = isDeskChannelType(ticketChannelType);
      // Deep-link to the ticket when we have its xyneId; otherwise fall back to
      // the channel's support inbox — a desk ticket must never open in chat.
      const supportRoute = ticket.xyneId
        ? `/support/${ticket.channelId}/${ticket.xyneId}`
        : `/support/${ticket.channelId}`;

      // Only open in new tab on desktop when Cmd/Ctrl+Click is pressed
      if (!isMobile && isCmdClick) {
        const relativeUrl = isDeskTicket
          ? supportRoute
          : `/chat/dir/${ticket.channelId}?tab=tickets&ticketId=${ticket.id}&conversationId=${ticket.conversationId}`;
        window.open(`${ws ? `/${ws}` : ''}${relativeUrl}`, '_blank');
        return;
      }

      const currentUrl = window.location.pathname + window.location.search;
      const navState = { state: { fromMyTickets: false, returnToUrl: currentUrl } };

      // Desk/support ticket -> Support desk email view (channelId + xyneId).
      if (isDeskTicket) {
        void navigate(supportRoute, navState);
        return;
      }

      // On mobile: navigate directly to ThreadMessages route with details tab
      // On desktop: use tab-based route for expanded view in ConversationPannel
      if (isMobile) {
        void navigate(
          `${baseRoute}/${ticket.channelId}/${ticket.conversationId}/${ticket.id}?selectedTab=details`,
          navState,
        );
      } else {
        void navigate(
          buildChannelRoute(ticket.channelId, {
            tab: 'tickets',
            ticketId: ticket.id,
            conversationId: ticket.conversationId,
          }),
          navState,
        );
      }
    },
    [navigate, channel, isMobile, baseRoute, buildChannelRoute, allChannels],
  );

  const openCreateForColumn = useCallback(
    (seed: {
      status?: TicketStatusV2 | undefined;
      stageName?: string | undefined;
      assignee?: { type: 'assigneeTo' | 'userGroup'; value: string } | null;
    }): void => {
      setCreateTicketSeed(seed);
      setIsCreateModalOpen(true);
    },
    [],
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

  // Board context for create ticket modal. When creating from a board route or
  // a single board-filtered channel ticket tab, preselect that board so users
  // do not need to choose it again.
  const currentBoardId = filteredSingleBoardId ?? null;

  const hasSearchTerm = searchTerm.trim().length > 0;
  const canUseKanbanColumnPagination = isKanbanLayout && workspaceViewReady;
  const shouldFetchKanbanCounts = canUseKanbanColumnPagination && !hasSearchTerm;
  const kanbanCounts = useKanbanCounts({
    ...ticketsQueryParams,
    columnType: shouldUseStatusColumns ? 'status' : 'stage',
    filters: deferredFilters,
    groupBy,
    showOverdueOnly,
    ...(user?.id ? { currentUserId: user.id } : {}),
    enabled: shouldFetchKanbanCounts,
  });
  const lastKnownKanbanGroupsRef = useRef<{
    groups: typeof kanbanCounts.groups;
  } | null>(null);
  const lastKnownKanbanGroupsQueryKeyRef = useRef<string | null>(null);
  const lastKnownKanbanTicketsRef = useRef<{
    queryKey: string;
    tickets: Ticket[];
  } | null>(null);
  const lastKnownKanbanTicketsQueryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isKanbanLayout) return;
    if (hasSearchTerm) return;
    if (lastKnownKanbanGroupsQueryKeyRef.current !== kanbanColumnQueryKey) {
      lastKnownKanbanGroupsRef.current = null;
      lastKnownKanbanGroupsQueryKeyRef.current = kanbanColumnQueryKey;
    }

    if (kanbanCounts.groups.length === 0) {
      return;
    }
    lastKnownKanbanGroupsRef.current = {
      groups: kanbanCounts.groups,
    };
  }, [hasSearchTerm, isKanbanLayout, kanbanCounts.groups, kanbanColumnQueryKey]);

  useEffect(() => {
    if (!isKanbanLayout) return;

    // On the pass where the query key changes, `localTickets` here still holds the previous
    // query's rows: the reset above only queues setLocalTickets(null), which lands next render.
    // Stamping the new key onto those rows would make the queryKey check below always pass, so
    // drop the remembered rows instead and let a later pass re-record the new query's results.
    if (lastKnownKanbanTicketsQueryKeyRef.current !== kanbanColumnQueryKey) {
      lastKnownKanbanTicketsQueryKeyRef.current = kanbanColumnQueryKey;
      lastKnownKanbanTicketsRef.current = null;
      return;
    }

    if (!localTickets || localTickets.length === 0) return;

    lastKnownKanbanTicketsRef.current = {
      queryKey: kanbanColumnQueryKey,
      tickets: localTickets,
    };
  }, [isKanbanLayout, kanbanColumnQueryKey, localTickets]);

  const hasMatchingLastKnownKanbanGroups =
    lastKnownKanbanGroupsQueryKeyRef.current === kanbanColumnQueryKey &&
    (lastKnownKanbanGroupsRef.current?.groups.length ?? 0) > 0;

  const isTicketsSyncing = isKanbanLayout
    ? !hasSearchTerm && kanbanCounts.isLoading
    : ticketsDetails.type !== 'complete';

  const kanbanTicketsForGrouping = useMemo(() => {
    if (localTickets && localTickets.length > 0) return localTickets;
    const lastKnownKanbanTickets = lastKnownKanbanTicketsRef.current;
    if (
      hasSearchTerm &&
      lastKnownKanbanTickets !== null &&
      lastKnownKanbanTickets.queryKey === kanbanColumnQueryKey &&
      lastKnownKanbanTickets.tickets.length > 0
    ) {
      return lastKnownKanbanTickets.tickets;
    }
    return localTickets ?? [];
  }, [hasSearchTerm, kanbanColumnQueryKey, localTickets]);

  const processedGroups = useMemo(() => {
    const groupedRows = groupTickets(kanbanTicketsForGrouping, groupBy);
    const localEntries = Object.entries(groupedRows);
    const serverGroups = isKanbanLayout
      ? hasSearchTerm
        ? groupBy === 'status'
          ? getStatusColumns().map(column => ({
              groupKey: column.id,
              displayName: column.name,
              totalCount: 0,
              stages: {},
              statuses: {},
            }))
          : hasMatchingLastKnownKanbanGroups
            ? (lastKnownKanbanGroupsRef.current?.groups ?? [])
            : kanbanCounts.groups
        : hasMatchingLastKnownKanbanGroups
          ? (lastKnownKanbanGroupsRef.current?.groups ?? [])
          : kanbanCounts.groups
      : [];
    const serverGroupKeys = new Set(serverGroups.map(group => group.groupKey));

    const entries =
      serverGroups.length > 0
        ? [
            ...serverGroups.map(
              group => [group.groupKey, groupedRows[group.groupKey] ?? []] as const,
            ),
            ...localEntries.filter(([groupName]) => !serverGroupKeys.has(groupName)),
          ]
        : localEntries;

    const mapped = entries.map(([groupName, groupTickets]) => {
      const serverCountGroup = isKanbanLayout ? kanbanCounts.groupsByKey.get(groupName) : undefined;
      const serverColumnCounts = shouldUseStatusColumns
        ? (serverCountGroup?.statuses ?? {})
        : (serverCountGroup?.stages ?? {});
      const ticketsByColumn = shouldUseStatusColumns
        ? groupTicketsByStatus(groupTickets, stages)
        : groupTicketsByStage(groupTickets, stages, canReorder && !hasSearchTerm);

      let displayName = serverCountGroup?.displayName ?? groupName;
      let entityType: 'user' | 'group' | null = null;
      let entityId: string | null = null;
      let priority: TicketPriority | null = null;

      if (groupBy === 'assignee' && groupName !== 'Unassigned') {
        const normalizedId = groupName.replace(/^(user:|group:|userGroup:)/, '');
        if (groupName.startsWith('group:') || groupName.startsWith('userGroup:')) {
          entityType = 'group';
          entityId = normalizedId;
          displayName = groupNamesById.get(normalizedId) || displayName;
        } else {
          entityType = 'user';
          entityId = normalizedId;
          displayName = userNamesById.get(normalizedId) || displayName;
        }
      } else if (groupBy === 'priority' && groupName !== 'No Priority') {
        priority = groupName as TicketPriority;
        displayName = groupName.charAt(0).toUpperCase() + groupName.slice(1).toLowerCase();
      } else if (
        isFormFieldGroup(groupBy) &&
        groupBy.fieldType === FormFieldType.USER &&
        groupName !== 'Unassigned'
      ) {
        displayName = userNamesById.get(groupName) || displayName;
      } else if (groupBy !== 'none') {
        displayName = groupName
          .replace('user:', '')
          .replace('group:', '')
          .replace('Unassigned', 'Unassigned');
      }
      const isSpecialMissingGroup = groupName === 'No Value' || groupName === 'Unassigned';
      const fallbackCount = isSpecialMissingGroup ? 0 : groupTickets.length;
      const count = hasSearchTerm
        ? groupTickets.length
        : (serverCountGroup?.totalCount ?? fallbackCount);

      return {
        key: groupName,
        displayName,
        count,
        allTickets: groupTickets,
        columnData: ticketsByColumn,
        entityType,
        entityId,
        priority,
        stageCounts: serverColumnCounts,
      };
    });

    const isAssigneeGrouping =
      groupBy === 'assignee' ||
      (isFormFieldGroup(groupBy) && groupBy.fieldType === FormFieldType.USER);
    if (isAssigneeGrouping) {
      const isUnassigned = (key: string): boolean => key === 'Unassigned';
      mapped.sort((a, b) => {
        if (isUnassigned(a.key) !== isUnassigned(b.key)) return isUnassigned(a.key) ? 1 : -1;
        return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
      });
    }

    return mapped;
  }, [
    localTickets,
    groupBy,
    kanbanTicketsForGrouping,
    stages,
    userNamesById,
    groupNamesById,
    canReorder,
    shouldUseStatusColumns,
    isKanbanLayout,
    hasSearchTerm,
    searchTerm,
    kanbanCounts.groups,
    kanbanCounts.groupsByKey,
    kanbanColumnQueryKey,
    hasMatchingLastKnownKanbanGroups,
  ]);

  const filteredAvailableColumns = useMemo(() => {
    if (layoutView === 'table' || layoutView === 'flow') {
      // In table mode, hide TicketCard metadata columns
      return availableColumns.filter(
        col => !['stage', 'board', 'createdAt', 'createdBy', 'updatedAt'].includes(col.key),
      );
    }
    if (layoutView === 'calendar') {
      return availableColumns.filter(
        col => !['stage', 'board', 'createdBy', 'updatedAt'].includes(col.key),
      );
    }
    return availableColumns.filter(col => col.key !== 'status');
  }, [layoutView]);

  if (showTicketReport && channelId && effectiveProjectId) {
    return (
      <TicketReportsScreen
        embedded
        lockedProjectId={effectiveProjectId}
        sourceChannelId={channelId}
        onClose={() => {
          setSearchParams(
            previous => {
              const next = new URLSearchParams(previous);
              next.delete('ticketReport');
              return next;
            },
            { replace: true },
          );
        }}
      />
    );
  }

  return (
    <div
      data-testid='projects-board-page'
      className='flex flex-col h-full w-full bg-muted relative'
    >
      {/* Header */}
      <div className='flex flex-col lg:flex-row flex-wrap lg:flex-nowrap lg:items-center justify-between px-4 py-3 bg-background flex-shrink-0 gap-3'>
        {/* Filters - Left Side */}
        {(effectiveProjectId || viewMode === 'my-tickets' || isWorkspaceView) && (
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
              availableBoards={availableBoards}
              availableBoardDetails={availableBoardDetails}
              sourceChannelProjectIds={sourceChannelProjectIds}
              showBoardsFilter={!!channelId || isMyTicketsView}
              availableTags={availableTags}
              availableStages={availableStages}
              hasPrReviewers={hasPrReviewers}
              hasQaAssigned={hasQaAssigned}
              hideAssigneeFilter={viewMode === 'my-tickets' ? true : false}
              isTicketsSyncing={isTicketsSyncing}
              onBoardDropdownOpenChange={handleBoardDropdownOpenChange}
              onSourceChannelsOpenChange={handleSourceChannelsOpenChange}
              isNonLinearBoard={isNonLinearBoard}
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
              workspaceView={isWorkspaceView}
              trailingControl={
                canExportTickets ? (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='rounded-[10px] border-border'
                    onClick={() => {
                      if (channelId && effectiveProjectId) {
                        setSearchParams(previous => {
                          const next = new URLSearchParams(previous);
                          next.set('ticketReport', '1');
                          return next;
                        });
                        return;
                      }
                      const params = new URLSearchParams();
                      if (effectiveProjectId) {
                        params.set('projectId', effectiveProjectId);
                        params.set('lockProject', '1');
                      }
                      if (boardId) params.set('boardId', boardId);
                      const prefix = user?.workspaceId ? `/${user.workspaceId}` : '';
                      void navigate(
                        `${prefix}/ticket-reports${params.size ? `?${params.toString()}` : ''}`,
                      );
                    }}
                    data-track-category='TicketReports'
                    data-track-name='OpenTicketReports'
                  >
                    <Download className='size-4' />
                    <span>Export report</span>
                  </Button>
                ) : undefined
              }
              {...(isWorkspaceView
                ? {
                    leadingControl: (
                      <ViewBoardPicker
                        selectedBoardIds={filters.boards ?? []}
                        onChange={boardIds => setFilters({ ...filters, boards: boardIds })}
                      />
                    ),
                  }
                : {})}
            />
          </div>
        )}

        {/* Create Ticket / Save View Button - Right Side */}
        <div className='flex flex-wrap lg:flex-col md:items-end gap-3 ml-auto md:ml-0'>
          {isWorkspaceView && (
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={handleShareWorkspaceView}
                disabled={!workspaceViewReady}
                className='rounded-[10px] border-border hover:bg-muted'
                aria-label='Share view'
                data-track-category='Projects'
                data-track-name='ShareView'
              >
                <Share2 className='w-3 h-3 text-muted-foreground' />
                <span>Share</span>
              </Button>
              <Popover
                open={isSavePopoverOpen}
                onOpenChange={handleSavePopoverOpenChange}
                align='end'
                className='w-64 p-3'
                trigger={
                  <Button
                    size='sm'
                    disabled={!workspaceViewReady || isSavingWorkspaceView}
                    className='rounded-[10px]'
                    data-track-category='Projects'
                    data-track-name='SaveView'
                  >
                    <Bookmark className='w-3 h-3' />
                    <span>{viewId ? 'Save' : 'Save view'}</span>
                  </Button>
                }
              >
                <div className='flex flex-col gap-2'>
                  <span className='text-[13px] font-medium text-foreground'>Name this view</span>
                  <input
                    autoFocus
                    value={workspaceViewNameDraft}
                    onChange={e => setWorkspaceViewNameDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleConfirmSaveWorkspaceView();
                    }}
                    placeholder='e.g. My open PRs'
                    data-track-category='Projects'
                    data-track-name='SaveViewNameInput'
                    className={cn(
                      'h-8 px-2 rounded-md border border-input bg-background text-[13px]',
                      'text-foreground outline-none placeholder:text-muted-foreground',
                      'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    )}
                  />
                  <div className='flex justify-end gap-2 pt-1'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => setIsSavePopoverOpen(false)}
                      data-track-category='Tickets'
                      data-track-name='CANCEL_SAVE_WORKSPACE_VIEW'
                    >
                      Cancel
                    </Button>
                    <Button
                      size='sm'
                      onClick={handleConfirmSaveWorkspaceView}
                      data-track-category='Tickets'
                      data-track-name='CONFIRM_SAVE_WORKSPACE_VIEW'
                      disabled={!workspaceViewNameDraft.trim() || isSavingWorkspaceView}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </Popover>
            </div>
          )}
          {canCreateTicket && channel && !channel.isArchived && (
            <button
              data-testid='kanban-create-ticket-button'
              data-track-event='BUTTON_CLICK'
              data-track-category='Tickets'
              data-track-name='CREATE_TICKET_KANBAN'
              data-track-metadata={JSON.stringify({ boardId, channelId })}
              onClick={() => {
                setCreateTicketSeed(null);
                setIsCreateModalOpen(true);
              }}
              className='flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary-foreground bg-primary rounded-lg transition-colors flex-shrink-0'
            >
              <Plus className='w-4 h-4' />
              <span className='hidden sm:inline font-semibold text-sm'>Create Ticket</span>
              <span className='sm:hidden'>Create</span>
            </button>
          )}
          {/* Layout View Toggle (flow boards only have the flow view) */}
          <div className='flex items-center gap-2'>
            {!isFlowBoard && (
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
                    className={`px-3 py-2 transition-colors ${
                      isMobile ? 'rounded-r-xl' : 'border-r'
                    } ${
                      layoutView === 'table'
                        ? 'bg-background text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title='Table View'
                    data-track-category='Tickets'
                    data-track-name='SetTableView'
                    data-testid='table-view-btn'
                  >
                    <GridTable className='w-3.5 h-3.5' />
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
            )}

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
                onClick={() => setShowOverdueOnly(!showOverdueOnly)}
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
                    <span className='text-sm font-bold tracking-wide text-foreground'>
                      Customise view
                    </span>
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
                    <div className='border-b border-border px-4 pt-4 pb-3'>
                      <p className='text-sm font-medium text-muted-foreground mb-1'>Views</p>
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
                                const columnsEntry = allValues.find(
                                  v => v.fieldName === '__columns',
                                );
                                const filterValues = allValues.filter(
                                  v => v.fieldName !== '__groupBy' && v.fieldName !== '__columns',
                                );
                                const newFilters = valuesToFilters(filterValues);
                                if (columnsEntry) {
                                  const savedColumns = columnsEntry.fieldValue
                                    .split(',')
                                    .filter(Boolean);
                                  setVisibleColumns(prev => mergeSavedColumns(prev, savedColumns));
                                } else {
                                  setVisibleColumns(prev =>
                                    mergeSavedColumns(prev, DEFAULT_VISIBLE_COLUMNS),
                                  );
                                }
                                if (filters.boards) newFilters.boards = filters.boards;
                                setFilters(newFilters);
                                setSelectedViewId(config.id);
                                try {
                                  sessionStorage.setItem(activeViewKey, config.id);
                                } catch (err) {
                                  logger.error(Event.FRONTEND_ERROR, {
                                    type: 'migrated_console_error',
                                    message: String(
                                      'Failed to persist active view to sessionStorage',
                                    ),
                                    error: err,
                                  });
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
                              <span className='text-sm font-medium truncate max-w-[160px] text-muted-foreground'>
                                {config.name}
                              </span>
                              {isPrivate && (
                                <span className='text-xs text-muted-foreground font-normal'>
                                  Private
                                </span>
                              )}
                              {isOwn && (
                                <button
                                  data-track-category='saved-views'
                                  data-track-name='delete-saved-view'
                                  className='hidden group-hover:flex items-center justify-center absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-secondary hover:bg-red-100 transition-colors'
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
                                  <X className='w-2.5 h-2.5 text-muted-foreground hover:text-red-500' />
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
                          data-track-category='Tickets'
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
                          data-track-category='Tickets'
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
                            ? 'bg-primary border'
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
                    <span className='text-sm font-bold tracking-wide text-foreground'>
                      Group by
                    </span>
                    {groupBy !== 'none' && (
                      <DropdownMenu.Item
                        className='outline-none'
                        aria-label='Clear grouping'
                        onSelect={() => {
                          handleSetGroupBy('none');
                        }}
                      >
                        <div className='cursor-pointer hover:bg-muted rounded p-1 transition-colors text-foreground'>
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
      data-[state=checked]:bg-accent data-[state=checked]:text-foreground data-[state=checked]:font-semibold'
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
            <div className='flex items-center px-4 py-2 bg-background border-b border-border flex-shrink-0'>
              <div className='flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border bg-background text-sm text-foreground'>
                <span className='font-medium'>{activeView.name}</span>
                <button
                  data-track-category='saved-views'
                  data-track-name='dismiss-active-view'
                  onClick={() => {
                    setSelectedViewId(null);
                    try {
                      sessionStorage.removeItem(activeViewKey);
                    } catch (err) {
                      logger.error(Event.FRONTEND_ERROR, {
                        type: 'migrated_console_error',
                        message: String('Failed to remove active view from sessionStorage'),
                        error: err,
                      });
                    }
                    setFilters({ ...(filters.boards ? { boards: filters.boards } : {}) });
                    setGroupBy('none');
                  }}
                  className='flex items-center justify-center hover:text-foreground transition-colors'
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
            tickets={filteredTickets ?? []}
            onTicketClick={(ticket: Ticket) => handleTicketClick({} as React.MouseEvent, ticket)}
          />
        </div>
      ) : layoutView === 'flow' ? (
        <div className='flex-1 overflow-hidden bg-background p-4'>
          <div className='relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-muted'>
            {selectedGraphRootTicketId ? (
              <div className='flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background px-4 py-2.5'>
                <button
                  type='button'
                  onClick={() => {
                    setSelectedGraphRootTicketId(null);
                    setFlowSelection(null);
                  }}
                  aria-label='Back to main tickets'
                  title='Back to main tickets'
                  data-track-category='flow_board'
                  data-track-name='back_to_main_tickets'
                  className='flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                >
                  <ArrowLeft className='h-[18px] w-[18px]' />
                </button>
                <div className='h-6 w-px shrink-0 bg-border' aria-hidden='true' />
                <div className='flex min-w-0 flex-auto items-center gap-2.5'>
                  <h2 className='truncate text-[15px] font-bold tracking-[-0.01em] text-foreground'>
                    {selectedFlowRunRootTicket?.title ?? 'Ticket'} run
                  </h2>
                  <span className='shrink-0 whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground'>
                    {flowRunGraph.nodes.length} nodes
                  </span>
                  <span className='shrink-0 whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground'>
                    {flowRunGraph.edges.length} edges
                  </span>
                </div>
                <label className='relative block w-[clamp(150px,16vw,240px)] min-w-[150px] shrink'>
                  <Search className='pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground/70' />
                  <input
                    type='search'
                    value={flowRunSearchQuery}
                    onChange={event => setFlowRunSearchQuery(event.target.value)}
                    // Browsers clear a search input on Escape without always
                    // firing change, leaving the graph dimmed by a stale query.
                    onKeyDown={event => {
                      if (event.key === 'Escape') setFlowRunSearchQuery('');
                    }}
                    placeholder='Search ticket ID or title'
                    data-track-category='flow_board'
                    data-track-name='search_flow_run'
                    className='h-9 w-full rounded-[10px] border border-border bg-muted/40 pl-[34px] pr-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
                  />
                </label>
                <Tooltip content='Ask AI' side='bottom'>
                  <button
                    type='button'
                    onClick={() => {
                      // Same path as the channel header: the app-level docked
                      // Ask AI sidebar, seeded with this run's root ticket.
                      xyneAIActor.send({
                        type: 'OPEN',
                        ...(selectedFlowRunRootTicket?.channelId && {
                          channelId: selectedFlowRunRootTicket.channelId,
                        }),
                        // Passed even when null — the machine keeps the
                        // previous thread context when the key is absent.
                        threadInfo: flowAskAIThreadInfo,
                        startFreshChat: true,
                      });
                    }}
                    aria-label='Ask AI'
                    data-track-category='flow_board'
                    data-track-name='ask_ai_flow_run'
                    className='flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                  >
                    <XyneAIStar />
                  </button>
                </Tooltip>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type='button'
                      disabled={flowRunExporting !== null || selectedRunExportRows.length === 0}
                      aria-label='Download'
                      title={flowRunExporting ? 'Downloading…' : 'Download'}
                      data-track-category='flow_board'
                      data-track-name='download_flow_run'
                      className='flex h-9 shrink-0 items-center gap-1 rounded-[10px] border border-border bg-background pl-2.5 pr-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60'
                    >
                      <Download className='h-[17px] w-[17px]' />
                      <ChevronDownIcon className='h-3.5 w-3.5' />
                    </button>
                  </DropdownMenu.Trigger>
                  {flowExportDropdownMenu}
                </DropdownMenu.Root>
              </div>
            ) : (
              <div className='flex items-center justify-between border-b border-border bg-background px-4 py-3'>
                <div className='flex items-center gap-2'>
                  <GitBranch className='h-4 w-4 text-muted-foreground' />
                  <h2 className='text-sm font-semibold text-foreground'>Main Tickets</h2>
                  <span className='rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
                    {ticketGraphNodes.length} tickets
                  </span>
                </div>
                <div className='flex items-center gap-2'>
                  <Tooltip content='Ask AI' side='bottom'>
                    <button
                      type='button'
                      onClick={() => {
                        // threadInfo cleared explicitly — the machine keeps the
                        // previous value when the key is absent.
                        xyneAIActor.send({
                          type: 'OPEN',
                          ...(channelId && { channelId }),
                          threadInfo: null,
                          startFreshChat: true,
                        });
                      }}
                      aria-label='Ask AI'
                      data-track-category='flow_board'
                      data-track-name='ask_ai_flow_board'
                      className='flex items-center justify-center rounded-md border border-border bg-background p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                    >
                      <XyneAIStar />
                    </button>
                  </Tooltip>
                  {flowRunExportRows.length > 0 && (
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type='button'
                          disabled={flowRunExporting !== null}
                          data-track-category='flow_board'
                          data-track-name='download_flow_runs'
                          className='flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60'
                        >
                          <Download className='h-3.5 w-3.5' />
                          {flowRunExporting ? 'Downloading…' : 'Download'}
                          <ChevronDownIcon className='h-3 w-3' />
                        </button>
                      </DropdownMenu.Trigger>
                      {flowExportDropdownMenu}
                    </DropdownMenu.Root>
                  )}
                  {isFlowBoard && filteredSingleBoardId && flowProjectId && (
                    <button
                      type='button'
                      onClick={() =>
                        void navigate(
                          `/listProjects/${flowProjectId}?editBoard=${filteredSingleBoardId}`,
                        )
                      }
                      data-track-category='flow_board'
                      data-track-name='edit_board'
                      className='flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
                    >
                      <Pencil className='h-3 w-3' />
                      Edit board
                    </button>
                  )}
                </div>
              </div>
            )}
            {ticketsDetails.type !== 'complete' ? (
              <div className='rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground'>
                Loading tickets...
              </div>
            ) : !selectedGraphRootTicketId ? (
              <div className='min-h-0 flex-1 overflow-y-auto p-4'>
                {ticketGraphNodes.length > 0 ? (
                  <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
                    {ticketGraphNodes.map(root => {
                      const statusLabel = root.statusLabel;
                      const assigneeId =
                        root.assignedTo?.replace(/^(user:|group:|userGroup:)/, '') || '';
                      const priorityIcon = root.priority ? getPriorityIcon(root.priority) : null;
                      const childCount = root.children.length;
                      const summary = flowRunSummaries.get(root.key);
                      const progressPct = summary?.totalCount
                        ? Math.round((summary.completedCount / summary.totalCount) * 100)
                        : 0;
                      const progressColor =
                        summary?.state === 'completed'
                          ? '#22c55e'
                          : summary?.state === 'cancelled'
                            ? '#ef4444'
                            : '#6276be';

                      return (
                        <button
                          key={root.key}
                          type='button'
                          data-track-category='flow_board'
                          data-track-name='open_flow_run'
                          onClick={() => {
                            // An explicit open from the grid starts fresh
                            forgetRunUiState(root.key);
                            setSelectedGraphRootTicketId(root.key);
                          }}
                          className='flex h-full flex-col gap-2 rounded-xl border border-border bg-background p-4 text-left shadow-sm transition-all hover:-translate-y-px hover:border-[#6276be]/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
                        >
                          <div className='flex items-center justify-between gap-2'>
                            <span className='font-mono text-[11px] font-medium text-muted-foreground'>
                              {root.displayId}
                            </span>
                            {summary ? (
                              <span
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                                  summary.state === 'completed' &&
                                    'bg-emerald-500/10 text-emerald-600',
                                  summary.state === 'cancelled' && 'bg-red-500/10 text-red-500',
                                  summary.state === 'pending' && 'bg-[#6276be]/10 text-[#6276be]',
                                  summary.state === 'backlog' && 'bg-amber-500/10 text-amber-700',
                                  summary.state === 'not-started' &&
                                    'bg-muted text-muted-foreground',
                                )}
                              >
                                {summary.state === 'completed'
                                  ? 'Completed'
                                  : summary.state === 'cancelled'
                                    ? 'Cancelled'
                                    : summary.state === 'pending'
                                      ? 'In progress'
                                      : summary.state === 'backlog'
                                        ? 'Backlog'
                                        : 'To Do'}
                              </span>
                            ) : (
                              statusLabel && (
                                <span className='rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground'>
                                  {statusLabel}
                                </span>
                              )
                            )}
                          </div>
                          <div className='truncate text-sm font-semibold text-foreground'>
                            {root.title}
                          </div>
                          {summary && (
                            <div className='h-1 w-full overflow-hidden rounded-full bg-muted'>
                              <div
                                className='h-full rounded-full transition-all'
                                style={{
                                  width: `${progressPct}%`,
                                  backgroundColor: progressColor,
                                }}
                              />
                            </div>
                          )}
                          {summary &&
                            summary.state !== 'pending' &&
                            summary.state !== 'backlog' &&
                            summary.cancelled.length === 0 && (
                              <div className='flex flex-1 items-center justify-center py-1'>
                                <span
                                  className={cn(
                                    'flex items-center gap-1.5 text-[11px]',
                                    summary.state === 'completed' && 'text-emerald-600/80',
                                    summary.state === 'cancelled' && 'text-red-500/80',
                                    summary.state === 'not-started' && 'text-muted-foreground/70',
                                  )}
                                >
                                  {summary.state === 'completed' ? (
                                    <>
                                      <CheckCircle2 size={13} />
                                      All steps completed
                                    </>
                                  ) : summary.state === 'cancelled' ? (
                                    <>
                                      <XCircle size={13} />
                                      Run cancelled
                                    </>
                                  ) : (
                                    'All steps To Do'
                                  )}
                                </span>
                              </div>
                            )}
                          {summary?.state === 'pending' && (
                            <div className='flex flex-1 flex-col gap-1.5 pt-1.5'>
                              <span className='text-[9px] font-semibold uppercase tracking-[0.6px] text-muted-foreground/70'>
                                Waiting on
                              </span>
                              {summary.pending.slice(0, 2).map(step => (
                                <div
                                  key={step.id}
                                  className='flex w-full items-center gap-2 rounded-md bg-[#6276be]/[0.06] px-2.5 py-1.5 text-[11px]'
                                >
                                  <span className='inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#6276be]' />
                                  <span className='min-w-0 flex-1 truncate text-foreground/80'>
                                    {step.title}
                                  </span>
                                  {step.groupId && step.groupName && (
                                    <span
                                      className='max-w-[45%] shrink-0 truncate rounded px-1.5 py-px text-[10px] font-medium'
                                      style={{
                                        backgroundColor: `${flowGroupColor(step.groupId)}1a`,
                                        color: flowGroupColor(step.groupId),
                                      }}
                                    >
                                      {step.groupName}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {summary.pending.length > 2 && (
                                <div className='flex w-full items-center justify-center rounded-md bg-muted/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground'>
                                  +{summary.pending.length - 2} more
                                </div>
                              )}
                            </div>
                          )}
                          {summary?.state === 'backlog' && (
                            <div className='flex flex-1 flex-col gap-1.5 pt-1.5'>
                              <span className='text-[9px] font-semibold uppercase tracking-[0.6px] text-amber-600/80'>
                                Backlog steps
                              </span>
                              {summary.backlogged.slice(0, 2).map(step => (
                                <div
                                  key={step.id}
                                  className='flex w-full items-center gap-2 rounded-md bg-amber-500/[0.06] px-2.5 py-1.5 text-[11px]'
                                >
                                  <Archive size={12} className='shrink-0 text-amber-600' />
                                  <span className='min-w-0 flex-1 truncate text-foreground/80'>
                                    {step.title}
                                  </span>
                                  {step.groupId && step.groupName && (
                                    <span
                                      className='max-w-[45%] shrink-0 truncate rounded px-1.5 py-px text-[10px] font-medium'
                                      style={{
                                        backgroundColor: `${flowGroupColor(step.groupId)}1a`,
                                        color: flowGroupColor(step.groupId),
                                      }}
                                    >
                                      {step.groupName}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {summary.backlogged.length > 2 && (
                                <div className='flex w-full items-center justify-center rounded-md bg-amber-500/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-amber-700/80'>
                                  +{summary.backlogged.length - 2} more
                                </div>
                              )}
                            </div>
                          )}
                          {summary && summary.cancelled.length > 0 && (
                            <div className='flex flex-1 flex-col gap-1.5 pt-1.5'>
                              <span className='text-[9px] font-semibold uppercase tracking-[0.6px] text-red-500/80'>
                                Cancelled steps
                              </span>
                              {summary.cancelled.slice(0, 2).map(step => (
                                <div
                                  key={step.id}
                                  className='flex w-full items-center gap-2 rounded-md bg-red-500/[0.06] px-2.5 py-1.5 text-[11px]'
                                >
                                  <XCircle size={12} className='shrink-0 text-red-500' />
                                  <span className='min-w-0 flex-1 truncate text-foreground/80'>
                                    {step.title}
                                  </span>
                                  {step.groupId && step.groupName && (
                                    <span
                                      className='max-w-[45%] shrink-0 truncate rounded px-1.5 py-px text-[10px] font-medium'
                                      style={{
                                        backgroundColor: `${flowGroupColor(step.groupId)}1a`,
                                        color: flowGroupColor(step.groupId),
                                      }}
                                    >
                                      {step.groupName}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {summary.cancelled.length > 2 && (
                                <div className='flex w-full items-center justify-center rounded-md bg-red-500/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-red-500/80'>
                                  +{summary.cancelled.length - 2} more cancelled
                                </div>
                              )}
                            </div>
                          )}
                          <div className='mt-auto flex items-center justify-between gap-2 pt-1'>
                            <span className='flex items-center gap-1.5'>
                              {priorityIcon}
                              {assigneeId && (
                                <Avatar userId={assigneeId} size='sm' className='rounded-md' />
                              )}
                            </span>
                            <span className='text-[11px] text-muted-foreground'>
                              {summary
                                ? `${summary.completedCount}/${summary.totalCount} steps done`
                                : `${childCount} nodes`}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className='rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground'>
                    No tickets match the current filters.
                  </div>
                )}
              </div>
            ) : isFlowBoard && flowModel ? (
              <div ref={attachFlowCanvas} className='relative min-h-0 flex-1'>
                <ReactFlow
                  nodes={searchedFlowRunNodes}
                  edges={flowRunGraph.edges}
                  nodeTypes={FLOW_NODE_TYPES}
                  fitView
                  fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
                  minZoom={0.3}
                  maxZoom={2}
                  nodesDraggable
                  nodesConnectable={false}
                  elementsSelectable
                  onPaneClick={() => setFlowSelection(null)}
                  // Only user-driven moves carry an event — programmatic fits don't.
                  onMoveStart={(event, _viewport) => {
                    if (event) focusedFlowNodeRef.current = null;
                  }}
                  onInit={instance => {
                    flowRunInstanceRef.current = instance;
                    // Entry focus may have been requested before the canvas
                    // mounted — replay it now that fitView can resolve nodes.
                    const pending = pendingFlowFocusRef.current;
                    if (pending) focusFlowNode(pending);
                  }}
                  proOptions={{ hideAttribution: true }}
                  className={cn(
                    'flow-run-view',
                    flowRunSearchMatches && 'flow-run-view--searching',
                  )}
                >
                  <Background
                    variant={BackgroundVariant.Dots}
                    gap={22}
                    size={1}
                    color='hsl(var(--border))'
                  />
                  <MiniMap
                    pannable
                    zoomable
                    position='bottom-left'
                    nodeColor='hsl(var(--muted-foreground))'
                    maskColor='hsl(var(--background) / 0.72)'
                    style={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                    }}
                  />
                  <Panel
                    position='top-left'
                    className='!bottom-0 flex min-h-0 flex-col items-start'
                  >
                    <div
                      className={cn(
                        'flex max-h-full flex-col overflow-hidden rounded-xl border border-border/80 bg-background/95 text-xs text-muted-foreground shadow-lg shadow-black/5 backdrop-blur-md',
                        flowActivityOpen
                          ? 'w-[340px] max-w-[calc(100vw-3rem)]'
                          : 'w-fit min-w-[112px]',
                      )}
                    >
                      <button
                        type='button'
                        onClick={() => {
                          const nextOpen = !flowLegendOpen;
                          setFlowLegendOpen(nextOpen);
                          if (nextOpen) setFlowActivityOpen(false);
                        }}
                        data-track-category='flow_board'
                        data-track-name='toggle_flow_legend'
                        className='flex w-full shrink-0 items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/50'
                      >
                        <span className='flex min-w-0 items-center gap-1.5'>
                          <GitBranch size={14} />
                          <span className='font-semibold text-foreground/80'>Legend</span>
                        </span>
                        {flowLegendOpen ? (
                          <ChevronDownIcon className='h-3 w-3' />
                        ) : (
                          <ChevronRight size={12} />
                        )}
                      </button>
                      {flowLegendOpen && (
                        <div className='flex shrink-0 flex-col gap-1.5 border-t border-border/70 px-3.5 py-2.5'>
                          <span className='flex items-center gap-2'>
                            <span className='inline-block w-6 border-t-2 border-dashed border-[#6276be]' />
                            Waiting — flow is at this step
                          </span>
                          <span className='flex items-center gap-2'>
                            <span className='inline-block w-6 border-t-2 border-[#6276be]' />
                            To Do — created when its parents complete
                          </span>
                          <span className='flex items-center gap-2'>
                            <span className='inline-block w-6 border-t-2 border-[#22c55e]' />
                            Completed step
                          </span>
                          <span className='flex items-center gap-2'>
                            <span className='inline-block w-6 border-t-2 border-[#d97706]' />
                            Backlog — skipped manually; flow continues
                          </span>
                          <span className='flex items-center gap-2'>
                            <span className='inline-block w-6 border-t-2 border-[#ef4444]' />
                            Cancelled step
                          </span>
                          <span className='flex items-center gap-2'>
                            <span className='inline-block w-6 border-t-2 border-[#d4d4d8] opacity-60' />
                            Skipped — a parent step was cancelled
                          </span>
                          {/* Status symbols (as shown in collapsed group rows) */}
                          <div className='mt-1 flex flex-col gap-1.5 border-t border-border pt-1.5'>
                            {STATUS_OPTIONS.map(option => (
                              <span key={option.status} className='flex items-center gap-2'>
                                <span className='flex w-6 justify-center'>{option.icon}</span>
                                {option.label}
                              </span>
                            ))}
                            <span className='flex items-center gap-2'>
                              <span className='flex w-6 justify-center text-amber-600'>
                                <Archive size={12} />
                              </span>
                              Backlog
                            </span>
                            <span className='flex items-center gap-2'>
                              <span className='flex w-6 justify-center text-[10px]'>—</span>
                              Skipped
                            </span>
                          </div>
                        </div>
                      )}
                      <button
                        type='button'
                        onClick={() => {
                          const nextOpen = !flowActivityOpen;
                          setFlowActivityOpen(nextOpen);
                          if (nextOpen) setFlowLegendOpen(false);
                        }}
                        data-track-category='flow_board'
                        data-track-name='toggle_flow_activity'
                        className='flex w-full shrink-0 items-center justify-between gap-3 border-t border-border/70 bg-background/90 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/50'
                      >
                        <span className='flex min-w-0 items-center gap-1.5'>
                          <Clock size={14} />
                          <span className='font-semibold text-foreground/80'>Run activity</span>
                        </span>
                        <span className='flex shrink-0 items-center gap-2'>
                          {flowRunTimelineActivities.length > 0 && (
                            <span className='rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground'>
                              {flowRunTimelineActivities.length}
                            </span>
                          )}
                          {flowActivityOpen ? (
                            <ChevronDownIcon className='h-3 w-3' />
                          ) : (
                            <ChevronRight size={12} />
                          )}
                        </span>
                      </button>
                      {flowActivityOpen && (
                        <div className='min-h-0 flex-1 scroll-pb-4 overflow-y-auto overscroll-contain border-t border-border/70 bg-muted/20 px-3.5 pb-4 pt-2'>
                          {flowRunTimelineActivities.length > 0 ? (
                            flowRunTimelineActivities.map((activity, activityIndex) => {
                              const activityTicket = flowRunTicketById.get(activity.ticketId);
                              const actorName = userNamesById.get(activity.updatedBy) || 'Someone';
                              const { description, details, hideActorName } =
                                getActivityDescription(
                                  activity,
                                  allUsers,
                                  undefined,
                                  allUserGroups,
                                );
                              const timestamp = new Date(activity.timestamp);
                              const previousActivity = flowRunTimelineActivities[activityIndex - 1];
                              const previousDate = previousActivity
                                ? new Date(previousActivity.timestamp).toDateString()
                                : null;
                              const showDate = timestamp.toDateString() !== previousDate;
                              return (
                                <React.Fragment key={activity.id}>
                                  {showDate && (
                                    <div className='sticky top-0 z-10 -mx-1 bg-muted/95 py-1.5 pl-10 pr-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground backdrop-blur-sm'>
                                      {timestamp.toLocaleDateString(undefined, {
                                        month: 'short',
                                        day: 'numeric',
                                        year:
                                          timestamp.getFullYear() !== new Date().getFullYear()
                                            ? 'numeric'
                                            : undefined,
                                      })}
                                    </div>
                                  )}
                                  <div className='group relative flex gap-3 py-2.5 after:absolute after:bottom-0 after:left-[13px] after:top-8 after:w-px after:bg-border/70 last:after:hidden'>
                                    <span className='relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/80 bg-background shadow-sm'>
                                      {getActivityIcon(activity)}
                                    </span>
                                    <div className='min-w-0 flex-1 pb-1'>
                                      <div className='mb-1 flex items-center justify-between gap-2'>
                                        <span
                                          className='max-w-[160px] truncate rounded-md bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground/70 ring-1 ring-inset ring-border/70'
                                          title={activityTicket?.title ?? undefined}
                                        >
                                          {activityTicket?.xyneId ??
                                            activity.ticketId.slice(0, 8).toUpperCase()}
                                        </span>
                                        <time
                                          dateTime={timestamp.toISOString()}
                                          title={timestamp.toLocaleString()}
                                          className='shrink-0 text-[10px] tabular-nums text-muted-foreground/70'
                                        >
                                          {timestamp.toLocaleTimeString(undefined, {
                                            hour: 'numeric',
                                            minute: '2-digit',
                                          })}
                                        </time>
                                      </div>
                                      <p className='break-words text-[12px] leading-[1.45] text-muted-foreground'>
                                        {!hideActorName && (
                                          <span className='font-semibold text-foreground/90'>
                                            {actorName}{' '}
                                          </span>
                                        )}
                                        {description}
                                        {details && <span> {details}</span>}
                                      </p>
                                    </div>
                                  </div>
                                </React.Fragment>
                              );
                            })
                          ) : (
                            <p className='py-4 text-center text-muted-foreground'>
                              No run activity yet.
                            </p>
                          )}
                          {loadedFlowRunActivities.length > 0 && flowRunHasMoreActivities && (
                            <div
                              ref={flowRunActivityLoadMoreRef}
                              className='py-3 text-center text-[11px] text-muted-foreground/70'
                              aria-live='polite'
                            >
                              {flowRunActivityLoadingScope === flowRunActivityScopeKey
                                ? 'Loading older activity…'
                                : 'Scroll for older activity'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </Panel>
                </ReactFlow>
                {flowThreadTicket && (
                  <div className='absolute bottom-4 right-4 top-4 z-20 flex w-[480px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl'>
                    <ThreadMessages
                      ticketId={flowThreadTicket.id}
                      {...(flowThreadTicket.channelId && {
                        channelId: flowThreadTicket.channelId,
                      })}
                      {...(flowThreadTicket.conversationId && {
                        conversationId: flowThreadTicket.conversationId,
                      })}
                      // A restore must not pull keyboard focus into the composer.
                      skipInputAutoFocus
                      onClose={() => setFlowThreadTicket(null)}
                    />
                  </div>
                )}
                {flowSelection && filteredSingleBoardId && flowProjectId && (
                  <div className='absolute bottom-4 right-4 top-4 z-10 flex items-start'>
                    <FlowNodeSidePanel
                      node={flowSelection}
                      backlogSteps={selectedFlowRunBacklogs}
                      onShowDetails={handleShowFlowTicketDetails}
                      locked={
                        flowSelection.planNode
                          ? flowRunGraph.locked.has(flowSelection.planNode.id)
                          : false
                      }
                      backlogBlockedReason={
                        flowSelection.planNode &&
                        selectedFlowRunModel?.decisionAfter(flowSelection.planNode.id)
                          ? 'Conditional form steps must be submitted before the flow can continue.'
                          : undefined
                      }
                      onClose={() => setFlowSelection(null)}
                      onChangeStatus={handleFlowStatusChange}
                      onBacklog={handleFlowStepBacklog}
                      onSelectBacklog={handleSelectFlowBacklog}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className='rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground'>
                No tickets match the current filters.
              </div>
            )}
          </div>
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
                      availableTags={availableTags || []}
                      visibleColumns={tableVisibleColumns}
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
            <div className={`h-full flex flex-col space-y-5 ${groupBy !== 'none' ? 'mb-12' : ''}`}>
              {processedGroups.map(group => {
                const isExpanded = expandedGroups.has(group.key);
                const showGroupHeader = groupBy !== 'none';
                const serverCountGroup = isKanbanLayout
                  ? kanbanCounts.groupsByKey.get(group.key)
                  : undefined;
                const stageCounts = group.stageCounts ?? serverCountGroup?.stages;
                const groupCount = group.count;
                const paginatedColumnConfig = canUseKanbanColumnPagination
                  ? {
                      columnType: shouldUseStatusColumns ? ('status' as const) : ('stage' as const),
                      baseArgs: {
                        ...ticketsQueryParams,
                        searchTerm,
                        filters: deferredFilters,
                        formEntityValueFieldIds: fevFieldIds,
                        dynamicFieldVespaTokens,
                        dynamicFieldDateRanges,
                        zeroOnlyDynamicFieldIds,
                        showOverdueOnly,
                        groupBy,
                        ...(groupBy !== 'none' ? { groupKey: group.key } : {}),
                      },
                    }
                  : null;

                return (
                  <div key={group.key} className={isExpanded || !showGroupHeader ? 'h-full' : ''}>
                    {showGroupHeader && (
                      <button
                        onClick={() => toggleGroupExpansion(group.key)}
                        data-track-category='KANBAN'
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
                            {groupCount}
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
                          {...(stageCounts ? { stageCounts } : {})}
                          onTicketClick={handleTicketClick}
                          visibleColumns={visibleColumns}
                          availableTags={availableTags || []}
                          keyPrefix={`${group.key}::`}
                          onTicketsChange={handleKanbanTicketsChange}
                          allKnownTickets={localTickets ?? []}
                          {...(paginatedColumnConfig ? { paginatedColumnConfig } : {})}
                          {...(canCreateTicket &&
                          channel &&
                          !channel.isArchived &&
                          effectiveProjectId
                            ? {
                                onAddTicketInColumn: (col: {
                                  status?: TicketStatusV2 | undefined;
                                  stageName?: string | undefined;
                                }) =>
                                  openCreateForColumn({
                                    status: col.status,
                                    stageName: col.stageName,
                                    assignee:
                                      group.entityType === 'user' && group.entityId
                                        ? { type: 'assigneeTo', value: group.entityId }
                                        : group.entityType === 'group' && group.entityId
                                          ? { type: 'userGroup', value: group.entityId }
                                          : null,
                                  }),
                              }
                            : {})}
                          slaPolicies={kanbanSlaPolicies}
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
                  slaPolicies={kanbanSlaPolicies}
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
          enableUrlSync
          onClose={() => {
            setIsCreateModalOpen(false);
            setCreateTicketSeed(null);
            setSearchParams(prev => clearCreateTicketParams(new URLSearchParams(prev)), {
              replace: true,
            });
          }}
          channelId={channel.id}
          projectId={effectiveProjectId}
          selectedBoardId={currentBoardId}
          initialStatus={createTicketSeed?.status ?? null}
          initialStageName={createTicketSeed?.stageName ?? null}
          initialAssignee={createTicketSeed?.assignee ?? null}
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
          isNonLinearBoard={isNonLinearBoard}
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
                    void surfaceMutationError(
                      zero.mutate(
                        mutators.ticket.update({
                          id: backwardStageChange.ticketId,
                          stageName: backwardStageChange.stageName,
                          ...(backwardStageChange.newStatus && {
                            statusV2: backwardStageChange.newStatus,
                          }),
                          updatedAt: Date.now(),
                        }),
                      ),
                      'Failed to move ticket',
                    );

                    setShowBackwardConfirmDialog(false);
                  }
                }}
                className='bg-primary text-primary-foreground hover:bg-blue-700'
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
              <Button
                variant='secondary'
                onClick={cancelRejectedApproval}
                data-track-category='Tickets'
                data-track-name='CANCEL_REJECTED_APPROVAL'
              >
                Cancel
              </Button>
              <Button
                onClick={confirmRejectedApproval}
                data-track-category='Tickets'
                data-track-name='CONFIRM_REJECTED_APPROVAL'
                className='bg-primary text-primary-foreground hover:bg-blue-700'
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
            <p className='text-sm text-muted-foreground mb-6'>
              {deleteViewConfirm.isPublic
                ? `"${deleteViewConfirm.name}" is a public view visible to all members. Deleting it will remove it for everyone. Are you sure you want to delete it?`
                : `Are you sure you want to delete the saved view "${deleteViewConfirm.name}"? This action cannot be undone.`}
            </p>
            <div className='flex justify-end gap-3'>
              <Button
                variant='secondary'
                onClick={() => setDeleteViewConfirm(null)}
                data-track-category='Tickets'
                data-track-name='CANCEL_DELETE_VIEW'
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (selectedViewId === deleteViewConfirm.configId) {
                    setSelectedViewId(null);
                    try {
                      sessionStorage.removeItem(activeViewKey);
                    } catch (err) {
                      logger.error(Event.FRONTEND_ERROR, {
                        type: 'migrated_console_error',
                        message: String('Failed to remove active view from sessionStorage'),
                        error: err,
                      });
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
                data-track-category='Tickets'
                data-track-name='CONFIRM_DELETE_VIEW'
                className='bg-red-500 text-white hover:bg-red-600'
              >
                Delete
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      <ConfirmDialog />
    </div>
  );
};

KanbanBoardScreen.displayName = 'KanbanBoardScreen';

export default KanbanBoardScreen;
