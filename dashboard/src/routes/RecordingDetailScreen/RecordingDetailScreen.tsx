/**
 * Recording Detail Screen - View individual recording with transcript and summary
 */

import { ReactElement, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { recordingService, RecordingDetail } from '../../services/Recording/recordingService';
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
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import ForwardMessageForm from '../../components/Chat/ForwardMessageModal/ForwardMessageModal';
import Dialog from '../../components/ui/Dialog';
import { formatRecordingDuration, logRecordingError } from '../../utils/recordingUtils';

export default function RecordingDetailScreen(): ReactElement {
  const { recordingId } = useParams<{ recordingId: string }>();
  const navigate = useNavigate();

  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Query the message for sharing using Zero - same pattern as ShareRecordingHandler
  const [message] = useCachedQuery(
    queries.getMessageForActivityV2({ messageId: recording?.messageId ?? '' }),
  );

  useEffect(() => {
    if (recordingId) {
      void loadRecording(recordingId);
    }
  }, [recordingId]);

  const loadRecording = async (id: string): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const data = await recordingService.getRecordingDetail(id);
      setRecording(data);
      setEditedTitle(data.title);
    } catch (err) {
      logRecordingError('RecordingDetailScreen.loadRecording', err);
      setError('Failed to load recording. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!recording) return;

    setIsDeleting(true);
    try {
      await recordingService.deleteRecording(recording.externalId);
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

  if (loading) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='flex flex-col items-center gap-3'>
          <Loader2 className='w-8 h-8 animate-spin text-blue-500' />
          <p className='text-sm text-muted-foreground'>Loading recording...</p>
        </div>
      </div>
    );
  }

  if (error || !recording) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='flex flex-col items-center gap-3 max-w-md text-center'>
          <AlertCircle className='w-12 h-12 text-red-500' />
          <h3 className='text-lg font-semibold text-foreground dark:text-gray-100'>Error</h3>
          <p className='text-sm text-muted-foreground dark:text-muted-foreground'>
            {error || 'Recording not found'}
          </p>
          <button
            onClick={() => void navigate('/recordings')}
            className='mt-4 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors'
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
    <div className='h-full overflow-auto bg-muted dark:bg-gray-900'>
      <div className='max-w-4xl mx-auto p-6'>
        {/* Header */}
        <div className='mb-6'>
          <button
            onClick={() => void navigate('/recordings')}
            className='flex items-center gap-2 text-sm text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-gray-100 mb-4'
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
                  className='flex-1 px-3 py-2 text-2xl font-bold bg-background dark:bg-gray-800 border border-input dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  data-track-category='RecordingDetail'
                  data-track-name='edit_title_input'
                />
                <button
                  onClick={() => void handleSaveTitle()}
                  className='p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-md'
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
                  className='p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md'
                  data-track-category='RecordingDetail'
                  data-track-name='cancel_edit_title'
                >
                  <X className='w-5 h-5' />
                </button>
              </div>
            ) : (
              <>
                <h1 className='flex-1 text-2xl font-bold text-foreground dark:text-gray-100'>
                  {recording.title}
                </h1>
                <button
                  onClick={() => setIsEditingTitle(true)}
                  className='p-2 text-muted-foreground dark:text-muted-foreground hover:bg-muted dark:hover:bg-gray-800 rounded-md'
                  data-track-category='RecordingDetail'
                  data-track-name='edit_title'
                >
                  <Edit2 className='w-5 h-5' />
                </button>
              </>
            )}
          </div>

          {/* Metadata */}
          <div className='flex items-center gap-4 text-sm text-muted-foreground dark:text-muted-foreground'>
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
            {recording?.channelId && recording?.conversationId && (
              <button
                onClick={() =>
                  void navigate(`/chat/dir/${recording.channelId}/${recording.conversationId}`)
                }
                className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors'
                data-track-category='RecordingDetail'
                data-track-name='view_thread'
              >
                <MessageSquare className='w-4 h-4' />
                View Thread
              </button>
            )}
            <button
              onClick={() => {
                if (!recording?.messageId) {
                  toast.error('Recording message not found');
                  return;
                }
                setIsShareOpen(true);
              }}
              disabled={!recording?.messageId}
              className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-gray-100 hover:bg-muted dark:hover:bg-gray-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              data-track-category='RecordingDetail'
              data-track-name='share_recording'
            >
              <Share2 className='w-4 h-4' />
              Share Recording
            </button>
            <button
              onClick={() => setIsDeleteOpen(true)}
              className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors'
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
            <div className='flex items-center gap-2 mb-4'>
              <FileText className='w-5 h-5 text-blue-600 dark:text-blue-400' />
              <h2 className='text-lg font-semibold text-foreground dark:text-gray-100'>
                Transcript
              </h2>
            </div>
            <div className='prose dark:prose-invert max-w-none'>
              <p className='whitespace-pre-wrap text-foreground dark:text-muted'>
                {recording.transcript}
              </p>
            </div>
          </div>
        )}

        {/* AI Summary */}
        {recording.hasSummary && recording.aiSummary && (
          <div className='mb-6 bg-background dark:bg-gray-800 rounded-lg border border-border dark:border-gray-700 p-6'>
            <div className='flex items-center gap-2 mb-4'>
              <div className='w-5 h-5 bg-gradient-to-br from-purple-500 to-pink-500 rounded' />
              <h2 className='text-lg font-semibold text-foreground dark:text-gray-100'>
                AI Summary
              </h2>
            </div>
            <div className='bot-markdown-content-call-summary' style={{ marginLeft: '10px' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{recording.aiSummary}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* No content message */}
        {!recording.hasTranscript && !recording.hasSummary && (
          <div className='bg-background dark:bg-gray-800 rounded-lg border border-border dark:border-gray-700 p-12 text-center'>
            <p className='text-muted-foreground dark:text-muted-foreground'>
              Transcript and summary are being processed...
            </p>
          </div>
        )}
      </div>

      {/* Share Recording Dialog */}
      <Dialog open={isShareOpen} onOpenChange={open => !open && setIsShareOpen(false)}>
        {message && (
          <ForwardMessageForm
            channelId={recording?.channelId ?? ''}
            message={message}
            onCancel={() => setIsShareOpen(false)}
            onSuccess={() => {
              setIsShareOpen(false);
              toast.success('Recording shared successfully');
            }}
          />
        )}
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={open => !open && setIsDeleteOpen(false)}>
        <div className='p-6 max-w-sm'>
          <h3 className='text-lg font-semibold text-foreground dark:text-gray-100 mb-2'>
            Delete Recording
          </h3>
          <p className='text-sm text-muted-foreground dark:text-muted-foreground mb-6'>
            Are you sure you want to delete &quot;{recording?.title}&quot;? This action cannot be
            undone.
          </p>
          <div className='flex items-center justify-end gap-3'>
            <button
              onClick={() => setIsDeleteOpen(false)}
              disabled={isDeleting}
              className='px-4 py-2 text-sm font-medium text-foreground dark:text-muted hover:bg-muted dark:hover:bg-gray-800 rounded-md transition-colors disabled:opacity-50'
              data-track-category='RecordingDetail'
              data-track-name='cancel_delete_recording'
            >
              Cancel
            </button>
            <button
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              className='px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2'
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
