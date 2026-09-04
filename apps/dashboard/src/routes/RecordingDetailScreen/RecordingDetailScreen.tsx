/**
 * Recording Detail Screen - View individual recording with transcript and summary
 */

import { ReactElement, useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import AppNavigator from '../../components/AppNavigator/AppNavigator';
import { usePlatform } from '../../hooks/usePlatform';
import { recordingService, RecordingDetail } from '../../services/Recording/recordingService';
import { useShortcut } from '../../shortcuts';
import {
  ArrowLeft,
  Clock,
  FileText,
  Loader2,
  AlertCircle,
  Edit2,
  Check,
  X,
  MessageSquare,
  Share2,
  Trash2,
  Download,
  ScrollText,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import Dialog from '../../components/ui/Dialog';
import { formatRecordingDuration, logRecordingError } from '../../utils/recordingUtils';
import { CanvasEditor } from '../../components/Canvas/CanvasEditor/CanvasEditor';
import { CollaborativeCanvasEditor } from '../../components/Canvas/CollaborativeCanvasEditor/CollaborativeCanvasEditor';
import type { Canvas } from '../../components/Canvas/Canvas.types';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { removeRecordingsFromCache } from '../../hooks/usePaginatedRecordings';
import { RecordingShareModal } from '../RecordingDetailV2Screen/components/RecordingShareModal';

interface RecordingNavState {
  recordingIds?: string[];
}

function isCanvas(value: unknown): value is Canvas {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['id'] !== 'string' || typeof candidate['title'] !== 'string') {
    return false;
  }

  const isCollaborative = candidate['isCollaborative'];
  const channelId = candidate['channelId'];
  const content = candidate['content'];

  if (channelId !== undefined && channelId !== null && typeof channelId !== 'string') {
    return false;
  }
  if (isCollaborative !== undefined && typeof isCollaborative !== 'boolean') {
    return false;
  }

  return content === undefined || Array.isArray(content);
}

interface RecordingCanvasSectionProps {
  canvasId: string;
  title: string;
  icon: ReactElement;
  loadingLabel: string;
  errorLabel: string;
  placeholder: string;
}

function RecordingCanvasSection({
  canvasId,
  title,
  icon,
  loadingLabel,
  errorLabel,
  placeholder,
}: RecordingCanvasSectionProps): ReactElement {
  const [canvasData, canvasDetails] = useCachedQuery(queries.getCanvas({ canvasId }), {
    enabled: !!canvasId,
  });
  const canvas = isCanvas(canvasData) ? canvasData : null;
  const hasCanvasError =
    canvasDetails.type === 'error' || (canvasDetails.type === 'complete' && !canvas);

  const renderBody = (): ReactElement => {
    if (hasCanvasError) {
      return (
        <div className='flex items-center gap-2 text-sm text-destructive'>
          <AlertCircle className='size-4' />
          <span>{errorLabel}</span>
        </div>
      );
    }

    if (!canvas) {
      return (
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Loader2 className='size-4 animate-spin' />
          <span>{loadingLabel}</span>
        </div>
      );
    }

    if (canvas.isCollaborative) {
      return (
        <div className='min-h-[360px] overflow-hidden rounded-md border border-border'>
          <CollaborativeCanvasEditor
            key={canvas.id}
            canvasId={canvas.id}
            channelId={canvas.channelId || undefined}
            title={canvas.title}
            editable={false}
            placeholder={placeholder}
            autoFocus={false}
          />
        </div>
      );
    }

    return (
      <div className='min-h-[240px] overflow-hidden rounded-md border border-border p-4'>
        <CanvasEditor content={canvas.content} editable={false} canvasId={canvas.id} />
      </div>
    );
  };

  return (
    <div className='mb-6 bg-background rounded-lg border border-border p-6'>
      <div className='flex items-center gap-2 mb-4'>
        {icon}
        <h2 className='text-lg font-semibold text-foreground'>{title}</h2>
      </div>

      {renderBody()}
    </div>
  );
}

export default function RecordingDetailScreen(): ReactElement {
  const { isMobile } = usePlatform();
  const { recordingId } = useParams<{ recordingId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // j/k keyboard navigation between recordings
  const navState = location.state as RecordingNavState | null;
  const recordingIds = navState?.recordingIds;

  const currentIndex = useMemo(
    () => (recordingIds && recordingId ? recordingIds.indexOf(recordingId) : -1),
    [recordingIds, recordingId],
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

  // The legacy Ask AI flow still uses attachment ids from the recording message
  // when one exists. Recording sharing itself no longer depends on this message.
  const [message] = useCachedQuery(
    queries.getMessageForActivityV2({ messageId: recording?.messageId ?? '' }),
    { enabled: !!recording?.messageId },
  );

  useEffect(() => {
    if (recordingId) {
      void loadRecording(recordingId);
    }
  }, [recordingId]);

  const loadRecording = async (id: string): Promise<void> => {
    try {
      // Only show full-page loader on initial load, not when switching recordings
      if (!recording) {
        setLoading(true);
      }
      setError(null);
      const data = await recordingService.getRecordingDetail(id);
      setRecording(data);
      setEditedTitle(data.title);
    } catch (err) {
      logRecordingError('RecordingDetailScreen.loadRecording', err);
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

  const handleDelete = async (): Promise<void> => {
    if (!recording) return;

    setIsDeleting(true);
    try {
      await recordingService.deleteRecording(recording.externalId);
      removeRecordingsFromCache([recording.externalId]);
      toast.success('Recording deleted');
      setIsDeleteOpen(false);
      void navigate('/recordings');
    } catch (err) {
      logRecordingError('RecordingDetailScreen.deleteRecording', err);
      toast.error('Failed to delete recording');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveTitle = async (): Promise<void> => {
    if (!recording || !editedTitle.trim()) {
      toast.error('Title cannot be empty');
      return;
    }

    try {
      await recordingService.updateRecordingTitle(recording.externalId, editedTitle.trim());
      setRecording({ ...recording, title: editedTitle.trim() });
      setIsEditingTitle(false);
      toast.success('Title updated');
    } catch (err) {
      logRecordingError('RecordingDetailScreen.updateTitle', err);
      toast.error('Failed to update title');
    }
  };

  const formatDuration = formatRecordingDuration;

  const handleAskAI = (): void => {
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
  };

  const handleDownloadRecording = async (): Promise<void> => {
    if (!recording) return;

    try {
      setIsDownloading(true);
      const blob = await recordingService.downloadRecordingBlob(recording.externalId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${recording.title || recording.externalId}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      logRecordingError('RecordingDetailScreen.downloadRecording', err);
      toast.error('Failed to download recording');
    } finally {
      setIsDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='flex flex-col items-center gap-3'>
          <Loader2 className='w-8 h-8 animate-spin text-action-primary' />
          <p className='text-sm text-muted-foreground'>Loading recording...</p>
        </div>
      </div>
    );
  }

  if (error || !recording) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='flex flex-col items-center gap-3 max-w-md text-center'>
          <AlertCircle className='w-12 h-12 text-destructive' />
          <h3 className='text-lg font-semibold text-foreground'>Error</h3>
          <p className='text-sm text-muted-foreground'>{error || 'Recording not found'}</p>
          <button
            onClick={() => void navigate('/recordings')}
            className='mt-4 px-4 py-2 bg-action-primary text-action-primary-foreground rounded-md hover:opacity-90 transition-opacity'
            data-track-category='RecordingDetail'
            data-track-name='back_to_recordings_error'
          >
            Back to Recordings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full overflow-auto bg-muted'>
      {/* This root is itself the scroll container, so a zero-height sticky wrapper
          pins the navigator without contributing layout height. */}
      {!isMobile && (
        <div className='sticky left-0 top-0 z-30 hidden h-0 w-fit md:block'>
          <div className='h-[52px] w-fit'>
            <AppNavigator />
          </div>
        </div>
      )}
      <div className='max-w-4xl mx-auto p-6'>
        {/* Header */}
        <div className='mb-6'>
          <button
            onClick={() => void navigate('/recordings')}
            className='flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4'
            data-track-category='RecordingDetail'
            data-track-name='back_to_recordings'
          >
            <ArrowLeft className='w-4 h-4' />
            Back to Recordings
          </button>

          {/* Title */}
          <div className='flex items-center gap-3 mb-3'>
            {isEditingTitle ? (
              <div className='flex-1 flex items-center gap-2'>
                <input
                  type='text'
                  value={editedTitle}
                  onChange={e => setEditedTitle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleSaveTitle();
                    }
                  }}
                  className='flex-1 px-3 py-2 text-2xl font-bold bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring'
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  data-track-category='RecordingDetail'
                  data-track-name='edit_title_input'
                />
                <button
                  onClick={() => void handleSaveTitle()}
                  className='p-2 text-status-success hover:bg-muted rounded-md'
                  data-track-category='RecordingDetail'
                  data-track-name='save_title'
                >
                  <Check className='w-5 h-5' />
                </button>
                <button
                  onClick={() => {
                    setEditedTitle(recording.title);
                    setIsEditingTitle(false);
                  }}
                  className='p-2 text-destructive hover:bg-muted rounded-md'
                  data-track-category='RecordingDetail'
                  data-track-name='cancel_edit_title'
                >
                  <X className='w-5 h-5' />
                </button>
              </div>
            ) : (
              <>
                <h1 className='flex-1 text-2xl font-bold text-foreground'>{recording.title}</h1>
                <button
                  onClick={() => setIsEditingTitle(true)}
                  className='p-2 text-muted-foreground hover:bg-muted rounded-md'
                  data-track-category='RecordingDetail'
                  data-track-name='edit_title'
                >
                  <Edit2 className='w-5 h-5' />
                </button>
              </>
            )}
          </div>

          {/* Metadata */}
          <div className='flex items-center gap-4 text-sm text-muted-foreground'>
            <div className='flex items-center gap-1'>
              <Clock className='w-4 h-4' />
              <span>{formatDistanceToNow(new Date(recording.startedAt), { addSuffix: true })}</span>
            </div>
            {recording.durationMs && (
              <div className='flex items-center gap-1'>
                <span>Duration: {formatDuration(recording.durationMs)}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className='flex items-center gap-3 mt-4'>
            <button
              onClick={handleAskAI}
              className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              data-track-category='RecordingDetail'
              data-track-name='ask_ai_recording'
            >
              <img
                src='/svgs/icons/ai-bot-gradient-star.svg'
                width={16}
                height={16}
                alt=''
                aria-hidden='true'
              />
              Ask AI
            </button>
            {recording?.channelId && recording?.conversationId && (
              <button
                onClick={() =>
                  void navigate(`/chat/dir/${recording.channelId}/${recording.conversationId}`)
                }
                className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-action-primary hover:bg-muted rounded-md transition-colors'
                data-track-category='RecordingDetail'
                data-track-name='view_thread'
              >
                <MessageSquare className='w-4 h-4' />
                View Thread
              </button>
            )}
            <button
              onClick={() => setIsShareOpen(true)}
              className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors'
              data-track-category='RecordingDetail'
              data-track-name='share_recording'
            >
              <Share2 className='w-4 h-4' />
              Share Recording
            </button>
            {recording.hasRecording && (
              <button
                onClick={() => void handleDownloadRecording()}
                disabled={isDownloading}
                className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-gray-100 hover:bg-muted dark:hover:bg-gray-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                data-track-category='RecordingDetail'
                data-track-name='download_recording'
              >
                {isDownloading ? (
                  <Loader2 className='w-4 h-4 animate-spin' />
                ) : (
                  <Download className='w-4 h-4' />
                )}
                Download Recording
              </button>
            )}
            <button
              onClick={() => setIsDeleteOpen(true)}
              className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-muted rounded-md transition-colors'
              data-track-category='RecordingDetail'
              data-track-name='delete_recording'
            >
              <Trash2 className='w-4 h-4' />
              Delete Recording
            </button>
          </div>
        </div>

        {/* Transcript */}
        {recording.hasTranscript && recording.transcript && (
          <div className='mb-6 bg-background dark:bg-gray-800 rounded-lg border border-border dark:border-gray-700 p-6'>
            {/* Header */}
            <div className='flex items-center gap-2 mb-4'>
              <FileText className='w-4 h-4 text-muted-foreground' />
              <h2 className='text-base font-semibold text-foreground dark:text-gray-100'>
                {recording.hasIdentifiedTranscript ? 'Identified Transcript' : 'Transcript'}
              </h2>
            </div>

            <pre className='whitespace-pre-wrap font-sans text-sm text-foreground dark:text-gray-100 leading-relaxed'>
              {recording.hasIdentifiedTranscript
                ? (recording.identifiedTranscript ?? recording.transcript)
                : recording.transcript}
            </pre>
          </div>
        )}

        {/* AI Summary */}
        {recording.hasSummary && recording.aiSummary && (
          <div className='mb-6 bg-background rounded-lg border border-border p-6'>
            <div className='flex items-center gap-2 mb-4'>
              <div className='w-5 h-5 bg-gradient-to-br from-purple-500 to-pink-500 rounded' />
              <h2 className='text-lg font-semibold text-foreground'>AI Summary</h2>
            </div>
            <div className='bot-markdown-content-call-summary' style={{ marginLeft: '10px' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{recording.aiSummary}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Detailed Summary */}
        {recording.detailedSummaryCanvasId && (
          <RecordingCanvasSection
            canvasId={recording.detailedSummaryCanvasId}
            title='Detailed Summary'
            icon={<ScrollText className='w-4 h-4 text-muted-foreground' />}
            loadingLabel='Loading detailed summary...'
            errorLabel='Failed to load detailed summary.'
            placeholder='Detailed summary...'
          />
        )}

        {/* Notes */}
        {recording.notesCanvasId && (
          <RecordingCanvasSection
            canvasId={recording.notesCanvasId}
            title='Notes'
            icon={<FileText className='w-4 h-4 text-muted-foreground' />}
            loadingLabel='Loading notes...'
            errorLabel='Failed to load notes.'
            placeholder='Recording notes...'
          />
        )}

        {/* No content message */}
        {!recording.hasTranscript &&
          !recording.hasSummary &&
          !recording.notesCanvasId &&
          !recording.detailedSummaryCanvasId && (
            <div className='bg-background rounded-lg border border-border p-12 text-center'>
              <p className='text-muted-foreground'>Transcript and summary are being processed...</p>
            </div>
          )}
      </div>

      {/* Share Recording Dialog */}
      <Dialog
        open={isShareOpen}
        onOpenChange={open => !open && setIsShareOpen(false)}
        title='Share recording'
        data-testid='recording-share-modal'
      >
        <RecordingShareModal recording={recording} onClose={() => setIsShareOpen(false)} />
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={open => !open && setIsDeleteOpen(false)}>
        <div className='p-6 max-w-sm'>
          <h3 className='text-lg font-semibold text-foreground mb-2'>Delete Recording</h3>
          <p className='text-sm text-muted-foreground mb-6'>
            Are you sure you want to delete &quot;{recording?.title}&quot;? This action cannot be
            undone.
          </p>
          <div className='flex items-center justify-end gap-3'>
            <button
              onClick={() => setIsDeleteOpen(false)}
              disabled={isDeleting}
              className='px-4 py-2 text-sm font-medium text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50'
              data-track-category='RecordingDetail'
              data-track-name='cancel_delete_recording'
            >
              Cancel
            </button>
            <button
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              className='px-4 py-2 text-sm font-medium text-destructive-foreground bg-destructive hover:opacity-90 rounded-md transition-opacity disabled:opacity-50 flex items-center gap-2'
              data-track-category='RecordingDetail'
              data-track-name='confirm_delete_recording'
            >
              {isDeleting && <Loader2 className='w-4 h-4 animate-spin' />}
              Delete
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
