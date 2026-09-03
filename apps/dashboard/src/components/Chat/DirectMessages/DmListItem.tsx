import { ReactElement, ReactNode, KeyboardEvent, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type Channel,
  MessageType,
  isForwardedMessageXml,
  parseForwardedMessageXml,
  ChannelScopeType,
} from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import { isGroupDMChannel, parseDMParticipantIds } from '../ChatDirectory/ChatDirectory.utils';

import { cn } from '../../ui/Dialog';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { formatElapsedTime } from '../../../utils/dateUtils';
import { usePlatform } from '../../../hooks/usePlatform';
import { useUser } from '../../../hooks/useUsers';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { getInitialMessageFromConversation } from '../../../utils/conversationMessageHelpers';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { sanitizeHtmlString } from '../../../utils/sanitizer';
import { getFlowJsonPreviewText } from '../../../utils/flowPreview';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { getSlashCommandArtifactPreviewText } from '@xyne/shared';

interface DmListItemProps {
  channel: Channel;
  unreadCount?: number;
  isSelected?: boolean;
  latestConversation?: { initial_message_md?: string | null; workspaceId: string } | undefined;
}

const getSenderLabel = (isCurrentUser: boolean, isDM: boolean, senderName?: string): string => {
  if (isCurrentUser) return 'You';
  if (isDM) return '';
  return senderName?.split(' ')[0] ?? '';
};

export const DmListItem = ({
  channel,
  unreadCount = 0,
  isSelected = false,
  latestConversation,
}: DmListItemProps): ReactElement => {
  const navigate = useNavigate();
  const context = useAuthContextValues();

  // Use the provided latestConversation prop (from batched query in parent)
  // instead of making individual queries per DM channel
  const lastMessage = latestConversation
    ? getInitialMessageFromConversation(latestConversation)
    : undefined;

  const { displayName, avatarUserId } = useChannelDisplayName(channel, context.userID);

  // Get participant IDs for group DM avatars
  const participantIds = parseDMParticipantIds(channel);
  const otherParticipantIds = participantIds.filter(id => id !== context.userID);

  // Get user for status (only for 1-on-1 DMs)
  const isDM = channel.scopeType === ChannelScopeType.DM;
  const targetUser = useUser(isDM && avatarUserId ? avatarUserId : '');

  // Get the sender of the last message
  const lastMessageSender = useUser(lastMessage?.senderId ?? '');

  // Memoize HTML sanitization for message preview (Issue #1)
  const sanitizedHtml = useMemo(() => {
    if (!lastMessage) return '';

    // Handle forwarded messages - content is XML, need to parse it
    if (
      'msgType' in lastMessage &&
      lastMessage.msgType === MessageType.FORWARDED &&
      isForwardedMessageXml(lastMessage.content)
    ) {
      const parsed = parseForwardedMessageXml(lastMessage.content);
      if (parsed) {
        const text = parsed.optionalText || parsed.content;
        return sanitizeHtmlString(text || 'Forwarded a message');
      }
    }

    const rawContent =
      lastMessage.content ||
      ('attachments' in lastMessage && lastMessage.attachments?.length
        ? 'Sent an attachment'
        : 'Message');

    return sanitizeHtmlString(rawContent);
  }, [lastMessage]);

  // FlowJSON messages carry the whole interactive flow in their content. Feeding
  // that to RenderMessageWithHTML mounts the full flow card (title, textarea,
  // buttons) inside the one-line preview, breaking row layout. Collapse it to a
  // short plain-text summary instead.
  const flowPreviewText = useMemo(
    () => (lastMessage?.content ? getFlowJsonPreviewText(lastMessage.content) : null),
    [lastMessage?.content],
  );
  const slashCommandArtifactPreviewText = useMemo(
    () => (lastMessage?.content ? getSlashCommandArtifactPreviewText(lastMessage.content) : null),
    [lastMessage?.content],
  );

  // Memoize message preview with RenderMessageWithHTML component
  const messagePreview = useMemo(() => {
    if (!lastMessage) return 'No messages yet';

    const senderFirstName = getSenderLabel(
      lastMessage.senderId === context.userID,
      isDM,
      lastMessageSender ? getUserDisplayName(lastMessageSender) : undefined,
    );

    const prefix = senderFirstName ? `${senderFirstName}: ` : '';

    // Flow message: render the extracted plain-text summary, never the flow card.
    if (slashCommandArtifactPreviewText || flowPreviewText) {
      return (
        <>
          {prefix}
          <span data-message-preview='true'>
            {slashCommandArtifactPreviewText ?? flowPreviewText}
          </span>
        </>
      );
    }

    return (
      <>
        {prefix}
        <span data-message-preview='true'>
          <RenderMessageWithHTML message={sanitizedHtml} breakLongLinks={false} />
        </span>
      </>
    );
  }, [
    sanitizedHtml,
    slashCommandArtifactPreviewText,
    flowPreviewText,
    lastMessage,
    lastMessageSender,
    context.userID,
    isDM,
  ]);

  // 3. Format elapsed time (now, 5m, 2h, 3d, 1 month, 2 years, etc.)
  const formatTime = (timestamp?: number): string => {
    if (!timestamp) return '';
    return formatElapsedTime(timestamp);
  };

  // 4. Preview Content Logic - returns memoized message preview
  const renderMessagePreview = (): ReactNode => {
    return messagePreview;
  };

  const handleClick = (): void => {
    // Navigate to /chat/dm/:channelId for both mobile and desktop
    void navigate(`/chat/dm/${channel.id}?fromDM=true`);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  };

  const { isMobile } = usePlatform();

  if (isMobile) {
    return (
      <button
        className='w-full flex items-start gap-3 px-2 text-left text-select-none active:scale-[0.98] transition-all duration-200'
        onClick={handleClick}
        aria-label={`Open conversation with ${displayName}`}
        data-track-category='DM_LIST'
        data-track-name='OpenDMConversation'
        data-track-metadata={JSON.stringify({ channelId: channel.id, displayName })}
      >
        <DMItemAvatar
          userId={avatarUserId || null}
          scopeType={channel.scopeType}
          channel={channel}
          currentUserId={context.userID}
        />
        <div className='w-full flex-1 min-w-0 space-y-1'>
          <div className='w-full flex items-start justify-between gap-3 min-w-0'>
            <div className='flex items-center gap-1.5 min-w-0 flex-1'>
              <p className='text-[16px] tracking-[-0.32px] text-foreground font-medium min-w-0 truncate'>
                {displayName}
              </p>
              {isDM && (
                <StatusIndicator
                  statusEmoji={targetUser?.statusEmoji}
                  statusContent={targetUser?.statusContent}
                  statusExpiryAt={targetUser?.statusExpiryAt}
                  size='sm'
                  className='text-[14px]'
                />
              )}
            </div>
            <p
              className={cn(
                'shrink-0 text-[14px] tracking-[-0.28px] text-muted-foreground',
                unreadCount > 0 && !isSelected && 'text-primary',
              )}
            >
              {formatTime(lastMessage?.createdAt)}
            </p>
          </div>
          <div className='w-full flex items-start justify-between gap-3 min-w-0'>
            <div
              onClick={e => {
                // Prevent DM navigation when clicking links in preview
                if ((e.target as HTMLElement).tagName === 'A') {
                  e.stopPropagation();
                }
              }}
              onKeyDown={e => {
                // Prevent DM navigation when activating links via keyboard
                if (
                  (e.key === 'Enter' || e.key === ' ') &&
                  (e.target as HTMLElement).tagName === 'A'
                ) {
                  e.stopPropagation();
                }
              }}
              role='presentation'
              data-track-category='DM_LIST'
              data-track-name='PREVIEW_LINK_CONTAINER'
              className={cn(
                'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-normal leading-[1.35] text-muted-foreground',
                // Make RenderMessageWithHTML output inline and preserve link styles
                '[&_.message-html-root]:inline',
                '[&_.message-html-root_*]:inline',
                '[&_.message-html-root_pre]:!inline [&_.message-html-root_pre]:!whitespace-nowrap',
                '[&_.message-html-root_br]:hidden',
                '[&_.message-html-root_a]:!text-[var(--link-color)]',
                '[&_.message-html-root_a]:!no-underline',
                '[&_.message-html-root_a:hover]:!underline',
                '[&_.message-html-root_a:hover]:!text-[var(--link-hover-color)]',
                // Hide internal link semantic labels (icons, borders, etc.) in preview
                '[&_.message-html-root_span.group\\/internal-link]:contents',
                '[&_.message-html-root_.group\\/internal-link_a]:!border-0',
                '[&_.message-html-root_.group\\/internal-link_a]:!bg-transparent',
                '[&_.message-html-root_.group\\/internal-link_a]:!p-0',
                '[&_.message-html-root_.group\\/internal-link_a_.shrink-0]:!hidden',
                '[&_.message-html-root_.group\\/internal-link_button]:!hidden',
              )}
            >
              {renderMessagePreview()}
            </div>
            {unreadCount > 0 && !isSelected ? (
              <div className='font-["Geist_Mono"] text-[14px] font-semibold leading-[1.2] text-primary-foreground shrink-0 bg-primary flex flex-col items-center justify-center px-[6px] py-px rounded-[999px] h-[18px] min-w-[18px]'>
                {unreadCount}
              </div>
            ) : null}
          </div>
        </div>
      </button>
    );
  }

  const isUnread = unreadCount > 0;

  return (
    <div
      key={`dm-${channel.id}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group flex w-full font-normal items-center gap-3 px-3 py-2 text-left cursor-pointer transition-colors duration-150 h-auto rounded-[14px] border border-transparent',
        isUnread ? 'bg-activity-sidebar-primary' : 'bg-transparent',
        'hover:bg-sidebar-accent',
        isSelected && 'bg-sidebar-accent border-sidebar-border',
      )}
      role='button'
      tabIndex={0}
      aria-label={`Open conversation with ${displayName}`}
      data-track-category='DM'
      data-track-name='OPEN_DM_CONVERSATION'
      data-track-metadata={JSON.stringify({ channelId: channel.id, channelName: channel.name })}
    >
      <div className='relative flex-shrink-0'>
        {isGroupDMChannel(channel.scopeType) ? (
          <AvatarGroup userIds={otherParticipantIds} size='sm' isGroupDMAvatar className='size-9' />
        ) : (
          <Avatar
            userId={avatarUserId}
            size='rg'
            className='size-9 rounded-[9px]'
            showActiveStatus={channel.scopeType === ChannelScopeType.DM}
          />
        )}
      </div>

      <div className='flex flex-1 flex-col min-w-0 overflow-hidden'>
        <div className='flex w-full items-start justify-between gap-2'>
          <div
            className={cn(
              'flex items-center gap-1.5 min-w-0 flex-1 text-sm leading-snug',
              isUnread ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className='font-semibold truncate min-w-0'>{displayName}</span>
            {isDM && (
              <StatusIndicator
                statusEmoji={targetUser?.statusEmoji}
                statusContent={targetUser?.statusContent}
                statusExpiryAt={targetUser?.statusExpiryAt}
                size='sm'
                className='flex-shrink-0 text-[14px]'
              />
            )}
          </div>

          <span className='flex-shrink-0 flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground ml-auto sm:ml-2'>
            {lastMessage ? formatTime(lastMessage.createdAt) : null}
          </span>
        </div>

        <div className='mt-px flex w-full items-center gap-2'>
          <div
            onClick={e => {
              if ((e.target as HTMLElement).tagName === 'A') {
                e.stopPropagation();
              }
            }}
            onKeyDown={e => {
              if (
                (e.key === 'Enter' || e.key === ' ') &&
                (e.target as HTMLElement).tagName === 'A'
              ) {
                e.stopPropagation();
              }
            }}
            role='presentation'
            data-track-category='DM_LIST'
            data-track-name='PREVIEW_LINK_CONTAINER'
            className={cn(
              'w-full text-sm line-clamp-1 truncate break-normal whitespace-normal',
              isUnread ? 'text-foreground' : 'text-muted-foreground',
              // Make RenderMessageWithHTML output inline and preserve link styles
              '[&_.message-html-root]:inline',
              '[&_.message-html-root_*]:inline',
              '[&_.message-html-root_pre]:!inline [&_.message-html-root_pre]:!whitespace-nowrap',
              '[&_.message-html-root_br]:hidden',
              '[&_.message-html-root_a]:!text-[var(--link-color)]',
              '[&_.message-html-root_a]:!no-underline',
              '[&_.message-html-root_a:hover]:!underline',
              '[&_.message-html-root_a:hover]:!text-[var(--link-hover-color)]',
              // Hide internal link semantic labels (icons, borders, etc.) in preview
              '[&_.message-html-root_span.group\\/internal-link]:contents',
              '[&_.message-html-root_.group\\/internal-link_a]:!border-0',
              '[&_.message-html-root_.group\\/internal-link_a]:!bg-transparent',
              '[&_.message-html-root_.group\\/internal-link_a]:!p-0',
              '[&_.message-html-root_.group\\/internal-link_a_.shrink-0]:!hidden',
              '[&_.message-html-root_.group\\/internal-link_button]:!hidden',
            )}
          >
            {renderMessagePreview()}
          </div>
          {isUnread && (
            <span className='shrink-0 rounded-md bg-sidebar-primary px-1 text-[0.625rem] font-bold tabular-nums text-sidebar-primary-foreground'>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const DMItemAvatar = ({
  userId,
  scopeType,
  channel,
  currentUserId,
}: {
  userId: string | null;
  scopeType: ChannelScopeType;
  channel: Channel;
  currentUserId: string;
}): ReactElement => {
  // For group DMs, use the overlapping avatar style
  if (isGroupDMChannel(scopeType)) {
    const participantIds = parseDMParticipantIds(channel);
    const otherParticipantIds = participantIds.filter(id => id !== currentUserId);
    return (
      <div className='size-10 rounded-[8px] shrink-0 flex items-center justify-center overflow-visible'>
        <AvatarGroup userIds={otherParticipantIds} size='md' isGroupDMAvatar />
      </div>
    );
  }

  return (
    <div className='relative size-10 shrink-0 rounded-[8px] overflow-visible'>
      <Avatar
        userId={userId}
        size='lg'
        className='size-full rounded-[8px]'
        showActiveStatus={scopeType === ChannelScopeType.DM}
      />
    </div>
  );
};
