import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { ReactElement } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { cn } from '../../../utils/classNames';
import { useUser } from '../../../hooks/useUsers';
import { useUserPresence } from '../../../hooks/usePresence';
import { User } from '../../../machines/stateMachine';
import { useProfilePictureUrl } from '../../../hooks/useProfilePicture';

export type AvatarSize = 'sm' | 'rg' | 'md' | 'lg' | 'xl' | 'big';

interface AvatarProps {
  userId?: string | null;
  size?: AvatarSize;
  showActiveStatus?: boolean;
  className?: string;
}

// Only dimension classes
const sizeClasses: Record<AvatarSize, string> = {
  sm: 'size-5',
  rg: 'w-[30px] h-[30px]',
  md: 'size-8',
  lg: 'size-12',
  xl: 'size-16',
  big: 'w-[216px] h-[216px]',
};

// Text size classes
const textSizeClasses: Record<AvatarSize, string> = {
  sm: 'text-[10px]',
  rg: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
  xl: 'text-lg',
  big: 'text-6xl',
};

// Indicator config: radius of the colored circle, stroke width for white border
const indicatorConfig: Record<AvatarSize, { radius: number; stroke: number }> = {
  sm: { radius: 3, stroke: 1.5 },
  rg: { radius: 4, stroke: 2 },
  md: { radius: 4, stroke: 2 },
  lg: { radius: 5, stroke: 2 },
  xl: { radius: 6, stroke: 3 },
  big: { radius: 8, stroke: 4 },
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
    { bg: 'bg-red-400', text: 'text-white' },
    { bg: 'bg-teal-400', text: 'text-white' },
    { bg: 'bg-sky-400', text: 'text-white' },
    { bg: 'bg-orange-300', text: 'text-white' },
    { bg: 'bg-green-300', text: 'text-white' },
    { bg: 'bg-yellow-300', text: 'text-white' },
    { bg: 'bg-purple-300', text: 'text-white' },
    { bg: 'bg-blue-300', text: 'text-white' },
    { bg: 'bg-amber-400', text: 'text-white' },
    { bg: 'bg-green-500', text: 'text-white' },
    { bg: 'bg-pink-400', text: 'text-white' },
    { bg: 'bg-indigo-400', text: 'text-white' },
    { bg: 'bg-emerald-500', text: 'text-white' },
    { bg: 'bg-yellow-500', text: 'text-white' },
    { bg: 'bg-orange-600', text: 'text-white' },
    { bg: 'bg-blue-400', text: 'text-white' },
    { bg: 'bg-purple-400', text: 'text-white' },
    { bg: 'bg-rose-400', text: 'text-white' },
    { bg: 'bg-cyan-500', text: 'text-white' },
    { bg: 'bg-red-400', text: 'text-white' },
    { bg: 'bg-teal-300', text: 'text-white' },
    { bg: 'bg-pink-300', text: 'text-white' },
    { bg: 'bg-gray-600', text: 'text-white' },
    { bg: 'bg-green-400', text: 'text-white' },
    { bg: 'bg-orange-400', text: 'text-white' },
    { bg: 'bg-violet-400', text: 'text-white' },
    { bg: 'bg-red-600', text: 'text-white' },
    { bg: 'bg-blue-600', text: 'text-white' },
    { bg: 'bg-emerald-600', text: 'text-white' },
    { bg: 'bg-orange-500', text: 'text-white' },
  ];

  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colorIndex = Math.abs(hash) % colorPalette.length;
  return colorPalette[colorIndex] || { bg: 'bg-muted', text: 'text-muted-foreground' };
};

const Avatar = ({
  userId,
  size = 'md',
  showActiveStatus = true,
  className,
}: AvatarProps): ReactElement => {
  const { user: currentUser } = useAuth();
  const targetUserId = userId || currentUser?.id || '';
  const user: User | undefined = useUser(targetUserId);
  const [imageError, setImageError] = React.useState(false);

  const { status: presenceStatus } = useUserPresence(targetUserId);

  const initials =
    user?.name
      ?.split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 1) || '';

  // Picture path includes timestamp, so it naturally changes on each upload
  const { url: pictureUrl } = useProfilePictureUrl(targetUserId, user?.picture);

  const sizeClass = sizeClasses[size];
  const textSizeClass = textSizeClasses[size];

  const colorClass =
    !pictureUrl || imageError
      ? generateAvatarColor(targetUserId)
      : { bg: 'bg-muted', text: 'text-muted-foreground' };

  const handleImageError = (): void => {
    setImageError(true);
    console.warn(`Failed to load avatar image for user ${targetUserId}: ${user?.picture}`);
  };

  // Render online indicator as SVG circle (guaranteed perfect circle)
  const renderOnlineIndicator = (): ReactElement | null => {
    if (!showActiveStatus) return null;

    const isOnline = presenceStatus === 'ONLINE';
    const isOfflineOrAway = presenceStatus === 'OFFLINE' || presenceStatus === 'AWAY';

    if (!isOnline && !isOfflineOrAway) return null;

    const { radius, stroke } = indicatorConfig[size];
    const svgSize = (radius + stroke) * 2;
    const center = svgSize / 2;
    // Position so the circle sits on the corner (slightly inward)
    const offset = -(svgSize / 2) + 2;

    return (
      <svg
        width={svgSize}
        height={svgSize}
        className='absolute'
        style={{ bottom: offset, right: offset, pointerEvents: 'none' }}
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill={isOnline ? '#22c55e' : '#9ca3af'}
          stroke='white'
          strokeWidth={stroke}
        />
      </svg>
    );
  };

  return (
    <div
      className={cn('relative inline-flex shrink-0 visual-regression-hide', sizeClass, className)}
    >
      <AvatarRoot className={cn(colorClass.bg, colorClass.text, 'size-full', textSizeClass)}>
        {pictureUrl && !imageError && (
          <AvatarImage
            src={pictureUrl}
            alt={user?.name || 'User avatar'}
            onError={handleImageError}
          />
        )}

        <AvatarFallback className={cn(colorClass.bg, colorClass.text, 'size-full', textSizeClass)}>
          {initials}
        </AvatarFallback>
      </AvatarRoot>

      {renderOnlineIndicator()}
    </div>
  );
};

export default Avatar;
