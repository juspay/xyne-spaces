import { useState, useSyncExternalStore } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';

import { useTheme } from './useTheme';
import { useAILandingDefault } from './useAILandingDefault';
import { useAppModeCollapseSidebar } from './useAppModeCollapseSidebar';
import { useDebugSettings } from './useDebugSettings';
import { useEnterSendsMessage } from './useEnterSendsMessage';
import { useDefaultFormattingToolbarOpen } from './useDefaultFormattingToolbarOpen';
import { useShowThreadTags } from './useShowThreadTags';
import { useSummaryModelPreference } from './useSummaryModelPreference';
import { useSearchMode } from './useSearchMode';
import { useThreadBroadcastMentions } from './useThreadBroadcastMentions';
import { useCallJoinSettings } from './useCallJoinSettings';
import { useClawDashboardVisibility } from './useClawDashboardVisibility';
import { useCallMediaQualitySettings } from './useCallMediaQualitySettings';
import { useRecordingDefaultLayout } from './useRecordingDefaultLayout';
import { useRecordingVersion } from './useRecordingVersion';
import { useRecordingStore } from './useRecordingStore';
import {
  getLinkOpenExternalDefault,
  setLinkOpenExternalDefault,
  subscribeLinkOpenPref,
} from '../utils/openLink';
import { useZero } from './useZero';
import { useSelf } from './useUsers';
import { useCurrentUserAssignmentState } from './useAssignmentState';
import { useCachedQuery } from './useCachedQuery';

import { isElectronApp } from '../utils/electronApp';
import { webviewActor } from '../machines/webviewMachine';
import { mutators } from '../zero/mutators';
import { queries } from '../zero/queries';
import { apiInstance } from '../services/clients/apiClient';

export function usePreferencesState(enabled: boolean) {
  const user = useSelf();
  const zero = useZero();
  const serverCalendarVisibility = (user as { calendarVisibility?: string } | null)
    ?.calendarVisibility;
  const [calendarVisibility, setCalendarVisibilityState] = useState<string | undefined>(
    serverCalendarVisibility,
  );
  const { theme, changeTheme } = useTheme();
  const { aiLandingDefault, setAiLandingDefault } = useAILandingDefault();
  const { appModeCollapseSidebar, setAppModeCollapseSidebar } = useAppModeCollapseSidebar();
  const { settings: debugSettings, toggleSendIndicators } = useDebugSettings();
  const { enterSendsMessage, setEnterSendsMessage } = useEnterSendsMessage();
  const { defaultFormattingToolbarOpen, setDefaultFormattingToolbarOpen } =
    useDefaultFormattingToolbarOpen();
  const { showThreadTags, setShowThreadTags } = useShowThreadTags();
  const { summaryModelPreference, setSummaryModelPreference } = useSummaryModelPreference();
  const { searchMode } = useSearchMode();
  const { showClawDashboard, setShowClawDashboard } = useClawDashboardVisibility();
  const { allowThreadBroadcastMentions, setAllowThreadBroadcastMentions } =
    useThreadBroadcastMentions();
  const {
    joinMuted: callJoinMuted,
    joinWithoutVideo: callJoinWithoutVideo,
    setJoinMuted: setCallJoinMuted,
    setJoinWithoutVideo: setCallJoinWithoutVideo,
  } = useCallJoinSettings();
  const {
    videoQuality: callVideoQuality,
    screenShareQuality: callScreenShareQuality,
    setVideoQuality: setCallVideoQuality,
    setScreenShareQuality: setCallScreenShareQuality,
  } = useCallMediaQualitySettings();
  const { recordingDefaultLayout, setRecordingDefaultLayout } = useRecordingDefaultLayout();
  const { recordingVersion, setRecordingVersion } = useRecordingVersion();
  const recordingStatus = useRecordingStore(context => context.status);
  const canSwitchRecordingVersion = recordingStatus === 'idle' || recordingStatus === 'error';
  const linksOpenExternalByDefault = useSyncExternalStore(
    subscribeLinkOpenPref,
    getLinkOpenExternalDefault,
  );
  const { isCurrentlyUnavailable, unavailableUntil, isActiveInAtLeastOneGroup } =
    useCurrentUserAssignmentState();

  const [userProfile] = useCachedQuery(queries.getUserProfile({ userId: user?.id ?? '' }), {
    enabled: !!user?.id && enabled,
  });
  const hasVoiceSignature = userProfile?.hasVoiceSignature ?? false;

  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);

  const resumeAssignment = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    if (!user?.id) return;
    void apiInstance
      .post('/user-assignment-state/toggle', { isUnavailable: false })
      .then(() => {
        zero.mutate(
          mutators.userPresence.upsert({
            assignmentUnavailableUntil: null,
            timestamp: Date.now(),
            presenceId: uuidv4(),
          }),
        );
      })
      .catch(() => toast.error('Failed to resume assignment'));
  };

  const openChangelog = (e: React.MouseEvent): void => {
    const changelogUrl = import.meta.env.VITE_API_URL.replace('/api', '/changelog');
    if (isElectronApp()) {
      if (e.metaKey || e.ctrlKey) {
        window.electronAPI?.openExternal?.(changelogUrl);
      } else {
        webviewActor.send({ type: 'ADD_TAB', url: changelogUrl });
        webviewActor.send({ type: 'OPEN' });
      }
    } else {
      window.open(changelogUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const copyClientId = (id: string, label: string): void => {
    navigator.clipboard
      .writeText(id)
      .then(() => toast.success(`${label} copied to clipboard`))
      .catch(() => toast.error(`Failed to copy ${label}`));
  };

  const updateCalendarVisibility = (checked: boolean): void => {
    const next = checked ? 'PUBLIC' : 'PRIVATE';
    const prev = calendarVisibility;
    setCalendarVisibilityState(next);
    void apiInstance.patch('/users/me/calendar-visibility', { visibility: next }).catch(() => {
      setCalendarVisibilityState(prev);
      toast.error('Failed to update calendar visibility');
    });
  };

  return {
    user,
    theme,
    changeTheme,
    aiLandingDefault,
    appModeCollapseSidebar,
    setAppModeCollapseSidebar,
    setAiLandingDefault,
    debugSettings,
    toggleSendIndicators,
    enterSendsMessage,
    defaultFormattingToolbarOpen,
    setDefaultFormattingToolbarOpen,
    showThreadTags,
    setShowThreadTags,
    summaryModelPreference,
    setSummaryModelPreference,
    setEnterSendsMessage,
    searchMode,
    showClawDashboard,
    setShowClawDashboard,
    allowThreadBroadcastMentions,
    setAllowThreadBroadcastMentions,
    linksOpenExternalByDefault,
    setLinksOpenExternalByDefault: setLinkOpenExternalDefault,
    hasVoiceSignature,
    isCurrentlyUnavailable,
    unavailableUntil,
    isActiveInAtLeastOneGroup,
    isAssignmentModalOpen,
    setIsAssignmentModalOpen,
    isVoiceModalOpen,
    setIsVoiceModalOpen,
    resumeAssignment,
    openChangelog,
    copyClientId,
    calendarVisibility,
    serverCalendarVisibility,
    updateCalendarVisibility,
    callJoinMuted,
    callJoinWithoutVideo,
    setCallJoinMuted,
    setCallJoinWithoutVideo,
    callVideoQuality,
    callScreenShareQuality,
    setCallVideoQuality,
    setCallScreenShareQuality,
    recordingDefaultLayout,
    setRecordingDefaultLayout,
    recordingVersion,
    setRecordingVersion,
    canSwitchRecordingVersion,
  };
}

export type PreferencesState = ReturnType<typeof usePreferencesState>;
