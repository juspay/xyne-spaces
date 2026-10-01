import type { ValidationResult } from '../../Automation.types';

export interface ValidationBannerProps {
  result: ValidationResult | null;
  isSaving?: boolean;
  errorMessage?: string | null;
  /** Clicking an issue jumps to the step or section it belongs to. */
  onIssueClick?: (path: string) => void;
}
