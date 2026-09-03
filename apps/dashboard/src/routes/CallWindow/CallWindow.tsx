import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { CallType, ChannelScopeType, InvitationResponse } from '@xyne/shared';
import type { CallParticipant } from '@xyne/shared';
import type { SdlcCallLink } from '@xyne/shared';
import { RoomAudioRenderer } from '@livekit/components-react';
import { roomActor, type InitialTrackState } from '../../machines/roomMachine';
import { CustomLiveKitRoom } from '../../components/Call/CallViews/CustomLiveKitRoom';
import { useZero } from '../../hooks/useZero';
import { useAuth } from '../../hooks/useAuth';
import { useUsers } from '../../hooks/useUsers';
import { useAllChannels } from '../../hooks/useChannels';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { isDMChannel } from '../../components/Chat/ChatDirectory/ChatDirectory.utils';
import { buildIncomingCallViewModel } from '../../components/Call/IncomingCall/IncomingCallCard.utils';
import type { IncomingCallRow } from '../../components/Call/IncomingCall/IncomingCallCard.utils';
import type { IncomingCallViewModel } from '../../components/Call/IncomingCall/IncomingCallCard.types';
import { getCallJoinSettings, saveCallDeviceChoice } from '../../hooks/useCallJoinSettings';
import { isElectronApp } from '../../utils/electronApp';
import {
  clearCallWindowActive,
  markCallWindowActive,
  publishCallWindowEnded,
  publishCallWindowState,
  subscribeCallWindowChannel,
} from '../../utils/callWindowChannel';
import { CallLobby } from './CallLobby';
import { NEW_CALL_ID } from './callWindowLauncher';
import { describeCallWindow } from './callWindowCopy';
import { useLobbyPreview } from './useLobbyPreview';

type Stage = 'lobby' | 'ring' | 'connecting' | 'waiting' | 'live' | 'ended' | 'failed';

const isCallTypeValue = (value: string | undefined): value is CallType =>
  value === CallType.VIDEO || value === CallType.AUDIO;

export function CallWindow(): React.ReactElement {
  const params = useParams<{ callId: string; callType: string }>();
  const [searchParams] = useSearchParams();
  const zero = useZero();
  const { user } = useAuth();

  const routeCallId = params.callId ?? '';
  const isNewCall = routeCallId === NEW_CALL_ID;
  const callId = isNewCall ? '' : routeCallId;
  const callType = isCallTypeValue(params.callType) ? params.callType : CallType.VIDEO;
  const isRingEntry = searchParams.get('stage') === 'ring';

  const savedSettings = useMemo(() => getCallJoinSettings(), []);
  const [stage, setStage] = useState<Stage>(isRingEntry ? 'ring' : 'lobby');
  const [rememberChoice, setRememberChoice] = useState(false);
  const hasJoinedRef = useRef(false);
  const hasAttemptedJoinRef = useRef(false);
  const autoRejoinedRef = useRef(false);

  const preview = useLobbyPreview({
    initialMicOn: !savedSettings.joinMuted,
    initialCameraOn: !savedSettings.joinWithoutVideo,
    initialMicDeviceId: savedSettings.micDeviceId,
    initialCameraDeviceId: savedSettings.cameraDeviceId,
    initialSpeakerDeviceId: savedSettings.speakerDeviceId,
    autoStart: !isRingEntry,
  });

  const [activeCalls, activeCallsDetails] = useCachedQuery(queries.userActiveCalls());
  const users = useUsers();

  const call = useMemo(
    () => activeCalls?.find(c => c.externalId === callId),
    [activeCalls, callId],
  );

  const usersById = useMemo(() => {
    const map = new Map<string, (typeof users)[number]>();
    (users ?? []).forEach(entry => map.set(entry.id, entry));
    return map;
  }, [users]);

  const allChannels = useAllChannels();
  const channelMap = useMemo(() => {
    const map = new Map<string, (typeof allChannels)[number]>();
    (allChannels ?? []).forEach(channel => map.set(channel.id, channel));
    return map;
  }, [allChannels]);

  const caller = useMemo(() => {
    const participants = (call as { participants?: readonly CallParticipant[] } | undefined)
      ?.participants;
    const myParticipant = participants?.find(p => p.userId === user?.id);
    const inviterId = myParticipant?.invitedBy ?? call?.createdByUserId ?? '';
    const inviter = inviterId ? usersById.get(inviterId) : undefined;
    return {
      id: inviterId,
      name: getUserDisplayName(inviter),
      email: inviter?.email ?? '',
    };
  }, [call, user?.id, usersById]);

  useEffect(() => {
    if (activeCalls) {
      roomActor.send({ type: 'UPDATE_ACTIVE_CALLS', calls: activeCalls });
    }
  }, [activeCalls]);

  const snapshot = useSelector(roomActor, s => s);
  const isConnected = snapshot.matches('connected');
  const isIdle = snapshot.matches('idle');
  const token = snapshot.context.token;
  const serverUrl = snapshot.context.serverUrl;
  const externalId = snapshot.context.externalId;
  const room = snapshot.context.room;

  const joinFailure = snapshot.context.joinFailure;
  const awaitingAdmission = snapshot.context.awaitingAdmission;

  const isInXyneCall =
    snapshot.matches('initiating') ||
    snapshot.matches('joining') ||
    snapshot.matches('connecting') ||
    isConnected;
  useEffect(() => {
    if (!isElectronApp()) return;
    window.electronAPI?.ipcSend?.('call:state-changed', isInXyneCall);
    return () => {
      window.electronAPI?.ipcSend?.('call:state-changed', false);
    };
  }, [isInXyneCall]);

  useEffect(() => {
    if (!isElectronApp()) return;
    window.electronAPI?.ipcSend?.('call:ringing-changed', stage === 'ring');
  }, [stage]);

  useEffect(() => {
    if (isConnected) {
      hasJoinedRef.current = true;
      setStage('live');
    }
  }, [isConnected]);

  const localParticipant = room?.localParticipant;
  const micEnabled = localParticipant?.isMicrophoneEnabled ?? false;
  const cameraEnabled = localParticipant?.isCameraEnabled ?? false;
  const screenSharing = localParticipant?.isScreenShareEnabled ?? false;

  const copyRef = useRef<string>('Call in progress');

  const liveCallIdRef = useRef('');
  if (externalId) liveCallIdRef.current = externalId;
  else if (callId) liveCallIdRef.current = callId;
  const publishCallId = liveCallIdRef.current;

  const publishState = useCallback(() => {
    if (!hasJoinedRef.current || !publishCallId) return;
    publishCallWindowState({
      callId: publishCallId,
      title: copyRef.current,
      micEnabled,
      cameraEnabled,
      screenSharing,
      connected: isConnected,
    });
  }, [publishCallId, cameraEnabled, isConnected, micEnabled, screenSharing]);

  useEffect(() => {
    publishState();
  }, [publishState]);

  const publishStateRef = useRef(publishState);
  publishStateRef.current = publishState;

  useEffect(() => {
    return subscribeCallWindowChannel({
      onStateRequested: () => publishStateRef.current(),
      onCommand: command => {
        if (command === 'leave') {
          roomActor.send({ type: 'DISCONNECT', endForAll: false });
          return;
        }
        if (command === 'toggle-mic') {
          roomActor.send({ type: 'TOGGLE_MIC' });
          return;
        }
        roomActor.send({ type: 'TOGGLE_CAMERA' });
      },
    });
  }, []);

  useEffect(() => {
    const dispose = window.electronAPI?.onCallWindowLeave?.(() => {
      roomActor.send({ type: 'DISCONNECT', endForAll: false });
    });
    return () => {
      dispose?.();
    };
  }, []);

  useEffect(() => {
    if (stage !== 'ended' || !publishCallId) return;
    publishCallWindowEnded(publishCallId);
  }, [publishCallId, stage]);

  useEffect(() => {
    if (!isInXyneCall) {
      clearCallWindowActive();
      return;
    }
    markCallWindowActive();
    const timer = setInterval(markCallWindowActive, 10_000);
    return () => {
      clearInterval(timer);
      clearCallWindowActive();
    };
  }, [isInXyneCall]);

  useEffect(() => {
    if (!isIdle) return;
    if (!hasAttemptedJoinRef.current) return;
    if (joinFailure) {
      setStage('failed');
      return;
    }
    if (awaitingAdmission) {
      setStage('waiting');
      return;
    }
    if (hasJoinedRef.current) {
      setStage('ended');
    }
  }, [awaitingAdmission, isIdle, joinFailure]);

  const restorePreviewRef = useRef(preview);
  restorePreviewRef.current = preview;
  useEffect(() => {
    if (stage !== 'failed' && stage !== 'waiting') return;
    const current = restorePreviewRef.current;
    if (current.cameraOn && !current.cameraTrack) current.setCameraOn(true);
    if (current.micOn && !current.micTrack) current.setMicOn(true);
  }, [stage]);

  const hadCallRef = useRef(false);
  if (call) hadCallRef.current = true;
  const callVanished =
    activeCallsDetails.type === 'complete' && hadCallRef.current && !call && !isNewCall;
  useEffect(() => {
    if (!callVanished) return;
    if (hasJoinedRef.current) return;
    setStage(current => (current === 'ring' || current === 'lobby' ? 'ended' : current));
  }, [callVanished]);

  const buildInitialTrackState = useCallback((): InitialTrackState => {
    const state: InitialTrackState = {
      mic: preview.micOn,
      camera: preview.cameraOn,
    };
    if (preview.micDeviceId) state.micDeviceId = preview.micDeviceId;
    if (preview.cameraDeviceId) state.cameraDeviceId = preview.cameraDeviceId;
    if (preview.speakerDeviceId) state.speakerDeviceId = preview.speakerDeviceId;
    if (preview.micOn && preview.micTrack) state.micTrack = preview.micTrack;
    if (preview.cameraOn && preview.cameraTrack) state.cameraTrack = preview.cameraTrack;
    return state;
  }, [
    preview.cameraDeviceId,
    preview.cameraOn,
    preview.cameraTrack,
    preview.micDeviceId,
    preview.micOn,
    preview.micTrack,
    preview.speakerDeviceId,
  ]);

  const handleJoinRef = useRef<(() => void) | null>(null);

  const handleJoin = useCallback(() => {
    const channelId = searchParams.get('channelId');
    if (!callId && !(isNewCall && channelId)) return;

    hasAttemptedJoinRef.current = true;

    if (rememberChoice) {
      saveCallDeviceChoice({
        micDeviceId: preview.micDeviceId,
        cameraDeviceId: preview.cameraDeviceId,
        speakerDeviceId: preview.speakerDeviceId,
        joinMuted: !preview.micOn,
        joinWithoutVideo: !preview.cameraOn,
      });
    }

    const initialTrackState = buildInitialTrackState();
    preview.releaseTracks();
    setStage('connecting');

    if (isNewCall && channelId) {
      const targetUserIds = searchParams.get('targetUserIds');
      const callDisplayName = searchParams.get('callDisplayName');
      const conversationId = searchParams.get('conversationId');
      const artifactMessageId = searchParams.get('artifactMessageId');
      const rawSdlcLink = searchParams.get('sdlcLink');
      let sdlcLink: SdlcCallLink | undefined;
      if (rawSdlcLink) {
        try {
          sdlcLink = JSON.parse(rawSdlcLink) as SdlcCallLink;
        } catch {
          sdlcLink = undefined;
        }
      }

      roomActor.send({
        type: 'INITIATE_CALL',
        channelId,
        callType,
        zero,
        viewMode: 'full',
        initialTrackState,
        ...(targetUserIds && { targetUserIds: targetUserIds.split(',').filter(Boolean) }),
        ...(callDisplayName && { callDisplayName }),
        ...(conversationId && { conversationId }),
        ...(artifactMessageId && { artifactMessageId }),
        ...(sdlcLink && { sdlcLink }),
      });
      return;
    }

    roomActor.send({
      type: 'JOIN_CALL',
      callId,
      zero,
      viewMode: 'full',
      initialTrackState,
    });
  }, [
    buildInitialTrackState,
    callId,
    callType,
    isNewCall,
    preview,
    rememberChoice,
    searchParams,
    zero,
  ]);

  const myResponse = useMemo(() => {
    if (!user?.id || !call) return null;
    const participants = call.participants as
      | readonly { userId: string; response: string | null }[]
      | undefined;
    return participants?.find(p => p.userId === user.id)?.response ?? null;
  }, [call, user?.id]);

  useEffect(() => {
    if (stage !== 'waiting') return;
    if (myResponse !== InvitationResponse.ACCEPTED) return;
    if (autoRejoinedRef.current) return;
    autoRejoinedRef.current = true;
    handleJoinRef.current?.();
  }, [myResponse, stage]);

  handleJoinRef.current = handleJoin;

  const handleCancel = useCallback(() => {
    preview.stopPreview();
    roomActor.send({ type: 'DISCONNECT', endForAll: false });
    window.close();
  }, [preview]);

  const handleDecline = useCallback(() => {
    preview.stopPreview();
    if (zero && callId) {
      try {
        void zero.mutate(mutators.calls.reject({ callId, timestamp: Date.now() }));
      } catch {
        // The ring times out server-side after 32s regardless.
      }
    }
    window.close();
  }, [callId, preview, zero]);

  useEffect(() => {
    const leaveIfInCall = (): void => {
      const current = roomActor.getSnapshot();
      const inCall =
        current.matches('initiating') ||
        current.matches('joining') ||
        current.matches('connecting') ||
        current.matches('connected');
      if (inCall) {
        roomActor.send({ type: 'DISCONNECT', endForAll: false });
      }
    };
    window.addEventListener('beforeunload', leaveIfInCall);
    return () => {
      window.removeEventListener('beforeunload', leaveIfInCall);
      leaveIfInCall();
    };
  }, []);

  const incomingVm: IncomingCallViewModel | null = useMemo(() => {
    if (!call) return null;
    return buildIncomingCallViewModel({
      callId,
      call: call as unknown as IncomingCallRow,
      caller,
      channelMap,
      usersById,
      currentUserId: user?.id,
      isInActiveCall: false,
    });
  }, [call, callId, caller, channelMap, user?.id, usersById]);

  const outgoingChannelId = searchParams.get('channelId');
  const outgoingChannel = outgoingChannelId ? channelMap.get(outgoingChannelId) : undefined;
  const { displayName: outgoingChannelName } = useChannelDisplayName(
    outgoingChannel ?? null,
    user?.id ?? '',
  );
  const outgoingName = searchParams.get('callDisplayName') || outgoingChannelName || null;

  const outgoingConversationId = searchParams.get('conversationId');
  const outgoingIsDm = outgoingChannel ? isDMChannel(outgoingChannel.scopeType) : false;

  const copy = useMemo(
    () =>
      describeCallWindow({
        vm: incomingVm,
        isRinging: stage === 'ring',
        isNewCall,
        outgoing: {
          displayName: outgoingName,
          channelName: outgoingChannel && !outgoingIsDm ? outgoingChannel.name : null,
          isDm: outgoingIsDm,
          isGroupDm: outgoingChannel?.scopeType === ChannelScopeType.GROUP_DM,
          conversationId: outgoingConversationId,
        },
      }),
    [
      incomingVm,
      isNewCall,
      outgoingChannel,
      outgoingConversationId,
      outgoingIsDm,
      outgoingName,
      stage,
    ],
  );

  copyRef.current = copy.windowLine;

  useEffect(() => {
    document.title = copy.windowLine;
    publishStateRef.current();
  }, [copy.windowLine]);

  const status = useMemo(() => {
    if (stage === 'waiting') return 'Waiting for the host to let you in.';
    return null;
  }, [stage]);

  if (stage === 'live' && token && serverUrl && externalId) {
    return (
      <div className='h-full w-full bg-background'>
        {room && <RoomAudioRenderer room={room} />}
        <CustomLiveKitRoom
          token={token}
          serverUrl={serverUrl}
          callId={externalId}
          callType={callType}
          externalId={externalId}
          zero={zero}
        />
      </div>
    );
  }

  if (stage === 'ended' || (stage === 'failed' && joinFailure?.terminal)) {
    const message = joinFailure?.terminal
      ? joinFailure.message
      : hasJoinedRef.current
        ? 'You left the call.'
        : 'This call has ended.';
    return (
      <div className='flex h-full w-full flex-col items-center justify-center gap-3 bg-background text-foreground'>
        <p className='max-w-[420px] px-6 text-center text-sm text-muted-foreground'>{message}</p>
        <button
          type='button'
          onClick={() => window.close()}
          className='rounded-md border border-border px-3 py-1.5 text-sm'
          data-track-category='CALLS'
          data-track-name='Call_Window_Close_After_End'
        >
          Close
        </button>
      </div>
    );
  }

  const isBusy = stage === 'connecting';
  const joinLabel =
    stage === 'ring'
      ? 'Answer'
      : stage === 'failed'
        ? 'Try again'
        : stage === 'waiting'
          ? 'Request again'
          : isBusy
            ? isNewCall
              ? 'Starting…'
              : 'Joining…'
            : isNewCall
              ? 'Start call'
              : 'Join';

  return (
    <CallLobby
      title={copy.name}
      windowLine={copy.windowLine}
      subtitle={copy.subtitle}
      context={copy.context}
      status={status}
      error={stage === 'failed' ? (joinFailure?.message ?? null) : null}
      preview={preview}
      rememberChoice={rememberChoice}
      onRememberChoiceChange={setRememberChoice}
      joinLabel={joinLabel}
      joinDisabled={isBusy || (!callId && !isNewCall)}
      cancelLabel={stage === 'ring' ? 'Decline' : 'Cancel'}
      isRinging={stage === 'ring'}
      onJoin={handleJoin}
      onCancel={stage === 'ring' ? handleDecline : handleCancel}
    />
  );
}
