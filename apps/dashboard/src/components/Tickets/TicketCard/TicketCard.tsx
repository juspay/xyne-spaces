import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
import {
  CalendarDefault as Calendar,
  UserDefault as User,
  Tag,
  TimerDefault as Timer,
} from '@xyne/icons';
import {
  BaseTicketType,
  isReleaseTicket,
  Ticket,
  TicketTag,
  TicketStatusV2,
  addSlaHours,
} from '@xyne/shared';
import { getPriorityIcon, formatEta, isEtaUrgent, isStageOverdue } from './TicketCard.utils';
import { cn } from '../../../utils/classNames';
import { useUser, useUsers, useSelf } from '../../../hooks/useUsers';
import { TicketStatusWithStages } from '../TicketStatus/TicketStatusIcon';
import Tooltip, { TruncatedTooltip } from '../../ui/Tooltip';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import { TagSelector } from '../TicketTable/TagSelector';
import Avatar from '../../ui/Avatar/Avatar';
import { useUserGroupById, useUserGroups } from '../../../hooks/useUserGroup';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { useChannelAssignGate } from '../../../hooks/useChannelAssignGate';
import { PriorityOptions, useAssigneeOptions } from '../TicketTable/TicketTableHelper';
import { StagePicker } from '../TicketListView/StagePicker';
import { v4 as uuidv4 } from 'uuid';
import { type BoardSlaPolicy } from '../../../hooks/useChannelSlaPolicy';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { getUserDisplayName } from '../../../utils/userDisplayName';

const DEFAULT_VISIBLE_COLUMNS = new Set(['assignee', 'dueDate', 'priority', 'tags']);

// Search-match highlights (subject/id with `<hi>` markers) keyed by xyneId,
// supplied by the search results screen. Null everywhere else → plain text.
export interface TicketSearchHighlight {
  titleHtml?: string;
  xyneIdHtml?: string;
}

export const TicketSearchHighlightContext = createContext<Map<
  string,
  TicketSearchHighlight
> | null>(null);

// ---------------------------------------------------------------------------
// SLA response badge — module-level component so it is not re-created on
// every TicketCard render. Closed over nothing from TicketCard; all data is
// passed explicitly via props.
// ---------------------------------------------------------------------------

/** Format an elapsed duration (ms) as "Xm", "Xh Ym", or "Xd Yh". */
const formatElapsed = (ms: number): string => {
  const totalMins = Math.round(ms / 60_000);
  if (totalMins < 60) return `${totalMins}m`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
};

interface SlaResponseBadgeProps {
  /** Response SLA deadline as Unix epoch ms (derived from policy + createdAt). */
  responseDueMs: number;
  /** Unix ms when an agent first replied; null if not yet responded. */
  firstRespondedAt: number | null;
  /** Unix ms of ticket creation. */
  ticketCreatedAt: number;
  /** Whether the ticket is in a terminal state (COMPLETED / CANCELLED). */
  isTerminal: boolean;
}

const SlaResponseBadge: React.FC<SlaResponseBadgeProps> = ({
  responseDueMs,
  firstRespondedAt,
  ticketCreatedAt,
  isTerminal,
}) => {
  // ── Already responded: show actual elapsed time ────────────────────────
  if (firstRespondedAt) {
    const elapsed = firstRespondedAt - ticketCreatedAt;
    const metSla = firstRespondedAt <= responseDueMs;
    return (
      <Tooltip content={`First responded at ${new Date(firstRespondedAt).toLocaleString()}`}>
        <div
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium',
            metSla
              ? 'border-border text-muted-foreground'
              : 'bg-red-50 border-red-100 text-red-500',
          )}
        >
          <Timer className='w-3.5 h-3.5 shrink-0' strokeWidth={2} />
          <span>{formatElapsed(elapsed)}</span>
        </div>
      </Tooltip>
    );
  }

  // ── Awaiting response: countdown or overdue ────────────────────────────
  const diffMs = responseDueMs - Date.now();
  const isOverdue = diffMs < 0;

  const label = isOverdue ? formatElapsed(Math.abs(diffMs)) + ' ago' : formatElapsed(diffMs);

  const urgency =
    isOverdue && !isTerminal
      ? 'overdue'
      : !isOverdue && diffMs < 3_600_000
        ? 'critical'
        : !isOverdue && diffMs < 4 * 3_600_000
          ? 'warning'
          : 'normal';

  const colorMap = {
    overdue: 'bg-red-50 border-red-100 text-red-500',
    critical: 'bg-orange-50 border-orange-100 text-orange-600',
    warning: 'bg-amber-50 border-amber-100 text-amber-600',
    normal: 'border-border text-muted-foreground',
  };

  return (
    <Tooltip content={`Response SLA due: ${new Date(responseDueMs).toLocaleString()}`}>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium',
          colorMap[urgency],
        )}
      >
        <Timer className='w-3.5 h-3.5 shrink-0' strokeWidth={2} />
        <span>{label}</span>
      </div>
    </Tooltip>
  );
};

const AssigneeEditor: React.FC<{
  selectedValue: string | null;
  onSelect: (value: string | null) => void;
  onOpenChange: (open: boolean) => void;
  channelId: string | undefined;
}> = ({ selectedValue, onSelect, onOpenChange, channelId }) => {
  const users = useUsers();
  const userGroups = useUserGroups();
  const selfId = useSelf()?.id;
  const { shouldGate, memberIds, gatedAssign } = useChannelAssignGate(channelId);
  // Pass memberIds so channel members are ranked above non-members, and selfId so
  // the current user pins to the top as "(You)". Empty memberIds when the ticket
  // has no channel / participants haven't loaded → no membership reordering.
  const assigneeOptions = useAssigneeOptions(users, userGroups || [], memberIds, selfId);
  const options = useMemo<SelectorOption[]>(() => {
    if (!shouldGate) return assigneeOptions;
    return assigneeOptions.map(o => {
      if (!o.value.startsWith('user:')) return o;
      const uid = o.value.slice('user:'.length);
      return memberIds.has(uid) ? o : { ...o, badge: 'Not in channel' };
    });
  }, [assigneeOptions, shouldGate, memberIds]);

  const handleSelect = (value: string | null): void => {
    if (value && value.startsWith('user:')) {
      const uid = value.slice('user:'.length);
      const name = assigneeOptions.find(o => o.value === value)?.label ?? 'This user';
      gatedAssign({ userId: uid, userName: name, assign: () => onSelect(value) });
    } else {
      onSelect(value);
    }
  };

  return (
    <EntitySelector
      options={options}
      selectedValue={selectedValue}
      onSelect={handleSelect}
      placeholder='Select assignee'
      searchPlaceholder='Search...'
      variant='inline'
      virtualize
      isOpen={true}
      onOpenChange={onOpenChange}
    />
  );
};

interface TicketCardProps {
  ticket: Ticket;
  tags?: TicketTag[];
  availableTags?: string[];
  onClick?: (e: React.MouseEvent | KeyboardEvent) => void;
  width?: string;
  isCompact?: boolean;
  visibleColumns?: Set<string> | undefined;
  isConversation?: boolean;
  activeTicketId?: string;
  /** Only true for email-type desks; hides the email unread indicator everywhere else. */
  showEmailReads?: boolean;
  /**
   * SLA policies pre-fetched by the parent for the whole board.
   * When omitted, SLA badges are not shown — no per-card fetch is performed.
   */
  slaPolicies?: BoardSlaPolicy[];
}

export const TicketCard: React.FC<TicketCardProps> = ({
  ticket,
  onClick,
  width = 'w-full',
  tags,
  availableTags = [],
  isCompact = false,
  visibleColumns = DEFAULT_VISIBLE_COLUMNS,
  isConversation = false,
  activeTicketId,
  showEmailReads = false,
  slaPolicies: slaPoliciesProp,
}) => {
  const zero = useZero();
  const { userID } = useAuthContextValues();
  const contentRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const [isEditingTags, setIsEditingTags] = useState(false);

  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [isEditingAssignee, setIsEditingAssignee] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);

  const isActiveKanbanTicket =
    !!activeTicketId && activeTicketId === (ticket as unknown as { xyneId?: string }).xyneId;

  const emailReads = (
    ticket as unknown as { emailReads?: ReadonlyArray<{ userId: string; lastReadEmailAt: number }> }
  ).emailReads;
  const emailCount = (ticket as unknown as { emailCount?: number }).emailCount ?? 0;
  const lastEmailAt = (ticket as unknown as { lastEmailAt?: number }).lastEmailAt ?? 0;
  const userReadRow = (emailReads ?? []).find(r => r.userId === userID);
  const isEmailRead =
    showEmailReads &&
    !isActiveKanbanTicket &&
    emailCount > 0 &&
    !!userReadRow &&
    userReadRow.lastReadEmailAt >= lastEmailAt;

  const hasStageOverdue = isStageOverdue(ticket);
  const hasDueDate = !!ticket.eta;
  const hasTags = tags && tags.length > 0;

  const isVisible = (column: string) => visibleColumns.has(column);
  const showAssignee = isVisible('assignee');
  const showDueDate = isVisible('dueDate');
  const showSubStatus = isVisible('stage');
  const showPriority = isVisible('priority');
  const showTags = isVisible('tags');
  const showCreatedAt = isVisible('createdAt');
  const showCreatedBy = isVisible('createdBy');

  // A user assignee (assignedTo) wins over a group; groups live in
  // userGroupId, with legacy rows still holding `group:<id>` in assignedTo.
  const assigneeUserId =
    ticket.assignedTo && !ticket.assignedTo.startsWith('group:')
      ? ticket.assignedTo.replace(/^user:/, '')
      : '';
  const assigneeGroupId = assigneeUserId
    ? ''
    : ticket.assignedTo?.startsWith('group:')
      ? ticket.assignedTo.slice('group:'.length)
      : ticket.userGroupId || '';
  const shouldResolveAssignee = showAssignee || !isCompact;
  const shouldResolveCreator = showCreatedBy;

  // firstRespondedAt — stored as ms epoch in Zero, not in the base Ticket type yet
  const firstRespondedAt =
    (ticket as unknown as { firstRespondedAt?: number | null }).firstRespondedAt ?? null;

  // Derive response SLA deadline from the board's active policy + ticket.createdAt.
  // Policies are pre-fetched once by the parent; if not provided the badge is hidden.
  const slaPolicies = slaPoliciesProp ?? [];
  // Filter by boardId in addition to priority so the array is safe to use in
  // multi-board views where policies from several boards are merged together.
  const activePolicy =
    slaPolicies.find(
      p => p.boardId === ticket.boardId && p.priority === ticket.priority && p.isActive,
    ) ?? null;
  const responseDueMs = activePolicy
    ? addSlaHours(new Date(ticket.createdAt), activePolicy.responseHours, activePolicy).getTime()
    : null;

  const creator = useUser(shouldResolveCreator ? ticket.createdBy || '' : '');
  const assignedUser = useUser(shouldResolveAssignee ? assigneeUserId : '');
  const assignedGroup = useUserGroupById(shouldResolveAssignee ? assigneeGroupId : '');

  const selectedTagNames = tags?.map(t => t.name) || [];

  // Check if any compact metadata should be shown
  const hasCompactMetadata = isCompact && (showSubStatus || showCreatedAt || showCreatedBy);

  // Check if ticket is from a release
  const releaseBoardBgColor =
    isReleaseTicket(ticket.ticketType as BaseTicketType) && isConversation ? 'bg-muted' : 'bg-card';

  const searchHighlights = useContext(TicketSearchHighlightContext);
  const ticketHighlight = ticket.xyneId ? searchHighlights?.get(ticket.xyneId) : undefined;

  const handleTagsChange = (newTags: string[]) => {
    const oldTagNames = tags?.map(t => t.name) || [];
    const toAdd = newTags.filter(t => !oldTagNames.includes(t));
    const toRemove = oldTagNames.filter(t => !newTags.includes(t));

    toAdd.forEach(tagName => {
      void surfaceMutationError(
        zero.mutate(
          mutators.ticketTagV2.create({
            ticketId: ticket.id,
            tagId: uuidv4(),
            projectTagId: uuidv4(),
            mappingId: uuidv4(),
            projectId: ticket.projectId,
            tagName,
          }),
        ),
        'Failed to add tag',
      );
    });

    toRemove.forEach(tagName => {
      const tag = tags?.find(t => t.name === tagName);
      if (tag?.id) {
        void surfaceMutationError(
          zero.mutate(mutators.ticketTagV2.delete({ tagId: tag.id, mappingId: tag.id })),
          'Failed to remove tag',
        );
      }
    });
  };

  const handleAssigneeChange = (value: string | null) => {
    // Users live in assignedTo (bare id), groups in userGroupId — the column
    // ticket details and the group workflows read. Assigning a user leaves the
    // group untouched (autoassignment boards keep team + agent together);
    // unassign clears whichever one the card displays. null clears assignedTo;
    // '' clears userGroupId (the mutator ignores null for it).
    const updates =
      value && value.startsWith('group:')
        ? { assignedTo: null, userGroupId: value.slice('group:'.length) }
        : value
          ? { assignedTo: value.replace(/^user:/, '') }
          : assigneeUserId
            ? { assignedTo: null }
            : { assignedTo: null, userGroupId: '' };
    void surfaceMutationError(
      zero.mutate(
        mutators.ticket.update({
          id: ticket.id,
          ...updates,
          updatedAt: Date.now(),
        }),
      ),
      'Failed to update assignee',
    );
    setIsEditingAssignee(false);
  };

  const handlePriorityChange = (value: string | null) => {
    void surfaceMutationError(
      zero.mutate(
        mutators.ticket.update({
          id: ticket.id,
          priority: value as typeof ticket.priority,
          updatedAt: Date.now(),
        }),
      ),
      'Failed to update priority',
    );
    setIsEditingPriority(false);
  };

  const handleAssigneeEditorOpenChange = (open: boolean) => {
    if (!open) {
      setIsEditingAssignee(false);
    }
  };
  const startEditingAssignee = () => setIsEditingAssignee(true);

  // Format created date
  const formatCreatedDate = (timestamp?: number | null) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Hover tooltip content — full timestamp behind the compact date label.
  const formatCreatedDateTime = (timestamp?: number | null): string | null => {
    if (!timestamp) return null;
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  // assignee component
  const renderAssignee = () => {
    if (!showAssignee) return null;

    if (isEditingAssignee && isCompact) {
      return (
        <button
          onClick={e => e.stopPropagation()}
          data-track-category='Tickets'
          data-track-name='EditAssignee'
        >
          <AssigneeEditor
            selectedValue={
              assigneeUserId
                ? `user:${assigneeUserId}`
                : assigneeGroupId
                  ? `group:${assigneeGroupId}`
                  : null
            }
            onSelect={handleAssigneeChange}
            onOpenChange={handleAssigneeEditorOpenChange}
            channelId={ticket.channelId ?? undefined}
          />
        </button>
      );
    }

    const assigneeDisplay = assignedUser ? (
      <Tooltip content={getUserDisplayName(assignedUser)}>
        <div className='relative group/assignee'>
          <Avatar
            userId={assignedUser.id}
            showActiveStatus={false}
            className='size-6 flex items-center justify-center'
          />
        </div>
      </Tooltip>
    ) : assignedGroup ? (
      <div className='relative group/assignee'>
        <Tooltip content={assignedGroup.name}>
          <div className='w-6 h-6 rounded-lg bg-border flex items-center justify-center'>
            <span className='text-xs font-medium text-muted-foreground'>
              {assignedGroup.name.charAt(0).toUpperCase()}
            </span>
          </div>
        </Tooltip>
      </div>
    ) : (
      <div className='relative group/assignee'>
        <Tooltip content='Unassigned'>
          <div className='w-6 h-6 rounded-lg border border-dashed border-muted-foreground bg-background flex items-center justify-center'>
            <User className='w-3 h-3 text-muted-foreground' strokeWidth={1.5} />
          </div>
        </Tooltip>
      </div>
    );

    if (isCompact) {
      return (
        <button
          onClick={e => {
            e.stopPropagation();
            startEditingAssignee();
          }}
          className='cursor-pointer hover:opacity-80 transition-opacity'
          data-track-category='Tickets'
          data-track-name='EditAssigneeInline'
          data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
        >
          {assigneeDisplay}
        </button>
      );
    }

    return assigneeDisplay;
  };

  interface DueDateDisplayProps {
    eta?: number | null | undefined;
    showBorder?: boolean;
    className?: string;
  }

  const DueDateDisplay: React.FC<DueDateDisplayProps> = ({ eta, showBorder = true, className }) => {
    const etaText = formatEta(eta);
    const isUrgent = isEtaUrgent(eta, ticket.statusV2);
    const hasDueDate = !!eta;

    if (!hasDueDate) {
      return (
        <Tooltip content='No due date'>
          <div
            className={cn(
              'flex items-center gap-1.5 px-2 rounded-md py-1 bg-muted',
              showBorder ? 'border border-dashed border-input' : '',
              className,
            )}
          >
            <Calendar className='w-3.5 h-3.5 text-muted-foreground' strokeWidth={2} />
          </div>
        </Tooltip>
      );
    }

    return (
      <div
        className={cn(
          'flex items-center gap-1.5 px-2 rounded-md py-1',
          isUrgent
            ? 'bg-red-50 border border-red-100'
            : showBorder
              ? 'border border-border'
              : 'border-none',
          className,
        )}
      >
        <Calendar
          className={cn('w-3.5 h-3.5 text-muted-foreground', isUrgent && 'text-red-500')}
          strokeWidth={2}
        />
        <span
          className={cn('text-xs font-medium text-muted-foreground', isUrgent && 'text-red-500')}
        >
          {etaText}
        </span>
      </div>
    );
  };

  // ---- SLA response badge ------------------------------------------------
  // Shows how long until the first-response SLA is due, or how long it took
  // to respond once firstRespondedAt is set. Resolution SLA is shown by the
  // existing DueDateDisplay (ticket.eta = resolution deadline set at creation).

  // ---- Conversation (chat) variant --------------------------------------
  // When rendered inside a chat bubble or a linked-ticket preview
  // (`isConversation`), show a single-row strip instead of the tall board
  // card: ticket ID + title + status + assignee. Board / Kanban / table
  // views never pass `isConversation`, so they keep the full card.
  if (isConversation) {
    const conversationAssignee = assignedUser ? (
      <Tooltip content={getUserDisplayName(assignedUser)}>
        <Avatar
          userId={assignedUser.id}
          showActiveStatus={false}
          className='size-5 flex items-center justify-center'
        />
      </Tooltip>
    ) : assignedGroup ? (
      <Tooltip content={assignedGroup.name}>
        <div className='w-5 h-5 rounded-lg bg-border flex items-center justify-center'>
          <span className='text-[10px] font-medium text-muted-foreground'>
            {assignedGroup.name.charAt(0).toUpperCase()}
          </span>
        </div>
      </Tooltip>
    ) : (
      <div className='w-5 h-5 rounded-lg border border-dashed border-muted-foreground bg-background flex items-center justify-center'>
        <User className='w-3 h-3 text-muted-foreground' strokeWidth={1.5} />
      </div>
    );

    return (
      <div className={cn('flex flex-col gap-1.5 max-w-lg', width)}>
        <button
          type='button'
          onClick={e => onClick?.(e)}
          data-testid={`ticket-card-${ticket.id}`}
          className={cn(
            `flex items-center gap-3 text-left ${releaseBoardBgColor} rounded-md border w-full px-3 py-1.5 hover:shadow-sm transition-all cursor-pointer group shadow-sm`,
          )}
          data-track-category='Tickets'
          data-track-name='OpenTicketCard'
          data-track-metadata={JSON.stringify({ ticketId: ticket.id, xyneId: ticket.xyneId })}
        >
          <span className='text-xs font-medium text-muted-foreground font-mono shrink-0'>
            {ticketHighlight?.xyneIdHtml ? (
              <RenderMessageWithHTML message={ticketHighlight.xyneIdHtml} />
            ) : (
              ticket.xyneId
            )}
          </span>
          <TruncatedTooltip content={ticket.title}>
            <h3
              data-testid='ticket-card-title'
              className='flex-1 min-w-0 truncate text-sm font-medium text-foreground'
            >
              {ticketHighlight?.titleHtml ? (
                <RenderMessageWithHTML message={ticketHighlight.titleHtml} />
              ) : (
                ticket.title
              )}
            </h3>
          </TruncatedTooltip>
          <div className='flex items-center gap-2.5 shrink-0'>
            <TicketStatusWithStages
              currentStageName={ticket.stageName}
              showLeadingDot={false}
              labelClassName='max-w-[120px] truncate'
            />
            {conversationAssignee}
          </div>
        </button>
      </div>
    );
  }

  return (
    <button
      type='button'
      onClick={e => onClick?.(e)}
      data-testid={`ticket-card-${ticket.id}`}
      className={cn(
        width,
        `text-left ${releaseBoardBgColor} rounded-xl border w-full max-w-lg hover:shadow-sm transition-all cursor-pointer group shadow-sm relative container-type-inline overflow-hidden`,
        isCompact ? 'p-3' : 'p-0',
        isCompact && isEmailRead && 'email-read-card shadow-none',
      )}
      data-track-category='Tickets'
      data-track-name='OpenTicketCard'
      data-track-metadata={JSON.stringify({ ticketId: ticket.id, xyneId: ticket.xyneId })}
    >
      <div className={`flex ${!isCompact ? 'h-[145px]' : ''}`}>
        {!isCompact && (
          <div className='w-8 sm:w-10 rounded-l-xl flex items-center justify-center'>
            <div className='flex flex-col gap-4 items-center py-4'>
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className='w-3 h-3 rounded-full border border-input bg-muted' />
              ))}
            </div>
          </div>
        )}
        {!isCompact && <div className='ticket-card-accent-bar w-1.5 self-stretch' />}
        <div
          className={cn('flex flex-col gap-2 w-full min-w-0', isCompact ? 'p-0' : 'p-3 sm:p-4')}
          ref={contentRef}
        >
          {/* Header Section */}
          <div className='rounded-tr-xl'>
            <div className='flex items-center justify-between'>
              {/*Ticket ID */}
              <div className='flex flex-wrap items-center gap-2.5 flex-1 min-w-0'>
                <span className='text-xs font-medium text-muted-foreground font-mono'>
                  {ticket.xyneId}
                </span>
                {!isCompact && <TicketStatusWithStages currentStageName={ticket.stageName} />}
                {isCompact && (
                  <StagePicker
                    ticketId={ticket.id}
                    stageName={ticket.stageName}
                    stageLabel={ticket.stageName || 'To Do'}
                    boardId={ticket.boardId}
                  />
                )}
              </div>
              <div className={cn('flex items-center', isCompact ? 'gap-0' : 'gap-[15px]')}>
                {/*due date*/}
                <div className={cn(isCompact ? 'hidden' : 'hidden md:block')}>
                  {showDueDate &&
                    (hasDueDate ? (
                      <DueDateDisplay eta={ticket.eta} showBorder={false} />
                    ) : (
                      <Tooltip content='No due date'>
                        <div className='flex items-center gap-1.5 px-2 rounded-md py-1 border border-dashed border-input bg-muted'>
                          <Calendar className='w-3.5 h-3.5 text-muted-foreground' strokeWidth={2} />
                        </div>
                      </Tooltip>
                    ))}
                </div>

                {showPriority && (
                  <div
                    className={cn('relative group/priority', isCompact ? '' : 'hidden sm:block')}
                  >
                    {isEditingPriority && isCompact ? (
                      <button
                        onClick={e => e.stopPropagation()}
                        data-track-category='Tickets'
                        data-track-name='EditPriorityInline'
                      >
                        <EntitySelector
                          options={PriorityOptions}
                          selectedValue={ticket.priority || null}
                          onSelect={handlePriorityChange}
                          placeholder='Select priority'
                          searchPlaceholder='Search...'
                          variant='inline'
                          isOpen={true}
                          onOpenChange={open => !open && setIsEditingPriority(false)}
                        />
                      </button>
                    ) : (
                      <button
                        onClick={e => {
                          if (isCompact) {
                            e.stopPropagation();
                            setIsEditingPriority(true);
                          }
                        }}
                        className={cn(
                          'flex items-center',
                          isCompact && 'cursor-pointer hover:opacity-80 transition-opacity',
                        )}
                        data-track-category='Tickets'
                        data-track-name='OpenPriorityEditor'
                        data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                      >
                        <Tooltip content={` Priority: ${ticket.priority}`}>
                          <div className='flex items-center'>
                            {getPriorityIcon(ticket.priority)}
                          </div>
                        </Tooltip>
                      </button>
                    )}
                  </div>
                )}
                {/* Stage Overdue Badge */}
                {hasStageOverdue && (
                  <div className='flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 border border-red-200'>
                    <svg
                      width='12'
                      height='12'
                      viewBox='0 0 12 12'
                      fill='none'
                      className='text-red-600'
                    >
                      <circle cx='6' cy='6' r='5' stroke='currentColor' strokeWidth='1.5' />
                      <path
                        d='M6 3v3.5M6 8.5h.01'
                        stroke='currentColor'
                        strokeWidth='1.5'
                        strokeLinecap='round'
                      />
                    </svg>
                    <span className='text-[10px] font-medium text-red-600'>Stage Overdue</span>
                  </div>
                )}
                <div className='hidden sm:block'>
                  {!isCompact &&
                    showAssignee &&
                    (assignedUser ? (
                      <Tooltip content={getUserDisplayName(assignedUser)}>
                        <div className='relative group/assignee'>
                          <Avatar
                            userId={assignedUser.id}
                            showActiveStatus={false}
                            className='size-5 flex items-center justify-center'
                          />
                        </div>
                      </Tooltip>
                    ) : assignedGroup ? (
                      <div className='relative group/assignee'>
                        <Tooltip content={assignedGroup.name}>
                          <div className='w-6 h-6 rounded-lg bg-border flex items-center justify-center'>
                            <span className='text-xs font-medium text-muted-foreground'>
                              {assignedGroup.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        </Tooltip>
                      </div>
                    ) : (
                      <div className='relative group/assignee'>
                        <Tooltip content='Unassigned'>
                          <div className='w-6 h-6 rounded-lg border border-dashed border-muted-foreground bg-background flex items-center justify-center'>
                            <User className='w-3 h-3 text-muted-foreground' strokeWidth={1.5} />
                          </div>
                        </Tooltip>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>

          {/* Issue Description: header*/}
          <div className={`${releaseBoardBgColor} rounded-b-xl`}>
            {/* Title */}
            {ticket.title && (
              <TruncatedTooltip content={ticket.title}>
                <h3
                  data-testid='ticket-card-title'
                  className={cn(
                    'line-clamp-1 break-all mb-2',
                    isCompact
                      ? isEmailRead
                        ? 'font-normal text-sm'
                        : 'font-medium text-sm'
                      : 'font-semibold text-[15px]',
                    isCompact && isEmailRead ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {ticket.title}
                </h3>
              </TruncatedTooltip>
            )}

            {/* Description */}
            {!isCompact && (
              <div className='text-[13px] leading-[19px] relative'>
                <p
                  ref={descriptionRef}
                  className={cn(
                    'whitespace-pre-wrap overflow-hidden text-muted-foreground text-clip line-clamp-1 sm:line-clamp-2 break-all text-[13px]',
                  )}
                >
                  <RenderMessageWithHTML message={ticket.description || ''} breakLongLinks={true} />
                </p>
              </div>
            )}
            <div className='w-full pt-4 sm:pt-2 flex items-center justify-end flex-wrap gap-x-[15px]'>
              <div className='flex items-end gap-4 w-full justify-between'>
                <div className={cn('flex-wrap gap-2 items-center', isCompact ? 'flex' : 'hidden')}>
                  {/* Due Date or Placeholder */}
                  <div>
                    {showDueDate &&
                      (hasDueDate ? (
                        <DueDateDisplay eta={ticket.eta} />
                      ) : (
                        <Tooltip content='No due date'>
                          <div className='flex items-center gap-1.5 px-2 rounded-md py-1 border border-dashed border-input bg-muted'>
                            <Calendar
                              className='w-3.5 h-3.5 text-muted-foreground'
                              strokeWidth={2}
                            />
                          </div>
                        </Tooltip>
                      ))}
                  </div>
                  {/* SLA Response badge — only shown when the board has an active policy */}
                  {responseDueMs && (
                    <SlaResponseBadge
                      responseDueMs={responseDueMs}
                      firstRespondedAt={firstRespondedAt}
                      ticketCreatedAt={ticket.createdAt}
                      isTerminal={
                        ticket.statusV2 === TicketStatusV2.COMPLETED ||
                        ticket.statusV2 === TicketStatusV2.CANCELLED
                      }
                    />
                  )}
                  {/* Tags Section - Now Editable */}
                  {showTags &&
                    (isEditingTags ? (
                      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, local-rules/require-tracking-on-click
                      <div className='min-w-[200px]' onClick={e => e.stopPropagation()}>
                        <TagSelector
                          availableTags={availableTags}
                          selectedTags={selectedTagNames}
                          onTagsChange={handleTagsChange}
                          stopEditing={() => setIsEditingTags(false)}
                        />
                      </div>
                    ) : hasTags ? (
                      <>
                        {(showAllTags ? tags : tags.slice(0, 1)).map(tag => (
                          <button
                            key={tag.id}
                            type='button'
                            className='inline-flex max-w-[120px] items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border bg-card text-muted-foreground border-border cursor-pointer'
                            onClick={e => {
                              e.stopPropagation();
                              setIsEditingTags(true);
                            }}
                            data-track-category='Tickets'
                            data-track-name='EditTagsInline'
                            data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                          >
                            <span className='w-2 h-2 rounded-full bg-xyne-purple-400 shrink-0' />
                            <span className='truncate'>{tag.name}</span>
                          </button>
                        ))}

                        {!showAllTags && tags.length > 1 && (
                          <button
                            type='button'
                            onClick={e => {
                              e.stopPropagation();
                              setShowAllTags(true);
                            }}
                            className='inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border bg-card text-muted-foreground border-border cursor-pointer hover:border-input'
                            data-track-category='Tickets'
                            data-track-name='ExpandTicketTags'
                            data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                          >
                            +{tags.length - 1}
                          </button>
                        )}
                      </>
                    ) : isCompact ? (
                      <button
                        type='button'
                        onClick={e => {
                          e.stopPropagation();
                          setIsEditingTags(true);
                        }}
                        data-track-category='Tickets'
                        data-track-name='EditTagsInline'
                        data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                      >
                        <Tooltip content='Add labels'>
                          <div className='flex items-center gap-1.5 px-1.5 py-1 rounded-md border border-border bg-muted hover:border-input transition-colors'>
                            <Tag className='w-3.5 h-3.5 text-muted-foreground' strokeWidth={2} />
                          </div>
                        </Tooltip>
                      </button>
                    ) : null)}
                </div>
                {/* Priority - mobile */}
                {!isCompact && showPriority && (
                  <div className='relative group/priority sm:hidden'>
                    <Tooltip content={` Priority: ${ticket.priority}`}>
                      <div className='flex items-center'>{getPriorityIcon(ticket.priority)}</div>
                    </Tooltip>
                  </div>
                )}

                {/* Workflow and Assignee - bottom right */}
                <div className='flex items-center justify-end gap-[15px]'>
                  {showAssignee && (
                    <div className={cn('block', isCompact ? '' : 'md:hidden')}>
                      {renderAssignee()}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Metadata Subsections*/}
            {hasCompactMetadata && (
              <div className='mt-4 pt-4 border-border grid grid-cols-2 gap-4'>
                {/* Sub-status */}
                {showSubStatus && (
                  <div className='flex flex-col gap-0.5'>
                    <span className='text-xs text-muted-foreground'>Sub-status</span>
                    <div className='flex items-center gap-2'>
                      <TicketStatusWithStages
                        currentStageName={ticket.stageName}
                        showLeadingDot={false}
                        iconOnly
                      />

                      <span className='text-xs text-foreground truncate'>
                        {ticket.stageName || 'Not set'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Created at */}
                {showCreatedAt && (
                  <div className='flex flex-col gap-0.5'>
                    <span className='text-xs text-muted-foreground'>Created at</span>
                    <Tooltip
                      content={formatCreatedDateTime(ticket.createdAt) ?? 'Unknown'}
                      side='top'
                    >
                      <span className='text-xs text-foreground'>
                        {formatCreatedDate(ticket.createdAt)}
                      </span>
                    </Tooltip>
                  </div>
                )}

                {/* Created by */}
                {showCreatedBy && (
                  <div className='flex flex-col gap-1'>
                    <span className='text-xs text-muted-foreground'>Created by</span>
                    <div className='flex items-center gap-2'>
                      {creator && (
                        <>
                          <Avatar userId={creator.id} showActiveStatus={false} className='size-3' />
                          <TruncatedTooltip content={creator.name || creator.email || 'Unknown'}>
                            <span className='text-xs text-foreground truncate'>
                              {creator.name || creator.email || 'Unknown'}
                            </span>
                          </TruncatedTooltip>
                        </>
                      )}
                      {!creator && (
                        <span className='text-sm font-medium text-muted-foreground'>Unknown</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};
