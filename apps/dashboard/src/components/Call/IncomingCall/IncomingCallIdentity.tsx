import type { CSSProperties, ReactElement } from 'react';
import { useReducedMotion } from 'framer-motion';
import Avatar, { getAvatarColorClassNames } from '../../ui/Avatar/Avatar';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { cn } from '../../../utils/classNames';
import type { IncomingCallIdentityVM, IncomingCallRosterEntry } from './IncomingCallCard.types';

interface IncomingCallIdentityProps {
  identity: IncomingCallIdentityVM;
}

/**
 * One circle in the stack. Falls back to initials when no user account backs
 * the entry — external guests would otherwise render an empty Avatar.
 */
function RosterAvatar({
  entry,
  size,
}: {
  entry: Pick<IncomingCallRosterEntry, 'userId' | 'displayName' | 'initials'>;
  size: number;
}): ReactElement {
  const colors = getAvatarColorClassNames(entry.userId ?? entry.displayName);

  return (
    <Tooltip content={entry.displayName} side='top' sideOffset={7} delayDuration={200}>
      <div className='shrink-0 overflow-hidden rounded-full' style={{ width: size, height: size }}>
        {entry.userId ? (
          <Avatar userId={entry.userId} size={size >= 64 ? 'xl' : 'lg'} showActiveStatus={false} />
        ) : (
          <div
            className={cn(
              'flex h-full w-full items-center justify-center font-semibold',
              colors.bg,
              colors.text,
            )}
            style={{ fontSize: size >= 64 ? 20 : 15, letterSpacing: '0.2px' }}
          >
            {entry.initials}
          </div>
        )}
      </div>
    </Tooltip>
  );
}

/**
 * The identity block: a single pinging avatar for a 1:1 call, an overlapping
 * stack for everything else.
 *
 * The stack is built here rather than through `AvatarGroup` because that
 * component's overlap is global descendant CSS with a hard-coded -4px offset
 * and mask geometry; the ring separator, the 12px overlap, the `+N` prefix and
 * the guest fallback would each need a new global variant in a file fifteen
 * other components share.
 */
export function IncomingCallIdentity({ identity }: IncomingCallIdentityProps): ReactElement {
  const prefersReducedMotion = useReducedMotion();

  if (identity.mode === 'solo') {
    return (
      <div className='relative h-16 w-16'>
        {/*
          Removed outright rather than paused: a looping ping frozen mid-scale
          reads as a stuck element. The static ring below still marks the call
          as live.
        */}
        {!prefersReducedMotion && (
          <>
            <span
              aria-hidden
              className='incoming-call-radar pointer-events-none absolute inset-0 animate-call-radar rounded-full border-[1.5px] border-[var(--call-ring-accent)]'
            />
            <span
              aria-hidden
              className='incoming-call-radar pointer-events-none absolute inset-0 animate-call-radar rounded-full border-[1.5px] border-[var(--call-ring-accent)]'
              style={{ animationDelay: '750ms' }}
            />
          </>
        )}
        <div className='relative rounded-full shadow-[0_0_0_2px_hsl(var(--popover)),0_0_0_4px_var(--call-ring-accent)]'>
          <RosterAvatar
            entry={{
              userId: identity.userId,
              displayName: identity.displayName,
              initials: identity.displayName.trim()[0]?.toUpperCase() ?? '?',
            }}
            size={64}
          />
        </div>
      </div>
    );
  }

  return (
    <div className='flex items-center'>
      {identity.visible.map((entry, index) => (
        <div
          key={entry.key}
          className={cn(
            'relative rounded-full shadow-[0_0_0_2px_hsl(var(--popover))]',
            // Caller on top, each subsequent avatar tucked behind — until one is
            // hovered, which lifts it clear of its neighbours.
            'z-[var(--stack-depth)] hover:z-20',
            index > 0 && '-ml-3',
          )}
          style={{ '--stack-depth': identity.visible.length - index } as CSSProperties}
        >
          <RosterAvatar entry={entry} size={48} />
        </div>
      ))}

      {identity.overflowCount > 0 && (
        <div className='relative -ml-3 h-12 w-12 shrink-0 rounded-full bg-muted shadow-[0_0_0_2px_hsl(var(--popover))]'>
          <div className='flex h-full w-full items-center justify-center rounded-full text-[13.5px] font-semibold text-muted-foreground'>
            +{identity.overflowCount}
          </div>
        </div>
      )}
    </div>
  );
}
