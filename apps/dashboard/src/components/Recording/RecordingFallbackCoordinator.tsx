import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { ConnectionState, RoomEvent, Track, type RemoteParticipant } from 'livekit-client';
import { toast } from 'sonner';
import { refreshOatsRecordings } from '../../hooks/usePaginatedOatsRecordings';
import { refreshRecordings } from '../../hooks/usePaginatedRecordings';
import {
  getRecordingStatus,
  sendRecordingEvent,
  useRecordingStore,
} from '../../hooks/useRecordingStore';
import {
  RECORDING_REPAIR_MERGED_EVENT,
  type RecordingRepairMergedEventDetail,
  type RecordingRepairReason,
} from '../../services/Recording/recordingService';
import { offlineRecordingService } from '../../services/Recording/offlineRecordingService';
import {
  AGENT_LEFT_CONFIRM_DELAY_MS,
  isTranscriptionAgentIdentity,
  shouldConfirmTranscriptionAgentLeft,
} from '../../utils/livekitAgent';

export function RecordingFallbackCoordinator(): ReactElement | null {
  const status = useRecordingStore(context => context.status);
  const room = useRecordingStore(context => context.room);
  const externalId = useRecordingStore(context => context.externalId);
  const reasons = useRecordingStore(context => context.fallbackReasons);
  const previousExternalId = useRef<string | null>(null);
  const everHadOutage = useRef(false);
  const warnedUnavailable = useRef(false);
  const failedSttSources = useRef(new Set<string>());
  const connectionTroubleActive = useRef(false);
  const connectionWarningExternalId = useRef<string | null>(null);

  const showConnectionWarning = useCallback((): void => {
    if (!externalId) return;
    if (connectionWarningExternalId.current !== externalId) {
      connectionWarningExternalId.current = externalId;
      connectionTroubleActive.current = false;
    }
    if (connectionTroubleActive.current) return;
    connectionTroubleActive.current = true;
    toast.warning('Connection issue', {
      id: `recording-livekit-warning:${externalId}`,
      description:
        'We are facing trouble connecting you to LiveKit due to internet issues. Your audio is getting captured locally. Your transcript will be generated eventually.',
      duration: Infinity,
      closeButton: true,
      style: {
        background: '#fef3c7',
        border: '1px solid #f59e0b',
        color: '#78350f',
      },
      classNames: {
        title: '!text-amber-950',
        description: '!text-amber-900',
        closeButton: '!text-amber-950',
      },
    });
  }, [externalId]);

  const setReason = useCallback(
    (reason: RecordingRepairReason, active: boolean, occurredAt?: number): void => {
      if (active) everHadOutage.current = true;
      sendRecordingEvent({ type: 'setFallbackReason', reason, active });
      offlineRecordingService.setReason(reason, active, occurredAt);
    },
    [],
  );

  useEffect(() => {
    const initialize = (): void => {
      void offlineRecordingService.initialize().catch(() => {
        sendRecordingEvent({ type: 'setFallbackProtection', availability: 'unavailable' });
      });
    };
    initialize();
    window.addEventListener('online', initialize);
    return (): void => window.removeEventListener('online', initialize);
  }, []);

  useEffect(() => {
    if (!externalId || !room || (status !== 'recording' && status !== 'paused')) return;
    let cancelled = false;
    const startCapture = (): void => {
      const localTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)
        ?.track as { mediaStreamTrack?: MediaStreamTrack } | undefined;
      if (!localTrack?.mediaStreamTrack) return;
      void offlineRecordingService
        .start(externalId, localTrack.mediaStreamTrack)
        .then(() => {
          if (cancelled) return;
          sendRecordingEvent({ type: 'setFallbackProtection', availability: 'ready' });
          for (const reason of reasons) offlineRecordingService.setReason(reason, true);
          if (status === 'paused') offlineRecordingService.pause();
        })
        .catch(() => {
          sendRecordingEvent({ type: 'setFallbackProtection', availability: 'unavailable' });
          if (!warnedUnavailable.current) {
            warnedUnavailable.current = true;
            toast.warning('Recording continues, but local gap protection is unavailable');
          }
        });
    };
    startCapture();
    room.on(RoomEvent.LocalTrackPublished, startCapture);
    return (): void => {
      cancelled = true;
      room.off(RoomEvent.LocalTrackPublished, startCapture);
    };
  }, [externalId, reasons, room, status]);

  useEffect(() => {
    if (status === 'paused') offlineRecordingService.pause();
    if (status === 'recording') offlineRecordingService.resume();
  }, [status]);

  useEffect(() => {
    if (!externalId || (status !== 'recording' && status !== 'paused')) return;
    const handleOffline = (): void => showConnectionWarning();
    const handleOnline = (): void => {
      if (room?.state === ConnectionState.Connected) connectionTroubleActive.current = false;
    };
    if (!navigator.onLine) showConnectionWarning();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return (): void => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [externalId, room, showConnectionWarning, status]);

  useEffect(() => {
    const previous = previousExternalId.current;
    previousExternalId.current = externalId;
    if (externalId && externalId !== previous) everHadOutage.current = false;
    if (externalId && externalId !== previous) failedSttSources.current.clear();
    if (!externalId && previous) {
      if (everHadOutage.current) sendRecordingEvent({ type: 'setRepairPending', pending: true });
      void offlineRecordingService.stopAndUpload().catch(() => undefined);
    }
  }, [externalId]);

  useEffect(() => {
    if (!room || !externalId) return;
    let agentTimer: ReturnType<typeof setTimeout> | null = null;
    let agentOutageStartedAt: number | null = null;
    let hasSeenAgent = [...room.remoteParticipants.values()].some(participant =>
      isTranscriptionAgentIdentity(participant.identity),
    );

    const checkAgent = (): void => {
      if (!hasSeenAgent || !shouldConfirmTranscriptionAgentLeft(room)) {
        if (agentTimer) clearTimeout(agentTimer);
        agentTimer = null;
        agentOutageStartedAt = null;
        setReason('agent_left', false);
        return;
      }
      if (agentTimer) return;
      agentOutageStartedAt ??= Date.now();
      agentTimer = setTimeout(() => {
        agentTimer = null;
        const currentStatus = getRecordingStatus();
        const isActive = currentStatus === 'recording' || currentStatus === 'paused';
        if (isActive && shouldConfirmTranscriptionAgentLeft(room)) {
          setReason('agent_left', true, agentOutageStartedAt ?? Date.now());
        }
      }, AGENT_LEFT_CONFIRM_DELAY_MS);
    };
    const handleParticipantConnected = (participant: RemoteParticipant): void => {
      if (!isTranscriptionAgentIdentity(participant.identity)) return;
      hasSeenAgent = true;
      checkAgent();
    };
    const handleParticipantDisconnected = (participant: RemoteParticipant): void => {
      if (!isTranscriptionAgentIdentity(participant.identity)) return;
      agentOutageStartedAt = Date.now();
      checkAgent();
    };
    const handleConnection = (state: ConnectionState): void => {
      if (state === ConnectionState.Connected) {
        if (navigator.onLine) connectionTroubleActive.current = false;
        setReason('livekit_disconnected', false);
        checkAgent();
        return;
      }
      // Reconnecting and browser-offline states keep only the in-memory rolling
      // buffer. Persist only after LiveKit declares the room terminally disconnected.
      if (state === ConnectionState.Reconnecting || state === ConnectionState.Disconnected) {
        showConnectionWarning();
      }
      if (state === ConnectionState.Disconnected) {
        const currentStatus = getRecordingStatus();
        const isActive = currentStatus === 'recording' || currentStatus === 'paused';
        if (isActive) setReason('livekit_disconnected', true);
      }
    };
    const handleData = (
      payload: Uint8Array,
      _participant?: unknown,
      _kind?: unknown,
      topic?: string,
    ): void => {
      if (topic !== 'transcriptions') return;
      try {
        const data = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
        const sttSource = data['stt_source'];
        if (typeof sttSource !== 'string') return;
        if (data['type'] === 'stt_error') failedSttSources.current.add(sttSource);
        if (data['type'] === 'stt_recovered') failedSttSources.current.delete(sttSource);
      } catch {
        // The recording store owns ordinary transcript payload validation.
      }
    };

    handleConnection(room.state);
    room.on(RoomEvent.ConnectionStateChanged, handleConnection);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    room.on(RoomEvent.DataReceived, handleData);
    return (): void => {
      if (agentTimer) clearTimeout(agentTimer);
      room.off(RoomEvent.ConnectionStateChanged, handleConnection);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [externalId, room, setReason, showConnectionWarning]);

  useEffect(() => {
    const handleMerged = (event: Event): void => {
      const detail = (event as CustomEvent<RecordingRepairMergedEventDetail>).detail;
      if (!detail?.callId) return;
      sendRecordingEvent({ type: 'setRepairPending', pending: false });
      refreshRecordings();
      refreshOatsRecordings();
    };
    window.addEventListener(RECORDING_REPAIR_MERGED_EVENT, handleMerged);
    return (): void => window.removeEventListener(RECORDING_REPAIR_MERGED_EVENT, handleMerged);
  }, []);

  return null;
}
