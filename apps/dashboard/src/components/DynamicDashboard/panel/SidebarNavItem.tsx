import type { ReactElement } from 'react';

export interface SidebarNavItemProps {
  icon: ReactElement;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  trackName?: string;
}

export const SidebarNavItem = ({
  icon,
  label,
  onClick,
  disabled,
  trackName,
}: SidebarNavItemProps): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    disabled={disabled}
    title={disabled ? 'Coming soon' : undefined}
    className={`flex items-center gap-2.5 px-2.5 h-9 rounded-lg text-sm transition-colors ${
      disabled ? 'text-xyne-gray-400 cursor-default' : 'text-xyne-gray-600 hover:bg-xyne-gray-100'
    }`}
    data-track-category='DYNAMIC_DASHBOARD'
    data-track-name={trackName ?? 'Sidebar_Nav'}
  >
    <span className={disabled ? 'text-xyne-gray-300' : 'text-xyne-gray-500'}>{icon}</span>
    {label}
  </button>
);
