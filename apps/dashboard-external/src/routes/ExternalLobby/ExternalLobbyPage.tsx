import { useRef, useState, useCallback, useEffect, useMemo, useReducer } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, PhoneOff, RotateCcw, SearchX } from 'lucide-react';
import { CallType, InvitationResponse, type CallEncryptionCredentials } from '@xyne/shared';
import { callLobbyService, type CallInfo } from '@/services/Call/callLobbyService';
import type { JoinMediaOverrides } from '@/machines/roomMachine';
import { ExternalCallView } from './ExternalCallView';
import { LobbyShell, Spinner, StatusCard, primaryButtonClass } from './LobbyChrome';
import { PreJoinPreview } from './PreJoinPreview';
import { useMediaPreview } from './useMediaPreview';

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
  encryption?: CallEncryptionCredentials;
  externalId?: string;
  callType?: CallType;
  /** JOINING straight from the "you left" screen — no preview to show. */
  rejoining?: boolean;
}

type LobbyAction =
  | { type: 'SET_LOADING' }
  | { type: 'SET_CALL_NOT_FOUND' }
  | { type: 'SET_CALL_ENDED' }
  | { type: 'SET_PRE_JOIN'; callInfo: CallInfo }
  | { type: 'SET_REQUESTING'; callInfo: CallInfo; displayName: string }
  | { type: 'SET_WAITING'; callInfo: CallInfo; displayName: string }
  | { type: 'SET_JOINING'; rejoining?: boolean }
  | { type: 'JOIN_FAILED' }
  | { type: 'SET_REJECTED' }
  | {
      type: 'SET_IN_CALL';
      token: string;
      serverUrl: string;
      encryption?: CallEncryptionCredentials;
      externalId: string;
      callType: CallType;
      participantId: string;
    }
  | { type: 'SET_DISCONNECTED' };

const initialState: LobbyState = { stage: 'LOADING' };

/** How often a waiting guest checks whether they've been let in. */
const ADMISSION_POLL_MS = 2000;

function getInternalCallUrl(externalId: string, workspaceId: string): string {
  const configuredBaseUrl = import.meta.env['VITE_INTERNAL_DASHBOARD_BASE_URL'] as
    | string
    | undefined;
  const dashboardBaseUrl =
    configuredBaseUrl?.trim() ||
    (import.meta.env.DEV ? 'http://localhost:5173' : window.location.origin);

  return new URL(
    `/${encodeURIComponent(workspaceId)}/call/${encodeURIComponent(externalId)}`,
    dashboardBaseUrl,
  ).toString();
}

function lobbyReducer(state: LobbyState, action: LobbyAction): LobbyState {
  switch (action.type) {
    case 'SET_LOADING':
      return { stage: 'LOADING' };
    case 'SET_CALL_NOT_FOUND':
      return { stage: 'CALL_NOT_FOUND' };
    case 'SET_CALL_ENDED':
      return { ...state, stage: 'CALL_ENDED' };
    case 'SET_PRE_JOIN':
      return { ...state, stage: 'PRE_JOIN', callInfo: action.callInfo, rejoining: false };
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
        rejoining: false,
      };
    case 'SET_JOINING':
      return { ...state, stage: 'JOINING', rejoining: action.rejoining ?? false };
    case 'JOIN_FAILED':
      // Nothing polls while JOINING, so return to PRE_JOIN where the user can retry.
      if (state.stage === 'JOINING' && state.callInfo) {
        return { ...state, stage: 'PRE_JOIN', rejoining: false };
      }
      return state;
    case 'SET_REJECTED':
      return { ...state, stage: 'REJECTED' };
    case 'SET_IN_CALL':
      return {
        ...state,
        stage: 'IN_CALL',
        token: action.token,
        serverUrl: action.serverUrl,
        ...(action.encryption ? { encryption: action.encryption } : {}),
        externalId: action.externalId,
        callType: action.callType,
        participantId: action.participantId,
        rejoining: false,
      };
    case 'SET_DISCONNECTED':
      return { ...state, stage: 'DISCONNECTED' };
    default:
      return state;
  }
}

function participantCountLabel(count: number | undefined): string | null {
  if (count === undefined) return null;
  if (count === 0) return 'No one else is here yet';
  if (count === 1) return '1 person is in this call';
  return `${count} people are in this call`;
}

/** Touch devices pop the keyboard on focus, so only autofocus with a real pointer. */
function hasFinePointer(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;
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
  const [joinError, setJoinError] = useState('');

  // Camera / mic preview — live wherever the preview tile is on screen
  const previewActive =
    state.stage === 'PRE_JOIN' ||
    state.stage === 'REQUESTING' ||
    state.stage === 'WAITING' ||
    (state.stage === 'JOINING' && !state.rejoining);
  const media = useMediaPreview(previewActive);

  // Whatever the user picked in the lobby goes into the call with them.
  const joinMediaOverrides = useMemo<JoinMediaOverrides>(
    () => ({
      mic: media.micOn,
      camera: media.camOn,
      ...(media.pickedAudioDeviceId && { audioDeviceId: media.pickedAudioDeviceId }),
      ...(media.pickedVideoDeviceId && { videoDeviceId: media.pickedVideoDeviceId }),
    }),
    [media.micOn, media.camOn, media.pickedAudioDeviceId, media.pickedVideoDeviceId],
  );
  // Frozen at join time: toggling in the lobby after that must not reconnect.
  const [callMediaOverrides, setCallMediaOverrides] = useState<JoinMediaOverrides>();

  useEffect(() => {
    const title = state.callInfo?.title;
    document.title = title ? `${title} · Xyne Call` : 'Xyne Call';
  }, [state.callInfo?.title]);

  // -------------------------------------------------------------------------
  // 1. Load call info through the existing lobby route
  // -------------------------------------------------------------------------
  const callInfoQuery = useQuery({
    queryKey: ['call-lobby-info', externalId],
    queryFn: () => callLobbyService.getCallInfo(externalId!),
    enabled: !!externalId && state.stage === 'LOADING',
    retry: false,
  });

  const internalRouteAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    if (!callInfoQuery.isSuccess || state.stage !== 'LOADING') return;
    const result = callInfoQuery.data;
    if (result === 'not_found') {
      dispatch({ type: 'SET_CALL_NOT_FOUND' });
    } else if (result === 'ended') {
      dispatch({ type: 'SET_CALL_ENDED' });
    } else {
      if (!externalId || internalRouteAttemptRef.current === externalId) return;
      internalRouteAttemptRef.current = externalId;

      let cancelled = false;
      void callLobbyService
        .resolveInternalRoute(externalId)
        .then(resolution => {
          if (cancelled) return;
          if (resolution.result === 'internal') {
            window.location.replace(getInternalCallUrl(externalId, resolution.workspaceId));
            return;
          }
          if (result.displayName) setDisplayName(result.displayName);
          dispatch({ type: 'SET_PRE_JOIN', callInfo: result });
        })
        .catch(() => {
          if (cancelled) return;
          if (result.displayName) setDisplayName(result.displayName);
          dispatch({ type: 'SET_PRE_JOIN', callInfo: result });
        });

      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [callInfoQuery.isSuccess, callInfoQuery.data, state.stage, externalId]);

  useEffect(() => {
    if (callInfoQuery.isError && state.stage === 'LOADING') {
      dispatch({ type: 'SET_CALL_NOT_FOUND' });
    }
  }, [callInfoQuery.isError, state.stage]);

  // -------------------------------------------------------------------------
  // 2. Join mutation (session path, or once the host admits the guest)
  // -------------------------------------------------------------------------
  const joinMutation = useMutation({
    mutationFn: () => callLobbyService.externalJoin(externalId!),
    onSuccess: joinData => {
      if ((joinData as { status?: string }).status === 'ended') {
        dispatch({ type: 'SET_CALL_ENDED' });
        return;
      }
      setJoinError('');
      dispatch({
        type: 'SET_IN_CALL',
        token: joinData.token,
        serverUrl: joinData.serverUrl,
        ...(joinData.encryption ? { encryption: joinData.encryption } : {}),
        externalId: joinData.externalId,
        callType: joinData.callType,
        participantId: joinData.participantId,
      });
    },
    onError: () => {
      setJoinError('Couldn’t join the call. Please try again.');
      // Decided in the reducer: this callback can close over a stale stage
      // (e.g. DISCONNECTED when the join was started from rejoin).
      dispatch({ type: 'JOIN_FAILED' });
    },
  });

  const startJoin = useCallback(
    (opts?: { rejoining?: boolean }) => {
      setCallMediaOverrides(joinMediaOverrides);
      dispatch({ type: 'SET_JOINING', ...(opts?.rejoining && { rejoining: true }) });
      joinMutation.mutate();
    },
    [joinMediaOverrides, joinMutation],
  );

  // -------------------------------------------------------------------------
  // 3. Request to join mutation
  // -------------------------------------------------------------------------
  const requestToJoinMutation = useMutation({
    mutationFn: ({ name }: { name: string }) => callLobbyService.requestToJoin(externalId!, name),
    onSuccess: (data, variables) => {
      if (data.status === 'ended') {
        dispatch({ type: 'SET_CALL_ENDED' });
        return;
      }
      if (!state.callInfo) return;

      if (data.skipApproval) {
        // Cookie session exists — go straight to join
        startJoin();
        return;
      }

      void queryClient.resetQueries({ queryKey: ['call-lobby-status', externalId] });
      dispatch({
        type: 'SET_WAITING',
        callInfo: state.callInfo,
        displayName: variables.name || displayName.trim(),
      });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Couldn’t send your request. Please try again.';
      setJoinError(message);
      if (state.callInfo) {
        dispatch({ type: 'SET_PRE_JOIN', callInfo: state.callInfo });
      }
    },
  });

  // -------------------------------------------------------------------------
  // 4. Admission polling (WAITING only)
  // -------------------------------------------------------------------------
  const lobbyStatusQuery = useQuery({
    queryKey: ['call-lobby-status', externalId],
    queryFn: () => callLobbyService.getLobbyStatus(externalId!),
    enabled: state.stage === 'WAITING' && !!externalId,
    refetchInterval: ADMISSION_POLL_MS,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  useEffect(() => {
    if (state.stage !== 'WAITING' || !lobbyStatusQuery.isSuccess) return;
    const { response, status } = lobbyStatusQuery.data;
    if (status === 'ended') {
      dispatch({ type: 'SET_CALL_ENDED' });
    } else if (response === InvitationResponse.ACCEPTED && !joinMutation.isPending) {
      startJoin();
    } else if (response === InvitationResponse.DECLINED) {
      dispatch({ type: 'SET_REJECTED' });
    }
  }, [lobbyStatusQuery.isSuccess, lobbyStatusQuery.data, state.stage, joinMutation.isPending, startJoin]);

  // -------------------------------------------------------------------------
  // 5. Rejoin mutation
  // -------------------------------------------------------------------------
  const rejoinMutation = useMutation({
    mutationFn: () => callLobbyService.rejoinLobby(externalId!),
    onSuccess: data => {
      if (data.status === 'ended') {
        dispatch({ type: 'SET_CALL_ENDED' });
        return;
      }
      if (data.skipApproval) {
        startJoin({ rejoining: true });
        return;
      }

      // Needs the host again (e.g. they were removed) — back to the waiting view
      void queryClient.resetQueries({ queryKey: ['call-lobby-status', externalId] });
      if (state.callInfo) {
        dispatch({
          type: 'SET_WAITING',
          callInfo: state.callInfo,
          displayName: state.displayName ?? displayName.trim(),
        });
      }
    },
  });

  // -------------------------------------------------------------------------
  // Join button
  // -------------------------------------------------------------------------
  const hasSession = !!state.callInfo?.hasSession;
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.stage !== 'PRE_JOIN' || hasSession || !hasFinePointer()) return;
    const rafId = requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => cancelAnimationFrame(rafId);
  }, [state.stage, hasSession]);

  const handleJoin = useCallback(() => {
    if (state.stage !== 'PRE_JOIN' || !state.callInfo) return;
    setJoinError('');

    // Session cookie exists — skip name input, go through requestToJoin (cookie handles auth + status restore)
    if (hasSession) {
      dispatch({ type: 'SET_REQUESTING', callInfo: state.callInfo, displayName: displayName.trim() });
      requestToJoinMutation.mutate({ name: '' });
      return;
    }

    const trimmed = displayName.trim();
    if (!trimmed) {
      setNameError('Please enter your name');
      nameInputRef.current?.focus();
      return;
    }
    if (trimmed.length > 100) {
      setNameError('Name must be 100 characters or fewer');
      return;
    }
    setNameError('');
    dispatch({ type: 'SET_REQUESTING', callInfo: state.callInfo, displayName: trimmed });
    requestToJoinMutation.mutate({ name: trimmed });
  }, [state.stage, state.callInfo, hasSession, displayName, requestToJoinMutation]);

  const handleDisconnected = useCallback(() => {
    dispatch({ type: 'SET_DISCONNECTED' });
  }, []);

  const handleRejoin = useCallback(() => {
    rejoinMutation.mutate();
  }, [rejoinMutation]);

  // -------------------------------------------------------------------------
  // Renders
  // -------------------------------------------------------------------------

  if (state.stage === 'IN_CALL') {
    return (
      <ExternalCallView
        token={state.token!}
        serverUrl={state.serverUrl!}
        callId={state.externalId!}
        externalId={state.externalId!}
        callType={state.callType || CallType.AUDIO}
        participantId={state.participantId!}
        {...(state.encryption && { encryption: state.encryption })}
        onDisconnected={handleDisconnected}
        {...(callMediaOverrides && { joinMediaOverrides: callMediaOverrides })}
      />
    );
  }

  if (state.stage === 'LOADING') {
    return (
      <LobbyShell>
        <div className='flex flex-col items-center gap-5'>
          <Spinner />
          <p className='text-sm text-[#c4c7c5]'>Getting the call ready…</p>
        </div>
      </LobbyShell>
    );
  }

  if (state.stage === 'CALL_NOT_FOUND') {
    return (
      <LobbyShell>
        <StatusCard
          icon={<SearchX size={28} />}
          title='Check your call link'
          description='This link may be mistyped or the call no longer exists. Ask the host to share the link again.'
        />
      </LobbyShell>
    );
  }

  if (state.stage === 'CALL_ENDED') {
    return (
      <LobbyShell>
        <StatusCard
          icon={<PhoneOff size={28} />}
          title='This call has ended'
          description={
            state.callInfo?.title ? (
              <>
                <span className='text-[#e3e3e3]'>{state.callInfo.title}</span> is no longer active.
              </>
            ) : (
              'The call you tried to join is no longer active.'
            )
          }
        />
      </LobbyShell>
    );
  }

  if (state.stage === 'REJECTED') {
    return (
      <LobbyShell>
        <StatusCard
          icon={<Ban size={28} />}
          tone='danger'
          title='You can’t join this call'
          description='Someone in the call declined your request to join.'
        />
      </LobbyShell>
    );
  }

  if (state.stage === 'DISCONNECTED' || (state.stage === 'JOINING' && state.rejoining)) {
    const isRejoining = rejoinMutation.isPending || state.stage === 'JOINING';
    return (
      <LobbyShell>
        <StatusCard
          icon={<PhoneOff size={28} />}
          title='You left the call'
          description={
            state.callInfo?.title ? (
              <span className='text-[#e3e3e3]'>{state.callInfo.title}</span>
            ) : undefined
          }
        >
          <button
            type='button'
            onClick={handleRejoin}
            disabled={isRejoining}
            data-track-category='CALLS'
            data-track-name='EXTERNAL_REJOIN_CALL'
            className={primaryButtonClass}
          >
            {isRejoining ? (
              <>
                <Spinner size='sm' />
                Rejoining…
              </>
            ) : (
              <>
                <RotateCcw size={18} />
                Rejoin
              </>
            )}
          </button>
          {rejoinMutation.isError && (
            <p className='text-sm text-[#f2b8b5]'>Couldn’t rejoin. The call may have ended.</p>
          )}
        </StatusCard>
      </LobbyShell>
    );
  }

  // PRE_JOIN · REQUESTING · WAITING · JOINING — preview on the left, join panel on the right
  const isSubmitting = state.stage === 'REQUESTING' || state.stage === 'JOINING';
  const isWaiting = state.stage === 'WAITING';
  const previewName = displayName.trim() || state.displayName || '';
  const countLabel = participantCountLabel(state.callInfo?.participantCount);

  return (
    <LobbyShell>
      <div className='grid w-full max-w-[1100px] items-center gap-8 md:gap-12 lg:grid-cols-[minmax(0,1fr)_340px]'>
        <PreJoinPreview media={media} displayName={previewName} locked={state.stage === 'JOINING'} />

        <section
          aria-live='polite'
          className='flex flex-col items-center text-center lg:items-center'
        >
          {isWaiting ? (
            <div className='flex flex-col items-center animate-in fade-in-0 duration-300'>
              <h1 className='text-[28px] font-normal leading-9 text-[#e3e3e3]'>Asking to join…</h1>
              <p className='mt-3 max-w-[300px] text-[15px] leading-6 text-[#c4c7c5]'>
                You’ll join the call when someone lets you in
              </p>
              <div className='mt-8'>
                <Spinner />
              </div>
              {previewName && (
                <p className='mt-8 text-[13px] text-[#8e918f]'>
                  Joining as <span className='text-[#c4c7c5]'>{previewName}</span>
                </p>
              )}
            </div>
          ) : (
            <form
              className='flex w-full max-w-[320px] flex-col items-center'
              onSubmit={e => {
                e.preventDefault();
                handleJoin();
              }}
            >
              <h1 className='text-[28px] font-normal leading-9 text-[#e3e3e3]'>
                {hasSession ? 'Ready to join?' : 'What’s your name?'}
              </h1>
              {state.callInfo?.title && (
                <p className='mt-2 line-clamp-2 text-[15px] text-[#c4c7c5]'>{state.callInfo.title}</p>
              )}
              {countLabel && <p className='mt-1 text-[13px] text-[#8e918f]'>{countLabel}</p>}

              {!hasSession && (
                <div className='mt-7 w-full text-left'>
                  <label htmlFor='lobby-name' className='sr-only'>
                    Your name
                  </label>
                  <input
                    ref={nameInputRef}
                    id='lobby-name'
                    type='text'
                    autoComplete='name'
                    placeholder='Your name'
                    value={displayName}
                    maxLength={100}
                    onChange={e => {
                      setDisplayName(e.target.value);
                      if (nameError) setNameError('');
                    }}
                    disabled={isSubmitting}
                    aria-invalid={!!nameError}
                    aria-describedby={nameError ? 'lobby-name-error' : undefined}
                    data-track-category='CALLS'
                    data-track-name='EXTERNAL_NAME_INPUT'
                    className={`h-14 w-full rounded-lg border bg-transparent px-4 text-base text-[#e3e3e3] placeholder-[#8e918f] outline-none transition-colors focus:border-[#a8c7fa] focus:ring-1 focus:ring-[#a8c7fa] disabled:opacity-60 ${
                      nameError ? 'border-[#f2b8b5]' : 'border-[#8e918f]'
                    }`}
                  />
                  {nameError && (
                    <p id='lobby-name-error' className='mt-2 px-1 text-[13px] text-[#f2b8b5]'>
                      {nameError}
                    </p>
                  )}
                </div>
              )}

              {hasSession && previewName && (
                <p className='mt-6 text-[13px] text-[#8e918f]'>
                  Joining as <span className='text-[#c4c7c5]'>{previewName}</span>
                </p>
              )}

              <button
                type='submit'
                disabled={isSubmitting}
                data-track-category='CALLS'
                data-track-name='EXTERNAL_ASK_TO_JOIN'
                className={`${primaryButtonClass} mt-6 w-full max-w-[220px]`}
              >
                {isSubmitting ? (
                  <>
                    <Spinner size='sm' />
                    {state.stage === 'JOINING' ? 'Joining…' : 'Asking…'}
                  </>
                ) : hasSession ? (
                  'Join now'
                ) : (
                  'Ask to join'
                )}
              </button>

              {joinError && <p className='mt-4 text-[13px] text-[#f2b8b5]'>{joinError}</p>}

              {!hasSession && !joinError && (
                <p className='mt-6 text-[12px] leading-5 text-[#8e918f]'>
                  The host will be asked to let you in.
                </p>
              )}
            </form>
          )}
        </section>
      </div>
    </LobbyShell>
  );
}
