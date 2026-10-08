import type { ReactElement } from 'react';
import { cn } from '../../utils/classNames';
import Avatar from '../ui/Avatar/Avatar';
import { useUser } from '../../hooks/useUsers';

/**
 * An agent's avatar: its Spaces bot user's picture when known, else its
 * coloured initial. The composer's agent picker, the conversation header and
 * the agent info modal all draw agents with it.
 */
export function AgentGlyph({
  color,
  name,
  size = 20,
  userId,
  rounded = false,
}: {
  color?: string | undefined;
  name: string;
  size?: number;
  /** A circle instead of the default rounded square. */
  rounded?: boolean;
  /** The agent's Spaces bot user: when it is known here, draw the avatar a
   *  channel shows for the agent (its picture, or Spaces' letter fallback). */
  userId?: string | undefined;
}): ReactElement {
  const botUser = useUser(userId ?? '');
  if (userId && botUser) {
    return (
      <span aria-hidden className='inline-flex shrink-0' style={{ width: size, height: size }}>
        <Avatar
          userId={userId}
          size={size < 18 ? 'xs' : size < 24 ? 'sm' : 'rg'}
          showActiveStatus={false}
          rounded={rounded}
          className='size-full'
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium uppercase text-white',
        rounded ? 'rounded-full' : 'rounded-sm',
        !color && 'bg-muted-foreground',
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
        ...(color ? { backgroundColor: color } : {}),
      }}
    >
      {[...name.trim()][0] ?? '?'}
    </span>
  );
}
