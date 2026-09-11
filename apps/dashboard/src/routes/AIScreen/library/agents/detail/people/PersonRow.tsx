import { type ReactElement, type ReactNode } from 'react';
import Avatar from '@/components/ui/Avatar/Avatar';

export function PersonRow({
  userId,
  name,
  detail,
  trailing,
}: {
  userId: string;
  name: string;
  detail: string;
  trailing?: ReactNode;
}): ReactElement {
  return (
    <div className='flex w-full items-center gap-3 border-b border-border p-4 last:border-b-0'>
      <Avatar userId={userId} size='md' showActiveStatus className='size-10 shrink-0' />

      <div className='flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden'>
        <span className='truncate text-sm leading-5 text-foreground'>{name}</span>
        <span className='truncate text-sm leading-5 text-foreground/60'>{detail}</span>
      </div>

      {trailing && <div className='flex shrink-0 items-center gap-1.5'>{trailing}</div>}
    </div>
  );
}
