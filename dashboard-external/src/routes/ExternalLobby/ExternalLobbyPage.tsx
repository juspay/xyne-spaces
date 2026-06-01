import { useRef, useState, useCallback, useEffect, useReducer } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  RotateCcw,
  User,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { CallType } from '@xyne/shared';
import { callLobbyService, type CallInfo } from '@/services/Call/callLobbyService';
import { usePlatform } from '@/hooks/usePlatform';
import { ExternalCallView } from './ExternalCallView';

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

type LobbyStage =
  | 'LOADING'
  | 'CALL_NOT_FOUND'
  | 'CALL_ENDED'
  | 'PRE_JOIN'
  | 'REQUESTING'
  | 'WAITING'
  | 'JOINING'
  | 'IN_CALL'
  | 'REJECTED'
  | 'DISCONNECTED';

interface LobbyState {
  stage: LobbyStage;
  callInfo?: CallInfo;
  displayName?: string;
  /** Only set after externalJoin succeeds — needed for LiveKit identity */
  participantId?: string;
  token?: string;
  serverUrl?: string;
  externalId?: string;
  callType?: CallType;
}

type LobbyAction =
  | { type: 'SET_LOADING' }
  | { type: 'SET_CALL_NOT_FOUND' }
  | { type: 'SET_CALL_ENDED' }
  | { type: 'SET_PRE_JOIN'; callInfo: CallInfo }
  | { type: 'SET_REQUESTING'; callInfo: CallInfo; displayName: string }
  | { type: 'SET_WAITING'; callInfo: CallInfo; displayName: string }
  | { type: 'SET_JOINING' }
  | { type: 'SET_REJECTED' }
  | {
      type: 'SET_IN_CALL';
      token: string;
      serverUrl: string;
      externalId: string;
      callType: CallType;
      participantId: string;
    }
  | { type: 'SET_DISCONNECTED' };

const initialState: LobbyState = { stage: 'LOADING' };

function lobbyReducer(state: LobbyState, action: LobbyAction): LobbyState {
  switch (action.type) {
    case 'SET_LOADING':
      return { stage: 'LOADING' };
    case 'SET_CALL_NOT_FOUND':
      return { stage: 'CALL_NOT_FOUND' };
    case 'SET_CALL_ENDED':
      return { stage: 'CALL_ENDED' };
    case 'SET_PRE_JOIN':
      return { ...state, stage: 'PRE_JOIN', callInfo: action.callInfo };
    case 'SET_REQUESTING':
      return {
        ...state,
        stage: 'REQUESTING',
        callInfo: action.callInfo,
        displayName: action.displayName,
      };
    case 'SET_WAITING':
      return {
        ...state,
        stage: 'WAITING',
        callInfo: action.callInfo,
        displayName: action.displayName,
      };
    case 'SET_JOINING':
      return { ...state, stage: 'JOINING' };
    case 'SET_REJECTED':
      return { ...state, stage: 'REJECTED' };
    case 'SET_IN_CALL':
      return {
        ...state,
        stage: 'IN_CALL',
        token: action.token,
        serverUrl: action.serverUrl,
        externalId: action.externalId,
        callType: action.callType,
        participantId: action.participantId,
      };
    case 'SET_DISCONNECTED':
      return { ...state, stage: 'DISCONNECTED' };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ExternalLobbyPage() {
  const { callId: externalId } = useParams<{ callId: string }>();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(lobbyReducer, initialState);

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [nameError, setNameError] = useState('');

  // Camera / mic preview
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isCamOn, setIsCamOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [camDenied, setCamDenied] = useState(false);

  // -------------------------------------------------------------------------
  // 1. Load call info
  // -------------------------------------------------------------------------
  const callInfoQuery = useQuery({
    queryKey: ['call-lobby-info', externalId],
    queryFn: () => callLobbyService.getCallInfo(externalId!),
    enabled: !!externalId && state.stage === 'LOADING',
    retry: false,
  });

  useEffect(() => {
    if (!callInfoQuery.isSuccess || state.stage !== 'LOADING') return;
    const result = callInfoQuery.data;
    if (result === 'not_found') {
      dispatch({ type: 'SET_CALL_NOT_FOUND' });
    } else if (result === 'ended') {
      dispatch({ type: 'SET_CALL_ENDED' });
    } else {
      dispatch({ type: 'SET_PRE_JOIN', callInfo: result });
    }
  }, [callInfoQuery.isSuccess, callInfoQuery.data, state.stage]);

  useEffect(() => {
    if (callInfoQuery.isError && state.stage === 'LOADING') {
      dispatch({ type: 'SET_CALL_NOT_FOUND' });
    }
  }, [callInfoQuery.isError, state.stage]);

  // -------------------------------------------------------------------------
  // 2. Request to join mutation
  // -------------------------------------------------------------------------
  const requestToJoinMutation = useMutation({
    mutationFn: ({ name }: { name: string }) => callLobbyService.requestToJoin(externalId!, name),
    onSuccess: (data, variables) => {
      if (!state.callInfo) return;

      if (data.skipApproval) {
        // Cookie session exists — go straight to join
        dispatch({ type: 'SET_JOINING' });
        joinMutation.mutate();
        return;
      }

      dispatch({
        type: 'SET_WAITING',
        callInfo: state.callInfo,
        displayName: variables.name,
      });
    },
    onError: (err: unknown) => {
      setNameError((err as Error)?.message ?? 'Failed to join. Please try again.');
      if (state.callInfo) {
        dispatch({ type: 'SET_PRE_JOIN', callInfo: state.callInfo });
      }
    },
  });

  // -------------------------------------------------------------------------
  // 3. Status polling (enabled in WAITING stage)
  // -------------------------------------------------------------------------
  const lobbyStatusQuery = useQuery({
    queryKey: ['call-lobby-status', externalId],
    queryFn: () => callLobbyService.getLobbyStatus(externalId!),
    enabled: state.stage === 'WAITING' && !!externalId,
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  // -------------------------------------------------------------------------
  // 4. Join mutation (called when status becomes ACCEPTED)
  // -------------------------------------------------------------------------
  const joinMutation = useMutation({
    mutationFn: () => callLobbyService.externalJoin(externalId!),
    onSuccess: joinData => {
      stopPreview();
      dispatch({
        type: 'SET_IN_CALL',
        token: joinData.token,
        serverUrl: joinData.serverUrl,
        externalId: joinData.externalId,
        callType: joinData.callType,
        participantId: joinData.participantId,
      });
    },
    onError: () => {
      // If we came from the session path (JOINING without WAITING), fall back to PRE_JOIN
      if (state.stage === 'JOINING' && state.callInfo) {
        dispatch({ type: 'SET_PRE_JOIN', callInfo: state.callInfo });
      }
      // Otherwise stay in WAITING so polling continues
    },
  });

  // Handle status changes
  useEffect(() => {
    if (state.stage !== 'WAITING' || !lobbyStatusQuery.isSuccess) return;
    const { response } = lobbyStatusQuery.data;
    if (response === 'ACCEPTED' && !joinMutation.isPending) {
      dispatch({ type: 'SET_JOINING' });
      joinMutation.mutate();
    } else if (response === 'DECLINED') {
      dispatch({ type: 'SET_REJECTED' });
    }
  }, [lobbyStatusQuery.isSuccess, lobbyStatusQuery.data, state.stage, joinMutation]);

  // -------------------------------------------------------------------------
  // 5. Rejoin mutation
  // -------------------------------------------------------------------------
  const rejoinMutation = useMutation({
    mutationFn: () => callLobbyService.rejoinLobby(externalId!),
    onSuccess: data => {
      if (data.skipApproval) {
        dispatch({ type: 'SET_JOINING' });
        joinMutation.mutate();
        return;
      }

      // Reset the status query cache so polling starts fresh with REQUESTED
      void queryClient.resetQueries({ queryKey: ['call-lobby-status', externalId] });
      if (state.callInfo) {
        dispatch({
          type: 'SET_WAITING',
          callInfo: state.callInfo,
          displayName: state.displayName ?? '',
        });
      }
    },
    onError: () => {
      // Rejoin failed — call may have ended, go back to PRE_JOIN to re-fetch
      if (state.callInfo) {
        dispatch({ type: 'SET_PRE_JOIN', callInfo: state.callInfo });
      }
    },
  });

  // -------------------------------------------------------------------------
  // Camera/mic helpers
  // -------------------------------------------------------------------------
  const showPermissionDeniedToast = useCallback((device: 'Microphone' | 'Camera') => {
    toast.error(`${device} access is blocked`, {
      description: 'Please allow access in your browser settings and try again.',
      duration: 6000,
    });
  }, []);

  const startPreview = useCallback(
    async (video: boolean, audio: boolean) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video, audio });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        if (video) {
          setIsCamOn(true);
          setCamDenied(false);
        }
        if (audio) {
          setIsMicOn(true);
          setMicDenied(false);
        }
      } catch (err) {
        const error = err as DOMException;
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          if (video) {
            setCamDenied(true);
            showPermissionDeniedToast('Camera');
          }
          if (audio) {
            setMicDenied(true);
            showPermissionDeniedToast('Microphone');
          }
        }
      }
    },
    [showPermissionDeniedToast],
  );

  const stopPreview = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCamOn(false);
    setIsMicOn(false);
  }, []);

  const toggleCamera = useCallback(async () => {
    if (isCamOn) {
      streamRef.current?.getVideoTracks().forEach(t => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      setIsCamOn(false);
    } else {
      await startPreview(true, isMicOn);
    }
  }, [isCamOn, isMicOn, startPreview]);

  const toggleMic = useCallback(async () => {
    if (isMicOn) {
      streamRef.current?.getAudioTracks().forEach(t => (t.enabled = false));
      setIsMicOn(false);
    } else if (streamRef.current?.getAudioTracks().length) {
      streamRef.current.getAudioTracks().forEach(t => (t.enabled = true));
      setIsMicOn(true);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (streamRef.current) {
          stream.getAudioTracks().forEach(t => streamRef.current!.addTrack(t));
        } else {
          streamRef.current = stream;
        }
        setIsMicOn(true);
        setMicDenied(false);
      } catch (err) {
        const error = err as DOMException;
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          setMicDenied(true);
          showPermissionDeniedToast('Microphone');
        }
      }
    }
  }, [isMicOn, showPermissionDeniedToast]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // -------------------------------------------------------------------------
  // Submit "Join"
  // -------------------------------------------------------------------------
  const hasSession = state.callInfo?.hasSession;
  const { isMobile } = usePlatform();
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isMobile || state.stage !== 'PRE_JOIN' || hasSession) return;
    const rafId = requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [state.stage, hasSession, isMobile]);

  const handleJoin = useCallback(() => {
    if (state.stage !== 'PRE_JOIN') return;

    // Session cookie exists — skip name input, go through requestToJoin (cookie handles auth + status restore)
    if (hasSession) {
      dispatch({ type: 'SET_REQUESTING', callInfo: state.callInfo!, displayName: '' });
      requestToJoinMutation.mutate({ name: '' });
      return;
    }

    const trimmed = displayName.trim();
    if (!trimmed) {
      setNameError('Please enter your name');
      return;
    }
    if (trimmed.length > 100) {
      setNameError('Name must be 100 characters or fewer');
      return;
    }
    setNameError('');
    dispatch({ type: 'SET_REQUESTING', callInfo: state.callInfo!, displayName: trimmed });
    requestToJoinMutation.mutate({ name: trimmed });
  }, [state.stage, state.callInfo, hasSession, displayName, requestToJoinMutation]);

  // -------------------------------------------------------------------------
  // Disconnect handler
  // -------------------------------------------------------------------------
  const handleDisconnected = useCallback(() => {
    dispatch({ type: 'SET_DISCONNECTED' });
  }, []);

  // Rejoin handler — cookie handles identity, no participantId needed
  const handleRejoin = useCallback(() => {
    rejoinMutation.mutate();
  }, [rejoinMutation]);

  // -------------------------------------------------------------------------
  // Renders
  // -------------------------------------------------------------------------

  // Full-screen call
  if (state.stage === 'IN_CALL') {
    return (
      <ExternalCallView
        token={state.token!}
        serverUrl={state.serverUrl!}
        callId={state.externalId!}
        externalId={state.externalId!}
        callType={state.callType || CallType.AUDIO}
        participantId={state.participantId!}
        onDisconnected={handleDisconnected}
      />
    );
  }

  // Status screens
  if (state.stage === 'LOADING') {
    return (
      <StatusScreen>
        <LoadingSpinner />
        <p className='text-gray-400 text-sm mt-4'>Loading call info...</p>
      </StatusScreen>
    );
  }

  if (state.stage === 'CALL_NOT_FOUND') {
    return (
      <StatusScreen>
        <div className='w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-4'>
          <PhoneOff size={28} className='text-gray-500' />
        </div>
        <h2 className='text-xl font-semibold text-white mb-2'>Call not found</h2>
        <p className='text-gray-400 text-sm'>
          This link may be invalid or the call no longer exists.
        </p>
      </StatusScreen>
    );
  }

  if (state.stage === 'CALL_ENDED') {
    return (
      <StatusScreen>
        <div className='w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-4'>
          <PhoneOff size={28} className='text-red-400' />
        </div>
        <h2 className='text-xl font-semibold text-white mb-2'>This call has ended</h2>
        <p className='text-gray-400 text-sm'>The call you tried to join is no longer active.</p>
      </StatusScreen>
    );
  }

  if (state.stage === 'REJECTED') {
    return (
      <StatusScreen>
        <div className='w-16 h-16 rounded-full bg-red-900/30 flex items-center justify-center mb-4'>
          <PhoneOff size={28} className='text-red-400' />
        </div>
        <h2 className='text-xl font-semibold text-white mb-2'>Request declined</h2>
        <p className='text-gray-400 text-sm'>The host declined your request to join this call.</p>
      </StatusScreen>
    );
  }

  if (state.stage === 'WAITING' || state.stage === 'JOINING') {
    return (
      <StatusScreen>
        <div className='w-16 h-16 rounded-full bg-blue-900/30 flex items-center justify-center mb-6'>
          <User size={28} className='text-blue-400' />
        </div>
        {state.callInfo?.title && (
          <h2 className='text-lg font-semibold text-white mb-1'>{state.callInfo.title}</h2>
        )}
        <p className='text-gray-400 text-sm mb-6'>
          {state.stage === 'JOINING'
            ? 'Entering the call...'
            : 'Waiting for the host to let you in...'}
        </p>
        <LoadingSpinner />
        {state.displayName && (
          <p className='text-gray-500 text-xs mt-6'>
            Joining as <span className='text-gray-300 font-medium'>{state.displayName}</span>
          </p>
        )}
      </StatusScreen>
    );
  }

  if (state.stage === 'DISCONNECTED') {
    return (
      <StatusScreen>
        <div className='w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-4'>
          <PhoneOff size={28} className='text-gray-400' />
        </div>
        <h2 className='text-xl font-semibold text-white mb-2'>You left the call</h2>
        <p className='text-gray-400 text-sm mb-6'>
          {state.callInfo?.title && <span className='text-gray-300'>{state.callInfo.title}</span>}
        </p>
        <button
          onClick={handleRejoin}
          disabled={rejoinMutation.isPending}
          data-track-category='CALLS'
          data-track-name='EXTERNAL_REJOIN_CALL'
          className='inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
        >
          {rejoinMutation.isPending ? (
            <>
              <LoadingSpinner size='sm' />
              Requesting to rejoin...
            </>
          ) : (
            <>
              <RotateCcw size={16} />
              Rejoin call
            </>
          )}
        </button>
        {rejoinMutation.isError && (
          <p className='text-red-400 text-xs mt-3'>Failed to rejoin. The call may have ended.</p>
        )}
      </StatusScreen>
    );
  }

  // PRE_JOIN or REQUESTING
  const isRequesting = state.stage === 'REQUESTING' || requestToJoinMutation.isPending;

  return (
    <div className='min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 flex items-center justify-center p-4'>
      <div className='flex flex-col md:flex-row gap-8 items-center max-w-[860px] w-full'>
        {/* Left: Camera preview */}
        <div className='relative w-full md:w-[400px] aspect-video bg-gray-800 rounded-xl overflow-hidden shadow-2xl shrink-0'>
          <video ref={videoRef} autoPlay playsInline muted className='w-full h-full object-cover' />
          {!isCamOn && (
            <div className='absolute inset-0 flex flex-col items-center justify-center bg-gray-800'>
              <div className='w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center mb-2'>
                <User size={36} className='text-gray-500' />
              </div>
              <p className='text-gray-500 text-xs'>Camera is off</p>
            </div>
          )}
          {/* Media toggle buttons */}
          <div className='absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3'>
            <button
              onClick={() => void toggleMic()}
              className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                isMicOn
                  ? 'bg-gray-700/80 text-white hover:bg-gray-600/80'
                  : 'bg-red-500/90 text-white hover:bg-red-600/90'
              }`}
              title={
                micDenied
                  ? 'Microphone access denied'
                  : isMicOn
                    ? 'Mute microphone'
                    : 'Unmute microphone'
              }
              data-track-category='CALLS'
              data-track-name='EXTERNAL_TOGGLE_MIC'
            >
              {isMicOn ? <Mic size={18} /> : <MicOff size={18} />}
              {micDenied && (
                <span className='absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-500 flex items-center justify-center'>
                  <AlertTriangle size={10} className='text-black' />
                </span>
              )}
            </button>
            <button
              onClick={() => void toggleCamera()}
              className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                isCamOn
                  ? 'bg-gray-700/80 text-white hover:bg-gray-600/80'
                  : 'bg-red-500/90 text-white hover:bg-red-600/90'
              }`}
              title={
                camDenied ? 'Camera access denied' : isCamOn ? 'Turn off camera' : 'Turn on camera'
              }
              data-track-category='CALLS'
              data-track-name='EXTERNAL_TOGGLE_CAMERA'
            >
              {isCamOn ? <Video size={18} /> : <VideoOff size={18} />}
              {camDenied && (
                <span className='absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-500 flex items-center justify-center'>
                  <AlertTriangle size={10} className='text-black' />
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Right: Call info + name input */}
        <div className='flex flex-col gap-4 w-full md:w-auto md:min-w-[280px] md:max-w-[320px]'>
          <div>
            {state.callInfo?.title && (
              <h2 className='text-xl font-semibold text-white mb-1'>{state.callInfo.title}</h2>
            )}
            <p className='text-gray-400 text-sm'>
              {hasSession ? 'Ready to join' : 'Enter your name to join'}
            </p>
          </div>

          {!hasSession && (
            <div>
              <label
                htmlFor='lobby-name'
                className='block text-xs font-medium text-gray-400 mb-1.5'
              >
                Your name
              </label>
              <input
                ref={nameInputRef}
                data-track-category='CALLS'
                data-track-name='EXTERNAL_NAME_INPUT'
                id='lobby-name'
                type='text'
                placeholder='Enter your name'
                value={displayName}
                maxLength={100}
                onChange={e => {
                  setDisplayName(e.target.value);
                  if (nameError) setNameError('');
                }}
                onKeyDown={e => e.key === 'Enter' && handleJoin()}
                disabled={isRequesting}
                className='w-full px-3.5 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors disabled:opacity-50'
              />
              {nameError && <p className='text-red-400 text-xs mt-1.5'>{nameError}</p>}
            </div>
          )}

          <button
            onClick={handleJoin}
            disabled={isRequesting || joinMutation.isPending}
            data-track-category='CALLS'
            data-track-name='EXTERNAL_ASK_TO_JOIN'
            className='w-full px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          >
            {isRequesting || joinMutation.isPending ? 'Joining...' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function StatusScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className='min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 flex items-center justify-center p-4'>
      <div className='flex flex-col items-center text-center max-w-sm'>{children}</div>
    </div>
  );
}

function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const sizeClasses = size === 'sm' ? 'w-4 h-4 border-2' : 'w-8 h-8 border-[3px]';
  return (
    <div className={`${sizeClasses} border-gray-700 border-t-blue-500 rounded-full animate-spin`} />
  );
}
