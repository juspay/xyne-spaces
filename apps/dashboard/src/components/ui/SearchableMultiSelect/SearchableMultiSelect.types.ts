import type { ReactNode } from 'react';

export interface SearchableMultiSelectOption {
  /** Stable identifier reported back through `onSelectedValuesChange`. */
  value: string;

  /** Row text, also what the search query is matched against. */
  label: string;

  /** Leading visual for the row (colour dot, avatar, icon). */
  icon?: ReactNode;
}

export interface SearchableMultiSelectProps {
  options: SearchableMultiSelectOption[];

  selectedValues: string[];

  onSelectedValuesChange: (values: string[]) => void;

  /** Element the popover anchors to, rendered as the popover trigger. */
  trigger: ReactNode;

  /** Controlled open state, so the trigger can render its own open/closed affordance. */
  isOpen: boolean;

  onOpenChange: (isOpen: boolean) => void;

  searchPlaceholder?: string;

  searchMaxLength?: number;

  /** Accessible name for the search box (e.g. 'Search labels'). */
  searchAriaLabel: string;

  /** Accessible name for the option list (e.g. 'Labels'). */
  listAriaLabel: string;

  /** Shown when the search query matches nothing. Default: 'No results found'. */
  emptyMessage?: string;

  /**
   * Enables a "Create …" row whenever the typed query has no exact match.
   * Omit to keep the list read-only.
   */
  onCreateOption?: (value: string) => void;

  align?: 'start' | 'center' | 'end';

  className?: string;

  /** Analytics attributes stamped on every option row. */
  trackCategory?: string;
  trackName?: string;
}
