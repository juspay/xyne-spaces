import { ReactElement, useState, useMemo, useRef, useEffect } from 'react';
import {
  X,
  SmilePlus,
  Copy,
  PauseCircle,
  Mail,
  Clock,
  ChevronDown,
  Check,
  Bell,
  BellOff,
  Calendar,
} from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { useAuth } from '../../../hooks/useAuth';
import { Link } from 'react-router-dom';
import Avatar from '../../ui/Avatar/Avatar';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { UpdateAssignmentStatusModal } from '../../AppSidebar/UpdateAssignmentStatusModal';
import { Button } from '../../ui/Button/Button';
import { useCurrentUserAssignmentState } from '../../../hooks/useAssignmentState';
import { useTheme } from '../../../hooks/useTheme';
import { useDebugSettings } from '../../../hooks/useDebugSettings';
import { MeetingDetectionToggle } from '../MeetingDetectionToggle';
import { isElectronApp } from '../../../utils/electronApp';
import { cn } from '../../../utils/classNames';
import { isStatusExpired, formatExpiryTime } from '../../../utils/statusUtils';
import { Switch } from '../../ui/Switch';
import { useSelf } from '../../../hooks/useUsers';
import { mutators } from '../../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { apiInstance } from '../../../services/clients/apiClient';
import { logger } from '../../../utils/logger';
import { toast } from 'sonner';
import { SelectedStatusData } from './SetStatusView';
import { formatDistanceToNow, format } from 'date-fns';
import { useUserPresence } from '../../../hooks/usePresence';
import { DateTimePicker } from '../../ui/DateTimePicker/DateTimePicker';
import { detectReactNativeWebView, reactNativeBridge } from '../../../utils/reactNativeBridge';

type ViewType = 'default' | 'status-suggestions' | 'status-edit';

const ProfileView = ({
  setView,
}: {
  setView: (view: ViewType, data?: SelectedStatusData) => void;
}): ReactElement => {
  const { logout } = useAuth();
  const user = useSelf();
  const { theme, changeTheme } = useTheme();
  const { settings: debugSettings, toggleSendIndicators } = useDebugSettings();
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const [isPresenceDropdownOpen, setIsPresenceDropdownOpen] = useState(false);
  const [isNotificationDropdownOpen, setIsNotificationDropdownOpen] = useState(false);
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const notificationDropdownRef = useRef<HTMLDivElement>(null);
  const zero = useZero();

  // Handle click outside to close notification dropdown
  useEffect(() => {
    if (!isNotificationDropdownOpen) {
      return undefined;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        notificationDropdownRef.current &&
        !notificationDropdownRef.current.contains(event.target as Node)
      ) {
        setIsNotificationDropdownOpen(false);
        setShowCustomDatePicker(false);
        setCustomDate(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isNotificationDropdownOpen]);

  // Get assignment availability for current user
  const { isCurrentlyUnavailable, unavailableUntil, isActiveInAtLeastOneGroup } =
    useCurrentUserAssignmentState();
  // Get live presence status from Socket.IO
  const { status: livePresenceStatus, setStatus: setLivePresenceStatus } = useUserPresence(
    user?.id ?? '',
  );
  const handleLogout = (): void => {
    logout();
  };

  const handleResumeAssignment = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    if (!user?.id) return;

    void apiInstance.post('/user-assignment-state/toggle', { isUnavailable: false }).then(() => {
      // Update Zero immediately so UI is in sync
      zero.mutate(
        mutators.userPresence.upsert({
          assignmentUnavailableUntil: null,
          timestamp: Date.now(),
          presenceId: uuidv4(),
        }),
      );
    });
  };

  // Notification pause handlers
  const notificationsPausedUntil = user?.notificationsPausedUntil;
  const isNotificationsPaused = useMemo(() => {
    return notificationsPausedUntil ? notificationsPausedUntil > Date.now() : false;
  }, [notificationsPausedUntil]);

  const handlePauseNotifications = (durationMinutes: number): void => {
    if (!user?.id) return;
    const pausedUntil = Date.now() + durationMinutes * 60 * 1000;
    zero.mutate(
      mutators.userPresence.upsert({
        notificationsPausedUntil: pausedUntil,
        timestamp: Date.now(),
        presenceId: uuidv4(),
      }),
    );
    setIsNotificationDropdownOpen(false);
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
    setIsNotificationDropdownOpen(false);
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

  // Check if user has a valid (non-expired) status
  const hasValidStatus =
    user?.statusEmoji && (!user?.statusExpiryAt || !isStatusExpired(user.statusExpiryAt));

  const handleStatusClick = (): void => {
    if (hasValidStatus) {
      setView('status-edit');
    } else setView('status-suggestions');
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

  // TODO: Figure out a way to automatically
  // extract themes from the useTheme hook
  const themes: Array<{ id: 'classic' | 'midnight' | 'summer_breeze'; label: string; bg: string }> =
    [
      {
        id: 'classic',
        label: 'Classic',
        bg: `linear-gradient(180deg, #E2EEFB 0%, #EAEFDB 100%)`,
      },
      {
        id: 'summer_breeze',
        label: 'Summer Breeze',
        bg: `linear-gradient(
          180deg,
          #72a2c6 0%,
          #a1a1a9 50.96%,
          #c3bac9 69.71%,
          #7c80a5 78.85%,
          #6274a6 100%
        )`,
      },
      {
        id: 'midnight',
        label: 'Midnight',
        bg: '#0a0a0a',
      },
    ];

  return (
    <div className='flex flex-col gap-4 p-6 w-full'>
      <div className='flex items-start gap-3'>
        <div className='flex-shrink-0'>
          <Avatar userId={user?.id || ''} size='lg' showActiveStatus={false} />
        </div>
        <div className='flex-1 min-w-0 space-y-1'>
          <p className='text-sm font-medium text-foreground truncate'>{user?.name || 'User'}</p>

          {/* Presence Status Dropdown - inline for mobile compatibility */}
          <div className='relative'>
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

      {/* Global Notification Pause Section */}
      {isNotificationsPaused ? (
        <div className='mt-2 space-y-1'>
          <div
            className={cn(
              'px-2 py-1 rounded-lg border border-gray-200 bg-transparent hover:bg-gray-100 transition-colors w-full flex items-center justify-between gap-2',
            )}
            data-track-category='PROFILE'
            data-track-name='ResumeNotificationsArea'
          >
            <div className='flex items-center gap-2 min-w-0 flex-1'>
              <BellOff className='size-4 flex-shrink-0 text-gray-600' />
              <div className='text-sm font-medium text-gray-900 truncate'>Notifications paused</div>
            </div>
            <Button
              variant='ghost'
              size='lg'
              className='flex-shrink-0 p-1 h-auto hover:bg-gray-300 min-w-[20px]'
              title='Resume notifications'
              onClick={handleResumeNotifications}
              data-track-category='PROFILE'
              data-track-name='ResumeNotifications'
            >
              <X className='size-3 text-gray-600' />
            </Button>
          </div>
          {notificationsPausedUntil && (
            <div className='text-xs text-gray-500 px-2'>
              Until {format(new Date(notificationsPausedUntil), 'dd/MM/yyyy hh:mm a')}
            </div>
          )}
        </div>
      ) : (
        <div className='mt-2 space-y-1'>
          {/* Notification Pause Dropdown - inline for mobile compatibility */}
          <div className='relative' ref={notificationDropdownRef}>
            <button
              onClick={() => setIsNotificationDropdownOpen(!isNotificationDropdownOpen)}
              className='w-full px-2 py-1 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-200 transition-colors flex items-center justify-between gap-2'
              data-track-category='PROFILE'
              data-track-name='OpenPauseNotificationsMenu'
            >
              <div className='flex items-center p-1 gap-2 text-gray-600'>
                <Bell className='size-4 flex-shrink-0' />
                <span className='text-xs truncate'>Pause notifications for: </span>
              </div>
              <ChevronDown
                className={cn(
                  'size-4 text-gray-400 transition-transform',
                  isNotificationDropdownOpen && 'rotate-180',
                )}
              />
            </button>

            {isNotificationDropdownOpen && (
              <div
                className={cn(
                  'absolute left-0 top-full mt-1 p-1 bg-white rounded-md border shadow-md z-10',
                  showCustomDatePicker ? 'w-auto max-h-[40vh]' : 'w-44',
                )}
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
                        className='w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-gray-100 transition-colors text-left'
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
                      className='w-full flex items-center justify-between px-2 py-1.5 text-sm rounded-md hover:bg-gray-100 transition-colors text-left'
                      data-track-category='PROFILE'
                      data-track-name='PauseNotificationsCustom'
                    >
                      <span>Custom</span>
                      <Calendar className='size-4 text-gray-500' />
                    </button>
                  </div>
                ) : (
                  <div className='overflow-auto max-h-[calc(70vh-2rem)]'>
                    <DateTimePicker
                      value={customDate}
                      onChange={setCustomDate}
                      onConfirm={date => handlePauseNotificationsUntil(date)}
                      inline
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assignment Status Section */}
      {(isActiveInAtLeastOneGroup || isCurrentlyUnavailable) && (
        <div className='mt-2 space-y-1'>
          <div
            className={cn(
              'px-2 py-1 rounded-lg border transition-colors w-full flex items-center justify-between gap-2',
              isCurrentlyUnavailable
                ? 'border-border bg-transparent hover:bg-muted'
                : 'border-border bg-muted hover:bg-border cursor-pointer',
            )}
            onClick={() => {
              if (!isCurrentlyUnavailable) {
                setIsAssignmentModalOpen(true);
              }
            }}
            onKeyDown={e => {
              if (!isCurrentlyUnavailable && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                setIsAssignmentModalOpen(true);
              }
            }}
            role='button'
            tabIndex={0}
            title={
              isCurrentlyUnavailable ? 'Paused from assignment' : 'Click to pause from assignment'
            }
            data-track-category='PROFILE'
            data-track-name={isCurrentlyUnavailable ? 'ResumeAssignmentArea' : 'PauseAssignment'}
          >
            {isCurrentlyUnavailable ? (
              <div className='flex items-center gap-2 min-w-0 flex-1'>
                <PauseCircle className='size-4 flex-shrink-0 text-muted-foreground' />
                <div className='text-sm font-medium text-foreground truncate'>
                  Paused from ticket assignment
                </div>
              </div>
            ) : (
              <div className='flex items-center p-1 gap-2 text-muted-foreground'>
                <PauseCircle className='size-4 flex-shrink-0' />
                <span className='text-xs truncate'>Pause from ticket assignment</span>
              </div>
            )}

            {isCurrentlyUnavailable && (
              <Button
                variant='ghost'
                size='lg'
                className='flex-shrink-0 p-1 h-auto hover:bg-accent min-w-[20px]'
                title='Resume ticket assignment'
                onClick={handleResumeAssignment}
                data-track-category='PROFILE'
                data-track-name='ResumeAssignment'
              >
                <X className='size-3 text-muted-foreground' />
              </Button>
            )}
          </div>
          {isCurrentlyUnavailable && unavailableUntil && (
            <div className='text-xs text-gray-500 px-2'>
              Until {format(new Date(unavailableUntil), 'dd/MM/yyyy hh:mm a')}
            </div>
          )}
        </div>
      )}

      <div className='py-1'>
        <div className='flex items-center gap-3'>
          <div className='p-2 bg-muted rounded'>
            <Mail className='size-5' />
          </div>
          <div>
            <p className='text-sm text-muted-foreground'>Mail</p>
            <Link to={`mailto:${user?.email}`} className='text-sm tracking-wide'>
              {user?.email}
            </Link>
          </div>
        </div>
        {user?.createdAt && (
          <div className='mt-4 flex items-center gap-2'>
            <div className='p-2 bg-muted rounded'>
              <Clock className='size-5' />
            </div>
            <div>
              <p className='text-sm text-muted-foreground'>Joined On</p>
              <p className='text-sm tracking-wide'>
                {format(user.createdAt, 'MMM d, yyyy')} (
                {formatDistanceToNow(user.createdAt, { addSuffix: true })})
              </p>
            </div>
          </div>
        )}
      </div>

      <hr className='border-transparent w-full' />

      {/* Theme Selection Section */}
      <div className='space-y-2'>
        <p className='text-sm font-medium text-foreground'>Appearance</p>
        <div className='flex gap-2 w-full flex-wrap'>
          {themes.map(themeOption => (
            <button
              key={themeOption.id}
              onClick={() => changeTheme(themeOption.id)}
              className='flex-1 w-25 space-y-1'
              data-track-category='PROFILE'
              data-track-name='SelectTheme'
              data-track-metadata={JSON.stringify({ themeId: themeOption.id })}
            >
              <div
                className='w-25 h-[70px] rounded-md relative overflow-clip'
                style={{
                  background: themeOption.bg,
                  border:
                    theme === themeOption.id
                      ? '1px solid var(--sidebar-badge-accent)'
                      : '1px solid transparent',
                }}
              >
                <div className='absolute left-1/3 top-1/3 w-full h-full bg-muted rounded-md border border-border shadow-3xl'>
                  <div className='w-fit px-1 py-0.5'>Aa</div>
                </div>
              </div>
              <div
                className={cn(
                  'text-xs text-center',
                  theme === themeOption.id ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {themeOption.label}
              </div>
            </button>
          ))}
        </div>
      </div>

      <hr className='border-transparent w-full' />
      <div className='space-y-2'>
        <p className='text-sm font-medium text-foreground'>Developer Settings</p>
        <div className='space-y-2'>
          <Switch
            id='show-send-indicators'
            checked={debugSettings.showSendIndicators}
            onCheckedChange={toggleSendIndicators}
            label='Show send indicators'
          />
          {detectReactNativeWebView() && (
            <Button
              type='button'
              variant='outline'
              className='w-full rounded-3xl h-[44px] border-border'
              onClick={() => {
                reactNativeBridge.requestNativeShell('profile_menu');
              }}
              data-track-category='PROFILE'
              data-track-name='RequestNativeShell'
            >
              Switch to native app
            </Button>
          )}
        </div>
      </div>

      {isElectronApp() && (
        <>
          <hr className='border-transparent w-full' />
          <div className='space-y-2'>
            <p className='text-sm font-medium text-foreground'>Notifications</p>
            <MeetingDetectionToggle />
          </div>
        </>
      )}

      <hr className='border-transparent w-full' />

      <div className='space-y-2'>
        <Button
          type='button'
          className='!text-white w-full !bg-destructive rounded-3xl h-[44px] active:scale-[0.97] transition-transform duration-200'
          onClick={handleLogout}
          data-track-category='PROFILE'
          data-track-name='Logout'
        >
          Sign out
        </Button>
      </div>

      <div className='text-xs flex flex-col gap-1 text-muted-foreground'>
        <div>Version: {__APP_VERSION__}</div>
        {logger.zeroClientId && (
          <button
            onClick={() => {
              navigator.clipboard
                .writeText(logger.zeroClientId!)
                .then(() => {
                  toast.success('Client ID copied to clipboard');
                })
                .catch(() => {
                  toast.error('Failed to copy Client ID');
                });
            }}
            className='flex items-center gap-1 hover:text-muted-foreground transition-colors cursor-pointer text-left'
            data-track-category='PROFILE'
            data-track-name='CopyClientId'
          >
            <span>Client ID: {logger.zeroClientId}</span>
            <Copy className='size-3' />
          </button>
        )}
        {logger.zeroClientGroupId && (
          <button
            onClick={() => {
              navigator.clipboard
                .writeText(logger.zeroClientGroupId!)
                .then(() => {
                  toast.success('Client Group ID copied to clipboard');
                })
                .catch(() => {
                  toast.error('Failed to copy Client Group ID');
                });
            }}
            className='flex items-center gap-1 hover:text-muted-foreground transition-colors cursor-pointer text-left'
            data-track-category='PROFILE'
            data-track-name='CopyClientGroupId'
          >
            <span>Client Group ID: {logger.zeroClientGroupId}</span>
            <Copy className='size-3' />
          </button>
        )}
      </div>

      {/* Assignment Status Modal */}
      {(isActiveInAtLeastOneGroup || isCurrentlyUnavailable) && (
        <UpdateAssignmentStatusModal
          isOpen={isAssignmentModalOpen}
          onClose={() => setIsAssignmentModalOpen(false)}
        />
      )}
    </div>
  );
};

export default ProfileView;
