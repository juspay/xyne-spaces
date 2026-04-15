import React, { ReactElement, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { queries } from '../../../zero/queries';
import {
  ChannelVisibility,
  ChannelScopeType,
  ChannelRole,
  ChannelAddUserPolicy,
  Channel,
} from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { useQuery } from '../../../hooks/useQuery';
import { QueryResultType } from '@rocicorp/zero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { getTargetUserIdForCall } from '../ConversationHeader/ConversationHeader.utils';
import { isOneToOneDMChannel, isGroupDMChannel } from '../ChatDirectory/ChatDirectory.utils';
import Button from '../../ui/Button';
import * as Tabs from '@radix-ui/react-tabs';
import { cn } from '../../../utils/classNames';
import Input from '../../ui/Input';
import { Dialog } from '../../ui/Dialog/Dialog';
import { AddPeopleForm } from '../AddPeopleForm/AddPeopleForm';
import AboutChannel from '../AboutChannel/AboutChannel';
import ChannelSettings from '../ChannelInformation/ChannelSettings';
import NotificationsTab from '../AboutChannel/NotificationsTab';
import { AddChannelForm } from '../AddChannelForm/AddChannelForm';
import { PromoteGroupDmRequest } from '../../../services/Chat/channelService';
import { toast } from 'sonner';

import {
  Search,
  LucideKanbanSquare,
  LucideX,
  LucideStar,
  LucideUserPlus,
  LucideLogOut,
  LucideEllipsis,
  LucideUser,
  LucideUserMinus,
  Trash,
  PhoneOff,
  ArrowUpCircle,
} from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import ChannelIcon from '../ChannelIcon/ChannelIcon';
import { Virtuoso } from 'react-virtuoso';
import { isStatusExpired } from '../../../utils/statusUtils';
import { renderEmoji } from '../../../utils/customEmojiUtils';
import Popover from '../../ui/Popover';
import { useNavigate } from 'react-router-dom';
import HuddleIcon from '../../icons/HuddleIcon';
import { useCallActions } from '../../../hooks/useCallActions';
import Tooltip from '../../ui/Tooltip';
import { useCallConfirmation } from '../../../hooks/useCallConfirmation';
import { CallConfirmationModal } from '../../Call/CallConfirmationModal';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import { mutators } from '../../../zero/mutators';
import { useUser, useUsers } from '../../../hooks/useUsers';
import { v4 as uuidv4 } from 'uuid';
import { VisibleChannel } from '../../../machines/stateMachine';

export type ChannelTab = 'about' | 'members' | 'notifications' | 'settings';
interface InfoProps {
  channel: VisibleChannel;
  previousChannelId?: string | null;
  defaultTab?: ChannelTab;
  onClose?: () => void;
}

const Info = ({
  channel,
  previousChannelId,
  defaultTab = 'about',
  onClose,
}: InfoProps): ReactElement => {
  const context = useAuthContextValues();
  const isDM = isOneToOneDMChannel(channel.scopeType);
  const isGroupDM = isGroupDMChannel(channel.scopeType);
  const { displayName: channelDisplayName } = useChannelDisplayName(channel, context.userID);

  // If defaultTab is 'members' but it's a DM, use 'about' instead
  const initialTab = defaultTab === 'members' && isDM ? 'about' : defaultTab;
  const [activeTab, setActiveTab] = useState<ChannelTab>(initialTab);
  const [showAddPeopleDialog, setShowAddPeopleDialog] = useState(false);
  const [showPromoteDialog, setShowPromoteDialog] = useState(false);

  const [participants] = useCachedQuery(queries.channelParticipants({ channelId: channel.id }));

  const currentUserParticipant = useMemo(
    () => participants.find(p => p.userId === context.userID),
    [participants, context.userID],
  );

  const isParticipant = participants.some(p => p.userId === context.userID);
  const isDefaultChannel = channel.scopeType === ChannelScopeType.DEFAULT;

  const addUserPolicy = channel.channelStats?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
  const showAddPeopleButton =
    isParticipant &&
    !isDM &&
    (channel.scopeType === ChannelScopeType.GROUP_DM ||
      currentUserParticipant?.role === ChannelRole.ADMIN ||
      addUserPolicy === ChannelAddUserPolicy.EVERYONE);

  const zero = useZero();
  const navigate = useNavigate();
  const channelUserStatus = useGetChannelUserStatus(channel.id);
  const [project] = useCachedQuery(queries.projectById({ projectId: channel.projectId }));
  const [boards] = useCachedQuery(queries.boardsListByProject({ projectId: channel.projectId }));

  // Get target user ID for 1:1 DM calls
  const targetUserId = useMemo(
    () => getTargetUserIdForCall(channel?.scopeType, channel?.name, context.userID),
    [channel?.scopeType, channel?.name, context.userID],
  );

  const targetUser = useUser(targetUserId || '');

  const hasValidStatus = useMemo(() => {
    return (
      targetUser?.statusEmoji &&
      (!targetUser?.statusExpiryAt || !isStatusExpired(targetUser.statusExpiryAt))
    );
  }, [targetUser?.statusEmoji, targetUser?.statusExpiryAt]);

  const handleAddPeopleClick = (): void => {
    setShowAddPeopleDialog(true);
  };

  const handleAddPeopleSuccess = (): void => {
    setShowAddPeopleDialog(false);
    // Success - participants appear in the list automatically, no toast needed
  };

  const handleAddPeopleCancel = (): void => {
    setShowAddPeopleDialog(false);
  };

  const [isPromoting, setIsPromoting] = useState(false);

  const handlePromoteClick = (): void => {
    setShowPromoteDialog(true);
  };

  const handlePromoteSubmit = async (data: PromoteGroupDmRequest): Promise<void> => {
    setIsPromoting(true);
    try {
      const timestamp = Date.now();
      const conversationId = uuidv4();
      const messageId = uuidv4();
      const visibility =
        data.visibility === 'public' ? ChannelVisibility.PUBLIC : ChannelVisibility.PRIVATE;

      const mutation = zero.mutate(
        mutators.channel.promoteToChannel({
          channelId: channel.id,
          name: data.name,
          description: data.description,
          visibility,
          projectId: data.projectId,
          conversationId,
          messageId,
          timestamp,
        }),
      );

      const serverRes = await mutation.server;
      if (serverRes.type === 'error') {
        toast.error(serverRes.error.message || 'Failed to promote group DM to channel');
        return;
      }

      setShowPromoteDialog(false);
      toast.success('Group DM promoted to channel successfully');
      void navigate(`/chat/${channel.id}`);
    } catch {
      toast.error('Something went wrong while promoting the channel');
    } finally {
      setIsPromoting(false);
    }
  };

  const handlePromoteCancel = (): void => {
    setShowPromoteDialog(false);
  };

  const showPromoteButton = isGroupDM && isParticipant;

  const handleLeaveChannel = (): void => {
    onClose?.();

    // Decide where to go
    let targetPath = '/chat/dir';

    if (previousChannelId && previousChannelId !== channel.id) {
      targetPath = `/chat/dir/${previousChannelId}`;
    }

    // Navigate first
    void navigate(targetPath, { replace: true });

    // Then leave channel
    zero.mutate(mutators.channel.leaveChannel({ channelId: channel.id, updatedAt: Date.now() }));
  };

  const handleStarToggle = (): void => {
    void zero.mutate(
      mutators.channel.toggleStarred({ channelId: channel.id, updatedAt: Date.now() }),
    );
  };

  const { handleCallClick, hasActiveCallInChannel, isUserInCurrentChannelCall, isInCall } =
    useCallActions({
      channelId: channel.id,
      targetUserIds: targetUserId ? [targetUserId] : undefined,
      callDisplayName: channelDisplayName,
    });

  const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
    useCallConfirmation({
      scopeType: channel.scopeType,
      channelName: channelDisplayName,
      participantCount: channel.channelStats?.participantCount,
      hasActiveCallInChannel,
      isUserInCurrentChannelCall,
      isInCall,
    });

  const handleCallTrigger = (): void => {
    handleCallAction(handleCallClick);
  };

  const popoverContainerRef = useRef<HTMLDivElement>(null);

  const headerLinkContainerStyle =
    'flex items-center flex-col gap-y-2 border border-border p-[12px] min-w-[98px] rounded-[10px] cursor-pointer flex-1 text-muted-foreground';

  return (
    <div
      ref={popoverContainerRef}
      className='overflow-clip h-[600px] bg-background'
      style={{ position: 'relative' }}
    >
      <div className='w-full flex items-start justify-between gap-2 p-4 pb-6'>
        <div className='flex items-center gap-2'>
          <div className='w-11 h-11 rounded-[10px] border border-border bg-muted flex items-center justify-center'>
            <ChannelIcon channel={channel} />
          </div>
          <div>
            <div className='text-[17px] font-medium text-foreground visual-regression-hide'>
              {channelDisplayName}
            </div>
            {isDM && hasValidStatus && (
              <div className='flex items-center gap-1.5 mt-0.5'>
                <span className='text-sm leading-none flex items-center justify-center'>
                  {renderEmoji(targetUser?.statusEmoji || '')}
                </span>
                <span className='text-muted-foreground text-[13px] truncate'>
                  {targetUser?.statusContent}
                </span>
              </div>
            )}
            <div className='flex items-center gap-x-2'>
              <div className='flex items-center gap-1'>
                <LucideKanbanSquare className='text-muted-foreground' size={14} />
                <div className='text-muted-foreground text-[13px]'>{project?.name ?? 'NA'}</div>
              </div>
              <img src='/svgs/icons/dot.svg' alt='dot-icon' />
              <div className='flex items-center gap-1'>
                <div className='text-muted-foreground text-[13px]'>
                  {boards.length} {boards.length === 1 ? 'Board' : 'Boards'}
                </div>
              </div>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className='w-7 h-7 flex items-center justify-center border border-border rounded-[8px] cursor-pointer'
          data-track-category='CHAT_INFO'
          data-track-name='CLOSE_INFO'
          data-track-metadata={JSON.stringify({ channelId: channel.id })}
        >
          <LucideX className='text-muted-foreground' size={16} />
        </button>
      </div>

      {/* HeaderLinkItems */}
      <div className='flex justify-between px-4 mb-4 gap-x-3 overflow-x-auto no-scrollbar'>
        <button
          onClick={handleStarToggle}
          className={[
            headerLinkContainerStyle,
            channelUserStatus?.isStarred ? 'bg-[#FBEFD9] !border-[#FBEFD9]' : '',
          ].join(' ')}
          data-track-category='CHAT_INFO'
          data-track-name='TOGGLE_STAR'
          data-track-metadata={JSON.stringify({
            isStarred: channelUserStatus?.isStarred,
            channelId: channel.id,
          })}
        >
          {channelUserStatus?.isStarred ? (
            <LucideStar size={16} color='#FACC14' fill='#FACC14' />
          ) : (
            <LucideStar className='text-muted-foreground' size={16} />
          )}
          <div
            className={`${channelUserStatus?.isStarred ? 'text-[#FACC14]' : 'text-muted-foreground'} text-[13px]`}
          >
            Starred
          </div>
        </button>
        {showAddPeopleButton && (
          <button
            onClick={handleAddPeopleClick}
            className={headerLinkContainerStyle}
            data-testid='add-people-button'
            data-track-event='BUTTON_CLICK'
            data-track-category='CHAT_INFO'
            data-track-name='ADD_PEOPLE_TO_CHANNEL'
            data-track-metadata={JSON.stringify({
              channelId: channel.id,
              currentParticipantCount: participants.length,
            })}
          >
            <LucideUserPlus size={16} className='text-muted-foreground' />
            <div className='text-muted-foreground text-[13px]'>Add People</div>
          </button>
        )}
        <button
          onClick={handleCallTrigger}
          disabled={participants.length === 1}
          className={`${headerLinkContainerStyle} ${participants.length === 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
          data-track-category='CHAT_INFO'
          data-track-name='START_CALL'
          data-track-metadata={JSON.stringify({ channelId: channel.id })}
        >
          {isUserInCurrentChannelCall ? (
            <PhoneOff className='w-4 h-4 text-[#D14040]' />
          ) : hasActiveCallInChannel && !isUserInCurrentChannelCall ? (
            <HuddleIcon color='currentColor' />
          ) : (
            <HuddleIcon color='currentColor' />
          )}
          <div
            className={`${isUserInCurrentChannelCall ? 'text-[#D14040]' : 'text-muted-foreground'} text-[13px]`}
          >
            {isUserInCurrentChannelCall ? 'Leave' : 'Call'}
          </div>
        </button>
        {showPromoteButton && (
          <button
            onClick={handlePromoteClick}
            className={headerLinkContainerStyle}
            data-track-category='CHAT_INFO'
            data-track-name='PROMOTE_GROUP_DM'
            data-track-metadata={JSON.stringify({ channelId: channel.id })}
          >
            <ArrowUpCircle size={16} className='text-muted-foreground' />
            <div className='text-muted-foreground text-[13px]'>Promote</div>
          </button>
        )}
        {isParticipant && !isDM && !isGroupDM && (
          <button
            onClick={handleLeaveChannel}
            className={headerLinkContainerStyle}
            data-track-category='CHAT_INFO'
            data-track-name='LEAVE_CHANNEL'
            data-track-metadata={JSON.stringify({ channelId: channel.id })}
          >
            <LucideLogOut size={16} color='#D14040' />
            <div className='text-[#D14040] text-[13px]'>Leave</div>
          </button>
        )}
      </div>
      <Tabs.Root value={activeTab} onValueChange={value => setActiveTab(value as ChannelTab)}>
        <Tabs.List className='flex items-center justify-start border-b border-border px-4'>
          <Tabs.Trigger
            value='about'
            className={cn(
              'px-4 py-2 text-sm transition-all duration-100 border-b-2',
              activeTab === 'about'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            About
          </Tabs.Trigger>
          {!isDM && (
            <Tabs.Trigger
              value='members'
              className={cn(
                'px-4 py-2 flex items-center gap-2 text-sm transition-all duration-100 border-b-2',
                activeTab === 'members'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              Members {channel.channelStats?.participantCount || 0}
            </Tabs.Trigger>
          )}
          {isParticipant && (
            <Tabs.Trigger
              value='notifications'
              className={cn(
                'px-4 py-2 flex items-center gap-2 text-sm transition-all duration-100 border-b-2',
                activeTab === 'notifications'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              Notifications
            </Tabs.Trigger>
          )}
          {isDefaultChannel && (
            <Tabs.Trigger
              value='settings'
              className={cn(
                'px-4 py-2 text-sm transition-all duration-100 border-b-2',
                activeTab === 'settings'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              Settings
            </Tabs.Trigger>
          )}
        </Tabs.List>
        <Tabs.Content value='about' className='outline-none h-[480px] rounded-b-lg overflow-hidden'>
          <AboutChannel
            channel={channel}
            {...(previousChannelId !== undefined && { previousChannelId })}
            isParticipant={isParticipant}
            userRole={currentUserParticipant?.role ?? null}
            {...(onClose && { onClose })}
          />
        </Tabs.Content>
        {!isDM && (
          <Tabs.Content value='members' className='outline-none'>
            <ChannelMembers
              channel={channel}
              participants={participants}
              channelDisplayName={channelDisplayName}
              popoverContainer={popoverContainerRef.current}
            />
          </Tabs.Content>
        )}
        {isDefaultChannel && (
          <Tabs.Content value='settings' className='outline-none overflow-y-auto'>
            <ChannelSettings
              channel={channel}
              isAdmin={currentUserParticipant?.role === ChannelRole.ADMIN}
              previousChannelId={previousChannelId}
              {...(onClose && { onClose })}
            />
          </Tabs.Content>
        )}
        {isParticipant && (
          <Tabs.Content value='notifications' className='outline-none'>
            <NotificationsTab channel={channel} isParticipant={isParticipant} />
          </Tabs.Content>
        )}
      </Tabs.Root>

      <Dialog open={showAddPeopleDialog} onOpenChange={setShowAddPeopleDialog} title='Add Members'>
        <AddPeopleForm
          channelId={channel.id}
          onSuccess={handleAddPeopleSuccess}
          onCancel={handleAddPeopleCancel}
        />
      </Dialog>

      <Dialog open={showPromoteDialog} onOpenChange={setShowPromoteDialog}>
        <div className='p-4'>
          <AddChannelForm
            mode='promote'
            onSubmit={data => {
              void handlePromoteSubmit(data as PromoteGroupDmRequest);
            }}
            onCancel={handlePromoteCancel}
            loading={isPromoting}
          />
        </div>
      </Dialog>

      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeModal}
        onConfirm={() => handleConfirmCall(handleCallClick)}
        title={modalContent.title}
        subtitle={modalContent.subtitle}
        description={modalContent.description}
      />
    </div>
  );
};

interface ParticipantListItemProps {
  participant: NonNullable<QueryResultType<typeof queries.channelParticipants>>[number];
  channelCreatedBy: string;
  currentUserId: string;
  currentUserIsAdmin: boolean;
  isChannelCreator: boolean;
  isAuthorizedToRemoveParticipant: boolean;
  onRemove: (userId: string, userName: string) => void;
  onMakeAdmin: (userId: string) => void;
  onRemoveAdmin: (userId: string) => void;
  popoverContainer?: HTMLElement | null | undefined;
}

const ParticipantListItem = ({
  participant,
  channelCreatedBy,
  currentUserId,
  currentUserIsAdmin,
  isChannelCreator,
  isAuthorizedToRemoveParticipant,
  onRemove,
  onMakeAdmin,
  onRemoveAdmin,
  popoverContainer,
}: ParticipantListItemProps): ReactElement => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const user = useUser(participant.userId);
  const isAdmin = participant.role === ChannelRole.ADMIN;
  const isCreator = channelCreatedBy === participant.userId;
  const canManageThisUser =
    currentUserIsAdmin && currentUserId !== participant.userId && !(isCreator && !isChannelCreator);

  const canRemoveThisUser =
    isAuthorizedToRemoveParticipant &&
    currentUserId !== participant.userId &&
    channelCreatedBy !== participant.userId;

  const hasValidStatus =
    user?.statusEmoji && (!user?.statusExpiryAt || !isStatusExpired(user.statusExpiryAt));

  const popoverStyle = `w-full flex items-center gap-x-1 p-2 cursor-pointer hover:bg-accent rounded-md pr-6`;
  return (
    <div className='px-4 group'>
      <div className='flex items-center py-3 px-2 gap-3 transition-colors relative group-hover:bg-accent rounded-lg'>
        <Avatar userId={participant.userId} size='md' showActiveStatus={true} />
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2'>
            <span className='text-sm truncate text-foreground'>{user?.name}</span>
            {hasValidStatus && (
              <Tooltip
                content={`${user?.statusContent || 'Status'}`}
                side='top'
                sideOffset={8}
                delayDuration={500}
              >
                <span className='text-lg leading-none flex items-center justify-center'>
                  {renderEmoji(user?.statusEmoji || '')}
                </span>
              </Tooltip>
            )}
            {(isCreator || isAdmin) && (
              <span className='px-2 py-[0.8px] text-[13px] bg-muted text-muted-foreground rounded-full whitespace-nowrap'>
                Admin
              </span>
            )}
          </div>
          <div className='text-sm text-muted-foreground truncate text-muted-foreground'>
            {user?.email}
          </div>
        </div>

        <div
          className={cn(
            'flex items-center gap-1 transition-opacity',
            isPopoverOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {(canManageThisUser || canRemoveThisUser) && (
            <Popover
              open={isPopoverOpen}
              onOpenChange={setIsPopoverOpen}
              trigger={
                <div
                  className='w-[24px] h-[24px] rounded-[4px] flex items-center justify-center cursor-pointer'
                  style={{ pointerEvents: 'auto' }}
                >
                  <LucideEllipsis size={16} className='rotate-90' />
                </div>
              }
              side='bottom'
              sideOffset={8}
              align='end'
              {...(popoverContainer ? { container: popoverContainer } : {})}
              className='p-1 border border-border rounded-lg shadow-[0px_8px_24px_0px_rgba(43,45,47,0.08)] overflow-hidden z-[100]'
            >
              <div>
                {canManageThisUser &&
                  (isAdmin ? (
                    <button
                      className={popoverStyle}
                      onClick={() => onRemoveAdmin(participant.userId)}
                      data-track-category='CHAT_INFO'
                      data-track-name='REMOVE_ADMIN'
                      data-track-metadata={JSON.stringify({ userId: participant.userId })}
                    >
                      <LucideUserMinus size={14} />
                      <span className='text-[14px] text-foreground'>Remove admin</span>
                    </button>
                  ) : (
                    <button
                      className={popoverStyle}
                      onClick={() => onMakeAdmin(participant.userId)}
                      data-track-category='CHAT_INFO'
                      data-track-name='MAKE_ADMIN'
                      data-track-metadata={JSON.stringify({ userId: participant.userId })}
                    >
                      <LucideUser size={14} />
                      <span className='text-[14px] text-foreground'>Make admin</span>
                    </button>
                  ))}
                {canRemoveThisUser && (
                  <button
                    className={popoverStyle}
                    onClick={() => onRemove(participant.userId, user?.name || 'this user')}
                    data-track-category='ChatInfo'
                    data-track-name='RemoveParticipant'
                    data-track-metadata={JSON.stringify({ userId: participant.userId })}
                  >
                    <Trash size={14} color='#D14040' />
                    <span className='text-[14px] text-[#D14040]'>Remove</span>
                  </button>
                )}
              </div>
            </Popover>
          )}
        </div>
      </div>
    </div>
  );
};

const PAGE_SIZE = 30;

const ChannelMembers = ({
  channel,
  channelDisplayName,
  popoverContainer,
}: {
  channel: Channel;
  participants: NonNullable<QueryResultType<typeof queries.channelParticipants>>;
  channelDisplayName: string;
  popoverContainer?: HTMLElement | null;
}): ReactElement => {
  const context = useAuthContextValues();
  const zero = useZero();
  const [searchQuery, setSearchQuery] = useState('');
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [userToRemove, setUserToRemove] = useState<{ id: string; name: string } | null>(null);

  // Simplified pagination state
  const [accumulatedParticipants, setAccumulatedParticipants] = useState<
    QueryResultType<typeof queries.channelParticipantsPaginated>
  >([]);
  const [currentCursor, setCurrentCursor] = useState<{ role: ChannelRole; userId: string } | null>(
    null,
  );
  const [hasMore, setHasMore] = useState(true);

  // Query for paginated participants using useQuery hook
  const [participants] = useQuery(
    queries.channelParticipantsPaginated({
      channelId: channel.id,
      limit: PAGE_SIZE,
      start: currentCursor,
    }),
  );

  const [searchResults] = useCachedQuery(
    queries.searchChannelParticipants({ channelId: channel.id, searchQuery }),
    {
      enabled: !!searchQuery.trim(),
    },
  );

  const currentUserParticipant = useMemo(
    () =>
      accumulatedParticipants.find(c => c.userId === context.userID) ??
      participants.find(c => c.userId === context.userID),
    [accumulatedParticipants, participants, context.userID],
  );

  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, { name: string }>();
    for (const u of allUsers) {
      map.set(u.id, { name: u.name });
    }
    return map;
  }, [allUsers]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setSearchQuery(e.target.value);
  };

  const handleRemoveParticipant = (targetUserId: string): void => {
    zero.mutate(
      mutators.channel.removeParticipant({
        channelId: channel.id,
        targetUserId,
        updatedAt: Date.now(),
      }),
    );
    setRemoveDialogOpen(false);
    setUserToRemove(null);
  };

  const handleMakeAdmin = (targetUserId: string): void => {
    const conversationId = uuidv4();
    const messageId = uuidv4();
    const conversationParticipantId = uuidv4();

    zero.mutate(
      mutators.channel.updateParticipantRole({
        channelId: channel.id,
        targetUserId,
        newRole: ChannelRole.ADMIN,
        timestamp: Date.now(),
        conversationId,
        messageId,
        conversationParticipantId,
      }),
    );
  };

  const handleRemoveAdmin = (targetUserId: string): void => {
    const conversationId = uuidv4();
    const messageId = uuidv4();
    const conversationParticipantId = uuidv4();

    zero.mutate(
      mutators.channel.updateParticipantRole({
        channelId: channel.id,
        targetUserId,
        newRole: ChannelRole.MEMBER,
        timestamp: Date.now(),
        conversationId,
        messageId,
        conversationParticipantId,
      }),
    );
  };

  const openRemoveDialog = (userId: string, userName: string): void => {
    setUserToRemove({ id: userId, name: userName });
    setRemoveDialogOpen(true);
  };

  // Simplified useEffect - accumulate participants data
  useEffect(() => {
    if (!participants || participants.length === 0) {
      if (currentCursor !== null) {
        // We tried to load more but got no results
        setHasMore(false);
      }
      return;
    }

    setAccumulatedParticipants(prev => {
      // Initial load (no cursor set yet)
      if (currentCursor === null) {
        return participants;
      }

      // Loading more - append and deduplicate
      const combined = [...prev, ...participants];
      const unique = Array.from(
        combined
          .reduce(
            (map, item) => map.set(item.userId, item),
            new Map<string, QueryResultType<typeof queries.channelParticipantsPaginated>[number]>(),
          )
          .values(),
      );
      return unique;
    });

    // Update hasMore based on result size
    setHasMore(participants.length >= PAGE_SIZE);
  }, [participants, currentCursor]);

  // Simplified load more function
  const loadMore = useCallback(() => {
    if (!hasMore || accumulatedParticipants.length === 0) return;

    const lastParticipant = accumulatedParticipants[accumulatedParticipants.length - 1];
    if (!lastParticipant) return;

    setCurrentCursor({ role: lastParticipant.role, userId: lastParticipant.userId });
  }, [hasMore, accumulatedParticipants]);

  const isChannelCreator = channel.createdBy === context.userID;
  const currentUserIsAdmin = currentUserParticipant?.role === ChannelRole.ADMIN;

  const isAuthorizedToRemoveParticipant =
    channel.scopeType === ChannelScopeType.DEFAULT && currentUserIsAdmin;

  const filteredParticipants = useMemo(() => {
    // Helper to check if name starts with query (first or any word)
    const nameStartsWith = (name: string, query: string): boolean => {
      const nameLower = name.toLowerCase();
      const queryLower = query.toLowerCase();

      // Check if full name starts with query
      if (nameLower.startsWith(queryLower)) return true;

      // Check if any word in the name starts with query
      const words = nameLower.split(/\s+/);
      return words.some(word => word.startsWith(queryLower));
    };

    if (searchQuery.trim()) {
      // When searching, sort results so that users whose names start with the query appear first
      return [...searchResults].sort((a, b) => {
        const userA = usersById.get(a.userId);
        const userB = usersById.get(b.userId);
        const aStartsWith = userA ? nameStartsWith(userA.name, searchQuery) : false;
        const bStartsWith = userB ? nameStartsWith(userB.name, searchQuery) : false;

        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;

        const nameA = userA?.name || '';
        const nameB = userB?.name || '';
        return nameA.localeCompare(nameB);
      });
    }

    return accumulatedParticipants;
  }, [accumulatedParticipants, searchQuery, searchResults, usersById]);

  return (
    <div className='relative bg-background h-[328px] flex flex-col'>
      <div className='shrink-0 z-10 p-4'>
        <div className='relative'>
          <Search className='text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2 pointer-events-none' />
          <Input
            type='text'
            placeholder='Find members'
            value={searchQuery}
            onChange={handleSearchChange}
            className='placeholder:text-muted-foreground px-10 rounded-[8px] border border-border focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent'
          />
        </div>
      </div>
      <Virtuoso
        className='flex-1 min-h-0 pb-4'
        data={filteredParticipants}
        {...(!searchQuery &&
          hasMore && {
            endReached: loadMore,
          })}
        overscan={10}
        itemContent={(_, participant) => (
          <ParticipantListItem
            key={participant.id}
            participant={participant}
            channelCreatedBy={channel.createdBy}
            currentUserId={context.userID}
            currentUserIsAdmin={currentUserIsAdmin}
            isChannelCreator={isChannelCreator}
            isAuthorizedToRemoveParticipant={isAuthorizedToRemoveParticipant}
            onRemove={openRemoveDialog}
            onMakeAdmin={handleMakeAdmin}
            onRemoveAdmin={handleRemoveAdmin}
            popoverContainer={popoverContainer || document.body}
          />
        )}
      />

      {/* Remove Participant Confirmation Dialog */}
      <Dialog
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
        title='Remove participant'
        description='Confirm removal of participant from channel'
      >
        <div className='p-6'>
          <h2 className='text-xl font-semibold mb-4'>
            Remove {userToRemove?.name} from {channelDisplayName}?
          </h2>
          <p className='text-sm text-muted-foreground mb-6'>
            {channel.visibility === ChannelVisibility.PRIVATE
              ? 'This person will no longer have access to the channel and can only rejoin by invitation.'
              : 'This person will lose access to the channel but may rejoin later.'}
          </p>
          <div className='flex justify-end gap-3'>
            <Button variant='secondary' onClick={() => setRemoveDialogOpen(false)} className='px-6'>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => userToRemove && handleRemoveParticipant(userToRemove.id)}
              className='px-6'
            >
              Remove
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default Info;
