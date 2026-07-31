import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { removeRecordingsFromCache } from '../../../hooks/usePaginatedRecordings';
import { sendRecordingEvent, useRecordingStore } from '../../../hooks/useRecordingStore';
import { useZero } from '../../../hooks/useZero';
import { canvasService } from '../../../services/Canvas/canvasService';
import { recordingService } from '../../../services/Recording/recordingService';
import { DEFAULT_NOTES_TITLE } from '../../../stores/recordingStore';
import { generateRecordingTitle } from '../../../utils/recordingUtils';
import { mutators } from '../../../zero/mutators';
import { SaveTitleModal } from '../../RecordingsScreen/components/SaveTitleModal';
import NoteTakerOverlay from './NoteTakerOverlay';

export function NoteTakerOverlayHost(): ReactElement {
  const status = useRecordingStore(context => context.status);
  const startTime = useRecordingStore(context => context.startTime);
  const pauseStartedAt = useRecordingStore(context => context.pauseStartedAt);
  const accumulatedPausedMs = useRecordingStore(context => context.accumulatedPausedMs);
  const externalId = useRecordingStore(context => context.externalId);
  const channelId = useRecordingStore(context => context.channelId);
  const notesCanvasId = useRecordingStore(context => context.notesCanvasId);
  const pendingStop = useRecordingStore(context => context.pendingStop);
  const agentLeft = useRecordingStore(context => context.agentLeft);
  const transcripts = useRecordingStore(context => context.transcripts);
  const zero = useZero();
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const [endedByAgentDrop, setEndedByAgentDrop] = useState(false);
  const [isCreatingNotes, setIsCreatingNotes] = useState(false);
  const [notesCreationFailed, setNotesCreationFailed] = useState(false);
  const isCreatingNotesRef = useRef(false);
  const notesCreationAttemptRef = useRef(0);
  const activeRecordingIdRef = useRef<string | null>(externalId);
  const lastExternalIdRef = useRef<string | null>(null);
  const lastStartTimeRef = useRef<number | null>(null);
  const isActive = status === 'recording' || status === 'paused';

  useEffect(() => {
    activeRecordingIdRef.current = externalId;
    if (externalId) lastExternalIdRef.current = externalId;
  }, [externalId]);

  useEffect(() => {
    if (startTime) lastStartTimeRef.current = startTime;
  }, [startTime]);

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
    activeRecordingIdRef.current = null;
    lastExternalIdRef.current = externalId;
    sendRecordingEvent({ type: 'stopRecording' });
    setShowTitleModal(true);
  }, [externalId]);

  useEffect(() => {
    if (!isActive) return;
    if (agentLeft) setEndedByAgentDrop(true);
    if (pendingStop || agentLeft) handleStop();
  }, [agentLeft, handleStop, isActive, pendingStop]);

  const handleSaveTitle = useCallback(async (title: string): Promise<void> => {
    setSavingTitle(true);
    try {
      if (!lastExternalIdRef.current) {
        setShowTitleModal(false);
        sendRecordingEvent({ type: 'clearTranscripts' });
        toast.warning('Recording saved without title - no recording ID available');
        return;
      }

      await recordingService.updateRecordingTitle(lastExternalIdRef.current, title);
      removeRecordingsFromCache([lastExternalIdRef.current]);
      setShowTitleModal(false);
      setEndedByAgentDrop(false);
      sendRecordingEvent({ type: 'clearTranscripts' });
      toast.success('Recording saved', { description: title });
    } catch {
      toast.error('Failed to save title');
    } finally {
      setSavingTitle(false);
    }
  }, []);

  return (
    <>
      <AnimatePresence initial={false}>
        {isActive && startTime !== null && (
          <NoteTakerOverlay
            key='floating-recording-transcript'
            status={status}
            startTime={startTime}
            pauseStartedAt={pauseStartedAt}
            accumulatedPausedMs={accumulatedPausedMs}
            transcripts={transcripts}
            channelId={channelId}
            notesCanvasId={notesCanvasId}
            isCreatingNotes={isCreatingNotes}
            notesCreationFailed={notesCreationFailed}
            onCreateNotes={() => void handleCreateNotes()}
            onStop={handleStop}
            onPause={() => sendRecordingEvent({ type: 'pauseRecording' })}
            onResume={() => sendRecordingEvent({ type: 'resumeRecording' })}
          />
        )}
      </AnimatePresence>

      <SaveTitleModal
        isOpen={showTitleModal}
        defaultTitle={generateRecordingTitle(lastStartTimeRef.current)}
        onSave={handleSaveTitle}
        isSaving={savingTitle}
        endedByAgentDrop={endedByAgentDrop}
      />
    </>
  );
}
