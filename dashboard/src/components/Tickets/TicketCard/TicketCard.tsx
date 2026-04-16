import React, { useRef, useState } from 'react';
import { Calendar, User, Code2, Tag } from 'lucide-react';
import { BaseTicketType, isReleaseTicket, Ticket, TicketTag } from '@xyne/shared';
import { getPriorityIcon, formatEta, isEtaUrgent, isStageEtaOverdue } from './TicketCard.utils';
import { cn } from '../../../utils/classNames';
import { useUser, useUsers } from '../../../hooks/useUsers';
import { TicketStatusWithStages } from '../TicketStatus/TicketStatusIcon';
import Tooltip from '../../ui/Tooltip';
import { isElectronApp } from '../../../utils/electronApp';
import { OpenIDEModal } from '../OpenIDEModal';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { TagSelector } from '../TicketTable/TagSelector';
import Avatar from '../../ui/Avatar/Avatar';
import { useUserGroupById, useUserGroups } from '../../../hooks/useUserGroup';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import { PriorityOptions, useAssigneeOptions } from '../TicketTable/TicketTableHelper';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_VISIBLE_COLUMNS = new Set(['assignee', 'dueDate', 'priority', 'tags']);

const AssigneeEditor: React.FC<{
  selectedValue: string | null;
  onSelect: (value: string | null) => void;
  onOpenChange: (open: boolean) => void;
}> = ({ selectedValue, onSelect, onOpenChange }) => {
  const users = useUsers();
  const userGroups = useUserGroups();
  const assigneeOptions = useAssigneeOptions(users, userGroups || []);

  return (
    <EntitySelector
      options={assigneeOptions}
      selectedValue={selectedValue}
      onSelect={onSelect}
      placeholder='Select assignee'
      searchPlaceholder='Search...'
      variant='inline'
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
}) => {
  const zero = useZero();
  const contentRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const [showIDEModal, setShowIDEModal] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(false);
  // const navigate = useNavigate();

  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [isEditingAssignee, setIsEditingAssignee] = useState(false);

  const isStageOverdue = isStageEtaOverdue(ticket);
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

  const assigneeType = ticket.assignedTo?.startsWith('group:') ? 'group' : 'user';
  const assigneeId = ticket.assignedTo?.replace(/^(user:|group:)/, '') || '';
  const shouldResolveAssignee = showAssignee || !isCompact;
  const shouldResolveCreator = showCreatedBy;

  const creator = useUser(shouldResolveCreator ? ticket.createdBy || '' : '');
  const assignedUser = useUser(shouldResolveAssignee && assigneeType === 'user' ? assigneeId : '');
  const assignedGroup = useUserGroupById(
    shouldResolveAssignee && assigneeType === 'group' ? assigneeId : '',
  );

  const selectedTagNames = tags?.map(t => t.name) || [];

  // Check if any compact metadata should be shown
  const hasCompactMetadata = isCompact && (showSubStatus || showCreatedAt || showCreatedBy);

  // Check if ticket is from a release
  const releaseBoardBgColor =
    isReleaseTicket(ticket.ticketType as BaseTicketType) && isConversation ? 'bg-muted' : 'bg-card';

  const handleTagsChange = (newTags: string[]) => {
    const oldTagNames = tags?.map(t => t.name) || [];
    const toAdd = newTags.filter(t => !oldTagNames.includes(t));
    const toRemove = oldTagNames.filter(t => !newTags.includes(t));

    toAdd.forEach(tagName => {
      zero.mutate(mutators.ticketTag.create({ ticketId: ticket.id, tagId: uuidv4(), tagName }));
    });

    toRemove.forEach(tagName => {
      const tagId = tags?.find(t => t.name === tagName)?.id;
      if (tagId) {
        zero.mutate(mutators.ticketTag.delete({ tagId }));
      }
    });
  };

  const handleAssigneeChange = (value: string | null) => {
    zero.mutate(
      mutators.ticket.update({
        id: ticket.id,
        assignedTo: value || undefined,
        updatedAt: Date.now(),
      }),
    );
    setIsEditingAssignee(false);
  };

  const handlePriorityChange = (value: string | null) => {
    zero.mutate(
      mutators.ticket.update({
        id: ticket.id,
        priority: value as typeof ticket.priority,
        updatedAt: Date.now(),
      }),
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
            selectedValue={ticket.assignedTo || null}
            onSelect={handleAssigneeChange}
            onOpenChange={handleAssigneeEditorOpenChange}
          />
        </button>
      );
    }

    const assigneeDisplay = assignedUser ? (
      <Tooltip content={assignedUser.name || assignedUser.email || 'Unknown User'}>
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

  return (
    <button
      type='button'
      onClick={e => onClick?.(e)}
      data-testid={`ticket-card-${ticket.id}`}
      className={cn(
        width,
        `text-left ${releaseBoardBgColor} rounded-xl border w-full max-w-lg hover:shadow-sm transition-all cursor-pointer group shadow-sm relative container-type-inline overflow-hidden`,
        isCompact ? 'p-3' : 'p-0',
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
        {!isCompact && (
          <div className='bg-gradient-to-b from-xyne-purple-100 to-xyne-primary-100 w-1.5 self-stretch' />
        )}
        <div
          className={cn('flex flex-col gap-2 w-full', isCompact ? 'p-0' : 'p-3 sm:p-4')}
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
              </div>
              <div className={cn('flex items-center', isCompact ? 'gap-0' : 'gap-[15px]')}>
                {/* IDE Button (Electron only) */}
                {isElectronApp() && (
                  <div
                    className={cn('relative group/ide', isCompact ? 'hidden' : 'hidden sm:block')}
                  >
                    <Tooltip content='Open in VS Code'>
                      <button
                        type='button'
                        onClick={e => {
                          e.stopPropagation();
                          setShowIDEModal(true);
                        }}
                        className='flex items-center p-1 hover:bg-muted rounded transition-colors'
                        data-track-category='Tickets'
                        data-track-name='OpenTicketInIDE'
                        data-track-metadata={JSON.stringify({
                          ticketId: ticket.id,
                          xyneId: ticket.xyneId,
                        })}
                      >
                        <Code2 className='w-4 h-4 text-muted-foreground hover:text-blue-600' />
                      </button>
                    </Tooltip>
                  </div>
                )}
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
                {isStageOverdue && (
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
                      <Tooltip content={assignedUser.name || assignedUser.email || 'Unknown User'}>
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
              <h3
                data-testid='ticket-card-title'
                className={cn(
                  'text-foreground line-clamp-1 break-all mb-2',
                  isCompact ? 'font-medium text-sm' : 'font-semibold text-[15px]',
                )}
              >
                {ticket.title}
              </h3>
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
              <div className='flex items-center gap-4 w-full justify-between'>
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
                  {/* Tags Section - Now Editable */}
                  <button
                    className='flex items-center justify-between'
                    onClick={e => e.stopPropagation()}
                    data-track-category='Tickets'
                    data-track-name='EditTagsDropdown'
                  >
                    {showTags &&
                      (isEditingTags ? (
                        <div className='min-w-[200px]'>
                          <TagSelector
                            availableTags={availableTags}
                            selectedTags={selectedTagNames}
                            onTagsChange={handleTagsChange}
                            stopEditing={() => setIsEditingTags(false)}
                          />
                        </div>
                      ) : (
                        <button
                          className='flex items-center gap-2 flex-wrap cursor-pointer'
                          onClick={e => {
                            e.stopPropagation();
                            setIsEditingTags(true);
                          }}
                          data-track-category='Tickets'
                          data-track-name='EditTagsInline'
                          data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                        >
                          {hasTags ? (
                            <>
                              <span className='inline-flex max-w-[120px] items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border bg-card text-muted-foreground border-border'>
                                <span className='w-2 h-2 rounded-full bg-xyne-purple-400 shrink-0'></span>
                                <span className='truncate'>{tags[0]?.name}</span>
                              </span>

                              {tags.length > 1 && (
                                <span className='inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border bg-card text-muted-foreground border-border'>
                                  +{tags.length - 1}
                                </span>
                              )}
                            </>
                          ) : isCompact ? (
                            <Tooltip content='Add tags'>
                              <div className='flex items-center gap-1.5 px-1.5 py-1 rounded-md border border-border bg-muted hover:border-input transition-colors'>
                                <Tag
                                  className='w-3.5 h-3.5 text-muted-foreground'
                                  strokeWidth={2}
                                />
                              </div>
                            </Tooltip>
                          ) : null}
                        </button>
                      ))}
                  </button>
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
                    <span className='text-xs text-foreground'>
                      {formatCreatedDate(ticket.createdAt)}
                    </span>
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
                          <span className='text-xs text-foreground'>
                            {creator.name || creator.email || 'Unknown'}
                          </span>
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

      {/* IDE Modal */}
      {isElectronApp() && (
        <OpenIDEModal
          isOpen={showIDEModal}
          onClose={() => setShowIDEModal(false)}
          ticket={ticket}
        />
      )}
    </button>
  );
};
