import { type ReactElement, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { LinkChainSlant, CalendarEvent, Share02, Spinner, UturnLeft } from '@xyne/icons';
import { Button } from '../../../components/ui/Button/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Tooltip } from '../../../components/ui/Tooltip';
import XyneAIStar from '../../../components/icons/xyne-ai/XyneAIStar';
import { useSelf } from '../../../hooks/useUsers';
import {
  recordingService,
  type RecordingDetail,
} from '../../../services/Recording/recordingService';
import { logRecordingError } from '../../../utils/recordingUtils';
import { RecordingLabelPicker } from './RecordingLabelPicker';
import { RecordingShareModal } from './RecordingShareModal';

export interface RecordingDetailV2HeaderProps {
  recording: RecordingDetail;
  isLive: boolean;
  onTitleUpdated: (title: string) => void;
  onLabelsUpdated: (labels: string[]) => void;
  onAskAI: () => void;
}

export const RecordingDetailV2Header = ({
  recording,
  isLive,
  onTitleUpdated,
  onLabelsUpdated,
  onAskAI,
}: RecordingDetailV2HeaderProps): ReactElement => {
  const navigate = useNavigate();
  const currentUser = useSelf();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(recording.title);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showLiveAskAIHint, setShowLiveAskAIHint] = useState(false);

  // Only the creator can rename or relabel; a recording shared with you is read-only.
  const isOwner = recording.createdByUserId === currentUser?.id;
  const displayTitle = recording.title?.trim() || 'Impromptu Recording';
  const formattedDate = format(new Date(recording.startedAt), 'MMM d, yyyy · h:mm a');

  const handleSaveTitle = async (): Promise<void> => {
    if (isSavingTitle) return;

    const trimmed = editedTitle.trim();
    if (!trimmed) {
      setEditedTitle(recording.title);
      setIsEditingTitle(false);
      toast.error('Title cannot be empty');
      return;
    }

    if (trimmed === recording.title) {
      setIsEditingTitle(false);
      return;
    }

    setIsSavingTitle(true);
    try {
      await recordingService.updateRecordingTitle(recording.externalId, trimmed);
      onTitleUpdated(trimmed);
      toast.success('Title updated');
    } catch (err) {
      logRecordingError('RecordingDetailV2Header.updateTitle', err);
      toast.error('Failed to update title');
      setEditedTitle(recording.title);
    } finally {
      setIsSavingTitle(false);
      setIsEditingTitle(false);
    }
  };

  /** Labels apply optimistically and roll back if the recording rejects the write. */
  const handleLabelsChange = async (labels: string[]): Promise<void> => {
    const previousLabels = recording.labels ?? [];
    onLabelsUpdated(labels);

    try {
      await recordingService.updateRecording(recording.externalId, { labels });
    } catch (err) {
      logRecordingError('RecordingDetailV2Header.updateLabels', err);
      toast.error('Failed to update labels');
      onLabelsUpdated(previousLabels);
    }
  };

  const handleCancelEdit = (): void => {
    if (isSavingTitle) return;
    setEditedTitle(recording.title);
    setIsEditingTitle(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelEdit();
    }
  };

  const handleAskAIClick = (): void => {
    if (isLive) {
      setShowLiveAskAIHint(true);
      return;
    }
    onAskAI();
  };

  const handleStartEdit = (): void => {
    if (isEditingTitle || isSavingTitle) return;
    setEditedTitle(recording.title);
    setIsEditingTitle(true);
  };

  return (
    <header className='mb-6'>
      {/* Breadcrumb */}
      <nav aria-label='Breadcrumb' className='mb-3'>
        <ol className='flex items-center gap-1.5 text-sm'>
          <li>
            <button
              type='button'
              onClick={() => void navigate('/recordings')}
              className='flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground duration-300'
              data-track-category='RecordingDetailV2'
              data-track-name='breadcrumb_recordings'
            >
              <UturnLeft className='size-3.5' variant='Stroke' aria-hidden='true' />
              Recordings
            </button>
          </li>
          <li aria-hidden='true' className='text-muted-foreground'>
            /
          </li>
          <li className='truncate text-foreground'>{displayTitle}</li>
        </ol>
      </nav>

      {/* Title */}
      <div className='mb-4 flex items-start gap-3'>
        <div className='min-w-0'>
          {isEditingTitle ? (
            <div className='flex items-baseline gap-2'>
              {isLive && (
                <span className='shrink-0 text-3xl font-medium text-muted-foreground/70'>
                  Capturing:
                </span>
              )}
              <div className='relative inline-flex max-w-full overflow-hidden'>
                <span
                  className='invisible whitespace-pre text-3xl font-medium truncate'
                  aria-hidden='true'
                >
                  {editedTitle || ' '}
                </span>
                <input
                  type='text'
                  value={editedTitle}
                  onChange={event => setEditedTitle(event.target.value)}
                  onBlur={() => void handleSaveTitle()}
                  onFocus={event => event.currentTarget.select()}
                  onKeyDown={handleKeyDown}
                  disabled={isSavingTitle}
                  className='absolute inset-0 w-full bg-transparent border-0 p-0 text-3xl font-medium text-foreground focus:outline-none focus:ring-0 disabled:opacity-50'
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  data-track-category='RecordingDetailV2'
                  data-track-name='edit_title_input'
                />
              </div>
            </div>
          ) : isOwner ? (
            <div
              role='button'
              tabIndex={0}
              onClick={handleStartEdit}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleStartEdit();
                }
              }}
              className='flex items-baseline gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring'
              data-track-category='RecordingDetailV2'
              data-track-name='edit_title_click_title'
            >
              <h1 className='flex min-w-0 items-baseline gap-2 text-3xl font-medium text-foreground'>
                {isLive && <span className='shrink-0 text-muted-foreground/70'>Capturing:</span>}
                <span className='truncate'>{displayTitle}</span>
              </h1>
            </div>
          ) : (
            /* Shared-with-me: the title is someone else's to change, so it isn't
               focusable or clickable — no affordance to discover and be refused. */
            <h1 className='flex min-w-0 items-baseline gap-2 text-3xl font-medium text-foreground'>
              {isLive && <span className='shrink-0 text-muted-foreground/70'>Capturing:</span>}
              <span className='truncate'>{displayTitle}</span>
            </h1>
          )}
        </div>

        {isSavingTitle && (
          <span
            className='flex size-8 shrink-0 items-center justify-center text-muted-foreground'
            role='status'
            aria-label='Saving title'
          >
            <Spinner size={16} className='animate-spin' />
          </span>
        )}
      </div>

      {/* Actions row */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <Tooltip content='Recording started' side='top'>
            <div className='inline-flex items-center gap-1.5 rounded-lg border border-border hover:bg-muted px-3 py-1 text-xs text-muted-foreground'>
              <CalendarEvent size={16} variant='Stroke' />
              <span>{formattedDate}</span>
            </div>
          </Tooltip>
          <Tooltip content='Link a ticket or thread' side='top'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => toast.info('Link sharing coming soon')}
              className='h-7 gap-1.5 rounded-lg px-3 text-xs font-normal border-dashed border-muted-foreground/40 text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              data-track-category='RecordingDetailV2'
              data-track-name='copy_link_dummy'
            >
              <LinkChainSlant className='size-3.5' />
              Link
            </Button>
          </Tooltip>
          <RecordingLabelPicker
            labels={recording.labels ?? []}
            canEdit={recording.createdByUserId === currentUser?.id}
            onChange={labels => void handleLabelsChange(labels)}
          />
          <Tooltip content='Share' side='top'>
            <Button
              type='button'
              variant='outline'
              size='iconSm'
              onClick={() => setShowShareModal(true)}
              className='w-8 h-7 rounded-lg text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              aria-label='Share recording'
              data-track-category='RecordingDetailV2'
              data-track-name='share_recording'
            >
              <Share02 className='size-3.5' />
            </Button>
          </Tooltip>
        </div>

        {showShareModal && (
          <Dialog
            open={showShareModal}
            onOpenChange={open => !open && setShowShareModal(false)}
            title='Share recording'
            data-testid='recording-share-modal'
          >
            <RecordingShareModal recording={recording} onClose={() => setShowShareModal(false)} />
          </Dialog>
        )}

        <Popover.Root open={showLiveAskAIHint} onOpenChange={setShowLiveAskAIHint}>
          <Tooltip content='Ask AI about this recording' side='top'>
            <Popover.Anchor asChild>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={handleAskAIClick}
                className='h-8 gap-2 rounded-xl w-24 text-[13px] font-medium border-muted-foreground/20'
                data-track-category='RecordingDetailV2'
                data-track-name={isLive ? 'ask_ai_live_hint' : 'ask_ai_recording'}
              >
                <XyneAIStar />
                Ask AI
              </Button>
            </Popover.Anchor>
          </Tooltip>

          <Popover.Portal>
            <Popover.Content
              side='bottom'
              align='end'
              sideOffset={8}
              className='z-50 w-64 rounded-xl border border-border bg-popover p-3.5 shadow-2xl'
            >
              <div className='mb-2 flex items-center gap-1.5'>
                <XyneAIStar size={14} />
                <h3 className='text-sm font-semibold text-foreground'>Ask AI</h3>
              </div>
              <p className='text-pretty text-xs leading-relaxed text-muted-foreground/70'>
                Ask about decisions, action items, and anything said. Available on the full
                recording once you stop.
              </p>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </header>
  );
};
