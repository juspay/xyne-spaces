import type { Automation } from '../Automation.types';

export interface AutomationsListProps {
  onCreate: () => void;
  onOpen: (automation: Automation) => void;
  onShowRuns?: (automation: Automation) => void;
}
