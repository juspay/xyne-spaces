import { ReactElement, ReactNode } from 'react';
import { ChevronRight } from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import Badge from '../../ui/Badge';

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
        'w-full flex items-center gap-3 px-3 py-2 rounded-[10px] border border-transparent transition-colors group',
        'text-sm font-medium tracking-[-0.14px]',
        isActive ? 'bg-sidebar-accent' : 'bg-transparent hover:bg-sidebar-accent',
      )}
      data-track-category='Projects'
      data-track-name='SelectSidebarItem'
      data-track-metadata={JSON.stringify({
        label: typeof label === 'string' ? label : 'highlighted-text',
        isActive,
      })}
    >
      {/* Icon */}
      {renderLeadingElement()}

      <span
        className={cn(
          'flex-1 min-w-0 text-left truncate block',
          isActive ? 'text-sidebar-accent-foreground' : textColor,
          !isActive && 'group-hover:text-sidebar-accent-foreground',
        )}
      >
        {label}
      </span>

      {/* Badge */}
      {badge && (
        <Badge className='order-last font-mono h-[18px] bg-sidebar-primary border border-sidebar-accent-ring px-1.5 text-sidebar-primary-foreground'>
          {badge}
        </Badge>
      )}
    </button>
  );
};

export default SidebarItem;
