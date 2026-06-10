import { FC, ReactElement, ReactNode, useEffect, useMemo, useState } from 'react';
import {
  X,
  Palette,
  Bell,
  PauseCircle,
  Mic,
  MessageSquare,
  Zap,
  Code2,
  Copy,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Search,
  Monitor,
  Smartphone,
  LayoutGrid,
} from 'lucide-react';
import { NotificationLevel } from '@xyne/shared';
import { format } from 'date-fns';

import { Dialog } from '../../ui/Dialog/Dialog';
import { Switch } from '../../ui/Switch';
import { RadioGroup, Radio } from '../../ui/RadioGroup';
import { Button } from '../../ui/Button/Button';

import { usePlatform } from '../../../hooks/usePlatform';
import type { Theme } from '../../../hooks/useTheme';

import { cn } from '../../../utils/classNames';
import { isElectronApp } from '../../../utils/electronApp';
import { detectReactNativeWebView, reactNativeBridge } from '../../../utils/reactNativeBridge';
import { linkOpenPrefIsRelevant } from '../../../utils/openLink';
import { logger } from '../../../utils/logger';

import { MeetingDetectionToggle } from '../MeetingDetectionToggle';
import { UpdateAssignmentStatusModal } from '../../AppSidebar/UpdateAssignmentStatusModal';
import { VoiceSignatureModal } from '../VoiceSignatureModal/VoiceSignatureModal';
import { useGlobalNotificationSettings } from '../../../hooks/useGlobalNotificationSettings';

import { usePreferencesState, type PreferencesState } from '../../../hooks/usePreferencesState';
import { useVisibleNavigationItems } from '../../../hooks/useVisibleNavigationItems';
import { useToolbarItems } from '../../../hooks/useToolbarItems';
import { isRequiredToolbarPath } from '../../AppSidebar/navigationConfig';
import type { PreferenceSection, PreferencesProps, NavItem } from '.';

// ─── Constants ──────────────────────────────────────────────────────────────
const NAV_ITEMS: NavItem[] = [
  { id: 'appearance', label: 'Appearance', icon: <Palette className='size-4' /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className='size-4' /> },
  { id: 'availability', label: 'Availability', icon: <PauseCircle className='size-4' /> },
  { id: 'voice', label: 'Voice', icon: <Mic className='size-4' /> },
  {
    id: 'messaging',
    label: 'Messaging',
    icon: <MessageSquare className='size-4' />,
    desktopOnly: true,
  },
  { id: 'launch', label: 'Launch', icon: <Zap className='size-4' />, desktopOnly: true },
  { id: 'search', label: 'Search', icon: <Search className='size-4' /> },
  {
    id: 'toolbar',
    label: 'Toolbar',
    icon: <LayoutGrid className='size-4' />,
    desktopOnly: true,
  },
  { id: 'calendar', label: 'Calendar', icon: <Calendar className='size-4' /> },
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
                  ? '2px solid var(--sidebar-badge-accent)'
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
              <button
                key={level.value}
                onClick={() => settings.update({ globalDesktopNotificationLevel: level.value })}
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
              </button>
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
              <button
                key={level.value}
                onClick={() => settings.update({ globalMobileNotificationLevel: level.value })}
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
              </button>
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

// ─── Messaging ──────────────────────────────────────────────────────────────
// Section is desktop-only (see NAV_ITEMS), so no isMobile branching needed.
const MessagingSection: FC<{ state: PreferencesState }> = ({ state }) => {
  const { isMac } = usePlatform();
  const cmdKey = isMac ? '⌘' : 'Ctrl';
  return (
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
            Start a new line (use <KeyCap>{cmdKey}</KeyCap> + <KeyCap>Enter</KeyCap> to send)
          </Radio>
        </RadioGroup>
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
};

// ─── Launch ─────────────────────────────────────────────────────────────────
const LaunchSection: FC<{ state: PreferencesState }> = ({ state }) => (
  <div className='space-y-4'>
    <SectionHeader title='Launch' subtitle='Configure your startup experience' />
    <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
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

// ─── Developer ──────────────────────────────────────────────────────────────
const DeveloperSection: FC<{ state: PreferencesState }> = ({ state }) => {
  const { isMobile } = usePlatform();
  return (
    <div className='space-y-4'>
      <SectionHeader title='Developer' subtitle='Debug settings and app information' />
      <div className='space-y-3'>
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
            <p className='text-sm font-medium text-foreground'>Use Ask AI v2</p>
            <Switch
              id='ask-ai-version'
              checked={state.askAIVersion === 'v2'}
              onCheckedChange={checked => state.setAskAIVersion(checked ? 'v2' : 'v1')}
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

// ─── Search ─────────────────────────────────────────────────────────────────
const SearchSection: FC<{ state: PreferencesState }> = ({ state }) => (
  <div className='space-y-4'>
    <SectionHeader
      title='Search'
      subtitle='Choose how search opens when you click the search bar or press ⌘K'
    />
    <div className='p-3 rounded-lg border border-border bg-muted/30 space-y-3'>
      <RadioGroup
        value={state.searchMode}
        onChange={value => state.setSearchMode(value as 'popup' | 'screen')}
      >
        <Radio value='popup' subtext='Opens a floating modal — fast navigation and inline results'>
          Quick search popup
        </Radio>
        <Radio
          value='screen'
          subtext='Opens the search results page with filters for type, sender, channel, and sort'
        >
          Full search screen
        </Radio>
      </RadioGroup>
    </div>
  </div>
);

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
  messaging: MessagingSection,
  launch: LaunchSection,
  search: SearchSection,
  toolbar: ToolbarSection,
  calendar: CalendarSection,
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
