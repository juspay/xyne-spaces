/**
 * Recordings Screen - View and manage headless audio recordings
 * Two-panel design inspired by native RecordingsListScreen:
 *   1. List view — all recordings + sticky bottom record button
 *   2. Active recording view — live transcript stream (CSS transition between them)
 * Recording persists across navigation via the global RecordingOverlay.
 */

import { ReactElement, useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { recordingService, Recording } from '../../services/Recording/recordingService';
import { Mic, Clock, FileText, Loader2, AlertCircle, ChevronDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  useRecordingStore,
  sendRecordingEvent,
  useTranscriptStream,
} from '../../hooks/useRecordingStore';
import { RecordingControlBar } from './components/RecordingControlBar';
import { ActiveRecordingView } from './components/ActiveRecordingView';
import { SaveTitleModal } from './components/SaveTitleModal';
import { toast } from 'sonner';
import {
  formatRecordingDuration,
  generateRecordingTitle,
  logRecordingError,
  STT_MODEL_LABELS,
} from '../../utils/recordingUtils';

export default function RecordingsScreen(): ReactElement {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const [showSttPicker, setShowSttPicker] = useState(false);
  const [sttModel, setSttModel] = useState<'google' | 'azure' | 'deepgram'>('azure');
  const navigate = useNavigate();

  // Recording store state (context holds the recording-specific fields)
  const recordingStatus = useRecordingStore(ctx => ctx.status);
  const startTime = useRecordingStore(ctx => ctx.startTime);
  const externalId = useRecordingStore(ctx => ctx.externalId);
  const pendingAutoStart = useRecordingStore(ctx => ctx.pendingAutoStart);

  const isActive =
    recordingStatus === 'recording' ||
    recordingStatus === 'paused' ||
    recordingStatus === 'starting';

  // Live transcript streaming from global store (subscription is managed by the store)
  const { transcripts } = useTranscriptStream();

  const loadRecordings = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const data = await recordingService.getRecordings();
      setRecordings(data);
    } catch (err) {
      logRecordingError('RecordingsScreen.loadRecordings', err);
      setError('Failed to load recordings. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecordings();
  }, [loadRecordings]);

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

  const handleSaveTitle = async (title: string): Promise<void> => {
    setSavingTitle(true);
    try {
      if (lastExternalIdRef.current) {
        await recordingService.updateRecordingTitle(lastExternalIdRef.current, title);
      }
      setShowTitleModal(false);
      sendRecordingEvent({ type: 'clearTranscripts' });
      toast.success('Recording saved', { description: title });
      // Refresh recordings list
      void loadRecordings();
    } catch {
      toast.error('Failed to save title');
    } finally {
      setSavingTitle(false);
    }
  };

  const handleRecordingClick = (recording: Recording): void => {
    void navigate(`/recordings/${recording.externalId}`);
  };

  // ─── Loading State ───────────────────────────────────────────────
  if (loading && !isActive) {
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
            onClick={() => void loadRecordings()}
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
    <div className='flex flex-col h-full relative bg-background md:rounded-2xl overflow-hidden shadow-md'>
      {/* ─── List View (slides out when recording is active) ───── */}
      <div
        className='flex-1 overflow-auto transition-transform duration-500 ease-in-out'
        style={{
          transform: isActive ? 'translateY(-100%)' : 'translateY(0)',
          position: isActive ? 'absolute' : 'relative',
          inset: isActive ? '0' : undefined,
        }}
      >
        <div className='max-w-4xl mx-auto p-6'>
          {/* Header */}
          <div className='mb-8'>
            <div className='flex items-center justify-between mb-2'>
              <h1 className='text-2xl font-bold text-foreground dark:text-gray-100'>Recordings</h1>

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
            <div className='space-y-3'>
              {recordings.map(recording => (
                <button
                  key={recording.id}
                  onClick={() => handleRecordingClick(recording)}
                  className='w-full text-left bg-background dark:bg-gray-800 rounded-lg border border-border dark:border-gray-700 p-4 hover:shadow-md transition-shadow cursor-pointer group'
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
                        {recording.title}
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
                        {recording.durationMs && (
                          <div className='flex items-center gap-1'>
                            <span>{formatDuration(recording.durationMs)}</span>
                          </div>
                        )}
                      </div>

                      {/* Metadata badges */}
                      <div className='flex items-center gap-2 flex-wrap'>
                        {recording.hasTranscript && (
                          <span className='inline-flex items-center gap-1 px-2 py-1 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-md text-xs'>
                            <FileText className='w-3 h-3' />
                            Transcript
                          </span>
                        )}
                        {recording.hasSummary && (
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
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Active Recording View (slides in when recording) ───── */}
      <div
        className='flex-1 overflow-hidden transition-transform duration-500 ease-in-out'
        style={{
          transform: isActive ? 'translateY(0)' : 'translateY(100%)',
          position: isActive ? 'relative' : 'absolute',
          inset: isActive ? undefined : '0',
        }}
      >
        <ActiveRecordingView
          transcripts={transcripts}
          startTime={startTime}
          isPaused={recordingStatus === 'paused'}
        />
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
    </div>
  );
}
