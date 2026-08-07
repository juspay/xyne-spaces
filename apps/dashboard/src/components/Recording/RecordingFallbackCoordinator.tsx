import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { ConnectionState, RoomEvent, Track, type RemoteParticipant } from 'livekit-client';
import { toast } from 'sonner';
import { refreshOatsRecordings } from '../../hooks/usePaginatedOatsRecordings';
import { refreshRecordings } from '../../hooks/usePaginatedRecordings';
import { sendRecordingEvent, useRecordingStore } from '../../hooks/useRecordingStore';
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

const RECONNECT_TIMEOUT_MS = 30_000;

export function RecordingFallbackCoordinator(): ReactElement | null {
  const status = useRecordingStore(context => context.status);
  const room = useRecordingStore(context => context.room);
  const externalId = useRecordingStore(context => context.externalId);
  const reasons = useRecordingStore(context => context.fallbackReasons);
  const previousExternalId = useRef<string | null>(null);
  const everHadOutage = useRef(false);
  const warnedUnavailable = useRef(false);

  const setReason = useCallback((reason: RecordingRepairReason, active: boolean): void => {
    if (active) everHadOutage.current = true;
    sendRecordingEvent({ type: 'setFallbackReason', reason, active });
    offlineRecordingService.setReason(reason, active);
  }, []);

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
    const previous = previousExternalId.current;
    previousExternalId.current = externalId;
    if (externalId && externalId !== previous) everHadOutage.current = false;
    if (!externalId && previous) {
      if (everHadOutage.current) sendRecordingEvent({ type: 'setRepairPending', pending: true });
      void offlineRecordingService.stopAndUpload().catch(() => undefined);
    }
  }, [externalId]);

  useEffect(() => {
    if (!externalId) return;
    const handleOffline = (): void => setReason('browser_offline', true);
    const handleOnline = (): void => setReason('browser_offline', false);
    if (!navigator.onLine) handleOffline();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return (): void => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [externalId, setReason]);

  useEffect(() => {
    if (!room || !externalId) return;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let agentTimer: ReturnType<typeof setTimeout> | null = null;

    const clearReconnectTimer = (): void => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };
    const checkAgent = (): void => {
      if (!shouldConfirmTranscriptionAgentLeft(room)) {
        if (agentTimer) clearTimeout(agentTimer);
        agentTimer = null;
        setReason('agent_left', false);
        return;
      }
      if (agentTimer) return;
      agentTimer = setTimeout(() => {
        agentTimer = null;
        if (shouldConfirmTranscriptionAgentLeft(room)) setReason('agent_left', true);
      }, AGENT_LEFT_CONFIRM_DELAY_MS);
    };
    const handleParticipantConnected = (participant: RemoteParticipant): void => {
      if (isTranscriptionAgentIdentity(participant.identity)) checkAgent();
    };
    const handleConnection = (state: ConnectionState): void => {
      if (state === ConnectionState.Connected) {
        clearReconnectTimer();
        setReason('livekit_disconnected', false);
        setReason('reconnect_timeout', false);
        checkAgent();
        return;
      }
      if (state === ConnectionState.Reconnecting || state === ConnectionState.Disconnected) {
        setReason('livekit_disconnected', true);
      }
      if (state === ConnectionState.Reconnecting && !reconnectTimer) {
        reconnectTimer = setTimeout(
          () => setReason('reconnect_timeout', true),
          RECONNECT_TIMEOUT_MS,
        );
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
        const data = JSON.parse(new TextDecoder().decode(payload)) as { type?: string };
        if (data.type === 'stt_error') setReason('stt_failed', true);
        if (data.type === 'stt_recovered') setReason('stt_failed', false);
      } catch {
        // The recording store owns ordinary transcript payload validation.
      }
    };

    handleConnection(room.state);
    room.on(RoomEvent.ConnectionStateChanged, handleConnection);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, checkAgent);
    room.on(RoomEvent.DataReceived, handleData);
    return (): void => {
      clearReconnectTimer();
      if (agentTimer) clearTimeout(agentTimer);
      room.off(RoomEvent.ConnectionStateChanged, handleConnection);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, checkAgent);
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [externalId, room, setReason]);

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
