import { cn } from '../../../utils/classNames';
import { useState } from 'react';

interface ParticipantAvatarProps {
  name: string;
  size?: 'xs' | 'small' | 'medium' | 'large' | 'xl' | undefined;
  className?: string | undefined;
  showBorder?: boolean | undefined;
  gradientFrom?: string | undefined;
  gradientTo?: string | undefined;
  pictureUrl?: string | null | undefined;
  backgroundColor?: string | undefined;
}

export function ParticipantAvatar({
  name,
  size = 'medium',
  className = '',
  showBorder = false,
  gradientFrom = 'from-blue-500',
  gradientTo = 'to-purple-600',
  pictureUrl,
  backgroundColor,
}: ParticipantAvatarProps): React.ReactElement {
  const [imageError, setImageError] = useState(false);

  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
    small: 'w-8 h-8 text-xs',
    medium: 'w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16 text-base sm:text-xl md:text-2xl',
    large: 'w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 text-2xl sm:text-3xl md:text-4xl',
    xl: 'w-24 h-24 sm:w-32 sm:h-32 md:w-40 md:h-40 text-4xl sm:text-5xl md:text-6xl',
  };

  const initial = name?.charAt(0).toUpperCase() || '?';
  const showPicture = pictureUrl && !imageError;

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center text-white font-bold shadow-lg visual-regression-hide overflow-hidden',
        !backgroundColor && 'bg-gradient-to-br',
        !backgroundColor && gradientFrom,
        !backgroundColor && gradientTo,
        showBorder && 'ring-2 ring-white/20',
        sizeClasses[size],
        className,
      )}
      style={backgroundColor ? { backgroundColor } : undefined}
      role='img'
      aria-label={`${name} avatar`}
    >
      {showPicture ? (
        <img
          src={pictureUrl}
          alt={`${name} avatar`}
          className='w-full h-full object-cover'
          onError={() => setImageError(true)}
        />
      ) : (
        initial
      )}
    </div>
  );
}
