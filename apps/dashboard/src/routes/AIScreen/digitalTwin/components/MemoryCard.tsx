import { ReactElement, useState } from 'react';
import { DeleteDustbin01 } from '@xyne/icons';
import { Button } from '@/components/ui/Button/index';
import Tooltip from '@/components/ui/Tooltip';
import { TruncatedTooltip } from '@/components/ui/Tooltip/TruncatedTooltip';
import { HighlightMatch } from '@/routes/AIScreen/library/admin/components/HighlightMatch';
import type { MemoryBankMemory } from '@/services/claw/digitalTwinTypes';
import { CategoryBadge } from './CategoryBadge';
import { MetaRow } from '@/routes/AIScreen/library/shared/primitives/MetaRow';
import { formatRelativeTime } from '@/utils/dateUtils';

export const MemoryCard = ({
  memory,
  onDelete,
  query = '',
}: {
  memory: MemoryBankMemory;
  onDelete?: (hindsightMemoryId: string) => void;
  query?: string;
}): ReactElement => {
  const [showReasoning, setShowReasoning] = useState(false);

  return (
    <li className='flex flex-col gap-1 border-b border-border px-1 py-4'>
      <div className='flex items-center justify-between gap-3'>
        <TruncatedTooltip content={memory.content}>
          <p className='min-w-0 flex-1 truncate text-sm text-foreground'>
            <HighlightMatch text={memory.content} query={query} />
          </p>
        </TruncatedTooltip>
        {onDelete && (
          <Tooltip content='Delete memory' side='top'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              onClick={() => onDelete(memory.hindsightMemoryId)}
              aria-label='Delete memory'
              data-track-category='Claw Agents'
              data-track-name='Digital Twin delete memory'
              className='shrink-0 text-muted-foreground hover:text-destructive focus-visible:bg-muted focus-visible:ring-0'
            >
              <DeleteDustbin01 className='size-4' aria-hidden />
            </Button>
          </Tooltip>
        )}
      </div>

      <MetaRow
        badge={<CategoryBadge category={memory.category} />}
        items={[
          memory.recallHits7d > 0 && (
            <span key='recalls'>
              {memory.recallHits7d} recall{memory.recallHits7d !== 1 ? 's' : ''} (7d)
            </span>
          ),
          <span key='created'>created {formatRelativeTime(new Date(memory.createdAt))}</span>,
          memory.lastRecalledAt && (
            <span key='recalled'>
              last recalled {formatRelativeTime(new Date(memory.lastRecalledAt))}
            </span>
          ),
          memory.curatorReasoning && (
            <button
              key='curator'
              type='button'
              onClick={() => setShowReasoning(s => !s)}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin memory curator reasoning'
              className='underline-offset-2 hover:text-foreground hover:underline'
            >
              {showReasoning ? 'hide curator' : 'why?'}
            </button>
          ),
        ]}
      />

      {showReasoning && memory.curatorReasoning && (
        <div className='mt-1 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground'>
          <span className='font-medium text-foreground'>Curator:</span> {memory.curatorReasoning}
          {memory.curatorConfidence !== null && (
            <span className='ml-1'>(confidence {memory.curatorConfidence.toFixed(2)})</span>
          )}
        </div>
      )}
    </li>
  );
};
