import { useCallback, useEffect, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { useZeroOfflineState } from '@xyne/shared/hooks';
import { AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { refreshOatsRecordings } from '../../../hooks/usePaginatedOatsRecordings';
import { useMarkMoment } from '../../../hooks/useMarkMoment';
import { sendRecordingEvent, useRecordingStore } from '../../../hooks/useRecordingStore';
import { recordingService } from '../../../services/Recording/recordingService';
import { DEFAULT_RECORDING_TITLE } from '../../../stores/recordingStore';
import { isElectronApp } from '../../../utils/electronApp';
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
  // hide the overlay when live recording detail screen entered.
  const isViewingThisRecording =
    Boolean(externalId) && pathname.replace(/\/+$/, '').endsWith(`/recordings/${externalId}`);

  const handleStop = useCallback((): void => {
    const stoppedRecordingId = externalId;
    const alreadyTitled = Boolean(title?.trim());

    sendRecordingEvent({ type: 'stopRecording' });

    if (!stoppedRecordingId) return;
    if (alreadyTitled) {
      refreshOatsRecordings();
      return;
    }

    void recordingService
      .updateRecordingTitle(stoppedRecordingId, DEFAULT_RECORDING_TITLE)
      .catch(() => toast.error('Recording saved, but its title could not be set.'))
      .finally(refreshOatsRecordings);
  }, [externalId, title]);

  useEffect(() => {
    if (!isActive) return;
    if (agentLeft) toast.warning('Recording ended because the note taker left the call.');
    if (pendingStop || agentLeft) handleStop();
  }, [agentLeft, handleStop, isActive, pendingStop]);

  // ─── Native pill hand-off (Electron only) ─────────────────────────────────
  const isElectron = isElectronApp();

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

  return (
    <>
      <AnimatePresence initial={false}>
        {isActive && startTime !== null && !isViewingThisRecording && !isMinimized && (
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
            onMinimize={isElectron ? handleMinimize : undefined}
          />
        )}
      </AnimatePresence>
    </>
  );
}
