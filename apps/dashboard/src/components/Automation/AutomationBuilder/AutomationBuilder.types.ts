import type { Automation, AutomationConfig, ValidationResult } from '../Automation.types';

export interface AutomationBuilderProps {
  automation: Automation | null;
  initialConfig?: AutomationConfig;
  /** Seeded + pinned per trigger-type pick. Not `initialConfig` — picking a type resets config. */
  scopeDefaults?: Record<string, string[]>;
  initialName?: string;
  initialDescription?: string;
  forkFromSeriesId?: string;
  forkSourceAutomationId?: string;
  onSaved?: (result: { automation: Automation; validation: ValidationResult }) => void;
  approvalReviewMode?: boolean;
  onAfterApprovalDecision?: () => void;
  onBack: () => void;
  onShowRuns?: (automationId: string) => void;
  /** Embedded hosts must supply both, or the defaults navigate away to /automations. */
  onFork?: (automationId: string, mode: 'fork' | 'clone') => void;
  onOpenAutomation?: (automationId: string) => void;
}
