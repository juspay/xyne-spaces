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
  /** Renders the automation's content only — no back button, no action buttons, no click-to-edit. For side-by-side version comparisons. */
  readOnlyPreview?: boolean;
}
