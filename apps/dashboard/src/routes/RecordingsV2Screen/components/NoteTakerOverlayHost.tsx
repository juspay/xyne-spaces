import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { useZeroOfflineState } from '@xyne/shared/hooks';
import { AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { refreshOatsRecordings } from '../../../hooks/usePaginatedOatsRecordings';
import { useMarkMoment } from '../../../hooks/useMarkMoment';
import { sendRecordingEvent, useRecordingStore } from '../../../hooks/useRecordingStore';
import { useZero } from '../../../hooks/useZero';
import { canvasService } from '../../../services/Canvas/canvasService';
import { recordingService } from '../../../services/Recording/recordingService';
import { DEFAULT_NOTES_TITLE, DEFAULT_RECORDING_TITLE } from '../../../stores/recordingStore';
import { mutators } from '../../../zero/mutators';
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
  const zero = useZero();
  const { markMoment } = useMarkMoment();
  const { showOfflineBanner } = useZeroOfflineState();
  const [isCreatingNotes, setIsCreatingNotes] = useState(false);
  const [notesCreationFailed, setNotesCreationFailed] = useState(false);
  const isCreatingNotesRef = useRef(false);
  const notesCreationAttemptRef = useRef(0);
  const activeRecordingIdRef = useRef<string | null>(externalId);
  const lastExternalIdRef = useRef<string | null>(null);
  const isActive = status === 'recording' || status === 'paused';
  const { pathname } = useLocation();
  // hide the overlay when live recording detail screen entered.
  const isViewingThisRecording =
    Boolean(externalId) && pathname.replace(/\/+$/, '').endsWith(`/recordings/${externalId}`);

  useEffect(() => {
    activeRecordingIdRef.current = externalId;
    if (externalId) lastExternalIdRef.current = externalId;
  }, [externalId]);

  useEffect(() => {
    if (isActive) return;

    notesCreationAttemptRef.current += 1;
    isCreatingNotesRef.current = false;
    setIsCreatingNotes(false);
    setNotesCreationFailed(false);
  }, [isActive]);

  const handleCreateNotes = useCallback(async (): Promise<void> => {
    if (!externalId || notesCanvasId || isCreatingNotesRef.current) return;

    const creationAttempt = notesCreationAttemptRef.current + 1;
    notesCreationAttemptRef.current = creationAttempt;
    isCreatingNotesRef.current = true;
    setIsCreatingNotes(true);
    setNotesCreationFailed(false);

    try {
      const canvasId = uuidv4();
      await canvasService.createCollaborativeCanvas({
        id: canvasId,
        title: DEFAULT_NOTES_TITLE,
        ...(channelId ? { channelId } : {}),
      });
      if (
        notesCreationAttemptRef.current !== creationAttempt ||
        activeRecordingIdRef.current !== externalId
      ) {
        return;
      }

      sendRecordingEvent({ type: 'setNotesCanvas', canvasId, title: DEFAULT_NOTES_TITLE });

      try {
        const linkResult = await zero.mutate(
          mutators.calls.linkNotesCanvas({ callId: externalId, notesCanvasId: canvasId }),
        ).server;
        if (linkResult.type === 'error') {
          throw new Error(linkResult.error?.message ?? 'Failed to link notes canvas');
        }
      } catch {
        toast.warning('Notes were created, but may not appear with this recording later.');
      }
    } catch {
      if (notesCreationAttemptRef.current !== creationAttempt) return;
      setNotesCreationFailed(true);
      toast.error('Failed to create notes. Please try again.');
    } finally {
      if (notesCreationAttemptRef.current === creationAttempt) {
        isCreatingNotesRef.current = false;
        setIsCreatingNotes(false);
      }
    }
  }, [channelId, externalId, notesCanvasId, zero]);

  useEffect(() => {
    if (!isActive || !externalId || notesCanvasId || isCreatingNotesRef.current) return;
    void handleCreateNotes();
  }, [isActive, externalId, notesCanvasId, handleCreateNotes]);

  const handleStop = useCallback((): void => {
    const stoppedRecordingId = externalId;
    const alreadyTitled = Boolean(title?.trim());

    activeRecordingIdRef.current = null;
    lastExternalIdRef.current = stoppedRecordingId;
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

  return (
    <>
      <AnimatePresence initial={false}>
        {isActive && startTime !== null && !isViewingThisRecording && (
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
            isCreatingNotes={isCreatingNotes}
            notesCreationFailed={notesCreationFailed}
            onCreateNotes={() => void handleCreateNotes()}
            isOffline={showOfflineBanner}
            title={title ?? undefined}
            onStop={handleStop}
            onPause={() => sendRecordingEvent({ type: 'pauseRecording' })}
            onResume={() => sendRecordingEvent({ type: 'resumeRecording' })}
            onMarkMoment={markMoment}
          />
        )}
      </AnimatePresence>
    </>
  );
}
