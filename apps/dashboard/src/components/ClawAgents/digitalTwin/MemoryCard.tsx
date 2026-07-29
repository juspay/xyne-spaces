import { ReactElement, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { MemoryBankMemory } from '@/services/claw/digitalTwinTypes';
import { CategoryBadge } from './CategoryBadge';
import { fmtRelative } from './format';

/** Long memories collapse to this many chars; user can expand inline. */
const MEMORY_TRUNCATE_AT = 240;

export const MemoryCard = ({
  memory,
  onDelete,
}: {
  memory: MemoryBankMemory;
  /** When provided, renders a delete button that calls back with the Hindsight id. */
  onDelete?: (hindsightMemoryId: string) => void;
}): ReactElement => {
  const [expanded, setExpanded] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const isLong = memory.content.length > MEMORY_TRUNCATE_AT;
  const visibleText =
    expanded || !isLong ? memory.content : memory.content.slice(0, MEMORY_TRUNCATE_AT) + '…';

  return (
    <div className='rounded-lg border border-border bg-muted/40 p-2.5'>
      <div className='flex items-start gap-2'>
        <div className='min-w-0 flex-1'>
          <p className='whitespace-pre-wrap text-xs text-foreground'>
            {visibleText}{' '}
            {isLong && (
              <button
                type='button'
                onClick={() => setExpanded(e => !e)}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin memory expand'
                className='text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline'
              >
                {expanded ? 'show less' : 'show more'}
              </button>
            )}
          </p>
          <div className='mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground'>
            <CategoryBadge category={memory.category} />
            {memory.recallHits7d > 0 && (
              <span>
                {memory.recallHits7d} recall{memory.recallHits7d !== 1 ? 's' : ''} (7d)
              </span>
            )}
            <span>created {fmtRelative(memory.createdAt)}</span>
            {memory.lastRecalledAt && (
              <span>· last recalled {fmtRelative(memory.lastRecalledAt)}</span>
            )}
            {memory.curatorReasoning && (
              <button
                type='button'
                onClick={() => setShowReasoning(s => !s)}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin memory curator reasoning'
                className='underline-offset-2 hover:text-foreground hover:underline'
              >
                {showReasoning ? 'hide curator' : 'why?'}
              </button>
            )}
          </div>
          {showReasoning && memory.curatorReasoning && (
            <div className='mt-1.5 rounded border border-border bg-card px-2 py-1.5 text-[11px] text-muted-foreground'>
              <span className='font-medium text-foreground'>Curator:</span>{' '}
              {memory.curatorReasoning}
              {memory.curatorConfidence !== null && (
                <span className='ml-1'>(confidence {memory.curatorConfidence.toFixed(2)})</span>
              )}
            </div>
          )}
        </div>
        {onDelete && (
          <button
            type='button'
            onClick={() => onDelete(memory.hindsightMemoryId)}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin delete memory'
            className='shrink-0 text-muted-foreground transition-colors hover:text-destructive'
            title='Delete memory'
            aria-label='Delete memory'
          >
            <Trash2 className='size-3.5' />
          </button>
        )}
      </div>
    </div>
  );
};
