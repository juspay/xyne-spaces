import type { Automation, AutomationConfig, ValidationResult } from '../Automation.types';

export interface AutomationBuilderProps {
  automation: Automation | null;
  initialConfig?: AutomationConfig;
  initialName?: string;
  initialDescription?: string;
  forkFromSeriesId?: string;
  forkSourceAutomationId?: string;
  onSaved?: (result: { automation: Automation; validation: ValidationResult }) => void;
  approvalReviewMode?: boolean;
  onAfterApprovalDecision?: () => void;
  onBack: () => void;
  onShowRuns?: (automationId: string) => void;
  onShowVersionHistory?: (automationId: string) => void;
  /** "Propose change" on a live automation. Default navigates `../new?fork=<id>` (routed context only) — pass this to handle it locally instead (e.g. a modal/tab with its own view-state). */
  onProposeChange?: (source: Automation) => void;
  /** Cancelling a fork-in-progress (started via `onProposeChange`) — same routing caveat as above. */
  onCancelFork?: (sourceAutomationId: string) => void;
  /** Renders the automation's content only — no back button, no action buttons, no click-to-edit. For side-by-side version comparisons. */
  readOnlyPreview?: boolean;
}
