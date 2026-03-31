import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import { Table, ColumnDef } from '../ui/Table';
import Avatar from '../ui/Avatar/Avatar';
import { useWorkflows, Workflow } from '../../hooks/useWorkflows';
import { TicketFilters, ViewMode } from './TicketHeader';
import { useUsers } from '../../hooks/useUsers';
import { PAGE_SIZE, LAST_WORKFLOW_PATH_KEY } from './constants';
import { getStatusConfig, formatCreatedAt, TicketRow } from './ticketUtils';
import type { TicketListItem } from './TicketListView/TicketListView.types';

type WorkflowListItem = TicketListItem & { _raw: TicketRow };

interface TicketTableProps {
  filters: TicketFilters;
  viewMode?: ViewMode;
}

const TicketTable: React.FC<TicketTableProps> = ({ filters, viewMode = 'table' }) => {
  const navigate = useNavigate();
  const users = useUsers();
  const [cursor, setCursor] = useState<{ id: string; createdAt: number } | null>(null);
  const [allWorkflows, setAllWorkflows] = useState<Workflow[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [isFilterChanging, setIsFilterChanging] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const prevFiltersRef = useRef(filters);

  const usersById = useMemo(() => {
    const map = new Map(users.map(u => [u.id, u]));
    return map;
  }, [users]);

  const workflowParams = useMemo(() => {
    const createdByIds = filters.createdByFilter.map(u => u.id);
    const assignedToIds = filters.assignedToFilter.map(u => u.id);

    return {
      limit: pageSize + 1,
      start: cursor,
      searchQuery: filters.searchQuery.trim() || undefined,
      statusFilter: filters.statusFilter.length > 0 ? filters.statusFilter : undefined,
      workflowTypeFilter:
        filters.workflowTypeFilter.length > 0 ? filters.workflowTypeFilter : undefined,
      createdByFilter: createdByIds.length > 0 ? createdByIds : undefined,
      assignedToFilter: assignedToIds.length > 0 ? assignedToIds : undefined,
      dateRangeFilter: filters.dateRangeFilter
        ? {
            startDate: filters.dateRangeFilter.startDate.getTime(),
            endDate: filters.dateRangeFilter.endDate.getTime(),
          }
        : undefined,
    };
  }, [filters, cursor, pageSize]);

  const { workflows, isLoading, hasMore } = useWorkflows(workflowParams);

  // On filter change: mark as transitioning but keep old data visible
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const filtersChanged =
      prev.searchQuery !== filters.searchQuery ||
      prev.statusFilter !== filters.statusFilter ||
      prev.workflowTypeFilter !== filters.workflowTypeFilter ||
      prev.createdByFilter !== filters.createdByFilter ||
      prev.assignedToFilter !== filters.assignedToFilter ||
      prev.dateRangeFilter !== filters.dateRangeFilter;

    if (filtersChanged) {
      setIsFilterChanging(true);
      setCursor(null);
      setCurrentPage(1);
      prevFiltersRef.current = filters;
    }
  }, [filters]);

  useEffect(() => {
    if (!cursor) {
      setAllWorkflows(workflows);
      setIsFilterChanging(false);
    } else {
      setAllWorkflows(prev => {
        const existingIds = new Set(prev.map(w => w.id));
        const newWorkflows = workflows.filter(w => !existingIds.has(w.id));
        return [...prev, ...newWorkflows];
      });
    }
  }, [workflows, cursor]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore && allWorkflows.length > 0) {
      const lastWorkflow = allWorkflows[allWorkflows.length - 1];
      if (lastWorkflow) {
        setCursor({ id: lastWorkflow.id, createdAt: lastWorkflow.createdAt });
      }
    }
  }, [isLoading, hasMore, allWorkflows]);

  const tableData: TicketRow[] = useMemo(() => {
    return allWorkflows.map(workflow => {
      const ticket = workflow.ticket;
      const createdByUser = ticket?.createdBy ? usersById.get(ticket.createdBy) : null;
      const assignedToUser = ticket?.assignedTo ? usersById.get(ticket.assignedTo) : null;
      return {
        id: workflow.id,
        ticketId: ticket?.xyneId ?? 'N/A',
        ticketTitle: ticket?.title ?? workflow.workflowName ?? 'Untitled',
        workflowType: workflow.workflowType ?? 'N/A',
        status: workflow.status,
        createdBy: createdByUser?.name ?? 'Unknown',
        createdByUserId: ticket?.createdBy ?? '',
        assignedTo: assignedToUser?.name ?? 'Unassigned',
        assignedToUserId: ticket?.assignedTo ?? '',
        createdAt: new Date(workflow.createdAt).toISOString(),
        _rawTicketId: workflow.ticketId ?? '',
      };
    });
  }, [allWorkflows, usersById]);

  const columns: ColumnDef<TicketRow>[] = useMemo(
    () => [
      {
        field: 'ticketId',
        header: 'Ticket ID',
        sortable: true,
        sortType: 'date' as const,
        minWidth: '116px',
      },
      {
        field: 'ticketTitle',
        header: 'Title',
        sortable: true,
        className: 'max-w-[300px]',
        renderCell: (value: unknown) => (
          <span className='line-clamp-2'>{typeof value === 'string' ? value : ''}</span>
        ),
      },
      {
        field: 'workflowType',
        header: 'Workflow Type',
        sortable: true,
        className: 'max-w-[200px]',
        renderCell: (value: unknown) => (
          <span className='block truncate'>{typeof value === 'string' ? value : ''}</span>
        ),
      },
      {
        field: 'status',
        header: 'Status',
        sortable: true,
        minWidth: '112px',
        renderCell: (value: unknown) => {
          const { label, cssVar, Icon } = getStatusConfig(String(value));
          return (
            <span
              className='inline-flex items-center gap-1 text-xs font-medium'
              style={{ color: cssVar }}
            >
              <Icon size={14} />
              {label}
            </span>
          );
        },
      },
      {
        field: 'createdBy',
        header: 'Created By',
        sortable: true,
        renderCell: (value: unknown, row: TicketRow) => (
          <span className='inline-flex h-6 items-center gap-1.5 rounded-full bg-muted pl-1 pr-2 text-xs font-medium whitespace-nowrap max-w-[160px]'>
            <Avatar
              userId={String(row.createdByUserId)}
              size='xs'
              rounded
              showActiveStatus={false}
            />
            <span className='truncate'>{String(value) || 'N/A'}</span>
          </span>
        ),
      },
      {
        field: 'assignedTo',
        header: 'Assigned To',
        sortable: true,
        renderCell: (value: unknown, row: TicketRow) => (
          <span className='inline-flex h-6 items-center gap-1.5 rounded-full bg-muted pl-1 pr-2 text-xs font-medium whitespace-nowrap max-w-[160px]'>
            <Avatar
              userId={String(row.assignedToUserId)}
              size='xs'
              rounded
              showActiveStatus={false}
            />
            <span className='truncate'>{String(value) || 'Unassigned'}</span>
          </span>
        ),
      },
      {
        field: 'createdAt',
        header: 'Created At',
        sortable: true,
        sortType: 'date' as const,
        minWidth: '240px',
        className: 'w-0 whitespace-nowrap',
        renderCell: (value: unknown) => formatCreatedAt(new Date(String(value))),
      },
    ],
    [],
  );

  const handleRowClick = (row: TicketRow): void => {
    if (row._rawTicketId && row.id) {
      sessionStorage.removeItem(LAST_WORKFLOW_PATH_KEY);
      void navigate(`/tickets/${row._rawTicketId}/workflow/${row.id}`);
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    if (page * pageSize > allWorkflows.length && hasMore && !isLoading) {
      loadMore();
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  const listItems: WorkflowListItem[] = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return tableData.slice(start, end).map(row => ({
      id: row.id,
      xyneId: row.ticketId,
      title: row.ticketTitle,
      status: row.status,
      createdAt: new Date(row.createdAt).getTime(),
      metadata: null,
      _raw: row,
    }));
  }, [tableData, currentPage, pageSize]);

  const groupedListItems = useMemo(() => {
    const groups: { status: string; items: WorkflowListItem[] }[] = [];
    const groupMap = new Map<string, WorkflowListItem[]>();
    for (const item of listItems) {
      const key = item._raw.status;
      if (!groupMap.has(key)) {
        const arr: WorkflowListItem[] = [];
        groupMap.set(key, arr);
        groups.push({ status: key, items: arr });
      }
      groupMap.get(key)!.push(item);
    }
    return groups;
  }, [listItems]);

  // Show skeleton in table body when filter is changing (keeps table shell stable)
  const showBodyLoading = isFilterChanging && isLoading;

  return (
    <div data-id='ticket-table-container' className='flex flex-col flex-1 min-h-0 gap-2 px-6 pb-6'>
      <div data-id='ticket-table-content' className='flex flex-col flex-1 min-h-0'>
        {viewMode === 'list' ? (
          <div
            data-id='ticket-list-grouped'
            className='flex flex-col flex-1 min-h-0 gap-2 overflow-y-auto scrollbar-none'
          >
            {showBodyLoading || (isLoading && allWorkflows.length === 0) ? (
              <div className='flex flex-col gap-2 p-2'>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className='h-10 rounded-lg bg-muted animate-pulse' />
                ))}
              </div>
            ) : groupedListItems.length === 0 ? (
              <div className='flex items-center justify-center flex-1 text-sm text-muted-foreground'>
                No workflows found
              </div>
            ) : (
              groupedListItems.map(group => {
                const { label, cssVar, Icon } = getStatusConfig(group.status);
                const isCollapsed = collapsedGroups.has(group.status);
                const toggleCollapse = () => {
                  setCollapsedGroups(prev => {
                    const next = new Set(prev);
                    if (next.has(group.status)) next.delete(group.status);
                    else next.add(group.status);
                    return next;
                  });
                };
                return (
                  <div key={group.status} data-id={`ticket-list-group-${group.status}`}>
                    {/* Group header */}
                    <button
                      type='button'
                      onClick={toggleCollapse}
                      data-track-category='Tickets'
                      data-track-name='ToggleGroupCollapse'
                      className='flex w-full items-center gap-2 px-3 py-1.5 rounded-lg sticky top-0 z-10 cursor-pointer'
                      style={{ backgroundColor: `color-mix(in srgb, ${cssVar} 10%, transparent)` }}
                    >
                      <ChevronRight
                        size={14}
                        className={`transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                        style={{ color: cssVar }}
                      />
                      <span style={{ color: cssVar }}>
                        <Icon size={14} />
                      </span>
                      <span className='text-sm font-medium' style={{ color: cssVar }}>
                        {label}
                      </span>
                      <span className='text-xs' style={{ color: cssVar, opacity: 0.6 }}>
                        {group.items.length}
                      </span>
                    </button>
                    {/* Group items */}
                    {!isCollapsed &&
                      group.items.map(ticket => {
                        const row = ticket._raw;
                        return (
                          <div
                            key={row.id}
                            role='button'
                            tabIndex={0}
                            onClick={() => handleRowClick(row)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleRowClick(row);
                              }
                            }}
                            data-track-category='Tickets'
                            data-track-name='ClickListItem'
                            className='flex items-center justify-between px-2 py-2 cursor-pointer hover:bg-muted hover:rounded-lg gap-6'
                          >
                            <div className='flex items-center gap-3 min-w-0 flex-1'>
                              <span style={{ color: cssVar }}>
                                <Icon size={14} />
                              </span>
                              <span className='text-xs text-muted-foreground font-mono flex-shrink-0 font-medium'>
                                {row.ticketId}
                              </span>
                              <span className='text-sm font-medium text-foreground min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'>
                                {row.ticketTitle}
                              </span>
                              <span className='size-1 rounded-full bg-muted flex-shrink-0' />
                              <span className='text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap'>
                                {row.workflowType}
                              </span>
                            </div>
                            <div className='flex items-center gap-4 flex-shrink-0'>
                              <span className='inline-flex h-6 items-center gap-1.5 rounded-full bg-muted pl-1 pr-2 text-xs font-medium whitespace-nowrap max-w-[160px]'>
                                <Avatar
                                  userId={row.assignedToUserId}
                                  size='xs'
                                  rounded
                                  showActiveStatus={false}
                                />
                                <span className='truncate'>{row.assignedTo}</span>
                              </span>
                              <span className='text-xs text-muted-foreground whitespace-nowrap'>
                                {formatCreatedAt(new Date(row.createdAt))}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <Table
            data={showBodyLoading ? [] : tableData}
            columns={columns}
            idField='id'
            sortable
            isLoading={showBodyLoading || (isLoading && allWorkflows.length === 0)}
            onRowClick={handleRowClick}
            emptyState='No workflows found'
            serverSidePagination
            pagination={{
              currentPage,
              pageSize,
              totalRows: hasMore ? allWorkflows.length + 1 : allWorkflows.length,
            }}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            pageSizeOptions={[10, 20, 50]}
          />
        )}
      </div>
      {isLoading && allWorkflows.length > 0 && (
        <div data-id='ticket-table-loading-wrapper' className='flex justify-center py-4'>
          <div
            data-id='ticket-table-loading-spinner'
            className='animate-spin rounded-full h-6 w-6 border-b-2 border-muted-foreground'
          />
        </div>
      )}
    </div>
  );
};

export default TicketTable;
