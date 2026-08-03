import { ReactElement, memo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Clock, Hash, Loader2, RotateCw, Sparkles, Trash2 } from 'lucide-react';
import { RoomRecapStatus, type Room, type RoomRecap, type RoomSource } from '@xyne/shared';
import { apiInstance } from '../../services/clients/apiClient';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { Button } from '../ui/Button';
import { MarkdownMessageRenderer } from '../ui/MessageBubble/MarkdownMessageRenderer';
import { cn } from '../../utils/classNames';
import { RecapTombstone } from './RecapTombstone';
import { formatUpdatedAt } from './Rooms.utils';
import { useRecapMarkdown } from './useRecapMarkdown';

interface RecapCardProps {
  recap: RoomRecap;
  index: number;
  isOwner: boolean;
}

const RecapCard = memo(function RecapCard({ recap, index, isOwner }: RecapCardProps): ReactElement {
  const zero = useZero();
  const [isBusy, setIsBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { content, markdownComponents } = useRecapMarkdown(recap);

  const isPending = recap.status === RoomRecapStatus.PENDING;

  const approve = async (): Promise<void> => {
    setIsBusy(true);
    const result = zero.mutate(
      mutators.room.approveRecap({ recapId: recap.id, timestamp: Date.now() }),
    );
    const res = await result.server;
    setIsBusy(false);
    if (res.type === 'error') {
      toast.error('Could not approve recap', { description: res.error.message });
      return;
    }
    toast.success('Recap approved', { description: 'Members can now see it.' });
  };

  const remove = async (): Promise<void> => {
    setConfirmDelete(false);
    const result = zero.mutate(
      mutators.room.deleteRecap({ recapId: recap.id, timestamp: Date.now() }),
    );
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Could not delete recap', { description: res.error.message });
      return;
    }
    toast.success('Recap deleted');
  };

  return (
    <article
      data-testid={`room-recap-${recap.id}`}
      className={cn(
        'rounded-2xl border bg-background p-5',
        isPending ? 'border-primary/40' : 'border-border',
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 motion-safe:fill-mode-backwards',
      )}
      style={{ animationDelay: `${Math.min(index, 4) * 60}ms` }}
    >
      <div className='mb-3 flex flex-wrap items-center gap-2'>
        <span className='text-xs font-medium tabular-nums text-muted-foreground'>
          {formatUpdatedAt(recap.createdAt)}
        </span>
        {isOwner &&
          (isPending ? (
            <span className='inline-flex items-center gap-1 rounded-full border border-primary/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary'>
              <Clock size={10} />
              Pending approval
            </span>
          ) : (
            <span className='inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground'>
              <Check size={10} />
              Approved
            </span>
          ))}
        {isOwner && (
          <span className='ml-auto flex items-center gap-1'>
            {isPending && (
              <Button
                size='sm'
                onClick={() => void approve()}
                disabled={isBusy}
                data-track-category='Rooms'
                data-track-name='ApproveRoomRecap'
                data-testid='approve-recap'
              >
                {isBusy ? <Loader2 size={14} className='animate-spin' /> : <Check size={14} />}
                Approve
              </Button>
            )}
            {confirmDelete ? (
              <>
                <span className='text-xs text-muted-foreground'>Delete?</span>
                <Button variant='ghost' size='sm' onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button
                  variant='destructive'
                  size='sm'
                  onClick={() => void remove()}
                  data-testid='confirm-delete-recap'
                >
                  Delete
                </Button>
              </>
            ) : (
              <Button
                variant='ghost'
                size='sm'
                aria-label='Delete recap'
                onClick={() => setConfirmDelete(true)}
                data-track-category='Rooms'
                data-track-name='DeleteRoomRecap'
                data-testid='delete-recap'
              >
                <Trash2 size={14} />
              </Button>
            )}
          </span>
        )}
      </div>
      <MarkdownMessageRenderer content={content} markdownComponents={markdownComponents} />
    </article>
  );
});

interface RoomSummaryTabProps {
  room: Room;
  recaps: readonly RoomRecap[];
  recapsLoading: boolean;
  hasMoreRecaps: boolean;
  isLoadingMoreRecaps: boolean;
  onLoadMoreRecaps: () => void;
  sources: readonly RoomSource[];
  isOwner: boolean;
}

export function RoomSummaryTab({
  room,
  recaps,
  recapsLoading,
  hasMoreRecaps,
  isLoadingMoreRecaps,
  onLoadMoreRecaps,
  sources,
  isOwner,
}: RoomSummaryTabProps): ReactElement {
  const [isRequestingCuration, setIsRequestingCuration] = useState(false);

  const liveRecaps = recaps.filter(recap => !recap.deletedAt);
  const hasRecaps = liveRecaps.length > 0;

  const requestCuration = async (): Promise<void> => {
    if (isRequestingCuration) return;
    setIsRequestingCuration(true);
    try {
      const response = await apiInstance.post<{ queued: boolean }>(`/rooms/${room.id}/curate`);
      if (response.data?.queued === false) {
        toast.info('Curation is already running', {
          description: 'The recap will appear here as soon as it finishes.',
        });
        return;
      }
      toast.success(hasRecaps ? 'Re-run started' : 'Curation started', {
        description: 'A new recap will appear here once the agent finishes.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      toast.error('Could not start curation', { description: message });
    } finally {
      setIsRequestingCuration(false);
    }
  };

  return (
    <div
      data-slot='room-summary-tab'
      className='grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start'
    >
      <div className='flex flex-col gap-4'>
        <div className='flex items-center justify-between gap-4'>
          <p className='text-sm text-muted-foreground tabular-nums'>
            {hasRecaps
              ? `Last curated ${formatUpdatedAt(liveRecaps[0]!.createdAt)}.`
              : 'Run the curation agent to generate a briefing.'}
          </p>
          {isOwner && (
            <Button
              onClick={() => void requestCuration()}
              disabled={isRequestingCuration || sources.length === 0}
              title={sources.length === 0 ? 'Add at least one source before curating' : undefined}
              data-track-category='Rooms'
              data-track-name='CurateNow'
              data-testid='curate-now'
            >
              {isRequestingCuration ? (
                <Loader2 size={15} className='animate-spin' />
              ) : hasRecaps ? (
                <RotateCw size={15} />
              ) : (
                <Sparkles size={15} />
              )}
              {isRequestingCuration ? 'Starting…' : hasRecaps ? 'Re-run curation' : 'Curate now'}
            </Button>
          )}
        </div>

        {recapsLoading ? (
          <div className='flex flex-col gap-4'>
            {[0, 1].map(i => (
              <div key={i} className='h-40 animate-pulse rounded-2xl bg-muted' />
            ))}
          </div>
        ) : recaps.length === 0 ? (
          <div className='rounded-2xl border border-dashed border-border p-10 text-center'>
            <Sparkles size={20} className='mx-auto mb-2 text-muted-foreground' />
            <p className='text-sm font-medium text-foreground'>No recaps yet</p>
            <p className='mt-1 text-xs text-muted-foreground [text-wrap:pretty]'>
              {sources.length === 0
                ? 'Add sources first, then run the curation agent.'
                : 'Run “Curate now” to generate the first briefing.'}
            </p>
          </div>
        ) : (
          <div className='flex flex-col gap-4'>
            {recaps.map((recap, index) =>
              recap.deletedAt ? (
                <RecapTombstone key={recap.id} kind='summary' deletedAt={recap.deletedAt} />
              ) : (
                <RecapCard key={recap.id} recap={recap} index={index} isOwner={isOwner} />
              ),
            )}
            {hasMoreRecaps && (
              <Button
                variant='outline'
                className='self-center'
                onClick={onLoadMoreRecaps}
                disabled={isLoadingMoreRecaps}
                data-track-category='Rooms'
                data-track-name='LoadMoreRoomRecaps'
                data-testid='load-more-recaps'
              >
                {isLoadingMoreRecaps && <Loader2 size={14} className='animate-spin' />}
                {isLoadingMoreRecaps ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        )}
      </div>

      <aside className='flex flex-col gap-4'>
        <section className='rounded-2xl border border-border bg-background p-4'>
          <div className='flex items-center gap-2 text-sm'>
            <Hash size={14} className='text-muted-foreground' />
            <span className='flex-1 text-foreground'>Channels</span>
            <span className='text-xs tabular-nums text-muted-foreground'>{sources.length}</span>
          </div>
        </section>
      </aside>
    </div>
  );
}
