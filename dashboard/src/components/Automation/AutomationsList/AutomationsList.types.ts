import type { Automation } from '../Automation.types';

export interface AutomationsListProps {
  onCreate: () => void;
  onOpen: (automation: Automation) => void;
  onShowRuns?: (automation: Automation) => void;
  /** When provided, only automations passing this predicate are shown (and counted). */
  filterPredicate?: (automation: Automation) => boolean;
}
