import { logger, Event as LogEvent } from '../../../utils/logger';
import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { ReactElement } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { cn } from '../../../utils/classNames';
import { useUser } from '../../../hooks/useUsers';
import { useUserPresence } from '../../../hooks/usePresence';
import { User } from '../../../machines/stateMachine';
import { useProfilePictureUrl } from '../../../hooks/useProfilePicture';

export type AvatarSize = 'xs' | 'sm' | 'rg' | 'md' | 'lg' | 'xl' | 'big';

interface AvatarProps {
  userId?: string | null;
  size?: AvatarSize;
  rounded?: boolean;
  showActiveStatus?: boolean;
  className?: string;
}

// Only dimension classes
const sizeClasses: Record<AvatarSize, string> = {
  xs: 'size-4',
  sm: 'size-5',
  rg: 'w-[30px] h-[30px]',
  md: 'size-8',
  lg: 'size-12',
  xl: 'size-16',
  big: 'w-[216px] h-[216px]',
};

// Text size classes
const textSizeClasses: Record<AvatarSize, string> = {
  xs: 'text-[8px]',
  sm: 'text-[10px]',
  rg: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
  xl: 'text-lg',
  big: 'text-6xl',
};

// Indicator config: radius of the colored circle, stroke width for white border
const indicatorConfig: Record<AvatarSize, { radius: number; stroke: number }> = {
  xs: { radius: 3, stroke: 1 },
  sm: { radius: 4, stroke: 1.5 },
  rg: { radius: 5, stroke: 2 },
  md: { radius: 5, stroke: 2 },
  lg: { radius: 6, stroke: 2 },
  xl: { radius: 7, stroke: 3 },
  big: { radius: 9, stroke: 4 },
};

function AvatarRoot({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>): ReactElement {
  return (
    <AvatarPrimitive.Root
      data-slot='avatar'
      className={cn('relative flex shrink-0 overflow-hidden rounded-[inherit]', className)}
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

// Generate consistent color from user ID using existing tag color palette.
// Exported so small user badges can share the same deterministic identity color.
export const getAvatarColorClassNames = (userId: string): { bg: string; text: string } => {
  if (!userId) return { bg: 'bg-muted', text: 'text-muted-foreground' };

  const colorPalette = [
    { bg: 'bg-red-400', text: 'text-primary-foreground' },
    { bg: 'bg-teal-400', text: 'text-primary-foreground' },
    { bg: 'bg-sky-400', text: 'text-primary-foreground' },
    { bg: 'bg-orange-300', text: 'text-primary-foreground' },
    { bg: 'bg-green-300', text: 'text-primary-foreground' },
    { bg: 'bg-yellow-300', text: 'text-primary-foreground' },
    { bg: 'bg-purple-300', text: 'text-primary-foreground' },
    { bg: 'bg-blue-300', text: 'text-primary-foreground' },
    { bg: 'bg-amber-400', text: 'text-primary-foreground' },
    { bg: 'bg-green-500', text: 'text-primary-foreground' },
    { bg: 'bg-pink-400', text: 'text-primary-foreground' },
    { bg: 'bg-indigo-400', text: 'text-primary-foreground' },
    { bg: 'bg-emerald-500', text: 'text-primary-foreground' },
    { bg: 'bg-yellow-500', text: 'text-primary-foreground' },
    { bg: 'bg-orange-600', text: 'text-primary-foreground' },
    { bg: 'bg-blue-400', text: 'text-primary-foreground' },
    { bg: 'bg-purple-400', text: 'text-primary-foreground' },
    { bg: 'bg-rose-400', text: 'text-primary-foreground' },
    { bg: 'bg-cyan-500', text: 'text-primary-foreground' },
    { bg: 'bg-red-400', text: 'text-primary-foreground' },
    { bg: 'bg-teal-300', text: 'text-primary-foreground' },
    { bg: 'bg-pink-300', text: 'text-primary-foreground' },
    { bg: 'bg-muted', text: 'text-muted-foreground' },
    { bg: 'bg-green-400', text: 'text-primary-foreground' },
    { bg: 'bg-orange-400', text: 'text-primary-foreground' },
    { bg: 'bg-violet-400', text: 'text-primary-foreground' },
    { bg: 'bg-red-600', text: 'text-primary-foreground' },
    { bg: 'bg-blue-600', text: 'text-primary-foreground' },
    { bg: 'bg-emerald-600', text: 'text-primary-foreground' },
    { bg: 'bg-orange-500', text: 'text-primary-foreground' },
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
  rounded = false,
  showActiveStatus = true,
  className,
}: AvatarProps): ReactElement => {
  const { user: currentUser } = useAuth();
  const targetUserId = userId !== undefined ? (userId ?? '') : (currentUser?.id ?? '');
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

  const colorClass = getAvatarColorClassNames(targetUserId);

  const handleImageError = (): void => {
    setImageError(true);
    logger.warn(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_warn',
      message: String(`Failed to load avatar image for user ${targetUserId}: ${user?.picture}`),
    });
  };

  const isOnline = presenceStatus === 'ONLINE';
  const isOfflineOrAway = presenceStatus === 'OFFLINE' || presenceStatus === 'AWAY';
  const showIndicator = showActiveStatus && (isOnline || isOfflineOrAway);

  const { radius, stroke } = indicatorConfig[size];

  // Outer edge of the colored disc (online) / grey ring (offline).
  const coreRadius = radius - stroke / 2;
  const haloWidth = stroke * 1.5;
  const offlineRing = stroke / 2;
  const offlineRingRadius = coreRadius - offlineRing / 2;

  // The halo is a hole punched through the avatar rather than a painted ring, so
  // it reveals whatever sits behind — translucent sidebars, hovered rows, page.
  const cutRadius = coreRadius + haloWidth;
  const cutInset = 2;

  // +1 keeps the outermost edge off the canvas edge, so it doesn't clip.
  const svgSize = (cutRadius + 1) * 2;
  const center = svgSize / 2;
  // Position so the circle sits on the corner (slightly inward)
  const offset = -(svgSize / 2) + cutInset;

  const cutMask = `radial-gradient(circle at calc(100% - ${cutInset}px) calc(100% - ${cutInset}px), transparent ${cutRadius}px, #000 ${cutRadius + 0.5}px)`;

  // Render online indicator as SVG circle (guaranteed perfect circle)
  const renderOnlineIndicator = (): ReactElement | null => {
    if (!showIndicator) return null;

    return (
      <svg
        width={svgSize}
        height={svgSize}
        className='absolute'
        style={{ bottom: offset, right: offset, pointerEvents: 'none' }}
      >
        {isOnline ? (
          <circle cx={center} cy={center} r={coreRadius} fill='var(--status-success)' />
        ) : (
          <circle
            cx={center}
            cy={center}
            r={offlineRingRadius}
            fill='none'
            stroke='var(--avatar-ring, hsl(var(--muted-foreground)))'
            strokeWidth={offlineRing}
          />
        )}
      </svg>
    );
  };

  const roundedClass = rounded ? 'rounded-full' : '';

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 visual-regression-hide rounded-sm',
        sizeClass,
        roundedClass,
        className,
      )}
    >
      <AvatarRoot
        className={cn(colorClass.bg, colorClass.text, 'size-full', textSizeClass, roundedClass)}
        style={showIndicator ? { maskImage: cutMask, WebkitMaskImage: cutMask } : undefined}
      >
        {pictureUrl && !imageError && (
          <AvatarImage
            src={pictureUrl}
            alt={user?.name || 'User avatar'}
            onError={handleImageError}
            className={roundedClass}
          />
        )}

        <AvatarFallback
          className={cn(colorClass.bg, colorClass.text, 'size-full', textSizeClass, roundedClass)}
        >
          {initials}
        </AvatarFallback>
      </AvatarRoot>

      {renderOnlineIndicator()}
    </div>
  );
};

export default Avatar;
