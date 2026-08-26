import * as React from 'react';
import { ReactElement } from 'react';
import Avatar from './Avatar';
import { cn } from '../../../utils/classNames';
import type { AvatarSize } from './Avatar';

export type AvatarGroupShape = 'circle' | 'square';

interface AvatarGroupProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  userIds: (string | null | undefined)[];
  size?: AvatarSize;
  className?: string;
  count?: number;
  isGroupDMAvatar?: boolean;
  /**
   * Silhouette of each avatar in the stack.
   * - `circle` (default): round avatars separated by a masked cut-out.
   * - `square`: squircles separated by a solid `--background` border.
   */
  shape?: AvatarGroupShape;
}

/**
 * AvatarStackItem - Wrapper for individual avatars
 * The CSS in global.css handles the border styling and overlapping effect
 */
export function AvatarStackItem({
  children,
  size,
  className,
}: {
  children: React.ReactNode;
  size: number;
  className?: string;
}): ReactElement {
  return (
    <div
      data-slot='avatar-stack-item'
      className={cn(
        'size-full shrink-0 overflow-hidden rounded-full flex items-center justify-center',
        '[&_[data-slot="avatar"]]:size-full',
        className,
      )}
      style={{
        width: size,
        height: size,
      }}
    >
      {children}
    </div>
  );
}

/**
 * AvatarCountBadge - Displays a count badge that looks like an avatar
 * Shows the remaining number of avatars when count prop is used
 * The CSS in global.css handles the border styling for overlapping effect
 */
function AvatarCountBadge({
  count,
  size,
  pixelSize,
  className,
}: {
  count: number;
  size: AvatarSize;
  pixelSize: number;
  className?: string;
}): ReactElement {
  const textSizeClasses: Record<AvatarSize, string> = {
    xs: 'text-[8px]',
    sm: 'text-xs',
    rg: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
    xl: 'text-lg',
    big: 'text-xl',
  };

  const textSizeClass = textSizeClasses[size];

  return (
    <div
      className={cn(
        'shrink-0 overflow-hidden rounded-full',
        'bg-muted flex items-center justify-center',
        'font-medium text-muted-foreground',
        className,
      )}
      style={{
        width: pixelSize,
        height: pixelSize,
      }}
    >
      <span className={textSizeClass}>{count}</span>
    </div>
  );
}

/**
 * AvatarGroup Component
 *
 * Displays a group of avatars with overlapping masked borders that work on any background.
 * All avatars in the group have showActiveStatus set to false.
 * When `count` prop is provided, only that many avatars are shown, with a count badge for remaining.
 *
 * @example
 * <AvatarGroup userIds={['user1', 'user2', 'user3']} size="md" />
 * @example
 * <AvatarGroup userIds={['user1', 'user2', 'user3', 'user4']} size="md" count={2} />
 */
const AvatarGroup = ({
  userIds,
  size = 'md',
  className,
  count,
  isGroupDMAvatar = false,
  shape = 'circle',
  ...props
}: AvatarGroupProps): ReactElement => {
  // Filter out null/undefined userIds
  const validUserIds = userIds.filter((id): id is string => id !== null);

  // Map size to pixel value for mask calculation
  const sizeMap: Record<AvatarSize, number> = {
    xs: 16, // size-4 = 1rem = 16px
    sm: 20, // size-5 = 1.25rem = 20px
    rg: 30, // w-[30px] h-[30px] = 30px
    md: 32, // size-8 = 2rem = 32px
    lg: 48, // size-12 = 3rem = 48px
    xl: 64, // size-16 = 4rem = 64px
    big: 80, // size-20 = 5rem = 80px
  };

  const pixelSize = isGroupDMAvatar ? 0 : sizeMap[size];

  // Determine which avatars to show and if we need a count badge
  const displayCount =
    count !== undefined ? Math.min(count, validUserIds.length) : validUserIds.length;
  const avatarsToShow = validUserIds.slice(0, displayCount);
  const remainingCount =
    count !== undefined && validUserIds.length > count ? validUserIds.length - count : 0;

  // GroupDM mode: diagonal positioning like GroupDMAvatar
  // Always shows first 2 users (front at top-left, back at bottom-right)
  if (isGroupDMAvatar) {
    const frontUserId = validUserIds[1] ?? '';
    const backUserId = validUserIds[0] ?? '';

    return (
      <div
        data-slot='avatar-group'
        className={cn('relative w-10 h-10 flex-shrink-0', className)}
        {...props}
      >
        {backUserId && (
          <div className='absolute bottom-0 right-0 w-6 h-6 rounded-md ring-1 ring-background overflow-hidden z-10 [&_[data-slot="avatar"]]:rounded-md'>
            <Avatar
              userId={backUserId}
              size='sm'
              showActiveStatus={false}
              className='w-full h-full rounded-none'
            />
          </div>
        )}
        {frontUserId && (
          <div className='absolute top-0 left-0 w-6 h-6 rounded-md ring-1 ring-background overflow-hidden z-0 [&_[data-slot="avatar"]]:rounded-md'>
            <Avatar
              userId={frontUserId}
              size='sm'
              showActiveStatus={false}
              className='w-full h-full rounded-none'
            />
          </div>
        )}
      </div>
    );
  }

  // In square mode the overlap separator is a real border in `--background`
  // rather than the radial mask cut-out used by the circular stack.
  const squareItemClassName = shape === 'square' ? 'rounded-[4px] border-2 border-background' : '';

  // Default mode: flex layout with overlapping masks
  return (
    <div
      data-slot='avatar-group'
      data-shape={shape}
      className={cn('flex items-center', className)}
      {...props}
    >
      {avatarsToShow.map((userId, index) => (
        <AvatarStackItem
          key={`${userId}-${index}`}
          size={pixelSize}
          className={squareItemClassName}
        >
          <Avatar userId={userId} size={size} showActiveStatus={false} />
        </AvatarStackItem>
      ))}
      {remainingCount > 0 && (
        <div data-slot='avatar-stack-item'>
          <AvatarCountBadge
            count={remainingCount}
            size={size}
            pixelSize={pixelSize}
            className={squareItemClassName}
          />
        </div>
      )}
    </div>
  );
};

export default AvatarGroup;
export type { AvatarGroupProps };
