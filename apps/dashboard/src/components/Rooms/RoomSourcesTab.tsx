import { ReactElement, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { Hash, Link2, Plus, Trash2 } from 'lucide-react';
import { RoomSourceType, type RoomSource } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { useChannel, useSearchChannelCandidates } from '../../hooks/useChannels';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { SearchChannel, type SearchChannelItem } from '../ui/SearchChannel/SearchChannel';

interface RoomSourceRowProps {
  source: RoomSource;
  canManage: boolean;
}

function RoomSourceRow({ source, canManage }: RoomSourceRowProps): ReactElement {
  const zero = useZero();
  const channel = useChannel(source.sourceId);
  const label = channel?.name ?? source.label;

  const handleRemove = async (): Promise<void> => {
    const result = zero.mutate(mutators.room.removeSource({ id: source.id }));
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Could not remove source', { description: res.error.message });
    }
  };

  return (
    <div
      data-testid={`room-source-row-${source.id}`}
      className='flex items-center gap-3 py-2.5 border-t border-border first:border-t-0'
    >
      <span className='size-8 rounded-lg bg-muted text-muted-foreground inline-flex items-center justify-center shrink-0'>
        <Hash size={15} />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='text-sm font-medium text-foreground truncate'>{label}</p>
        <p className='text-xs text-muted-foreground'>Channel</p>
      </div>
      {canManage && (
        <Button
          variant='ghost'
          size='sm'
          onClick={() => void handleRemove()}
          aria-label='Remove source'
          data-testid='remove-source'
        >
          <Trash2 size={15} />
        </Button>
      )}
    </div>
  );
}

interface RoomSourcesTabProps {
  roomId: string;
  sources: readonly RoomSource[];
  canManage: boolean;
}

export function RoomSourcesTab({ roomId, sources, canManage }: RoomSourcesTabProps): ReactElement {
  const zero = useZero();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [channelsToAdd, setChannelsToAdd] = useState<SearchChannelItem[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  const channelCandidates = useSearchChannelCandidates();

  const attachedChannelIds = useMemo(() => sources.map(source => source.sourceId), [sources]);

  const handleOpenAddDialog = (): void => {
    setShowAddDialog(true);
  };

  const handleCloseAddDialog = (): void => {
    setShowAddDialog(false);
    setChannelsToAdd([]);
  };

  const handleAddSources = async (): Promise<void> => {
    if (channelsToAdd.length === 0 || isAdding) return;
    setIsAdding(true);
    for (const channel of channelsToAdd) {
      const result = zero.mutate(
        mutators.room.addSource({
          id: uuidv4(),
          roomId,
          sourceType: RoomSourceType.CHANNEL,
          sourceId: channel.id,
          label: channel.name,
          timestamp: Date.now(),
        }),
      );
      const res = await result.server;
      if (res.type === 'error') {
        toast.error(`Could not add #${channel.name}`, { description: res.error.message });
      }
    }
    setIsAdding(false);
    handleCloseAddDialog();
  };

  return (
    <div data-slot='room-sources-tab' className='flex flex-col gap-6'>
      <div className='flex items-center justify-between'>
        <p className='text-sm text-muted-foreground [text-wrap:pretty]'>
          Sources feed this room&apos;s summaries. Only content the room owner can access is used.
        </p>
        {canManage && (
          <Button
            onClick={handleOpenAddDialog}
            data-track-category='Rooms'
            data-track-name='AddRoomSource'
            data-testid='add-room-source'
          >
            <Plus size={16} />
            Add source
          </Button>
        )}
      </div>

      <section className='rounded-2xl border border-border bg-background p-4'>
        {sources.map(source => (
          <RoomSourceRow key={source.id} source={source} canManage={canManage} />
        ))}
        {sources.length === 0 && (
          <div className='flex flex-col items-center gap-2 py-8 text-center'>
            <Link2 size={20} className='text-muted-foreground' />
            <p className='text-sm font-medium text-foreground'>No sources yet</p>
            <p className='text-xs text-muted-foreground [text-wrap:pretty]'>
              Add channels to give this room something to track.
            </p>
          </div>
        )}
      </section>

      <Dialog
        open={showAddDialog}
        onOpenChange={handleCloseAddDialog}
        title='Add sources'
        description='Pick channels to feed this room.'
        testId='add-room-source-dialog'
      >
        <header className='border-b border-border px-5 py-4'>
          <h2 className='text-base font-semibold text-foreground'>Add sources</h2>
          <p className='mt-0.5 text-xs text-muted-foreground [text-wrap:pretty]'>
            Pick channels to feed this room&apos;s summaries.
          </p>
        </header>
        <div className='flex flex-col gap-4 p-5'>
          <SearchChannel
            channels={channelCandidates}
            mode='channel'
            excludeChannelIds={attachedChannelIds}
            selectedChannels={channelsToAdd}
            onChannelsChange={setChannelsToAdd}
            placeholder='Search channels to add...'
          />
          <div className='flex items-center justify-end gap-2'>
            <Button variant='ghost' onClick={handleCloseAddDialog}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAddSources()}
              disabled={channelsToAdd.length === 0 || isAdding}
              data-testid='confirm-add-sources'
            >
              {isAdding ? 'Adding…' : `Add ${channelsToAdd.length || ''}`.trim()}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
