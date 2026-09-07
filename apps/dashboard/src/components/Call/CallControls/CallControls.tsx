import { useState, useRef, useEffect, useMemo } from 'react';
import { REACTION_EMOJIS } from '../hooks/useReactions';
import {
  Users,
  Share2,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  PhoneOff,
  Maximize2,
  Minimize2,
  MessageSquare,
  MessageCircleMore,
  Volume2,
  ChevronUp,
  Bot,
  Pencil,
  MoreVertical,
  PencilRuler,
  SmilePlus,
  UserCog,
  ImagePlus,
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
import { InvitationResponse, type RecordingType } from '@xyne/shared';
import { RecordingButton } from './RecordingButton';
import {
  getAiButtonColorClass,
  getAiButtonDisabled,
  getAiButtonTitle,
  handleAiButtonClick,
} from '../../../utils/callControls';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import Tooltip from '../../ui/Tooltip';
import { ShortcutHint } from '../../ui/ShortcutHint';

import { XyneTelepresenceIcon } from '../../../assets/icons/XyneTelepresenceIcon';

interface ActiveCallForControls {
  externalId: string;
  createdByUserId?: string;
  participants?: Array<{ response?: string | null }>;
}

interface CallControlsProps {
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  /** True when any participant (local or remote) is sharing their screen */
  isAnySharingScreen?: boolean;
  isChatOpen: boolean;
  isParticipantsSidebarOpen: boolean;
  isHostControlsOpen?: boolean | undefined;
  onToggleHostControls?: (() => void) | undefined;
  isAIAssistantEnabled: boolean;
  aiController: { id: string; name: string } | null;
  localParticipantId: string | null;
  callId: string;
  roomLink: string;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onDisconnect: () => void;
  onToggleView: () => void;
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
  hideMinimize?: boolean | undefined;
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
}

export function CallControls({
  isMicEnabled,
  isCameraEnabled,
  isScreenSharing,
  isAnySharingScreen = false,
  isChatOpen,
  isParticipantsSidebarOpen,
  isHostControlsOpen = false,
  onToggleHostControls,
  isAIAssistantEnabled,
  aiController,
  localParticipantId,
  callId: callId,
  roomLink,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onDisconnect,
  onToggleView,
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
  hideMinimize = false,
  hidePresentationMode = false,
  isExternalUser = false,
  isRecording = false,
  canStopRecording = true,
  onStartRecording,
  onStopRecording,
  onTogglePresentationMode,
  isPresentationMode = false,
}: CallControlsProps): React.ReactElement {
  const [showCopied, setShowCopied] = useState(false);
  const [showCameraMenu, setShowCameraMenu] = useState(false);
  const [showMicMenu, setShowMicMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const { isMobile } = usePlatform();

  const micMenuRef = useRef<HTMLDivElement>(null);
  const cameraMenuRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
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
      ? 'Mute microphone'
      : 'Unmute microphone (or press spacebar to speak)';
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
        ? 'Stop sharing'
        : 'Share screen';
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

  // Check if current user is the controller
  const isController = localParticipantId === aiController?.id;
  const isControlledByOther = Boolean(aiController && !isController);

  // Check if someone else has a pending request (disable request button)
  const hasPendingRequestFromOther = Boolean(
    pendingControlRequest && pendingControlRequest.requesterId !== localParticipantId,
  );
  const isRequestingUser = Boolean(
    pendingControlRequest && pendingControlRequest.requesterId === localParticipantId,
  );

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

  const handleMicDeviceChange = async (deviceId: string): Promise<void> => {
    await setActiveAudioDevice(deviceId);
    // Keep the main menu open so user can see the selection
  };

  const handleSpeakerDeviceChange = async (deviceId: string): Promise<void> => {
    await setActiveSpeakerDevice(deviceId);
    // Keep the main menu open so user can see the selection
  };

  const handleCameraDeviceChange = async (deviceId: string): Promise<void> => {
    await setActiveCameraDevice(deviceId);
    // Keep the main menu open so user can see the selection
  };

  const handleCopyInviteLink = (): void => {
    if (!roomLink) return;
    void navigator.clipboard.writeText(roomLink).then(() => {
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    });
  };

  // Determine if custom sizing is being used (for mini view with dynamic sizing)
  const hasCustomSizing = iconSize !== 20 || buttonPadding !== 16;
  const isCompactControls = viewMode === 'mini' || hasCustomSizing;
  const buttonClasses = cn(
    'rounded-full transition-all duration-200 transform hover:scale-110 shadow-lg flex-shrink-0',
    !hasCustomSizing && 'p-2.5 sm:p-4',
  );
  const requestCountBadgeClasses = cn(
    'absolute top-[14%] right-[14%] translate-x-1/2 -translate-y-1/2 px-1 flex items-center justify-center bg-red-500 text-white font-bold rounded-full border border-gray-900',
    isCompactControls ? 'min-w-[16px] h-[16px] text-[9px]' : 'min-w-[22px] h-[22px] text-[11px]',
  );
  const midnightControlClass = 'bg-gray-700 hover:bg-gray-600 text-white';
  const midnightControlGroupClass = 'bg-gray-700 border border-gray-600';
  const midnightPopoverClass = 'bg-gray-700 border border-gray-600 text-white';
  const midnightSeparatorClass = 'bg-gray-600';

  // Calculate button gap based on iconSize
  const gapClass = iconSize < 16 ? 'gap-1' : iconSize < 20 ? 'gap-1.5' : 'gap-1 sm:gap-1.5';

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
    defaultControlClass: midnightControlClass,
  });

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

  const toggleWhiteboardFromMiniView = (): void => {
    const nextIsOpen = !isWhiteboardOpen;
    const timestamp = Date.now();
    sendCallWhiteboardEvent({ type: 'setOpen', isOpen: nextIsOpen, timestamp });
    publishWhiteboardVisibility(nextIsOpen, timestamp);
  };

  const handleWhiteboardClick = (): void => {
    if (viewMode === 'mini') {
      toggleWhiteboardFromMiniView();
      return;
    }

    const nextIsOpen = !isWhiteboardOpen;
    const timestamp = Date.now();
    sendCallWhiteboardEvent({ type: 'setOpen', isOpen: nextIsOpen, timestamp });
    publishWhiteboardVisibility(nextIsOpen, timestamp);
  };

  const callToolMenuItems = [
    {
      id: 'whiteboard',
      label: isWhiteboardOpen ? 'Close whiteboard' : 'Open whiteboard',
      icon: PencilRuler,
      isActive: isWhiteboardOpen,
      onSelect: handleWhiteboardClick,
      trackName: 'TOGGLE_WHITEBOARD',
    },
  ];

  return (
    <>
      <div ref={controlsRef} className={`flex items-center justify-center ${gapClass} flex-nowrap`}>
        {/* Microphone Toggle with Device Selector */}
        <div className='relative' ref={micMenuRef}>
          <div className={cn('flex items-center gap-0.5 rounded-full', midnightControlGroupClass)}>
            <Tooltip
              content={
                audioTurnedOffByHost ? (
                  micTooltip
                ) : (
                  <span>
                    {micTooltip} <ShortcutHint shortcut='huddle.toggleMute' />
                  </span>
                )
              }
              side='top'
              sideOffset={8}
              collisionPadding={8}
              className={cn(
                'whitespace-normal text-center leading-snug',
                viewMode === 'mini' ? 'max-w-44' : 'max-w-64',
              )}
            >
              <span className='inline-flex flex-shrink-0'>
                <button
                  onClick={onToggleMic}
                  disabled={audioTurnedOffByHost}
                  className={cn(
                    'rounded-full transition-all duration-200 transform hover:scale-110 shadow-lg flex-shrink-0',
                    !hasCustomSizing && 'p-2.5 sm:p-4',
                    isPushToTalkActive
                      ? 'bg-green-500 hover:bg-green-600 text-white shadow-green-500/50 ring-4 ring-green-500/30'
                      : isMicEnabled
                        ? midnightControlClass
                        : 'bg-red-600 hover:bg-red-700 text-white shadow-red-900/40',
                    audioTurnedOffByHost && 'opacity-50 cursor-not-allowed hover:scale-100',
                  )}
                  style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
                  aria-label={micTooltip}
                  data-testid='mic-toggle-button'
                  data-track-category='CALLS'
                  data-track-name='MIC_TOGGLE'
                  data-track-metadata={JSON.stringify({ enabled: isMicEnabled, callId })}
                >
                  {isMicEnabled || isPushToTalkActive ? (
                    <Mic
                      className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
                      style={
                        hasCustomSizing
                          ? { width: `${iconSize}px`, height: `${iconSize}px` }
                          : undefined
                      }
                    />
                  ) : (
                    <MicOff
                      className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
                      style={
                        hasCustomSizing
                          ? { width: `${iconSize}px`, height: `${iconSize}px` }
                          : undefined
                      }
                    />
                  )}
                </button>
              </span>
            </Tooltip>
            {viewMode === 'full' && (
              <button
                onClick={() => setShowMicMenu(!showMicMenu)}
                className='text-[#f2f2f2] flex-shrink-0 p-1.5 sm:p-2 transition-transform'
                title='Select audio devices'
                data-track-category='CALLS'
                data-track-name='Toggle_Mic_Menu'
                data-track-metadata={JSON.stringify({ showMicMenu: !showMicMenu, callId })}
              >
                <ChevronUp
                  className={cn(
                    'w-3 h-3 sm:w-4 sm:h-4 transition-transform',
                    showMicMenu && 'rotate-180',
                  )}
                />
              </button>
            )}
          </div>

          {/* Main Menu - Shows Mic and Speaker Options */}
          {showMicMenu && (
            <div
              className={cn(
                midnightPopoverClass,
                'shadow-xl',
                isMobile
                  ? 'absolute bottom-full mb-2 -left-2 min-w-[280px] py-2 rounded-xl'
                  : 'absolute bottom-full mb-2 left-0 rounded-full',
              )}
            >
              <div className={cn('flex', isMobile ? 'flex-col gap-1' : 'p-1.5 gap-2 rounded-3xl')}>
                <DeviceSelector
                  devices={audioDevices}
                  currentDeviceId={activeAudioId}
                  onDeviceChange={deviceId => {
                    void handleMicDeviceChange(deviceId);
                  }}
                  icon={Mic}
                  label='Microphone'
                />
                {isMobile && <div className='w-full bg-border h-px' />}
                <DeviceSelector
                  devices={speakerDevices}
                  currentDeviceId={activeSpeakerId}
                  onDeviceChange={deviceId => {
                    void handleSpeakerDeviceChange(deviceId);
                  }}
                  icon={Volume2}
                  label='Speaker'
                />
              </div>
            </div>
          )}
        </div>

        {/* Camera Toggle with Device Selector */}
        <div className='relative' ref={cameraMenuRef}>
          <div className={cn('flex items-center gap-0.5 rounded-full', midnightControlGroupClass)}>
            <Tooltip
              content={
                cameraTurnedOffByHost ? (
                  cameraTooltip
                ) : (
                  <span>
                    {cameraTooltip} <ShortcutHint shortcut='huddle.toggleVideo' />
                  </span>
                )
              }
              side='top'
              sideOffset={8}
              collisionPadding={8}
              className={cn(
                'whitespace-normal text-center leading-snug',
                viewMode === 'mini' ? 'max-w-44' : 'max-w-64',
              )}
            >
              <span className='inline-flex flex-shrink-0'>
                <button
                  onClick={onToggleCamera}
                  disabled={cameraTurnedOffByHost}
                  className={cn(
                    'rounded-full transition-all duration-200 transform hover:scale-110 shadow-lg flex-shrink-0',
                    !hasCustomSizing && 'p-2.5 sm:p-4',
                    isCameraEnabled
                      ? midnightControlClass
                      : 'bg-red-600 hover:bg-red-700 text-white shadow-red-900/40',
                    cameraTurnedOffByHost && 'opacity-50 cursor-not-allowed hover:scale-100',
                  )}
                  style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
                  aria-label={cameraTooltip}
                  data-testid='camera-toggle-button'
                  data-track-category='CALLS'
                  data-track-name='CAMERA_TOGGLE'
                  data-track-metadata={JSON.stringify({ enabled: isCameraEnabled, callId })}
                >
                  {isCameraEnabled ? (
                    <Video
                      className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
                      style={
                        hasCustomSizing
                          ? { width: `${iconSize}px`, height: `${iconSize}px` }
                          : undefined
                      }
                    />
                  ) : (
                    <VideoOff
                      className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
                      style={
                        hasCustomSizing
                          ? { width: `${iconSize}px`, height: `${iconSize}px` }
                          : undefined
                      }
                    />
                  )}
                </button>
              </span>
            </Tooltip>
            {viewMode === 'full' && (
              <button
                onClick={() => {
                  setShowCameraMenu(!showCameraMenu);
                }}
                className='text-[#f2f2f2] flex-shrink-0 p-1.5 sm:p-2 transition-transform'
                title='Select camera'
                data-track-category='CALLS'
                data-track-name='Toggle_Camera_Menu'
                data-track-metadata={JSON.stringify({ showCameraMenu: !showCameraMenu, callId })}
              >
                <ChevronUp
                  className={cn(
                    'w-3 h-3 sm:w-4 sm:h-4 transition-transform',
                    showCameraMenu && 'rotate-180',
                  )}
                />
              </button>
            )}
          </div>

          {/* Camera Menu - Shows current camera and device list option */}
          {showCameraMenu && (
            <div
              className={cn(
                midnightPopoverClass,
                'shadow-xl',
                isMobile
                  ? 'absolute bottom-full mb-2 -left-20 min-w-[280px] py-2 rounded-xl'
                  : 'absolute bottom-full mb-2 left-0 rounded-full',
              )}
            >
              <div className={cn('flex', isMobile ? 'flex-col gap-1' : 'p-1.5 gap-2 rounded-3xl')}>
                <DeviceSelector
                  devices={videoDevices}
                  currentDeviceId={activeCameraId}
                  onDeviceChange={deviceId => {
                    void handleCameraDeviceChange(deviceId);
                  }}
                  icon={Video}
                  label='Camera'
                  iconSize={iconSize}
                  buttonPadding={buttonPadding}
                />
                {isMobile && <div className={cn('w-full h-px', midnightSeparatorClass)} />}
                <button
                  onClick={() => roomActor.send({ type: 'TOGGLE_BACKGROUND_BLUR' })}
                  title={isBackgroundBlurEnabled ? 'Turn off background blur' : 'Blur background'}
                  data-track-category='CALLS'
                  data-track-name='TOGGLE_BACKGROUND_BLUR'
                  data-track-metadata={JSON.stringify({
                    enabled: !isBackgroundBlurEnabled,
                    callId,
                  })}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
                    isMobile ? 'w-full rounded-lg' : 'rounded-full',
                    isBackgroundBlurEnabled
                      ? 'bg-blue-600 text-white hover:bg-blue-500'
                      : midnightControlClass,
                  )}
                >
                  <ImagePlus size={iconSize ?? 16} />
                  <span>Blur background</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Screen Share Toggle */}
        <Tooltip
          content={screenShareTooltip}
          side='top'
          sideOffset={8}
          collisionPadding={8}
          className={cn(
            'whitespace-normal text-center leading-snug',
            viewMode === 'mini' ? 'max-w-44' : 'max-w-64',
          )}
        >
          <span className='inline-flex flex-shrink-0'>
            <button
              onClick={handleScreenShareClick}
              disabled={screenShareTurnedOffByHost && !screenShareBlockedByWhiteboard}
              aria-disabled={screenShareTurnedOffByHost || screenShareBlockedByWhiteboard}
              className={cn(
                buttonClasses,
                isScreenSharing || screenShareBlockedByWhiteboard
                  ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/50'
                  : midnightControlClass,
                screenShareTurnedOffByHost && 'opacity-50 cursor-not-allowed hover:scale-100',
                screenShareBlockedByWhiteboard && 'cursor-not-allowed hover:scale-100',
              )}
              data-track-event='BUTTON_CLICK'
              data-track-category='CALLS'
              data-track-name='TOGGLE_SCREEN_SHARE'
              data-track-metadata={JSON.stringify({ callId, enabled: isScreenSharing })}
              style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
              aria-label={screenShareTooltip}
            >
              {isScreenSharing ? (
                <Monitor
                  className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
                  style={
                    hasCustomSizing
                      ? { width: `${iconSize}px`, height: `${iconSize}px` }
                      : undefined
                  }
                />
              ) : (
                <Monitor
                  className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
                  style={
                    hasCustomSizing
                      ? { width: `${iconSize}px`, height: `${iconSize}px` }
                      : undefined
                  }
                />
              )}
            </button>
          </span>
        </Tooltip>

        {/* Recording — any participant can start; only the starter can stop (enforced server-side) */}
        {(onStartRecording || onStopRecording) && (
          <RecordingButton
            isRecording={isRecording}
            canStopRecording={canStopRecording}
            onStartRecording={onStartRecording}
            onStopRecording={onStopRecording}
            hasCustomSizing={hasCustomSizing}
            iconSize={iconSize}
            buttonPadding={buttonPadding}
            buttonClasses={buttonClasses}
            midnightControlClass={midnightControlClass}
            midnightPopoverClass={midnightPopoverClass}
            callId={callId}
          />
        )}

        {/* Annotate (Draw) Toggle — only shown when a screen share is active */}
        {isAnySharingScreen && (
          <button
            onClick={() => sendDrawEvent({ type: 'toggleDrawMode' })}
            className={cn(
              buttonClasses,
              isDrawingEnabled
                ? 'bg-orange-500 hover:bg-orange-600 text-white shadow-orange-500/50'
                : midnightControlClass,
            )}
            style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
            title={isDrawingEnabled ? 'Stop annotating' : 'Annotate screen share'}
            data-track-event='BUTTON_CLICK'
            data-track-category='CALLS'
            data-track-name='TOGGLE_DRAW_MODE'
            data-track-metadata={JSON.stringify({ callId, enabled: isDrawingEnabled })}
          >
            <Pencil
              className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
              style={
                hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
              }
            />
          </button>
        )}

        {iconSize >= 16 && (
          <div className={cn('hidden sm:block w-px h-8 mx-0.5', midnightSeparatorClass)}></div>
        )}

        {/* Call Chat Button */}
        {onToggleCallChat && (
          <button
            onClick={onToggleCallChat}
            className={cn(
              buttonClasses,
              'text-white relative',
              isCallChatOpen ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600',
            )}
            style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
            data-track-category='CALLS'
            data-track-name='TOGGLE_CALL_CHAT'
            title='Call chat'
          >
            <MessageCircleMore
              className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
              style={{
                transform: 'scaleX(-1)',
                ...(hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : {}),
              }}
            />
            {unreadCallChatCount > 0 && (
              <span className='absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full'>
                {unreadCallChatCount > 99 ? '99+' : unreadCallChatCount}
              </span>
            )}
          </button>
        )}

        {isHost && onToggleHostControls && (
          <button
            onClick={onToggleHostControls}
            className={cn(
              buttonClasses,
              isHostControlsOpen
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : midnightControlClass,
            )}
            style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
            title='Host controls'
            data-testid='host-controls-button'
            data-track-event='BUTTON_CLICK'
            data-track-category='CALLS'
            data-track-name='TOGGLE_HOST_CONTROLS'
            data-track-metadata={JSON.stringify({ isOpen: isHostControlsOpen })}
          >
            <UserCog
              className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
              style={
                hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
              }
            />
          </button>
        )}

        <button
          onClick={onToggleParticipantsSidebar}
          className={cn(
            buttonClasses,
            'relative',
            isParticipantsSidebarOpen
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : midnightControlClass,
          )}
          style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
          title='Participants'
          data-testid='add-participant-button'
          data-track-event='BUTTON_CLICK'
          data-track-category='CALLS'
          data-track-name='TOGGLE_PARTICIPANTS_SIDEBAR'
          data-track-metadata={JSON.stringify({ isOpen: isParticipantsSidebarOpen })}
        >
          <Users
            className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
            style={
              hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
            }
          />
          {requestedParticipantCount > 0 && (
            <span className={requestCountBadgeClasses} data-testid='participants-request-count'>
              {requestedParticipantCount > 99 ? '99+' : requestedParticipantCount}
            </span>
          )}
        </button>

        {/* Share Link Button */}
        <button
          onClick={handleCopyInviteLink}
          disabled={!roomLink}
          className={cn(
            buttonClasses,
            'relative bg-gray-700 text-white',
            roomLink ? 'hover:bg-gray-600' : 'cursor-not-allowed opacity-50',
          )}
          style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
          title={
            roomLink
              ? 'Copy invite link — works for teammates and guests'
              : 'Preparing invite link…'
          }
          aria-label={
            roomLink ? 'Copy invite link for teammates and guests' : 'Preparing invite link'
          }
          data-track-category='CALLS'
          data-track-name='SHARE_CALL_LINK'
          data-track-metadata={JSON.stringify({ callId, isExternalUser })}
        >
          <Share2
            className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
            style={
              hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
            }
          />
          {showCopied && (
            <span className='absolute -top-8 sm:-top-10 left-1/2 transform -translate-x-1/2 bg-green-500 text-white text-xs sm:text-sm px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg shadow-lg whitespace-nowrap'>
              Copied!
            </span>
          )}
        </button>

        {iconSize >= 16 && (
          <div className={cn('hidden sm:block w-px h-8 mx-0.5', midnightSeparatorClass)}></div>
        )}

        {/* Reactions Button */}
        {onSendReaction && (
          <div className='relative' ref={reactionPickerRef}>
            <button
              onClick={() => setShowReactionPicker(prev => !prev)}
              className={cn(
                buttonClasses,
                showReactionPicker
                  ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                  : midnightControlClass,
              )}
              style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
              title='Send a reaction'
              data-track-category='CALLS'
              data-track-name='TOGGLE_REACTION_PICKER'
            >
              <SmilePlus
                className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
                style={
                  hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
                }
              />
            </button>

            {showReactionPicker && (
              <div
                className={cn(
                  'absolute bottom-full mb-3 left-1/2 -translate-x-1/2 rounded-2xl shadow-2xl p-2 flex gap-1',
                  midnightPopoverClass,
                )}
              >
                {REACTION_EMOJIS.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => {
                      onSendReaction(emoji);
                      setShowReactionPicker(false);
                    }}
                    className='text-2xl p-2 rounded-xl hover:bg-[#202224] transition-colors duration-150 hover:scale-125 transform'
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
        )}

        {/* AI Assistant Button - Single button for all cases.
            Hidden while transcription is off (talk-back depends on STT). */}
        {!hideAIAssistant && isTranscriptionEnabled && (
          <div className='relative'>
            <button
              onClick={() =>
                handleAiButtonClick({
                  hasPendingRequestFromOther,
                  isControlledByOther,
                  onRequestControl,
                  onToggleAIAssistant,
                })
              }
              disabled={isAiButtonDisabled}
              className={cn(buttonClasses, 'relative', aiButtonColorClass)}
              style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
              title={aiButtonTitle}
              data-track-category='CALLS'
              data-track-name='AI_Assistant'
              data-track-metadata={JSON.stringify({
                isControlledByOther,
                hasPendingRequest: hasPendingRequestFromOther,
              })}
            >
              <Bot
                className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
                style={
                  hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
                }
              />
              {isControlledByOther && !hasPendingRequestFromOther && (
                <span className='absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-background'></span>
              )}
            </button>
          </div>
        )}

        {/* Thread Chat Button — hidden for external users */}
        {!hideThreadChat && (
          <button
            onClick={onToggleChat}
            className={cn(
              buttonClasses,
              'text-white relative',
              isChatOpen ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600',
            )}
            style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
            data-track-category='CALLS'
            data-track-name='TOGGLE_CHAT'
            data-track-metadata={JSON.stringify({ callId: callId, isOpen: isChatOpen })}
            title='Thread chat'
          >
            <MessageSquare
              className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
              style={
                hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
              }
            />
          </button>
        )}

        {iconSize >= 16 && (
          <div className={cn('hidden sm:block w-px h-8 mx-0.5', midnightSeparatorClass)}></div>
        )}

        {/* Minimize/Maximize Button */}
        {!hideMinimize && (
          <button
            onClick={onToggleView}
            className={cn(buttonClasses, midnightControlClass)}
            style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
            title={viewMode === 'mini' ? 'Expand view' : 'Minimize view'}
            data-track-category='CALLS'
            data-track-name='TOGGLE_VIEW_MODE'
            data-track-metadata={JSON.stringify({ callId: callId, viewMode })}
          >
            {viewMode === 'mini' ? (
              <Maximize2
                className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
                style={
                  hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
                }
              />
            ) : (
              <Minimize2
                className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
                style={
                  hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
                }
              />
            )}
          </button>
        )}

        {/* More options */}
        {viewMode !== 'mini' && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  buttonClasses,
                  isWhiteboardOpen
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/50'
                    : midnightControlClass,
                )}
                style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
                data-track-event='BUTTON_CLICK'
                data-track-category='CALLS'
                data-track-name='OPEN_CALL_TOOLS_MENU'
                data-track-metadata={JSON.stringify({ callId })}
                title='More options'
              >
                <MoreVertical
                  className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
                  style={
                    hasCustomSizing
                      ? { width: `${iconSize}px`, height: `${iconSize}px` }
                      : undefined
                  }
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side='top'
              align='end'
              sideOffset={12}
              className='w-52 rounded-xl border-gray-700 bg-gray-800 p-1 text-gray-100 shadow-2xl'
            >
              {callToolMenuItems.map(item => {
                const Icon = item.icon;
                return (
                  <DropdownMenuItem
                    key={item.id}
                    onClick={item.onSelect}
                    className={cn(
                      'cursor-pointer rounded-lg px-3 py-2 text-sm focus:bg-gray-700 focus:text-white',
                      item.isActive && 'bg-gray-700 text-white',
                    )}
                    data-track-event='BUTTON_CLICK'
                    data-track-category='CALLS'
                    data-track-name={item.trackName}
                    data-track-metadata={JSON.stringify({ callId, enabled: item.isActive })}
                  >
                    <Icon className='h-4 w-4 text-emerald-300' aria-hidden />
                    <span>{item.label}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Presentation Mode Button */}
        {!hidePresentationMode && onTogglePresentationMode && (
          <button
            onClick={onTogglePresentationMode}
            className={cn(
              buttonClasses,
              'text-white',
              isPresentationMode
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-700 hover:bg-gray-600',
            )}
            style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
            title={isPresentationMode ? 'Exit presentation mode' : 'Enter presentation mode'}
            aria-label={isPresentationMode ? 'Exit presentation mode' : 'Enter presentation mode'}
            aria-pressed={isPresentationMode}
            data-track-category='CALLS'
            data-track-name='TOGGLE_PRESENTATION_MODE'
            data-track-metadata={JSON.stringify({ callId, isEnabled: isPresentationMode })}
          >
            <XyneTelepresenceIcon
              className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
              style={
                hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
              }
            />
          </button>
        )}

        {/* Disconnect Button */}
        <button
          onClick={onDisconnect}
          className={cn(buttonClasses, 'bg-red-600 hover:bg-red-700 text-white shadow-red-900/40')}
          style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
          title='Leave call'
          data-testid='end-call-button'
          data-ph-capture-attribute-track-id='end_call'
          data-track-category='CALLS'
          data-track-name='END_CALL'
          data-track-metadata={JSON.stringify({ callId })}
        >
          <PhoneOff
            className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
            style={
              hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
            }
          />
        </button>
      </div>
    </>
  );
}
