import { type ReactElement, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { MinimizeLineArrow, Share02, Spinner, UturnLeft } from '@xyne/icons';
import { Button } from '../../../components/ui/Button/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Tooltip } from '../../../components/ui/Tooltip';
import XyneAIStar from '../../../components/icons/xyne-ai/XyneAIStar';
import { useSelf } from '../../../hooks/useUsers';
import {
  recordingService,
  type RecordingDetail,
  type RecordingTicketLinkState,
} from '../../../services/Recording/recordingService';
import {
  DEFAULT_RECORDING_TITLE,
  logRecordingError,
  type RecordingTitleState,
} from '../../../utils/recordingUtils';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatDuration } from '../../../utils/dateUtils';
import { RecordingLabelPicker } from './RecordingLabelPicker';
import { RecordingShareModal } from './RecordingShareModal';
import { RecordingSharedWithAvatars } from './RecordingSharedWithAvatars';
import { RecordingTicketLink, type RecordingTicketTarget } from './RecordingTicketLink';

export interface RecordingDetailV2HeaderProps {
  recording: RecordingDetail;
  isLive: boolean;
  titleState?: RecordingTitleState;
  onTitleUpdated: (title: string) => void;
  onLabelsUpdated: (labels: string[]) => void;
  onTicketLinkUpdated: (ticketLink: RecordingTicketLinkState) => void;
  onAskAI: () => void;
  onMinimize?: () => void;
}

const HeaderTitle = ({
  isGenerating,
  title,
}: {
  isGenerating: boolean;
  title: string;
}): ReactElement =>
  isGenerating ? (
    <span
      role='status'
      aria-label='Generating title'
      className='flex h-9 w-[28rem] max-w-full items-center'
    >
      <span aria-hidden='true' className='relative h-7 w-full overflow-hidden rounded-lg bg-muted'>
        <span className='pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_25%,hsl(var(--foreground)/0.12)_50%,transparent_75%)] bg-[length:200%_100%] [--duration:3s] motion-safe:animate-shine' />
      </span>
    </span>
  ) : (
    <span className='truncate'>{title}</span>
  );

export const RecordingDetailV2Header = ({
  recording,
  isLive,
  titleState,
  onTitleUpdated,
  onLabelsUpdated,
  onTicketLinkUpdated,
  onAskAI,
  onMinimize,
}: RecordingDetailV2HeaderProps): ReactElement => {
  const navigate = useNavigate();
  const currentUser = useSelf();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(recording.title);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isUpdatingTicketLink, setIsUpdatingTicketLink] = useState(false);

  // Only the creator can rename or relabel; a recording shared with you is read-only.
  const isOwner = recording.createdByUserId === currentUser?.id;
  const isGeneratingTitle = titleState?.kind === 'generating';
  const displayTitle =
    titleState && titleState.kind !== 'generating'
      ? titleState.text
      : recording.title?.trim() || DEFAULT_RECORDING_TITLE;
  // A still-running recording has no length yet, so the meta line is just when it started.
  const durationMs =
    recording.durationMs ??
    (recording.endedAt
      ? new Date(recording.endedAt).getTime() - new Date(recording.startedAt).getTime()
      : null);
  const formattedDate = [
    format(new Date(recording.startedAt), 'MMM d, yyyy · h:mm a'),
    durationMs && durationMs > 0 ? formatDuration(durationMs) : null,
  ]
    .filter(Boolean)
    .join(' · ');

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

  /**
   * The backend performs ticket linking/unlinking as one transactional command:
   * recording access, canvas access, thread message, and recording metadata.
   */
  const handleTicketLinkChange = async (
    ticketId: string | null,
    ticket?: RecordingTicketTarget,
  ): Promise<void> => {
    if (isUpdatingTicketLink) return;

    setIsUpdatingTicketLink(true);

    try {
      if (!ticketId) {
        const result = await recordingService.unlinkRecordingFromTicket(recording.externalId);
        onTicketLinkUpdated(result);
        toast.success('Ticket unlinked');
        return;
      }
      if (!ticket) throw new Error('Ticket details are unavailable');
      const result = await recordingService.linkRecordingToTicket(recording.externalId, ticketId);
      onTicketLinkUpdated(result);
      toast.success(`Recording linked to ${ticket.label}`);
    } catch (err) {
      logRecordingError('RecordingDetailV2Header.updateTicketLink', err);
      toast.error(ticketId ? 'Failed to link ticket' : 'Failed to unlink ticket', {
        description: getApiErrorMessage(err, 'Unable to update the ticket link'),
      });
    } finally {
      setIsUpdatingTicketLink(false);
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

  const handleStartEdit = (): void => {
    if (isEditingTitle || isSavingTitle || isGeneratingTitle) return;
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
          {/* Plain text here — the breadcrumb is a navigation label, not a status. */}
          <li className='truncate text-foreground'>
            {isGeneratingTitle ? 'Generating title…' : displayTitle}
          </li>
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
          ) : isOwner && !isGeneratingTitle ? (
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
                <HeaderTitle isGenerating={isGeneratingTitle} title={displayTitle} />
              </h1>
            </div>
          ) : (
            /* Shared-with-me, or the AI title is still generating: not this
               user's to change right now, so it isn't focusable or clickable
               — no affordance to discover and be refused. */
            <h1 className='flex min-w-0 items-baseline gap-2 text-3xl font-medium text-foreground'>
              {isLive && <span className='shrink-0 text-muted-foreground/70'>Capturing:</span>}
              <HeaderTitle isGenerating={isGeneratingTitle} title={displayTitle} />
            </h1>
          )}

          <p className='mt-2.5 text-sm text-muted-foreground'>{formattedDate}</p>
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
      <div className='flex items-start'>
        <div className='flex flex-wrap items-center gap-2'>
          {!isLive && recording.detailedSummaryCanvasId && (
            <RecordingTicketLink
              linkedTicketId={recording.linkedTicketId ?? null}
              canEdit={isOwner}
              isUpdating={isUpdatingTicketLink}
              onChange={(ticketId, ticket) => void handleTicketLinkChange(ticketId, ticket)}
            />
          )}
          <RecordingLabelPicker
            labels={recording.labels ?? []}
            canEdit={recording.createdByUserId === currentUser?.id}
            onChange={labels => void handleLabelsChange(labels)}
          />
          {isOwner && !isLive && recording.detailedSummaryCanvasId && (
            <>
              <RecordingSharedWithAvatars
                recordingExternalId={recording.externalId}
                onOpen={() => setShowShareModal(true)}
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
            </>
          )}
          {onMinimize && (
            <Tooltip content='Minimize to overlay' side='top'>
              <Button
                type='button'
                variant='outline'
                size='iconSm'
                onClick={onMinimize}
                className='size-7 rounded-lg text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                aria-label='Minimize to floating overlay'
                data-track-category='RecordingDetailV2'
                data-track-name='minimize_to_overlay'
              >
                <MinimizeLineArrow className='size-3.5' />
              </Button>
            </Tooltip>
          )}

          {isOwner && !isLive && showShareModal && recording.detailedSummaryCanvasId && (
            <Dialog
              open={showShareModal}
              onOpenChange={open => !open && setShowShareModal(false)}
              title='Share recording'
              data-testid='recording-share-modal'
            >
              <RecordingShareModal
                recording={recording}
                onClose={() => setShowShareModal(false)}
                onTicketLinkUpdated={onTicketLinkUpdated}
              />
            </Dialog>
          )}
        </div>
        {!isLive && (
          <Tooltip content='Ask AI about this recording' side='top'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={onAskAI}
              className='ml-auto h-8 gap-2 rounded-xl w-24 text-[13px] font-medium border-muted-foreground/20'
              data-track-category='RecordingDetailV2'
              data-track-name='ask_ai_recording'
            >
              <XyneAIStar />
              Ask AI
            </Button>
          </Tooltip>
        )}
      </div>
    </header>
  );
};
