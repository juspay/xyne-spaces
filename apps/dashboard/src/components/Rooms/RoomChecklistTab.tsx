import { ReactElement, memo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Clock, ListChecks, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { RoomRecapStatus, type RoomRecap } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { MarkdownMessageRenderer } from '../ui/MessageBubble/MarkdownMessageRenderer';
import { cn } from '../../utils/classNames';
import { RecapTombstone } from './RecapTombstone';
import { formatUpdatedAt } from './Rooms.utils';
import { useRecapMarkdown } from './useRecapMarkdown';

interface ChecklistCardProps {
  recap: RoomRecap;
  index: number;
  isOwner: boolean;
}

const ChecklistCard = memo(function ChecklistCard({
  recap,
  index,
  isOwner,
}: ChecklistCardProps): ReactElement {
  const zero = useZero();
  const [isBusy, setIsBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(recap.body);
  const { content, markdownComponents } = useRecapMarkdown(recap);

  const isPending = recap.status === RoomRecapStatus.PENDING;
  const canEdit = isOwner && isPending;

  const approve = async (): Promise<void> => {
    setIsBusy(true);
    const result = zero.mutate(
      mutators.room.approveRecap({ recapId: recap.id, timestamp: Date.now() }),
    );
    const res = await result.server;
    setIsBusy(false);
    if (res.type === 'error') {
      toast.error('Could not approve checklist', { description: res.error.message });
      return;
    }
    toast.success('Checklist approved', { description: 'Members can now see it.' });
  };

  const remove = async (): Promise<void> => {
    setConfirmDelete(false);
    const result = zero.mutate(
      mutators.room.deleteRecap({ recapId: recap.id, timestamp: Date.now() }),
    );
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Could not delete checklist', { description: res.error.message });
      return;
    }
    toast.success('Checklist deleted');
  };

  const startEdit = (): void => {
    setDraft(recap.body);
    setIsEditing(true);
  };

  const cancelEdit = (): void => {
    setIsEditing(false);
    setDraft(recap.body);
  };

  const save = async (): Promise<void> => {
    const body = draft.trim();
    if (!body) {
      toast.error('A checklist cannot be empty');
      return;
    }
    if (body === recap.body) {
      setIsEditing(false);
      return;
    }
    setIsBusy(true);
    const result = zero.mutate(
      mutators.room.editRecapBody({ recapId: recap.id, body, timestamp: Date.now() }),
    );
    const res = await result.server;
    setIsBusy(false);
    if (res.type === 'error') {
      toast.error('Could not save checklist', { description: res.error.message });
      return;
    }
    setIsEditing(false);
    toast.success('Checklist updated');
  };

  return (
    <article
      data-testid={`room-checklist-${recap.id}`}
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
        {isOwner && !isEditing && (
          <span className='ml-auto flex items-center gap-1'>
            {canEdit && (
              <Button
                variant='ghost'
                size='sm'
                aria-label='Edit checklist'
                onClick={startEdit}
                disabled={isBusy}
                data-track-category='Rooms'
                data-track-name='EditRoomChecklist'
                data-testid='edit-checklist'
              >
                <Pencil size={14} />
              </Button>
            )}
            {isPending && (
              <Button
                size='sm'
                onClick={() => void approve()}
                disabled={isBusy}
                data-track-category='Rooms'
                data-track-name='ApproveRoomChecklist'
                data-testid='approve-checklist'
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
                  data-testid='confirm-delete-checklist'
                >
                  Delete
                </Button>
              </>
            ) : (
              <Button
                variant='ghost'
                size='sm'
                aria-label='Delete checklist'
                onClick={() => setConfirmDelete(true)}
                data-track-category='Rooms'
                data-track-name='DeleteRoomChecklist'
                data-testid='delete-checklist'
              >
                <Trash2 size={14} />
              </Button>
            )}
          </span>
        )}
      </div>

      {isEditing ? (
        <div className='flex flex-col gap-3'>
          <Textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            className='min-h-[240px] font-mono text-xs leading-relaxed'
            aria-label='Edit checklist markdown'
            data-testid='checklist-editor'
            autoFocus
          />
          <p className='text-xs text-muted-foreground'>
            Markdown. Use ✅ done, 🚧 in progress, ⬜ not started, ⛔ blocked at the start of each
            item.
          </p>
          <div className='flex items-center justify-end gap-2'>
            <Button variant='ghost' size='sm' onClick={cancelEdit} disabled={isBusy}>
              <X size={14} />
              Cancel
            </Button>
            <Button
              size='sm'
              onClick={() => void save()}
              disabled={isBusy}
              data-testid='save-checklist'
            >
              {isBusy ? <Loader2 size={14} className='animate-spin' /> : <Check size={14} />}
              Save
            </Button>
          </div>
        </div>
      ) : (
        <MarkdownMessageRenderer content={content} markdownComponents={markdownComponents} />
      )}
    </article>
  );
});

interface RoomChecklistTabProps {
  recaps: readonly RoomRecap[];
  recapsLoading: boolean;
  hasMoreRecaps: boolean;
  isLoadingMoreRecaps: boolean;
  onLoadMoreRecaps: () => void;
  isOwner: boolean;
  hasChecklistTemplate: boolean;
}

export function RoomChecklistTab({
  recaps,
  recapsLoading,
  hasMoreRecaps,
  isLoadingMoreRecaps,
  onLoadMoreRecaps,
  isOwner,
  hasChecklistTemplate,
}: RoomChecklistTabProps): ReactElement {
  return (
    <div data-slot='room-checklist-tab' className='flex flex-col gap-4'>
      <p className='text-sm text-muted-foreground [text-wrap:pretty]'>
        What this room is tracking toward, updated each curation run — newest first.
      </p>

      {recapsLoading ? (
        <div className='flex flex-col gap-4'>
          {[0, 1].map(i => (
            <div key={i} className='h-40 animate-pulse rounded-2xl bg-muted' />
          ))}
        </div>
      ) : recaps.length === 0 ? (
        <div className='rounded-2xl border border-dashed border-border p-10 text-center'>
          <ListChecks size={20} className='mx-auto mb-2 text-muted-foreground' />
          <p className='text-sm font-medium text-foreground'>No checklist yet</p>
          <p className='mt-1 text-xs text-muted-foreground [text-wrap:pretty]'>
            {hasChecklistTemplate
              ? 'Run curation from the Summary tab to generate the first checklist.'
              : 'No checklist defined yet — add your points in Settings so the agent can track them.'}
          </p>
        </div>
      ) : (
        <div className='flex flex-col gap-4'>
          {recaps.map((recap, index) =>
            recap.deletedAt ? (
              <RecapTombstone key={recap.id} kind='checklist' deletedAt={recap.deletedAt} />
            ) : (
              <ChecklistCard key={recap.id} recap={recap} index={index} isOwner={isOwner} />
            ),
          )}
          {hasMoreRecaps && (
            <Button
              variant='outline'
              className='self-center'
              onClick={onLoadMoreRecaps}
              disabled={isLoadingMoreRecaps}
              data-track-category='Rooms'
              data-track-name='LoadMoreRoomChecklists'
              data-testid='load-more-checklists'
            >
              {isLoadingMoreRecaps && <Loader2 size={14} className='animate-spin' />}
              {isLoadingMoreRecaps ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
