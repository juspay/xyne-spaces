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
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { recordingService } from '../../services/Recording/recordingService';
import { canvasService } from '../../services/Canvas/canvasService';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { Mic, Clock, FileText, Loader2, AlertCircle, ChevronDown } from 'lucide-react';
import { ConnectionState } from 'livekit-client';
import { formatDistanceToNow } from 'date-fns';
import {
  useRecordingStore,
  sendRecordingEvent,
  useTranscriptStream,
} from '../../hooks/useRecordingStore';
import { RecordingControlBar } from './components/RecordingControlBar';
import { ActiveRecordingView } from './components/ActiveRecordingView';
import { RecordingCanvasPane } from './components/RecordingCanvasPane';
import { MinimizedTranscriptView } from './components/MinimizedTranscriptView';
import { SaveTitleModal } from './components/SaveTitleModal';
import { AudioPlayer } from '../../components/ui/AudioPlayer/AudioPlayer';
import { toast } from 'sonner';
import {
  formatRecordingDuration,
  generateRecordingTitle,
  STT_MODEL_LABELS,
} from '../../utils/recordingUtils';
import { logger, Event as LoggerEvent } from '../../utils/logger';
import { usePaginatedRecordings, type RecordingEntry } from '../../hooks/usePaginatedRecordings';
import { useRecordingConnectionState } from './hooks/useRecordingConnectionState';
import {
  RecordingReconnectingOverlay,
  RecordingConnectionWarningModal,
} from './components/RecordingConnectionStatus';

export default function RecordingsScreen(): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const [showSttPicker, setShowSttPicker] = useState(false);
  const [sttModel, setSttModel] = useState<'google' | 'azure' | 'deepgram'>('google');
  const [isTranscriptMinimized, setIsTranscriptMinimized] = useState(false);

  const navigate = useNavigate();
  const zero = useZero();

  const { recordings, hasMoreRecordings, loadMoreRecordings, isLoading } = usePaginatedRecordings();

  // Recording store state (context holds the recording-specific fields)
  const recordingStatus = useRecordingStore(ctx => ctx.status);
  const startTime = useRecordingStore(ctx => ctx.startTime);
  const externalId = useRecordingStore(ctx => ctx.externalId);
  const channelId = useRecordingStore(ctx => ctx.channelId);
  const notesCanvasId = useRecordingStore(ctx => ctx.notesCanvasId);
  const notesCanvasViewAccessId = useRecordingStore(ctx => ctx.notesCanvasViewAccessId);
  const pendingAutoStart = useRecordingStore(ctx => ctx.pendingAutoStart);
  const pendingStop = useRecordingStore(ctx => ctx.pendingStop);
  const room = useRecordingStore(ctx => ctx.room);

  const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);
  const [isCanvasPaneOpen, setIsCanvasPaneOpen] = useState(true);
  const [notesCanvasTitle, setNotesCanvasTitle] = useState('Recording Notes');

  const hasCanvas = !!notesCanvasId && !!notesCanvasViewAccessId;

  const isActive =
    recordingStatus === 'recording' ||
    recordingStatus === 'paused' ||
    recordingStatus === 'starting';

  // Reset to maximized transcript view whenever a new recording becomes active
  useEffect(() => {
    if (isActive) {
      setIsTranscriptMinimized(false);
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
    sendRecordingEvent({ type: 'clearTranscripts' });
    sendRecordingEvent({ type: 'startRecording', sttModel });
  };

  // Auto-start recording when triggered from the meeting popup
  useEffect(() => {
    if (pendingAutoStart && (recordingStatus === 'idle' || recordingStatus === 'error')) {
      handleStartRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoStart]);

  const handlePauseRecording = (): void => {
    sendRecordingEvent({ type: 'pauseRecording' });
  };

  const handleResumeRecording = (): void => {
    sendRecordingEvent({ type: 'resumeRecording' });
  };

  // Create a collaborative notes canvas for the active recording and open the split view
  const handleCreateCanvas = async (): Promise<void> => {
    if (hasCanvas || isCreatingCanvas) return;
    setIsCreatingCanvas(true);
    try {
      const canvasId = uuidv4();
      const viewAccessId = uuidv4();
      await canvasService.createCollaborativeCanvas({
        id: canvasId,
        title: notesCanvasTitle,
        ...(channelId ? { channelId } : {}),
        viewAccessId,
      });
      sendRecordingEvent({ type: 'setNotesCanvas', canvasId, viewAccessId });
      setIsCanvasPaneOpen(true);
      // Persist the link on the call now; the thread post happens in the summary pipeline
      if (externalId) {
        try {
          const linkResult = await zero.mutate(
            mutators.calls.linkNotesCanvas({
              callId: externalId,
              notesCanvasViewAccessId: viewAccessId,
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
      logger.error(LoggerEvent.API_CALL_FAILED, {
        message: 'Failed to create notes canvas',
        error: err instanceof Error ? err.message : String(err),
      });
      toast.error('Failed to create notes canvas. Please try again.');
    } finally {
      setIsCreatingCanvas(false);
    }
  };

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

  // ─── REMOVED: connection state management moved to useRecordingConnectionState ───
  // See hooks/useRecordingConnectionState.ts

  const handleSaveTitle = async (title: string): Promise<void> => {
    setSavingTitle(true);
    try {
      if (lastExternalIdRef.current) {
        await recordingService.updateRecordingTitle(lastExternalIdRef.current, title);
      }
      setShowTitleModal(false);
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
          <h3 className='text-lg font-semibold text-foreground dark:text-gray-100'>Error</h3>
          <p className='text-sm text-muted-foreground dark:text-muted-foreground'>{error}</p>
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
                <h1 className='text-2xl font-bold text-foreground dark:text-gray-100'>
                  Recordings
                </h1>

                {/* STT Model Picker */}
                <div className='relative'>
                  <button
                    onClick={() => !isActive && setShowSttPicker(!showSttPicker)}
                    disabled={isActive}
                    className='flex items-center gap-2 px-3 py-1.5 text-sm bg-background dark:bg-gray-800 border border-border dark:border-gray-700 rounded-lg hover:bg-muted dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                    data-track-category='RecordingsScreen'
                    data-track-name='open_stt_picker'
                  >
                    <span className='text-muted-foreground dark:text-muted-foreground'>STT:</span>
                    <span className='font-medium text-foreground dark:text-gray-100'>
                      {sttModelLabels[sttModel]}
                    </span>
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
                      <div className='absolute right-0 top-full mt-1 w-40 bg-background dark:bg-gray-800 rounded-lg shadow-lg border border-border dark:border-gray-700 py-1 z-50'>
                        {(['google', 'azure', 'deepgram'] as const).map(model => (
                          <button
                            key={model}
                            onClick={() => {
                              setSttModel(model);
                              setShowSttPicker(false);
                            }}
                            className='w-full px-4 py-2 text-left text-sm hover:bg-muted dark:hover:bg-gray-700 flex items-center justify-between'
                            data-track-category='RecordingsScreen'
                            data-track-name={`select_stt_model_${model}`}
                          >
                            <span
                              className={
                                sttModel === model
                                  ? 'font-medium text-blue-600 dark:text-blue-400'
                                  : 'text-foreground dark:text-gray-100'
                              }
                            >
                              {sttModelLabels[model]}
                            </span>
                            {sttModel === model && (
                              <span className='text-blue-600 dark:text-blue-400'>✓</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <p className='text-sm text-muted-foreground dark:text-muted-foreground'>
                Your audio recordings with automatic transcription
              </p>
            </div>

            {/* Empty State */}
            {recordings.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-20 text-center'>
                <div className='w-16 h-16 rounded-full bg-muted dark:bg-gray-800 flex items-center justify-center mb-4'>
                  <Mic className='w-8 h-8 text-muted-foreground' />
                </div>
                <h3 className='text-lg font-semibold text-foreground dark:text-gray-100 mb-2'>
                  No recordings yet
                </h3>
                <p className='text-sm text-muted-foreground dark:text-muted-foreground max-w-sm'>
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
                        <div className='w-full bg-background dark:bg-gray-800 rounded-lg border border-border dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow group flex items-center'>
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
                              <div className='flex-shrink-0 w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors'>
                                <Mic className='w-5 h-5 text-blue-600 dark:text-blue-400' />
                              </div>

                              {/* Content */}
                              <div className='flex-1 min-w-0'>
                                <h3 className='font-semibold text-foreground dark:text-gray-100 mb-1 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors'>
                                  {recording.title ?? 'Untitled Recording'}
                                </h3>

                                <div className='flex items-center gap-4 text-xs text-muted-foreground dark:text-muted-foreground mb-2'>
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
                                    <span className='inline-flex items-center gap-1 px-2 py-1 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-md text-xs'>
                                      <FileText className='w-3 h-3' />
                                      Transcript
                                    </span>
                                  )}
                                  {!!recording.aiSummary && (
                                    <span className='inline-flex items-center gap-1 px-2 py-1 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 rounded-md text-xs'>
                                      AI Summary
                                    </span>
                                  )}
                                  {!recording.endedAt && (
                                    <span className='inline-flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-md text-xs'>
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
            {notesCanvasId && notesCanvasViewAccessId && isCanvasPaneOpen ? (
              /* Split view — only after a notes canvas is created */
              <PanelGroup direction='horizontal' autoSaveId='recording-split-view'>
                <Panel defaultSize={50} minSize={30}>
                  <ActiveRecordingView
                    transcripts={transcripts}
                    startTime={startTime}
                    isPaused={recordingStatus === 'paused'}
                    hasCanvas
                    isCanvasPaneOpen
                    onMinimize={() => setIsTranscriptMinimized(true)}
                  />
                </Panel>
                <PanelResizeHandle className='group relative w-3 flex-shrink-0 bg-muted/40 transition-colors hover:bg-muted dark:bg-gray-800/60 dark:hover:bg-gray-700'>
                  <div className='absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-blue-400 dark:bg-gray-700 dark:group-hover:bg-blue-400' />
                  <div className='absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/30 opacity-80 transition-colors group-hover:bg-blue-400 dark:bg-gray-500' />
                </PanelResizeHandle>
                <Panel defaultSize={50} minSize={25}>
                  <RecordingCanvasPane
                    channelId={channelId}
                    notesCanvasId={notesCanvasId}
                    notesCanvasViewAccessId={notesCanvasViewAccessId}
                    title={notesCanvasTitle}
                    onTitleChange={setNotesCanvasTitle}
                    onClose={() => setIsCanvasPaneOpen(false)}
                  />
                </Panel>
              </PanelGroup>
            ) : (
              /* Default — full-width transcript with a "Create Canvas" button in the header */
              <ActiveRecordingView
                transcripts={transcripts}
                startTime={startTime}
                isPaused={recordingStatus === 'paused'}
                hasCanvas={hasCanvas}
                isCanvasPaneOpen={false}
                isCreatingCanvas={isCreatingCanvas}
                onCreateCanvas={() => void handleCreateCanvas()}
                onOpenCanvas={() => setIsCanvasPaneOpen(true)}
                onMinimize={() => setIsTranscriptMinimized(true)}
              />
            )}

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
              transcripts={transcripts}
              onMaximize={() => setIsTranscriptMinimized(false)}
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
