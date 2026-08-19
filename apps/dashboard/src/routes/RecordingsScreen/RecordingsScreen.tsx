/**
 * Recordings Screen - View and manage headless audio recordings
 * Two-panel design inspired by native RecordingsListScreen:
 *   1. List view — all recordings + sticky bottom record button (always rendered)
 *   2. Active recording workspace — live transcript stream, shown as an overlay
 *      that can be minimized to reveal the list underneath.
 * Recording persists across navigation via the global RecordingOverlay.
 */

import { ReactElement, useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { v4 as uuidv4 } from 'uuid';
import AppNavigator from '../../components/AppNavigator/AppNavigator';
import { usePlatform } from '../../hooks/usePlatform';
import { ResizableGroup, Panel, Separator } from '../../components/ui/Resizable/Resizable';
import { recordingService } from '../../services/Recording/recordingService';
import { canvasService } from '../../services/Canvas/canvasService';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { Mic, Clock, FileText, Loader2, AlertCircle, ChevronDown, Layers } from 'lucide-react';
import { ConnectionState } from 'livekit-client';
import { formatDistanceToNow } from 'date-fns';
import {
  useRecordingStore,
  sendRecordingEvent,
  useTranscriptStream,
} from '../../hooks/useRecordingStore';
import { RecordingControlBar } from './components/RecordingControlBar';
import { RecordingWorkspaceHeader } from './components/RecordingWorkspaceHeader';
import { ActiveRecordingView } from './components/ActiveRecordingView';
import { RecordingCanvasPane } from './components/RecordingCanvasPane';
import { MinimizedTranscriptView } from './components/MinimizedTranscriptView';
import { SaveTitleModal } from './components/SaveTitleModal';
import { AudioPlayer } from '../../components/ui/AudioPlayer/AudioPlayer';
import { toast } from 'sonner';
import {
  formatRecordingDuration,
  generateRecordingTitle,
  logRecordingError,
  STT_MODEL_LABELS,
} from '../../utils/recordingUtils';
import { logger, Event as LoggerEvent } from '../../utils/logger';
import {
  usePaginatedRecordings,
  removeRecordingsFromCache,
  type RecordingEntry,
} from '../../hooks/usePaginatedRecordings';
import { useRecordingConnectionState } from './hooks/useRecordingConnectionState';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { ActionModal } from '../../components/Call/ActionModal';
import { RecordingsBulkActionBar } from './components/RecordingsBulkActionBar';
import { queries } from '../../zero/queries';
import {
  RecordingReconnectingOverlay,
  RecordingConnectionWarningModal,
} from './components/RecordingConnectionStatus';
import { getRecordingDefaultLayout } from '../../hooks/useRecordingDefaultLayout';
import { DEFAULT_NOTES_TITLE } from '../../stores/recordingStore';

const AUTO_START_TTL_MS = 60_000;

/** Loading skeleton that mimics RecordingCanvasPane structure */
const CanvasPaneSkeleton = (): ReactElement => (
  <div className='flex flex-col h-full overflow-hidden bg-secondary/50'>
    {/* Skeleton header - matches RecordingCanvasPane header */}
    <div className='flex-none flex items-center justify-between pt-3 pb-2 px-5'>
      <div className='flex items-center gap-1.5 min-w-0'>
        <div className='size-4 rounded bg-muted animate-pulse' />
        <div className='h-4 w-28 rounded bg-muted animate-pulse' />
        <div className='h-3 w-16 rounded bg-muted/60 animate-pulse' />
      </div>
    </div>
    {/* Skeleton editor - matches RecordingCanvasPane editor wrapper */}
    <div className='flex-1 min-h-0 overflow-hidden flex justify-center px-4'>
      <div className='w-full max-w-5xl flex flex-col'>
        <div className='flex-1 min-h-0 overflow-auto bg-card flex flex-col rounded-t-xl border border-border p-6 space-y-4'>
          <div className='h-4 w-3/4 rounded bg-muted animate-pulse' />
          <div className='h-4 w-full rounded bg-muted/80 animate-pulse' />
          <div className='h-4 w-5/6 rounded bg-muted/60 animate-pulse' />
          <div className='h-4 w-2/3 rounded bg-muted/40 animate-pulse' />
        </div>
      </div>
    </div>
  </div>
);

/** Fallback UI when canvas creation fails or hasn't started */
const CanvasCreationFallback = ({
  onRetry,
  onSwitchToTranscript,
}: {
  onRetry: () => void;
  onSwitchToTranscript: () => void;
}): ReactElement => (
  <div className='flex flex-col h-full overflow-hidden bg-secondary/50'>
    <div className='flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center'>
      <div className='flex flex-col items-center gap-2'>
        <Layers className='size-10 text-muted-foreground/50' />
        <p className='text-sm text-muted-foreground'>Unable to create notes canvas</p>
      </div>
      <div className='flex items-center gap-2'>
        <button
          onClick={onRetry}
          className='px-4 py-2 text-sm font-medium rounded-lg bg-action-primary text-action-primary-foreground hover:bg-action-primary/90 transition-colors'
          data-track-category='RecordingsScreen'
          data-track-name='retry_create_canvas'
        >
          Try Again
        </button>
        <button
          onClick={onSwitchToTranscript}
          className='px-4 py-2 text-sm font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted transition-colors'
          data-track-category='RecordingsScreen'
          data-track-name='switch_to_transcript_only'
        >
          Use Transcript Only
        </button>
      </div>
    </div>
  </div>
);

const MAX_ASK_AI_SELECTION = 5;

export default function RecordingsScreen(): ReactElement {
  const { isMobile } = usePlatform();
  const [error, setError] = useState<string | null>(null);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  // True when the title modal was opened because the agent dropped (auto-end),
  // not by a user-initiated stop. Drives the warning banner in SaveTitleModal.
  const [endedByAgentDrop, setEndedByAgentDrop] = useState(false);
  const [showSttPicker, setShowSttPicker] = useState(false);
  const [sttModel, setSttModel] = useState<'google' | 'azure' | 'deepgram'>('google');
  // Multi-select for bulk actions (delete / ask AI)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isPreparingAskAI, setIsPreparingAskAI] = useState(false);

  const navigate = useNavigate();
  const zero = useZero();

  const { recordings, hasMoreRecordings, loadMoreRecordings, onVisibleRangeChanged, isLoading } =
    usePaginatedRecordings();

  // Recording store state (context holds the recording-specific fields)
  const recordingStatus = useRecordingStore(ctx => ctx.status);
  const startTime = useRecordingStore(ctx => ctx.startTime);
  const pauseStartedAt = useRecordingStore(ctx => ctx.pauseStartedAt);
  const accumulatedPausedMs = useRecordingStore(ctx => ctx.accumulatedPausedMs);
  const externalId = useRecordingStore(ctx => ctx.externalId);
  const channelId = useRecordingStore(ctx => ctx.channelId);
  const notesCanvasId = useRecordingStore(ctx => ctx.notesCanvasId);
  const pendingAutoStart = useRecordingStore(ctx => ctx.pendingAutoStart);
  const autoStartRequestedAt = useRecordingStore(ctx => ctx.autoStartRequestedAt);
  const pendingConversationId = useRecordingStore(ctx => ctx.pendingConversationId);
  const pendingChannelId = useRecordingStore(ctx => ctx.pendingChannelId);
  const pendingStop = useRecordingStore(ctx => ctx.pendingStop);
  const agentLeft = useRecordingStore(ctx => ctx.agentLeft);
  const room = useRecordingStore(ctx => ctx.room);
  const activeLayout = useRecordingStore(ctx => ctx.activeLayout);
  const isTranscriptMinimized = useRecordingStore(ctx => ctx.isTranscriptMinimized);

  const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);
  const [canvasCreationFailed, setCanvasCreationFailed] = useState(false);

  const isCreatingCanvasRef = useRef(false);

  const hasCanvas = !!notesCanvasId;

  const isActive =
    recordingStatus === 'recording' ||
    recordingStatus === 'paused' ||
    recordingStatus === 'starting';

  // Reset to maximized transcript view only when a NEW recording becomes active
  // (i.e., when isActive transitions from false to true), not on every mount
  const prevIsActiveRef = useRef(isActive);
  useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;
    if (isActive && !wasActive) {
      sendRecordingEvent({ type: 'setTranscriptMinimized', isMinimized: false });
    }
  }, [isActive]);

  // Stable callback passed to the connection hook — stops the recording and
  // shows the save-title modal when the room disconnects unexpectedly.
  const handleUnexpectedDisconnect = useCallback((): void => {
    sendRecordingEvent({ type: 'stopRecording' });
    setShowTitleModal(true);
  }, []);

  const { roomConnectionState, showConnectionWarning, networkQuality, dismissConnectionWarning } =
    useRecordingConnectionState(room, isActive, recordingStatus, handleUnexpectedDisconnect);

  // Live transcript streaming from global store (subscription is managed by the store)
  const { transcripts } = useTranscriptStream();

  const formatDuration = formatRecordingDuration;
  const generateAutoTitle = (): string => generateRecordingTitle(startTime);

  const handleStartRecording = (): void => {
    const defaultLayout = getRecordingDefaultLayout();
    sendRecordingEvent({ type: 'clearTranscripts' });
    sendRecordingEvent({
      type: 'startRecording',
      sttModel,
      defaultLayout,
      ...(pendingConversationId && { conversationId: pendingConversationId }),
      ...(pendingChannelId && { channelId: pendingChannelId }),
    });
  };

  // Auto-start recording when triggered from the meeting popup, tray or shortcut
  useEffect(() => {
    if (!pendingAutoStart) return;
    if (autoStartRequestedAt !== null && Date.now() - autoStartRequestedAt > AUTO_START_TTL_MS) {
      sendRecordingEvent({ type: 'clearAutoStart' });
      return;
    }
    if (recordingStatus === 'idle' || recordingStatus === 'error') {
      handleStartRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoStart, autoStartRequestedAt]);

  // auto canvas creation while default tab is notes or split
  const hasAttemptedAutoCanvasRef = useRef(false);

  // Reset canvas creation flags when recording stops
  useEffect(() => {
    if (recordingStatus === 'idle') {
      hasAttemptedAutoCanvasRef.current = false;
      isCreatingCanvasRef.current = false;
      setCanvasCreationFailed(false);
    }
  }, [recordingStatus]);

  const handlePauseRecording = (): void => {
    sendRecordingEvent({ type: 'pauseRecording' });
  };

  const handleResumeRecording = (): void => {
    sendRecordingEvent({ type: 'resumeRecording' });
  };

  // Create a collaborative notes canvas for the active recording
  const handleCreateCanvas = async (forceSplitView = false): Promise<void> => {
    if (hasCanvas || isCreatingCanvasRef.current) return;
    isCreatingCanvasRef.current = true;
    setIsCreatingCanvas(true);
    setCanvasCreationFailed(false);
    try {
      const canvasId = uuidv4();
      await canvasService.createCollaborativeCanvas({
        id: canvasId,
        title: DEFAULT_NOTES_TITLE,
        ...(channelId ? { channelId } : {}),
      });
      sendRecordingEvent({ type: 'setNotesCanvas', canvasId, title: DEFAULT_NOTES_TITLE });
      // Only force split view when user manually clicks "Create Notes" button
      if (forceSplitView) {
        sendRecordingEvent({ type: 'setActiveLayout', layout: 'split' });
      }
      // Persist the link on the call now; the thread post happens in the summary pipeline
      if (externalId) {
        try {
          const linkResult = await zero.mutate(
            mutators.calls.linkNotesCanvas({
              callId: externalId,
              notesCanvasId: canvasId,
            }),
          ).server;
          if (linkResult.type === 'error') {
            throw new Error(linkResult.error?.message ?? 'Failed to link notes canvas');
          }
        } catch (linkError) {
          logger.warn(LoggerEvent.API_CALL_FAILED, {
            message: 'Failed to link notes canvas to recording',
            callId: externalId,
            canvasId,
            error: linkError instanceof Error ? linkError.message : String(linkError),
          });
          toast.warning('Notes were created, but may not appear on the recording detail page yet.');
        }
      }
    } catch (err) {
      setCanvasCreationFailed(true);
      logger.error(LoggerEvent.API_CALL_FAILED, {
        message: 'Failed to create notes canvas',
        error: err instanceof Error ? err.message : String(err),
      });
      toast.error('Failed to create notes canvas. Please try again.');
    } finally {
      isCreatingCanvasRef.current = false;
      setIsCreatingCanvas(false);
    }
  };

  // Auto-create canvas when recording starts if this session's layout is split/notes
  useEffect(() => {
    // Only proceed when recording has just started
    if (recordingStatus !== 'recording') return;
    // Don't auto-create if we've already attempted for this session
    if (hasAttemptedAutoCanvasRef.current) return;
    // Don't auto-create if canvas already exists or is being created
    if (hasCanvas || isCreatingCanvas) return;

    if (activeLayout === 'split' || activeLayout === 'notes') {
      hasAttemptedAutoCanvasRef.current = true;
      // Set creating state early so skeleton shows immediately on next render
      setIsCreatingCanvas(true);
      void handleCreateCanvas();
    }
  }, [recordingStatus, activeLayout, hasCanvas, isCreatingCanvas]);

  const sttModelLabels = STT_MODEL_LABELS;

  // Keep a ref so we can save the title after stopRecording resets the store
  const lastExternalIdRef = useRef<string | null>(null);

  // Keep ref in sync with store value
  useEffect(() => {
    if (externalId) {
      lastExternalIdRef.current = externalId;
    }
  }, [externalId]);

  const handleStopRecording = (): void => {
    // Capture externalId before stopRecording resets the store
    lastExternalIdRef.current = externalId;
    // Stop the recording in the store (disconnects room)
    sendRecordingEvent({ type: 'stopRecording' });
    // Show save title modal
    setShowTitleModal(true);
  };

  // Stop from the floating pill — same flow as clicking Stop in the UI (shows title modal)
  useEffect(() => {
    if (pendingStop && (recordingStatus === 'recording' || recordingStatus === 'paused')) {
      handleStopRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingStop, recordingStatus]);

  // Agent dropped mid-recording → auto-end and show the save-title modal with a
  // notice. No confirmation: a note-taker with no transcription can't continue.
  useEffect(() => {
    if (agentLeft && (recordingStatus === 'recording' || recordingStatus === 'paused')) {
      lastExternalIdRef.current = externalId;
      setEndedByAgentDrop(true);
      sendRecordingEvent({ type: 'stopRecording' }); // clears agentLeft in the store
      setShowTitleModal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentLeft, recordingStatus]);

  // ─── REMOVED: connection state management moved to useRecordingConnectionState ───
  // See hooks/useRecordingConnectionState.ts

  const handleSaveTitle = async (title: string): Promise<void> => {
    setSavingTitle(true);
    try {
      if (!lastExternalIdRef.current) {
        // No recording ID available - close modal and warn user
        setShowTitleModal(false);
        sendRecordingEvent({ type: 'clearTranscripts' });
        toast.warning('Recording saved without title - no recording ID available');
        return;
      }
      await recordingService.updateRecordingTitle(lastExternalIdRef.current, title);
      setShowTitleModal(false);
      setEndedByAgentDrop(false);
      sendRecordingEvent({ type: 'clearTranscripts' });
      toast.success('Recording saved', { description: title });
    } catch {
      toast.error('Failed to save title');
    } finally {
      setSavingTitle(false);
    }
  };

  const handleRecordingClick = (recording: RecordingEntry): void => {
    const recordingIds = recordings.map(r => r.externalId);
    void navigate(`/recordings/${recording.externalId}`, {
      state: { recordingIds },
    });
  };

  const toggleSelect = (id: string): void => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const clearSelection = (): void => setSelectedIds(new Set());

  const handleAskAISelected = async (): Promise<void> => {
    const selected = recordings.filter(r => selectedIds.has(r.externalId));
    if (selected.length === 0 || selected.length > MAX_ASK_AI_SELECTION || isPreparingAskAI) return;

    setIsPreparingAskAI(true);
    try {
      const details = await Promise.all(
        selected.map(r => recordingService.getRecordingDetail(r.externalId)),
      );
      const messages = await Promise.all(
        details.map(d =>
          d.messageId
            ? zero.run(queries.getMessageForActivityV2({ messageId: d.messageId }), {
                type: 'complete',
              })
            : Promise.resolve(null),
        ),
      );
      const attachmentIds = messages.flatMap(m =>
        (m?.attachments ?? []).map((att: { id: string }) => att.id),
      );
      if (attachmentIds.length === 0) {
        toast.error('No transcripts available for the selected recordings');
        return;
      }
      const primary = details[0];
      xyneAIActor.send({
        type: 'OPEN',
        startFreshChat: true,
        ...(primary?.channelId ? { channelId: primary.channelId } : {}),
        threadInfo: {
          conversationId: primary?.conversationId ?? '',
          previewText:
            selected.length === 1
              ? (selected[0]?.title ?? 'Recording Transcript')
              : `${selected.length} recordings`,
          attachmentIds,
        },
      });
      clearSelection();
    } catch (err) {
      logRecordingError('RecordingsScreen.askAISelected', err);
      toast.error('Failed to open Ask AI');
    } finally {
      setIsPreparingAskAI(false);
    }
  };

  const handleDeleteSelected = async (): Promise<void> => {
    if (isBulkDeleting) return;
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setIsBulkDeleting(true);
    try {
      const { deleted, failed } = await recordingService.bulkDeleteRecordings(ids);
      removeRecordingsFromCache(deleted);
      if (failed.length > 0) {
        toast.error(`Failed to delete ${failed.length} recording${failed.length > 1 ? 's' : ''}`);
      } else {
        toast.success(`Deleted ${deleted.length} recording${deleted.length > 1 ? 's' : ''}`);
      }
      setShowBulkDelete(false);
      clearSelection();
    } catch (err) {
      logRecordingError('RecordingsScreen.deleteSelected', err);
      toast.error('Failed to delete recordings');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const selectedCount = selectedIds.size;

  // ─── Loading State ───────────────────────────────────────────────
  if (isLoading && recordings.length === 0 && !isActive) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='flex flex-col items-center gap-3'>
          <Loader2 className='w-8 h-8 animate-spin text-blue-500' />
          <p className='text-sm text-muted-foreground'>Loading recordings...</p>
        </div>
      </div>
    );
  }

  // ─── Error State ─────────────────────────────────────────────────
  if (error && !isActive) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='flex flex-col items-center gap-3 max-w-md text-center'>
          <AlertCircle className='w-12 h-12 text-red-500' />
          <h3 className='text-lg font-semibold text-foreground '>Error</h3>
          <p className='text-sm text-muted-foreground '>{error}</p>
          <button
            onClick={() => setError(null)}
            className='mt-4 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors'
            data-track-category='RecordingsScreen'
            data-track-name='try_again'
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ─── Main Layout ─────────────────────────────────────────────────
  return (
    <div
      data-testid='recordings-page'
      className='flex flex-col h-full relative bg-background md:rounded-2xl overflow-hidden shadow-md'
    >
      {/* Floated rather than in-flow so the list keeps the full viewport height.
          `w-fit` gives the shrink-to-fit box a definite width for the navigator's
          own `w-full`. */}
      {!isMobile && (
        <div className='absolute left-0 top-0 z-30 hidden h-[52px] w-fit md:block'>
          <AppNavigator />
        </div>
      )}
      {/* ─── Main Area (list + workspace overlay) ───── */}
      <div className='flex-1 relative overflow-hidden'>
        {/* List View — always rendered, stays behind the workspace overlay */}
        <div ref={setScrollContainer} className='absolute inset-0 overflow-auto'>
          <div
            className='max-w-4xl mx-auto p-6'
            style={isActive && isTranscriptMinimized ? { paddingBottom: '120px' } : undefined}
          >
            {/* Header */}
            <div className='mb-8'>
              <div className='flex items-center justify-between mb-2'>
                <h1 className='text-2xl font-bold text-foreground '>Recordings</h1>

                {/* STT Model Picker */}
                <div className='relative'>
                  <button
                    onClick={() => !isActive && setShowSttPicker(!showSttPicker)}
                    disabled={isActive}
                    className='flex items-center gap-2 px-3 py-1.5 text-sm bg-background border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                    data-track-category='RecordingsScreen'
                    data-track-name='open_stt_picker'
                  >
                    <span className='text-muted-foreground'>STT:</span>
                    <span className='font-medium text-foreground'>{sttModelLabels[sttModel]}</span>
                    <ChevronDown className='w-4 h-4 text-muted-foreground' />
                  </button>

                  {/* Dropdown */}
                  {showSttPicker && (
                    <>
                      <button
                        type='button'
                        className='fixed inset-0 z-40 bg-transparent'
                        onClick={() => setShowSttPicker(false)}
                        aria-label='Close STT picker'
                        data-track-category='RecordingsScreen'
                        data-track-name='close_stt_picker'
                      />
                      <div className='absolute right-0 top-full mt-1 w-40 bg-background rounded-lg shadow-lg border border-border py-1 z-50'>
                        {(['google', 'azure', 'deepgram'] as const).map(model => (
                          <button
                            key={model}
                            onClick={() => {
                              setSttModel(model);
                              setShowSttPicker(false);
                            }}
                            className='w-full px-4 py-2 text-left text-sm hover:bg-muted flex items-center justify-between'
                            data-track-category='RecordingsScreen'
                            data-track-name={`select_stt_model_${model}`}
                          >
                            <span
                              className={
                                sttModel === model
                                  ? 'font-medium text-blue-600 '
                                  : 'text-foreground '
                              }
                            >
                              {sttModelLabels[model]}
                            </span>
                            {sttModel === model && <span className='text-blue-600'>✓</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <p className='text-sm text-muted-foreground '>
                Your audio recordings with automatic transcription
              </p>
            </div>

            {/* Bulk Action Bar — shown when one or more recordings are selected */}
            {selectedCount > 0 && (
              <RecordingsBulkActionBar
                selectedCount={selectedCount}
                isPreparingAskAI={isPreparingAskAI}
                askAIDisabledReason={
                  selectedCount > MAX_ASK_AI_SELECTION
                    ? `For Ask AI, a maximum of ${MAX_ASK_AI_SELECTION} recordings can be selected`
                    : undefined
                }
                onClear={clearSelection}
                onAskAI={() => void handleAskAISelected()}
                onDelete={() => setShowBulkDelete(true)}
              />
            )}

            {/* Empty State */}
            {recordings.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-20 text-center'>
                <div className='w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4'>
                  <Mic className='w-8 h-8 text-muted-foreground' />
                </div>
                <h3 className='text-lg font-semibold text-foreground mb-2'>No recordings yet</h3>
                <p className='text-sm text-muted-foreground max-w-sm'>
                  Tap the record button below to start your first recording with automatic
                  transcription.
                </p>
              </div>
            ) : (
              /* Recordings List */
              <>
                {scrollContainer ? (
                  <Virtuoso
                    customScrollParent={scrollContainer}
                    data={recordings}
                    useWindowScroll={false}
                    atBottomThreshold={100}
                    endReached={loadMoreRecordings}
                    rangeChanged={range => onVisibleRangeChanged(range.startIndex)}
                    components={{
                      Footer: () =>
                        hasMoreRecordings ? (
                          <div className='py-4 text-center'>
                            <Loader2 className='w-5 h-5 animate-spin mx-auto text-muted-foreground' />
                          </div>
                        ) : null,
                    }}
                    itemContent={(_, recording) => (
                      <div className='pb-3'>
                        <div className='w-full bg-background rounded-lg border border-border overflow-hidden hover:shadow-md transition-shadow group flex items-center'>
                          {/* Clickable header area → navigate to detail */}
                          <button
                            type='button'
                            onClick={() => handleRecordingClick(recording)}
                            className='flex-1 min-w-0 text-left p-4 cursor-pointer'
                            data-track-category='RecordingsScreen'
                            data-track-name='view_recording'
                          >
                            <div className='flex items-start gap-4'>
                              {/* Icon */}
                              <div className='flex-shrink-0 w-10 h-10 rounded-full bg-blue-50  flex items-center justify-center group-hover:bg-blue-100  transition-colors'>
                                <Mic className='w-5 h-5 text-blue-600 ' />
                              </div>

                              {/* Content */}
                              <div className='flex-1 min-w-0'>
                                <h3 className='font-semibold text-foreground mb-1 truncate group-hover:text-blue-600  transition-colors'>
                                  {recording.title ?? 'Untitled Recording'}
                                </h3>

                                <div className='flex items-center gap-4 text-xs text-muted-foreground  mb-2'>
                                  <div className='flex items-center gap-1'>
                                    <Clock className='w-3 h-3' />
                                    <span>
                                      {formatDistanceToNow(new Date(recording.startedAt), {
                                        addSuffix: true,
                                      })}
                                    </span>
                                  </div>
                                  {recording.endedAt && (
                                    <div className='flex items-center gap-1'>
                                      <span>
                                        {formatDuration(recording.endedAt - recording.startedAt)}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {/* Metadata badges */}
                                <div className='flex items-center gap-2 flex-wrap'>
                                  {!!recording.transcript && (
                                    <span className='inline-flex items-center gap-1 px-2 py-1 bg-green-50  text-green-700  rounded-md text-xs'>
                                      <FileText className='w-3 h-3' />
                                      Transcript
                                    </span>
                                  )}
                                  {!!recording.aiSummary && (
                                    <span className='inline-flex items-center gap-1 px-2 py-1 bg-purple-50  text-purple-700  rounded-md text-xs'>
                                      AI Summary
                                    </span>
                                  )}
                                  {!recording.endedAt && (
                                    <span className='inline-flex items-center gap-1 px-2 py-1 bg-blue-50  text-blue-700  rounded-md text-xs'>
                                      <div className='w-2 h-2 bg-blue-500 rounded-full animate-pulse' />
                                      Recording
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </button>

                          {/* Inline audio player — only present when a GCS file exists */}
                          {!!recording.recordingUrl && (
                            <AudioPlayer
                              onLoad={signal =>
                                recordingService.downloadRecordingBlob(recording.externalId, signal)
                              }
                              initialDurationSec={
                                recording.endedAt
                                  ? (recording.endedAt - recording.startedAt) / 1000
                                  : undefined
                              }
                              stopPropagation
                              trackCategory='RecordingsScreen'
                              showToastOnError
                              className='flex-shrink-0 pr-4'
                            />
                          )}
                          {/* Selection checkbox — toggles bulk-action selection */}
                          <label className='flex-shrink-0 flex items-center pr-4 cursor-pointer'>
                            <input
                              type='checkbox'
                              checked={selectedIds.has(recording.externalId)}
                              onChange={() => toggleSelect(recording.externalId)}
                              className='w-4 h-4 cursor-pointer accent-black'
                              aria-label={`Select ${recording.title ?? 'recording'}`}
                              data-track-category='RecordingsScreen'
                              data-track-name='toggle_select_recording'
                            />
                          </label>
                        </div>
                      </div>
                    )}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* ─── Active Recording Workspace (overlay when active & not minimized) ───── */}
        {isActive && !isTranscriptMinimized && (
          <div className='absolute inset-0 z-10 bg-background flex flex-col'>
            {/* Shared header for all layouts */}
            <RecordingWorkspaceHeader
              startTime={startTime}
              isPaused={recordingStatus === 'paused'}
              pauseStartedAt={pauseStartedAt}
              accumulatedPausedMs={accumulatedPausedMs}
              hasCanvas={hasCanvas}
              activeLayout={activeLayout}
              isCreatingCanvas={isCreatingCanvas}
              onCreateCanvas={() => void handleCreateCanvas(true)}
              onLayoutChange={layout => sendRecordingEvent({ type: 'setActiveLayout', layout })}
              onMinimize={() =>
                sendRecordingEvent({ type: 'setTranscriptMinimized', isMinimized: true })
              }
            />

            {/* Layout: transcript | split | notes */}
            <div className='flex-1 min-h-0 flex flex-col'>
              {activeLayout === 'split' && notesCanvasId ? (
                /* Split view — transcript + notes side-by-side */
                <ResizableGroup orientation='horizontal' autoSaveId='recording-split-v3'>
                  <Panel id='recording-transcript' defaultSize='40%' minSize='32%'>
                    <ActiveRecordingView
                      transcripts={transcripts}
                      startTime={startTime}
                      isPaused={recordingStatus === 'paused'}
                    />
                  </Panel>
                  <Separator className='group relative w-2 flex-shrink-0 bg-border/40 transition-colors hover:bg-border'>
                    <div className='absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/50' />
                    <div className='absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/30 opacity-80 transition-colors group-hover:bg-primary/50' />
                  </Separator>
                  <Panel id='recording-notes' defaultSize='60%' minSize='40%'>
                    <RecordingCanvasPane channelId={channelId} notesCanvasId={notesCanvasId} />
                  </Panel>
                </ResizableGroup>
              ) : activeLayout === 'split' && !hasCanvas ? (
                /* Split view loading — show transcript + skeleton/fallback for notes */
                <ResizableGroup orientation='horizontal' autoSaveId='recording-split-v3'>
                  <Panel id='recording-transcript' defaultSize='40%' minSize='25%'>
                    <ActiveRecordingView
                      transcripts={transcripts}
                      startTime={startTime}
                      isPaused={recordingStatus === 'paused'}
                    />
                  </Panel>
                  <Separator className='group relative w-2 flex-shrink-0 bg-border/40 transition-colors hover:bg-border'>
                    <div className='absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/50' />
                    <div className='absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/30 opacity-80 transition-colors group-hover:bg-primary/50' />
                  </Separator>
                  <Panel id='recording-notes' defaultSize='60%' minSize='25%'>
                    {canvasCreationFailed ? (
                      <CanvasCreationFallback
                        onRetry={() => void handleCreateCanvas()}
                        onSwitchToTranscript={() =>
                          sendRecordingEvent({ type: 'setActiveLayout', layout: 'transcript' })
                        }
                      />
                    ) : (
                      <CanvasPaneSkeleton />
                    )}
                  </Panel>
                </ResizableGroup>
              ) : activeLayout === 'notes' && notesCanvasId ? (
                /* Notes-only view — canvas with transcript preview at bottom */
                <div className='relative flex-1 flex flex-col min-h-0'>
                  <div className='flex-1 min-h-0'>
                    <RecordingCanvasPane channelId={channelId} notesCanvasId={notesCanvasId} />
                  </div>
                  {/* Transcript preview at bottom of notes view */}
                  <MinimizedTranscriptView
                    status={recordingStatus}
                    startTime={startTime}
                    pauseStartedAt={pauseStartedAt}
                    accumulatedPausedMs={accumulatedPausedMs}
                    transcripts={transcripts}
                    onMaximize={() =>
                      sendRecordingEvent({ type: 'setActiveLayout', layout: 'transcript' })
                    }
                    showScrim={false}
                  />
                </div>
              ) : activeLayout === 'notes' && !hasCanvas ? (
                /* Notes view loading — show skeleton/fallback with transcript preview */
                <div className='relative flex-1 flex flex-col min-h-0'>
                  <div className='flex-1 min-h-0'>
                    {canvasCreationFailed ? (
                      <CanvasCreationFallback
                        onRetry={() => void handleCreateCanvas()}
                        onSwitchToTranscript={() =>
                          sendRecordingEvent({ type: 'setActiveLayout', layout: 'transcript' })
                        }
                      />
                    ) : (
                      <CanvasPaneSkeleton />
                    )}
                  </div>
                  {/* Transcript preview at bottom */}
                  <MinimizedTranscriptView
                    status={recordingStatus}
                    startTime={startTime}
                    pauseStartedAt={pauseStartedAt}
                    accumulatedPausedMs={accumulatedPausedMs}
                    transcripts={transcripts}
                    onMaximize={() =>
                      sendRecordingEvent({ type: 'setActiveLayout', layout: 'transcript' })
                    }
                    showScrim={false}
                  />
                </div>
              ) : (
                /* Transcript-only view — full-width transcript */
                <ActiveRecordingView
                  transcripts={transcripts}
                  startTime={startTime}
                  isPaused={recordingStatus === 'paused'}
                />
              )}
            </div>

            {/* Reconnecting overlay — mirrors CallStateTransition style */}
            {roomConnectionState === ConnectionState.Reconnecting && (
              <RecordingReconnectingOverlay />
            )}
          </div>
        )}

        {/* ─── Minimized Transcript Bar (overlays the list bottom) ───── */}
        {isActive && isTranscriptMinimized && (
          <div className='absolute bottom-0 left-0 right-0 z-10'>
            <MinimizedTranscriptView
              status={recordingStatus}
              startTime={startTime}
              pauseStartedAt={pauseStartedAt}
              accumulatedPausedMs={accumulatedPausedMs}
              transcripts={transcripts}
              onMaximize={() =>
                sendRecordingEvent({ type: 'setTranscriptMinimized', isMinimized: false })
              }
            />
          </div>
        )}
      </div>

      {/* ─── Sticky Bottom Control Bar (always visible) ───── */}
      <RecordingControlBar
        isRecording={recordingStatus === 'recording' || recordingStatus === 'paused'}
        isPaused={recordingStatus === 'paused'}
        isStarting={recordingStatus === 'starting'}
        startTime={startTime}
        pauseStartedAt={pauseStartedAt}
        accumulatedPausedMs={accumulatedPausedMs}
        onStart={handleStartRecording}
        onStop={handleStopRecording}
        onPause={handlePauseRecording}
        onResume={handleResumeRecording}
      />

      {/* ─── Save Title Modal (after stopping) ───── */}
      <SaveTitleModal
        isOpen={showTitleModal}
        defaultTitle={generateAutoTitle()}
        onSave={handleSaveTitle}
        isSaving={savingTitle}
        endedByAgentDrop={endedByAgentDrop}
      />

      {/* ─── Bulk Delete Confirmation Dialog ───── */}
      <ActionModal
        isOpen={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        showIcon={false}
        title={`Delete ${selectedCount} recording${selectedCount > 1 ? 's' : ''}`}
        subtitle={`Are you sure you want to delete ${
          selectedCount > 1 ? 'these recordings' : 'this recording'
        }? This action cannot be undone.`}
        buttons={[
          {
            label: 'Cancel',
            variant: 'outline',
            onClick: () => setShowBulkDelete(false),
            testId: 'cancel-delete-selected',
          },
          {
            label: isBulkDeleting ? 'Deleting…' : 'Delete',
            variant: 'destructive',
            onClick: () => void handleDeleteSelected(),
            testId: 'confirm-delete-selected',
          },
        ]}
      />

      {/* ─── Connection Warning Modal ───── */}
      {showConnectionWarning && isActive && (
        <RecordingConnectionWarningModal
          networkQuality={networkQuality}
          onDismiss={dismissConnectionWarning}
        />
      )}
    </div>
  );
}
