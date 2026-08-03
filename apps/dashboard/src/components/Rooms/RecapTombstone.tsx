import { ReactElement } from 'react';
import { Trash2 } from 'lucide-react';
import { formatUpdatedAt } from './Rooms.utils';

interface RecapTombstoneProps {
  kind: 'summary' | 'checklist';
  deletedAt: number;
}

export function RecapTombstone({ kind, deletedAt }: RecapTombstoneProps): ReactElement {
  return (
    <div
      data-testid={`recap-tombstone-${kind}`}
      className='flex items-center gap-2.5 rounded-2xl border border-dashed border-border bg-muted/40 px-5 py-4 text-sm text-muted-foreground'
    >
      <Trash2 size={15} className='shrink-0' />
      <span>
        This {kind} was deleted
        <span className='tabular-nums'> · {formatUpdatedAt(deletedAt)}</span>
      </span>
    </div>
  );
}
