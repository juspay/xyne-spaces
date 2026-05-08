import { ReactElement, useState } from 'react';
import { useZero } from '../../../hooks/useZero';
import { Channel, NotificationLevel, ChannelScopeType } from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';
import { Monitor, Smartphone } from 'lucide-react';
import * as Switch from '@radix-ui/react-switch';
import { cn } from '../../../utils/classNames';

const NOTIFICATION_LEVELS = [
  { value: NotificationLevel.ALL, label: 'All notifications' },
  // Persisted as THREADS_ONLY, but shown as "Default" in the UI.
  // Default means mentions + subscribed thread replies.
  { value: NotificationLevel.THREADS_ONLY, label: 'Default' },
  { value: NotificationLevel.MENTIONS_ONLY, label: 'Mentions only' },
] as const;

// Check if channel is a DM or Group DM
const isDMChannel = (channel: Channel): boolean => {
  return (
    channel.scopeType === ChannelScopeType.DM || channel.scopeType === ChannelScopeType.GROUP_DM
  );
};

export interface NotificationsTabProps {
  channel: Channel;
  isParticipant: boolean;
}

const NotificationsTab = ({ channel, isParticipant }: NotificationsTabProps): ReactElement => {
  const zero = useZero();

  // Check if this is a DM channel
  const channelIsDM = isDMChannel(channel);

  // Load channel user status for notification settings (from cached state machine data)
  const channelUserStatus = useGetChannelUserStatus(channel.id);
  const defaultEnabledLevel = channelIsDM ? NotificationLevel.ALL : NotificationLevel.THREADS_ONLY;

  // Derive initial values from query data
  // desktopNotificationLevel is now the source of truth for desktop toggle
  const initialDesktopLevel =
    (channelUserStatus?.desktopNotificationLevel as NotificationLevel) ?? defaultEnabledLevel;
  // mobileNotificationLevel is now the source of truth for mobile toggle
  const initialMobileLevel =
    (channelUserStatus?.mobileNotificationLevel as NotificationLevel | null) ?? null;

  // Device toggles: ON if level is not NONE, OFF if level is NONE
  const [desktopNotifications, setDesktopNotifications] = useState<boolean>(
    initialDesktopLevel !== NotificationLevel.NONE,
  );
  const [mobileNotifications, setMobileNotifications] = useState<boolean>(
    initialMobileLevel !== null && initialMobileLevel !== NotificationLevel.NONE,
  );

  // Notification level selectors (shown when toggles are ON)
  // When toggle is ON but no specific level set, default to mentions and subscribed thread replies.
  const [desktopNotificationLevel, setDesktopNotificationLevel] = useState<NotificationLevel>(
    initialDesktopLevel === NotificationLevel.NONE ? defaultEnabledLevel : initialDesktopLevel,
  );
  const [mobileNotificationLevel, setMobileNotificationLevel] = useState<NotificationLevel>(
    initialMobileLevel === null || initialMobileLevel === NotificationLevel.NONE
      ? defaultEnabledLevel
      : initialMobileLevel,
  );

  const handleDesktopToggle = (checked: boolean): void => {
    setDesktopNotifications(checked);

    // When toggled ON, default to mentions and subscribed thread replies if not already set.
    const newLevel = checked
      ? desktopNotificationLevel === NotificationLevel.NONE
        ? defaultEnabledLevel
        : desktopNotificationLevel
      : NotificationLevel.NONE;

    setDesktopNotificationLevel(newLevel);

    void zero.mutate(
      mutators.notificationSettings.setChannelNotificationLevel({
        channelId: channel.id,
        desktopNotificationLevel: newLevel,
        timestamp: Date.now(),
      }),
    );
  };

  const handleMobileToggle = (checked: boolean): void => {
    setMobileNotifications(checked);

    // When toggled ON, default to mentions and subscribed thread replies if not already set.
    // When toggled OFF, set to NONE (not undefined) to properly disable mobile notifications
    const newLevel = checked
      ? mobileNotificationLevel === NotificationLevel.NONE
        ? defaultEnabledLevel
        : mobileNotificationLevel
      : NotificationLevel.NONE;

    setMobileNotificationLevel(newLevel);

    void zero.mutate(
      mutators.notificationSettings.setChannelNotificationLevel({
        channelId: channel.id,
        mobileNotificationLevel: newLevel,
        timestamp: Date.now(),
      }),
    );
  };

  const handleDesktopLevelChange = (level: NotificationLevel): void => {
    setDesktopNotificationLevel(level);
    void zero.mutate(
      mutators.notificationSettings.setChannelNotificationLevel({
        channelId: channel.id,
        desktopNotificationLevel: level,
        timestamp: Date.now(),
      }),
    );
  };

  const handleMobileLevelChange = (level: NotificationLevel): void => {
    setMobileNotificationLevel(level);
    void zero.mutate(
      mutators.notificationSettings.setChannelNotificationLevel({
        channelId: channel.id,
        mobileNotificationLevel: level,
        timestamp: Date.now(),
      }),
    );
  };

  if (!isParticipant) {
    return (
      <div className='p-4 text-sm text-muted-foreground'>
        Join this channel to manage notification settings.
      </div>
    );
  }

  return (
    <div className='flex flex-col h-[392px] bg-muted'>
      <div className='p-4 overflow-y-auto'>
        {/* Notification Preferences Section */}
        <div className='bg-card p-[12px] rounded-[12px] border border-border'>
          {/* Device Toggles */}
          <div className='space-y-3'>
            <p className='text-md font-medium text-foreground'>Device Notifications</p>

            {/* Desktop Toggle */}
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Monitor className='w-4 h-4 text-muted-foreground' />
                <label
                  htmlFor='desktop-notifications-toggle'
                  className='text-xs font-medium text-foreground cursor-pointer select-none'
                >
                  Desktop
                </label>
              </div>
              <Switch.Root
                id='desktop-notifications-toggle'
                checked={desktopNotifications}
                onCheckedChange={handleDesktopToggle}
                data-track-category='notifications'
                data-track-name='toggle_desktop_notifications'
                className={cn(
                  'relative inline-flex h-5 w-9 items-center rounded-full',
                  'bg-muted transition-colors duration-200',
                  'data-[state=checked]:bg-sidebar-badge-accent',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                )}
              >
                <Switch.Thumb
                  className={cn(
                    'block h-4 w-4 rounded-full bg-background shadow-sm',
                    'transition-transform duration-200',
                    'translate-x-0.5 data-[state=checked]:translate-x-4',
                  )}
                />
              </Switch.Root>
            </div>

            {/* Desktop Notification Level Selector - shown when desktop toggle is on */}
            {!channelIsDM && desktopNotifications && (
              <div className='space-y-2 pl-6'>
                <div className='grid grid-cols-3 gap-2'>
                  {NOTIFICATION_LEVELS.map(level => (
                    <button
                      key={level.value}
                      onClick={() => handleDesktopLevelChange(level.value)}
                      data-track-category='notifications'
                      data-track-name={`set_notification_level_${level.value.toLowerCase()}`}
                      className={`px-3 py-2 text-xs rounded-[8px] transition-colors border hover:bg-accent ${
                        desktopNotificationLevel === level.value
                          ? 'bg-muted text-foreground border-border'
                          : 'bg-background text-foreground border-border'
                      }`}
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Mobile Toggle */}
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Smartphone className='w-4 h-4 text-muted-foreground' />
                <label
                  htmlFor='mobile-notifications-toggle'
                  className='text-xs font-medium text-foreground cursor-pointer select-none'
                >
                  Mobile
                </label>
              </div>
              <Switch.Root
                id='mobile-notifications-toggle'
                checked={mobileNotifications}
                onCheckedChange={handleMobileToggle}
                data-track-category='notifications'
                data-track-name='toggle_mobile_notifications'
                className={cn(
                  'relative inline-flex h-5 w-9 items-center rounded-full',
                  'bg-muted transition-colors duration-200',
                  'data-[state=checked]:bg-sidebar-badge-accent',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                )}
              >
                <Switch.Thumb
                  className={cn(
                    'block h-4 w-4 rounded-full bg-background shadow-sm',
                    'transition-transform duration-200',
                    'translate-x-0.5 data-[state=checked]:translate-x-4',
                  )}
                />
              </Switch.Root>
            </div>

            {/* Mobile Notification Level Selector - shown when mobile toggle is on */}
            {!channelIsDM && mobileNotifications && (
              <div className='space-y-2 pl-6'>
                <div className='grid grid-cols-3 gap-2'>
                  {NOTIFICATION_LEVELS.map(level => (
                    <button
                      key={level.value}
                      onClick={() => handleMobileLevelChange(level.value)}
                      data-track-category='notifications'
                      data-track-name={`set_mobile_notification_level_${level.value.toLowerCase()}`}
                      className={`px-3 py-2 text-xs rounded-[8px] transition-colors border hover:bg-accent ${
                        mobileNotificationLevel === level.value
                          ? 'bg-muted text-foreground border-border'
                          : 'bg-background text-foreground border-border'
                      }`}
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationsTab;
