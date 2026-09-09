import { ReactNode } from 'react';

/**
 * Represents a single selectable option in the EntitySelector
 *
 * @example
 * // For a user:
 * {
 *   value: "user-123",
 *   label: "John Doe",
 *   icon: <UserAvatar userId="user-123" />,
 *   subtitle: "john@example.com"
 * }
 *
 * @example
 * // For a group:
 * {
 *   value: "group-456",
 *   label: "Engineering Team",
 *   icon: <Users className="w-4 h-4" />
 * }
 */
export interface SelectorOption {
  /** Unique identifier (e.g., user ID, group ID) */
  value: string;

  /** Display name (e.g., "John Doe", "Engineering Team") */
  label: string;

  /** Icon or avatar to display (can be any React component/element) */
  icon: ReactNode;

  /** Optional secondary text (e.g., email for users) */
  subtitle?: string | null;

  /** Whether this option is disabled and cannot be selected */
  disabled?: boolean;

  /** Whether this option represents a deactivated entity (will show gray text + Deactivated badge) */
  isDeactivated?: boolean;
  badge?: string | undefined;
}

/**
 * Props for the EntitySelector component
 */
export interface EntitySelectorProps {
  /** Array of options to display in the dropdown */
  options: SelectorOption[];

  /** Currently selected value (the option's value, or null if nothing selected) */
  selectedValue?: string | null;

  /** Callback when selection changes (receives the selected option's value, or null if cleared) */
  onSelect?: (value: string | null) => void;

  /** Placeholder text shown in button when nothing is selected (e.g., "Assign User") */
  placeholder: string;

  showSearch?: boolean;

  /** Placeholder text shown in search input (e.g., "Search users...") */
  searchPlaceholder: string;

  /** Optional: Show loading state in the dropdown */
  isLoading?: boolean;

  /** Optional: Custom width for the trigger button. Default: 'auto' */
  width?: string;

  /** Callback fired when search value changes (for server-side filtering) */
  onSearchChange?: (searchValue: string) => void;

  /** Callback fired when the options list is scrolled near the end */
  onScrollEnd?: () => void;

  /** Whether more options can be requested from the server */
  hasMore?: boolean;

  /** Controller */
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;

  /** Disable client-side filtering when server handles it */
  disableClientFiltering?: boolean;

  isStatusSelector?: boolean;

  noBorder?: boolean;

  /** Variant: 'default' = button trigger, 'inline' = input trigger */
  variant?: 'default' | 'inline';

  /** Optional inline input icon */
  showClearButton?: boolean;

  /** Optional inline input icon */
  showIndicator?: boolean;

  /** Optional: Show chevron icon in trigger button. Default: true */
  inputIcon?: React.ReactNode;

  inputClassName?: string;

  /** Optional: data-testid for automation testing */
  testId?: string;

  /** Show an "Unassign" option at the top of the dropdown when a value is selected */
  showUnassignOption?: boolean;

  /** Label for the unassign option. Default: 'Unassign' */
  unassignLabel?: string;

  /** Optional action rendered at the top of the dropdown (e.g. "Create form") */
  headerAction?: {
    label: string;
    icon?: ReactNode;
    onClick: () => void;
    trackCategory?: string;
    trackName?: string;
  };

  /** Lock the dropdown to the trigger's width instead of letting content size it. */
  matchTriggerWidth?: boolean;

  /** Opt in to virtualizing the options list (for large user/group lists). */
  virtualize?: boolean;

  /** Minimum option count before the virtualized path kicks in. Default: 30 */
  virtualizeThreshold?: number;

  /** Height (px) of the virtualized options list. Default: 300 */
  virtualizedHeight?: number;
}
