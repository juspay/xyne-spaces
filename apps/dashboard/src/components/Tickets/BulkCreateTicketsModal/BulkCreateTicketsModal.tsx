import React, { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { logger, Event } from '../../../utils/logger';
import { Star, Trash2, ArrowDownToLine, Loader2 } from 'lucide-react';
import {
  BaseTicketType,
  BulkTicketMode,
  type CreateBulkTicketResponse,
  ChannelScopeType,
  LookupType,
  TicketPriority,
  TicketStatusV2,
  type ExistingParentTicket,
  MAX_BULK_TICKETS,
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
  boardId?: string | undefined;
  boardName?: string | undefined;
  /** Set by the tickets tab so channels can keep those tickets out of chat. */
  fromTicketsTab?: boolean;
  mode?: BulkTicketMode;
  parentTitle?: string | undefined;
  subTitleTitles?: string[] | undefined;
  subDescriptions?: string[] | undefined;
  clientRowIds?: ReadonlyArray<string | undefined> | undefined;
  existingParentTicket?: ExistingParentTicket | undefined;
  sourceMessageId?: string | undefined;
  sourceConversationId?: string | undefined;
  /**
   * Called once the batch has been created. The parent is passed whenever there
   * is one — it exists by the time the response lands, whether this batch made
   * it or the caller supplied it.
   */
  onTicketCreated?: (ticket?: { id: string; conversationId?: string; xyneId?: string }) => void;
  /**
   * Called with the full batch result. Callers that drove the modal from a
   * list (AI suggestions) need every created ticket, not just the parent, to
   * mark their source rows as handled.
   */
  onBulkCreated?: (result: CreateBulkTicketResponse) => void;
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
  ticketType: BaseTicketType.Fix,
  eta: null,
});

export const BulkCreateTicketsModal: React.FC<BulkCreateTicketsModalProps> = ({
  isOpen,
  onClose,
  channelId: propChannelId,
  projectId: propProjectId,
  boardId: propBoardId,
  fromTicketsTab = false,
  mode = BulkTicketMode.PARENT_SUB,
  parentTitle,
  subTitleTitles,
  subDescriptions,
  clientRowIds,
  existingParentTicket,
  sourceMessageId,
  sourceConversationId,
  onTicketCreated,
  onBulkCreated,
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

  const defaultBoardId = useMemo(() => propBoardId || boards?.[0]?.id || '', [propBoardId, boards]);
  const initDoneRef = useRef(false);

  React.useEffect(() => {
    if (!isOpen) {
      initDoneRef.current = false;
      return;
    }
    if (initDoneRef.current) return;
    initDoneRef.current = true;
    const initChannelId = propChannelId ?? '';
    const clientRowIdAt = (index: number): string | undefined => clientRowIds?.[index] || undefined;

    if (isAllParentsMode) {
      if (subTitleTitles && subTitleTitles.length > 0) {
        const prefilledRows = subTitleTitles.map((t, i) => {
          const row = newSubRow(t, initChannelId, defaultBoardId);
          row.description = subDescriptions?.[i] || t;
          row.clientRowId = clientRowIdAt(i);
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
        row.clientRowId = clientRowIdAt(i);
        return row;
      });
      setRows([...subRows, newSubRow('', initChannelId, defaultBoardId)]);
      return;
    }

    const parentRow: BulkRow = {
      id: newRowId(),
      clientRowId: clientRowIdAt(0),
      title: parentTitle ?? '',
      description: subDescriptions?.[0] || parentTitle || '',
      priority: TicketPriority.HIGH,
      channelId: initChannelId,
      boardId: defaultBoardId,
      status: TicketStatusV2.TODO,
      assigneeId: null,
      ticketType: BaseTicketType.Fix,
      eta: null,
    };
    const subRows = (subTitleTitles ?? []).map((t, i) => {
      const row = newSubRow(t, initChannelId, defaultBoardId);
      row.description = subDescriptions?.[i + 1] || t;
      row.clientRowId = clientRowIdAt(i + 1);
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
    hasExistingParent,
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
      // When channel is selected in ANY row, auto-fill channel+board for all rows that don't have one
      if (patch.channelId !== undefined && patch.channelId) {
        const selectedBoardId = updated.find(r => r.id === id)?.boardId || '';
        updated = updated.map(r => ({
          ...r,
          channelId: r.channelId || patch.channelId!,
          boardId: r.boardId || selectedBoardId,
        }));
      }
      // When board is selected in ANY row, auto-fill for rows that don't have one
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
  const minimumRows = isAllParentsMode || hasExistingParent ? 1 : 2;
  const blockingReason = ((): string | null => {
    if (!projectId) return 'Pick a channel to set the project';
    if (filledRows.length < minimumRows) {
      return minimumRows === 1
        ? 'Add at least one ticket'
        : 'Add at least one sub-ticket under the main ticket';
    }
    if (filledRows.length > MAX_BULK_TICKETS) {
      return `Create at most ${MAX_BULK_TICKETS} tickets at a time`;
    }
    if (filledRows.some(r => !r.description.trim())) return 'Every ticket needs a description';
    if (filledRows.some(r => !r.channelId)) return 'Every ticket needs a channel';
    if (filledRows.some(r => !r.boardId)) return 'Every ticket needs a board';
    return null;
  })();
  const allValid = blockingReason === null;

  const handleSubmit = async (): Promise<void> => {
    if (!allValid || !user || filledRows.length === 0) return;
    setIsSubmitting(true);
    try {
      // Every filled row already has a description — allValid blocks submit otherwise.
      const completeRows = filledRows;
      const resolveAssignee = (
        assigneeId: string | null,
      ): { assignedTo: string | undefined; userGroupId: string | undefined } => {
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
          ticketType: r.ticketType,
          clientRowId: r.clientRowId ?? r.id,
        }));
        const body = {
          mode: BulkTicketMode.ALL_PARENTS,
          tickets,
          projectId,
          channelId: propChannelId,
          ...(fromTicketsTab ? { fromTicketsTab: true } : {}),
        };
        const res = await apiInstance.post('/tickets/bulk-from-message', body);
        const data = res.data as CreateBulkTicketResponse;
        const count = data.createdTickets.length;
        toast.success(`Created ${count} ticket${count !== 1 ? 's' : ''}`);
        onBulkCreated?.(data);
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
          ticketType: r.ticketType,
          clientRowId: r.clientRowId ?? r.id,
        }));
        const body = {
          mode: BulkTicketMode.PARENT_SUB,
          existingParentTicketId: existingParentTicket.id,
          channelId: propChannelId,
          projectId,
          subTickets,
          ...(sourceMessageId ? { sourceMessageId } : {}),
          ...(fromTicketsTab ? { fromTicketsTab: true } : {}),
        };
        const res = await apiInstance.post('/tickets/bulk-from-message', body);
        const data = res.data as CreateBulkTicketResponse;
        const subCount = data.createdTickets.length;
        toast.success(`Created ${subCount} sub-ticket${subCount !== 1 ? 's' : ''}`);
        onBulkCreated?.(data);
        // The parent is the one the caller handed us, so these are real values.
        onTicketCreated?.({
          id: existingParentTicket.id,
          conversationId: existingParentTicket.conversationId,
          ...(existingParentTicket.xyneId ? { xyneId: existingParentTicket.xyneId } : {}),
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
        ticketType: r.ticketType,
        clientRowId: r.clientRowId ?? r.id,
      }));
      const body: {
        mode: BulkTicketMode;
        parent: Record<string, unknown>;
        channelId?: string;
        projectId?: string;
        boardId?: string;
        subTickets: unknown[];
        sourceConversationId?: string;
        fromTicketsTab?: boolean;
      } = {
        mode: BulkTicketMode.PARENT_SUB,
        channelId: parent.channelId,
        projectId,
        boardId: parent.boardId,
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
          ticketType: parent.ticketType,
        },
        subTickets,
        ...(fromTicketsTab ? { fromTicketsTab: true } : {}),
      };
      if (sourceConversationId) {
        body.sourceConversationId = sourceConversationId;
      }
      const res = await apiInstance.post('/tickets/bulk-from-message', body);
      const data = res.data as CreateBulkTicketResponse;
      const subCount = data.createdTickets.length;
      toast.success(`Created 1 ticket and ${subCount} sub-ticket${subCount !== 1 ? 's' : ''}`);
      onBulkCreated?.(data);
      // The parent exists now, so the caller gets the real ticket to navigate to.
      onTicketCreated?.(data.parentTicketId ? { id: data.parentTicketId } : undefined);
      onClose();
    } catch (error) {
      logger.error(Event.API_CALL_FAILED, {
        message: 'Bulk ticket creation failed',
        error,
      });
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
        {/* Toolbar */}
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

        {/* Grid */}
        <div className='flex-1 min-h-0 p-4'>
          <div className='h-full rounded-xl border border-border overflow-hidden flex flex-col'>
            {/* Column headers */}
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

            {/* Rows */}
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
                    {/* Index / Star */}
                    <div className='flex items-center justify-center'>
                      {isMain && !isAllParentsMode ? (
                        <Star className='size-4 fill-amber-400 text-amber-400' />
                      ) : (
                        <span className='text-[10.5px] text-muted-foreground/50 font-mono'>
                          {idx + 1}
                        </span>
                      )}
                    </div>

                    {/* Title + Badge */}
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

                    {/* Description — a textarea, not an input: an input strips
                        line breaks from its value, so a multi-line description
                        would both render as one run-on line and lose its
                        blank lines the moment the field was edited. */}
                    <div className='px-2 min-w-0 py-1'>
                      <textarea
                        value={row.description}
                        onChange={e => updateRow(row.id, { description: e.target.value })}
                        placeholder='Description'
                        rows={1}
                        data-track-category='Tickets'
                        data-track-name='BulkTicketDescription'
                        className={cn(
                          'w-full min-w-0 min-h-[34px] max-h-[140px] resize-y overflow-auto',
                          'bg-transparent border-none outline-none px-2 py-[7px] text-[12.5px] leading-[20px]',
                          'text-muted-foreground placeholder:text-muted-foreground/60 rounded-md',
                          'focus:bg-accent/40 focus:ring-1 focus:ring-primary/30',
                          isMain && 'font-medium',
                        )}
                      />
                    </div>

                    {/* Priority */}
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

                    {/* Channel */}
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

                    {/* Board */}
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

                    {/* Assignee */}
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

                    {/* Type */}
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

                    {/* Due Date */}
                    <div className='px-1 overflow-hidden flex items-center'>
                      <DatePicker
                        selectedDate={row.eta}
                        onSelect={date => updateRow(row.id, { eta: date })}
                        placeholder='No date'
                        showClearButton
                        inputClassName='h-[34px] text-[11px] border-0 shadow-none bg-transparent hover:bg-accent/40 w-full'
                      />
                    </div>

                    {/* Delete */}
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

        {/* Footer */}
        <div className='flex items-center justify-between px-5 py-3 border-t border-border shrink-0'>
          {blockingReason ? (
            <p className='text-[12px] text-destructive truncate'>{blockingReason}</p>
          ) : isAllParentsMode ? (
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
              {...(blockingReason ? { title: blockingReason } : {})}
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
