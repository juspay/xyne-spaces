import { ReactElement } from 'react';
import { useZero } from '../../../hooks/useZero';
import { Channel, NotificationLevel, ChannelScopeType } from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
import { Monitor, Smartphone } from 'lucide-react';
import * as Switch from '@radix-ui/react-switch';

import { cn } from '../../../utils/classNames';
import { useGlobalNotificationSettings } from '../../../hooks/useGlobalNotificationSettings';
import { useQuery } from '../../../hooks/useQuery';
import { queries } from '../../../zero/queries';
import { useGetChannelUserStatus } from '../../../hooks/useChannels';

// 2-option level picker for regular channels (NONE is handled by the on/off toggle)
const CHANNEL_LEVEL_OPTIONS: Array<{ value: NotificationLevel; label: string }> = [
  { value: NotificationLevel.ALL, label: 'Everything' },
  { value: NotificationLevel.MENTIONS_ONLY, label: 'Mentions only' },
];

const isDMChannel = (channel: Channel): boolean => channel.scopeType === ChannelScopeType.DM;

export interface NotificationsTabProps {
  channel: Channel;
  isParticipant: boolean;
}

const NotificationsTab = ({ channel, isParticipant }: NotificationsTabProps): ReactElement => {
  const zero = useZero();
  const globalSettings = useGlobalNotificationSettings();

  const channelIsDM = isDMChannel(channel);
  const channelIsGroupDM = channel.scopeType === ChannelScopeType.GROUP_DM;

  // State machine has the row for open channels; returns undefined for closed DMs (isClosed filter).
  const statusFromHook = useGetChannelUserStatus(channel.id);

  // Only subscribe via Zero if the hook has no entry (i.e. closed DM).
  const [statusFromQuery, statusDetails] = useQuery(
    queries.getChannelUserStatus({ channelId: channel.id }),
    { enabled: statusFromHook === undefined },
  );
  const channelUserStatus = statusFromHook ?? statusFromQuery ?? null;
  // Ready immediately when the hook has data; otherwise wait for the query.
  const settingsReady = statusFromHook !== undefined || statusDetails.type !== 'unknown';

  // Stored levels: null = inherit global, NONE = explicitly off, other = explicit override
  const storedDesktopLevel =
    (channelUserStatus?.desktopNotificationLevel as NotificationLevel | null | undefined) ?? null;
  const storedMobileLevel =
    (channelUserStatus?.mobileNotificationLevel as NotificationLevel | null | undefined) ?? null;

  // Per-channel boolean overrides (null = inherit global)
  const storedThreadReply = channelUserStatus?.threadReplyNotificationsEnabled ?? null;
  const storedChannelWideMentions = channelUserStatus?.channelWideMentionsEnabled ?? null;

  // Toggle state: ON when not explicitly NONE
  const desktopEnabled = storedDesktopLevel !== NotificationLevel.NONE;
  const mobileEnabled = storedMobileLevel !== NotificationLevel.NONE;

  // Effective picked level for the 2-button selector (ignores NONE — that's handled by the toggle)
  // GROUP_DM: default to ALL to match backend (bypasses global pref, same as 1:1 DM semantics).
  const pickedDesktopLevel =
    storedDesktopLevel && storedDesktopLevel !== NotificationLevel.NONE
      ? storedDesktopLevel
      : channelIsGroupDM
        ? NotificationLevel.ALL
        : globalSettings.globalDesktopNotificationLevel;
  const pickedMobileLevel =
    storedMobileLevel && storedMobileLevel !== NotificationLevel.NONE
      ? storedMobileLevel
      : channelIsGroupDM
        ? NotificationLevel.ALL
        : globalSettings.globalMobileNotificationLevel;

  // Effective boolean values: channel override ?? global
  const effectiveThreadReply =
    storedThreadReply !== null ? storedThreadReply : globalSettings.threadReplyNotificationsEnabled;
  const effectiveChannelWideMentions =
    storedChannelWideMentions !== null
      ? storedChannelWideMentions
      : globalSettings.channelWideMentionsEnabled;

  const hasAnyDeliveryEnabled = desktopEnabled || mobileEnabled;
  const displayedThreadReply = hasAnyDeliveryEnabled && effectiveThreadReply;
  const displayedChannelWideMentions = hasAnyDeliveryEnabled && effectiveChannelWideMentions;

  const setNotificationLevel = (
    field: 'desktop' | 'mobile',
    level: NotificationLevel | null,
  ): void => {
    void zero.mutate(
      mutators.notificationSettings.setChannelNotificationLevel({
        channelId: channel.id,
        ...(field === 'desktop'
          ? { desktopNotificationLevel: level }
          : { mobileNotificationLevel: level }),
        timestamp: Date.now(),
      }),
    );
  };

  const switchClass = cn(
    'relative inline-flex h-5 w-9 items-center rounded-full',
    'bg-muted transition-colors duration-200',
    'data-[state=checked]:bg-primary',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
  );
  const thumbClass = cn(
    'block h-4 w-4 rounded-full bg-background shadow-sm',
    'transition-transform duration-200',
    'translate-x-0.5 data-[state=checked]:translate-x-4',
  );

  if (!isParticipant) {
    return (
      <div className='p-4 text-sm text-muted-foreground'>
        Join this channel to manage notification settings.
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full'>
      <div className='p-4 overflow-y-auto'>
        <div className='bg-card p-[12px] rounded-[12px] border border-border space-y-4'>
          {/* ── Desktop ── */}
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Monitor className='w-4 h-4 text-muted-foreground' />
                <label
                  htmlFor='desktop-toggle'
                  className='text-xs font-medium text-foreground cursor-pointer select-none'
                >
                  Desktop
                </label>
              </div>
              <Switch.Root
                id='desktop-toggle'
                checked={desktopEnabled}
                disabled={!settingsReady}
                onCheckedChange={checked =>
                  setNotificationLevel('desktop', checked ? null : NotificationLevel.NONE)
                }
                data-track-category='NOTIFICATIONS'
                data-track-name='toggle_desktop_notifications'
                className={cn(switchClass, !settingsReady && 'opacity-40 cursor-not-allowed')}
              >
                <Switch.Thumb className={thumbClass} />
              </Switch.Root>
            </div>

            {/* Level picker — only for regular channels when toggle is ON */}
            {!channelIsDM && desktopEnabled && (
              <div className='grid grid-cols-2 gap-2 pl-6'>
                {CHANNEL_LEVEL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    disabled={!settingsReady}
                    onClick={() => setNotificationLevel('desktop', opt.value)}
                    data-track-category='NOTIFICATIONS'
                    data-ph-capture-attribute-track-id={`set_desktop_notification_level_${opt.value.toLowerCase()}`}
                    data-track-name={`set_desktop_level_${opt.value.toLowerCase()}`}
                    className={cn(
                      'px-2 py-1.5 text-xs rounded-md border transition-colors',
                      !settingsReady && 'opacity-40 cursor-not-allowed',
                      pickedDesktopLevel === opt.value
                        ? 'bg-muted text-foreground border-border font-medium'
                        : 'bg-background text-muted-foreground border-border hover:bg-muted',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Mobile ── */}
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Smartphone className='w-4 h-4 text-muted-foreground' />
                <label
                  htmlFor='mobile-toggle'
                  className='text-xs font-medium text-foreground cursor-pointer select-none'
                >
                  Mobile
                </label>
              </div>
              <Switch.Root
                id='mobile-toggle'
                checked={mobileEnabled}
                disabled={!settingsReady}
                onCheckedChange={checked =>
                  setNotificationLevel('mobile', checked ? null : NotificationLevel.NONE)
                }
                data-track-category='NOTIFICATIONS'
                data-track-name='toggle_mobile_notifications'
                className={cn(switchClass, !settingsReady && 'opacity-40 cursor-not-allowed')}
              >
                <Switch.Thumb className={thumbClass} />
              </Switch.Root>
            </div>

            {/* Level picker — only for regular channels when toggle is ON */}
            {!channelIsDM && mobileEnabled && (
              <div className='grid grid-cols-2 gap-2 pl-6'>
                {CHANNEL_LEVEL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    disabled={!settingsReady}
                    onClick={() => setNotificationLevel('mobile', opt.value)}
                    data-track-category='NOTIFICATIONS'
                    data-ph-capture-attribute-track-id={`set_mobile_notification_level_${opt.value.toLowerCase()}`}
                    data-track-name={`set_mobile_level_${opt.value.toLowerCase()}`}
                    className={cn(
                      'px-2 py-1.5 text-xs rounded-md border transition-colors',
                      !settingsReady && 'opacity-40 cursor-not-allowed',
                      pickedMobileLevel === opt.value
                        ? 'bg-muted text-foreground border-border font-medium'
                        : 'bg-background text-muted-foreground border-border hover:bg-muted',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Per-channel boolean toggles — regular channels only ── */}
          {!channelIsDM && (
            <>
              {/* Thread replies */}
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-xs font-medium text-foreground'>Thread replies</p>
                  <div className='flex items-center gap-1 mt-0.5'>
                    <p className='text-xs text-muted-foreground'>Replies in threads you follow</p>
                    {desktopEnabled !== mobileEnabled && (
                      <span className='text-xs text-muted-foreground'>
                        · {desktopEnabled ? 'Desktop only' : 'Mobile only'}
                      </span>
                    )}
                  </div>
                </div>
                <Switch.Root
                  id='channel-thread-reply-toggle'
                  checked={displayedThreadReply}
                  disabled={!settingsReady || !hasAnyDeliveryEnabled}
                  onCheckedChange={checked => {
                    void zero.mutate(
                      mutators.notificationSettings.setChannelNotificationLevel({
                        channelId: channel.id,
                        threadReplyNotificationsEnabled: checked,
                        timestamp: Date.now(),
                      }),
                    );
                  }}
                  data-track-category='NOTIFICATIONS'
                  data-track-name='toggle_channel_thread_reply'
                  className={cn(
                    switchClass,
                    (!settingsReady || !hasAnyDeliveryEnabled) && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  <Switch.Thumb className={thumbClass} />
                </Switch.Root>
              </div>

              {/* @channel / @here */}
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-xs font-medium text-foreground'>@channel and @here</p>
                  <div className='flex items-center gap-1 mt-0.5'>
                    <p className='text-xs text-muted-foreground'>
                      Notify when @channel or @here is used
                    </p>
                    {desktopEnabled !== mobileEnabled && (
                      <span className='text-xs text-muted-foreground'>
                        · {desktopEnabled ? 'Desktop only' : 'Mobile only'}
                      </span>
                    )}
                  </div>
                </div>
                <Switch.Root
                  id='channel-wide-mentions-toggle'
                  checked={displayedChannelWideMentions}
                  disabled={!settingsReady || !hasAnyDeliveryEnabled}
                  onCheckedChange={checked => {
                    void zero.mutate(
                      mutators.notificationSettings.setChannelNotificationLevel({
                        channelId: channel.id,
                        channelWideMentionsEnabled: checked,
                        timestamp: Date.now(),
                      }),
                    );
                  }}
                  data-track-category='NOTIFICATIONS'
                  data-track-name='toggle_channel_wide_mentions'
                  className={cn(
                    switchClass,
                    (!settingsReady || !hasAnyDeliveryEnabled) && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  <Switch.Thumb className={thumbClass} />
                </Switch.Root>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationsTab;
