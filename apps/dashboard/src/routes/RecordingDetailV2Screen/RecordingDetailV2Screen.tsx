/**
 * Recording Detail V2 Screen — redesigned recording detail view.
 * Supports both live (ongoing) and past recording flows.
 */

import { type ReactElement, useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { recordingService, type RecordingDetail } from '../../services/Recording/recordingService';
import { useShortcut } from '../../shortcuts';
import { AlertCircle, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { logRecordingError } from '../../utils/recordingUtils';
import { useSpeakerIdentificationEnabled } from '../../components/SpeakerIdentification/useSpeakerIdentificationEnabled';
import { Spinner } from '@xyne/icons';
import { Button } from '../../components/ui/Button/Button';
import { RecordingDetailV2Header } from './components/RecordingDetailV2Header';
import { LiveRecordingControlBar } from './components/LiveRecordingControlBar';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { sendRecordingEvent, useRecordingStore } from '../../hooks/useRecordingStore';
import { queries } from '../../zero/queries';
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
    if (recordingId) {
      void loadRecording(recordingId);
    }
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

  const transcriptText =
    speakerIdentificationEnabled && recording.hasIdentifiedTranscript
      ? (recording.identifiedTranscript ?? recording.transcript)
      : recording.transcript;

  return (
    <div
      data-testid='recording-detail-v2-page'
      className='relative flex h-full w-full flex-col overflow-hidden bg-background shadow-md md:rounded-2xl'
    >
      <div className='h-full w-full overflow-y-scroll'>
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

          {/* AI Summary */}
          {recording.hasSummary && recording.aiSummary && (
            <section className='mb-6 rounded-xl border border-border bg-muted/30 p-6'>
              <div className='mb-4 flex items-center gap-2'>
                <div className='size-5 rounded bg-gradient-to-br from-purple-500 to-pink-500' />
                <h2 className='text-base font-semibold text-foreground'>AI Summary</h2>
              </div>
              <div className='bot-markdown-content-call-summary'>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{recording.aiSummary}</ReactMarkdown>
              </div>
            </section>
          )}

          {/* Transcript */}
          {recording.hasTranscript && transcriptText && (
            <section className='mb-6 rounded-xl border border-border bg-muted/30 p-6'>
              <div className='mb-4 flex items-center gap-2'>
                <FileText className='size-4 text-muted-foreground' />
                <h2 className='text-base font-semibold text-foreground'>
                  {speakerIdentificationEnabled && recording.hasIdentifiedTranscript
                    ? 'Identified Transcript'
                    : 'Transcript'}
                </h2>
              </div>
              <pre className='whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground'>
                {transcriptText}
              </pre>
            </section>
          )}

          {/* Processing placeholder */}
          {!recording.hasTranscript && !recording.hasSummary && (
            <div className='rounded-xl border border-border p-12 text-center'>
              <p className='text-sm text-muted-foreground'>
                Transcript and summary are being processed...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
