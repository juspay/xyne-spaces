import { ReactElement } from 'react';
import { Loader2, X } from 'lucide-react';
import { useClawDigitalTwinMemories } from '@/hooks/useClawDigitalTwin';
import { MemoryCard } from './MemoryCard';

export const SubsystemMemoriesPanel = ({
  subsystem,
  onClose,
}: {
  subsystem: string;
  onClose: () => void;
}): ReactElement => {
  const { data, isLoading, isError, error } = useClawDigitalTwinMemories({ limit: 200, subsystem });
  const memories = data?.memories;

  return (
    <div className='flex h-full flex-col rounded-lg border border-primary/40 bg-card'>
      <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
        <span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
          Subsystem
        </span>
        <span className='font-mono text-xs font-semibold text-primary'>{subsystem}</span>
        {memories && (
          <span className='text-xs text-muted-foreground'>
            · {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
          </span>
        )}
        <button
          type='button'
          onClick={onClose}
          data-track-category='Claw Agents'
          data-track-name='Digital Twin close subsystem panel'
          aria-label='Close subsystem panel'
          className='ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <X className='size-3.5' />
        </button>
      </div>
      <div className='flex flex-1 flex-col gap-1.5 overflow-y-auto p-3'>
        {isLoading && (
          <div className='flex items-center gap-2 py-3 text-xs text-muted-foreground'>
            <Loader2 className='size-3.5 animate-spin' />
            Loading…
          </div>
        )}
        {isError && (
          <div className='rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive'>
            {error instanceof Error ? error.message : 'Failed to load memories'}
          </div>
        )}
        {memories && memories.length === 0 && (
          <p className='py-3 text-center text-xs text-muted-foreground'>
            No memories tagged{' '}
            <span className='font-mono text-foreground'>subsystem:{subsystem}</span>
          </p>
        )}
        {memories?.map(m => (
          <MemoryCard key={m.hindsightMemoryId} memory={m} />
        ))}
      </div>
    </div>
  );
};
