import { useState, useRef, useEffect, useMemo } from 'react';
import { REACTION_EMOJIS } from '../hooks/useReactions';
import {
  Users,
  Link as LinkIcon,
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  MessageSquare,
  MessageCircleMore,
  Volume2,
  ChevronUp,
  Bot,
  Pencil,
  MoreVertical,
  PencilRuler,
  SmilePlus,
  ImagePlus,
  Hand,
  NotepadText,
} from 'lucide-react';
import { useMediaDeviceSelect } from '@livekit/components-react';
import { cn } from '../../../utils/classNames';
import { useSelector } from '@xstate/react';
import { roomActor } from '../../../machines/roomMachine';
import { useDrawStore, sendDrawEvent } from '../../../hooks/useDrawStore';
import {
  CALL_WHITEBOARD_TOPIC,
  sendCallWhiteboardEvent,
  type CallWhiteboardWireMessage,
  useCallWhiteboardStore,
} from '../../../stores/callWhiteboardStore';
import { DeviceSelector } from '../DeviceSelector/DeviceSelector';
import { usePlatform } from '../../../hooks/usePlatform';
import { useShortcutById, useShortcut } from '../../../shortcuts';
import { InvitationResponse, type Call, type RecordingType } from '@xyne/shared';
import { RecordingButton } from './RecordingButton';
import { MarkMomentButton } from './MarkMomentButton';
import {
  buildCallInviteText,
  getAiButtonColorClass,
  getAiButtonDisabled,
  getAiControlState,
  getAiButtonTitle,
  handleAiButtonClick,
} from '../../../utils/callControls';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import Tooltip from '../../ui/Tooltip';
import { ShortcutHint } from '../../ui/ShortcutHint';
import {
  ControlBadge,
  ControlButton,
  controlClassName,
  controlIconProps,
  controlStyle,
  type ControlSizing,
} from './ControlButton';

import { XyneTelepresenceIcon } from '../../../assets/icons/XyneTelepresenceIcon';

type ActiveCallForControls = Pick<
  Call,
  | 'externalId'
  | 'createdByUserId'
  | 'title'
  | 'status'
  | 'startsAt'
  | 'endsAt'
  | 'startedAt'
  | 'endedAt'
  | 'timezone'
> & {
  participants?: Array<{ userId: string; displayName?: string | null; response?: string | null }>;
};

interface CallControlsProps {
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  /** True when any participant (local or remote) is sharing their screen */
  isAnySharingScreen?: boolean;
  isChatOpen: boolean;
  isParticipantsSidebarOpen: boolean;
  isNotesOpen?: boolean | undefined;
  /** Omit to hide the notes button (e.g. external users) */
  onToggleNotes?: (() => void) | undefined;
  isAIAssistantEnabled: boolean;
  aiController: { id: string; name: string } | null;
  localParticipantId: string | null;
  callId: string;
  roomLink: string;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onDisconnect: () => void;
  onToggleChat: () => void;
  onToggleParticipantsSidebar: () => void;
  onToggleAIAssistant: () => void;
  onRequestControl?: (() => void) | undefined;
  onSendReaction?: (emoji: string) => void;
  viewMode?: 'mini' | 'full';
  iconSize?: number;
  buttonPadding?: number;
  showMicMenu?: boolean;
  onToggleMicMenu?: () => void;
  requestedAiController: boolean;
  pendingControlRequest: { requesterId: string; requesterName: string } | null;
  isCallChatOpen?: boolean | undefined;
  onToggleCallChat?: (() => void) | undefined;
  unreadCallChatCount?: number | undefined;
  hideThreadChat?: boolean | undefined;
  hideAIAssistant?: boolean | undefined;
  isExternalUser?: boolean | undefined;
  /** Whether this user is the call host (can start/stop recording) */
  isHost?: boolean | undefined;
  /** Whether recording is currently active */
  isRecording?: boolean | undefined;
  /** Whether the current user may stop the active recording (only the starter can) */
  canStopRecording?: boolean | undefined;
  onStartRecording?: ((type: RecordingType) => void | Promise<void>) | undefined;
  onStopRecording?: (() => void | Promise<void>) | undefined;
  onTogglePresentationMode?: (() => void) | undefined;
  isPresentationMode?: boolean | undefined;
  hidePresentationMode?: boolean | undefined;
  /** Full view: left-hand meeting details (clock, title), Meet's bottom-left corner. */
  infoSlot?: React.ReactNode;
  /** Full view: raise / lower hand, offered in the ⋮ menu. */
  isHandRaised?: boolean | undefined;
  onToggleHandRaise?: (() => void) | undefined;
}

export function CallControls({
  isMicEnabled,
  isCameraEnabled,
  isScreenSharing,
  isAnySharingScreen = false,
  isChatOpen,
  isParticipantsSidebarOpen,
  isNotesOpen = false,
  onToggleNotes,
  isAIAssistantEnabled,
  aiController,
  localParticipantId,
  callId: callId,
  roomLink,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onDisconnect,
  onToggleChat,
  onToggleParticipantsSidebar,
  onToggleAIAssistant,
  onRequestControl,
  onSendReaction,
  viewMode = 'full',
  iconSize = 20,
  buttonPadding = 16,
  pendingControlRequest,
  requestedAiController,
  isCallChatOpen,
  onToggleCallChat,
  unreadCallChatCount = 0,
  hideThreadChat = false,
  hideAIAssistant = false,
  hidePresentationMode = false,
  isExternalUser = false,
  isRecording = false,
  canStopRecording = true,
  onStartRecording,
  onStopRecording,
  onTogglePresentationMode,
  isPresentationMode = false,
  infoSlot,
  isHandRaised = false,
  onToggleHandRaise,
}: CallControlsProps): React.ReactElement {
  const [showCopied, setShowCopied] = useState(false);
  const [showCameraMenu, setShowCameraMenu] = useState(false);
  const [showMicMenu, setShowMicMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const { isMobile } = usePlatform();

  const micMenuRef = useRef<HTMLDivElement>(null);
  const cameraMenuRef = useRef<HTMLDivElement>(null);
  const room = useSelector(roomActor, state => state.context.room);
  const isBackgroundBlurEnabled = useSelector(
    roomActor,
    state => state.context.isBackgroundBlurEnabled,
  );
  const isDrawingEnabled = useDrawStore(s => s.isDrawingEnabled);
  const isWhiteboardOpen = useCallWhiteboardStore(s => s.isOpen);

  const hostControls = useSelector(roomActor, state => state.context.hostControls);
  // AI voice talk-back needs STT, so the button is hidden while transcription is off.
  const isTranscriptionEnabled = useSelector(
    roomActor,
    state => state.context.isTranscriptionEnabled,
  );
  const externalId = useSelector(roomActor, state => state.context.externalId);
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const currentCall = useMemo(() => {
    return (activeCalls as ActiveCallForControls[]).find(c => c.externalId === externalId);
  }, [activeCalls, externalId]);
  const isHost = !!localParticipantId && currentCall?.createdByUserId === localParticipantId;

  const hostName = useMemo(() => {
    const hostId = currentCall?.createdByUserId;
    if (!hostId) return null;
    return currentCall?.participants?.find(p => p.userId === hostId)?.displayName ?? null;
  }, [currentCall?.createdByUserId, currentCall?.participants]);

  // All participants in the call can admit/decline, so everyone sees the pending count.
  const requestedParticipantCount = useMemo(() => {
    return (
      currentCall?.participants?.filter(p => p.response === InvitationResponse.REQUESTED).length ??
      0
    );
  }, [currentCall?.participants]);
  const audioTurnedOffByHost = !isHost && hostControls.turnOffAudio;
  const cameraTurnedOffByHost = !isHost && hostControls.turnOffCamera;
  const screenShareTurnedOffByHost = !isHost && hostControls.turnOffScreenShare;
  const screenShareBlockedByWhiteboard = isWhiteboardOpen;
  const micTooltip = audioTurnedOffByHost
    ? "The host turned off everyone's audio"
    : isMicEnabled
      ? 'Turn off microphone'
      : 'Turn on microphone (or hold spacebar to speak)';
  const cameraTooltip = cameraTurnedOffByHost
    ? "The host turned off everyone's camera"
    : isCameraEnabled
      ? 'Turn off camera'
      : 'Turn on camera';
  const screenShareTooltip = screenShareBlockedByWhiteboard
    ? 'Close the shared whiteboard to start screen sharing.'
    : screenShareTurnedOffByHost
      ? 'The host turned off screen sharing'
      : isScreenSharing
        ? 'Stop presenting'
        : 'Present now';
  const handleScreenShareClick = (): void => {
    if (screenShareTurnedOffByHost || screenShareBlockedByWhiteboard) return;
    onToggleScreenShare();
  };

  // Keyboard shortcuts: ⌘D toggles mute, ⌘E toggles video
  useShortcutById('huddle.toggleMute', onToggleMic);
  useShortcutById('huddle.toggleVideo', onToggleCamera);

  // Push-to-talk functionality using spacebar
  const isPushToTalkActive = useSelector(
    roomActor,
    state => state.context.pushToTalkState === 'active',
  );

  // Register spacebar for push-to-talk with high priority
  // Only works when mic is currently muted
  useShortcut(
    'space',
    () => {
      roomActor.send({ type: 'PUSH_TO_TALK_START' });
    },
    {
      scope: 'global',
      priority: 200,
      allowInInputs: false,
      preventDefault: true,
      description: 'Push-to-talk (hold spacebar to unmute)',
      category: 'Huddle',
      when: () => !isMicEnabled,
    },
  );

  // Listen for keyup to end push-to-talk
  useEffect(() => {
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' && isPushToTalkActive) {
        roomActor.send({ type: 'PUSH_TO_TALK_END' });
      }
    };

    window.addEventListener('keyup', handleKeyUp);
    return () => window.removeEventListener('keyup', handleKeyUp);
  }, [isPushToTalkActive]);

  const { isController, isControlledByOther, hasPendingRequestFromOther, isRequestingUser } =
    getAiControlState({ localParticipantId, aiController, pendingControlRequest });

  // Use LiveKit's device selection hooks
  const {
    devices: audioDevices,
    activeDeviceId: activeAudioId,
    setActiveMediaDevice: setActiveAudioDevice,
  } = useMediaDeviceSelect({ kind: 'audioinput', ...(room && { room }) });
  const {
    devices: speakerDevices,
    activeDeviceId: activeSpeakerId,
    setActiveMediaDevice: setActiveSpeakerDevice,
  } = useMediaDeviceSelect({ kind: 'audiooutput', ...(room && { room }) });
  const {
    devices: videoDevices,
    activeDeviceId: activeCameraId,
    setActiveMediaDevice: setActiveCameraDevice,
  } = useMediaDeviceSelect({ kind: 'videoinput', ...(room && { room }) });

  // Close dropdowns and reaction picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (micMenuRef.current && !micMenuRef.current.contains(event.target as Node)) {
        setShowMicMenu(false);
      }
      if (cameraMenuRef.current && !cameraMenuRef.current.contains(event.target as Node)) {
        setShowCameraMenu(false);
      }
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(event.target as Node)) {
        setShowReactionPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopyInviteLink = (): void => {
    if (!roomLink) return;
    const text = buildCallInviteText({
      title: currentCall?.title,
      hostName,
      roomLink,
      status: currentCall?.status,
      startsAt: currentCall?.startsAt,
      endsAt: currentCall?.endsAt,
      startedAt: currentCall?.startedAt,
      endedAt: currentCall?.endedAt,
      timezone: currentCall?.timezone,
    });
    void copyTextToClipboard(text).then(() => {
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    });
  };

  const isFullView = viewMode === 'full';
  // The mini window scales controls with its width; full view uses fixed Meet sizes.
  const hasCustomSizing = iconSize !== 20 || buttonPadding !== 16;
  const sizing: ControlSizing = { isFullView, hasCustomSizing, iconSize, buttonPadding };
  const menuIconProps = controlIconProps(sizing);
  const popoverClass = 'bg-[#1e1f20] ring-1 ring-white/10 text-[#e3e3e3] shadow-2xl';

  const isAiButtonDisabled = getAiButtonDisabled({
    hasPendingRequestFromOther,
    isRequestingUser,
    requestedAiController,
  });
  const aiButtonTitle = getAiButtonTitle({
    hasPendingRequestFromOther,
    isRequestingUser,
    isControlledByOther,
    isAIAssistantEnabled,
    pendingControlRequest,
    aiController,
  });
  const aiButtonColorClass = getAiButtonColorClass({
    hasPendingRequestFromOther,
    isController,
    isAIAssistantEnabled,
    isControlledByOther,
    defaultControlClass: '',
  });
  const showAiButton = !hideAIAssistant && isTranscriptionEnabled;
  const showPresentationMode = !hidePresentationMode && !!onTogglePresentationMode;

  const publishWhiteboardVisibility = (isOpen: boolean, timestamp: number): void => {
    if (!room) return;
    const message: CallWhiteboardWireMessage = {
      type: 'WHITEBOARD_VISIBILITY',
      participantIdentity: room.localParticipant.identity,
      isOpen,
      timestamp,
    };
    void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), {
      reliable: true,
      topic: CALL_WHITEBOARD_TOPIC,
    });
  };

  const handleWhiteboardClick = (): void => {
    const nextIsOpen = !isWhiteboardOpen;
    const timestamp = Date.now();
    sendCallWhiteboardEvent({ type: 'setOpen', isOpen: nextIsOpen, timestamp });
    publishWhiteboardVisibility(nextIsOpen, timestamp);
  };

  // ── Individual controls ────────────────────────────────────────────────────

  const deviceChevronClass =
    'flex h-11 w-8 flex-shrink-0 items-center justify-center rounded-l-full pl-1 text-[#e3e3e3] transition-colors hover:bg-white/10';

  const micControl = (
    <div className='relative' ref={micMenuRef}>
      <div className={cn('flex items-center rounded-full', isFullView && 'bg-[#333537]')}>
        {isFullView && (
          <button
            type='button'
            onClick={() => setShowMicMenu(!showMicMenu)}
            className={deviceChevronClass}
            aria-label='Audio settings'
            aria-expanded={showMicMenu}
            title='Audio settings'
            data-track-category='CALLS'
            data-track-name='Toggle_Mic_Menu'
            data-track-metadata={JSON.stringify({ showMicMenu: !showMicMenu, callId })}
          >
            <ChevronUp
              className={cn('h-4 w-4 transition-transform', showMicMenu && 'rotate-180')}
            />
          </button>
        )}
        <ControlButton
          sizing={sizing}
          icon={isMicEnabled || isPushToTalkActive ? Mic : MicOff}
          label={micTooltip}
          tooltip={
            audioTurnedOffByHost ? (
              micTooltip
            ) : (
              <span>
                {micTooltip} <ShortcutHint shortcut='huddle.toggleMute' />
              </span>
            )
          }
          tone={isPushToTalkActive ? 'pushToTalk' : isMicEnabled ? 'neutral' : 'off'}
          inactive={audioTurnedOffByHost}
          onClick={onToggleMic}
          disabled={audioTurnedOffByHost}
          aria-pressed={!isMicEnabled}
          data-testid='mic-toggle-button'
          data-track-category='CALLS'
          data-track-name='MIC_TOGGLE'
          data-track-metadata={JSON.stringify({ enabled: isMicEnabled, callId })}
        />
      </div>

      {/* Device picker — a floating strip above the button, like Meet's */}
      {showMicMenu && (
        <div
          className={cn(
            popoverClass,
            'absolute bottom-full z-50 mb-3',
            isMobile ? '-left-2 min-w-[280px] rounded-xl py-2' : 'left-0 rounded-full',
          )}
        >
          <div className={cn('flex', isMobile ? 'flex-col gap-1' : 'gap-2 p-1.5')}>
            <DeviceSelector
              devices={audioDevices}
              currentDeviceId={activeAudioId}
              onDeviceChange={deviceId => void setActiveAudioDevice(deviceId)}
              icon={Mic}
              label='Microphone'
            />
            {isMobile && <div className='h-px w-full bg-white/10' />}
            <DeviceSelector
              devices={speakerDevices}
              currentDeviceId={activeSpeakerId}
              onDeviceChange={deviceId => void setActiveSpeakerDevice(deviceId)}
              icon={Volume2}
              label='Speaker'
            />
          </div>
        </div>
      )}
    </div>
  );

  const cameraControl = (
    <div className='relative' ref={cameraMenuRef}>
      <div className={cn('flex items-center rounded-full', isFullView && 'bg-[#333537]')}>
        {isFullView && (
          <button
            type='button'
            onClick={() => setShowCameraMenu(!showCameraMenu)}
            className={deviceChevronClass}
            aria-label='Video settings'
            aria-expanded={showCameraMenu}
            title='Video settings'
            data-track-category='CALLS'
            data-track-name='Toggle_Camera_Menu'
            data-track-metadata={JSON.stringify({ showCameraMenu: !showCameraMenu, callId })}
          >
            <ChevronUp
              className={cn('h-4 w-4 transition-transform', showCameraMenu && 'rotate-180')}
            />
          </button>
        )}
        <ControlButton
          sizing={sizing}
          icon={isCameraEnabled ? Video : VideoOff}
          label={cameraTooltip}
          tooltip={
            cameraTurnedOffByHost ? (
              cameraTooltip
            ) : (
              <span>
                {cameraTooltip} <ShortcutHint shortcut='huddle.toggleVideo' />
              </span>
            )
          }
          tone={isCameraEnabled ? 'neutral' : 'off'}
          inactive={cameraTurnedOffByHost}
          onClick={onToggleCamera}
          disabled={cameraTurnedOffByHost}
          aria-pressed={!isCameraEnabled}
          data-testid='camera-toggle-button'
          data-track-category='CALLS'
          data-track-name='CAMERA_TOGGLE'
          data-track-metadata={JSON.stringify({ enabled: isCameraEnabled, callId })}
        />
      </div>

      {showCameraMenu && (
        <div
          className={cn(
            popoverClass,
            'absolute bottom-full z-50 mb-3',
            isMobile ? '-left-20 min-w-[280px] rounded-xl py-2' : 'left-0 rounded-full',
          )}
        >
          <div className={cn('flex', isMobile ? 'flex-col gap-1' : 'gap-2 p-1.5')}>
            <DeviceSelector
              devices={videoDevices}
              currentDeviceId={activeCameraId}
              onDeviceChange={deviceId => void setActiveCameraDevice(deviceId)}
              icon={Video}
              label='Camera'
              iconSize={iconSize}
              buttonPadding={buttonPadding}
            />
            {isMobile && <div className='h-px w-full bg-white/10' />}
            <button
              type='button'
              onClick={() => roomActor.send({ type: 'TOGGLE_BACKGROUND_BLUR' })}
              title={isBackgroundBlurEnabled ? 'Turn off background blur' : 'Blur background'}
              data-track-category='CALLS'
              data-track-name='TOGGLE_BACKGROUND_BLUR'
              data-track-metadata={JSON.stringify({
                enabled: !isBackgroundBlurEnabled,
                callId,
              })}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap px-4 py-3 text-sm transition-colors',
                isMobile ? 'w-full rounded-lg' : 'rounded-full',
                isBackgroundBlurEnabled
                  ? 'bg-[#a8c7fa] text-[#062e6f] hover:bg-[#bcd4fb]'
                  : 'bg-[#333537] text-[#e3e3e3] hover:bg-[#404245]',
              )}
            >
              <ImagePlus size={16} />
              <span>Blur background</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const screenShareControl = (
    <ControlButton
      sizing={sizing}
      icon={MonitorUp}
      label={screenShareTooltip}
      tone={isScreenSharing || screenShareBlockedByWhiteboard ? 'active' : 'neutral'}
      inactive={screenShareTurnedOffByHost || screenShareBlockedByWhiteboard}
      onClick={handleScreenShareClick}
      disabled={screenShareTurnedOffByHost && !screenShareBlockedByWhiteboard}
      aria-disabled={screenShareTurnedOffByHost || screenShareBlockedByWhiteboard}
      aria-pressed={isScreenSharing}
      data-track-event='BUTTON_CLICK'
      data-track-category='CALLS'
      data-track-name='TOGGLE_SCREEN_SHARE'
      data-track-metadata={JSON.stringify({ callId, enabled: isScreenSharing })}
    />
  );

  // Recording — any participant can start; only the starter can stop (enforced server-side)
  const recordingControl = (onStartRecording || onStopRecording) && (
    <RecordingButton
      isRecording={isRecording}
      canStopRecording={canStopRecording}
      onStartRecording={onStartRecording}
      onStopRecording={onStopRecording}
      sizing={sizing}
      callId={callId}
    />
  );

  // Lands on the call's timeline once the call ends. Its own component so the
  // Zero-backed hook never mounts for external users (they have no ZeroProvider).
  const markMomentControl = !isExternalUser && (
    <MarkMomentButton
      variant='button'
      externalId={externalId}
      callStartedAtMs={currentCall?.startedAt ?? null}
      isAllowed={isHost && isTranscriptionEnabled}
      callId={callId}
      sizing={sizing}
    />
  );

  // Annotate (Draw) Toggle — only shown when a screen share is active
  const annotateControl = isAnySharingScreen && (
    <ControlButton
      sizing={sizing}
      icon={Pencil}
      label={isDrawingEnabled ? 'Stop annotating' : 'Annotate screen share'}
      tone={isDrawingEnabled ? 'active' : 'neutral'}
      aria-pressed={isDrawingEnabled}
      onClick={() => sendDrawEvent({ type: 'toggleDrawMode' })}
      data-track-event='BUTTON_CLICK'
      data-track-category='CALLS'
      data-track-name='TOGGLE_DRAW_MODE'
      data-track-metadata={JSON.stringify({ callId, enabled: isDrawingEnabled })}
    />
  );

  const reactionsControl = onSendReaction && (
    <div className='relative' ref={reactionPickerRef}>
      <ControlButton
        sizing={sizing}
        icon={SmilePlus}
        label='Send a reaction'
        tone={showReactionPicker ? 'active' : 'neutral'}
        aria-expanded={showReactionPicker}
        onClick={() => setShowReactionPicker(prev => !prev)}
        data-track-category='CALLS'
        data-track-name='TOGGLE_REACTION_PICKER'
      />

      {showReactionPicker && (
        <div
          className={cn(
            'absolute bottom-full left-1/2 z-50 mb-3 flex -translate-x-1/2 gap-0.5 rounded-full p-1.5',
            popoverClass,
          )}
        >
          {REACTION_EMOJIS.map(emoji => (
            <button
              type='button'
              key={emoji}
              onClick={() => {
                onSendReaction(emoji);
                setShowReactionPicker(false);
              }}
              className='transform rounded-full p-2 text-2xl leading-none transition duration-150 hover:scale-125 hover:bg-white/10'
              title={emoji}
              data-ph-capture-attribute-track-id='send_reaction'
              data-track-category='CALLS'
              data-track-name='SEND_REACTION'
              data-track-metadata={JSON.stringify({ emoji, callId })}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const leaveControl = (
    <ControlButton
      sizing={sizing}
      shape='leave'
      icon={PhoneOff}
      label='Leave call'
      onClick={onDisconnect}
      data-testid='end-call-button'
      data-ph-capture-attribute-track-id='end_call'
      data-track-category='CALLS'
      data-track-name='END_CALL'
      data-track-metadata={JSON.stringify({ callId })}
    />
  );

  // Panel toggles: flat icons on the right in full view, discs in the mini window.
  const panelShape = isFullView ? 'flat' : 'round';
  const miniBadgeClass = !isFullView ? 'h-4 min-w-4 text-[9px]' : undefined;

  const peopleControl = (
    <ControlButton
      sizing={sizing}
      shape={panelShape}
      icon={Users}
      label='People'
      tooltip={requestedParticipantCount > 0 ? 'People — someone wants to join' : 'People'}
      tone={isParticipantsSidebarOpen ? 'active' : 'neutral'}
      aria-pressed={isParticipantsSidebarOpen}
      onClick={onToggleParticipantsSidebar}
      data-testid='add-participant-button'
      data-track-event='BUTTON_CLICK'
      data-track-category='CALLS'
      data-track-name='TOGGLE_PARTICIPANTS_SIDEBAR'
      data-track-metadata={JSON.stringify({ isOpen: isParticipantsSidebarOpen })}
    >
      {requestedParticipantCount > 0 && (
        <ControlBadge
          count={requestedParticipantCount}
          className={miniBadgeClass}
          data-testid='participants-request-count'
        />
      )}
    </ControlButton>
  );

  const callChatControl = onToggleCallChat && (
    <ControlButton
      sizing={sizing}
      shape={panelShape}
      icon={MessageCircleMore}
      iconStyle={{ transform: 'scaleX(-1)' }}
      label='Chat with everyone'
      tone={isCallChatOpen ? 'active' : 'neutral'}
      aria-pressed={!!isCallChatOpen}
      onClick={onToggleCallChat}
      data-track-category='CALLS'
      data-track-name='TOGGLE_CALL_CHAT'
    >
      {unreadCallChatCount > 0 && (
        <ControlBadge
          count={unreadCallChatCount}
          className={isFullView ? 'right-0.5 top-1' : miniBadgeClass}
        />
      )}
    </ControlButton>
  );

  // Shared notes canvas (series-wide for recurring calls).
  const notesControl = onToggleNotes && (
    <ControlButton
      sizing={sizing}
      icon={NotepadText}
      label='Notes'
      tone={isNotesOpen ? 'active' : 'neutral'}
      aria-pressed={isNotesOpen}
      onClick={onToggleNotes}
      data-testid='call-notes-button'
      data-track-event='BUTTON_CLICK'
      data-track-category='CALLS'
      data-track-name='TOGGLE_CALL_NOTES'
      data-track-metadata={JSON.stringify({ callId, isOpen: isNotesOpen })}
    />
  );

  const threadChatControl = !hideThreadChat && (
    <ControlButton
      sizing={sizing}
      shape={panelShape}
      icon={MessageSquare}
      label='Thread chat'
      tone={isChatOpen ? 'active' : 'neutral'}
      aria-pressed={isChatOpen}
      onClick={onToggleChat}
      data-track-category='CALLS'
      data-track-name='TOGGLE_CHAT'
      data-track-metadata={JSON.stringify({ callId: callId, isOpen: isChatOpen })}
    />
  );

  // AI Assistant (mini window; the full view has it in the People panel). Hidden
  // while transcription is off — talk-back depends on STT.
  const aiControl = showAiButton && (
    <ControlButton
      sizing={sizing}
      shape={panelShape}
      icon={Bot}
      label={aiButtonTitle}
      inactive={hasPendingRequestFromOther}
      className={aiButtonColorClass}
      onClick={() =>
        handleAiButtonClick({
          hasPendingRequestFromOther,
          isControlledByOther,
          onRequestControl,
          onToggleAIAssistant,
        })
      }
      disabled={isAiButtonDisabled}
      data-track-category='CALLS'
      data-track-name='AI_Assistant'
      data-track-metadata={JSON.stringify({
        isControlledByOther,
        hasPendingRequest: hasPendingRequestFromOther,
      })}
    >
      {isControlledByOther && !hasPendingRequestFromOther && (
        <span className='absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-[#131314] bg-[#dc362e]' />
      )}
    </ControlButton>
  );

  const copyInviteControl = (
    <ControlButton
      sizing={sizing}
      shape={panelShape}
      icon={LinkIcon}
      label={
        roomLink ? 'Copy joining info — works for teammates and guests' : 'Preparing invite link…'
      }
      inactive={!roomLink}
      onClick={handleCopyInviteLink}
      disabled={!roomLink}
      data-track-category='CALLS'
      data-track-name='SHARE_CALL_LINK'
      data-track-metadata={JSON.stringify({ callId, isExternalUser })}
    >
      {showCopied && (
        <span className='absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#e3e3e3] px-3 py-1.5 text-xs font-medium text-[#1f1f1f] shadow-lg'>
          Joining info copied
        </span>
      )}
    </ControlButton>
  );

  const presentationModeControl = showPresentationMode && (
    <ControlButton
      sizing={sizing}
      icon={XyneTelepresenceIcon}
      label={isPresentationMode ? 'Exit presentation mode' : 'Enter presentation mode'}
      tone={isPresentationMode ? 'active' : 'neutral'}
      aria-pressed={isPresentationMode}
      onClick={onTogglePresentationMode}
      data-track-category='CALLS'
      data-track-name='TOGGLE_PRESENTATION_MODE'
      data-track-metadata={JSON.stringify({ callId, isEnabled: isPresentationMode })}
    />
  );

  // ── Mini window: one compact row ───────────────────────────────────────────

  if (!isFullView) {
    const gapClass = iconSize < 16 ? 'gap-1' : 'gap-1.5';
    return (
      <div className={cn('flex flex-nowrap items-center justify-center', gapClass)}>
        {micControl}
        {cameraControl}
        {screenShareControl}
        {recordingControl}
        {markMomentControl}
        {annotateControl}
        {callChatControl}
        {peopleControl}
        {copyInviteControl}
        {reactionsControl}
        {aiControl}
        {notesControl}
        {threadChatControl}
        {presentationModeControl}
        {leaveControl}
      </div>
    );
  }

  // ── Full view: Meet's three-zone bar ───────────────────────────────────────
  // Left: meeting details. Centre: media controls + leave. Right: panel toggles.
  // People (with host controls and the AI agent) and Minimize live in the top bar.
  // Below `lg` the right-hand toggles fold into the ⋮ menu; below `sm` so do the
  // secondary centre controls, keeping the bar to one row on a phone.

  const menuItemClass =
    'cursor-pointer gap-3 rounded-lg px-3 py-2.5 text-sm text-[#e3e3e3] focus:bg-white/10 focus:text-white data-[disabled]:opacity-50';
  const menuIcon = (iconComponent: React.ElementType, isActive = false): React.ReactElement => {
    const Icon = iconComponent;
    return (
      <Icon className={cn('h-4 w-4', isActive ? 'text-[#a8c7fa]' : 'text-[#c4c7c5]')} aria-hidden />
    );
  };

  const moreMenu = (
    <DropdownMenu modal={false}>
      <Tooltip content='More options' side='top' sideOffset={10}>
        <span className='inline-flex flex-shrink-0'>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              aria-label='More options'
              className={controlClassName({ sizing })}
              style={controlStyle(sizing)}
              data-track-event='BUTTON_CLICK'
              data-track-category='CALLS'
              data-track-name='OPEN_CALL_TOOLS_MENU'
              data-track-metadata={JSON.stringify({ callId })}
            >
              <MoreVertical className={menuIconProps.className} style={menuIconProps.style} />
            </button>
          </DropdownMenuTrigger>
        </span>
      </Tooltip>
      <DropdownMenuContent
        side='top'
        align='end'
        sideOffset={12}
        className='w-64 rounded-xl border-white/10 bg-[#1e1f20] p-1 text-[#e3e3e3] shadow-2xl'
      >
        {onToggleHandRaise && (
          <DropdownMenuItem
            onClick={onToggleHandRaise}
            className={menuItemClass}
            data-track-category='CALLS'
            data-track-name='TOGGLE_HAND_RAISE'
            data-track-metadata={JSON.stringify({ raised: !isHandRaised, callId })}
          >
            {menuIcon(Hand, isHandRaised)}
            <span>{isHandRaised ? 'Lower hand' : 'Raise hand'}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={handleWhiteboardClick}
          className={cn(menuItemClass, isWhiteboardOpen && 'bg-white/10')}
          data-track-event='BUTTON_CLICK'
          data-track-category='CALLS'
          data-track-name='TOGGLE_WHITEBOARD'
          data-track-metadata={JSON.stringify({ callId, enabled: isWhiteboardOpen })}
        >
          {menuIcon(PencilRuler, isWhiteboardOpen)}
          <span>{isWhiteboardOpen ? 'Close whiteboard' : 'Open whiteboard'}</span>
        </DropdownMenuItem>
        {showPresentationMode && (
          <DropdownMenuItem
            onClick={onTogglePresentationMode}
            className={menuItemClass}
            data-track-category='CALLS'
            data-track-name='TOGGLE_PRESENTATION_MODE'
            data-track-metadata={JSON.stringify({ callId, isEnabled: isPresentationMode })}
          >
            {menuIcon(XyneTelepresenceIcon, isPresentationMode)}
            <span>{isPresentationMode ? 'Exit presentation mode' : 'Presentation mode'}</span>
          </DropdownMenuItem>
        )}
        {/* Lands on the call's timeline once the call ends. Creator-only mutator, and a
            flag is only useful next to a transcript. External users have no ZeroProvider. */}
        {!isExternalUser && (
          <MarkMomentButton
            variant='menuItem'
            externalId={externalId}
            callStartedAtMs={currentCall?.startedAt ?? null}
            isAllowed={isHost && isTranscriptionEnabled}
            callId={callId}
            menuItemClassName={menuItemClass}
          />
        )}

        {/* Controls that live in the bar on wider screens */}
        <DropdownMenuSeparator className='bg-white/10 lg:hidden' />
        {onToggleCallChat && (
          <DropdownMenuItem
            onClick={onToggleCallChat}
            className={cn(menuItemClass, 'lg:hidden')}
            data-track-category='CALLS'
            data-track-name='TOGGLE_CALL_CHAT'
          >
            {menuIcon(MessageCircleMore, isCallChatOpen)}
            <span className='flex-1'>Chat with everyone</span>
            {unreadCallChatCount > 0 && (
              <span className='rounded-full bg-[#dc362e] px-1.5 text-[10px] font-semibold text-white'>
                {unreadCallChatCount > 99 ? '99+' : unreadCallChatCount}
              </span>
            )}
          </DropdownMenuItem>
        )}
        {onToggleNotes && (
          <DropdownMenuItem
            onClick={onToggleNotes}
            className={cn(menuItemClass, 'sm:hidden')}
            data-track-event='BUTTON_CLICK'
            data-track-category='CALLS'
            data-track-name='TOGGLE_CALL_NOTES'
            data-track-metadata={JSON.stringify({ callId, isOpen: isNotesOpen })}
          >
            {menuIcon(NotepadText, isNotesOpen)}
            <span>Notes</span>
          </DropdownMenuItem>
        )}
        {!hideThreadChat && (
          <DropdownMenuItem
            onClick={onToggleChat}
            className={cn(menuItemClass, 'lg:hidden')}
            data-track-category='CALLS'
            data-track-name='TOGGLE_CHAT'
            data-track-metadata={JSON.stringify({ callId, isOpen: isChatOpen })}
          >
            {menuIcon(MessageSquare, isChatOpen)}
            <span>Thread chat</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={handleCopyInviteLink}
          disabled={!roomLink}
          className={cn(menuItemClass, 'lg:hidden')}
          data-track-category='CALLS'
          data-track-name='SHARE_CALL_LINK'
          data-track-metadata={JSON.stringify({ callId, isExternalUser })}
        >
          {menuIcon(LinkIcon)}
          <span>Copy joining info</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className='flex h-16 w-full items-center justify-center gap-4 px-3 sm:h-20 sm:px-4 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'>
      <div className='hidden min-w-0 items-center lg:flex'>{infoSlot}</div>

      <div className='flex flex-nowrap items-center justify-center gap-2 sm:gap-3'>
        {micControl}
        {cameraControl}
        {screenShareControl}
        <div className='hidden items-center gap-2 sm:flex sm:gap-3'>
          {recordingControl}
          {reactionsControl}
          {notesControl}
        </div>
        {annotateControl}
        {moreMenu}
        {leaveControl}
      </div>

      <div className='hidden items-center justify-end gap-0.5 lg:flex'>
        {copyInviteControl}
        {callChatControl}
        {threadChatControl}
      </div>
    </div>
  );
}
