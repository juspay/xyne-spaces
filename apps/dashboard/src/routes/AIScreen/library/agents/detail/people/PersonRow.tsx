import { type ReactElement, type ReactNode } from 'react';
import Avatar from '@/components/ui/Avatar/Avatar';
import { cn } from '@/utils/classNames';
import {
  DETAIL_NESTED_HINT_CLASS,
  DETAIL_NESTED_TITLE_CLASS,
  type DetailTypeScale,
} from '../../../shared/primitives/DetailPrimitives';

export function PersonRow({
  userId,
  name,
  detail,
  trailing,
  typeScale = 'library',
}: {
  userId: string;
  name: string;
  detail: string;
  trailing?: ReactNode;
  typeScale?: DetailTypeScale;
}): ReactElement {
  return (
    <div
      className={cn(
        'flex w-full items-center gap-3',
        // Twin rows sit in DetailGroup (pad/gap on the group). Library rows are card dividers.
        typeScale !== 'twin' && 'border-b border-border p-4 last:border-b-0',
      )}
    >
      <Avatar userId={userId} size='md' showActiveStatus className='size-10 shrink-0' />

      <div className='flex min-w-0 flex-1 flex-col gap-1.5 overflow-hidden'>
        <span className={cn('truncate', DETAIL_NESTED_TITLE_CLASS[typeScale])}>{name}</span>
        <span className={cn('truncate', DETAIL_NESTED_HINT_CLASS[typeScale])}>{detail}</span>
      </div>

      {trailing && <div className='flex shrink-0 items-center gap-1.5'>{trailing}</div>}
    </div>
  );
}
