import { type CSSProperties, type ReactElement } from 'react';
import { MentionText } from '@/components/ui/MentionText/MentionText';
import { cn } from '@/utils/classNames';

interface PersonPillProps {
  userId?: string | null | undefined;
  name: string;
  className?: string | undefined;
}

/* eslint-disable @typescript-eslint/naming-convention */
const NO_HOVER_SHIFT = {
  '--mention-hover-color': 'var(--mention-color)',
} as CSSProperties;
/* eslint-enable @typescript-eslint/naming-convention */

export function PersonPill({ userId, name, className }: PersonPillProps): ReactElement {
  if (!userId) {
    return <span className={cn('text-foreground', className)}>{name}</span>;
  }

  return (
    <span style={NO_HOVER_SHIFT} className={className}>
      <MentionText
        type='user'
        userId={userId}
        username={name}
        className='!inline-flex w-fit items-center justify-center !rounded-full border border-transparent px-2 py-0.5 text-xs font-medium'
      />
    </span>
  );
}
