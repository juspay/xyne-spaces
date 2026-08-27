import { JSX } from 'react';
import { UserPlus } from 'lucide-react';
import type { VocabularyEntry } from '../../../api/threadTypeVocabularyApi';
import { useUser } from '../../../hooks/useUsers';
import { cn } from '../../../utils/classNames';
import { tagReviewAlignClass, tagReviewGridTemplate } from './tagReviewColumns';

interface TagReviewRowProps {
  entry: VocabularyEntry;
  isSelected: boolean;
  onSelect: (name: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Turned down',
};

const relative = (at: number | null | undefined): string => {
  if (!at) return '—';
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

export const TagReviewRow = ({ entry, isSelected, onSelect }: TagReviewRowProps): JSX.Element => {
  const proposer = useUser(entry.createdBy ?? '');
  // Undefined means counting FAILED, which is not the same as zero — the server omits the
  // field entirely rather than send zeros it does not believe.
  const total = entry.threadCount;
  const counted = typeof total === 'number';

  const cell = (key: string, children: JSX.Element | string): JSX.Element => (
    <div key={key} className={cn('flex min-w-0 items-center', tagReviewAlignClass(key as never))}>
      {typeof children === 'string' ? (
        <span className='min-w-0 truncate'>{children}</span>
      ) : (
        children
      )}
    </div>
  );

  return (
    <div
      role='row'
      tabIndex={0}
      onClick={() => onSelect(entry.name)}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(entry.name);
      }}
      data-track-category='TagReview'
      data-track-name='SelectTag'
      className={cn(
        'grid items-center gap-x-3 px-6 py-3 border-b border-border last:border-b-0 w-full',
        'cursor-pointer transition-colors text-sm',
        isSelected ? 'bg-primary/10' : 'hover:bg-muted/50',
      )}
      style={{ gridTemplateColumns: tagReviewGridTemplate(false) }}
    >
      {cell(
        'tag',
        <div className='flex min-w-0 flex-col gap-0.5'>
          <div className='flex min-w-0 items-center gap-2'>
            {/* Mono because the name is an identifier the admin is about to rename, not prose. */}
            <span className='min-w-0 truncate font-mono text-[13px] text-foreground'>
              {entry.name}
            </span>
          </div>
          {/* The proposer's note. It is the only thing an admin has to judge on, so it gets a
              line of its own rather than a tooltip. */}
          {entry.description ? (
            <span className='min-w-0 truncate text-xs text-muted-foreground'>
              {entry.description}
            </span>
          ) : (
            <span className='text-xs italic text-muted-foreground/60'>No note given</span>
          )}
        </div>,
      )}

      {cell(
        'threads',
        counted ? (
          <span className='rounded-full bg-muted px-2 py-px text-xs text-muted-foreground'>
            {total}
          </span>
        ) : (
          <span className='text-xs text-muted-foreground/60' title='Thread counts are unavailable'>
            —
          </span>
        ),
      )}

      {cell('proposedBy', proposer?.name ?? (entry.createdBy ? 'Someone' : '—'))}
      {cell(
        'status',
        <span className='text-xs text-muted-foreground'>
          {STATUS_LABEL[entry.status ?? 'APPROVED'] ?? entry.status}
        </span>,
      )}
      {cell('proposed', relative(entry.proposedAt))}
      {cell(
        'lastUsed',
        !counted ? (
          <span className='text-xs text-muted-foreground/60'>—</span>
        ) : total === 0 ? (
          <span className='flex items-center gap-1 text-xs text-muted-foreground/60'>
            <UserPlus className='size-3' />
            Unused
          </span>
        ) : (
          <span className='text-xs text-muted-foreground'>{relative(entry.lastUsedAt)}</span>
        ),
      )}
    </div>
  );
};
