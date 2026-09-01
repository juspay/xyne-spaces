import { ReactElement, useState, useMemo } from 'react';
import {
  X,
  User,
  SmilePlus,
  ChevronDown,
  Check,
  Settings2,
  Bell,
  BellOff,
  Calendar,
} from 'lucide-react';
import { format } from 'date-fns';
import { DateTimePicker } from '../ui/DateTimePicker/DateTimePicker';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate, useParams } from 'react-router-dom';
import Avatar from '../ui/Avatar/Avatar';
import { StatusIndicator } from '../ui/StatusIndicator';
import { Button } from '../ui/Button/Button';
import { cn } from '../../utils/classNames';
import { ShortcutHint } from '../ui/ShortcutHint';
import { isStatusExpired } from '../../utils/statusUtils';
import { useChannelByName } from '../../hooks/useChannels';
import { useSelf } from '../../hooks/useUsers';
import { mutators } from '../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from '../../hooks/useZero';
import { Popover } from '../ui/Popover/Popover';
import { useUserPresence } from '../../hooks/usePresence';
import { usePath } from '../../hooks/usePath';

interface SettingsProps {
  onClose: () => void;
  onOpenPreferences: () => void;
  onOpenStatusModal: () => void;
  /**
   * Open the profile in a modal instead of navigating to the routed
   * `/chat/dir/.../profile/...` sidebar. Provided on surfaces where the routed
   * profile sidebar is not mounted (non-chat pages). When absent, or when the
   * user is already on a chat page, the routed navigation is used.
   */
  onOpenProfileModal?: (userId: string) => void;
}

const Settings = ({
  onClose,
  onOpenPreferences,
  onOpenStatusModal,
  onOpenProfileModal,
}: SettingsProps): ReactElement => {
  const { logout } = useAuth();
  const user = useSelf();
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const zero = useZero();

  const generalChannel = useChannelByName('general');
  const navigate = useNavigate();
  const { channelId } = useParams<{ channelId?: string }>();
  const path = usePath();

  const { status: livePresenceStatus, setStatus: setLivePresenceStatus } = useUserPresence(
    user?.id ?? '',
  );
  const [presencePopoverOpen, setPresencePopoverOpen] = useState(false);

  const handleLogout = (): void => {
    logout();
  };

  const hasValidStatus =
    user?.statusEmoji && (!user?.statusExpiryAt || !isStatusExpired(user.statusExpiryAt));

  const handleStatusClick = (): void => {
    onClose();
    onOpenStatusModal();
  };

  const handleClearStatus = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (user?.id) {
      zero.mutate(
        mutators.userPresence.upsert({
          statusEmoji: null,
          statusContent: null,
          statusExpiryAt: null,
          timestamp: Date.now(),
          presenceId: uuidv4(),
        }),
      );
    }
  };

  const notificationsPausedUntil = user?.notificationsPausedUntil;
  const isNotificationsPaused = useMemo(() => {
    return notificationsPausedUntil ? notificationsPausedUntil > Date.now() : false;
  }, [notificationsPausedUntil]);

  const pauseOptions = useMemo(
    () => [
      { label: '30 minutes', minutes: 30 },
      { label: '1 hour', minutes: 60 },
      { label: '4 hours', minutes: 240 },
      { label: 'Until tomorrow', minutes: 1440 },
      { label: 'Until next week', minutes: 10080 },
    ],
    [],
  );

  const handlePauseNotifications = (durationMinutes: number): void => {
    if (!user?.id) return;
    zero.mutate(
      mutators.userPresence.upsert({
        notificationsPausedUntil: Date.now() + durationMinutes * 60 * 1000,
        timestamp: Date.now(),
        presenceId: uuidv4(),
      }),
    );
  };

  const handlePauseNotificationsUntil = (untilDate: Date): void => {
    if (!user?.id) return;
    zero.mutate(
      mutators.userPresence.upsert({
        notificationsPausedUntil: untilDate.getTime(),
        timestamp: Date.now(),
        presenceId: uuidv4(),
      }),
    );
    setShowCustomDatePicker(false);
    setCustomDate(null);
  };

  const handleResumeNotifications = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    if (!user?.id) return;
    zero.mutate(
      mutators.userPresence.upsert({
        notificationsPausedUntil: null,
        timestamp: Date.now(),
        presenceId: uuidv4(),
      }),
    );
  };

  const handleProfileClick = (): void => {
    onClose();
    // On non-chat pages the routed profile sidebar is not mounted, so navigating
    // to `/chat/dir/.../profile/...` would bounce the user out of their current
    // page into chat. When a modal handler is available and we are not on a chat
    // page, open the profile in a modal and stay on the current page instead.
    const isChatPage = path.startsWith('/chat/');
    if (onOpenProfileModal && !isChatPage && user?.id) {
      onOpenProfileModal(user.id);
      return;
    }
    if (channelId) {
      void navigate(`/chat/dir/${channelId}/profile/${user?.id}`);
    } else {
      if (generalChannel) {
        void navigate(`/chat/dir/${generalChannel.id}/profile/${user?.id}`);
      }
    }
  };

  return (
    <div className='flex flex-col gap-4 min-w-[280px] max-w-[320px] w-full'>
      {/* User identity section */}
      <div className='flex items-start gap-3'>
        <div className='flex-shrink-0'>
          <Avatar userId={user?.id || ''} size='lg' showActiveStatus={false} />
        </div>
        <div className='flex-1 min-w-0 space-y-1'>
          <p className='text-sm font-medium text-foreground truncate'>{user?.name || 'User'}</p>

          <Popover
            trigger={
              <button className='flex items-center gap-1.5 hover:bg-muted px-1.5 py-0.5 -ml-1.5 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500'>
                {livePresenceStatus === 'ONLINE' ? (
                  <div className='w-2 h-2 rounded-full bg-green-500 ring-2 ring-background' />
                ) : (
                  <div className='w-2 h-2 rounded-full bg-muted-foreground/50 ring-2 ring-background'>
                    <div className='w-full h-full rounded-full bg-background/50' />
                  </div>
                )}
                <p className='text-xs text-muted-foreground'>
                  {livePresenceStatus !== 'AWAY' ? 'Active' : 'Away'}
                </p>
                <ChevronDown className='size-3 text-muted-foreground' />
              </button>
            }
            open={presencePopoverOpen}
            onOpenChange={setPresencePopoverOpen}
            align='start'
            className='w-40 p-1'
          >
            <div className='space-y-0.5'>
              <button
                onClick={() => {
                  setLivePresenceStatus('ONLINE');
                  setPresencePopoverOpen(false);
                }}
                className='w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left'
                data-track-category='Settings'
                data-track-name='SetPresenceOnline'
              >
                <div className='w-2 h-2 rounded-full bg-green-500' />
                <span>Active</span>
                {livePresenceStatus !== 'AWAY' && (
                  <Check className='size-3 ml-auto text-muted-foreground' />
                )}
              </button>
              <button
                onClick={() => {
                  setLivePresenceStatus('AWAY');
                  setPresencePopoverOpen(false);
                }}
                className='w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left'
                data-track-category='Settings'
                data-track-name='SetPresenceAway'
              >
                <div className='w-2 h-2 rounded-full border border-muted-foreground' />
                <span>Away</span>
                {livePresenceStatus === 'AWAY' && (
                  <Check className='size-3 ml-auto text-muted-foreground' />
                )}
              </button>
            </div>
          </Popover>
        </div>
      </div>

      {/* User Status Section */}
      <div className='mt-2 space-y-1'>
        <div
          className={cn(
            'px-2 py-1 rounded-lg border cursor-pointer hover:bg-border transition-colors w-full',
            hasValidStatus
              ? 'border-border bg-transparent hover:bg-muted'
              : 'border-border bg-muted',
          )}
          onClick={handleStatusClick}
          data-track-category='Settings'
          data-track-name='EditUserStatus'
          data-testid='set-status-btn'
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleStatusClick();
            }
          }}
          role='button'
          tabIndex={0}
          title={hasValidStatus ? 'Click to edit status' : 'Click to set status'}
        >
          {hasValidStatus ? (
            <div className='flex items-center justify-between gap-1 w-full'>
              <div className='flex items-center gap-2 min-w-0 flex-1'>
                <div className='flex-shrink-0'>
                  <StatusIndicator
                    statusEmoji={user?.statusEmoji}
                    statusContent={user?.statusContent}
                    statusExpiryAt={user?.statusExpiryAt}
                    size='lg'
                    showOnHover={false}
                  />
                </div>
                <div className='text-sm font-medium text-foreground truncate'>
                  {user?.statusContent}
                </div>
              </div>
              <Button
                variant='ghost'
                size='lg'
                onClick={handleClearStatus}
                className='flex-shrink-0 p-1 h-auto hover:bg-accent min-w-[20px]'
                title='Clear status'
                data-track-category='Settings'
                data-track-name='ClearUserStatus'
              >
                <X className='size-3 text-muted-foreground' />
              </Button>
            </div>
          ) : (
            <div className='flex items-center p-1 gap-2 text-muted-foreground'>
              <SmilePlus className='size-4 flex-shrink-0' />
              <span className='text-xs truncate'>Set a status</span>
              <ShortcutHint shortcut='global.setStatus' className='ml-auto text-xs' />
            </div>
          )}
        </div>
      </div>

      {/* Pause notifications */}
      <div className='space-y-1'>
        {isNotificationsPaused ? (
          <div className='space-y-1'>
            <div className='px-2 py-1 rounded-lg border border-border bg-transparent w-full flex items-center justify-between gap-2'>
              <div className='flex items-center gap-2 min-w-0 flex-1'>
                <BellOff className='size-4 flex-shrink-0 text-muted-foreground' />
                <span className='text-sm font-medium text-foreground truncate'>
                  Notifications paused
                </span>
              </div>
              <Button
                variant='ghost'
                size='lg'
                className='flex-shrink-0 p-1 h-auto hover:bg-accent min-w-[20px]'
                title='Resume notifications'
                onClick={handleResumeNotifications}
                data-track-category='Settings'
                data-track-name='ResumeNotifications'
              >
                <X className='size-3 text-muted-foreground' />
              </Button>
            </div>
            {notificationsPausedUntil && (
              <div className='text-xs text-muted-foreground px-2'>
                Until {format(new Date(notificationsPausedUntil), 'dd/MM/yyyy hh:mm a')}
              </div>
            )}
          </div>
        ) : (
          <Popover
            trigger={
              <button
                className='w-full px-2 py-1 rounded-lg border border-border bg-muted/50 hover:bg-secondary transition-colors flex items-center justify-between gap-2'
                data-track-category='Settings'
                data-track-name='OpenPauseNotificationsMenu'
              >
                <div className='flex items-center p-1 gap-2 text-muted-foreground'>
                  <Bell className='size-4 flex-shrink-0' />
                  <span className='text-xs truncate'>Pause notifications for: </span>
                </div>
                <ChevronDown className='size-4 text-muted-foreground' />
              </button>
            }
            align='start'
            className={cn('p-1', showCustomDatePicker ? 'w-auto' : 'w-44')}
            onOpenChange={open => {
              if (!open) {
                setShowCustomDatePicker(false);
                setCustomDate(null);
              }
            }}
          >
            {!showCustomDatePicker ? (
              <div className='space-y-0.5'>
                {pauseOptions.map(option => (
                  <button
                    key={option.minutes}
                    onClick={e => {
                      e.stopPropagation();
                      handlePauseNotifications(option.minutes);
                    }}
                    className='w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left'
                    data-track-category='Settings'
                    data-track-name='PauseNotifications'
                    data-track-metadata={JSON.stringify({ duration: option.minutes })}
                  >
                    <span>{option.label}</span>
                  </button>
                ))}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setShowCustomDatePicker(true);
                  }}
                  className='w-full flex items-center justify-between px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left'
                  data-track-category='Settings'
                  data-track-name='PauseNotificationsCustom'
                >
                  <span>Custom</span>
                  <Calendar className='size-4 text-muted-foreground' />
                </button>
              </div>
            ) : (
              <DateTimePicker
                value={customDate}
                onChange={setCustomDate}
                onConfirm={date => handlePauseNotificationsUntil(date)}
                inline
              />
            )}
          </Popover>
        )}
      </div>

      <hr className='border-border w-full' />

      {/* Navigation links */}
      <div className='space-y-1'>
        <Button
          type='button'
          variant='ghost'
          className='w-full text-left hover:bg-muted rounded-md justify-start gap-2'
          onClick={handleProfileClick}
          data-track-category='Settings'
          data-track-name='OpenProfile'
        >
          <User className='size-4' />
          Profile
        </Button>

        <Button
          type='button'
          variant='ghost'
          className='w-full text-left hover:bg-muted rounded-md justify-start gap-2'
          onClick={onOpenPreferences}
          data-track-category='Settings'
          data-track-name='OpenPreferences'
        >
          <Settings2 className='size-4' />
          Preferences
          <ShortcutHint shortcut='global.openPreferences' className='ml-auto' />
        </Button>
      </div>

      <hr className='border-border w-full' />

      <div className='space-y-2'>
        <Button
          type='button'
          variant='ghost'
          className='text-destructive w-full text-left hover:bg-transparent hover:text-destructive rounded-md'
          onClick={handleLogout}
          data-track-category='Settings'
          data-track-name='Logout'
        >
          Sign out of Xyne Space
        </Button>
      </div>
    </div>
  );
};

export default Settings;
