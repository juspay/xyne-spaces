import { ReactElement, useState, useRef, useEffect, useMemo } from 'react';
import {
  X,
  SmilePlus,
  User,
  Settings2,
  ChevronDown,
  Check,
  Bell,
  BellOff,
  Calendar,
  Camera,
} from 'lucide-react';
import { format } from 'date-fns';
import { DateTimePicker } from '../../ui/DateTimePicker/DateTimePicker';
import { Popover } from '../../ui/Popover/Popover';
import { useQueryClient } from '@tanstack/react-query';
import { uploadProfilePicture } from '../../../services/userProfile/userProfileService';
import { useZero } from '../../../hooks/useZero';
import { useAuth } from '../../../hooks/useAuth';
import { useNavigate, useParams } from 'react-router-dom';
import { useChannelByName } from '../../../hooks/useChannels';
import Avatar from '../../ui/Avatar/Avatar';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';
import { isStatusExpired, formatExpiryTime } from '../../../utils/statusUtils';
import { useSelf } from '../../../hooks/useUsers';
import { mutators } from '../../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { useUserPresence } from '../../../hooks/usePresence';
import { SelectedStatusData } from './SetStatusView';

type ViewType = 'default' | 'status-suggestions' | 'status-edit';

const ProfileView = ({
  setView,
  onClose,
  onOpenPreferences,
}: {
  setView: (view: ViewType, data?: SelectedStatusData) => void;
  onClose?: () => void;
  onOpenPreferences?: () => void;
}): ReactElement => {
  const { logout } = useAuth();
  const user = useSelf();
  const queryClient = useQueryClient();
  const [isPresenceDropdownOpen, setIsPresenceDropdownOpen] = useState(false);
  const presenceDropdownRef = useRef<HTMLDivElement>(null);
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [isUploadingPicture, setIsUploadingPicture] = useState(false);
  const pictureInputRef = useRef<HTMLInputElement>(null);

  const handlePictureClick = (): void => {
    if (!isUploadingPicture) {
      pictureInputRef.current?.click();
    }
  };

  const handlePictureChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingPicture(true);
    try {
      await uploadProfilePicture(file);
      void queryClient.invalidateQueries({
        queryKey: ['user', user?.id],
        exact: false,
      });
    } catch {
      // Error is already handled by toast in the service
    } finally {
      setIsUploadingPicture(false);
      if (pictureInputRef.current) {
        pictureInputRef.current.value = '';
      }
    }
  };
  const zero = useZero();
  const navigate = useNavigate();
  const { channelId } = useParams<{ channelId?: string }>();
  const generalChannel = useChannelByName('general');

  // Handle click outside to close presence dropdown
  useEffect(() => {
    if (!isPresenceDropdownOpen) {
      return undefined;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        presenceDropdownRef.current &&
        !presenceDropdownRef.current.contains(event.target as Node)
      ) {
        setIsPresenceDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPresenceDropdownOpen]);

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

  // Get live presence status from Socket.IO
  const { status: livePresenceStatus, setStatus: setLivePresenceStatus } = useUserPresence(
    user?.id ?? '',
  );

  const handleLogout = (): void => {
    logout();
  };

  const handleProfileClick = (): void => {
    if (channelId) {
      void navigate(`/chat/dir/${channelId}/profile/${user?.id}`);
    } else if (generalChannel) {
      void navigate(`/chat/dir/${generalChannel.id}/profile/${user?.id}`);
    }
  };

  // Check if user has a valid (non-expired) status
  const hasValidStatus =
    user?.statusEmoji && (!user?.statusExpiryAt || !isStatusExpired(user.statusExpiryAt));

  const handleStatusClick = (): void => {
    if (hasValidStatus) {
      setView('status-edit');
    } else {
      setView('status-suggestions');
    }
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

  return (
    <div className='flex flex-col gap-4 p-6 w-full'>
      {/* User identity section */}
      <div className='flex items-start gap-3'>
        <div className='flex-shrink-0'>
          <div
            className='relative group cursor-pointer'
            onClick={handlePictureClick}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handlePictureClick();
              }
            }}
            role='button'
            tabIndex={0}
            data-track-category='PROFILE'
            data-track-name='ChangePicture'
          >
            <Avatar userId={user?.id || ''} size='lg' showActiveStatus={false} />
            <div className='absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 rounded-full flex items-center justify-center transition-opacity'>
              <Camera className='size-4 text-white' />
            </div>
            <input
              ref={pictureInputRef}
              type='file'
              accept='image/jpeg,image/png,image/webp'
              onChange={e => {
                void handlePictureChange(e);
              }}
              className='hidden'
              disabled={isUploadingPicture}
            />
          </div>
        </div>
        <div className='flex-1 min-w-0 space-y-1'>
          <p className='text-sm font-medium text-foreground truncate'>{user?.name || 'User'}</p>

          {/* Presence Status Dropdown - inline for mobile compatibility */}
          <div className='relative' ref={presenceDropdownRef}>
            <button
              onClick={() => setIsPresenceDropdownOpen(!isPresenceDropdownOpen)}
              className='flex items-center gap-1.5 hover:bg-muted px-1.5 py-0.5 -ml-1.5 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500'
              data-track-category='PROFILE'
              data-track-name='TogglePresenceDropdown'
              data-track-metadata={JSON.stringify({ isOpen: !isPresenceDropdownOpen })}
            >
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
              <ChevronDown
                className={cn(
                  'size-3 text-muted-foreground transition-transform',
                  isPresenceDropdownOpen && 'rotate-180',
                )}
              />
            </button>

            {isPresenceDropdownOpen && (
              <div className='absolute left-0 top-full mt-1 w-40 p-1 bg-background rounded-md border shadow-md z-10'>
                <div className='space-y-0.5'>
                  <button
                    onClick={() => {
                      setLivePresenceStatus('ONLINE');
                      setIsPresenceDropdownOpen(false);
                    }}
                    data-ph-capture-attribute-track-id='set_presence_online'
                    className='w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left'
                    data-track-category='PROFILE'
                    data-track-name='SetPresenceOnline'
                    data-track-metadata={JSON.stringify({ newStatus: 'ONLINE' })}
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
                      setIsPresenceDropdownOpen(false);
                    }}
                    data-ph-capture-attribute-track-id='set_presence_away'
                    className='w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left'
                    data-track-category='PROFILE'
                    data-track-name='SetPresenceAway'
                    data-track-metadata={JSON.stringify({ newStatus: 'AWAY' })}
                  >
                    <div className='w-2 h-2 rounded-full border border-muted-foreground' />
                    <span>Away</span>
                    {livePresenceStatus === 'AWAY' && (
                      <Check className='size-3 ml-auto text-muted-foreground' />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* User Status Section */}
      <div className='space-y-1'>
        <div
          className={cn(
            'p-2 rounded-lg border cursor-pointer hover:bg-border transition-colors w-full',
            hasValidStatus
              ? 'border-border bg-transparent hover:bg-muted'
              : 'border-border bg-muted',
          )}
          onClick={handleStatusClick}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleStatusClick();
            }
          }}
          role='button'
          tabIndex={0}
          title={hasValidStatus ? 'Click to edit status' : 'Click to set status'}
          data-track-category='PROFILE'
          data-track-name={hasValidStatus ? 'EditStatus' : 'SetStatus'}
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
                trackId='clear_user_status'
                data-track-category='PROFILE'
                data-track-name='CLEAR_STATUS'
                className='flex-shrink-0 p-1 h-auto hover:bg-accent min-w-[20px]'
                title='Clear status'
              >
                <X className='size-3 text-muted-foreground' />
              </Button>
            </div>
          ) : (
            <div className='flex items-center p-1 gap-2 text-muted-foreground'>
              <SmilePlus className='size-4 flex-shrink-0' />
              <span className='text-xs truncate'>Set a status</span>
            </div>
          )}
        </div>
        {hasValidStatus && user?.statusExpiryAt && (
          <div className='text-xs text-muted-foreground px-2'>
            {formatExpiryTime(user.statusExpiryAt, true)}
          </div>
        )}
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
                trackId='resume_notifications'
                data-track-category='PROFILE'
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
                data-track-category='PROFILE'
                data-track-name='OpenPauseNotificationsMenu'
              >
                <div className='flex items-center p-1 gap-2 text-muted-foreground'>
                  <Bell className='size-4 flex-shrink-0' />
                  <span className='text-xs truncate'>Pause notifications for:</span>
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
                    data-ph-capture-attribute-track-id='pause_notifications'
                    data-ph-capture-attribute-duration={option.minutes}
                    className='w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent transition-colors text-left'
                    data-track-category='PROFILE'
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
                  data-track-category='PROFILE'
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
        <button
          type='button'
          onClick={handleProfileClick}
          className='w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted transition-colors text-left'
          data-track-category='PROFILE'
          data-track-name='OpenProfile'
        >
          <User className='size-4 text-muted-foreground flex-shrink-0' />
          <span className='text-sm text-foreground'>Profile</span>
        </button>

        <button
          type='button'
          onClick={() => {
            onClose?.();
            onOpenPreferences?.();
          }}
          className='w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted transition-colors text-left'
          data-track-category='PROFILE'
          data-track-name='OpenPreferences'
        >
          <Settings2 className='size-4 text-muted-foreground flex-shrink-0' />
          <span className='text-sm text-foreground'>Preferences</span>
        </button>
      </div>

      <hr className='border-border w-full' />

      <div className='space-y-2'>
        <Button
          type='button'
          className='!text-white w-full !bg-destructive rounded-3xl h-[44px] active:scale-[0.97] transition-transform duration-200'
          onClick={handleLogout}
          trackId='logout'
          data-track-category='PROFILE'
          data-track-name='Logout'
        >
          Sign out
        </Button>
      </div>
    </div>
  );
};

export default ProfileView;
