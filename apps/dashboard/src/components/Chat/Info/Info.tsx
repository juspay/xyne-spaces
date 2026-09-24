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
import { QueryResultType } from '@rocicorp/zero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { getTargetUserIdForCall } from '../ConversationHeader/ConversationHeader.utils';
import { isOneToOneDMChannel, isGroupDMChannel } from '../ChatDirectory/ChatDirectory.utils';
import Button from '../../ui/Button';
import * as Tabs from '@radix-ui/react-tabs';
import { cn } from '../../../utils/classNames';
import { useChannelBoards } from '../../../hooks/useChannelBoards';
import Input from '../../ui/Input';
import { Dialog } from '../../ui/Dialog/Dialog';
import { AddPeopleDialog } from '../AddPeopleForm/AddPeopleDialog';
import AboutChannel from '../AboutChannel/AboutChannel';
import ChannelSettings from '../ChannelInformation/ChannelSettings';
import { CallSummaryConfig } from '../CallSettings/CallSummaryConfig';
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
import { useLocation, useNavigate } from 'react-router-dom';
import HuddleIcon from '../../icons/HuddleIcon';
import { useCallActions } from '../../../hooks/useCallActions';
import Tooltip from '../../ui/Tooltip';
import { useCallConfirmation } from '../../../hooks/useCallConfirmation';
import { CallConfirmationModal } from '../../Call/CallConfirmationModal';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import { mutators } from '../../../zero/mutators';
import { useUser, useUsers } from '../../../hooks/useUsers';
import { usePlatform } from '../../../hooks/usePlatform';
import { v4 as uuidv4 } from 'uuid';
import { VisibleChannel } from '../../../machines/stateMachine';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { channelTrackingMetadata } from '../../../services/Analytics/channelTracking';

export type ChannelTab =
  | 'about'
  | 'members'
  | 'agents-apps'
  | 'notifications'
  | 'settings'
  | 'ai-features';

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
  useEffect(() => {
    setActiveTab(defaultTab === 'members' && isDM ? 'about' : defaultTab);
  }, [defaultTab, isDM]);
  const [showAddPeopleDialog, setShowAddPeopleDialog] = useState(false);
  const [showPromoteDialog, setShowPromoteDialog] = useState(false);

  const [participants] = useCachedQuery(queries.channelParticipants({ channelId: channel.id }));

  // Authoritative app/bot list for this channel — server-filtered by
  // users.userType so we don't depend on the workspace users map hydrating
  // with userType before the tab-label counts render.
  const [appParticipantsForCount] = useCachedQuery(
    queries.channelAppParticipants({ channelId: channel.id }),
  );

  const agentAppCount = appParticipantsForCount.length;
  const humanMemberCount = Math.max(0, participants.length - agentAppCount);

  const currentUserParticipant = useMemo(
    () => participants.find(p => p.userId === context.userID),
    [participants, context.userID],
  );

  const isParticipant = participants.some(p => p.userId === context.userID);
  const isSelfDM = isDM && participants.length === 1 && participants[0]?.userId === context.userID;
  const isDefaultChannel = channel.scopeType === ChannelScopeType.DEFAULT;
  const canManageAiPreferences =
    currentUserParticipant?.role === ChannelRole.ADMIN || channel.createdBy === context.userID;

  const addUserPolicy = channel.channelStats?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
  const showAddPeopleButton =
    isParticipant &&
    !isSelfDM &&
    (isDM ||
      channel.scopeType === ChannelScopeType.GROUP_DM ||
      currentUserParticipant?.role === ChannelRole.ADMIN ||
      addUserPolicy === ChannelAddUserPolicy.EVERYONE);

  const zero = useZero();
  const navigate = useNavigate();
  const location = useLocation();
  const channelUserStatus = useGetChannelUserStatus(channel.id);
  // Only drives the project-name label. Boards no longer come from here — see below.
  const [project] = useCachedQuery(queries.projectById({ projectId: channel.projectId ?? '' }));
  // channel_board_mappings is the only source of channel→board truth; there is no
  // project fallback, so an empty set means the channel genuinely has no boards.
  const { boards } = useChannelBoards(channel.id);

  // Get target user ID for 1:1 DM calls
  const targetUserId = useMemo(() => {
    const id = getTargetUserIdForCall(channel?.scopeType, channel?.name, context.userID);
    // For self-DMs (saved messages), fall back to current user
    if (!id && isDM) return context.userID;
    return id;
  }, [channel?.scopeType, channel?.name, context.userID, isDM]);

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

    // On Desk, stay on the current URL — the list body auto-flips to the
    // JoinChannel CTA once the leave mutation lands. Only Chat falls back
    // to the previous-channel / directory redirect.
    const onSupport = /^\/(?:[^/]+\/)?support(\/|$|\?)/.test(location.pathname);

    if (!onSupport) {
      const targetPath =
        previousChannelId && previousChannelId !== channel.id
          ? `/chat/dir/${previousChannelId}`
          : '/chat/dir';
      void navigate(targetPath, { replace: true });
    }

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

  // Pill-style tab trigger, matching the ConversationHeader channel tabs.
  const tabTriggerClass = (value: ChannelTab): string =>
    cn(
      'flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-medium tracking-[-0.28px] transition-colors duration-100 cursor-pointer whitespace-nowrap',
      activeTab === value
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
    );

  return (
    <div
      ref={popoverContainerRef}
      className='overflow-clip h-[720px] bg-background flex flex-col'
      style={{ position: 'relative' }}
    >
      <div className='w-full flex items-start justify-between gap-2 p-4 pb-6'>
        <div className='flex items-center gap-2 min-w-0'>
          <div className='w-11 h-11 rounded-[10px] border border-border bg-muted flex items-center justify-center shrink-0'>
            <ChannelIcon channel={channel} />
          </div>
          <div className='min-w-0'>
            <div className='text-[17px] font-medium text-foreground truncate'>
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
            channelUserStatus?.isStarred ? 'bg-muted !border-border' : '',
          ].join(' ')}
          data-track-category='CHAT_INFO'
          data-track-name='TOGGLE_STAR'
          data-track-metadata={JSON.stringify({
            isStarred: channelUserStatus?.isStarred,
            channelId: channel.id,
          })}
          data-ph-capture-attribute-track-id='toggle_channel_star'
        >
          {channelUserStatus?.isStarred ? (
            <LucideStar size={16} className='text-status-pending' fill='currentColor' />
          ) : (
            <LucideStar className='text-muted-foreground' size={16} />
          )}
          <div
            className={`${channelUserStatus?.isStarred ? 'text-status-pending' : 'text-muted-foreground'} text-[13px]`}
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
            <PhoneOff className='w-4 h-4 text-status-failure' />
          ) : hasActiveCallInChannel && !isUserInCurrentChannelCall ? (
            <HuddleIcon color='currentColor' />
          ) : (
            <HuddleIcon color='currentColor' />
          )}
          <div
            className={`${isUserInCurrentChannelCall ? 'text-status-failure' : 'text-muted-foreground'} text-[13px]`}
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
            data-track-metadata={JSON.stringify(channelTrackingMetadata(channel))}
            data-ph-capture-attribute-track-id='leave_channel'
          >
            <LucideLogOut size={16} className='text-destructive' />
            <div className='text-destructive text-[13px]'>Leave</div>
          </button>
        )}
      </div>
      <Tabs.Root
        value={activeTab}
        onValueChange={value => setActiveTab(value as ChannelTab)}
        className='flex-1 min-h-0 flex flex-col'
      >
        <Tabs.List className='flex items-center justify-start gap-0.5 px-4 py-2 shrink-0 overflow-x-auto no-scrollbar'>
          <Tabs.Trigger value='about' className={tabTriggerClass('about')}>
            About
          </Tabs.Trigger>
          {!isDM && (
            <Tabs.Trigger value='members' className={tabTriggerClass('members')}>
              Members {humanMemberCount}
            </Tabs.Trigger>
          )}
          {!isDM && (
            <Tabs.Trigger value='agents-apps' className={tabTriggerClass('agents-apps')}>
              Agents & Apps {agentAppCount}
            </Tabs.Trigger>
          )}
          {isParticipant && !isSelfDM && (isDM || isGroupDM || !!channelUserStatus) && (
            <Tabs.Trigger value='notifications' className={tabTriggerClass('notifications')}>
              Notifications
            </Tabs.Trigger>
          )}
          {isDefaultChannel && (
            <Tabs.Trigger value='settings' className={tabTriggerClass('settings')}>
              Settings
            </Tabs.Trigger>
          )}
          {isDefaultChannel && (
            <Tabs.Trigger value='ai-features' className={tabTriggerClass('ai-features')}>
              AI Preference
            </Tabs.Trigger>
          )}
        </Tabs.List>
        <Tabs.Content
          value='about'
          className='outline-none flex-1 min-h-0 rounded-b-lg overflow-hidden'
        >
          <AboutChannel
            channel={channel}
            {...(previousChannelId !== undefined && { previousChannelId })}
            isParticipant={isParticipant}
            userRole={currentUserParticipant?.role ?? null}
            {...(onClose && { onClose })}
            isDM={isDM}
            dmUserId={targetUserId}
          />
        </Tabs.Content>
        {!isDM && (
          <Tabs.Content
            value='members'
            className='outline-none flex-1 min-h-0 rounded-b-lg overflow-hidden'
          >
            <ChannelMembers
              channel={channel}
              channelDisplayName={channelDisplayName}
              popoverContainer={popoverContainerRef.current}
              filterMode='members'
              allParticipants={participants}
              appParticipants={appParticipantsForCount}
            />
          </Tabs.Content>
        )}
        {!isDM && (
          <Tabs.Content
            value='agents-apps'
            className='outline-none flex-1 min-h-0 rounded-b-lg overflow-hidden'
          >
            <ChannelMembers
              channel={channel}
              channelDisplayName={channelDisplayName}
              popoverContainer={popoverContainerRef.current}
              filterMode='agents-apps'
              allParticipants={participants}
              appParticipants={appParticipantsForCount}
            />
          </Tabs.Content>
        )}
        {isDefaultChannel && (
          <Tabs.Content value='settings' className='outline-none flex-1 min-h-0 overflow-y-auto'>
            <ChannelSettings
              channel={channel}
              isAdmin={currentUserParticipant?.role === ChannelRole.ADMIN}
              previousChannelId={previousChannelId}
              {...(onClose && { onClose })}
            />
          </Tabs.Content>
        )}
        {isDefaultChannel && (
          <Tabs.Content value='ai-features' className='outline-none flex-1 min-h-0 overflow-y-auto'>
            <div className='flex flex-col gap-3 p-4'>
              <div className='flex flex-col gap-0.5'>
                <div className='text-[15px] font-semibold text-foreground'>Call settings</div>
                <p className='text-[13px] leading-[140%] text-muted-foreground'>
                  Configure how AI handles calls in this channel.
                </p>
                <p className='text-[12px] leading-[140%] text-muted-foreground'>
                  Only channel admins or the owner can edit these preferences.
                </p>
              </div>
              <div className='rounded-[12px] border border-border bg-card'>
                <CallSummaryConfig
                  channelId={channel.id}
                  currentPrompt={channel.callSummaryPrompt}
                  canManage={canManageAiPreferences}
                />
              </div>
            </div>
          </Tabs.Content>
        )}
        {isParticipant && !isSelfDM && (isDM || isGroupDM || !!channelUserStatus) && (
          <Tabs.Content
            value='notifications'
            className='outline-none flex-1 min-h-0 overflow-y-auto'
          >
            <NotificationsTab channel={channel} isParticipant={isParticipant} />
          </Tabs.Content>
        )}
      </Tabs.Root>

      <AddPeopleDialog
        channelId={channel.id}
        open={showAddPeopleDialog}
        onOpenChange={open => (open ? setShowAddPeopleDialog(true) : handleAddPeopleCancel())}
      />

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
            <span className='text-sm truncate text-foreground'>{getUserDisplayName(user)}</span>
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
              className='p-1 border border-border rounded-lg shadow-lg overflow-hidden z-[100]'
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
                      data-ph-capture-attribute-track-id='remove_channel_admin'
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
                      data-ph-capture-attribute-track-id='make_channel_admin'
                    >
                      <LucideUser size={14} />
                      <span className='text-[14px] text-foreground'>Make admin</span>
                    </button>
                  ))}
                {canRemoveThisUser && (
                  <button
                    className={popoverStyle}
                    onClick={() =>
                      onRemove(participant.userId, getUserDisplayName(user) || 'this user')
                    }
                    data-track-category='CHAT_INFO'
                    data-track-name='RemoveParticipant'
                    data-track-metadata={JSON.stringify({ userId: participant.userId })}
                  >
                    <Trash size={14} className='text-destructive' />
                    <span className='text-[14px] text-destructive'>Remove</span>
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
  filterMode = 'members',
  allParticipants,
  appParticipants,
}: {
  channel: Channel;
  channelDisplayName: string;
  popoverContainer?: HTMLElement | null;
  filterMode?: 'members' | 'agents-apps';
  allParticipants: NonNullable<QueryResultType<typeof queries.channelParticipants>>;
  appParticipants: NonNullable<QueryResultType<typeof queries.channelAppParticipants>>;
}): ReactElement => {
  const context = useAuthContextValues();
  const zero = useZero();
  const [searchQuery, setSearchQuery] = useState('');
  const { isMobile } = usePlatform();
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [userToRemove, setUserToRemove] = useState<{ id: string; name: string } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The autoFocus attribute alone can lose to the dialog's focus management;
  // focus after paint so it lands last. Fires once per Members-tab activation
  // (tab contents remount on every switch).
  useEffect(() => {
    if (isMobile) return;

    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });

    return () => cancelAnimationFrame(rafId);
  }, [isMobile]);

  // Paginated humans-only list for the Members tab. Skipped for the Agents &
  // Apps tab (which reads directly from appParticipants) and while searching
  // (which filters the parent's already-loaded allParticipants).
  const [humanPage, setHumanPage] = useState<
    QueryResultType<typeof queries.channelHumanParticipantsPaginated>
  >([]);
  const [humanCursor, setHumanCursor] = useState<{ role: ChannelRole; userId: string } | null>(
    null,
  );
  const [humanHasMore, setHumanHasMore] = useState(true);

  const paginationEnabled = filterMode === 'members' && !searchQuery.trim();

  const [paginatedHumans] = useCachedQuery(
    queries.channelHumanParticipantsPaginated({
      channelId: channel.id,
      limit: PAGE_SIZE,
      start: humanCursor,
    }),
    { enabled: paginationEnabled },
  );

  useEffect(() => {
    if (!paginationEnabled) return;
    if (!paginatedHumans || paginatedHumans.length === 0) {
      if (humanCursor !== null) setHumanHasMore(false);
      return;
    }
    setHumanPage(prev => {
      if (humanCursor === null) return paginatedHumans;
      const combined = [...prev, ...paginatedHumans];
      return Array.from(
        combined
          .reduce(
            (map, item) => map.set(item.userId, item),
            new Map<string, (typeof combined)[number]>(),
          )
          .values(),
      );
    });
    setHumanHasMore(paginatedHumans.length >= PAGE_SIZE);
  }, [paginatedHumans, humanCursor, paginationEnabled]);

  const loadMoreHumans = useCallback(() => {
    if (!humanHasMore || humanPage.length === 0) return;
    const last = humanPage[humanPage.length - 1];
    if (!last) return;
    setHumanCursor({ role: last.role, userId: last.userId });
  }, [humanHasMore, humanPage]);

  const currentUserParticipant = useMemo(
    () => allParticipants.find(c => c.userId === context.userID),
    [allParticipants, context.userID],
  );

  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<
      string,
      { name: string; displayName?: string | null; email?: string | null }
    >();
    for (const u of allUsers) {
      map.set(u.id, { name: u.name, displayName: u.displayName, email: u.email });
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

  const isChannelCreator = channel.createdBy === context.userID;
  const currentUserIsAdmin = currentUserParticipant?.role === ChannelRole.ADMIN;

  const isAuthorizedToRemoveParticipant =
    channel.scopeType === ChannelScopeType.DEFAULT && currentUserIsAdmin;

  // Server-authoritative set of app/bot user IDs in this channel. Used to
  // bucket search results without depending on usersById.userType hydration.
  const appUserIdSet = useMemo(
    () => new Set(appParticipants.map(p => p.userId)),
    [appParticipants],
  );

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

    const trimmedQuery = searchQuery.trim();
    const queryLower = trimmedQuery.toLowerCase();

    // Members tab, idle: render the paginated page (server-filtered by
    // userType = USER).
    if (filterMode === 'members' && !trimmedQuery) {
      return humanPage;
    }

    // Everything else — Agents & Apps (any state) or Members search — filters
    // the parent's fully-loaded participant list client-side. The
    // server-filtered appUserIdSet buckets app-vs-human without depending on
    // usersById.userType being hydrated.
    return allParticipants
      .filter(p => {
        const isApp = appUserIdSet.has(p.userId);
        if (filterMode === 'agents-apps' ? !isApp : isApp) return false;
        if (!trimmedQuery) return true;
        const user = usersById.get(p.userId);
        if (!user) return false;
        const display = getUserDisplayName(user).toLowerCase();
        const rawName = (user.name ?? '').toLowerCase();
        return display.includes(queryLower) || rawName.includes(queryLower);
      })
      .sort((a, b) => {
        const displayA = getUserDisplayName(usersById.get(a.userId));
        const displayB = getUserDisplayName(usersById.get(b.userId));
        if (trimmedQuery) {
          const aStartsWith = nameStartsWith(displayA, searchQuery);
          const bStartsWith = nameStartsWith(displayB, searchQuery);
          if (aStartsWith && !bStartsWith) return -1;
          if (!aStartsWith && bStartsWith) return 1;
        }
        return displayA.localeCompare(displayB);
      });
  }, [allParticipants, appUserIdSet, filterMode, humanPage, searchQuery, usersById]);

  return (
    <div className='relative h-full min-h-0 flex flex-col'>
      <div className='shrink-0 z-10 p-4'>
        <div className='relative'>
          <Search className='text-muted-foreground absolute left-3 top-1/2 size-5 -translate-y-1/2 pointer-events-none' />
          <Input
            ref={searchInputRef}
            type='text'
            placeholder={filterMode === 'agents-apps' ? 'Find agents & apps' : 'Find members'}
            autoFocus={!isMobile}
            value={searchQuery}
            onChange={handleSearchChange}
            className='h-[52px] rounded-[12px] pl-10 pr-3 text-base md:text-base placeholder:text-muted-foreground text-foreground border border-border focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent'
          />
        </div>
      </div>
      <Virtuoso
        className='flex-1 min-h-0 thin-scrollbar'
        style={{ height: '100%' }}
        data={filteredParticipants}
        {...(paginationEnabled &&
          humanHasMore && {
            endReached: loadMoreHumans,
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
            Remove {getUserDisplayName(userToRemove)} from {channelDisplayName}?
          </h2>
          <p className='text-sm text-muted-foreground mb-6'>
            {channel.visibility === ChannelVisibility.PRIVATE
              ? 'This person will no longer have access to the channel and can only rejoin by invitation.'
              : 'This person will lose access to the channel but may rejoin later.'}
          </p>
          <div className='flex justify-end gap-3'>
            <Button
              variant='secondary'
              onClick={() => setRemoveDialogOpen(false)}
              data-track-category='CHAT_INFO'
              data-track-name='CANCEL_REMOVE_PARTICIPANT'
              className='px-6'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => userToRemove && handleRemoveParticipant(userToRemove.id)}
              data-track-category='CHAT_INFO'
              data-track-name='CONFIRM_REMOVE_PARTICIPANT'
              data-track-metadata={JSON.stringify({
                ...channelTrackingMetadata(channel),
                targetUserId: userToRemove?.id,
              })}
              className='px-6'
              trackId='remove_channel_participant'
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
