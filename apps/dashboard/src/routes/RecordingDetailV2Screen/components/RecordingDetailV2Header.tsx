import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type TouchEvent as ReactTouchEvent,
  useState,
} from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { MinimizeLineArrow, Spinner } from '@xyne/icons';
import { Button } from '../../../components/ui/Button/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { useSelf } from '../../../hooks/useUsers';
import {
  recordingService,
  type RecordingDetail,
  type RecordingTicketLinkState,
} from '../../../services/Recording/recordingService';
import { logRecordingError, type RecordingTitleState } from '../../../utils/recordingUtils';
import { useApplyRecordingLabelsChange } from '../../../hooks/useResolvedRecordingLabels';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatDuration } from '../../../utils/dateUtils';
import { RecordingParticipants } from './RecordingParticipants';
import { useEditableRecordingTitle } from '../useEditableRecordingTitle';
import { RecordingLabelPicker } from './RecordingLabelPicker';
import { RecordingSharedWithAvatars } from './RecordingSharedWithAvatars';
import { RecordingTicketLink, type RecordingTicketTarget } from './RecordingTicketLink';

export interface RecordingDetailV2HeaderProps {
  recording: RecordingDetail;
  isLive: boolean;
  titleState?: RecordingTitleState;
  onTitleUpdated: (title: string) => void;
  onLabelsUpdated: (labels: string[]) => void;
  onTicketLinkUpdated: (ticketLink: RecordingTicketLinkState) => void;
  onOpenShare: () => void;
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

export interface EditableTitleInputProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  disabled: boolean;
  className: string;
  trackCategory: string;
  onMouseDown?: (event: ReactMouseEvent<HTMLInputElement>) => void;
  onTouchStart?: (event: ReactTouchEvent<HTMLInputElement>) => void;
}

export const EditableTitleInput = ({
  value,
  onChange,
  onSave,
  onKeyDown,
  disabled,
  className,
  trackCategory,
  onMouseDown,
  onTouchStart,
}: EditableTitleInputProps): ReactElement => (
  <input
    type='text'
    value={value}
    onChange={event => onChange(event.target.value)}
    onBlur={onSave}
    onFocus={event => event.currentTarget.select()}
    onKeyDown={onKeyDown}
    disabled={disabled}
    className={className}
    // eslint-disable-next-line jsx-a11y/no-autofocus
    autoFocus
    data-track-category={trackCategory}
    data-track-name='edit_title_input'
    {...(onMouseDown ? { onMouseDown } : {})}
    {...(onTouchStart ? { onTouchStart } : {})}
  />
);

export const RecordingDetailV2Header = ({
  recording,
  isLive,
  titleState,
  onTitleUpdated,
  onLabelsUpdated,
  onTicketLinkUpdated,
  onOpenShare,
  onMinimize,
}: RecordingDetailV2HeaderProps): ReactElement => {
  const currentUser = useSelf();
  const [isUpdatingTicketLink, setIsUpdatingTicketLink] = useState(false);
  const applyLabelsChange = useApplyRecordingLabelsChange(onLabelsUpdated);

  // Only the creator can rename or relabel; a recording shared with you is read-only.
  const isOwner = recording.createdByUserId === currentUser?.id;
  const canShare = !isLive && Boolean(recording.detailedSummaryCanvasId);
  const isGeneratingTitle = titleState?.kind === 'generating';
  const {
    currentTitle,
    isEditingTitle,
    editedTitle,
    isSavingTitle,
    handleStartEdit,
    handleSaveTitle,
    handleTitleChange,
    handleTitleKeyDown,
  } = useEditableRecordingTitle({
    recordingId: recording.externalId,
    title: recording.title,
    onTitleUpdated,
    disabled: isGeneratingTitle,
    context: 'RecordingDetailV2Header',
  });
  const displayTitle =
    titleState && titleState.kind !== 'generating' ? titleState.text : currentTitle;
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

  const handleLabelsChange = async (labels: string[]): Promise<void> => {
    await applyLabelsChange(recording.externalId, labels, 'RecordingDetailV2Header.updateLabels');
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

  return (
    <header className='mb-6'>
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
                <EditableTitleInput
                  value={editedTitle}
                  onChange={handleTitleChange}
                  onSave={() => void handleSaveTitle()}
                  onKeyDown={handleTitleKeyDown}
                  disabled={isSavingTitle}
                  className='absolute inset-0 w-full bg-transparent border-0 p-0 text-3xl font-medium text-foreground focus:outline-none focus:ring-0 disabled:opacity-50'
                  trackCategory='RecordingDetailV2'
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
      <div className='flex items-start gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <RecordingParticipants
            recordingExternalId={recording.externalId}
            createdByUserId={recording.createdByUserId}
            recordingParticipants={recording.recordingParticipants}
            shares={recording.shares}
          />
          {!isLive && recording.detailedSummaryCanvasId && (
            <RecordingTicketLink
              linkedTicketId={recording.linkedTicketId ?? null}
              canEdit={canShare}
              isUpdating={isUpdatingTicketLink}
              onChange={(ticketId, ticket) => void handleTicketLinkChange(ticketId, ticket)}
            />
          )}
          <RecordingLabelPicker
            labels={recording.labels ?? []}
            canEdit={recording.createdByUserId === currentUser?.id}
            onChange={labels => void handleLabelsChange(labels)}
          />
          {canShare && (
            <RecordingSharedWithAvatars
              recordingExternalId={recording.externalId}
              onOpen={onOpenShare}
            />
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
        </div>
      </div>
    </header>
  );
};
