import { ReactElement, useState } from 'react';
import {
  X,
  User,
  SmilePlus,
  Copy,
  PauseCircle,
  ChevronDown,
  Check,
  Bell,
  BellOff,
  Calendar,
} from 'lucide-react';
import { useZero } from '../../hooks/useZero';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate, useParams } from 'react-router-dom';
import { useMemo } from 'react';
import Avatar from '../ui/Avatar/Avatar';
import { StatusIndicator } from '../ui/StatusIndicator';
import { UpdateStatusModal } from '../AppSidebar/UpdateStatusModal';
import { UpdateAssignmentStatusModal } from '../AppSidebar/UpdateAssignmentStatusModal';
import { Button } from '../ui/Button/Button';
import { useCurrentUserAssignmentState } from '../../hooks/useAssignmentState';
import { useTheme } from '../../hooks/useTheme';
import { useAILandingDefault } from '../../hooks/useAILandingDefault';
import { useDebugSettings } from '../../hooks/useDebugSettings';
import { MeetingDetectionToggle } from './MeetingDetectionToggle';
import { isElectronApp } from '../../utils/electronApp';
import { cn } from '../../utils/classNames';
import { isStatusExpired, formatExpiryTime } from '../../utils/statusUtils';
import { Switch } from '../ui/Switch';
import { useChannelByName } from '../../hooks/useChannels';
import { useSelf } from '../../hooks/useUsers';
import { mutators } from '../../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { apiInstance } from '../../services/clients/apiClient';
import { logger } from '../../utils/logger';
import { toast } from 'sonner';
import { Popover } from '../ui/Popover/Popover';
import { useUserPresence } from '../../hooks/usePresence';
import { DateTimePicker } from '../ui/DateTimePicker/DateTimePicker';
import { format } from 'date-fns';
import { webviewActor } from '../../machines/webviewMachine';

const Settings = (): ReactElement => {
  const { logout } = useAuth();
  const user = useSelf();
  const { theme, changeTheme } = useTheme();
  const { aiLandingDefault, setAiLandingDefault } = useAILandingDefault();
  const { settings: debugSettings, toggleSendIndicators } = useDebugSettings();
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const zero = useZero();

  // Get assignment availability for current user
  const { isCurrentlyUnavailable, unavailableUntil, isActiveInAtLeastOneGroup } =
    useCurrentUserAssignmentState();
  const generalChannel = useChannelByName('general');
  const navigate = useNavigate();
  const { channelId } = useParams<{ channelId?: string }>();
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

  // Notification pause state
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [customDate, setCustomDate] = useState<Date | null>(null);

  // Check if notifications are globally paused
  const notificationsPausedUntil = user?.notificationsPausedUntil;
  const isNotificationsPaused = useMemo(() => {
    return notificationsPausedUntil ? notificationsPausedUntil > Date.now() : false;
  }, [notificationsPausedUntil]);

  const handlePauseNotifications = (durationMinutes: number): void => {
    if (!user?.id) {
      return;
    }
    const pausedUntil = Date.now() + durationMinutes * 60 * 1000;

    const mutationPayload = {
      notificationsPausedUntil: pausedUntil,
      timestamp: Date.now(),
      presenceId: uuidv4(),
    };

    try {
      zero.mutate(mutators.userPresence.upsert(mutationPayload));
    } catch (error) {
      console.error('Mutation failed:', error);
    }
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
    setIsStatusModalOpen(true);
  };

  const handleStatusModalClose = (): void => {
    setIsStatusModalOpen(false);
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

  const handleProfileClick = (): void => {
    // Use useParams to get channelId from React Router
    if (channelId) {
      // We're in a chat, use the current channel in dir
      void navigate(`/chat/dir/${channelId}/profile/${user?.id}`);
    } else {
      if (generalChannel) {
        void navigate(`/chat/dir/${generalChannel.id}/profile/${user?.id}`);
      }
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
        label: 'Midnight (WIP)',
        bg: '#0a0a0a',
      },
    ];

  const handleOpenChangelog = (e: React.MouseEvent): void => {
    const changelogUrl = import.meta.env.VITE_API_URL.replace('/api', '/changelog');
    if (isElectronApp()) {
      if (e.metaKey || e.ctrlKey) {
        window.electronAPI?.openExternal?.(changelogUrl);
      } else {
        webviewActor.send({ type: 'ADD_TAB', url: changelogUrl });
        webviewActor.send({ type: 'OPEN' });
      }
    } else {
      // In browser: open in new tab
      window.open(changelogUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className='flex flex-col gap-4 min-w-[280px] max-w-[320px] w-full'>
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
            align='start'
            className='w-40 p-1'
          >
            <div className='space-y-0.5'>
              <button
                onClick={() => {
                  setLivePresenceStatus('ONLINE');
                }}
                className='w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left'
                data-track-category='SETTINGS'
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
                }}
                className='w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors text-left'
                data-track-category='SETTINGS'
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
            </div>
          )}
        </div>
        {hasValidStatus && user?.statusExpiryAt && (
          <div className='text-xs text-muted-foreground'>
            {formatExpiryTime(user.statusExpiryAt, true)}
          </div>
        )}
      </div>

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
            data-track-category='Settings'
            data-track-name='OpenAssignmentModal'
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
                data-track-category='Settings'
                data-track-name='ResumeAssignment'
              >
                <X className='size-3 text-muted-foreground' />
              </Button>
            )}
          </div>
          {isCurrentlyUnavailable && unavailableUntil && (
            <div className='text-xs text-muted-foreground'>
              Until {format(new Date(unavailableUntil), 'dd/MM/yyyy hh:mm a')}
            </div>
          )}
        </div>
      )}

      {/* Global Notification Pause Section */}
      {isNotificationsPaused ? (
        <div className='mt-2 space-y-1'>
          <div
            className={cn(
              'px-2 py-1 rounded-lg border border-border bg-transparent hover:bg-accent transition-colors w-full flex items-center justify-between gap-2',
            )}
            data-track-category='Settings'
            data-track-name='ResumeNotificationsArea'
          >
            <div className='flex items-center gap-2 min-w-0 flex-1'>
              <BellOff className='size-4 flex-shrink-0 text-muted-foreground' />
              <div className='text-sm font-medium text-foreground truncate'>
                Notifications paused
              </div>
            </div>
            <Button
              variant='ghost'
              size='lg'
              className='flex-shrink-0 p-1 h-auto hover:bg-gray-300 min-w-[20px]'
              title='Resume notifications'
              onClick={handleResumeNotifications}
              data-track-category='Settings'
              data-track-name='ResumeNotifications'
            >
              <X className='size-3 text-muted-foreground' />
            </Button>
          </div>
          {notificationsPausedUntil && (
            <div className='text-xs text-muted-foreground'>
              Until {format(new Date(notificationsPausedUntil), 'dd/MM/yyyy hh:mm a')}
            </div>
          )}
        </div>
      ) : (
        <div className='mt-2 space-y-1'>
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
                      e.preventDefault();
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
                    e.preventDefault();
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
        </div>
      )}

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

      <hr className='border-border w-full' />

      {/* Theme Selection Section */}
      <div className='space-y-2'>
        <p className='text-sm font-medium text-foreground'>Appearance</p>
        <div className='flex gap-2 w-full flex-wrap'>
          {themes.map(themeOption => (
            <button
              key={themeOption.id}
              onClick={() => changeTheme(themeOption.id)}
              className='flex-1 w-25 space-y-1'
              data-track-category='Settings'
              data-track-name='SelectTheme'
              data-track-metadata={JSON.stringify({ themeId: themeOption.id })}
              data-testid={`theme-btn-${themeOption.id}`}
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
                  'text-xs text-center whitespace-nowrap',
                  theme === themeOption.id ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {themeOption.label}
              </div>
            </button>
          ))}
        </div>
      </div>

      <hr className='border-border w-full' />
      {/* AI Launch preference — desktop only */}
      <div className='space-y-3'>
        <p className='text-sm font-medium text-foreground'>Launch</p>
        <div className='flex items-center justify-between gap-3'>
          <div className='flex-1 min-w-0'>
            <p className='text-sm text-foreground'>Open AI on launch</p>
            <p className='text-xs text-muted-foreground mt-0.5'>
              Start with the Xyne AI landing page instead of chat
            </p>
          </div>
          <Switch
            id='ai-landing-default'
            checked={aiLandingDefault}
            onCheckedChange={setAiLandingDefault}
          />
        </div>
      </div>

      <hr className='border-border w-full' />
      {/* Changelog Section */}
      <div className='space-y-2'>
        <button
          onClick={handleOpenChangelog}
          className='w-full flex items-center gap-2 px-2 py-2 rounded-lg bg-transparent hover:bg-muted transition-colors text-left group'
          data-track-category='SETTINGS'
          data-track-name='OpenChangelog'
        >
          <div className='flex-1 min-w-0'>
            <p className='text-sm font-medium text-foreground'>Changelog</p>
          </div>
          <span className='inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400'>
            NEW
          </span>
        </button>
      </div>

      <hr className='border-border w-full' />
      <div className='space-y-2'>
        <p className='text-sm font-medium text-foreground'>Developer Settings</p>
        <div className='space-y-2'>
          <Switch
            id='show-send-indicators'
            checked={debugSettings.showSendIndicators}
            onCheckedChange={toggleSendIndicators}
            label='Show send indicators'
          />
        </div>
      </div>

      {isElectronApp() && (
        <>
          <hr className='border-border w-full' />
          <div className='space-y-2'>
            <p className='text-sm font-medium text-foreground'>Notifications</p>
            <MeetingDetectionToggle />
          </div>
        </>
      )}

      <hr className='border-border w-full' />

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
            data-track-category='Settings'
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
            data-track-category='Settings'
            data-track-name='CopyClientGroupId'
          >
            <span>Client Group ID: {logger.zeroClientGroupId}</span>
            <Copy className='size-3' />
          </button>
        )}
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

      {/* Status Update Modal */}
      <UpdateStatusModal
        isOpen={isStatusModalOpen}
        onClose={handleStatusModalClose}
        currentStatus={
          hasValidStatus
            ? {
                emoji: user?.statusEmoji || '',
                content: user?.statusContent || '',
                expiryAt: user?.statusExpiryAt || null,
              }
            : null
        }
      />

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

export default Settings;
