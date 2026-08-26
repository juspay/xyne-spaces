import { useCallback, useEffect, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useZeroOfflineState } from '@xyne/shared/hooks';
import { AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { refreshOatsRecordings } from '../../../hooks/usePaginatedOatsRecordings';
import { useMarkMoment } from '../../../hooks/useMarkMoment';
import { sendRecordingEvent, useRecordingStore } from '../../../hooks/useRecordingStore';
import { recordingService } from '../../../services/Recording/recordingService';
import { isElectronApp } from '../../../utils/electronApp';
import {
  calculateRecordingElapsedMs,
  logRecordingError,
  NO_TRANSCRIPT_RECORDING_TITLE,
} from '../../../utils/recordingUtils';
import NoteTakerOverlay from './NoteTakerOverlay';

export function NoteTakerOverlayHost(): ReactElement {
  const status = useRecordingStore(context => context.status);
  const startTime = useRecordingStore(context => context.startTime);
  const pauseStartedAt = useRecordingStore(context => context.pauseStartedAt);
  const accumulatedPausedMs = useRecordingStore(context => context.accumulatedPausedMs);
  const externalId = useRecordingStore(context => context.externalId);
  const channelId = useRecordingStore(context => context.channelId);
  const title = useRecordingStore(context => context.title);
  const notesCanvasId = useRecordingStore(context => context.notesCanvasId);
  const pendingStop = useRecordingStore(context => context.pendingStop);
  const agentLeft = useRecordingStore(context => context.agentLeft);
  const transcripts = useRecordingStore(context => context.transcripts);
  const markedMoments = useRecordingStore(context => context.markedMoments);
  const isMinimized = useRecordingStore(context => context.isTranscriptMinimized);
  const { markMoment } = useMarkMoment();
  const { showOfflineBanner } = useZeroOfflineState();
  const isActive = status === 'recording' || status === 'paused';
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // hide the overlay when live recording detail screen entered.
  const isViewingThisRecording =
    Boolean(externalId) && pathname.replace(/\/+$/, '').endsWith(`/recordings/${externalId}`);
  const isOnRecordingsSection = /^\/[^/]+\/recordings(\/|$)/.test(pathname);

  const handleStop = useCallback((): void => {
    const stoppedRecordingId = externalId;
    const capturedNothing = transcripts.length === 0;
    const alreadyTitled = Boolean(title?.trim());
    const durationMs = calculateRecordingElapsedMs(startTime, pauseStartedAt, accumulatedPausedMs);
    const endedAtMs = Date.now();

    sendRecordingEvent({ type: 'stopRecording' });

    // The recording just transitioned to ENDED — land the user on its detail
    if (stoppedRecordingId && !isViewingThisRecording) {
      void navigate(`/recordings/${stoppedRecordingId}`, {
        state: { justStopped: true, durationMs, endedAtMs, hasTranscript: !capturedNothing },
      });
    }

    if (!stoppedRecordingId || alreadyTitled || !capturedNothing) {
      refreshOatsRecordings();
      return;
    }

    void recordingService
      .updateRecordingTitle(stoppedRecordingId, NO_TRANSCRIPT_RECORDING_TITLE)
      .catch(err => logRecordingError('NoteTakerOverlayHost.titleUntranscribed', err))
      .finally(refreshOatsRecordings);
  }, [
    externalId,
    title,
    transcripts,
    isViewingThisRecording,
    navigate,
    startTime,
    pauseStartedAt,
    accumulatedPausedMs,
  ]);

  useEffect(() => {
    if (!isActive) return;
    if (agentLeft) toast.warning('Recording ended because the note taker left the call.');
    if (pendingStop || agentLeft) handleStop();
  }, [agentLeft, handleStop, isActive, pendingStop]);

  // ─── Native pill hand-off (Electron only) ─────────────────────────────────
  const isElectron = isElectronApp();

  useEffect(() => {
    if (!isElectron || !isActive) return;
    sendRecordingEvent({ type: 'setTranscriptMinimized', isMinimized: !isOnRecordingsSection });
  }, [isElectron, isActive, isOnRecordingsSection]);

  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI?.ipcSend?.('recording:set-minimized', isActive && isMinimized);
  }, [isElectron, isActive, isMinimized]);

  useEffect(() => {
    const recordingPill = window.electronAPI?.recordingPill;
    if (!isElectron || !recordingPill?.onMinimizedChanged) return;
    // Expanding the pill is the only way back once minimised.
    return recordingPill.onMinimizedChanged(minimized => {
      sendRecordingEvent({ type: 'setTranscriptMinimized', isMinimized: minimized });
    });
  }, [isElectron]);

  const handleMinimize = useCallback((): void => {
    sendRecordingEvent({ type: 'setTranscriptMinimized', isMinimized: true });
  }, []);

  const handleExpand = useCallback((): void => {
    sendRecordingEvent({ type: 'setTranscriptMinimized', isMinimized: false });
  }, []);

  const shouldRenderOverlay =
    isActive && startTime !== null && !isViewingThisRecording && (!isMinimized || !isElectron);

  return (
    <>
      <AnimatePresence initial={false}>
        {shouldRenderOverlay && (
          <NoteTakerOverlay
            key='floating-recording-transcript'
            status={status}
            startTime={startTime}
            pauseStartedAt={pauseStartedAt}
            accumulatedPausedMs={accumulatedPausedMs}
            transcripts={transcripts}
            markedMoments={markedMoments}
            channelId={channelId}
            recordingId={externalId}
            notesCanvasId={notesCanvasId}
            isOffline={showOfflineBanner}
            title={title ?? undefined}
            onStop={handleStop}
            onPause={() => sendRecordingEvent({ type: 'pauseRecording' })}
            onResume={() => sendRecordingEvent({ type: 'resumeRecording' })}
            onMarkMoment={markMoment}
            isMinimized={isMinimized}
            onMinimize={handleMinimize}
            onExpand={handleExpand}
            onTitleUpdated={(nextTitle: string) =>
              sendRecordingEvent({ type: 'setTitle', title: nextTitle })
            }
          />
        )}
      </AnimatePresence>
    </>
  );
}
