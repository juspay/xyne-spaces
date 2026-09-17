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
import {
  offlineRecordingService,
  RECORDING_STORAGE_EXHAUSTED_EVENT,
} from '../../services/Recording/offlineRecordingService';
import { setRecordingRepairUploader } from '../../services/Recording/archive/uploader';
import { backendProxyUploader } from '../../services/Recording/archive/backendProxyUploader';
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
      // Dark title/description colors live in sonner-overrides.css keyed off this
      // class — the global Toaster's !text-card-foreground would otherwise render
      // the text near-white and invisible on this pale-yellow background.
      className: 'recording-connection-warning',
      style: {
        background: '#fef3c7',
        border: '1px solid #f59e0b',
        color: '#78350f',
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
      setRecordingRepairUploader(backendProxyUploader);
      void offlineRecordingService.initialize().catch(() => {
        sendRecordingEvent({ type: 'setFallbackProtection', availability: 'unavailable' });
      });
    };
    initialize();
    const prepareForPageHide = (): void => offlineRecordingService.prepareForPageHide();
    window.addEventListener('online', initialize);
    window.addEventListener('pagehide', prepareForPageHide);
    return (): void => {
      window.removeEventListener('online', initialize);
      window.removeEventListener('pagehide', prepareForPageHide);
    };
  }, []);

  useEffect(() => {
    const stopForExhaustedStorage = (): void => {
      const currentStatus = getRecordingStatus();
      if (currentStatus === 'recording' || currentStatus === 'paused') {
        sendRecordingEvent({ type: 'stopRecording' });
      }
    };
    window.addEventListener(RECORDING_STORAGE_EXHAUSTED_EVENT, stopForExhaustedStorage);
    return (): void =>
      window.removeEventListener(RECORDING_STORAGE_EXHAUSTED_EVENT, stopForExhaustedStorage);
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
      // Audio stops reaching the server the moment LiveKit leaves Connected, so the
      // whole Reconnecting→Disconnected span is a transcript gap — open the outage
      // now rather than waiting for a terminal disconnect (the default reconnect
      // policy can take 1–2 min to declare one, or never if it recovers). The full
      // call is always on disk; the outage only marks the range to repair, and the
      // window closes again when the room returns to Connected.
      if (state === ConnectionState.Reconnecting || state === ConnectionState.Disconnected) {
        showConnectionWarning();
        const currentStatus = getRecordingStatus();
        const isActive = currentStatus === 'recording' || currentStatus === 'paused';
        if (isActive) setReason('livekit_disconnected', true);
      }
    };
    handleConnection(room.state);
    room.on(RoomEvent.ConnectionStateChanged, handleConnection);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    return (): void => {
      if (agentTimer) clearTimeout(agentTimer);
      room.off(RoomEvent.ConnectionStateChanged, handleConnection);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    };
  }, [externalId, room, setReason, showConnectionWarning]);

  // A dropped local uplink (Wi-Fi off) stops audio reaching the server even while
  // LiveKit is only "Reconnecting" and may never declare a terminal disconnect, so
  // track browser connectivity directly. setReason no-ops when no capture is active,
  // and merges with any concurrent livekit_disconnected into one outage window.
  useEffect(() => {
    const handleOffline = (): void => {
      const currentStatus = getRecordingStatus();
      if (currentStatus !== 'recording' && currentStatus !== 'paused') return;
      showConnectionWarning();
      setReason('browser_offline', true);
    };
    const handleOnline = (): void => setReason('browser_offline', false);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return (): void => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [setReason, showConnectionWarning]);

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
