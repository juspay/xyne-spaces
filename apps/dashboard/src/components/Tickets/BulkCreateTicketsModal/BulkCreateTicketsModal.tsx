import React, { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Star, Trash2, ArrowDownToLine, Loader2 } from 'lucide-react';
import {
  BaseTicketType,
  BulkTicketMode,
  ChannelScopeType,
  LookupType,
  TicketPriority,
  TicketStatusV2,
} from '@xyne/shared';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useActiveUserSearch } from '../../../hooks/useUsers';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { apiInstance } from '../../../services/clients/apiClient';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { cn } from '../../../utils/classNames';
import { Dialog } from '../../ui/Dialog/Dialog';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import Avatar from '../../ui/Avatar/Avatar';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import { getPriorityOptions } from '../CreateTicketModal/createTicket.utils';

export interface BulkCreateTicketsModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId?: string | undefined;
  projectId?: string | undefined;
  mode?: BulkTicketMode;
  parentTitle?: string | undefined;
  subTitleTitles?: string[] | undefined;
  subDescriptions?: string[] | undefined;
  clientRowIds?: string[] | undefined;
  existingParentTicket?:
    | {
        id: string;
        xyneId?: string;
        conversationId: string;
      }
    | undefined;
  sourceMessageId?: string | undefined;
  sourceConversationId?: string | undefined;
  onTicketCreated?: (ticket: { id: string; conversationId?: string; xyneId?: string }) => void;
}

interface BulkRow {
  id: string;
  clientRowId: string | undefined;
  title: string;
  description: string;
  priority: TicketPriority;
  channelId: string;
  boardId: string;
  status: TicketStatusV2;
  assigneeId: string | null;
  tags: string[];
  ticketType: BaseTicketType;
  eta: Date | null;
}

const PRIORITY_OPTIONS: SelectorOption[] = getPriorityOptions().map(p => ({
  ...p,
  icon: p.icon ?? null,
}));

const GRID_COLS = '36px minmax(0,1fr) minmax(0,1.5fr) 100px 130px 130px 140px 100px 120px 32px';

let rowIdSeq = 0;
const newRowId = (): string => `bulk-row-${++rowIdSeq}`;

const newSubRow = (title: string, channelId: string, boardId: string): BulkRow => ({
  id: newRowId(),
  clientRowId: undefined,
  title,
  description: '',
  priority: TicketPriority.MEDIUM,
  channelId,
  boardId,
  status: TicketStatusV2.TODO,
  assigneeId: null,
  tags: [],
  ticketType: BaseTicketType.Fix,
  eta: null,
});

export const BulkCreateTicketsModal: React.FC<BulkCreateTicketsModalProps> = ({
  isOpen,
  onClose,
  channelId: propChannelId,
  projectId: propProjectId,
  mode = BulkTicketMode.PARENT_SUB,
  parentTitle,
  subTitleTitles,
  subDescriptions,
  clientRowIds,
  existingParentTicket,
  sourceMessageId,
  sourceConversationId,
  onTicketCreated,
}) => {
  const isAllParentsMode = mode === BulkTicketMode.ALL_PARENTS;
  const hasExistingParent = !!existingParentTicket;
  const { user } = useAuth();
  const channels = useAllVisibleChannels().filter(c => c.scopeType === ChannelScopeType.DEFAULT);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const assigneeResults = useActiveUserSearch(assigneeSearch, 50);
  const userGroups = useUserGroups();

  const [rows, setRows] = useState<BulkRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const parentChannelId = rows[0]?.channelId ?? propChannelId ?? '';
  const selectedChannel = channels.find(c => c.id === parentChannelId);
  const projectId = propProjectId || selectedChannel?.projectId || '';

  const [boards] = useCachedQuery(queries.boardsListByProject({ projectId }), {
    enabled: !!projectId,
  });
  const [ticketTypeLookup] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.TICKET_TYPE }),
  );

  const boardOptions: SelectorOption[] = useMemo(
    () =>
      (boards ?? []).map(b => ({
        label: b.name,
        value: b.id,
        icon: (
          <span className='bg-primary text-primary-foreground text-xs aspect-square size-4 rounded text-center'>
            {b.name.charAt(0)}
          </span>
        ),
      })),
    [boards],
  );

  const ticketTypeOptions: SelectorOption[] = useMemo(() => {
    const seen = new Map<string, SelectorOption>();
    for (const v of Object.values(BaseTicketType)) {
      if (v === BaseTicketType.Support) continue;
      seen.set(v, { label: v, value: v, icon: null });
    }
    for (const t of ticketTypeLookup ?? []) {
      if (t.value && !seen.has(t.value) && t.value !== String(BaseTicketType.Support)) {
        seen.set(t.value, { label: t.value, value: t.value, icon: null });
      }
    }
    return Array.from(seen.values());
  }, [ticketTypeLookup]);

  const channelOptions: SelectorOption[] = useMemo(
    () => channels.map(c => ({ label: c.name ?? c.id, value: c.id, icon: null })),
    [channels],
  );

  const assigneeOptions: SelectorOption[] = useMemo(() => {
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

  const defaultBoardId = useMemo(() => boards?.[0]?.id ?? '', [boards]);
  const initDoneRef = useRef(false);

  React.useEffect(() => {
    if (!isOpen) {
      initDoneRef.current = false;
      return;
    }
    if (initDoneRef.current) return;
    initDoneRef.current = true;
    const initChannelId = propChannelId ?? '';

    if (isAllParentsMode) {
      if (subTitleTitles && subTitleTitles.length > 0) {
        const prefilledRows = subTitleTitles.map((t, i) => {
          const row = newSubRow(t, initChannelId, defaultBoardId);
          row.description = subDescriptions?.[i] || t;
          row.clientRowId = clientRowIds?.[i];
          return row;
        });
        setRows([...prefilledRows, newSubRow('', initChannelId, defaultBoardId)]);
      } else {
        setRows([
          newSubRow('', initChannelId, defaultBoardId),
          newSubRow('', initChannelId, defaultBoardId),
        ]);
      }
      return;
    }

    if (hasExistingParent) {
      const subRows = (subTitleTitles ?? []).map((t, i) => {
        const row = newSubRow(t, initChannelId, defaultBoardId);
        row.description = subDescriptions?.[i + 1] || t;
        row.clientRowId = clientRowIds?.[i];
        return row;
      });
      setRows([...subRows, newSubRow('', initChannelId, defaultBoardId)]);
      return;
    }

    const parentRow: BulkRow = {
      id: newRowId(),
      clientRowId: clientRowIds?.[0],
      title: parentTitle ?? '',
      description: subDescriptions?.[0] || parentTitle || '',
      priority: TicketPriority.HIGH,
      channelId: initChannelId,
      boardId: defaultBoardId,
      status: TicketStatusV2.TODO,
      assigneeId: null,
      tags: [],
      ticketType: BaseTicketType.Fix,
      eta: null,
    };
    const subRows = (subTitleTitles ?? []).map((t, i) => {
      const row = newSubRow(t, initChannelId, defaultBoardId);
      row.description = subDescriptions?.[i + 1] || t;
      row.clientRowId = clientRowIds?.[i + 1];
      return row;
    });
    setRows([parentRow, ...subRows, newSubRow('', initChannelId, defaultBoardId)]);
  }, [
    isOpen,
    parentTitle,
    subTitleTitles,
    subDescriptions,
    clientRowIds,
    propChannelId,
    defaultBoardId,
    isAllParentsMode,
  ]);

  React.useEffect(() => {
    if (!isOpen || !defaultBoardId) return;
    setRows(prev => {
      const needsUpdate = prev.some(r => !r.boardId);
      if (!needsUpdate) return prev;
      return prev.map(r => ({ ...r, boardId: r.boardId || defaultBoardId }));
    });
  }, [isOpen, defaultBoardId]);

  const ensureEmptyRows = (rows: BulkRow[], count: number): BulkRow[] => {
    const emptyCount = rows.filter(r => !r.title.trim()).length;
    if (emptyCount >= count) return rows;
    const ref = rows[rows.length - 1];
    const channelId = ref?.channelId ?? '';
    const boardId = ref?.boardId ?? '';
    const needed = count - emptyCount;
    return [...rows, ...Array.from({ length: needed }, () => newSubRow('', channelId, boardId))];
  };

  const updateRow = useCallback((id: string, patch: Partial<BulkRow>): void => {
    setRows(prev => {
      let updated = prev.map(r => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        if (patch.title !== undefined && !r.description.trim()) {
          next.description = patch.title;
        }
        return next;
      });
      if (patch.channelId !== undefined && patch.channelId) {
        const selectedBoardId = updated.find(r => r.id === id)?.boardId || '';
        updated = updated.map(r => ({
          ...r,
          channelId: r.channelId || patch.channelId!,
          boardId: r.boardId || selectedBoardId,
        }));
      }
      if (patch.boardId !== undefined && patch.boardId) {
        updated = updated.map(r => ({
          ...r,
          boardId: r.boardId || patch.boardId!,
        }));
      }
      if (patch.title !== undefined && patch.title.trim()) {
        return ensureEmptyRows(updated, 2);
      }
      return updated;
    });
  }, []);

  const removeRow = (id: string): void => {
    setRows(prev => {
      const filtered = prev.filter(r => r.id !== id);
      return ensureEmptyRows(filtered, 1);
    });
  };

  const applyToAll = (field: 'priority' | 'channelId' | 'boardId' | 'ticketType'): void => {
    if (rows.length === 0) return;
    const firstRow = rows[0];
    if (!firstRow) return;
    const value = firstRow[field];
    setRows(prev => prev.map(r => ({ ...r, [field]: value })));
  };

  const filledRows = rows.filter(r => r.title.trim().length > 0);
  const validCount = filledRows.filter(r => r.description.trim().length > 0).length;
  const allValid =
    validCount > 0 && filledRows.every(r => r.description.trim().length > 0) && !!projectId;

  const handleSubmit = async (): Promise<void> => {
    if (!allValid || !user || filledRows.length === 0) return;
    setIsSubmitting(true);
    try {
      const completeRows = filledRows.filter(r => r.description.trim().length > 0);
      const resolveAssignee = (assigneeId: string | null) => {
        if (!assigneeId) return { assignedTo: undefined, userGroupId: undefined };
        if (assigneeId.startsWith('group:')) {
          return { assignedTo: undefined, userGroupId: assigneeId.slice(6) };
        }
        return { assignedTo: assigneeId, userGroupId: undefined };
      };

      if (isAllParentsMode) {
        const tickets = completeRows.map(r => ({
          title: r.title.trim(),
          description: r.description,
          priority: r.priority,
          statusV2: r.status,
          eta: r.eta ?? undefined,
          channelId: r.channelId,
          boardId: r.boardId,
          ...resolveAssignee(r.assigneeId),
          tags: r.tags,
          ticketType: r.ticketType,
          clientRowId: r.clientRowId ?? r.id,
        }));
        const body = {
          mode: BulkTicketMode.ALL_PARENTS,
          tickets,
          projectId,
          channelId: propChannelId,
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
        onClose();
        return;
      }

      if (hasExistingParent) {
        const subTickets = completeRows.map(r => ({
          title: r.title.trim(),
          description: r.description,
          priority: r.priority,
          statusV2: r.status,
          eta: r.eta ?? undefined,
          channelId: r.channelId,
          boardId: r.boardId,
          ...resolveAssignee(r.assigneeId),
          tags: r.tags,
          ticketType: r.ticketType,
          clientRowId: r.clientRowId ?? r.id,
        }));
        const body = {
          mode: BulkTicketMode.PARENT_SUB,
          existingParentTicketId: existingParentTicket.id,
          sourceMessageId,
          subTickets,
        };
        const res = await apiInstance.post('/tickets/bulk-from-message', body);
        const data = res.data as {
          parentTicketId: string;
          parentXyneId: string;
          conversationId: string;
          enqueuedSubTickets: number;
          failedSubTickets?: number;
          failedTitles?: string[];
        };
        if (data.failedSubTickets && data.failedSubTickets > 0) {
          toast.warning('Partial success', {
            description: `${data.enqueuedSubTickets} queued, ${data.failedSubTickets} failed: ${data.failedTitles?.join(', ')}`,
          });
        } else {
          toast.success('Sub-tickets will be created shortly', {
            description: `${data.enqueuedSubTickets} sub-ticket${data.enqueuedSubTickets !== 1 ? 's' : ''} queued.`,
          });
        }
        onTicketCreated?.({
          id: data.parentTicketId,
          conversationId: data.conversationId,
          xyneId: data.parentXyneId,
        });
        onClose();
        return;
      }

      const parent = completeRows[0];
      if (!parent) return;
      const subTickets = completeRows.slice(1).map(r => ({
        title: r.title.trim(),
        description: r.description,
        priority: r.priority,
        statusV2: r.status,
        eta: r.eta,
        channelId: r.channelId,
        boardId: r.boardId,
        ...resolveAssignee(r.assigneeId),
        tags: r.tags,
        ticketType: r.ticketType,
        clientRowId: r.clientRowId ?? r.id,
      }));
      const body: {
        mode: BulkTicketMode;
        parent: Record<string, unknown>;
        subTickets: unknown[];
        sourceConversationId?: string;
      } = {
        mode: BulkTicketMode.PARENT_SUB,
        parent: {
          title: parent.title.trim(),
          description: parent.description,
          projectId,
          boardId: parent.boardId,
          channelId: parent.channelId,
          priority: parent.priority,
          statusV2: parent.status,
          eta: parent.eta ?? undefined,
          ...resolveAssignee(parent.assigneeId),
          tags: parent.tags,
          ticketType: parent.ticketType,
        },
        subTickets,
      };
      if (sourceConversationId) {
        body.sourceConversationId = sourceConversationId;
      }
      const res = await apiInstance.post('/tickets/bulk-from-message', body);
      const data = res.data as {
        parentTicketId: string;
        parentXyneId: string;
        conversationId: string;
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
          description: `${data.enqueuedSubTickets} sub-ticket${data.enqueuedSubTickets !== 1 ? 's' : ''} queued.`,
        });
      }
      onTicketCreated?.({
        id: data.parentTicketId,
        conversationId: data.conversationId,
        xyneId: data.parentXyneId,
      });
      onClose();
    } catch (error) {
      console.error('Failed to create bulk tickets:', error);
      toast.error('Failed to create tickets', {
        description: 'Please try again or contact support.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title={
        isAllParentsMode
          ? 'Create tickets'
          : hasExistingParent
            ? 'Create sub-tickets'
            : 'Create tickets from message'
      }
      className='max-w-6xl rounded-2xl overflow-hidden'
      onOpenAutoFocus={e => e.preventDefault()}
    >
      <div className='flex flex-col' style={{ maxHeight: '88vh' }}>
        <div className='flex items-center gap-3 px-4 py-2.5 shrink-0 flex-wrap border-b border-border'>
          <span className='text-[12px] text-muted-foreground'>
            {projectId
              ? 'New rows appear automatically as you fill in titles'
              : 'Select a channel in any row to auto-fill details'}
          </span>

          <span className='ml-auto text-[12px] text-muted-foreground font-medium'>
            {validCount} ready
          </span>
        </div>

        <div className='flex-1 min-h-0 p-4'>
          <div className='h-full rounded-xl border border-border overflow-hidden flex flex-col'>
            <div
              className='grid sticky top-0 z-10 bg-muted/50 border-b border-border text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0'
              style={{ gridTemplateColumns: GRID_COLS }}
            >
              <div className='flex items-center justify-center h-9' />
              <ColumnHeader label='Title' />
              <ColumnHeader label='Description' />
              <ColumnHeader label='Priority' onApply={() => applyToAll('priority')} />
              <ColumnHeader label='Channel' onApply={() => applyToAll('channelId')} />
              <ColumnHeader label='Board' onApply={() => applyToAll('boardId')} />
              <ColumnHeader label='Assignee' />
              <ColumnHeader label='Type' onApply={() => applyToAll('ticketType')} />
              <div className='flex items-center px-2 h-9'>Due</div>
              <div className='flex items-center justify-center h-9' />
            </div>

            <div
              className='overflow-y-auto flex-1 min-h-0
              [&::-webkit-scrollbar]:w-2
              [&::-webkit-scrollbar-thumb]:rounded-full
              [&::-webkit-scrollbar-thumb]:bg-border
              [&::-webkit-scrollbar-track]:bg-transparent'
            >
              {rows.map((row, idx) => {
                const isMain = idx === 0 && !hasExistingParent;
                const hasTitle = row.title.trim().length > 0;
                const invalid = hasTitle && !row.description.trim();
                const isEmpty = !hasTitle;
                return (
                  <div
                    key={row.id}
                    className={cn(
                      'grid items-center border-b border-border/40 last:border-b-0 transition-colors',
                      invalid && 'shadow-[inset_3px_0_0_0] shadow-red-500',
                      isEmpty && 'opacity-50',
                    )}
                    style={{
                      gridTemplateColumns: GRID_COLS,
                      minHeight: '44px',
                      background:
                        isMain && !isAllParentsMode ? 'hsl(var(--muted) / 0.35)' : 'transparent',
                    }}
                  >
                    <div className='flex items-center justify-center'>
                      {isMain && !isAllParentsMode ? (
                        <Star className='size-4 fill-amber-400 text-amber-400' />
                      ) : (
                        <span className='text-[10.5px] text-muted-foreground/50 font-mono'>
                          {idx + 1}
                        </span>
                      )}
                    </div>

                    <div className='flex items-center gap-2 px-2 min-w-0'>
                      <input
                        value={row.title}
                        onChange={e => updateRow(row.id, { title: e.target.value })}
                        placeholder='Ticket title'
                        data-track-category='Tickets'
                        data-track-name='BulkTicketTitle'
                        className={cn(
                          'w-full min-w-0 h-[34px] bg-transparent border-none outline-none px-2 text-[13px]',
                          'text-foreground placeholder:text-muted-foreground rounded-md',
                          'focus:bg-accent/40 focus:ring-1 focus:ring-primary/30',
                          isMain && 'font-semibold',
                        )}
                      />
                      {!isAllParentsMode && (
                        <span
                          className={cn(
                            'shrink-0 text-[9.5px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
                            isMain
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {isMain ? 'Parent' : 'Sub'}
                        </span>
                      )}
                    </div>

                    <div className='px-2 min-w-0'>
                      <input
                        value={row.description}
                        onChange={e => updateRow(row.id, { description: e.target.value })}
                        placeholder='Description'
                        data-track-category='Tickets'
                        data-track-name='BulkTicketDescription'
                        className={cn(
                          'w-full min-w-0 h-[34px] bg-transparent border-none outline-none px-2 text-[12.5px]',
                          'text-muted-foreground placeholder:text-muted-foreground/60 rounded-md',
                          'focus:bg-accent/40 focus:ring-1 focus:ring-primary/30',
                          isMain && 'font-medium',
                        )}
                      />
                    </div>

                    <div className='px-1 overflow-hidden'>
                      <EntitySelector
                        options={PRIORITY_OPTIONS}
                        selectedValue={row.priority}
                        onSelect={v => updateRow(row.id, { priority: v as TicketPriority })}
                        placeholder='Priority'
                        searchPlaceholder='Search'
                        noBorder
                        width='100%'
                        inputClassName='h-[34px] px-2 gap-1 text-[12.5px] bg-transparent dark:bg-transparent hover:bg-accent/40 justify-between [&>span:first-child]:truncate [&>span:first-child]:flex-1'
                      />
                    </div>

                    <div className='px-1 overflow-hidden'>
                      <EntitySelector
                        options={channelOptions}
                        selectedValue={row.channelId}
                        onSelect={v => updateRow(row.id, { channelId: v ?? '' })}
                        placeholder='Channel'
                        searchPlaceholder='Search'
                        noBorder
                        width='100%'
                        inputClassName='h-[34px] px-2 gap-1 text-[12.5px] bg-transparent dark:bg-transparent hover:bg-accent/40 justify-between [&>span:first-child]:truncate [&>span:first-child]:flex-1'
                      />
                    </div>

                    <div className='px-1 overflow-hidden'>
                      <EntitySelector
                        options={boardOptions}
                        selectedValue={row.boardId}
                        onSelect={v => updateRow(row.id, { boardId: v ?? '' })}
                        placeholder='Board'
                        searchPlaceholder='Search'
                        noBorder
                        width='100%'
                        inputClassName='h-[34px] px-2 gap-1 text-[12.5px] bg-transparent dark:bg-transparent hover:bg-accent/40 justify-between [&>span:first-child]:truncate [&>span:first-child]:flex-1'
                      />
                    </div>

                    <div className='px-1 overflow-hidden'>
                      <EntitySelector
                        options={assigneeOptions}
                        selectedValue={row.assigneeId ?? ''}
                        onSelect={v => updateRow(row.id, { assigneeId: v || null })}
                        placeholder='Unassigned'
                        searchPlaceholder='Search users'
                        onSearchChange={setAssigneeSearch}
                        disableClientFiltering
                        noBorder
                        width='100%'
                        inputClassName='h-[34px] px-2 gap-1 text-[12.5px] bg-transparent dark:bg-transparent hover:bg-accent/40 justify-between [&>span:first-child]:truncate [&>span:first-child]:flex-1'
                        showClearButton
                      />
                    </div>

                    <div className='px-1 overflow-hidden'>
                      <EntitySelector
                        options={ticketTypeOptions}
                        selectedValue={row.ticketType}
                        onSelect={v => updateRow(row.id, { ticketType: v as BaseTicketType })}
                        placeholder='Type'
                        searchPlaceholder='Search'
                        noBorder
                        width='100%'
                        inputClassName='h-[34px] px-2 gap-1 text-[12.5px] bg-transparent dark:bg-transparent hover:bg-accent/40 justify-between [&>span:first-child]:truncate [&>span:first-child]:flex-1'
                      />
                    </div>

                    <div className='px-1 overflow-hidden flex items-center'>
                      <DatePicker
                        selectedDate={row.eta}
                        onSelect={date => updateRow(row.id, { eta: date })}
                        placeholder='No date'
                        showClearButton
                        inputClassName='h-[34px] text-[11px] border-0 shadow-none bg-transparent hover:bg-accent/40 w-full'
                      />
                    </div>

                    <div className='flex items-center justify-center'>
                      {(!isMain || isAllParentsMode) && (
                        <button
                          type='button'
                          onClick={() => removeRow(row.id)}
                          className='size-6 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 flex items-center justify-center transition'
                          title='Remove row'
                          data-track-category='Tickets'
                          data-track-name='BulkTicketRemoveRow'
                        >
                          <Trash2 className='size-3.5' />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className='flex items-center justify-between px-5 py-3 border-t border-border shrink-0'>
          {isAllParentsMode ? (
            <p className='text-[12px] text-muted-foreground truncate'>
              {validCount} ticket{validCount !== 1 ? 's' : ''} ready
            </p>
          ) : (
            <p className='text-[12px] text-muted-foreground truncate'>
              Sub-tickets link to{' '}
              <span className='font-medium text-foreground'>
                {filledRows[0]?.title || 'main ticket'}
              </span>{' '}
              as the parent
            </p>
          )}
          <div className='flex items-center gap-2 shrink-0'>
            <button
              type='button'
              onClick={onClose}
              className='text-[13px] font-medium text-foreground px-3 py-1.5 rounded-lg hover:bg-accent transition'
              data-track-category='Tickets'
              data-track-name='BulkTicketCancel'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={() => {
                void handleSubmit();
              }}
              disabled={!allValid || isSubmitting}
              className={cn(
                'text-[13px] font-medium text-primary-foreground bg-primary px-3 py-1.5 rounded-lg flex items-center gap-1 transition',
                (!allValid || isSubmitting) && 'opacity-50 cursor-not-allowed',
              )}
              data-track-category='Tickets'
              data-track-name='BulkTicketSubmit'
            >
              {isSubmitting ? <Loader2 className='size-3.5 animate-spin' /> : null}
              Create tickets
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

const ColumnHeader: React.FC<{ label: string; onApply?: () => void }> = ({ label, onApply }) => (
  <div className='flex items-center gap-1 px-2 h-9 group'>
    <span>{label}</span>
    {onApply && (
      <button
        type='button'
        onClick={onApply}
        title={`Apply row 1's ${label.toLowerCase()} to all`}
        className='text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition'
        data-track-category='Tickets'
        data-track-name={`BulkTicketApply${label}`}
      >
        <ArrowDownToLine className='size-3' />
      </button>
    )}
  </div>
);

export default BulkCreateTicketsModal;
