import { useState, useRef, useEffect } from 'react';
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
  Volume2,
  ChevronUp,
  Bot,
  Pencil,
} from 'lucide-react';
import { useMediaDeviceSelect } from '@livekit/components-react';
import { cn } from '../../../utils/classNames';
import { useSelector } from '@xstate/react';
import { roomActor } from '../../../machines/roomMachine';
import { useDrawStore, sendDrawEvent } from '../../../hooks/useDrawStore';
import { DeviceSelector } from '../DeviceSelector/DeviceSelector';
import { usePlatform } from '../../../hooks/usePlatform';
import { useShortcutById, useShortcut } from '../../../shortcuts';

interface CallControlsProps {
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  /** True when any participant (local or remote) is sharing their screen */
  isAnySharingScreen?: boolean;
  isChatOpen: boolean;
  isParticipantsSidebarOpen: boolean;
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
  viewMode?: 'mini' | 'full';
  iconSize?: number;
  buttonPadding?: number;
  showMicMenu?: boolean;
  onToggleMicMenu?: () => void;
  requestedAiController: boolean;
  pendingControlRequest: { requesterId: string; requesterName: string } | null;
}

export function CallControls({
  isMicEnabled,
  isCameraEnabled,
  isScreenSharing,
  isAnySharingScreen = false,
  isChatOpen,
  isParticipantsSidebarOpen,
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
  viewMode = 'full',
  iconSize = 20,
  buttonPadding = 16,
  pendingControlRequest,
  requestedAiController,
}: CallControlsProps): React.ReactElement {
  const [showCopied, setShowCopied] = useState(false);
  const [showCameraMenu, setShowCameraMenu] = useState(false);
  const [showMicMenu, setShowMicMenu] = useState(false);
  const { isMobile } = usePlatform();

  const micMenuRef = useRef<HTMLDivElement>(null);
  const cameraMenuRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const room = useSelector(roomActor, state => state.context.room);
  const isDrawingEnabled = useDrawStore(s => s.isDrawingEnabled);

  // Keyboard shortcut for mute toggle
  useShortcutById('huddle.toggleMute', onToggleMic);

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
  const isControlledByOther = aiController && !isController;

  // Check if someone else has a pending request (disable request button)
  const hasPendingRequestFromOther =
    pendingControlRequest && pendingControlRequest.requesterId !== localParticipantId;
  const isRequestingUser =
    pendingControlRequest && pendingControlRequest.requesterId === localParticipantId;

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

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (micMenuRef.current && !micMenuRef.current.contains(event.target as Node)) {
        setShowMicMenu(false);
      }
      if (cameraMenuRef.current && !cameraMenuRef.current.contains(event.target as Node)) {
        setShowCameraMenu(false);
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

  const handleShareLink = (): void => {
    void navigator.clipboard.writeText(roomLink).then(() => {
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    });
  };

  // Determine if custom sizing is being used (for mini view with dynamic sizing)
  const hasCustomSizing = iconSize !== 20 || buttonPadding !== 16;
  const buttonClasses = cn(
    'rounded-full transition-all duration-200 transform hover:scale-110 shadow-lg flex-shrink-0',
    !hasCustomSizing && 'p-2.5 sm:p-4',
  );

  // Calculate button gap based on iconSize
  const gapClass = iconSize < 16 ? 'gap-1' : iconSize < 20 ? 'gap-1.5' : 'gap-1 sm:gap-3';

  const isAiButtonDisabled =
    hasPendingRequestFromOther || isRequestingUser || requestedAiController;

  const getAiButtonTitle = () => {
    if (hasPendingRequestFromOther)
      return `${pendingControlRequest?.requesterName || 'Unknown User'} is requesting control`;
    if (isRequestingUser) return 'Your request is pending...';
    if (isControlledByOther) return `Request control from ${aiController?.name || 'Unknown User'}`;
    if (isAIAssistantEnabled) return 'Disable Xyne Automatic';
    return 'Enable Xyne Automatic';
  };

  const getAiButtonColorClass = () => {
    if (hasPendingRequestFromOther) return 'bg-gray-600 cursor-not-allowed opacity-60';
    if (isController || (isAIAssistantEnabled && !isControlledByOther)) {
      return 'bg-purple-600 hover:bg-purple-700 shadow-purple-500/50';
    }
    if (isControlledByOther) {
      return 'bg-yellow-600 hover:bg-yellow-700 shadow-yellow-500/50';
    }
    return 'bg-gray-700 hover:bg-gray-600';
  };

  const handleAiButtonClick = () => {
    if (hasPendingRequestFromOther) return;
    if (isControlledByOther && onRequestControl) {
      onRequestControl();
    } else {
      onToggleAIAssistant();
    }
  };

  return (
    <>
      <div ref={controlsRef} className={`flex items-center justify-center ${gapClass} flex-wrap`}>
        {/* Microphone Toggle with Device Selector */}
        <div className='relative' ref={micMenuRef}>
          <div className='flex items-center gap-0.5 bg-gray-700/80 rounded-full'>
            <button
              onClick={onToggleMic}
              className={cn(
                'rounded-full transition-all duration-200 transform hover:scale-110 shadow-lg flex-shrink-0',
                !hasCustomSizing && 'p-2.5 sm:p-4',
                isPushToTalkActive
                  ? 'bg-green-500 hover:bg-green-600 text-white shadow-green-500/50 ring-4 ring-green-500/30'
                  : isMicEnabled
                    ? 'bg-gray-700 hover:bg-gray-600 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white shadow-red-900/40',
              )}
              style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
              title={
                isMicEnabled ? 'Mute microphone' : 'Unmute microphone (press spacebar to speak)'
              }
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
            {viewMode === 'full' && (
              <button
                onClick={() => setShowMicMenu(!showMicMenu)}
                className='text-white flex-shrink-0 p-1.5 sm:p-2 transition-transform'
                title='Select audio devices'
                data-track-category='Calls'
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
                'bg-gray-800 shadow-xl border border-gray-700',
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
                {isMobile && <div className='w-full bg-gray-600 h-px' />}
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
          <div className='flex items-center gap-0.5 bg-gray-700/80 rounded-full'>
            <button
              onClick={onToggleCamera}
              className={cn(
                'rounded-full transition-all duration-200 transform hover:scale-110 shadow-lg flex-shrink-0',
                !hasCustomSizing && 'p-2.5 sm:p-4',
                isCameraEnabled
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : 'bg-red-600 hover:bg-red-700 text-white shadow-red-900/40',
              )}
              style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
              title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
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
            {viewMode === 'full' && (
              <button
                onClick={() => {
                  setShowCameraMenu(!showCameraMenu);
                }}
                className='text-white flex-shrink-0 p-1.5 sm:p-2 transition-transform'
                title='Select camera'
                data-track-category='Calls'
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
                'bg-gray-800 shadow-xl border border-gray-700',
                isMobile
                  ? 'absolute bottom-full mb-2 -left-20 min-w-[280px] py-2 rounded-xl'
                  : 'absolute bottom-full mb-2 left-0 rounded-full',
              )}
            >
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
            </div>
          )}
        </div>

        {/* Screen Share Toggle */}
        <button
          onClick={onToggleScreenShare}
          className={cn(
            buttonClasses,
            isScreenSharing
              ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/50'
              : 'bg-gray-700 hover:bg-gray-600 text-white',
          )}
          data-track-event='BUTTON_CLICK'
          data-track-category='CALLS'
          data-track-name='TOGGLE_SCREEN_SHARE'
          data-track-metadata={JSON.stringify({ callId, enabled: isScreenSharing })}
          style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
          title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
        >
          {isScreenSharing ? (
            <Monitor
              className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
              style={
                hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
              }
            />
          ) : (
            <Monitor
              className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
              style={
                hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
              }
            />
          )}
        </button>

        {/* Annotate (Draw) Toggle — only shown when a screen share is active */}
        {isAnySharingScreen && (
          <button
            onClick={() => sendDrawEvent({ type: 'toggleDrawMode' })}
            className={cn(
              buttonClasses,
              isDrawingEnabled
                ? 'bg-orange-500 hover:bg-orange-600 text-white shadow-orange-500/50'
                : 'bg-gray-700 hover:bg-gray-600 text-white',
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

        {iconSize >= 16 && <div className='hidden sm:block w-px h-8 bg-gray-700/50 mx-0.5'></div>}
        <button
          onClick={onToggleParticipantsSidebar}
          className={cn(
            buttonClasses,
            isParticipantsSidebarOpen
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-white',
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
        </button>

        {/* Share Link Button */}
        <button
          onClick={handleShareLink}
          className={cn(buttonClasses, 'relative bg-gray-700 hover:bg-gray-600 text-white')}
          style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
          title='Share call link'
          data-track-category='CALLS'
          data-track-name='SHARE_CALL_LINK'
          data-track-metadata={JSON.stringify({ callId })}
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

        {iconSize >= 16 && <div className='hidden sm:block w-px h-8 bg-gray-700/50 mx-0.5'></div>}

        {/* Chat Button */}
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
          title='Toggle chat'
        >
          <MessageSquare
            className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
            style={
              hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined
            }
          />
        </button>

        {/* AI Assistant Button - Single button for all cases */}
        <div className='relative'>
          <button
            onClick={handleAiButtonClick}
            disabled={isAiButtonDisabled}
            className={cn(buttonClasses, 'text-white relative', getAiButtonColorClass())}
            style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
            title={getAiButtonTitle()}
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
              <span className='absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-gray-800'></span>
            )}
          </button>
        </div>

        {iconSize >= 16 && <div className='hidden sm:block w-px h-8 bg-gray-700/50 mx-0.5'></div>}

        {/* Minimize/Maximize Button */}
        <button
          onClick={onToggleView}
          className={cn(buttonClasses, 'bg-gray-700 hover:bg-gray-600 text-white')}
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

        {/* Disconnect Button */}
        <button
          onClick={onDisconnect}
          className={cn(buttonClasses, 'bg-red-600 hover:bg-red-700 text-white shadow-red-900/40')}
          style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
          title='Leave call'
          data-testid='end-call-button'
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
