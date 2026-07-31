import { Sparkles } from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from '../../../utils/classNames';
import { useTwinDraftBadge } from './TwinDraftBadgeContext';

/**
 * A small, neutral "Twin draft" pill shown on a thread row when the caller has a
 * pending Digital Twin draft for it. Reads the badge from context (no props to
 * drill through the message list). Renders nothing when there's no draft. Theme
 * tokens only — no accent colour.
 */
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
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground',
        className,
      )}
      title='The Digital Twin drafted a response for you — open the thread to review it'
    >
      <Sparkles size={9} className='shrink-0' />
      {label}
    </span>
  );
}
