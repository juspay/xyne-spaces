import { useState, type ReactElement, type ReactNode } from 'react';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { McpLogo } from '../create-v2/mcp/McpLogo';
import { DetailCard, DetailEmpty } from './DetailPrimitives';

const VISIBLE = 5;

export interface DetailListItem {
  key: string;
  name: string;
  description: string;
  iconType?: string;
  badge?: ReactNode;
  meta?: string;
}

export function DetailListRow({
  item,
  canEdit,
  removeLabel,
  onRemove,
}: {
  item: DetailListItem;
  canEdit: boolean;
  removeLabel: string;
  onRemove: () => void;
}): ReactElement {
  return (
    <div className='flex w-full items-center gap-3 border-b border-border p-4 last:border-b-0'>
      {item.iconType !== undefined && <McpLogo type={item.iconType} name={item.name} size='md' />}

      <div className='flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden'>
        <span className='flex min-w-0 items-center gap-1.5'>
          <span className='truncate text-sm font-medium leading-[22px] text-foreground'>
            {item.name}
          </span>
          {item.badge}
        </span>
        <span className='truncate text-sm leading-5 text-foreground/60'>
          {item.description || 'No description added'}
        </span>
      </div>

      {item.meta && (
        <span className='shrink-0 whitespace-nowrap text-xs leading-4 text-muted-foreground'>
          {item.meta}
        </span>
      )}

      {canEdit && (
        <button
          type='button'
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: remove list item'
          className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <MultipleCrossCancelDefault className='size-4' aria-hidden />
        </button>
      )}
    </div>
  );
}

interface DetailListCardProps {
  items: readonly DetailListItem[];
  loading: boolean;
  emptyLabel: string;
  canEdit: boolean;
  removeLabel: (item: DetailListItem) => string;
  onRemove: (item: DetailListItem) => void;
  /** Rendered above the rows — the read-only note when the user can't edit. */
  note?: ReactElement | null;
  /** Extra rows rendered above the list, e.g. a section's settings. */
  children?: ReactNode;
}

export function DetailListCard({
  items,
  loading,
  emptyLabel,
  canEdit,
  removeLabel,
  onRemove,
  note = null,
  children,
}: DetailListCardProps): ReactElement {
  const [expanded, setExpanded] = useState(false);

  const hidden = Math.max(0, items.length - VISIBLE);
  const shown = expanded ? items : items.slice(0, VISIBLE);

  return (
    <DetailCard>
      {note}
      {children}

      {loading ? (
        <div className='flex w-full flex-col'>
          {[0, 1, 2].map(row => (
            <div
              key={row}
              className='flex items-center gap-3 border-b border-border p-4 last:border-b-0'
            >
              <Skeleton className='size-10 shrink-0 rounded-lg' />
              <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                <Skeleton className='h-3.5 w-32' />
                <Skeleton className='h-3 w-full max-w-72' />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <DetailEmpty>{emptyLabel}</DetailEmpty>
      ) : (
        <div className='flex w-full flex-col'>
          {shown.map(item => (
            <DetailListRow
              key={item.key}
              item={item}
              canEdit={canEdit}
              removeLabel={removeLabel(item)}
              onRemove={() => onRemove(item)}
            />
          ))}
        </div>
      )}

      {hidden > 0 && (
        <button
          type='button'
          onClick={() => setExpanded(open => !open)}
          aria-expanded={expanded}
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: expand list'
          className='flex w-full items-center border-t border-border bg-muted/40 px-4 py-3 text-sm leading-5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground'
        >
          {expanded ? 'Show less' : `View ${hidden} other${hidden === 1 ? '' : 's'}`}
        </button>
      )}
    </DetailCard>
  );
}
