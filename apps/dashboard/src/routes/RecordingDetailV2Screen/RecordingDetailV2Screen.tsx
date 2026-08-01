/**
 * Recording Detail V2 Screen — redesigned recording detail view.
 * Supports both live (ongoing) and past recording flows.
 */

import { type ReactElement, useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import {
  recordingService,
  type BuiltinRecordingSummaryTemplateId,
  type RecordingDetail,
} from '../../services/Recording/recordingService';
import { useShortcut } from '../../shortcuts';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Hash,
  Mail,
  Music,
  PanelRightOpen,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import { toast } from 'sonner';
import { logRecordingError } from '../../utils/recordingUtils';
import { useSpeakerIdentificationEnabled } from '../../components/SpeakerIdentification/useSpeakerIdentificationEnabled';
import { Spinner } from '@xyne/icons';
import { Button } from '../../components/ui/Button/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Tooltip } from '../../components/ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { AudioPlayer } from '../../components/ui/AudioPlayer/AudioPlayer';
import { RecordingDetailV2Header } from './components/RecordingDetailV2Header';
import { LiveRecordingControlBar } from './components/LiveRecordingControlBar';
import { SummaryWithCitations } from './components/SummaryWithCitations';
import { PostRecordingToChannelModal } from './components/PostRecordingToChannelModal';
import { PostRecordingToEmailModal } from './components/PostRecordingToEmailModal';
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

const RECORDING_SUMMARY_TEMPLATES: ReadonlyArray<{
  id: BuiltinRecordingSummaryTemplateId;
  name: string;
  icon: string;
}> = [
  { id: 'default', name: 'Default summary', icon: '⚡' },
  { id: 'product_sync', name: 'Product sync', icon: '🔁' },
  { id: 'customer_discovery', name: 'Customer: Discovery', icon: '💰' },
  { id: 'one_on_one', name: '1 to 1', icon: '👥' },
  { id: 'hiring', name: 'Hiring', icon: '💼' },
  { id: 'standup', name: 'Stand-Up', icon: '🧍' },
  { id: 'sprint_review', name: 'Sprint review', icon: '📈' },
  { id: 'customer_feedback', name: 'Customer feedback', icon: '🔄' },
];

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
  const [showTranscriptPanel, setShowTranscriptPanel] = useState(false);
  const [showPostToChannelModal, setShowPostToChannelModal] = useState(false);
  const [showPostToEmailModal, setShowPostToEmailModal] = useState(false);
  const [isRegeneratingSummary, setIsRegeneratingSummary] = useState(false);
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

  // Reactive metadata: everything here is a plain Call column (title, status,
  // labels, markedItems, summaryTemplateId, aiSummary text) so it's kept live
  // via Zero instead of only refreshing on the next full REST reload — e.g.
  // if labels/markedItems finish generating, or someone renames the
  // recording, while this screen is open. The transcript file content and
  // hasRecording flag still require the REST call below (not stored inline /
  // not Zero-synced).
  const [recordingRow] = useCachedQuery(
    queries.oatsRecordingByExternalId({ callId: recordingId ?? '' }),
    { enabled: !!recordingId },
  );

  useEffect(() => {
    if (!recordingRow) return;
    setRecording(prev => {
      if (!prev) return prev;
      const endedAt = recordingRow.endedAt ? new Date(recordingRow.endedAt).toISOString() : null;
      const next: RecordingDetail = {
        ...prev,
        title: recordingRow.title || prev.title,
        labels: recordingRow.labels ?? prev.labels,
        markedItems: recordingRow.markedItems ?? prev.markedItems,
        summaryTemplateId: recordingRow.summaryTemplateId ?? prev.summaryTemplateId ?? null,
        aiSummary: recordingRow.aiSummary ?? prev.aiSummary,
        hasSummary: !!recordingRow.aiSummary,
        endedAt,
        durationMs: endedAt
          ? new Date(endedAt).getTime() - new Date(recordingRow.startedAt).getTime()
          : prev.durationMs,
      };
      if (recordingRow.status) {
        next.status = recordingRow.status as NonNullable<RecordingDetail['status']>;
      }
      return next;
    });
  }, [recordingRow]);

  const loadRecording = async (id: string): Promise<void> => {
    try {
      if (!recording) setLoading(true);
      setError(null);
      const data = await recordingService.getRecordingDetail(id);
      setRecording(data);
    } catch (err) {
      logRecordingError('RecordingDetailV2Screen.loadRecording', err);
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        setError('You no longer have access to this recording.');
      } else if (axios.isAxiosError(err) && err.response?.status === 404) {
        setError('Recording not found.');
      } else {
        setError('Failed to load recording. Please try again.');
      }
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

  const handleSummaryTemplateSelect = async (
    summaryTemplateId: BuiltinRecordingSummaryTemplateId,
  ): Promise<void> => {
    if (!recording || isRegeneratingSummary) return;

    setIsRegeneratingSummary(true);
    try {
      const result = await recordingService.regenerateSummary(
        recording.externalId,
        summaryTemplateId,
      );
      setRecording(current =>
        current
          ? {
              ...current,
              aiSummary: result.summary,
              hasSummary: true,
              summaryTemplateId: result.summaryTemplateId,
              detailedSummaryCanvasId:
                result.detailedSummaryCanvasId ?? current.detailedSummaryCanvasId,
            }
          : current,
      );
      setActiveTab('summary');
      const selected = RECORDING_SUMMARY_TEMPLATES.find(
        template => template.id === result.summaryTemplateId,
      );
      toast.success(`${selected?.name ?? 'Recording'} summary generated`);
    } catch (err) {
      logRecordingError('RecordingDetailV2Screen.regenerateSummary', err);
      const message = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string } | undefined)?.error
        : undefined;
      toast.error('Failed to generate summary', {
        description: message ?? 'Please try again.',
      });
    } finally {
      setIsRegeneratingSummary(false);
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
  const selectedSummaryTemplate =
    RECORDING_SUMMARY_TEMPLATES.find(
      template => template.id === recording.summaryTemplateId,
    ) ?? RECORDING_SUMMARY_TEMPLATES[0]!;
  const showTabs = hasNotes || hasSummary || recording.hasTranscript;
  const visibleTab = activeTab === 'summary' || !hasNotes ? 'summary' : 'notes';

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
  };

  const openTranscriptPanel = (): void => {
    setCitationRef(null);
    setCitationNonce(value => value + 1);
    setShowTranscriptPanel(true);
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

          {recording.hasRecording && (
            <div className='mb-6 flex items-center gap-4 rounded-xl border border-border bg-muted/30 p-4'>
              <div className='flex w-24 shrink-0 items-center gap-2 text-muted-foreground'>
                <Music className='size-4' />
                <span className='text-sm'>Audio</span>
              </div>
              <div className='max-w-md flex-1'>
                <AudioPlayer
                  onLoad={signal => recordingService.downloadRecordingBlob(recording.externalId, signal)}
                  initialDurationSec={recording.durationMs ? recording.durationMs / 1000 : undefined}
                  trackCategory='RecordingDetailV2'
                  showToastOnError
                />
              </div>
            </div>
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type='button'
                        role='tab'
                        aria-selected={visibleTab === 'summary'}
                        onClick={() => setActiveTab('summary')}
                        disabled={isRegeneratingSummary}
                        data-track-category='RecordingDetailV2'
                        data-track-name='open_summary_templates'
                        className={[
                          'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70',
                          visibleTab === 'summary'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        ].join(' ')}
                      >
                        {isRegeneratingSummary ? (
                          <Spinner size={14} className='animate-spin text-orange-500' />
                        ) : (
                          <Sparkles className='size-3.5 text-orange-500' aria-hidden='true' />
                        )}
                        {selectedSummaryTemplate.name}
                        <ChevronDown className='size-3.5' aria-hidden='true' />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='start' className='w-64'>
                      {RECORDING_SUMMARY_TEMPLATES.map(template => (
                        <DropdownMenuItem
                          key={template.id}
                          onSelect={() => void handleSummaryTemplateSelect(template.id)}
                          disabled={isRegeneratingSummary}
                          data-track-category='RecordingDetailV2'
                          data-track-name={`generate_summary_${template.id}`}
                        >
                          <span aria-hidden='true'>{template.icon}</span>
                          <span className='flex-1'>{template.name}</span>
                          {template.id === selectedSummaryTemplate.id ? (
                            <Check className='size-3.5 text-primary' aria-hidden='true' />
                          ) : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <DropdownMenu>
                  <div className='inline-flex h-8 items-stretch overflow-hidden rounded-full bg-foreground text-background'>
                    <button
                      type='button'
                      onClick={() => setShowPostToChannelModal(true)}
                      className='inline-flex items-center gap-1.5 px-3 text-sm font-medium transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      data-track-category='RecordingDetailV2'
                      data-track-name='open_post_to_channel_modal'
                    >
                      <Hash className='size-3.5' aria-hidden='true' />
                      Post to channel
                    </button>
                    <span className='w-px bg-background/25' aria-hidden='true' />
                    <DropdownMenuTrigger asChild>
                      <button
                        type='button'
                        className='inline-flex items-center px-2 transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        aria-label='Share recording options'
                        data-track-category='RecordingDetailV2'
                        data-track-name='open_recording_share_menu'
                      >
                        <ChevronDown className='size-3.5' aria-hidden='true' />
                      </button>
                    </DropdownMenuTrigger>
                  </div>
                  <DropdownMenuContent align='end' className='min-w-[184px]'>
                    <DropdownMenuItem
                      onSelect={() => setShowPostToChannelModal(true)}
                      className='flex cursor-pointer items-center gap-2'
                      data-track-category='RecordingDetailV2'
                      data-track-name='open_post_to_channel_from_menu'
                    >
                      <Hash className='size-4 text-muted-foreground' aria-hidden='true' />
                      Post to channel
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setShowPostToEmailModal(true)}
                      className='flex cursor-pointer items-center gap-2'
                      data-track-category='RecordingDetailV2'
                      data-track-name='open_post_to_email_modal'
                    >
                      <Mail className='size-4 text-muted-foreground' aria-hidden='true' />
                      Post to email
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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

      {showPostToChannelModal && (
        <Dialog
          open={showPostToChannelModal}
          onOpenChange={open => !open && setShowPostToChannelModal(false)}
          title='Post to channel'
          data-testid='post-recording-to-channel-modal'
        >
          <PostRecordingToChannelModal
            recording={recording}
            onClose={() => setShowPostToChannelModal(false)}
          />
        </Dialog>
      )}

      {showPostToEmailModal && (
        <Dialog
          open={showPostToEmailModal}
          onOpenChange={open => !open && setShowPostToEmailModal(false)}
          title='Review draft email'
          description='Review the recording recap before sending it by email.'
          className='max-w-[1120px] overflow-hidden rounded-xl p-0'
          testId='post-recording-to-email-dialog'
        >
          <PostRecordingToEmailModal
            recording={recording}
            onClose={() => setShowPostToEmailModal(false)}
          />
        </Dialog>
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
