import { type ReactElement } from 'react';
import Avatar from '@/components/ui/Avatar/Avatar';
import { UserHoverWrapper } from '@/components/ui/UserMentionPopover/UserMentionPopover';
import { cn } from '@/utils/classNames';

interface PersonPillProps {
  userId?: string | null;
  name: string;
  className?: string;
}

export function PersonPill({ userId, name, className }: PersonPillProps): ReactElement {
  if (!userId) {
    return <span className={cn('text-foreground', className)}>{name}</span>;
  }

  return (
    <UserHoverWrapper userId={userId}>
      <span
        className={cn(
          'inline-flex max-w-full cursor-pointer items-center gap-1 rounded-full bg-muted py-0.5 pl-0.5 pr-2 align-middle transition-colors hover:bg-accent',
          className,
        )}
      >
        <Avatar userId={userId} size='xs' className='size-4 shrink-0' />
        <span className='truncate text-foreground'>{name}</span>
      </span>
    </UserHoverWrapper>
  );
}
