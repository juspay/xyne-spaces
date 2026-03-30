import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DataTable,
  ColumnDefinition,
  ColumnType,
  Tag,
  TagVariant,
  TagColor,
  TagSize,
  TagShape,
} from '@juspay/blend-design-system';
import { User } from 'lucide-react';

import { useWorkflows, Workflow } from '../../hooks/useWorkflows';
import { TicketFilters } from './TicketHeader';
import { useUsers } from '../../hooks/useUsers';
import { PAGE_SIZE, LAST_WORKFLOW_PATH_KEY } from './constants';

interface TicketTableProps {
  filters: TicketFilters;
}

const TicketTable: React.FC<TicketTableProps> = ({ filters }) => {
  const navigate = useNavigate();
  const users = useUsers();
  const [cursor, setCursor] = useState<{ id: string; createdAt: number } | null>(null);
  const [allWorkflows, setAllWorkflows] = useState<Workflow[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const usersById = useMemo(() => {
    const map = new Map(users.map(u => [u.id, u]));
    return map;
  }, [users]);

  const workflowParams = useMemo(() => {
    const createdByIds = filters.createdByFilter.map(u => u.id);
    const assignedToIds = filters.assignedToFilter.map(u => u.id);

    return {
      limit: PAGE_SIZE + 1, // Request 1 extra to detect if there's more data (over-fetch pattern)
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
  }, [filters, cursor]);

  const { workflows, isLoading, hasMore } = useWorkflows(workflowParams);

  useEffect(() => {
    setAllWorkflows([]);
    setCursor(null);
    setCurrentPage(1);
  }, [
    filters.searchQuery,
    filters.statusFilter,
    filters.workflowTypeFilter,
    filters.createdByFilter,
    filters.assignedToFilter,
    filters.dateRangeFilter,
  ]);

  useEffect(() => {
    setAllWorkflows(prev => {
      if (!cursor) {
        return workflows;
      }
      const existingIds = new Set(prev.map(w => w.id));
      const newWorkflows = workflows.filter(w => !existingIds.has(w.id));
      return [...prev, ...newWorkflows];
    });
  }, [workflows, cursor]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore && allWorkflows.length > 0) {
      const lastWorkflow = allWorkflows[allWorkflows.length - 1];
      if (lastWorkflow) {
        setCursor({ id: lastWorkflow.id, createdAt: lastWorkflow.createdAt });
      }
    }
  }, [isLoading, hasMore, allWorkflows]);

  const tableData: Record<string, unknown>[] = useMemo(() => {
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
        assignedTo: assignedToUser?.name ?? 'Unassigned',
        createdAt: new Date(workflow.createdAt).toISOString(),
      };
    });
  }, [allWorkflows, usersById]);

  const columns: ColumnDefinition<Record<string, unknown>>[] = [
    { field: 'ticketId', header: 'Ticket ID', type: ColumnType.TEXT },
    { field: 'ticketTitle', header: 'Title', type: ColumnType.TEXT },

    { field: 'workflowType', header: 'Workflow Type', type: ColumnType.TEXT },

    {
      field: 'status',
      header: 'Status',
      type: ColumnType.TEXT,
      renderCell: (value: unknown): React.ReactElement => {
        const statusValue = value as string;
        return (
          <Tag
            text={statusValue || 'N/A'}
            variant={TagVariant.SUBTLE}
            color={TagColor.NEUTRAL}
            size={TagSize.SM}
          />
        );
      },
    },

    {
      field: 'createdBy',
      header: 'Created By',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => (
        <Tag
          text={String(value) || 'N/A'}
          variant={TagVariant.SUBTLE}
          color={TagColor.NEUTRAL}
          size={TagSize.SM}
          shape={TagShape.ROUNDED}
          leftSlot={<User size={12} />}
        />
      ),
    },

    {
      field: 'assignedTo',
      header: 'Assigned To',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) => (
        <Tag
          text={String(value) || 'Unassigned'}
          variant={TagVariant.SUBTLE}
          color={TagColor.NEUTRAL}
          size={TagSize.SM}
          shape={TagShape.ROUNDED}
          leftSlot={<User size={12} />}
        />
      ),
    },

    {
      field: 'createdAt',
      header: 'Created At',
      type: ColumnType.TEXT,
      renderCell: (value: unknown) =>
        new Date(String(value)).toLocaleString('en-US', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
  ];

  const handleRowClick = (row: Record<string, unknown>): void => {
    const workflowId = row['id'];
    const ticketId = allWorkflows.find(w => w.id === workflowId)?.ticketId;
    if (typeof ticketId === 'string' && typeof workflowId === 'string') {
      sessionStorage.removeItem(LAST_WORKFLOW_PATH_KEY);
      void navigate(`/tickets/${ticketId}/workflow/${workflowId}`);
    }
  };

  const visibleData = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return tableData.slice(start, end);
  }, [tableData, currentPage]);

  return (
    <div>
      <DataTable
        title=''
        showHeader={false}
        enableSearch={false}
        data={visibleData}
        columns={columns}
        idField='id'
        isLoading={isLoading && allWorkflows.length === 0}
        onRowClick={handleRowClick}
        serverSidePagination={true}
        pagination={{
          currentPage,
          pageSize: PAGE_SIZE,
          totalRows: hasMore ? allWorkflows.length + 1 : allWorkflows.length,
          pageSizeOptions: [10],
        }}
        onPageChange={page => {
          setCurrentPage(page);
          if (page * PAGE_SIZE > allWorkflows.length && hasMore && !isLoading) {
            loadMore();
          }
        }}
        onPageSizeChange={() => {}}
      />
      {isLoading && allWorkflows.length > 0 && (
        <div className='flex justify-center py-4'>
          <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-muted-foreground'></div>
        </div>
      )}
    </div>
  );
};

export default TicketTable;
