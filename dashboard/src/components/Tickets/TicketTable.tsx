import React, { useMemo, useState } from 'react';
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

import { useWorkflows } from '../../hooks/useWorkflows';
import { TicketFilters } from './TicketHeader';
import { useUsers } from '../../hooks/useUsers';

interface TicketTableProps {
  filters: TicketFilters;
}

const TicketTable: React.FC<TicketTableProps> = ({ filters }) => {
  const navigate = useNavigate();
  const { workflows, isLoading } = useWorkflows();
  const users = useUsers();

  // Create usersById map for efficient lookup
  const usersById = useMemo(() => {
    const map = new Map(users.map(u => [u.id, u]));
    return map;
  }, [users]);

  const filteredWorkflows = useMemo(() => {
    let result = workflows;

    if (filters.searchQuery.trim()) {
      const q = filters.searchQuery.toLowerCase();
      result = result.filter(workflow => {
        const ticket = workflow.ticket;
        const createdByUser = ticket?.createdBy ? usersById.get(ticket.createdBy) : null;
        const assignedToUser = ticket?.assignedTo ? usersById.get(ticket.assignedTo) : null;
        return (
          ticket?.title?.toLowerCase().includes(q) ||
          ticket?.xyneId?.toLowerCase().includes(q) ||
          workflow.workflowName?.toLowerCase().includes(q) ||
          createdByUser?.name?.toLowerCase().includes(q) ||
          assignedToUser?.name?.toLowerCase().includes(q)
        );
      });
    }

    if (filters.statusFilter.length > 0) {
      result = result.filter(workflow => filters.statusFilter.includes(workflow.status));
    }

    if (filters.workflowTypeFilter.length > 0) {
      result = result.filter(
        workflow =>
          workflow.workflowType && filters.workflowTypeFilter.includes(workflow.workflowType),
      );
    }

    if (filters.createdByFilter.length > 0) {
      const createdByUserIds = filters.createdByFilter.map(user => user.id);
      result = result.filter(
        workflow =>
          workflow.ticket?.createdBy && createdByUserIds.includes(workflow.ticket.createdBy),
      );
    }

    if (filters.assignedToFilter.length > 0) {
      const assignedToUserIds = filters.assignedToFilter.map(user => user.id);
      result = result.filter(
        workflow =>
          workflow.ticket?.assignedTo && assignedToUserIds.includes(workflow.ticket.assignedTo),
      );
    }

    if (filters.dateRangeFilter) {
      const startDate = filters.dateRangeFilter.startDate.getTime();
      const endDate = filters.dateRangeFilter.endDate.getTime();
      result = result.filter(workflow => {
        const workflowDate = workflow.createdAt;
        return workflowDate >= startDate && workflowDate <= endDate;
      });
    }

    return result;
  }, [workflows, filters, usersById]);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const tableData: Record<string, unknown>[] = useMemo(() => {
    return filteredWorkflows.map(workflow => {
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
  }, [filteredWorkflows, usersById]);

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
    const ticketId = workflows.find(w => w.id === workflowId)?.ticketId;
    if (typeof ticketId === 'string' && typeof workflowId === 'string') {
      void navigate(`/tickets/${ticketId}/workflow/${workflowId}`);
    }
  };

  return (
    <DataTable
      title=''
      showHeader={false}
      enableSearch={false}
      data={tableData}
      columns={columns}
      idField='id'
      isLoading={isLoading}
      onRowClick={handleRowClick}
      serverSidePagination={false}
      pagination={{
        currentPage,
        pageSize,
        totalRows: tableData.length,
      }}
      onPageChange={page => setCurrentPage(page)}
      onPageSizeChange={size => setPageSize(size)}
    />
  );
};

export default TicketTable;
