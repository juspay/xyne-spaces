import type { ReactNode } from 'react';
import type { StepCatalogItem } from '../../Automation.types';

export interface AddStepRowProps {
  catalog: StepCatalogItem[];
  onPick: (type: string) => void;
  variant?: 'full' | 'compact';
  /**
   * Replaces the round "+" button (and its connector lines) with a custom
   * trigger — used by the flow canvas for placeholders and menus.
   */
  trigger?: ReactNode;
  /** Called with the picker's open state, e.g. to keep a hover control visible. */
  onOpenChange?: (open: boolean) => void;
}
