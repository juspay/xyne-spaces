import React, { useState, useRef, useEffect } from 'react';
import { Headphones, ChatDefault } from '@xyne/icons';
import { HoverCard } from '../HoverCard/HoverCard';
import Avatar from '../Avatar/Avatar';
import { Button } from '../Button/Button';
import { UserHoverWrapperProps } from './types';
import { useAuth } from '../../../hooks/useAuth';
import { channelService } from '../../../services/Chat/channelService';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useUser } from '../../../hooks/useUsers';
import { useTypingState } from '../../../contexts/TypingStateContext';
import { isStatusExpired } from '../../../utils/statusUtils';
import { StatusIndicator } from '../StatusIndicator';
import { useCallActions } from '../../../hooks/useCallActions';
import { usePlatform } from '../../../hooks/usePlatform';
import { getUserDisplayName, isUserDeactivated } from '../../../utils/userDisplayName';
import { useRouteContext } from '../../../hooks/useRouteContext';

/**
 * UserHoverWrapper Component
 * Wraps any element to show user popover on hover with avatar and message button
 */
const UserHoverWrapperInner: React.FC<UserHoverWrapperProps> = ({
  userId,
  children,
  preserveThreadRoute = false,
}) => {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const { hasTyped } = useTypingState();
  const { isMobile } = usePlatform();
  const user = useUser(userId);
  const [dmChannelId, setDmChannelId] = useState<string | null>(null);
  const { baseRoute } = useRouteContext();
  const { channelId, conversationId } = useParams<{ channelId: string; conversationId?: string }>();
  const location = useLocation();
  const shouldTriggerCallRef = useRef(false);

  // Don't show hover card when user has typed (until they move cursor)
  const [isHoverOpen, setIsHoverOpen] = useState(false);

  // Close hover card on scroll
  useEffect(() => {
    if (!isHoverOpen) return;
    const handleScroll = (): void => setIsHoverOpen(false);
    window.addEventListener('scroll', handleScroll, true);
    return (): void => window.removeEventListener('scroll', handleScroll, true);
  }, [isHoverOpen]);

  // Check if user has a valid status
  const hasValidStatus =
    user?.statusEmoji && (!user?.statusExpiryAt || !isStatusExpired(user.statusExpiryAt));

  // Use useCallActions hook - channelId will be empty string initially, then update
  const { handleCallClick } = useCallActions({
    channelId: dmChannelId || '',
    targetUserIds: dmChannelId ? [userId] : undefined,
    callDisplayName: dmChannelId ? getUserDisplayName(user) || 'User' : undefined,
  });

  // Trigger call after channelId is set (if user clicked button before channel was created)
  useEffect(() => {
    if (dmChannelId && shouldTriggerCallRef.current) {
      shouldTriggerCallRef.current = false;
      handleCallClick();
    }
  }, [dmChannelId, handleCallClick]);

  const handleSendMessage = (): void => {
    if (!user || !currentUser?.id) {
      return;
    }
    if (user.id === currentUser.id) {
      return;
    }
    void channelService
      .createDm({ participantIds: [currentUser.id, user.id] })
      .then(response => {
        void navigate(`/chat/dir/${response.id}`);
      })
      .catch(() => {
        toast.error('Failed to create direct message channel.');
      });
  };

  const handleHuddleClick = (): void => {
    if (!user || !currentUser?.id || user.id === currentUser.id) {
      return;
    }

    // If we don't have a channelId yet, create/get it first, then trigger call
    if (!dmChannelId) {
      shouldTriggerCallRef.current = true;
      void channelService
        .createDm({ participantIds: [currentUser.id, user.id] })
        .then(dmResponse => {
          setDmChannelId(dmResponse.id);
        })
        .catch(() => {
          shouldTriggerCallRef.current = false;
          toast.error('Failed to start call.');
        });
      return;
    }

    // Use the hook's handleCallClick
    handleCallClick();
  };

  if (!user) {
    return <>{children}</>;
  }

  const isCurrentUser = user.id === currentUser?.id;

  const handleProfileClick = (): void => {
    if (channelId) {
      const isFocusThread = new URLSearchParams(location.search).get('focusThread') === '1';
      const threadSegment =
        (isFocusThread || preserveThreadRoute) && conversationId ? `/${conversationId}` : '';
      const focusThreadSearch = isFocusThread ? '?focusThread=1' : '';
      void navigate(
        `${baseRoute}/${channelId}${threadSegment}/profile/${userId}${focusThreadSearch}`,
      );
    }
  };

  // On mobile: navigate to profile on tap (skip popover)
  if (isMobile) {
    return (
      <span
        role='button'
        tabIndex={0}
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          handleProfileClick();
        }}
        data-track-category='MENTION'
        data-track-name='OPEN_USER_PROFILE_FROM_MENTION'
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleProfileClick();
          }
        }}
        className='cursor-pointer'
        style={{ display: 'inline' }}
      >
        {children}
      </span>
    );
  }

  return (
    <HoverCard
      trigger={
        <span
          role='button'
          tabIndex={0}
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            handleProfileClick();
          }}
          data-track-category='MENTION'
          data-track-name='OPEN_USER_PROFILE_FROM_MENTION'
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleProfileClick();
            }
          }}
          style={{ display: 'inline' }}
        >
          {children}
        </span>
      }
      side='top'
      align='start'
      avoidCollisions
      collisionPadding={12}
      openDelay={400}
      closeDelay={200}
      open={hasTyped ? false : isHoverOpen}
      onOpenChange={open => {
        // Only allow opening if user hasn't typed (or has moved cursor after typing)
        if (!hasTyped) {
          setIsHoverOpen(open);
        } else {
          setIsHoverOpen(false);
        }
      }}
      className='w-[min(380px,calc(100vw-24px))] bg-transparent p-0 border-0 shadow-none'
    >
      <div className='w-full rounded-lg border border-muted-foreground/20 bg-popover shadow-lg'>
        <div className='flex items-start gap-4 p-4'>
          <Avatar userId={user.id} size='xl' />
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2 mb-1'>
              <div
                className={`min-w-0 truncate font-semibold text-lg ${isUserDeactivated(user) ? 'text-muted-foreground' : 'text-foreground'}`}
              >
                {getUserDisplayName(user)}
              </div>
              {isUserDeactivated(user) && (
                <span className='inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground shrink-0'>
                  Deactivated
                </span>
              )}
            </div>
            {user.email && (
              <div className='text-sm text-muted-foreground truncate'>{user.email}</div>
            )}
            {hasValidStatus && (
              <div className='flex items-center gap-2 mt-2 text-sm text-foreground'>
                <StatusIndicator
                  statusEmoji={user.statusEmoji}
                  statusContent={user.statusContent}
                  statusExpiryAt={user.statusExpiryAt}
                  size='sm'
                  showOnHover={false}
                />
                <span>{user.statusContent}</span>
              </div>
            )}
          </div>
        </div>
        {!isCurrentUser && (
          <div className='flex items-center justify-end p-4 gap-3 border-t border-muted-foreground/20'>
            <Button
              variant='secondary'
              size='default'
              onClick={handleSendMessage}
              data-track-category='MENTION'
              data-track-name='SEND_MESSAGE_FROM_MENTION'
              className='flex items-center gap-2'
            >
              <ChatDefault className='size-4' />
              <span>Message</span>
            </Button>
            <Button
              variant='secondary'
              size='default'
              onClick={handleHuddleClick}
              data-track-category='MENTION'
              data-track-name='START_HUDDLE_FROM_MENTION'
              className='flex items-center gap-2'
            >
              <Headphones className='size-4' />
              <span>Huddle</span>
            </Button>
          </div>
        )}
      </div>
    </HoverCard>
  );
};

export const UserHoverWrapper: React.FC<UserHoverWrapperProps> = ({
  userId,
  children,
  preserveThreadRoute = false,
}) => {
  return (
    <UserHoverWrapperInner userId={userId} preserveThreadRoute={preserveThreadRoute}>
      {children}
    </UserHoverWrapperInner>
  );
};
