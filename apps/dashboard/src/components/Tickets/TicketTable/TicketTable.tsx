import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { toast } from 'sonner';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { useUser, useUsers } from '../../../hooks/useUsers';
import { useUserGroupById, useUserGroups } from '../../../hooks/useUserGroup';
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
import { getUserDisplayName } from '../../../utils/userDisplayName';

ModuleRegistry.registerModules([AllCommunityModule]);

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
}

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
}) => {
  const zero = useZero();
  const users = useUsers();
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const { baseRoute, buildChannelRoute } = useRouteContext();

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

  const userGroups = useUserGroups();

  const theme = themeQuartz.withParams({
    backgroundColor: 'hsl(var(--background))',
    foregroundColor: 'hsl(var(--foreground))',
    chromeBackgroundColor: 'hsl(var(--card))',
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
        cellRenderer: IndexCellRenderer,
        cellStyle: { padding: 0 },
      },

      {
        key: 'title',
        headerName: 'Ticket name',
        field: 'title',
        minWidth: isComfortView ? 340 : 300,
        flex: 1,
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

  return (
    <>
      <div className='flex flex-col'>
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
            rowData={tickets}
            columnDefs={columnDefs}
            rowHeight={44}
            headerHeight={44}
            onRowClicked={(p: RowClickedEvent<Ticket>) => {
              if (!p.event?.defaultPrevented && p.data) {
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
