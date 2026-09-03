import { PencilEditAi } from '@xyne/icons';
import type { ReactElement } from 'react';
import { cn } from '../../../utils/classNames';
import { Tooltip } from '../../ui/Tooltip';
import { useTwinDraftBadge } from './TwinDraftBadgeContext';

export function TwinDraftIndicator({
  conversationId,
  className,
}: {
  conversationId?: string | undefined;
  className?: string;
}): ReactElement | null {
  const badge = useTwinDraftBadge(conversationId);
  if (!badge) return null;

  const label = badge.action === 'react' ? 'Twin reaction' : 'Twin draft';
  return (
    <Tooltip
      content='The Digital Twin drafted a response for you — open the thread to review it'
      side='top'
    >
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground',
          className,
        )}
      >
        <PencilEditAi size={9} className='shrink-0' />
        {label}
      </span>
    </Tooltip>
  );
}
