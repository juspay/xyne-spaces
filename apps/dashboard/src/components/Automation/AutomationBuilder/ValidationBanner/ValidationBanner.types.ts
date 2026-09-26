import type { ValidationIssue, ValidationResult } from '../../Automation.types';

export interface ValidationBannerProps {
  result: ValidationResult | null;
  isSaving?: boolean;
  errorMessage?: string | null;
  /** When set, each issue becomes a button that jumps to the offending step. */
  onIssueClick?: (issue: ValidationIssue) => void;
}
