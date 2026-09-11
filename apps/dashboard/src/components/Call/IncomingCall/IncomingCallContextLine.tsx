import { Calendar, Hash, MessageCircle, User, Users } from 'lucide-react';
import type { ComponentType, ReactElement } from 'react';
import type { IncomingCallContextIcon, IncomingCallContextVM } from './IncomingCallCard.types';

const ICONS: Record<IncomingCallContextIcon, ComponentType<{ className?: string }>> = {
  user: User,
  users: Users,
  thread: MessageCircle,
  calendar: Calendar,
  hash: Hash,
};

/**
 * Where the call is coming from, above the identity block.
 *
 * Place names are plain text: the two buttons are the only things to press on
 * this card, so a link competing with them would be the wrong affordance while
 * the phone is ringing.
 *
 * The line wraps rather than truncates — a channel long enough to need two
 * lines is exactly the one worth reading in full, and the identity block below
 * absorbs the height so the card never changes size.
 */
export function IncomingCallContextLine({
  context,
}: {
  context: IncomingCallContextVM;
}): ReactElement {
  const Icon = ICONS[context.icon];

  return (
    <div className='mx-auto max-w-[320px] text-center text-xs font-medium leading-[1.55] text-muted-foreground [text-wrap:pretty]'>
      <Icon className='mr-1.5 inline-block h-3.5 w-3.5 align-[-2.5px]' />
      {context.text}
    </div>
  );
}
