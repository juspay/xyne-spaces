import type { StepCatalogItem } from '../../Automation.types';

export interface AddStepRowProps {
  catalog: StepCatalogItem[];
  onPick: (type: string) => void;
  variant?: 'full' | 'compact';
  /** Step types shown greyed out and not pickable. */
  disabledTypes?: readonly string[];
  /** Tooltip explaining why a disabled step cannot be picked here. */
  disabledHint?: string;
}
