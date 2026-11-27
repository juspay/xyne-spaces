import React from 'react';
import type { Ticket, TicketTag } from '@xyne/shared';
import { CheckTickSingle as Check, Subtask } from '@xyne/icons';
import Tooltip, { TruncatedTooltip } from '../../ui/Tooltip';
import Avatar from '../../ui/Avatar/Avatar';
import { PriorityPicker } from '../TicketListView/PriorityPicker';
import { StagePicker } from '../TicketListView/StagePicker';
import { DynamicFieldCell } from '../TicketListView/DynamicFieldCell';
import { UserSelector } from '../CreateTicketModal/UserSelector';
import { useTicketAssignee, resolveAssigneeRef } from '../../../hooks/useTicketAssignee';
import { useUser } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { useTicketNoun } from '../../../contexts/TicketNounContext';
import { formatStatusLabel } from '../TicketCard/TicketCard.utils';
import { StatusOptions } from './TicketTableHelper';
import { DueDatePicker, LabelPicker } from './TicketListRowPickers';
import { fullTimestamp, shortDate } from './TicketListRow';
import { SubTicketsToggle } from '../SubTickets/SubTickets';
import type { SubTicketProgress } from '../SubTickets/SubTickets.types';
import type { ResolvedDisplayFormField } from '../../../utils/board/resolveDisplayFormFields';

export type TicketTableColumn = { key: string; label: string; width: number };

export const SELECT_COLUMN_WIDTH = 36;
export const ID_COLUMN_WIDTH = 128;
export const TITLE_COLUMN_MIN_WIDTH = 320;
export const TABLE_HEADER_HEIGHT = 36;

const BUILTIN_COLUMNS: readonly TicketTableColumn[] = [
  { key: 'createdAt', label: 'Created at', width: 175 },
  { key: 'age', label: 'Age', width: 80 },
  { key: 'assignee', label: 'Assignee', width: 200 },
  { key: 'dueDate', label: 'Due date', width: 140 },
  { key: 'status', label: 'Status Category', width: 170 },
  { key: 'priority', label: 'Priority', width: 140 },
  { key: 'stage', label: 'Stage', width: 160 },
  { key: 'createdBy', label: 'Created by', width: 200 },
  { key: 'board', label: 'Board', width: 160 },
  { key: 'channel', label: 'Channel', width: 160 },
  { key: 'type', label: 'Type', width: 140 },
  { key: 'tags', label: 'Labels', width: 260 },
  { key: 'merchantId', label: 'Merchant ID', width: 150 },
];

const CUSTOM_COLUMN_WIDTH = 170;

export const resolveTableColumns = (
  visibleColumns: Set<string>,
  dynamicFieldColumns: readonly ResolvedDisplayFormField[] = [],
): TicketTableColumn[] => [
  ...BUILTIN_COLUMNS.filter(column => visibleColumns.has(column.key)),
  ...dynamicFieldColumns.map(field => ({
    key: `custom:${field.id}`,
    label: field.fieldName,
    width: CUSTOM_COLUMN_WIDTH,
  })),
];

export const tableMinWidth = (columns: readonly TicketTableColumn[]): number =>
  SELECT_COLUMN_WIDTH +
  ID_COLUMN_WIDTH +
  TITLE_COLUMN_MIN_WIDTH +
  columns.reduce((sum, column) => sum + column.width, 0);

const cellClass = 'flex h-full min-w-0 shrink-0 items-center overflow-hidden px-2';
const mutedText = 'truncate text-sm text-muted-foreground';
const EMPTY = <span className='text-sm text-muted-foreground'>—</span>;

export const TicketTableHeader: React.FC<{ columns: readonly TicketTableColumn[] }> = ({
  columns,
}) => (
  <div
    style={{ height: TABLE_HEADER_HEIGHT }}
    className='flex items-center border-b border-border bg-muted text-xs font-medium text-muted-foreground'
  >
    <span style={{ width: SELECT_COLUMN_WIDTH }} className='shrink-0' />
    <span style={{ width: ID_COLUMN_WIDTH }} className={cellClass}>
      #
    </span>
    <span
      style={{ minWidth: TITLE_COLUMN_MIN_WIDTH }}
      className='flex h-full flex-1 items-center px-2'
    >
      Ticket name
    </span>
    {columns.map(column => (
      <span key={column.key} style={{ width: column.width }} className={cellClass}>
        <span className='truncate'>{column.label}</span>
      </span>
    ))}
  </div>
);

const UserCell: React.FC<{ userId: string | null | undefined }> = ({ userId }) => {
  const user = useUser(userId || '');
  if (!user) return EMPTY;
  const name = getUserDisplayName(user);
  return (
    <span className='flex min-w-0 items-center gap-2'>
      <Avatar userId={user.id} className='size-5 shrink-0 rounded-full' showActiveStatus={false} />
      <TruncatedTooltip content={name}>
        <span className={mutedText}>{name}</span>
      </TruncatedTooltip>
    </span>
  );
};

const AssigneeCell: React.FC<{ ticket: Ticket }> = ({ ticket }) => {
  const assignee = resolveAssigneeRef(ticket.assignedTo, ticket.userGroupId);
  const onAssign = useTicketAssignee(ticket.id, assignee);
  const user = useUser(assignee.userId || '');
  return (
    <span className='flex min-w-0 items-center gap-2'>
      <UserSelector
        selectedUserId={assignee.userId}
        assignedGroupId={assignee.groupId}
        onUserSelect={onAssign}
        channelId={ticket.channelId}
        variant='compact'
      />
      {user && <span className={mutedText}>{getUserDisplayName(user)}</span>}
    </span>
  );
};

type FormValue = { fieldId: string; actualFieldValue?: unknown; updatedAt?: number | null };

type TicketColumnsRowProps = {
  ticket: Ticket;
  columns: readonly TicketTableColumn[];
  dynamicFieldColumns: readonly ResolvedDisplayFormField[];
  isSelected: boolean;
  onToggleSelect: (ticket: Ticket) => void;
  tags: TicketTag[];
  availableTags: string[];
  subProgress?: SubTicketProgress | undefined;
  boardName?: string | undefined;
  channelName?: string | undefined;
  extras?: React.ReactNode;
  onOpen: (ticket: Ticket) => void;
  expandableSubTickets?: boolean;
  treeConnector?: React.ReactNode;
};

const TicketColumnsRowBase: React.FC<TicketColumnsRowProps> = ({
  ticket,
  columns,
  dynamicFieldColumns,
  isSelected,
  onToggleSelect,
  tags,
  availableTags,
  subProgress,
  boardName,
  channelName,
  extras,
  onOpen,
  expandableSubTickets = false,
  treeConnector,
}) => {
  const noun = useTicketNoun();
  const fieldById = new Map(dynamicFieldColumns.map(field => [`custom:${field.id}`, field]));

  const renderCell = (key: string): React.ReactNode => {
    switch (key) {
      case 'createdAt': {
        if (!ticket.createdAt) return EMPTY;
        return (
          <span className={`${mutedText} whitespace-nowrap`}>
            {fullTimestamp(ticket.createdAt)}
          </span>
        );
      }
      case 'age': {
        const created = ticket.createdAt ? new Date(ticket.createdAt).getTime() : NaN;
        if (Number.isNaN(created)) return EMPTY;
        return (
          <span className={mutedText}>
            {Math.max(0, Math.floor((Date.now() - created) / 86400000))}d
          </span>
        );
      }
      case 'assignee':
        return <AssigneeCell ticket={ticket} />;
      case 'dueDate':
        return (
          <DueDatePicker
            ticketId={ticket.id}
            eta={ticket.eta}
            statusV2={ticket.statusV2}
            display={(ticket.eta && shortDate(ticket.eta)) || 'No due date'}
          />
        );
      case 'status': {
        if (!ticket.statusV2) return EMPTY;
        const option = StatusOptions.find(opt => String(opt.value) === String(ticket.statusV2));
        return (
          <span
            className={`flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-0.5 text-sm font-medium ${option?.bgColor ?? ''} ${option?.textColor ?? ''}`}
          >
            {option?.icon}
            <span className='truncate'>{formatStatusLabel(String(ticket.statusV2))}</span>
          </span>
        );
      }
      case 'priority':
        return <PriorityPicker ticketId={ticket.id} priority={ticket.priority} />;
      case 'stage':
        return (
          <StagePicker
            ticketId={ticket.id}
            stageName={ticket.stageName}
            stageLabel={ticket.stageName || '—'}
            statusV2={ticket.statusV2}
            boardId={ticket.boardId}
          />
        );
      case 'createdBy':
        return <UserCell userId={ticket.createdBy} />;
      case 'board':
        return boardName ? <span className={mutedText}>{boardName}</span> : EMPTY;
      case 'channel':
        return channelName ? <span className={mutedText}>{channelName}</span> : EMPTY;
      case 'type':
        return ticket.ticketType ? <span className={mutedText}>{ticket.ticketType}</span> : EMPTY;
      case 'tags':
        if (treeConnector && tags.length === 0) return EMPTY;
        return (
          <span className='flex min-w-0 max-w-full [&>button]:min-w-0 [&>button]:max-w-full'>
            <LabelPicker ticket={ticket} tags={tags} availableTags={availableTags}>
              {tags.length === 0
                ? EMPTY
                : [
                    ...tags.slice(0, 2).map(tag => (
                      <span
                        key={tag.id}
                        className='flex min-w-0 max-w-[110px] items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground'
                      >
                        <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-xyne-purple-400' />
                        <span className='truncate'>{tag.name}</span>
                      </span>
                    )),
                    ...(tags.length > 2
                      ? [
                          <span
                            key='more'
                            className='shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground'
                          >
                            +{tags.length - 2}
                          </span>,
                        ]
                      : []),
                  ]}
            </LabelPicker>
          </span>
        );
      case 'merchantId':
        return ticket.merchantId ? <span className={mutedText}>{ticket.merchantId}</span> : EMPTY;
      default: {
        const field = fieldById.get(key);
        if (!field) return EMPTY;
        const values = (ticket as Ticket & { formEntityValues?: FormValue[] }).formEntityValues;
        const latest = values?.reduce<FormValue | undefined>(
          (best, row) =>
            row.fieldId === field.id && (!best || (row.updatedAt ?? 0) > (best.updatedAt ?? 0))
              ? row
              : best,
          undefined,
        );
        return <DynamicFieldCell fieldType={field.fieldType} value={latest?.actualFieldValue} />;
      }
    }
  };

  return (
    <div
      role='button'
      className='group/listrow flex h-full cursor-pointer items-center'
      onClick={() => onOpen(ticket)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(ticket);
        }
      }}
      tabIndex={0}
      data-testid={`ticket-row-${ticket.id}`}
      data-track-category='Tickets'
      data-track-name='TicketTableRow'
    >
      <span
        style={{ width: SELECT_COLUMN_WIDTH }}
        className={`flex shrink-0 items-center justify-center transition-opacity ${
          isSelected ? '' : 'opacity-0 group-hover/listrow:opacity-100'
        }`}
      >
        <button
          aria-label={isSelected ? `Deselect ${ticket.title}` : `Select ${noun.singular}`}
          className={
            isSelected
              ? 'flex h-4 w-4 cursor-pointer items-center justify-center rounded border border-primary bg-primary'
              : 'h-4 w-4 cursor-pointer rounded border border-border bg-card transition-colors hover:border-muted-foreground'
          }
          onClick={e => {
            e.stopPropagation();
            onToggleSelect(ticket);
          }}
          data-track-category='Tickets'
          data-track-name={isSelected ? 'DeselectRow' : 'SelectRow'}
        >
          {isSelected && <Check className='h-3 w-3 text-primary-foreground' strokeWidth={3} />}
        </button>
      </span>
      <span
        style={{ width: ID_COLUMN_WIDTH }}
        className={`${cellClass} font-mono text-xs font-medium text-muted-foreground`}
      >
        <span className='truncate'>{ticket.xyneId}</span>
      </span>
      <span
        style={{ minWidth: TITLE_COLUMN_MIN_WIDTH }}
        className='flex h-full min-w-0 flex-1 items-center gap-2 overflow-hidden px-2'
      >
        {treeConnector}
        <span
          className='min-w-0 truncate text-sm font-medium text-foreground'
          title={ticket.title ?? ''}
        >
          {ticket.title}
        </span>
        {subProgress &&
          subProgress.total > 0 &&
          (expandableSubTickets ? (
            <SubTicketsToggle ticketId={ticket.id} progress={subProgress} />
          ) : (
            <Tooltip
              content={`${subProgress.done} of ${subProgress.total} sub-${noun.plural} completed`}
            >
              <span className='flex shrink-0 items-center gap-1 text-xs text-muted-foreground'>
                <Subtask className='h-3.5 w-3.5' />
                {subProgress.done}/{subProgress.total}
              </span>
            </Tooltip>
          ))}
        {extras && <span className='ml-auto flex shrink-0 items-center gap-2'>{extras}</span>}
      </span>
      {columns.map(column => (
        <span key={column.key} style={{ width: column.width }} className={cellClass}>
          {renderCell(column.key)}
        </span>
      ))}
    </div>
  );
};

export const TicketColumnsRow = React.memo(TicketColumnsRowBase);

export const TicketColumnsLine: React.FC<{
  connector: React.ReactNode;
  children: React.ReactNode;
}> = ({ connector, children }) => (
  <div className='flex h-full items-center'>
    <span style={{ width: SELECT_COLUMN_WIDTH + ID_COLUMN_WIDTH }} className='shrink-0' />
    <span className='flex min-w-0 flex-1 items-center gap-2 px-2'>
      {connector}
      {children}
    </span>
  </div>
);
