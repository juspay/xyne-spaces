import { LucideIcon } from 'lucide-react';

export interface IconToggleButtonVariant {
  bg: string;
  border: string;
  hoverBg: string;
  hoverBorder: string;
  iconColor: string;
  iconFill?: string;
}

export interface IconToggleButtonVariants {
  active: IconToggleButtonVariant;
  inactive: IconToggleButtonVariant;
}

interface IconToggleButtonProps {
  icon: LucideIcon;
  isActive?: boolean;
  onToggle?: (active: boolean) => void;
  variants: IconToggleButtonVariants;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  disabled?: boolean;
}

const sizeClasses = {
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-10 h-10',
};

const iconSizeClasses = {
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

export const IconToggleButton: React.FC<IconToggleButtonProps> = ({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  icon: Icon,
  isActive = false,
  onToggle,
  variants,
  size = 'md',
  className = '',
  disabled = false,
}) => {
  const handleClick = (): void => {
    if (disabled) return;

    const newActiveState = !isActive;
    onToggle?.(newActiveState);
  };

  const currentVariant = isActive ? variants.active : variants.inactive;

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`
        inline-flex items-center justify-center
        ${sizeClasses[size]}
        rounded-md
        border
        transition-all duration-200
        focus:outline-none
        disabled:opacity-50 disabled:cursor-not-allowed
        ${currentVariant.bg}
        ${currentVariant.border}
        ${!disabled ? currentVariant.hoverBg : ''}
        ${!disabled ? currentVariant.hoverBorder : ''}
        ${className}
      `}
    >
      <Icon
        className={`
          ${iconSizeClasses[size]}
          transition-colors duration-200
          ${currentVariant.iconColor}
          ${currentVariant.iconFill || ''}
        `}
      />
    </button>
  );
};

// Predefined variant presets
export const iconToggleVariants = {
  star: {
    active: {
      bg: 'bg-[#FBEFD9]',
      border: 'border-[#FBEFD9]',
      hoverBg: 'hover:bg-[#F5E6C8]',
      hoverBorder: 'hover:border-[#F5E6C8]',
      iconColor: 'text-[#FFBE4E]',
      iconFill: 'fill-[#FFBE4E]',
    },
    inactive: {
      bg: 'bg-white',
      border: 'border-gray-300',
      hoverBg: 'hover:bg-gray-50',
      hoverBorder: 'hover:border-gray-400',
      iconColor: 'text-gray-400',
    },
  },
  bookmark: {
    active: {
      bg: 'bg-blue-50',
      border: 'border-blue-300',
      hoverBg: 'hover:bg-blue-100',
      hoverBorder: 'hover:border-blue-400',
      iconColor: 'text-blue-600',
      iconFill: 'fill-blue-500',
    },
    inactive: {
      bg: 'bg-white',
      border: 'border-gray-300',
      hoverBg: 'hover:bg-gray-50',
      hoverBorder: 'hover:border-gray-400',
      iconColor: 'text-gray-400',
    },
  },
  heart: {
    active: {
      bg: 'bg-red-50',
      border: 'border-red-300',
      hoverBg: 'hover:bg-red-100',
      hoverBorder: 'hover:border-red-400',
      iconColor: 'text-red-600',
      iconFill: 'fill-red-500',
    },
    inactive: {
      bg: 'bg-white',
      border: 'border-gray-300',
      hoverBg: 'hover:bg-gray-50',
      hoverBorder: 'hover:border-gray-400',
      iconColor: 'text-gray-400',
    },
  },
  pin: {
    active: {
      bg: 'bg-green-50',
      border: 'border-green-300',
      hoverBg: 'hover:bg-green-100',
      hoverBorder: 'hover:border-green-400',
      iconColor: 'text-green-600',
      iconFill: 'fill-green-500',
    },
    inactive: {
      bg: 'bg-white',
      border: 'border-gray-300',
      hoverBg: 'hover:bg-gray-50',
      hoverBorder: 'hover:border-gray-400',
      iconColor: 'text-gray-400',
    },
  },
} as const;

export default IconToggleButton;
