import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';
import type { User } from '@xyne/shared/machines';
import { TagMethod } from '@xyne/shared';
import {
  Ai01,
  ChevronRight,
  DeleteDustbin02,
  DownloadBarDown,
  MicOn,
  MusicQuaverNote,
  Share01,
  ThreeDotsMenuHorizontal,
} from '@xyne/icons';
import { AudioLines } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/Button/Button';
import Avatar from '../../../components/ui/Avatar/Avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import {
  patchOatsRecordingLabels,
  type OatsRecordingEntry,
} from '../../../hooks/usePaginatedOatsRecordings';
import {
  recordingService,
  type RecordingDetail,
} from '../../../services/Recording/recordingService';
import {
  confirmRecordingLabelSuggestion,
  useApplyRecordingLabelsChange,
} from '../../../hooks/useResolvedRecordingLabels';
import {
  calculateRecordingElapsedMs,
  formatElapsedTime,
  formatRecordingDuration,
  logRecordingError,
  normalizeRecordingTags,
} from '../../../utils/recordingUtils';
import { cn } from '../../../utils/classNames';
import { TextShimmer } from '../../../components/ui/ShimmerText';
import { useRecordingTitleState } from '../../../hooks/useRecordingTitleState';
import { formatRecordingTimestamp, toRecordingTitleInput } from '../utils/RecordingsV2.utils';
import {
  LabelChip,
  SuggestedLabelChip,
} from '../../RecordingDetailV2Screen/components/RecordingLabelPicker';

export interface RecordingsV2PillProps {
  recording: Pick<
    OatsRecordingEntry,
    | 'id'
    | 'externalId'
    | 'title'
    | 'startedAt'
    | 'endedAt'
    | 'status'
    | 'aiSummary'
    | 'transcript'
    | 'createdByUserId'
    | 'labels'
    | 'channelId'
  >;
  creator: User | null;
  participantsLabel: string;
  tags?: string[];
  /** Still-pending suggestions (LLM or on-demand AUTOMATED) — rendered with inline confirm/reject. */
  suggestedTags?: string[];
  pendingLabelCount?: number;
  /** Resolves a tag value (Tag id) to its display text. Defaults to identity. */
  resolveLabel?: (label: string) => string;
  currentUserId?: string | undefined;
  onOpen: (recordingId: string) => void;
  onShare: (recording: RecordingsV2PillProps['recording']) => void;
  onDelete: (recording: RecordingsV2PillProps['recording']) => void;
}

export type RecordingsV2PillRecording = RecordingsV2PillProps['recording'];

export interface RecordingsV2LivePillProps {
  title?: string;
  startedAt: number;
  isPaused?: boolean;
  pauseStartedAt: number | null;
  accumulatedPausedMs: number;
  onOpenWindow?: () => void;
}

export const RecordingsV2LivePill = ({
  title,
  startedAt,
  isPaused = false,
  pauseStartedAt,
  accumulatedPausedMs,
  onOpenWindow,
}: RecordingsV2LivePillProps): ReactElement => {
  const [elapsedMs, setElapsedMs] = useState(() =>
    calculateRecordingElapsedMs(startedAt, pauseStartedAt, accumulatedPausedMs),
  );
  const normalizedTitle = title?.trim();
  const displayTitle =
    !normalizedTitle || normalizedTitle === 'Untitled Recording'
      ? 'Impromptu recording'
      : normalizedTitle;

  useEffect(() => {
    const updateElapsed = (): void => {
      setElapsedMs(calculateRecordingElapsedMs(startedAt, pauseStartedAt, accumulatedPausedMs));
    };

    updateElapsed();
    if (isPaused) return;

    const interval = window.setInterval(() => {
      updateElapsed();
    }, 1000);

    return (): void => window.clearInterval(interval);
  }, [accumulatedPausedMs, isPaused, pauseStartedAt, startedAt]);

  return (
    <section
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 shadow-sm',
        'transition-[border-color,box-shadow] duration-200 hover:border-primary/50 hover:shadow-[0_5px_20px_rgb(0,0,0,0.08)]',
      )}
      aria-label={`${displayTitle}, recording in progress`}
    >
      <span className='flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary'>
        <MicOn size={16} strokeWidth={2} variant='Contrast' />
      </span>

      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-semibold text-foreground'>{displayTitle}</span>
        <span className='mt-0.5 flex min-w-0 items-center gap-2 text-xs text-primary'>
          <span className='size-2 shrink-0 rounded-full bg-primary' aria-hidden='true' />
          <span>{isPaused ? 'Recording paused' : 'Recording in progress'}</span>
          <span aria-hidden='true'>·</span>
          <span className='font-mono tabular-nums'>{formatElapsedTime(elapsedMs)}</span>
        </span>
      </span>

      <Button
        type='button'
        variant='ghost'
        onClick={onOpenWindow}
        className='h-9 shrink-0 rounded-xl bg-foreground px-3 text-sm text-background hover:bg-foreground/90 hover:text-background'
        data-track-category='RecordingsV2'
        data-track-name='open_live_recording_window'
      >
        <span className='hidden sm:inline'>Open window</span>
        <ChevronRight size={16} />
      </Button>
    </section>
  );
};

const RecordingsV2Pill = ({
  recording,
  creator,
  participantsLabel,
  tags = [],
  suggestedTags = [],
  pendingLabelCount = 0,
  resolveLabel = (label: string) => label,
  currentUserId,
  onOpen,
  onShare,
  onDelete,
}: RecordingsV2PillProps): ReactElement => {
  const titleState = useRecordingTitleState(toRecordingTitleInput(recording));
  const durationMs = recording.endedAt
    ? Math.max(0, recording.endedAt - recording.startedAt)
    : null;
  const isOwner = currentUserId !== undefined && currentUserId === recording.createdByUserId;
  const visibleTags = normalizeRecordingTags(tags);
  const visibleSuggestedTags = isOwner ? normalizeRecordingTags(suggestedTags) : [];

  // Backfill for pre-Scribe recordings only — a channel anchor is what marks them.
  const showGenerateLabels =
    Boolean(recording.channelId) &&
    isOwner &&
    recording.labels.length === 0 &&
    Boolean(recording.transcript?.trim());
  const [menuOpen, setMenuOpen] = useState(false);

  // Populated on menu open — `hasRecording` isn't in the synced list data (it's
  // derived server-side from the call_recordings table)
  const [menuDetail, setMenuDetail] = useState<RecordingDetail | null>(null);
  const [isMenuDetailLoading, setIsMenuDetailLoading] = useState(false);

  const handleOpen = (): void => {
    onOpen(recording.externalId);
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpen();
    }
  };
  const handleMenuOpenChange = (open: boolean): void => {
    setMenuOpen(open);
    if (!open) return;
    setMenuDetail(null);
    setIsMenuDetailLoading(true);
    recordingService
      .getRecordingDetail(recording.externalId)
      .then(setMenuDetail)
      .catch(err => logRecordingError('RecordingsV2Pill.loadMenuDetail', err))
      .finally(() => setIsMenuDetailLoading(false));
  };
  const canDownloadTranscript = Boolean(recording.transcript);
  const canDownloadRecording = Boolean(menuDetail?.hasRecording);
  const [isDownloadingTranscript, setIsDownloadingTranscript] = useState(false);
  const [isDownloadingRecording, setIsDownloadingRecording] = useState(false);

  const handleDownloadTranscript = async (): Promise<void> => {
    if (!canDownloadTranscript || isDownloadingTranscript) return;
    setIsDownloadingTranscript(true);
    try {
      const detail =
        menuDetail ?? (await recordingService.getRecordingDetail(recording.externalId));
      if (!detail.transcript) {
        toast.error("Transcript isn't available right now");
        return;
      }
      const blob = new Blob([detail.transcript], { type: 'text/plain;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `${recording.title?.trim() || 'transcript'}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      logRecordingError('RecordingsV2Pill.downloadTranscript', err);
      toast.error('Failed to download transcript');
    } finally {
      setIsDownloadingTranscript(false);
    }
  };
  const handleDownloadRecording = async (): Promise<void> => {
    if (!canDownloadRecording || isDownloadingRecording) return;
    setIsDownloadingRecording(true);
    try {
      const blob = await recordingService.downloadRecordingBlob(recording.externalId);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `${recording.title?.trim() || recording.externalId}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      logRecordingError('RecordingsV2Pill.downloadRecording', err);
      toast.error('Failed to download recording');
    } finally {
      setIsDownloadingRecording(false);
    }
  };

  const [isGeneratingLabels, setIsGeneratingLabels] = useState(false);

  const handleGenerateLabels = async (event: MouseEvent): Promise<void> => {
    event.stopPropagation();
    if (isGeneratingLabels) return;
    setIsGeneratingLabels(true);
    try {
      const labelIds = await recordingService.generateLabels(recording.externalId);
      patchOatsRecordingLabels(recording.id, [...new Set([...recording.labels, ...labelIds])]);
    } catch (err) {
      logRecordingError('RecordingsV2Pill.generateLabels', err);
      toast.error('Failed to generate labels');
    } finally {
      setIsGeneratingLabels(false);
    }
  };

  // This list's suggestions are always on-demand generated, so a failed
  // confirm reverts straight back to AUTOMATED
  const handleConfirmSuggestion = async (labelId: string): Promise<void> => {
    try {
      await confirmRecordingLabelSuggestion(labelId, TagMethod.AUTOMATED);
    } catch (err) {
      logRecordingError('RecordingsV2Pill.confirmSuggestion', err);
      toast.error('Failed to confirm label');
    }
  };

  const applyLabelsChange = useApplyRecordingLabelsChange(labels =>
    patchOatsRecordingLabels(recording.id, labels),
  );

  const handleRejectSuggestion = async (labelId: string): Promise<void> => {
    const nextLabels = recording.labels.filter(id => id !== labelId);
    await applyLabelsChange(recording.externalId, nextLabels, 'RecordingsV2Pill.rejectSuggestion');
  };

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={handleRowKeyDown}
      className='group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      aria-label={
        titleState.kind === 'generating'
          ? 'Open recording — title is being generated'
          : `Open recording ${titleState.text}`
      }
      data-track-category='RecordingsV2'
      data-track-name='open_recording'
      data-track-metadata={JSON.stringify({ recordingId: recording.id })}
    >
      <div className='relative mt-0.5 shrink-0'>
        <span className='flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors duration-150 group-hover:bg-border group-hover:text-foreground'>
          <AudioLines size={20} strokeWidth={2.2} />
        </span>
        {creator && (
          <span className='absolute -bottom-1 -right-1 flex rounded-full bg-background p-0.5'>
            <Avatar
              userId={creator.id}
              size='sm'
              rounded
              showActiveStatus={false}
              className='ring-1 ring-background'
            />
          </span>
        )}
      </div>

      <span className='flex min-w-0 flex-1 flex-col gap-2'>
        <span className='flex min-w-0 items-start justify-between gap-4'>
          <span className='min-w-0 flex-1'>
            {titleState.kind === 'generating' ? (
              <TextShimmer
                as='span'
                glassEffect={false}
                className='shimmer-text-themed block truncate text-sm font-semibold'
              >
                Generating title…
              </TextShimmer>
            ) : (
              <span className='block truncate text-sm font-semibold text-foreground'>
                {titleState.text}
              </span>
            )}
            <span className='mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
              <span className='truncate'>{participantsLabel}</span>
              <span aria-hidden='true'>·</span>
              <span className='shrink-0'>{formatRecordingTimestamp(recording.startedAt)}</span>
            </span>
          </span>

          <span className='flex shrink-0 items-center gap-2 text-right font-mono text-xs leading-5 text-muted-foreground'>
            <span>{formatRecordingDuration(durationMs)}</span>
            <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
              <DropdownMenuTrigger asChild>
                <Button
                  type='button'
                  variant='ghost'
                  size='iconSm'
                  className={cn(
                    'shrink-0 rounded-xl size-8 bg-muted text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-border hover:text-foreground data-[state=open]:bg-border group-hover:opacity-100 group-has-[:focus-visible]:opacity-100',
                    menuOpen && 'opacity-100',
                  )}
                  onClick={event => event.stopPropagation()}
                  aria-label='Recording actions'
                  data-track-category='RecordingsV2'
                  data-track-name='open_recording_actions_menu'
                >
                  <ThreeDotsMenuHorizontal size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                className='w-48 rounded-xl'
                onClick={event => event.stopPropagation()}
              >
                {isOwner && (
                  <DropdownMenuItem
                    className='gap-2 rounded-lg'
                    onClick={() => onShare(recording)}
                    data-track-category='RecordingsV2'
                    data-track-name='share_recording'
                  >
                    <Share01 size={14} className='shrink-0' />
                    <span className='flex-1'>Share...</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className='gap-2 rounded-lg'
                  disabled={!canDownloadTranscript || isDownloadingTranscript}
                  onClick={() => void handleDownloadTranscript()}
                  data-track-category='RecordingsV2'
                  data-track-name='download_transcript'
                >
                  <DownloadBarDown size={16} className='shrink-0' />
                  <span className='flex-1'>Download transcript</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className='gap-2 rounded-lg'
                  disabled={isMenuDetailLoading || !canDownloadRecording || isDownloadingRecording}
                  onClick={() => void handleDownloadRecording()}
                  data-track-category='RecordingsV2'
                  data-track-name='download_recording'
                >
                  <MusicQuaverNote size={16} className='shrink-0' />
                  <span className='flex-1'>Download recording</span>
                </DropdownMenuItem>
                {isOwner && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className='gap-2 text-destructive focus:text-destructive  rounded-lg'
                      onClick={() => onDelete(recording)}
                      data-track-category='RecordingsV2'
                      data-track-name='delete_recording'
                    >
                      <DeleteDustbin02 size={16} className='shrink-0' />
                      <span className='flex-1'>Delete recording</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </span>

        {visibleTags.length > 0 || visibleSuggestedTags.length > 0 ? (
          <span className='flex flex-wrap items-center gap-1.5'>
            {visibleTags.map(tag => (
              <LabelChip key={tag} label={resolveLabel(tag)} />
            ))}
            {visibleSuggestedTags.map(tag => (
              <SuggestedLabelChip
                key={tag}
                label={resolveLabel(tag)}
                onConfirm={() => void handleConfirmSuggestion(tag)}
                onReject={() => void handleRejectSuggestion(tag)}
              />
            ))}
          </span>
        ) : pendingLabelCount > 0 ? (
          <span className='flex flex-wrap items-center gap-1.5'>
            {Array.from({ length: pendingLabelCount }, (_, index) => (
              <span key={index} className='h-6 w-14 animate-pulse rounded-lg bg-muted' />
            ))}
          </span>
        ) : (
          showGenerateLabels && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              loading={isGeneratingLabels}
              onClick={event => void handleGenerateLabels(event)}
              className='h-7 w-fit gap-1.5 rounded-lg border-dashed px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground'
              data-track-category='RecordingsV2'
              data-track-name='generate_recording_labels'
            >
              {!isGeneratingLabels && (
                <Ai01 size={14} variant='Duo Solid' className='shrink-0 text-primary' />
              )}
              {isGeneratingLabels ? 'Generating labels…' : 'Generate labels'}
            </Button>
          )
        )}
      </span>
    </div>
  );
};

export default RecordingsV2Pill;
