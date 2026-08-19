import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  ICellRendererParams,
  ColDef,
  GridApi,
  IHeaderParams,
  RowClickedEvent,
  GridReadyEvent,
  ValueGetterParams,
} from 'ag-grid-community';
import type { Ticket, TicketTag } from '@xyne/shared';
import { BoardType, isDeskChannelType } from '@xyne/shared';
import {
  BaseTicketType,
  BulkTicketMode,
  ChannelScopeType,
  TicketPriority,
  TicketStatusV2,
} from '@xyne/shared';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { useUser, useUsers, useActiveUserSearch } from '../../../hooks/useUsers';
import { useUserGroupById, useUserGroups } from '../../../hooks/useUserGroup';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { Calendar, Check, User } from 'lucide-react';
import Tooltip, { TruncatedTooltip } from '../../ui/Tooltip';
import { formatStatusLabel, getPriorityIcon, isEtaUrgent } from '../TicketCard/TicketCard.utils';
import { mutators } from '../../../zero/mutators';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import {
  AssigneeCellEditor,
  StatusCellEditor,
  PriorityCellEditor,
  StageCellEditor,
  DueDateCellEditor,
  TagsCellEditor,
} from './CellEditor';
import { BulkActionToolbar } from './BulkActionToolbar';
import { StatusOptions } from './TicketTableHelper';
import Avatar from '../../ui/Avatar/Avatar';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { usePlatform } from '../../../hooks/usePlatform';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { useAllChannels } from '../../../hooks/useChannels';
import { useAuth } from '../../../hooks/useAuth';
import { apiInstance } from '../../../services/clients/apiClient';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { cn } from '../../../utils/classNames';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import { getPriorityOptions } from '../CreateTicketModal/createTicket.utils';

ModuleRegistry.registerModules([AllCommunityModule]);

interface DraftTicketRow {
  id: string;
  isDraft: true;
  title: string;
  description: string;
  priority: TicketPriority;
  channelId: string;
  boardId: string;
  statusV2: TicketStatusV2;
  assignedTo: string | null;
  ticketType: BaseTicketType;
  eta: Date | null;
}

interface TicketTableProps {
  tickets: Ticket[];
  ticketTags?: Map<string, TicketTag[]>;
  availableTags?: string[];
  onRowClick?: (ticket: Ticket) => void;
  onTitleClick?: (ticket: Ticket) => void;
  visibleColumns?: Set<string>;
  isComfortView?: boolean;
  extraColumns?: ColDef<Ticket>[];
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (tickets: Ticket[]) => void;
  draftRowCount?: number;
  onDraftCountChange?: (count: number) => void;
  channelId?: string | undefined;
  projectId?: string | undefined;
  boardId?: string | null | undefined;
}

const isDraftRow = (data: Ticket | DraftTicketRow | undefined): data is DraftTicketRow => {
  return !!data && 'isDraft' in data && data.isDraft === true;
};

const DraftCellWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className='h-full flex items-center px-1'
    onClick={e => e.stopPropagation()}
    onKeyDown={e => e.stopPropagation()}
    role='presentation'
    data-track-category='Tickets'
    data-track-name='DraftCell'
  >
    {children}
  </div>
);

let draftRowSeq = 0;
const newDraftId = (): string => `draft-${++draftRowSeq}`;

const newDraftRow = (channelId: string, boardId: string): DraftTicketRow => ({
  id: newDraftId(),
  isDraft: true,
  title: '',
  description: '',
  priority: TicketPriority.MEDIUM,
  channelId,
  boardId,
  statusV2: TicketStatusV2.TODO,
  assignedTo: null,
  ticketType: BaseTicketType.Fix,
  eta: null,
});

// Index header renderer component
const IndexHeaderRenderer = (params: IHeaderParams) => {
  const [allSelected, setAllSelected] = useState(false);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      params.api.selectAll();
    } else {
      params.api.deselectAll();
    }
    setAllSelected(e.target.checked);
  };

  // Listen to selection changes
  useEffect(() => {
    const onSelectionChanged = () => {
      const selectedRows = params.api.getSelectedRows();
      const totalRows = params.api.getDisplayedRowCount();
      setAllSelected(selectedRows.length === totalRows && totalRows > 0);
    };

    params.api.addEventListener('selectionChanged', onSelectionChanged);
    return () => {
      params.api.removeEventListener('selectionChanged', onSelectionChanged);
    };
  }, [params]);

  return (
    <div className='flex items-center justify-center h-full w-full'>
      <input
        type='checkbox'
        checked={allSelected}
        onChange={handleSelectAll}
        className='w-4 h-4 cursor-pointer'
        onClick={e => e.stopPropagation()}
        data-track-category='Tickets'
        data-track-name='ToggleSelectAll'
      />
    </div>
  );
};

// Index cell renderer component
const IndexCellRenderer = (params: ICellRendererParams<Ticket>) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isSelected, setIsSelected] = useState(params.node.isSelected());
  const rowIndex = (params.node.rowIndex ?? 0) + 1;
  useEffect(() => {
    const onSelectionChanged = () => {
      setIsSelected(params.node.isSelected());
    };

    params.api.addEventListener('selectionChanged', onSelectionChanged);
    return () => {
      params.api.removeEventListener('selectionChanged', onSelectionChanged);
    };
  }, [params.api, params.node]);

  return (
    <button
      className='flex items-center justify-center h-full w-full'
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isSelected ? (
        <button
          className='flex items-center justify-center w-4 h-4 bg-blue-600 rounded cursor-pointer'
          onClick={e => {
            e.stopPropagation();
            params.node.setSelected(false);
          }}
          data-track-category='Tickets'
          data-track-name='DeselectRow'
        >
          <Check className='w-3 h-3 text-white' strokeWidth={3} />
        </button>
      ) : isHovered ? (
        <input
          type='checkbox'
          checked={isSelected}
          onChange={e => {
            params.node.setSelected(e.target.checked);
          }}
          className='w-4 h-4 cursor-pointer'
          onClick={e => e.stopPropagation()}
          data-track-category='Tickets'
          data-track-name='SelectRow'
        />
      ) : (
        <span className='text-sm text-muted-foreground'>{rowIndex}</span>
      )}
    </button>
  );
};

export const TicketTable: React.FC<TicketTableProps> = ({
  tickets,
  ticketTags,
  availableTags = [],
  onRowClick,
  onTitleClick,
  isComfortView = false,
  visibleColumns = new Set(['assignee', 'dueDate', 'status', 'priority', 'stage', 'tags']),
  extraColumns,
  selectedIds,
  onSelectionChange,
  draftRowCount = 0,
  onDraftCountChange,
  channelId: propChannelId,
  projectId: propProjectId,
  boardId: propBoardId,
}) => {
  const zero = useZero();
  const users = useUsers();
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const { baseRoute, buildChannelRoute } = useRouteContext();
  const allVisibleChannels = useAllVisibleChannels().filter(c => c.scopeType === ChannelScopeType.DEFAULT);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const assigneeResults = useActiveUserSearch(assigneeSearch, 50);
  const { user: currentUser } = useAuth();

  const [draftRows, setDraftRows] = useState<DraftTicketRow[]>([]);
  const [isSubmittingDrafts, setIsSubmittingDrafts] = useState(false);
  const draftRowCountRef = useRef(0);

  const [boards] = useCachedQuery(queries.boardsListByProject({ projectId: propProjectId ?? '' }), {
    enabled: !!propProjectId,
  });

  useEffect(() => {
    if (draftRowCount === draftRowCountRef.current) return;
    const prev = draftRowCountRef.current;
    draftRowCountRef.current = draftRowCount;
    if (draftRowCount === 0) {
      setDraftRows([]);
      return;
    }
    if (draftRowCount > prev) {
      const toAdd = draftRowCount - prev;
      const ref = draftRows[draftRows.length - 1];
      const chId = ref?.channelId ?? propChannelId ?? '';
      const bId = ref?.boardId ?? propBoardId ?? '';
      setDraftRows(prevRows => [
        ...prevRows,
        ...Array.from({ length: toAdd }, () => newDraftRow(chId, bId)),
      ]);
    }
  }, [draftRowCount, propChannelId, propBoardId, draftRows]);

  const updateDraftRow = useCallback(
    (id: string, patch: Partial<DraftTicketRow>): void => {
      setDraftRows(prev => {
        let needsAppend = false;
        const updated = prev.map(r => {
          if (r.id !== id) return r;
          const next = { ...r, ...patch };
          if (patch.title !== undefined && patch.title.trim() && !r.title.trim()) {
            needsAppend = true;
          }
          return next;
        });
        if (needsAppend && !updated.some(r => !r.title.trim())) {
          const ref = updated[updated.length - 1];
          const chId = ref?.channelId ?? propChannelId ?? '';
          const bId = ref?.boardId ?? propBoardId ?? '';
          return [...updated, newDraftRow(chId, bId)];
        }
        return updated;
      });
    },
    [propChannelId, propBoardId],
  );

  const removeDraftRow = useCallback(
    (id: string): void => {
      setDraftRows(prev => {
        const filtered = prev.filter(r => r.id !== id);
        const newCount = filtered.length;
        onDraftCountChange?.(newCount);
        draftRowCountRef.current = newCount;
        if (filtered.length === 0) return [];
        return filtered;
      });
    },
    [onDraftCountChange],
  );

  const filledDrafts = draftRows.filter(r => r.title.trim().length > 0);
  const validDraftCount = filledDrafts.length;
  const draftsValid = validDraftCount > 0;

  const defaultBoardId = useMemo(() => boards?.[0]?.id ?? '', [boards]);

  useEffect(() => {
    if (!defaultBoardId) return;
    setDraftRows(prev => {
      const needsUpdate = prev.some(r => !r.boardId);
      if (!needsUpdate) return prev;
      return prev.map(r => ({ ...r, boardId: r.boardId || defaultBoardId }));
    });
  }, [defaultBoardId]);

  const userGroups = useUserGroups();

  const draftAssigneeOptions: SelectorOption[] = useMemo(() => {
    const userOpts: SelectorOption[] = assigneeResults.map(u => ({
      label: getUserDisplayName(u),
      value: u.id,
      icon: <Avatar userId={u.id} size='xs' className='mr-1' />,
    }));
    const groupOpts: SelectorOption[] = (userGroups ?? []).map(g => ({
      label: g.name ?? g.id,
      value: `group:${g.id}`,
      icon: null,
    }));
    return [...userOpts, ...groupOpts];
  }, [assigneeResults, userGroups]);

  const draftPriorityOptions: SelectorOption[] = useMemo(
    () =>
      getPriorityOptions().map(p => ({
        ...p,
        icon: p.icon ?? null,
      })),
    [],
  );

  // Aggregate ticket lists mix channels, so resolve each row's channel type to
  // route desk/support tickets to the Support desk instead of the chat panel.
  const allChannels = useAllChannels();
  const channelsById = useMemo(() => new Map(allChannels.map(c => [c.id, c])), [allChannels]);

  // NON_LINEAR boards reject direct ticket.update — use the transition mutator instead.
  const routeStageChange = useCallback(
    async (
      ticketId: string,
      boardId: string | null | undefined,
      toStageName: string,
    ): Promise<void> => {
      if (boardId) {
        // No try/catch: Zero queries resolve through the cache and don't throw here.
        const board = (await zero.run(queries.boardDetailById({ boardId }), {
          type: 'complete',
        })) as { boardType?: string } | null;
        if (board?.boardType === BoardType.NON_LINEAR) {
          const result = zero.mutate(
            mutators.nonLinear.transition({ ticketId, toStageName, now: Date.now() }),
          );
          void (
            result as {
              server: Promise<{ type: string; error?: { message?: string } } | undefined>;
            }
          ).server.then(serverResult => {
            if (serverResult?.type === 'error') {
              toast.error(
                serverResult.error?.message === 'This transition requires a form to be submitted'
                  ? 'Open this ticket on its board to fill the required form for this stage'
                  : (serverResult.error?.message ?? 'Unable to change stage'),
              );
            }
          });
          return;
        }
      }
      void surfaceMutationError(
        zero.mutate(
          mutators.ticket.update({ id: ticketId, stageName: toStageName, updatedAt: Date.now() }),
        ),
        'Failed to update stage',
      );
    },
    [zero],
  );

  const [gridApi, setGridApi] = useState<GridApi | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);

  useEffect(() => {
    if (!gridApi || selectedIds === undefined) return;
    gridApi.forEachNode(node => {
      if (!node.data) return;
      const shouldBeSelected = selectedIds.has((node.data as Ticket).id);
      if (node.isSelected() !== shouldBeSelected) node.setSelected(shouldBeSelected);
    });
  }, [gridApi, selectedIds, tickets]);

  const theme = themeQuartz.withParams({
    headerBackgroundColor: 'hsl(var(--card))',
    headerTextColor: 'hsl(var(--muted-foreground))',
    headerFontWeight: '600',
    fontSize: '12px',
    ...(isComfortView
      ? {
          columnBorder: false,
          headerColumnBorder: false,
          borderColor: 'transparent',
        }
      : {
          columnBorder: { color: 'hsl(var(--border))', style: 'solid' },
          headerColumnBorder: { color: 'hsl(var(--border))', style: 'solid' },
        }),
    rowBorder: { color: 'hsl(var(--border))', style: 'solid' },
    headerRowBorder: { color: 'hsl(var(--border))', style: 'solid' },
    selectedRowBackgroundColor: 'hsl(var(--accent))',
  });

  const columnDefs = useMemo<ColDef<Ticket>[]>(() => {
    const allColumns: Array<ColDef<Ticket> & { key: string }> = [
      {
        key: 'index',
        headerName: '#',
        width: 60,
        maxWidth: 60,
        pinned: 'left',
        lockPosition: true,
        suppressMovable: true,
        headerComponent: IndexHeaderRenderer,
        cellRenderer: (params: ICellRendererParams<Ticket>) => {
          if (isDraftRow(params.data)) {
            const draftRow = params.data;
            return (
              <div className='flex items-center justify-center h-full w-full'>
                <button
                  className='size-5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 flex items-center justify-center transition'
                  onClick={e => {
                    e.stopPropagation();
                    removeDraftRow(draftRow.id);
                  }}
                  title='Remove row'
                  data-track-category='Tickets'
                  data-track-name='DraftRemoveRow'
                >
                  <Trash2 className='size-3.5' />
                </button>
              </div>
            );
          }
          return <IndexCellRenderer {...params} />;
        },
        cellStyle: { padding: 0 },
      },

      {
        key: 'title',
        headerName: 'Ticket name',
        field: 'title',
        minWidth: isComfortView ? 340 : 300,
        editable: true,
        cellEditor: 'agTextCellEditor',
        cellEditorParams: {
          maxLength: 250,
        },
        onCellValueChanged: params => {
          const newTitle = typeof params.newValue === 'string' ? params.newValue.trim() : '';
          const oldValue = typeof params.oldValue === 'string' ? params.oldValue : '';

          if (newTitle && newTitle !== oldValue && params.data) {
            void surfaceMutationError(
              zero.mutate(
                mutators.ticket.update({
                  id: params.data.id,
                  title: newTitle,
                  updatedAt: Date.now(),
                }),
              ),
              'Failed to update title',
            );
          } else if (!newTitle) {
            params.node?.setDataValue('title', oldValue);
          }
        },
        cellRenderer: (params: ICellRendererParams<Ticket>): React.ReactNode => {
          if (!params.data) return null;

          const handleClick = (e: React.MouseEvent) => {
            e.stopPropagation();
          };

          const handleKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
            }
          };

          const handleTicketClick = () => {
            if (!params.data) return;

            // Desk tickets open in the Support screen, not the chat ticket panel.
            const ticketChannel = allChannels.find(c => c.id === params.data!.channelId);
            if (isDeskChannelType(ticketChannel?.type) && params.data.xyneId) {
              void navigate(`/support/${params.data.channelId}/${params.data.xyneId}`, {
                state: { conversationId: params.data.conversationId, ticketId: params.data.id },
              });
              return;
            }

            if (onTitleClick) {
              onTitleClick(params.data);
              return;
            }

            const currentUrl = window.location.pathname + window.location.search;
            const navState = { state: { fromMyTickets: false, returnToUrl: currentUrl } };

            // Desk/support tickets (EMAIL / SLACK / APP channels) open in the
            // Support desk email view (/support/:channelId/:xyneId), not chat.
            const ticketChannelType = channelsById.get(params.data.channelId)?.type;
            if (isDeskChannelType(ticketChannelType)) {
              // Deep-link when we have the xyneId; else fall back to the channel's
              // support inbox — a desk ticket must never open in chat.
              const supportRoute = params.data.xyneId
                ? `/support/${params.data.channelId}/${params.data.xyneId}`
                : `/support/${params.data.channelId}`;
              void navigate(supportRoute, navState);
              return;
            }

            // On mobile: navigate directly to ThreadMessages route with details tab
            // On desktop: use tab-based route for expanded view in ConversationPannel
            if (isMobile) {
              void navigate(
                `${baseRoute}/${params.data.channelId}/${params.data.conversationId}/${params.data.id}?selectedTab=details`,
                navState,
              );
            } else {
              void navigate(
                buildChannelRoute(params.data.channelId, {
                  tab: 'tickets',
                  ticketId: params.data.id,
                  conversationId: params.data.conversationId,
                }),
                navState,
              );
            }
          };

          return (
            <div
              className='flex items-center gap-2 h-full'
              onClick={handleClick}
              onKeyDown={handleKeyDown}
              role='button'
              tabIndex={0}
              data-track-category='Tickets'
              data-track-name='TicketRow'
            >
              <button
                className='text-xs text-muted-foreground font-medium font-mono hover:text-blue-600 hover:underline transition-colors'
                onClick={handleTicketClick}
                data-track-category='Tickets'
                data-track-name='OpenTicket'
              >
                {params.data.xyneId}
              </button>
              <TruncatedTooltip content={String(params.value ?? '')}>
                <span className='truncate font-medium text-foreground'>{params.value}</span>
              </TruncatedTooltip>
            </div>
          );
        },
      },

      {
        key: 'createdAt',
        headerName: 'Created at',
        field: 'createdAt',
        minWidth: 175,
        cellRenderer: (params: ICellRendererParams<Ticket>) => {
          if (!params.value) return <span className='text-muted-foreground'>—</span>;
          const createdAt = new Date(params.value as string | number | Date);
          if (Number.isNaN(createdAt.getTime())) {
            return <span className='text-muted-foreground'>—</span>;
          }
          const fullTimestamp = createdAt.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });
          return (
            <Tooltip content={fullTimestamp}>
              <span className='text-sm text-muted-foreground whitespace-nowrap'>
                {fullTimestamp}
              </span>
            </Tooltip>
          );
        },
      },

      {
        key: 'age',
        colId: 'age',
        headerName: 'Age',
        minWidth: 80,
        // Sorts on days elapsed, not createdAt — that would invert the order.
        valueGetter: (params: ValueGetterParams<Ticket>) => {
          const createdAt = params.data?.createdAt;
          if (!createdAt) return null;
          const created = new Date(createdAt);
          if (Number.isNaN(created.getTime())) return null;
          return Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
        },
        cellRenderer: (params: ICellRendererParams<Ticket>) =>
          typeof params.value === 'number' ? (
            <span className='text-sm text-muted-foreground whitespace-nowrap'>{params.value}d</span>
          ) : (
            <span className='text-muted-foreground'>—</span>
          ),
      },

      {
        key: 'assignee',
        headerName: 'Assignee',
        field: 'assignedTo',
        cellRenderer: AssigneeCellRenderer,
        editable: true,
        minWidth: 213,
        cellEditor: AssigneeCellEditor,
        cellEditorParams: {
          users: users,
        },
        onCellValueChanged: params => {
          if (params.newValue !== params.oldValue && params.data) {
            void surfaceMutationError(
              zero.mutate(
                mutators.ticket.update({
                  id: params.data.id,
                  assignedTo: typeof params.newValue === 'string' ? params.newValue : undefined,
                  updatedAt: Date.now(),
                }),
              ),
              'Failed to update assignee',
            );
          }
        },
      },

      {
        key: 'dueDate',
        headerName: 'Due date',
        field: 'eta',
        editable: true,
        minWidth: 140,
        cellEditor: DueDateCellEditor,
        cellRenderer: (params: ICellRendererParams<Ticket>) => {
          if (!params.value) {
            return (
              <div className='flex items-center gap-3 h-full text-muted-foreground'>
                <Calendar className='w-3.5 h-3.5' />
                <span className='text-sm'>No due date</span>
              </div>
            );
          }

          const date = new Date(params.value as string | number | Date);
          const formattedDate = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });

          const isUrgent = isEtaUrgent(params.data?.eta, params.data?.statusV2);

          return (
            <div
              className={`flex items-center gap-2 h-full ${
                isUrgent ? 'text-red-500' : 'text-muted-foreground'
              }`}
            >
              <Calendar className='w-3.5 h-3.5' />
              <span className='truncate text-sm'>{formattedDate}</span>
            </div>
          );
        },
      },

      {
        key: 'status',
        headerName: 'Status Category',
        field: 'statusV2',
        editable: true,
        minWidth: 170,
        cellEditor: StatusCellEditor,
        onCellValueChanged: params => {
          if (params.newValue !== params.oldValue && params.data) {
            void surfaceMutationError(
              zero.mutate(
                mutators.ticket.update({
                  id: params.data.id,
                  statusV2: String(params.newValue),
                  updatedAt: Date.now(),
                }),
              ),
              'Failed to update status',
            );
          }
        },
        cellRenderer: (params: ICellRendererParams<Ticket>) => {
          const statusOption = StatusOptions.find(opt => opt.value === params.value);
          return (
            <div className='flex items-center gap-2 h-full'>
              <div
                className={`flex items-center gap-2 px-2 rounded-lg ${statusOption?.bgColor} ${statusOption?.textColor}`}
              >
                {statusOption?.icon && (
                  <span className='flex-shrink-0 flex items-center justify-center'>
                    {statusOption.icon}
                  </span>
                )}
                <span className='inline-flex items-center rounded-full py-0.5 text-sm font-medium'>
                  {formatStatusLabel(String(params.value))}
                </span>
              </div>
            </div>
          );
        },
      },

      {
        key: 'priority',
        headerName: 'Priority',
        field: 'priority',
        editable: true,
        minWidth: 140,
        cellEditor: PriorityCellEditor,
        onCellValueChanged: params => {
          if (params.newValue !== params.oldValue && params.data) {
            void surfaceMutationError(
              zero.mutate(
                mutators.ticket.update({
                  id: params.data.id,
                  priority: params.newValue as Ticket['priority'],
                  updatedAt: Date.now(),
                }),
              ),
              'Failed to update priority',
            );
          }
        },
        cellRenderer: (params: ICellRendererParams<Ticket>) => {
          const formatPriority = (priority: string | null | undefined) => {
            if (!priority) return '—';
            return priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase();
          };

          const priorityValue = params.value as Ticket['priority'];

          return (
            <div className='flex items-center gap-2 h-full'>
              <Tooltip content={`Priority: ${formatPriority(priorityValue)}`}>
                <div className='flex items-center text-muted-foreground'>
                  {getPriorityIcon(priorityValue)}
                </div>
              </Tooltip>
              <span className='text-muted-foreground font-medium text-sm'>
                {formatPriority(priorityValue)}
              </span>
            </div>
          );
        },
      },

      {
        key: 'stage',
        headerName: 'Stage',
        field: 'stageName',
        editable: true,
        minWidth: 140,
        cellEditor: StageCellEditor,
        onCellValueChanged: params => {
          if (params.newValue !== params.oldValue && params.data) {
            void routeStageChange(params.data.id, params.data.boardId, String(params.newValue));
          }
        },
        cellRenderer: (params: ICellRendererParams<Ticket>) => (
          <div className='flex items-center h-full'>
            {/* Stage names outgrow the 140px column; without `truncate` the cell
                hard-clipped them with no ellipsis and no way to read the rest. */}
            <TruncatedTooltip content={String(params.value ?? '—')}>
              <span className='text-sm text-muted-foreground truncate'>{params.value ?? '—'}</span>
            </TruncatedTooltip>
          </div>
        ),
      },

      {
        key: 'tags',
        headerName: 'Labels',
        editable: true,
        cellEditor: TagsCellEditor,
        cellEditorParams: {
          availableTags: availableTags,
        },
        valueGetter: params => {
          if (!params.data) return [];
          const tags = ticketTags?.get(params.data.id) || [];
          return tags.map(t => t.name);
        },
        valueSetter: params => {
          if (!params.data) return false;

          const oldTags = ticketTags?.get(params.data.id) || [];
          const oldTagNames = oldTags.map(t => t.name);
          const newTagNames: string[] =
            Array.isArray(params.newValue) &&
            params.newValue.every((item): item is string => typeof item === 'string')
              ? params.newValue
              : [];

          const toAdd = newTagNames.filter(t => !oldTagNames.includes(t));
          const toRemove = oldTagNames.filter(t => !newTagNames.includes(t));
          toAdd.forEach(tagName => {
            if (params.data) {
              void surfaceMutationError(
                zero.mutate(
                  mutators.ticketTagV2.create({
                    ticketId: params.data.id,
                    tagId: uuidv4(),
                    projectTagId: uuidv4(),
                    mappingId: uuidv4(),
                    projectId: params.data.projectId,
                    tagName,
                  }),
                ),
                'Failed to add tag',
              );
            }
          });

          toRemove.forEach(tagName => {
            const tag = oldTags.find(t => t.name === tagName);
            if (tag?.id) {
              void surfaceMutationError(
                zero.mutate(mutators.ticketTagV2.delete({ tagId: tag.id, mappingId: tag.id })),
                'Failed to remove tag',
              );
            }
          });
          return false;
        },
        cellRenderer: (params: ICellRendererParams<Ticket>) => {
          if (!params.data) return null;

          const tags = ticketTags?.get(params.data.id) || [];
          if (!tags.length) return <span className='text-muted-foreground'>—</span>;

          return (
            <div className='flex items-center gap-2 h-full overflow-hidden'>
              {tags.slice(0, 2).map(tag => (
                <span
                  key={tag.id}
                  className='flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border bg-muted text-muted-foreground border-border'
                >
                  <span className='w-2 h-2 rounded-full bg-xyne-purple-400'></span>
                  {tag.name}
                </span>
              ))}
              {tags.length > 2 && (
                <span className='text-xs text-muted-foreground'>+{tags.length - 2}</span>
              )}
            </div>
          );
        },
      },
    ];

    return [
      ...allColumns.filter(
        col => col.key === 'index' || col.key === 'title' || visibleColumns.has(col.key),
      ),
      ...(extraColumns ?? []),
    ];
  }, [
    ticketTags,
    zero,
    visibleColumns,
    users,
    availableTags,
    onTitleClick,
    extraColumns,
    channelsById,
    draftRows,
    allVisibleChannels,
    boards,
    draftAssigneeOptions,
    draftPriorityOptions,
    updateDraftRow,
  ]);

  const handleBulkUpdate = useCallback(
    (updates: Partial<Ticket> = {}) => {
      if (!gridApi) return;

      if (Object.keys(updates).length > 0) {
        const selectedRows = gridApi.getSelectedRows();
        selectedRows.forEach((row: unknown) => {
          if (row && typeof row === 'object' && 'id' in row) {
            const ticket = row as Ticket;
            // Convert null eta to undefined for mutator
            const { eta, stageName, ...otherUpdates } = updates as {
              eta?: number | null;
              stageName?: string;
            };
            if (stageName !== undefined) {
              void routeStageChange(ticket.id, ticket.boardId, stageName);
            }
            const remaining = {
              ...otherUpdates,
              ...(eta !== undefined && { eta: eta ?? undefined }),
            };
            if (Object.keys(remaining).length > 0) {
              zero.mutate(
                mutators.ticket.update({
                  id: ticket.id,
                  ...remaining,
                  updatedAt: Date.now(),
                }),
              );
            }
          }
        });
      }

      gridApi.deselectAll();
      setSelectedCount(0);
    },
    [gridApi, zero],
  );

  const handleBulkTagUpdate = useCallback(
    (tagsToAdd: string[]) => {
      if (!gridApi) return;
      const selectedRows = gridApi.getSelectedRows();

      selectedRows.forEach(row => {
        const ticket = row as Ticket;
        tagsToAdd.forEach(tagName => {
          const existing = ticketTags?.get(ticket.id) || [];
          if (!existing.some(t => t.name === tagName)) {
            zero.mutate(
              mutators.ticketTagV2.create({
                ticketId: ticket.id,
                tagId: uuidv4(),
                projectTagId: uuidv4(),
                mappingId: uuidv4(),
                projectId: ticket.projectId,
                tagName,
              }),
            );
          }
        });
      });
      gridApi.deselectAll();
    },
    [gridApi, zero, ticketTags],
  );

  const handleSubmitDrafts = async (): Promise<void> => {
    if (!draftsValid || !currentUser || !propProjectId || filledDrafts.length === 0) return;
    setIsSubmittingDrafts(true);
    try {
      const completeRows = filledDrafts;
      const resolveAssignee = (assigneeId: string | null) => {
        if (!assigneeId) return { assignedTo: undefined, userGroupId: undefined };
        if (assigneeId.startsWith('group:')) {
          return { assignedTo: undefined, userGroupId: assigneeId.slice(6) };
        }
        return { assignedTo: assigneeId, userGroupId: undefined };
      };
      const ticketsPayload = completeRows.map(r => ({
        title: r.title.trim(),
        description: r.title.trim(),
        priority: r.priority,
        statusV2: r.statusV2,
        eta: r.eta ?? undefined,
        ...resolveAssignee(r.assignedTo),
        tags: [],
        ticketType: BaseTicketType.Fix,
        clientRowId: r.id,
      }));
      const body = {
        mode: BulkTicketMode.ALL_PARENTS,
        tickets: ticketsPayload,
        projectId: propProjectId,
        channelId: propChannelId,
        boardId: propBoardId ?? defaultBoardId,
      };
      const res = await apiInstance.post('/tickets/bulk-from-message', body);
      const data = res.data as {
        enqueuedSubTickets: number;
        failedSubTickets?: number;
        failedTitles?: string[];
      };
      if (data.failedSubTickets && data.failedSubTickets > 0) {
        toast.warning('Partial success', {
          description: `${data.enqueuedSubTickets} queued, ${data.failedSubTickets} failed: ${data.failedTitles?.join(', ')}`,
        });
      } else {
        toast.success('Tickets will be created shortly', {
          description: `${data.enqueuedSubTickets} ticket${data.enqueuedSubTickets !== 1 ? 's' : ''} queued.`,
        });
      }
      setDraftRows([]);
      draftRowCountRef.current = 0;
      onDraftCountChange?.(0);
    } catch (error) {
      console.error('Failed to create bulk tickets:', error);
      toast.error('Failed to create tickets', {
        description: 'Please try again or contact support.',
      });
    } finally {
      setIsSubmittingDrafts(false);
    }
  };

  const combinedRowData = useMemo(() => {
    return [...draftRows, ...tickets] as unknown as Ticket[];
  }, [draftRows, tickets]);

  return (
    <>
      <div className='flex flex-col'>
        {draftRows.length > 0 && (
          <div className='flex items-center justify-end gap-2 px-3 py-1.5 border-b border-border bg-muted/30'>
            <span className='text-[12px] text-muted-foreground font-medium mr-auto'>
              {validDraftCount} ready
            </span>
            <button
              type='button'
              onClick={() => {
                setDraftRows([]);
                draftRowCountRef.current = 0;
                onDraftCountChange?.(0);
              }}
              className='text-[12px] font-medium text-foreground px-2 py-1 rounded-md hover:bg-accent transition'
              data-track-category='Tickets'
              data-track-name='DraftCancelAll'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={() => void handleSubmitDrafts()}
              disabled={!draftsValid || isSubmittingDrafts}
              className={cn(
                'text-[12px] font-medium text-primary-foreground bg-primary px-3 py-1 rounded-md flex items-center gap-1 transition',
                (!draftsValid || isSubmittingDrafts) && 'opacity-50 cursor-not-allowed',
              )}
              data-track-category='Tickets'
              data-track-name='DraftSubmit'
            >
              {isSubmittingDrafts ? <Loader2 className='size-3.5 animate-spin' /> : null}
              Create tickets
            </button>
          </div>
        )}
        <div className='w-full min-h-[80px]'>
          <AgGridReact
            getRowId={params => (params.data as Ticket).id}
            stopEditingWhenCellsLoseFocus={false}
            domLayout='autoHeight'
            rowSelection={{
              mode: 'multiRow',
              checkboxes: false,
              enableClickSelection: false,
              headerCheckbox: false,
            }}
            theme={theme}
            ensureDomOrder={true}
            onCellEditingStopped={params => {
              if (params.node.rowIndex !== null && params.column) {
                params.api.setFocusedCell(params.node.rowIndex, params.column.getId());
              }
            }}
            onSelectionChanged={params => {
              const selectedRows = params.api.getSelectedRows() as Ticket[];
              setSelectedCount(selectedRows.length);
              onSelectionChange?.(selectedRows);
            }}
            rowData={combinedRowData}
            columnDefs={columnDefs}
            rowHeight={44}
            headerHeight={44}
            onRowClicked={(p: RowClickedEvent<Ticket>) => {
              if (!p.event?.defaultPrevented && p.data && !isDraftRow(p.data)) {
                onRowClick?.(p.data);
              }
            }}
            onGridReady={(params: GridReadyEvent) => {
              setGridApi(params.api);
              setTimeout(() => {
                params.api.setFocusedCell(0, 'title');
              }, 100);
            }}
            suppressCellFocus={false}
            suppressNoRowsOverlay={true}
            alwaysShowHorizontalScroll
            pagination={true}
            paginationPageSize={25}
            paginationPageSizeSelector={false}
          />
        </div>

        <div>
          {selectedCount > 0 && (
            <BulkActionToolbar
              selectedCount={selectedCount}
              users={users}
              userGroups={userGroups}
              onAssigneeChange={val => handleBulkUpdate({ assignedTo: val })}
              onStatusChange={val => handleBulkUpdate({ statusV2: val })}
              onPriorityChange={val => handleBulkUpdate(val === null ? {} : { priority: val })}
              onStageChange={val => handleBulkUpdate({ stageName: val })}
              onDueDateChange={() => {}}
              onClearSelection={() => handleBulkUpdate()}
              availableTags={availableTags}
              onTagsChange={handleBulkTagUpdate}
            />
          )}
        </div>
      </div>
    </>
  );
};

const AssigneeCellRenderer = (params: ICellRendererParams<Ticket>) => {
  const ticket = params.data;

  const assigneeType = ticket?.assignedTo?.startsWith('group:') ? 'group' : 'user';
  const assigneeId = ticket?.assignedTo?.replace(/^(user:|group:)/, '') || '';
  const assignedUser = useUser(assigneeId && assigneeType === 'user' ? assigneeId : '');
  const assignedGroup = useUserGroupById(assigneeId && assigneeType === 'group' ? assigneeId : '');

  if (!ticket) return null;

  return (
    <div className='flex items-center h-full'>
      {assignedUser ? (
        <div className='flex items-center gap-3'>
          <Tooltip content={getUserDisplayName(assignedUser)}>
            <Avatar
              userId={assignedUser.id}
              className='rounded-full size-6 flex items-center justify-center'
              showActiveStatus={false}
            />
          </Tooltip>
          <span className='text-muted-foreground truncate font-medium'>
            {getUserDisplayName(assignedUser)}
          </span>
        </div>
      ) : assignedGroup ? (
        <div className='flex items-center gap-2'>
          <Tooltip content={assignedGroup.name}>
            <div className='w-6 h-6 rounded-lg bg-border flex items-center justify-center'>
              <span className='text-xs font-medium text-muted-foreground'>
                {assignedGroup.name.charAt(0).toUpperCase()}
              </span>
            </div>
          </Tooltip>
          <span className='text-muted-foreground truncate'>{assignedGroup.name}</span>
        </div>
      ) : (
        <div className='flex items-center gap-2 text-muted-foreground'>
          <div className='w-6 h-6 rounded-full border border-dashed border-muted-foreground flex items-center justify-center'>
            <User className='w-3 h-3' strokeWidth={1.5} />
          </div>
          <span>Unassigned</span>
        </div>
      )}
    </div>
  );
};
