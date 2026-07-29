import type { StepCatalogItem } from '../../Automation.types';

export interface AddStepRowProps {
  catalog: StepCatalogItem[];
  onPick: (type: string) => void;
  variant?: 'full' | 'compact';
}
