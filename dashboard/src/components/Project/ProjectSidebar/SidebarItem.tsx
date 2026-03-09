import { ReactElement, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../../utils/classNames';

interface SidebarItemProps {
  // Required props
  label: string | ReactNode;
  onClick: () => void;

  // Optional props for variations
  icon?: ReactElement;
  avatar?: {
    url?: string | null;
    fallbackText: string;
  };
  badge?: number | string;
  isExpandable?: boolean;
  isExpanded?: boolean;
  variant?: 'default' | 'nested';
  isActive?: boolean;
  dataTestId?: string;
}

const SidebarItem = ({
  label,
  onClick,
  icon,
  avatar,
  badge,
  isExpandable = false,
  isExpanded = false,
  variant = 'default',
  isActive = false,
  dataTestId,
}: SidebarItemProps): ReactElement => {
  // Determine what icon/avatar to render
  const renderLeadingElement = (): ReactElement | null => {
    // Priority 1: Avatar (for persons)
    if (avatar) {
      return avatar.url ? (
        <img
          src={avatar.url}
          alt={typeof label === 'string' ? label : 'User'}
          className='size-5 rounded-full object-cover'
        />
      ) : (
        <div className='size-5 rounded-full bg-muted-foreground/50 flex items-center justify-center'>
          <span className='text-[10px] text-white font-medium'>{avatar.fallbackText}</span>
        </div>
      );
    }

    // Priority 2: Custom icon
    if (icon) {
      return <div className='size-4'>{icon}</div>;
    }

    // Priority 3: Chevron for expandable items
    if (isExpandable) {
      return (
        <ChevronRight
          className={`size-4 text-muted-foreground transition-transform ${
            isExpanded ? 'rotate-90' : 'rotate-0'
          }`}
        />
      );
    }

    // No leading element
    return null;
  };

  // Determine text color based on variant
  const textColor = variant === 'nested' ? 'text-muted-foreground' : 'text-foreground';

  return (
    <button
      onClick={onClick}
      data-testid={dataTestId}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors group',
        'hover:bg-muted',

        isActive ? 'bg-[#E4E6E7]' : 'bg-transparent',
      )}
      data-track-category='Projects'
      data-track-name='SelectSidebarItem'
      data-track-metadata={JSON.stringify({ label, isActive })}
    >
      {/* Icon */}
      {renderLeadingElement()}

      <span
        className={cn(
          'text-[13px] flex-1 text-left truncate',
          isActive ? 'text-[#181B1D] font-semibold' : textColor,
          !isActive && 'group-hover:text-foreground',
        )}
      >
        {label}
      </span>

      {/* Badge */}
      {badge && (
        <span className='text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
          {badge}
        </span>
      )}
    </button>
  );
};

export default SidebarItem;
