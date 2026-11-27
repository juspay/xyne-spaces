import type { ReactElement } from 'react';
import { LockKeyhole } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { UNDECRYPTABLE_MESSAGE_TEXT } from '../../../utils/undecryptableMessage';

export const UndecryptableMessage = ({ className }: { className?: string }): ReactElement => (
  <span
    className={cn('inline-flex items-center gap-1 italic text-muted-foreground', className)}
    data-testid='undecryptable-message'
  >
    <LockKeyhole className='h-3.5 w-3.5 shrink-0' aria-hidden='true' />
    {UNDECRYPTABLE_MESSAGE_TEXT}
  </span>
);
