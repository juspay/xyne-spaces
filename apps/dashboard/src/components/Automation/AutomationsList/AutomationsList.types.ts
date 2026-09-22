import type { Automation } from '../Automation.types';

export interface AutomationsListProps {
  onCreate: () => void;
  onOpen: (automation: Automation) => void;
  onShowRuns?: (automation: Automation) => void;
  /** Preselects the Channel filter chip (e.g. a Desk settings tab scoped to one channel). Still user-adjustable. */
  initialChannelIds?: string[];
  /** Row menu "Clone" / "Edit" (non-draft). Default navigates `/automations/new?fork=<id>` (that route only) — pass these to handle it locally instead (e.g. a settings modal with its own view-state). */
  onClone?: (automation: Automation) => void;
  onEditFork?: (automation: Automation) => void;
}
