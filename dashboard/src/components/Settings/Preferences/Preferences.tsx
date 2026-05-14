import { FC, ReactElement, useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { format } from 'date-fns';

import { Dialog } from '../../ui/Dialog/Dialog';
import { Switch } from '../../ui/Switch';
import { Button } from '../../ui/Button/Button';

import { usePlatform } from '../../../hooks/usePlatform';
import type { Theme } from '../../../hooks/useTheme';

import { cn } from '../../../utils/classNames';
import { isElectronApp } from '../../../utils/electronApp';
import { detectReactNativeWebView, reactNativeBridge } from '../../../utils/reactNativeBridge';
import { logger } from '../../../utils/logger';

import { MeetingDetectionToggle } from '../MeetingDetectionToggle';
import { UpdateAssignmentStatusModal } from '../../AppSidebar/UpdateAssignmentStatusModal';
import { VoiceSignatureModal } from '../VoiceSignatureModal/VoiceSignatureModal';

import { usePreferencesState, type PreferencesState } from '../../../hooks/usePreferencesState';
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
const NotificationsSection: FC = () => (
  <div className='space-y-4'>
    <SectionHeader title='Notifications' subtitle='Manage your notification preferences' />
    <MeetingDetectionToggle />
  </div>
);

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
const MessagingSection: FC<{ state: PreferencesState }> = ({ state }) => (
  <div className='space-y-4'>
    <SectionHeader title='Messaging' subtitle='Configure message composition behavior' />
    <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
      <div>
        <p className='text-sm font-medium text-foreground'>Press Enter to send</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          {state.enterSendsMessage
            ? 'Shift + Enter starts a new line'
            : 'Shift + Enter sends the message'}
        </p>
      </div>
      <Switch
        id='enter-sends-message'
        checked={state.enterSendsMessage}
        onCheckedChange={state.setEnterSendsMessage}
      />
    </div>
  </div>
);

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
        <div className='p-3 rounded-lg border border-border bg-muted/30'>
          <Switch
            id='show-send-indicators'
            checked={state.debugSettings.showSendIndicators}
            onCheckedChange={state.toggleSendIndicators}
            label='Show send indicators'
          />
        </div>

        {!isMobile && (
          <div className='p-3 rounded-lg border border-border bg-muted/30'>
            <Switch
              id='ask-ai-version'
              checked={state.askAIVersion === 'v2'}
              onCheckedChange={checked => state.setAskAIVersion(checked ? 'v2' : 'v1')}
              label='Use Ask AI v2'
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

// ─── Section registry ───────────────────────────────────────────────────────
const SECTIONS: Record<PreferenceSection, FC<{ state: PreferencesState }>> = {
  appearance: AppearanceSection,
  notifications: NotificationsSection,
  availability: AvailabilitySection,
  voice: VoiceSection,
  messaging: MessagingSection,
  launch: LaunchSection,
  calendar: CalendarSection,
  developer: DeveloperSection,
};

// ════════════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════════════
const Preferences = ({ open, onClose }: PreferencesProps): ReactElement => {
  const { isMobile } = usePlatform();
  const state = usePreferencesState(open);
  const navItems = useMemo(() => {
    const electronOnly = new Set<PreferenceSection>(['notifications']);
    return NAV_ITEMS.filter(item => {
      if (isMobile && item.desktopOnly) return false;
      if (!isElectronApp() && electronOnly.has(item.id)) return false;
      return true;
    });
  }, [isMobile]);
  const [activeSection, setActiveSection] = useState<PreferenceSection | null>(
    isMobile ? null : 'appearance',
  );

  const { setIsAssignmentModalOpen, setIsVoiceModalOpen } = state;

  useEffect(() => {
    if (open) {
      setActiveSection(isMobile ? null : 'appearance');
      setIsAssignmentModalOpen(false);
      setIsVoiceModalOpen(false);
    }
  }, [open, isMobile, setIsAssignmentModalOpen, setIsVoiceModalOpen]);

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
                    <div className='flex items-center justify-center w-8 h-8 rounded-md bg-muted border border-border flex-shrink-0'>
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
