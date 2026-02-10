import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { ReactElement } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { cn } from '../../../utils/classNames';
import { useUser } from '../../../hooks/useUsers';
import { User } from '../../../machines/stateMachine';

export type AvatarSize = 'sm' | 'rg' | 'md' | 'lg' | 'xl' | 'big';

interface AvatarProps {
  userId?: string | null;
  size?: AvatarSize;
  showActiveStatus?: boolean;
  className?: string;
}

const sizeClasses: Record<AvatarSize, string> = {
  sm: 'size-5 text-xs',
  rg: 'w-[30px] h-[30px] text-xs',
  md: 'size-8 text-sm',
  lg: 'size-12 text-base',
  xl: 'size-16 text-lg',
  big: 'w-[216px] h-[216px] text-6xl',
};

function AvatarRoot({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>): ReactElement {
  return (
    <AvatarPrimitive.Root
      data-slot='avatar'
      className={cn('relative flex shrink-0 overflow-hidden rounded-sm', className)}
      {...props}
    />
  );
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>): ReactElement {
  return (
    <AvatarPrimitive.Image
      data-slot='avatar-image'
      className={cn('aspect-square size-full', className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>): ReactElement {
  return (
    <AvatarPrimitive.Fallback
      data-slot='avatar-fallback'
      className={cn('bg-muted flex size-full items-center justify-center rounded-md', className)}
      {...props}
    />
  );
}

// Generate consistent color from user ID using existing tag color palette
const generateAvatarColor = (userId: string): { bg: string; text: string } => {
  if (!userId) return { bg: 'bg-muted', text: 'text-muted-foreground' };

  const colorPalette = [
    { bg: 'bg-red-400', text: 'text-white' }, // #FF6B6B - Red
    { bg: 'bg-teal-400', text: 'text-white' }, // #4ECDC4 - Teal
    { bg: 'bg-sky-400', text: 'text-white' }, // #45B7D1 - Sky Blue
    { bg: 'bg-orange-300', text: 'text-white' }, // #FFA07A - Light Salmon
    { bg: 'bg-green-300', text: 'text-white' }, // #98D8C8 - Mint
    { bg: 'bg-yellow-300', text: 'text-white' }, // #F7DC6F - Yellow
    { bg: 'bg-purple-300', text: 'text-white' }, // #BB8FCE - Purple
    { bg: 'bg-blue-300', text: 'text-white' }, // #85C1E2 - Light Blue
    { bg: 'bg-amber-400', text: 'text-white' }, // #F8B739 - Orange
    { bg: 'bg-green-500', text: 'text-white' }, // #52B788 - Green
    { bg: 'bg-pink-400', text: 'text-white' }, // #E85D75 - Pink
    { bg: 'bg-indigo-400', text: 'text-white' }, // #6C5CE7 - Indigo
    { bg: 'bg-emerald-500', text: 'text-white' }, // #00B894 - Emerald
    { bg: 'bg-yellow-500', text: 'text-white' }, // #FDCB6E - Amber
    { bg: 'bg-orange-600', text: 'text-white' }, // #E17055 - Terra Cotta
    { bg: 'bg-blue-400', text: 'text-white' }, // #74B9FF - Blue
    { bg: 'bg-purple-400', text: 'text-white' }, // #A29BFE - Lavender
    { bg: 'bg-rose-400', text: 'text-white' }, // #FD79A8 - Rose
    { bg: 'bg-cyan-500', text: 'text-white' }, // #00CEC9 - Cyan
    { bg: 'bg-red-400', text: 'text-white' }, // #FF7675 - Coral
    { bg: 'bg-teal-300', text: 'text-white' }, // #55EFC4 - Aqua
    { bg: 'bg-pink-300', text: 'text-white' }, // #FDA7DF - Light Pink
    { bg: 'bg-gray-600', text: 'text-white' }, // #6C5B7B - Plum
    { bg: 'bg-green-400', text: 'text-white' }, // #81C784 - Soft Green
    { bg: 'bg-orange-400', text: 'text-white' }, // #FFB74D - Peach
    { bg: 'bg-violet-400', text: 'text-white' }, // #9575CD - Violet
    { bg: 'bg-red-600', text: 'text-white' }, // #E74C3C - Crimson
    { bg: 'bg-blue-600', text: 'text-white' }, // #3498DB - Ocean Blue
    { bg: 'bg-emerald-600', text: 'text-white' }, // #2ECC71 - Emerald Green
    { bg: 'bg-orange-500', text: 'text-white' }, // #F39C12 - Carrot Orange
  ];

  // Create hash from userId to select color
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Select color from palette based on hash
  const colorIndex = Math.abs(hash) % colorPalette.length;
  return colorPalette[colorIndex] || { bg: 'bg-muted', text: 'text-muted-foreground' };
};

const Avatar = ({
  userId,
  size = 'md',
  // showActiveStatus = true,
  className,
}: AvatarProps): ReactElement => {
  const { user: currentUser } = useAuth();
  const targetUserId = userId || currentUser?.id || '';
  const user: User | undefined = useUser(targetUserId);

  const initials =
    user?.name
      ?.split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 1) || '';

  const sizeClass = sizeClasses[size];

  // Generate color if no profile picture
  const colorClass = !user?.picture
    ? generateAvatarColor(targetUserId)
    : { bg: 'bg-muted', text: 'text-muted-foreground' };

  return (
    <AvatarRoot className={cn(sizeClass, className, 'visual-regression-hide')}>
      {user?.picture && <AvatarImage src={user.picture} alt={user?.name || 'User avatar'} />}

      <AvatarFallback className={cn(colorClass.bg, colorClass.text, sizeClass)}>
        {initials}
      </AvatarFallback>

      {/* {showActiveStatus && (
        <>
          {(() => {
            const status = user?.presenceStatus?.status;
            const isOnline = status === UserPresenceStatus.ONLINE;
            const isOfflineOrAway =
              status === UserPresenceStatus.OFFLINE || status === UserPresenceStatus.AWAY;

            if (isOnline) {
              return (
                <span
                  className={cn(
                    'absolute bottom-[1px] right-[1px] block rounded-full ring-1 ring-background',
                    'bg-green-500',
                    size === 'sm' ? 'size-1.5 ring-1' : 'size-2.5',
                    size === 'lg' || size === 'xl' ? 'size-3.5' : '',
                    size === 'big' ? 'size-6 ring-4' : '',
                  )}
                />
              );
            }

            if (isOfflineOrAway) {
              return (
                <span
                  className={cn(
                    'absolute bottom-[1px] right-[1px] block rounded-full ring-1 ring-background',
                    'bg-gray-300', // Solid grey
                    size === 'sm' ? 'size-1.5 ring-1' : 'size-2.5',
                    size === 'lg' || size === 'xl' ? 'size-3.5' : '',
                    size === 'big' ? 'size-6 ring-4' : '',
                  )}
                />
              );
            }

            return null;
          })()}
        </>
      )} */}
    </AvatarRoot>
  );
};

export default Avatar;
