import { FC, ReactElement, ReactNode, useEffect, useMemo, useState } from 'react';
import {
  X,
  Palette,
  Bell,
  PauseCircle,
  Mic,
  MessageSquare,
  Zap,
  Sparkles,
  Code2,
  Copy,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Calendar,
  AudioLines,
  Monitor,
  Smartphone,
  LayoutGrid,
  Shield,
  Eye,
  EyeOff,
  ChevronDown,
  Check,
} from 'lucide-react';
import { ResolutionQualityHd, Spinner } from '@xyne/icons';
import {
  NotificationLevel,
  MAX_NOTIFICATION_KEYWORDS,
  MAX_NOTIFICATION_KEYWORD_LENGTH,
} from '@xyne/shared';
import { apiInstance } from '../../../services/clients/apiClient';
import { format } from 'date-fns';

import { Dialog } from '../../ui/Dialog/Dialog';
import { Switch } from '../../ui/Switch';
import { RadioGroup, Radio } from '../../ui/RadioGroup';
import { Button } from '../../ui/Button/Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../ui/dropdown-menu';
import { Tooltip } from '../../ui/Tooltip';

import { usePlatform } from '../../../hooks/usePlatform';
import type { Theme } from '../../../hooks/useTheme';

import { cn } from '../../../utils/classNames';
import { isElectronApp } from '../../../utils/electronApp';
import { detectReactNativeWebView, reactNativeBridge } from '../../../utils/reactNativeBridge';
import { linkOpenPrefIsRelevant } from '../../../utils/openLink';
import { logger } from '../../../utils/logger';

import { MeetingDetectionToggle } from '../MeetingDetectionToggle';
import { MenuBarIconToggle } from '../MenuBarIconToggle';
import { RecordingPillToggle } from '../RecordingPillToggle';
import { ClawOverlayToggle } from '../ClawOverlayToggle';
import { DailyBriefToggle } from '../DailyBriefToggle';
import { IntentSuggestionsToggle } from '../IntentSuggestionsToggle';
import { UpdateAssignmentStatusModal } from '../../AppSidebar/UpdateAssignmentStatusModal';
import { VoiceSignatureModal } from '../VoiceSignatureModal/VoiceSignatureModal';
import HuddleIcon from '../../icons/HuddleIcon';
import { useGlobalNotificationSettings } from '../../../hooks/useGlobalNotificationSettings';
import { useNotificationKeywords } from '../../../hooks/useNotificationKeywords';
import { Badge } from '../../ui/Badge/Badge';

import { usePreferencesState, type PreferencesState } from '../../../hooks/usePreferencesState';
import {
  CALL_MEDIA_QUALITY_OPTIONS,
  type CallMediaQuality,
} from '../../../hooks/useCallMediaQualitySettings';
import { useMaxCameraHeight, filterQualityOptionsByMax } from '../../../hooks/useMaxCameraQuality';
import { useVisibleNavigationItems } from '../../../hooks/useVisibleNavigationItems';
import { useToolbarItems } from '../../../hooks/useToolbarItems';
import { isRequiredToolbarPath } from '../../AppSidebar/navigationConfig';
import type { PreferenceSection, PreferencesProps, NavItem } from '.';
import { disconnectCalendar } from '../../../services/clients/calendarApi';
import { toast } from 'sonner';

// ─── Constants ──────────────────────────────────────────────────────────────
const NAV_ITEMS: NavItem[] = [
  { id: 'appearance', label: 'Appearance', icon: <Palette className='size-4' /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className='size-4' /> },
  { id: 'availability', label: 'Availability', icon: <PauseCircle className='size-4' /> },
  { id: 'voice', label: 'Voice', icon: <Mic className='size-4' /> },
  { id: 'calls', label: 'Calls', icon: <HuddleIcon size={16} /> },
  { id: 'recordings', label: 'Recordings', icon: <AudioLines className='size-4' /> },
  {
    id: 'messaging',
    label: 'Messaging',
    icon: <MessageSquare className='size-4' />,
    desktopOnly: true,
  },
  { id: 'launch', label: 'Launch', icon: <Zap className='size-4' />, desktopOnly: true },
  { id: 'claw', label: 'Claw', icon: <Sparkles className='size-4' />, desktopOnly: true },
  {
    id: 'toolbar',
    label: 'Toolbar',
    icon: <LayoutGrid className='size-4' />,
    desktopOnly: true,
  },
  { id: 'calendar', label: 'Calendar', icon: <Calendar className='size-4' /> },
  { id: 'password', label: 'Password', icon: <Shield className='size-4' /> },
  { id: 'developer', label: 'Developer', icon: <Code2 className='size-4' /> },
];

const THEMES: Array<{ id: Theme; label: string; bg: string }> = [
  { id: 'classic', label: 'Classic', bg: 'var(--theme-preview-classic)' },
  { id: 'summer_breeze', label: 'Summer Breeze', bg: 'var(--theme-preview-summer_breeze)' },
  { id: 'midnight', label: 'Midnight', bg: 'var(--theme-preview-midnight)' },
];

const SectionHeader: FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div>
    <p className='text-base font-semibold text-foreground'>{title}</p>
    <p className='text-sm text-muted-foreground mt-0.5'>{subtitle}</p>
  </div>
);

const KeyCap: FC<{ children: ReactNode }> = ({ children }) => (
  <kbd className='inline-flex items-center rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium leading-none text-foreground align-middle'>
    {children}
  </kbd>
);

const QualitySelect: FC<{
  id: string;
  label: string;
  value: CallMediaQuality;
  onChange: (value: CallMediaQuality) => void;
  options?: typeof CALL_MEDIA_QUALITY_OPTIONS;
  disabled?: boolean;
  action?: ReactNode;
}> = ({
  id,
  label,
  value,
  onChange,
  options = CALL_MEDIA_QUALITY_OPTIONS,
  disabled = false,
  action,
}) => {
  const selected = options.find(option => option.value === value) ?? options[0];
  return (
    <div className='flex items-center justify-between gap-4'>
      <span id={`${id}-label`} className='text-sm font-medium text-foreground'>
        {label}
      </span>
      <div className='flex items-center gap-2'>
        {action}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              id={id}
              type='button'
              disabled={disabled}
              aria-labelledby={`${id}-label ${id}`}
              className='flex h-8 min-w-40 items-center justify-between gap-2 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-background'
              data-track-category='PREFERENCES'
              data-track-name={id}
            >
              <span className='truncate'>
                {selected?.label}
                {selected && (
                  <span className='text-muted-foreground'> - {selected.description}</span>
                )}
              </span>
              <ChevronDown className='size-3.5 shrink-0 text-muted-foreground' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='min-w-40'>
            {options.map(option => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => onChange(option.value)}
                className='flex items-center justify-between gap-3'
                data-track-category='PREFERENCES'
                data-track-name={`${id}-${option.value}`}
              >
                <span>
                  {option.label}{' '}
                  <span className='text-muted-foreground'>- {option.description}</span>
                </span>
                {option.value === value && (
                  <Check className='size-3.5 shrink-0 text-primary' aria-hidden />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

// ─── Appearance ─────────────────────────────────────────────────────────────
const AppearanceSection: FC<{ state: PreferencesState }> = ({ state }) => (
  <div className='space-y-4'>
    <SectionHeader title='Appearance' subtitle='Choose your theme' />
    <div className='flex gap-4 flex-wrap'>
      {THEMES.map(themeOption => (
        <button
          key={themeOption.id}
          onClick={() => state.changeTheme(themeOption.id)}
          className='flex flex-col items-center gap-1.5'
          data-track-category='PREFERENCES'
          data-track-name='SelectTheme'
          data-track-metadata={JSON.stringify({ themeId: themeOption.id })}
          data-testid={`theme-btn-${themeOption.id}`}
        >
          <div
            className='w-24 h-16 rounded-lg relative overflow-clip'
            style={{
              background: themeOption.bg,
              border:
                state.theme === themeOption.id
                  ? '2px solid hsl(var(--primary))'
                  : '2px solid transparent',
            }}
          >
            <div className='absolute left-1/3 top-1/3 w-full h-full bg-muted rounded-md border border-border shadow-md'>
              <div className='w-fit px-1 py-0.5 text-xs'>Aa</div>
            </div>
          </div>
          <span
            className={cn(
              'text-xs whitespace-nowrap',
              state.theme === themeOption.id ? 'text-primary font-medium' : 'text-muted-foreground',
            )}
          >
            {themeOption.label}
          </span>
        </button>
      ))}
    </div>
  </div>
);

// ─── Notifications ──────────────────────────────────────────────────────────
const GLOBAL_NOTIFICATION_LEVELS: Array<{ value: NotificationLevel; label: string }> = [
  { value: NotificationLevel.ALL, label: 'Everything' },
  { value: NotificationLevel.MENTIONS_ONLY, label: 'Mentions & DMs' },
];

const KEYWORD_ERROR_MESSAGES: Record<'duplicate' | 'too_long' | 'limit_reached', string> = {
  duplicate: 'This keyword is already in your list',
  too_long: `Keywords can be at most ${MAX_NOTIFICATION_KEYWORD_LENGTH} characters`,
  limit_reached: `Maximum ${MAX_NOTIFICATION_KEYWORDS} keywords`,
};

const NotificationKeywordsCard: FC = () => {
  const { keywords, addKeyword, removeKeyword } = useNotificationKeywords();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAdd = (): void => {
    const result = addKeyword(draft);
    if (result.ok) {
      setDraft('');
      setError(null);
    } else if (result.reason !== 'empty') {
      setError(KEYWORD_ERROR_MESSAGES[result.reason]);
    }
  };

  return (
    <div className='p-3 rounded-lg border border-border bg-muted/30 space-y-2'>
      <p className='text-sm font-medium text-foreground'>Keywords</p>
      <p className='text-xs text-muted-foreground'>
        Get notified when these words appear in any channel you&apos;re in.
      </p>

      {keywords.length > 0 && (
        <div className='flex flex-wrap gap-2'>
          {keywords.map(keyword => (
            <Badge key={keyword} variant='primary' className='flex items-center gap-1.5 pr-1'>
              <span className='text-xs'>{keyword}</span>
              <Button
                type='button'
                variant='ghost'
                onClick={() => removeKeyword(keyword)}
                trackId='remove_notification_keyword'
                className='rounded-full p-0.5 transition-colors'
                aria-label={`Remove ${keyword}`}
                data-track-category='PREFERENCES'
                data-track-name='RemoveNotificationKeyword'
              >
                <X className='h-3 w-3' />
              </Button>
            </Badge>
          ))}
        </div>
      )}

      <input
        type='text'
        value={draft}
        onChange={e => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
          }
        }}
        placeholder='Add a keyword and press Enter'
        className='w-full px-2 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
        data-track-category='PREFERENCES'
        data-track-name='AddNotificationKeyword'
      />
      {error && <p className='text-xs text-destructive'>{error}</p>}
    </div>
  );
};

const NotificationsSection: FC<{ state: PreferencesState }> = () => {
  const settings = useGlobalNotificationSettings();
  return (
    <div className='space-y-4'>
      <SectionHeader title='Notifications' subtitle='Manage your notification preferences' />

      {/* Default notification levels */}
      <div className='p-3 rounded-lg border border-border bg-muted/30 space-y-3'>
        <p className='text-sm font-medium text-foreground'>Default notification level</p>
        <p className='text-xs text-muted-foreground'>
          Channel-level settings override these defaults.
        </p>

        {/* Desktop level */}
        <div className='space-y-1.5'>
          <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
            <Monitor className='size-3' />
            Desktop
          </div>
          <div className='flex gap-2'>
            {GLOBAL_NOTIFICATION_LEVELS.map(level => (
              <Button
                key={level.value}
                variant='ghost'
                onClick={() => settings.update({ globalDesktopNotificationLevel: level.value })}
                trackId='set_global_desktop_notification_level'
                trackProps={{ level: level.value }}
                data-track-category='PREFERENCES'
                data-track-name={`SetGlobalDesktopLevel_${level.value}`}
                className={cn(
                  'flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors',
                  settings.globalDesktopNotificationLevel === level.value
                    ? 'bg-muted text-foreground border-border font-medium'
                    : 'bg-background text-muted-foreground border-border hover:bg-muted',
                )}
              >
                {level.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Mobile level */}
        <div className='space-y-1.5'>
          <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
            <Smartphone className='size-3' />
            Mobile
          </div>
          <div className='flex gap-2'>
            {GLOBAL_NOTIFICATION_LEVELS.map(level => (
              <Button
                key={level.value}
                variant='ghost'
                onClick={() => settings.update({ globalMobileNotificationLevel: level.value })}
                trackId='set_global_mobile_notification_level'
                trackProps={{ level: level.value }}
                data-track-category='PREFERENCES'
                data-track-name={`SetGlobalMobileLevel_${level.value}`}
                className={cn(
                  'flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors',
                  settings.globalMobileNotificationLevel === level.value
                    ? 'bg-muted text-foreground border-border font-medium'
                    : 'bg-background text-muted-foreground border-border hover:bg-muted',
                )}
              >
                {level.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Toggle settings */}
      <div className='space-y-2'>
        <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
          <div>
            <p className='text-sm font-medium text-foreground'>@channel and @here mentions</p>
            <p className='text-xs text-muted-foreground mt-0.5'>
              Receive notifications for channel-wide mentions
            </p>
          </div>
          <Switch
            id='channel-wide-mentions'
            checked={settings.channelWideMentionsEnabled}
            onCheckedChange={checked => settings.update({ channelWideMentionsEnabled: checked })}
          />
        </div>

        <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
          <div>
            <p className='text-sm font-medium text-foreground'>Thread reply notifications</p>
            <p className='text-xs text-muted-foreground mt-0.5'>
              Receive notifications for replies in threads you follow
            </p>
          </div>
          <Switch
            id='thread-reply-notifications'
            checked={settings.threadReplyNotificationsEnabled}
            onCheckedChange={checked =>
              settings.update({ threadReplyNotificationsEnabled: checked })
            }
          />
        </div>

        <MeetingDetectionToggle />

        <NotificationKeywordsCard />
      </div>
    </div>
  );
};

// ─── Availability ───────────────────────────────────────────────────────────
const AvailabilitySection: FC<{ state: PreferencesState }> = ({ state }) => (
  <div className='space-y-4'>
    <SectionHeader title='Availability' subtitle='Manage your ticket assignment availability' />
    {state.isActiveInAtLeastOneGroup || state.isCurrentlyUnavailable ? (
      <div className='space-y-1'>
        <div
          className={cn(
            'px-3 py-2 rounded-lg border transition-colors flex items-center justify-between gap-2',
            state.isCurrentlyUnavailable
              ? 'border-border bg-transparent hover:bg-muted'
              : 'border-border bg-muted hover:bg-border cursor-pointer',
          )}
          onClick={() => {
            if (!state.isCurrentlyUnavailable) state.setIsAssignmentModalOpen(true);
          }}
          role='button'
          tabIndex={0}
          onKeyDown={e => {
            if (!state.isCurrentlyUnavailable && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              state.setIsAssignmentModalOpen(true);
            }
          }}
          data-track-category='PREFERENCES'
          data-track-name='OpenAssignmentModal'
        >
          {state.isCurrentlyUnavailable ? (
            <div className='flex items-center gap-2 min-w-0 flex-1'>
              <PauseCircle className='size-4 flex-shrink-0 text-muted-foreground' />
              <span className='text-sm font-medium text-foreground'>
                Paused from ticket assignment
              </span>
            </div>
          ) : (
            <div className='flex items-center gap-2 text-muted-foreground'>
              <PauseCircle className='size-4 flex-shrink-0' />
              <span className='text-sm'>Pause from ticket assignment</span>
            </div>
          )}
          {state.isCurrentlyUnavailable && (
            <Button
              variant='ghost'
              size='lg'
              className='flex-shrink-0 p-1 h-auto hover:bg-accent'
              title='Resume assignment'
              onClick={state.resumeAssignment}
              data-track-category='PREFERENCES'
              data-track-name='ResumeAssignment'
            >
              <X className='size-3 text-muted-foreground' />
            </Button>
          )}
        </div>
        {state.isCurrentlyUnavailable && state.unavailableUntil && (
          <p className='text-xs text-muted-foreground'>
            Until {format(new Date(state.unavailableUntil), 'dd/MM/yyyy hh:mm a')}
          </p>
        )}
      </div>
    ) : (
      <p className='text-sm text-muted-foreground'>You are not part of any assignment groups.</p>
    )}
  </div>
);

// ─── Voice ──────────────────────────────────────────────────────────────────
const VoiceSection: FC<{ state: PreferencesState }> = ({ state }) => (
  <div className='space-y-4'>
    <SectionHeader title='Voice' subtitle='Manage your voice signature for meetings' />
    <div className='flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30'>
      <div className='flex items-center gap-3'>
        <div className='flex items-center justify-center w-9 h-9 rounded-md bg-muted border border-border shrink-0'>
          <Mic className='size-4 text-muted-foreground' />
        </div>
        <div>
          <p className='text-sm font-medium text-foreground'>Voice Signature</p>
          <p className='text-xs text-muted-foreground'>
            {state.hasVoiceSignature ? (
              <span className='flex items-center gap-1 text-green-600 dark:text-green-400'>
                <CheckCircle2 className='size-3' />
                Signature stored
              </span>
            ) : (
              'Not set'
            )}
          </p>
        </div>
      </div>
      <button
        type='button'
        onClick={() => state.setIsVoiceModalOpen(true)}
        className='text-xs px-3 py-1.5 rounded-md bg-muted border border-border text-foreground hover:bg-border transition-colors'
        data-track-category='PREFERENCES'
        data-track-name='OpenVoiceSignatureModal'
      >
        {state.hasVoiceSignature ? 'Update' : 'Set up'}
      </button>
    </div>
  </div>
);

// ─── Calls ──────────────────────────────────────────────────────────────────

const CallsSection: FC<{ state: PreferencesState }> = ({ state }) => {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const {
    maxHeight: maxCameraHeight,
    isDetecting,
    detect: detectCameraQuality,
  } = useMaxCameraHeight();
  const videoQualityOptions = filterQualityOptionsByMax(
    CALL_MEDIA_QUALITY_OPTIONS,
    maxCameraHeight,
    state.callVideoQuality,
  );

  const handleDisconnectCalendar = async () => {
    setIsDisconnecting(true);
    try {
      await disconnectCalendar('GOOGLE');
      toast.success('Calendar disconnected. Reconnect to grant updated permissions.');
    } catch {
      toast.error('Failed to disconnect calendar. Please try again.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className='space-y-6'>
      <SectionHeader title='Calls' subtitle='Configure your default call join settings' />

      <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
        <div>
          <p className='text-sm font-medium text-foreground'>Join with microphone turned off</p>
          <p className='text-xs text-muted-foreground mt-0.5'>Mute your mic when joining a call</p>
        </div>
        <Switch
          id='call-join-muted'
          checked={state.callJoinMuted}
          onCheckedChange={state.setCallJoinMuted}
        />
      </div>

      <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
        <div>
          <p className='text-sm font-medium text-foreground'>Join with camera turned off</p>
          <p className='text-xs text-muted-foreground mt-0.5'>
            Disable your camera when joining a call
          </p>
        </div>
        <Switch
          id='call-join-without-video'
          checked={state.callJoinWithoutVideo}
          onCheckedChange={state.setCallJoinWithoutVideo}
        />
      </div>

      <div className='p-3 rounded-lg border border-border bg-muted/30 space-y-3'>
        <div>
          <p className='text-sm font-medium text-foreground'>Call media quality</p>
          <p className='text-xs text-muted-foreground mt-0.5'>
            Target capture quality for new camera and screen-share tracks.
          </p>
        </div>
        <QualitySelect
          id='call-video-quality'
          label='Video'
          value={state.callVideoQuality}
          onChange={state.setCallVideoQuality}
          options={videoQualityOptions}
          disabled={maxCameraHeight === null}
          action={
            maxCameraHeight === null && (
              <Tooltip content="Detect your camera's max supported resolution" side='top'>
                <Button
                  type='button'
                  variant='outline'
                  size='iconSm'
                  disabled={isDetecting}
                  onClick={detectCameraQuality}
                  aria-label='Detect camera quality'
                  data-track-category='PREFERENCES'
                  data-track-name='DetectCameraQuality'
                >
                  {isDetecting ? (
                    <Spinner className='size-3.5 animate-spin' />
                  ) : (
                    <ResolutionQualityHd className='size-4' />
                  )}
                </Button>
              </Tooltip>
            )
          }
        />
        <QualitySelect
          id='call-screen-share-quality'
          label='Screen share'
          value={state.callScreenShareQuality}
          onChange={state.setCallScreenShareQuality}
        />
      </div>

      <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
        <div>
          <p className='text-sm font-medium text-foreground'>Use new recording experience</p>
          <p className='text-xs text-muted-foreground mt-0.5'>
            {state.canSwitchRecordingVersion
              ? 'Switch between the classic and redesigned recording interface on this device.'
              : 'Stop the active recording before switching experiences.'}
          </p>
        </div>
        <Switch
          id='recording-version-v2'
          aria-label='Use new recording experience'
          checked={state.recordingVersion === 'v2'}
          disabled={!state.canSwitchRecordingVersion}
          onCheckedChange={checked => state.setRecordingVersion(checked ? 'v2' : 'v1')}
        />
      </div>

      <MenuBarIconToggle />

      <RecordingPillToggle />

      {/* Calendar connection */}
      <div className='pt-2'>
        <p className='text-sm font-semibold text-foreground'>Calendar</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          Disconnect to revoke access and reconnect with updated permissions.
        </p>
      </div>
      <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
        <div>
          <p className='text-sm font-medium text-foreground'>Disconnect Calendar</p>
          <p className='text-xs text-muted-foreground mt-0.5'>
            Stops calendar sync and clears the stored connection.
          </p>
        </div>
        <Button
          variant='outline'
          size='sm'
          disabled={isDisconnecting}
          onClick={() => void handleDisconnectCalendar()}
          trackId='disconnect_calendar'
          data-track-category='PREFERENCES'
          data-track-name='DisconnectCalendar'
        >
          {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
        </Button>
      </div>
    </div>
  );
};

const RecordingsSection: FC<{ state: PreferencesState }> = ({ state }) => (
  <div className='space-y-6'>
    <SectionHeader
      title='Recordings'
      subtitle='Configure how your recording summaries are generated'
    />

    <div className='p-3 rounded-lg border border-border bg-muted/30 space-y-3'>
      <div>
        <p className='text-sm font-medium text-foreground'>LLM summary generation model</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          Which model tier generates your recording summaries and titles. Fast is quicker; Thinking
          is higher quality but slower.
        </p>
      </div>
      <RadioGroup
        value={state.summaryModelPreference}
        onChange={value =>
          state.setSummaryModelPreference(value === 'thinking' ? 'thinking' : 'fast')
        }
      >
        <Radio value='fast'>Fast (default)</Radio>
        <Radio value='thinking'>Thinking &mdash; higher quality, slower</Radio>
      </RadioGroup>
    </div>
  </div>
);

// ─── Messaging ──────────────────────────────────────────────────────────────
// Section is desktop-only (see NAV_ITEMS), so no isMobile branching needed.
const MessagingSection: FC<{ state: PreferencesState }> = ({ state }) => (
  <div className='space-y-4'>
    <SectionHeader title='Messaging' subtitle='Configure message composition and link behavior' />
    <div className='p-3 rounded-lg border border-border bg-muted/30 space-y-3'>
      <p className='text-sm font-medium text-foreground'>
        When writing a message, press <KeyCap>Enter</KeyCap> to&hellip;
      </p>
      <RadioGroup
        value={state.enterSendsMessage ? 'send' : 'newline'}
        onChange={value => state.setEnterSendsMessage(value === 'send')}
      >
        <Radio value='send'>Send the message</Radio>
        <Radio value='newline'>
          Start a new line (use <KeyCap>Shift</KeyCap> / <KeyCap>⌘</KeyCap> + <KeyCap>Enter</KeyCap>{' '}
          to send)
        </Radio>
      </RadioGroup>
    </div>
    <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
      <div>
        <p className='text-sm font-medium text-foreground'>Open formatting by default</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          Show the formatting toolbar automatically in channel and thread message composers
        </p>
      </div>
      <Switch
        id='default-formatting-toolbar-open'
        checked={state.defaultFormattingToolbarOpen}
        onCheckedChange={state.setDefaultFormattingToolbarOpen}
      />
    </div>
    <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
      <div>
        <p className='text-sm font-medium text-foreground'>
          Allow @channel/@here in thread replies
        </p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          When enabled, your thread replies can notify many channel members
        </p>
      </div>
      <Switch
        id='allow-thread-broadcast-mentions'
        checked={state.allowThreadBroadcastMentions}
        onCheckedChange={state.setAllowThreadBroadcastMentions}
      />
    </div>
    <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
      <div>
        <p className='text-sm font-medium text-foreground'>Show thread tags</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          Display what kind of thread each conversation is — issue, question, request — beside the
          message
        </p>
      </div>
      <Switch
        id='show-thread-tags'
        checked={state.showThreadTags}
        onCheckedChange={state.setShowThreadTags}
      />
    </div>
    {linkOpenPrefIsRelevant() && (
      <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
        <div>
          <p className='text-sm font-medium text-foreground'>Open links in external browser</p>
          <p className='text-xs text-muted-foreground mt-0.5'>
            {state.linksOpenExternalByDefault
              ? 'Click opens externally · ⌘/Ctrl-click opens in the app browser'
              : 'Click opens in the app browser · ⌘/Ctrl-click opens externally'}
          </p>
        </div>
        <Switch
          id='links-open-external-by-default'
          checked={state.linksOpenExternalByDefault}
          onCheckedChange={state.setLinksOpenExternalByDefault}
        />
      </div>
    )}
  </div>
);

// ─── Launch ─────────────────────────────────────────────────────────────────
const LaunchSection: FC<{ state: PreferencesState }> = ({ state }) => (
  <div className='space-y-4'>
    <SectionHeader title='Launch' subtitle='Configure your startup experience' />
    <div className='p-3 rounded-lg border border-border bg-muted/30'>
      <div className='flex items-center justify-between gap-4'>
        <div>
          <p className='text-sm font-medium text-foreground'>Open AI on launch</p>
          <p className='text-xs text-muted-foreground mt-0.5'>
            Start with the Xyne AI landing page instead of chat
          </p>
        </div>
        <Switch
          id='ai-landing-default'
          checked={state.aiLandingDefault}
          onCheckedChange={state.setAiLandingDefault}
        />
      </div>
      <DailyBriefToggle available={state.aiLandingDefault} />
      <div className='mt-3 border-t border-border pt-3'>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <p className='text-sm font-medium text-foreground'>Collapse sidebar for apps</p>
            <p className='mt-0.5 text-xs text-muted-foreground'>
              Hide the sidebar when a chat is building an app
            </p>
          </div>
          <Switch
            id='app-mode-collapse-sidebar'
            checked={state.appModeCollapseSidebar}
            onCheckedChange={state.setAppModeCollapseSidebar}
          />
        </div>
      </div>
    </div>
  </div>
);

// ─── Claw ───────────────────────────────────────────────────────────────────
const ClawSection: FC = () => (
  <div className='space-y-4'>
    <SectionHeader title='Claw' subtitle='How you reach Claw and where it lives' />
    <ClawOverlayToggle />
  </div>
);

// ─── Calendar ───────────────────────────────────────────────────────────────
const CalendarSection: FC<{ state: PreferencesState }> = ({ state }) => (
  <div className='space-y-4'>
    <SectionHeader title='Calendar' subtitle='Configure your calendar visibility' />
    <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
      <div>
        <p className='text-sm font-medium text-foreground'>Calendar visibility</p>
        <p className='text-xs text-muted-foreground mt-0.5'>Make your calendar visible to others</p>
      </div>
      <Switch
        id='call-visibility'
        checked={(state.calendarVisibility ?? state.serverCalendarVisibility) !== 'PRIVATE'}
        onCheckedChange={state.updateCalendarVisibility}
      />
    </div>
  </div>
);

// ─── Password ───────────────────────────────────────────────────────────────
const PasswordSection: FC = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    setError('');
    setSuccess('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiInstance.post('/v2/auth/email/change-password', { currentPassword, newPassword });
      setSuccess('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      if (err instanceof Error && err.message) {
        setError(err.message);
      } else {
        setError('Failed to update password');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className='space-y-4'>
      <SectionHeader title='Password' subtitle='Manage your account password' />

      <div className='space-y-4'>
        <div className='space-y-3'>
          <div className='relative'>
            <input
              type={showCurrent ? 'text' : 'password'}
              placeholder='Current password'
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className='w-full px-3 py-2 pr-10 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              data-track-category='PREFERENCES'
              data-track-name='CurrentPasswordInput'
            />
            <button
              type='button'
              onClick={() => setShowCurrent(!showCurrent)}
              className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'
              data-track-category='PREFERENCES'
              data-track-name='ToggleShowCurrentPassword'
            >
              {showCurrent ? <EyeOff className='size-4' /> : <Eye className='size-4' />}
            </button>
          </div>

          <div className='relative'>
            <input
              type={showNew ? 'text' : 'password'}
              placeholder='New password (min 8 characters)'
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className='w-full px-3 py-2 pr-10 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              data-track-category='PREFERENCES'
              data-track-name='NewPasswordInput'
            />
            <button
              type='button'
              onClick={() => setShowNew(!showNew)}
              className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'
              data-track-category='PREFERENCES'
              data-track-name='ToggleShowNewPassword'
            >
              {showNew ? <EyeOff className='size-4' /> : <Eye className='size-4' />}
            </button>
          </div>

          <div className='relative'>
            <input
              type={showConfirm ? 'text' : 'password'}
              placeholder='Confirm new password'
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className='w-full px-3 py-2 pr-10 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              data-track-category='PREFERENCES'
              data-track-name='ConfirmPasswordInput'
            />
            <button
              type='button'
              onClick={() => setShowConfirm(!showConfirm)}
              className='absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'
              data-track-category='PREFERENCES'
              data-track-name='ToggleShowConfirmPassword'
            >
              {showConfirm ? <EyeOff className='size-4' /> : <Eye className='size-4' />}
            </button>
          </div>

          {error && <p className='text-sm text-destructive'>{error}</p>}
          {success && <p className='text-sm text-green-600 dark:text-green-400'>{success}</p>}
        </div>

        <Button
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || !currentPassword || !newPassword || !confirmPassword}
          className='w-full'
          trackId='update_password'
          data-track-category='PREFERENCES'
          data-track-name='UpdatePassword'
        >
          {isSubmitting ? 'Updating...' : 'Update Password'}
        </Button>
      </div>
    </div>
  );
};

// ─── Developer ──────────────────────────────────────────────────────────────
const DeveloperSection: FC<{ state: PreferencesState }> = ({ state }) => {
  const { isMobile } = usePlatform();
  return (
    <div className='space-y-4'>
      <SectionHeader title='Developer' subtitle='Debug settings and app information' />
      <div className='space-y-3'>
        <IntentSuggestionsToggle />

        <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
          <p className='text-sm font-medium text-foreground'>Show send indicators</p>
          <Switch
            id='show-send-indicators'
            checked={state.debugSettings.showSendIndicators}
            onCheckedChange={state.toggleSendIndicators}
          />
        </div>

        {!isMobile && (
          <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
            <div>
              <p className='text-sm font-medium text-foreground'>Show Claw Agents</p>
              <p className='text-xs text-muted-foreground mt-0.5'>
                Show the Claw Agents option in the Spaces sidebar.
              </p>
            </div>
            <Switch
              id='show-claw-agents'
              checked={state.showClawDashboard}
              onCheckedChange={state.setShowClawDashboard}
            />
          </div>
        )}

        {detectReactNativeWebView() && (
          <Button
            type='button'
            variant='outline'
            className='w-full rounded-3xl h-[44px] border-border'
            onClick={() => reactNativeBridge.requestNativeShell('profile_menu')}
            data-track-category='PREFERENCES'
            data-track-name='RequestNativeShell'
          >
            Switch to native app
          </Button>
        )}

        <button
          onClick={state.openChangelog}
          className='w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-muted/30 hover:bg-muted transition-colors'
          data-track-category='PREFERENCES'
          data-track-name='OpenChangelog'
        >
          <span className='text-sm font-medium text-foreground'>Changelog</span>
          <span className='inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400'>
            NEW
          </span>
        </button>

        <div className='text-xs flex flex-col gap-1.5 text-muted-foreground p-3 rounded-lg border border-border bg-muted/30'>
          <div>Version: {__APP_VERSION__}</div>
          {logger.zeroClientId && (
            <button
              onClick={() => state.copyClientId(logger.zeroClientId!, 'Client ID')}
              className='flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer text-left'
              data-track-category='PREFERENCES'
              data-track-name='CopyClientId'
            >
              <span>Client ID: {logger.zeroClientId}</span>
              <Copy className='size-3' />
            </button>
          )}
          {logger.zeroClientGroupId && (
            <button
              onClick={() => state.copyClientId(logger.zeroClientGroupId!, 'Client Group ID')}
              className='flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer text-left'
              data-track-category='PREFERENCES'
              data-track-name='CopyClientGroupId'
            >
              <span>Client Group ID: {logger.zeroClientGroupId}</span>
              <Copy className='size-3' />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Toolbar ────────────────────────────────────────────────────────────────
const ToolbarSection: FC<{ state: PreferencesState }> = () => {
  const items = useVisibleNavigationItems();
  const { toolbarPaths, setInToolbar } = useToolbarItems();

  return (
    <div className='space-y-4'>
      <SectionHeader
        title='Toolbar'
        subtitle='Choose which items appear in your sidebar. Hidden items stay available under “More”.'
      />
      <div className='flex flex-col gap-1.5'>
        {items.map(item => {
          const Icon = item.icon;
          const required = isRequiredToolbarPath(item.path);
          const checked = required || toolbarPaths.has(item.path);
          return (
            <div
              key={item.path}
              className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'
            >
              <div className='flex items-center gap-3 min-w-0'>
                <div className='flex items-center justify-center size-8 rounded-md bg-muted border border-border shrink-0 text-muted-foreground'>
                  <Icon className='size-4' />
                </div>
                <p className='text-sm font-medium text-foreground truncate'>{item.label}</p>
              </div>
              <div className='flex items-center gap-2.5 shrink-0'>
                {required && <span className='text-xs text-muted-foreground'>Always on</span>}
                <Switch
                  aria-label={`Show ${item.label} in toolbar`}
                  checked={checked}
                  disabled={required}
                  onCheckedChange={value => setInToolbar(item.path, value)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Section registry ───────────────────────────────────────────────────────
const SECTIONS: Record<PreferenceSection, FC<{ state: PreferencesState }>> = {
  appearance: AppearanceSection,
  notifications: NotificationsSection,
  availability: AvailabilitySection,
  voice: VoiceSection,
  calls: CallsSection,
  recordings: RecordingsSection,
  messaging: MessagingSection,
  launch: LaunchSection,
  claw: ClawSection as FC<{ state: PreferencesState }>,
  toolbar: ToolbarSection,
  calendar: CalendarSection,
  password: PasswordSection as FC<{ state: PreferencesState }>,
  developer: DeveloperSection,
};

// ════════════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════════════
const Preferences = ({ open, onClose, initialSection }: PreferencesProps): ReactElement => {
  const { isMobile } = usePlatform();
  const state = usePreferencesState(open);
  const navItems = useMemo(() => {
    const electronOnly = new Set<PreferenceSection>();
    return NAV_ITEMS.filter(item => {
      if (isMobile && item.desktopOnly) return false;
      if (!isElectronApp() && electronOnly.has(item.id)) return false;
      return true;
    });
  }, [isMobile]);
  const defaultSection: PreferenceSection | null = isMobile ? null : 'appearance';
  const [activeSection, setActiveSection] = useState<PreferenceSection | null>(
    initialSection ?? defaultSection,
  );

  const { setIsAssignmentModalOpen, setIsVoiceModalOpen } = state;

  useEffect(() => {
    if (open) {
      setActiveSection(initialSection ?? defaultSection);
      setIsAssignmentModalOpen(false);
      setIsVoiceModalOpen(false);
    }
  }, [
    open,
    isMobile,
    initialSection,
    defaultSection,
    setIsAssignmentModalOpen,
    setIsVoiceModalOpen,
  ]);

  const handleOpenChange = (next: boolean): void => {
    if (!next) onClose();
  };

  const ActiveSection = SECTIONS[activeSection ?? 'appearance'];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        title='Preferences'
        description='User preferences settings'
        className='max-w-3xl p-0 overflow-hidden'
        // Don't let focus land on the destructive close (X) — the first focusable element — when
        // opened by keyboard (e.g. via the `/goto` command); keep it on the dialog itself.
        onOpenAutoFocus={e => e.preventDefault()}
      >
        {isMobile ? (
          /* Mobile: list → detail drill-down */
          <div className='flex flex-col w-full bg-background'>
            <div className='sticky top-0 z-10 bg-background p-4 flex items-center justify-between gap-3 border-b border-border'>
              {activeSection !== null ? (
                <button
                  onClick={() => setActiveSection(null)}
                  className='p-1 rounded-md hover:bg-muted transition-colors'
                  aria-label='Back to preferences list'
                  data-track-category='PREFERENCES'
                  data-track-name='BackToList'
                >
                  <ChevronLeft className='size-5 text-muted-foreground' />
                </button>
              ) : (
                <h1 className='text-lg font-semibold text-foreground'>Preferences</h1>
              )}
              <Button
                variant='ghost'
                size='sm'
                onClick={onClose}
                className='!p-2 border border-border rounded-md hover:bg-accent'
                title='Close'
                data-track-category='PREFERENCES'
                data-track-name='Close'
              >
                <X className='size-4' />
              </Button>
            </div>

            {activeSection === null ? (
              <nav className='flex flex-col py-2'>
                {navItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className='flex items-center gap-3 px-6 py-3 hover:bg-muted transition-colors text-left w-full'
                    data-track-category='PREFERENCES'
                    data-track-name={`Open_${item.id}`}
                  >
                    <div className='flex items-center justify-center w-8 h-8 rounded-md bg-muted border border-border flex-shrink-0 text-muted-foreground'>
                      {item.icon}
                    </div>
                    <div className='flex-1 min-w-0'>
                      <p className='text-sm font-medium text-foreground'>{item.label}</p>
                    </div>
                    <ChevronRight className='size-4 text-muted-foreground flex-shrink-0' />
                  </button>
                ))}
              </nav>
            ) : (
              <div className='p-6'>
                <ActiveSection state={state} />
              </div>
            )}
          </div>
        ) : (
          /* Desktop: persistent left-nav + right detail */
          <div className='flex flex-col h-[75vh]'>
            <div className='flex items-center justify-between px-4 py-3 border-b border-border shrink-0'>
              <p className='text-base font-semibold text-foreground'>Preferences</p>
              <button
                onClick={onClose}
                className='p-1.5 rounded-md hover:bg-muted transition-colors'
                aria-label='Close preferences'
                data-track-category='PREFERENCES'
                data-track-name='Close'
              >
                <X className='size-4 text-muted-foreground' />
              </button>
            </div>

            <div className='flex flex-1 overflow-hidden'>
              <div
                role='tablist'
                aria-label='Preference sections'
                className='w-52 shrink-0 border-r border-border flex flex-col p-2 gap-0.5'
              >
                {navItems.map(item => {
                  const isActive = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      role='tab'
                      aria-selected={isActive}
                      onClick={() => setActiveSection(item.id)}
                      className={cn(
                        'flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors text-left w-full',
                        isActive
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                      data-track-category='PREFERENCES'
                      data-track-name={`Open_${item.id}`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  );
                })}
              </div>

              <div role='tabpanel' className='flex-1 overflow-y-auto px-6 py-5'>
                <ActiveSection state={state} />
              </div>
            </div>
          </div>
        )}
      </Dialog>

      {(state.isActiveInAtLeastOneGroup || state.isCurrentlyUnavailable) && (
        <UpdateAssignmentStatusModal
          isOpen={state.isAssignmentModalOpen}
          onClose={() => state.setIsAssignmentModalOpen(false)}
        />
      )}
      <VoiceSignatureModal
        open={state.isVoiceModalOpen}
        onOpenChange={state.setIsVoiceModalOpen}
        hasVoiceSignature={state.hasVoiceSignature}
      />
    </>
  );
};

export default Preferences;
