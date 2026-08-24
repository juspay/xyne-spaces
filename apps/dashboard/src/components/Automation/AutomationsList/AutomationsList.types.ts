import type { Automation } from '../Automation.types';

export interface AutomationsListProps {
  onCreate: () => void;
  onOpen: (automation: Automation) => void;
  onShowRuns?: (automation: Automation) => void;
  /** When provided, only automations passing this predicate are shown (and counted). */
  filterPredicate?: (automation: Automation) => boolean;
  /** Embedded hosts must supply both, or the defaults navigate away to /automations/*. */
  onFork?: (automation: Automation, mode: 'fork' | 'clone') => void;
  onShowApprovals?: () => void;
}
