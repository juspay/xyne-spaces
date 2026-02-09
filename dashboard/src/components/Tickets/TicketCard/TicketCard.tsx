import React, { useMemo, useRef, useState } from 'react';
import { Calendar, User, Code2, Tag } from 'lucide-react';
import { Ticket, TicketTag } from '@xyne/shared';
import { getPriorityIcon, formatEta, isEtaUrgent } from './TicketCard.utils';
import { cn } from '../../../utils/classNames';
import { useUser, useUsers } from '../../../hooks/useUsers';
import { TicketStatusWithStages } from '../TicketStatus/TicketStatusIcon';
import Tooltip from '../../ui/Tooltip';
import { isElectronApp } from '../../../utils/electronApp';
import { OpenIDEModal } from '../OpenIDEModal';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useZero } from '@rocicorp/zero/react';
import { mutators } from '../../../zero/mutators';
import { TagSelector } from '../TicketTable/TagSelector';
import Avatar from '../../ui/Avatar/Avatar';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import { getAssigneeOptions, PriorityOptions } from '../TicketTable/TicketTableHelper';
import { v4 as uuidv4 } from 'uuid';

interface TicketCardProps {
  ticket: Ticket;
  tags?: TicketTag[];
  availableTags?: string[];
  onClick?: () => void;
  width?: string;
  isCompact?: boolean;
  visibleColumns?: Set<string> | undefined;
}

export const TicketCard: React.FC<TicketCardProps> = ({
  ticket,
  onClick,
  width = 'w-full',
  tags,
  availableTags = [],
  isCompact = false,
  visibleColumns = new Set(['assignee', 'dueDate', 'priority', 'tags']),
}) => {
  const zero = useZero();
  const contentRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const [showIDEModal, setShowIDEModal] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(false);
  // const navigate = useNavigate();

  // Get creator information
  const creator = useUser(ticket.createdBy || '');

  const assigneeType = ticket.assignedTo?.startsWith('group:') ? 'group' : 'user';
  const assigneeId = ticket.assignedTo?.replace(/^(user:|group:)/, '') || '';

  const assignedUser = useUser(assigneeId && assigneeType === 'user' ? assigneeId : '');

  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [isEditingAssignee, setIsEditingAssignee] = useState(false);

  const userGroups = useUserGroups();
  const assignedGroup = userGroups.find(
    group => group.id === assigneeId && assigneeType === 'group',
  );

  const hasDueDate = !!ticket.eta;
  const hasTags = tags && tags.length > 0;

  const users = useUsers();
  const assigneeOptions = useMemo(() => {
    return getAssigneeOptions(users, userGroups || []);
  }, [users, userGroups]);

  // functions to check visibility
  const isVisible = (column: string) => visibleColumns.has(column);
  const showAssignee = isVisible('assignee');
  const showDueDate = isVisible('dueDate');
  const showSubStatus = isVisible('stage');
  const showPriority = isVisible('priority');
  const showTags = isVisible('tags');
  const showCreatedAt = isVisible('createdAt');
  const showCreatedBy = isVisible('createdBy');

  // Handle tag changes
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
        <button onClick={e => e.stopPropagation()}>
          <EntitySelector
            options={assigneeOptions}
            selectedValue={ticket.assignedTo || null}
            onSelect={handleAssigneeChange}
            placeholder='Select assignee'
            searchPlaceholder='Search...'
            variant='inline'
            isOpen={true}
            onOpenChange={open => !open && setIsEditingAssignee(false)}
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
          <div className='w-6 h-6 rounded-lg bg-gray-200 flex items-center justify-center'>
            <span className='text-xs font-medium text-gray-600'>
              {assignedGroup.name.charAt(0).toUpperCase()}
            </span>
          </div>
        </Tooltip>
      </div>
    ) : (
      <div className='relative group/assignee'>
        <Tooltip content='Unassigned'>
          <div className='w-6 h-6 rounded-lg border border-dashed border-gray-400 bg-white flex items-center justify-center'>
            <User className='w-3 h-3 text-gray-400' strokeWidth={1.5} />
          </div>
        </Tooltip>
      </div>
    );

    if (isCompact) {
      return (
        <button
          onClick={e => {
            e.stopPropagation();
            setIsEditingAssignee(true);
          }}
          className='cursor-pointer hover:opacity-80 transition-opacity'
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
              'flex items-center gap-1.5 px-2 rounded-md py-1 bg-gray-50',
              showBorder ? 'border border-dashed border-gray-300' : '',
              className,
            )}
          >
            <Calendar className='w-3.5 h-3.5 text-gray-400' strokeWidth={2} />
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
          className={cn('w-3.5 h-3.5 text-[#838383]', isUrgent && 'text-red-500')}
          strokeWidth={2}
        />
        <span className={cn('text-xs font-medium text-[#838383]', isUrgent && 'text-red-500')}>
          {etaText}
        </span>
      </div>
    );
  };

  const selectedTagNames = tags?.map(t => t.name) || [];

  // Check if any compact metadata should be shown
  const hasCompactMetadata = isCompact && (showSubStatus || showCreatedAt || showCreatedBy);

  return (
    <button
      type='button'
      onClick={onClick}
      data-testid={`ticket-card-${ticket.id}`}
      className={cn(
        width,
        'text-left bg-[#FDFDFD] rounded-xl border w-full max-w-lg hover:shadow-sm transition-all cursor-pointer group shadow-sm relative container-type-inline overflow-hidden',
        isCompact ? 'p-3' : 'p-0',
      )}
    >
      <div className={`flex ${!isCompact ? 'h-[145px]' : ''}`}>
        {!isCompact && (
          <div className='w-8 sm:w-10 rounded-l-xl flex items-center justify-center'>
            <div className='flex flex-col gap-4 items-center py-4'>
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className='w-3 h-3 rounded-full border border-gray-300 bg-[#f3f3f3]'
                />
              ))}
            </div>
          </div>
        )}
        {!isCompact && (
          <div className='bg-gradient-to-b from-[#F0E7EC] to-[#D7E7FC] w-1.5 self-stretch' />
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
                <span className='text-xs font-medium text-[#99A0AE] font-mono'>
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
                        className='flex items-center p-1 hover:bg-gray-100 rounded transition-colors'
                      >
                        <Code2 className='w-4 h-4 text-gray-500 hover:text-blue-600' />
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
                        <div className='flex items-center gap-1.5 px-2 rounded-md py-1 border border-dashed border-gray-300 bg-gray-50'>
                          <Calendar className='w-3.5 h-3.5 text-gray-400' strokeWidth={2} />
                        </div>
                      </Tooltip>
                    ))}
                </div>

                {showPriority && (
                  <div
                    className={cn('relative group/priority', isCompact ? '' : 'hidden sm:block')}
                  >
                    {isEditingPriority && isCompact ? (
                      <button onClick={e => e.stopPropagation()}>
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
                <div className='hidden sm:block'>
                  {!isCompact &&
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
                          <div className='w-6 h-6 rounded-lg bg-gray-200 flex items-center justify-center'>
                            <span className='text-xs font-medium text-gray-600'>
                              {assignedGroup.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        </Tooltip>
                      </div>
                    ) : (
                      <div className='relative group/assignee'>
                        <Tooltip content='Unassigned'>
                          <div className='w-6 h-6 rounded-lg border border-dashed border-gray-400 bg-white flex items-center justify-center'>
                            <User className='w-3 h-3 text-gray-400' strokeWidth={1.5} />
                          </div>
                        </Tooltip>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>

          {/* Issue Description: header*/}
          <div className='bg-[#FDFDFD] rounded-b-xl'>
            {/* Title */}
            {ticket.title && (
              <h3
                data-testid='ticket-card-title'
                className={cn(
                  'text-[#202020] line-clamp-1 break-all mb-2',
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
                    'whitespace-pre-wrap overflow-hidden text-[#5D646C] text-clip line-clamp-1 sm:line-clamp-2 break-all text-[13px]',
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
                          <div className='flex items-center gap-1.5 px-2 rounded-md py-1 border border-dashed border-gray-300 bg-gray-50'>
                            <Calendar className='w-3.5 h-3.5 text-gray-400' strokeWidth={2} />
                          </div>
                        </Tooltip>
                      ))}
                  </div>
                  {/* Tags Section - Now Editable */}
                  <button
                    className='flex items-center justify-between'
                    onClick={e => e.stopPropagation()}
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
                        >
                          {hasTags ? (
                            <>
                              <span className='inline-flex max-w-[120px] items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border bg-[#FCFCFD] text-[#6B7280] border-[#F0F0F0]'>
                                <span className='w-2 h-2 rounded-full bg-[#C27AFF] shrink-0'></span>
                                <span className='truncate'>{tags[0]?.name}</span>
                              </span>

                              {tags.length > 1 && (
                                <span className='inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border bg-[#FCFCFD] text-[#6B7280] border-[#F0F0F0]'>
                                  +{tags.length - 1}
                                </span>
                              )}
                            </>
                          ) : isCompact ? (
                            <Tooltip content='Add tags'>
                              <div className='flex items-center gap-1.5 px-1.5 py-1 rounded-md border border-gray-200 bg-gray-50 hover:border-gray-300 transition-colors'>
                                <Tag className='w-3.5 h-3.5 text-gray-400' strokeWidth={2} />
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
              <div className='mt-4 pt-4 border-gray-100 grid grid-cols-2 gap-4'>
                {/* Sub-status */}
                {showSubStatus && (
                  <div className='flex flex-col gap-0.5'>
                    <span className='text-xs text-[#8D8D8D]'>Sub-status</span>
                    <div className='flex items-center gap-2'>
                      <TicketStatusWithStages
                        currentStageName={ticket.stageName}
                        showLeadingDot={false}
                        iconOnly
                      />

                      <span className='text-xs text-[#202020] truncate'>
                        {ticket.stageName || 'Not set'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Created at */}
                {showCreatedAt && (
                  <div className='flex flex-col gap-0.5'>
                    <span className='text-xs text-[#8D8D8D]'>Created at</span>
                    <span className='text-xs text-[#202020]'>
                      {formatCreatedDate(ticket.createdAt)}
                    </span>
                  </div>
                )}

                {/* Created by */}
                {showCreatedBy && (
                  <div className='flex flex-col gap-1'>
                    <span className='text-xs text-[#8D8D8D]'>Created by</span>
                    <div className='flex items-center gap-2'>
                      {creator && (
                        <>
                          <Avatar userId={creator.id} showActiveStatus={false} className='size-3' />
                          <span className='text-xs text-[#202020]'>
                            {creator.name || creator.email || 'Unknown'}
                          </span>
                        </>
                      )}
                      {!creator && (
                        <span className='text-sm font-medium text-gray-400'>Unknown</span>
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
