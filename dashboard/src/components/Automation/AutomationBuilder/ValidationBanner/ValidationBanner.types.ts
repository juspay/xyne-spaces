import type { ValidationResult } from '../../Automation.types';

export interface ValidationBannerProps {
  result: ValidationResult | null;
  isSaving?: boolean;
  errorMessage?: string | null;
}
