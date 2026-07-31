/**
 * Recording Detail V2 Screen — redesigned recording detail view.
 * Supports both live (ongoing) and past recording flows.
 */

import { type ReactElement, useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { recordingService, type RecordingDetail } from '../../services/Recording/recordingService';
import { useShortcut } from '../../shortcuts';
import {
  AlertCircle,
  ChevronRight,
  FileText,
  PanelRightOpen,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import { toast } from 'sonner';
import { logRecordingError } from '../../utils/recordingUtils';
import { useSpeakerIdentificationEnabled } from '../../components/SpeakerIdentification/useSpeakerIdentificationEnabled';
import { Spinner } from '@xyne/icons';
import { Button } from '../../components/ui/Button/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import { RecordingDetailV2Header } from './components/RecordingDetailV2Header';
import { LiveRecordingControlBar } from './components/LiveRecordingControlBar';
import { SummaryWithCitations } from './components/SummaryWithCitations';
import { DetailedSummaryPanel } from './components/DetailedSummaryPanel';
import { CollaborativeCanvasEditor } from '../../components/Canvas/CollaborativeCanvasEditor/CollaborativeCanvasEditor';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { sendRecordingEvent, useRecordingStore } from '../../hooks/useRecordingStore';
import { queries } from '../../zero/queries';
import { TranscriptSidePanel } from '../../components/Chat/TranscriptCitationModal/TranscriptSidePanel';
import type { Canvas } from '../../components/Canvas/Canvas.types';
import { xyneAIActor } from '../../machines/xyneAIMachine';

interface RecordingNavState {
  recordingIds?: string[];
}

function isRecordingLive(recording: RecordingDetail): boolean {
  return recording.status === 'ACTIVE' || recording.status === 'IN_PROGRESS';
}

export default function RecordingDetailV2Screen(): ReactElement {
  const { recordingId } = useParams<{ recordingId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const speakerIdentificationEnabled = useSpeakerIdentificationEnabled();

  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'notes' | 'summary'>('summary');
  const [showDetailedSummary, setShowDetailedSummary] = useState(false);
  const [showTranscriptPanel, setShowTranscriptPanel] = useState(false);
  const [citationNonce, setCitationNonce] = useState(0);
  const [citationRef, setCitationRef] = useState<{
    segment: number;
    timestamp: string;
    speaker: string;
  } | null>(null);

  const isLive = recording ? isRecordingLive(recording) : false;

  // j/k keyboard navigation between recordings
  const navState = location.state as RecordingNavState | null;
  const recordingIds = navState?.recordingIds;
  const currentIndex = useMemo(
    () => (recordingId ? (recordingIds?.indexOf(recordingId) ?? -1) : -1),
    [recordingId, recordingIds],
  );
  const canNavigateNext = currentIndex >= 0 && currentIndex < (recordingIds?.length ?? 0) - 1;
  const canNavigatePrevious = currentIndex > 0;

  const navigateRecording = useCallback(
    (delta: number) => {
      if (!recordingIds) return;
      const nextIdx = currentIndex + delta;
      const nextId = recordingIds[nextIdx];
      if (nextId) {
        void navigate(`/recordings/${nextId}`, { state: { recordingIds } });
      }
    },
    [recordingIds, currentIndex, navigate],
  );

  useShortcut('j', () => navigateRecording(1), {
    scope: 'global',
    description: 'Next recording',
    category: 'Recordings',
    enabled: canNavigateNext,
  });
  useShortcut('k', () => navigateRecording(-1), {
    scope: 'global',
    description: 'Previous recording',
    category: 'Recordings',
    enabled: canNavigatePrevious,
  });

  useEffect(() => {
    if (recordingId) void loadRecording(recordingId);
  }, [recordingId]);

  const loadRecording = async (id: string): Promise<void> => {
    try {
      if (!recording) setLoading(true);
      setError(null);
      const data = await recordingService.getRecordingDetail(id);
      setRecording(data);
    } catch (err) {
      logRecordingError('RecordingDetailV2Screen.loadRecording', err);
      setError('Failed to load recording. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const activeRecordingId = useRecordingStore(context => context.externalId);

  const handleTitleUpdated = (title: string): void => {
    if (!recording) return;
    setRecording({ ...recording, title });
    // Keep the live overlay's header in step when renaming the in-progress recording.
    if (recording.externalId === activeRecordingId) {
      sendRecordingEvent({ type: 'setTitle', title });
    }
  };

  const [message] = useCachedQuery(
    queries.getMessageForActivityV2({ messageId: recording?.messageId ?? '' }),
    { enabled: !!recording?.messageId },
  );

  const handleAskAI = useCallback((): void => {
    if (!recording?.channelId) {
      toast.error('Cannot open Ask AI for this recording');
      return;
    }
    const attachmentIds = (message?.attachments ?? []).map((att: { id: string }) => att.id);
    xyneAIActor.send({
      type: 'OPEN',
      startFreshChat: true,
      channelId: recording.channelId,
      threadInfo: {
        conversationId: recording.conversationId ?? '',
        previewText: recording.title || 'Recording Transcript',
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      },
    });
  }, [recording, message]);

  if (loading) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <Spinner size={28} className='animate-spin text-muted-foreground' />
      </div>
    );
  }

  if (error || !recording) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <div className='flex max-w-md flex-col items-center gap-3 text-center'>
          <AlertCircle className='size-12 text-destructive' />
          <p className='text-sm text-muted-foreground'>{error ?? 'Recording not found'}</p>
          <Button variant='outline' onClick={() => void navigate('/recordings')}>
            Back to Recordings
          </Button>
        </div>
      </div>
    );
  }

  const hasNotes = !!recording.notesCanvasId;
  const hasSummary = recording.hasSummary && !!recording.aiSummary;
  const hasDetailedSummary = !!recording.detailedSummaryCanvasId;
  const showTabs = hasNotes || hasSummary;
  const visibleTab = hasSummary && (activeTab === 'summary' || !hasNotes) ? 'summary' : 'notes';

  const transcriptText =
    speakerIdentificationEnabled && recording.hasIdentifiedTranscript
      ? (recording.identifiedTranscript ?? recording.transcript)
      : recording.transcript;

  const handleCitationClick = (ref: {
    segment: number;
    timestamp: string;
    speaker: string;
  }): void => {
    setCitationRef(ref);
    setCitationNonce(value => value + 1);
    setShowTranscriptPanel(true);
    setShowDetailedSummary(false); // only one panel at a time
  };

  const openTranscriptPanel = (): void => {
    setCitationRef(null);
    setCitationNonce(value => value + 1);
    setShowTranscriptPanel(true);
    setShowDetailedSummary(false);
  };

  const openDetailedSummary = (): void => {
    setShowDetailedSummary(true);
    setShowTranscriptPanel(false);
    setCitationRef(null);
  };

  return (
    <div
      data-testid='recording-detail-v2-page'
      className='relative flex h-full w-full flex-col overflow-hidden bg-background shadow-md md:rounded-2xl'
    >
      <div
        className={[
          'h-full w-full overflow-y-scroll transition-[padding] duration-300',
          showTranscriptPanel ? 'md:pr-[560px]' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className='mx-auto flex min-h-full w-full max-w-[860px] flex-col px-4 py-6'>
          <RecordingDetailV2Header
            recording={recording}
            isLive={isLive}
            onTitleUpdated={handleTitleUpdated}
            onAskAI={handleAskAI}
          />

          {isLive && (
            <LiveRecordingControlBar
              recording={recording}
              onStopped={() => void loadRecording(recording.externalId)}
            />
          )}

          {showTabs ? (
            <>
              <div className='mb-7 flex items-center justify-between border-b border-border/70 pb-3'>
                <div
                  role='tablist'
                  aria-label='Recording content'
                  className='inline-flex items-center gap-1 rounded-full bg-muted/65 p-1'
                >
                  <button
                    type='button'
                    role='tab'
                    aria-selected={visibleTab === 'notes'}
                    onClick={() => setActiveTab('notes')}
                    data-track-category='RecordingDetailV2'
                    data-track-name='open_notes'
                    className={[
                      'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      visibleTab === 'notes'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                  >
                    <StickyNote className='size-3.5' aria-hidden='true' />
                    My notes
                  </button>
                  <button
                    type='button'
                    role='tab'
                    aria-selected={visibleTab === 'summary'}
                    onClick={() => setActiveTab('summary')}
                    data-track-category='RecordingDetailV2'
                    data-track-name='open_default_summary'
                    className={[
                      'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      visibleTab === 'summary'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                  >
                    <Sparkles className='size-3.5 text-orange-500' aria-hidden='true' />
                    Default summary
                  </button>
                </div>
              </div>

              {visibleTab === 'notes' ? (
                <section className='mb-8 min-h-[360px]'>
                  <div className='mb-4 flex items-center justify-between'>
                    <h2 className='text-lg font-semibold text-foreground'>My notes</h2>
                  </div>
                  {hasNotes ? (
                    <NotesCanvas canvasId={recording.notesCanvasId!} />
                  ) : (
                    <div className='flex min-h-[280px] flex-col items-center justify-center gap-2 text-center'>
                      <StickyNote className='size-5 text-muted-foreground/60' aria-hidden='true' />
                      <p className='text-sm text-muted-foreground'>
                        No notes yet for this recording.
                      </p>
                    </div>
                  )}
                </section>
              ) : (
                <section className='mb-8 max-w-[780px]'>
                  <div className='mb-4 flex items-center justify-between'>
                    <h2 className='text-lg font-semibold text-foreground'>Summary</h2>
                    {transcriptText ? (
                      <Tooltip content='Open transcript' side='left'>
                        <button
                          type='button'
                          onClick={openTranscriptPanel}
                          className='inline-flex size-8 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                          aria-label='Open transcript'
                          data-track-category='RecordingDetailV2'
                          data-track-name='open_transcript_panel'
                        >
                          <PanelRightOpen className='size-4' aria-hidden='true' />
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                  {hasSummary ? (
                    <>
                      <SummaryWithCitations
                        aiSummary={recording.aiSummary!}
                        citationSegments={recording.citationSegments}
                        onCitationClick={handleCitationClick}
                      />
                      {hasDetailedSummary ? (
                        <div className='mt-6 border-t border-border/60 pt-3'>
                          <button
                            type='button'
                            onClick={openDetailedSummary}
                            className='inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                            data-track-category='RecordingDetailV2'
                            data-track-name='open_detailed_summary'
                          >
                            <FileText className='size-3.5' aria-hidden='true' />
                            Detailed summary
                            <ChevronRight className='size-3.5' aria-hidden='true' />
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className='text-sm text-muted-foreground'>
                      Summary is still being prepared.
                    </p>
                  )}
                </section>
              )}
            </>
          ) : null}

          {!showTabs && !recording.hasTranscript && (
            <div className='rounded-xl border border-border p-12 text-center'>
              <p className='text-sm text-muted-foreground'>
                Transcript and summary are being processed...
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Detailed Summary side panel */}
      {showDetailedSummary && hasDetailedSummary && (
        <>
          <button
            type='button'
            aria-label='Close detailed summary'
            className='absolute inset-0 z-20 hidden cursor-default bg-black/20 backdrop-blur-[1px] md:block'
            onClick={() => setShowDetailedSummary(false)}
            data-track-category='RecordingDetailV2'
            data-track-name='close_detailed_summary_backdrop'
          />
          <DetailedSummaryPanel
            canvasId={recording.detailedSummaryCanvasId!}
            onClose={() => setShowDetailedSummary(false)}
          />
        </>
      )}

      {/* Transcript side panel */}
      {showTranscriptPanel && transcriptText && (
        <TranscriptSidePanel
          transcript={transcriptText}
          target={citationRef}
          openNonce={citationNonce}
          onClose={() => {
            setShowTranscriptPanel(false);
            setCitationRef(null);
          }}
          className='absolute inset-y-0 right-0 z-30 w-full md:w-[560px]'
        />
      )}
    </div>
  );
}

function NotesCanvas({ canvasId }: { canvasId: string }): ReactElement {
  const [canvasData] = useCachedQuery(queries.getCanvas({ canvasId }), { enabled: !!canvasId });
  const canvas = canvasData as unknown as Canvas | undefined;

  if (!canvas) {
    return (
      <div className='flex min-h-[260px] items-center justify-center'>
        <Spinner size={20} className='animate-spin text-muted-foreground' />
      </div>
    );
  }

  return (
    <CollaborativeCanvasEditor
      key={canvas.id}
      canvasId={canvas.id}
      channelId={canvas.channelId || undefined}
      title={canvas.title}
      editable={true}
      placeholder='Start typing your notes…'
      className='recording-notes-canvas-editor min-h-[420px]'
      autoFocus={false}
    />
  );
}
