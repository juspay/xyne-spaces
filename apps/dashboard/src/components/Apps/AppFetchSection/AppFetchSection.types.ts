import type {
  AppFetchConfig,
  AppFetchResponseMapping,
  FetchConfigTestResult,
} from '../../../services/Apps/appsService';

export interface AppFetchSectionProps {
  installedAppId: string;
  /** Hides every control that writes, for XYNE-APPS READ holders. */
  readOnly?: boolean;
}

/**
 * The form's working value. Untyped because that is what WebhookStepForm takes —
 * it is the same config blob an automation step holds, and the server validates
 * it against AppFetchConfigSchema on save.
 */
export type AppFetchFormValue = Record<string, unknown>;

export type { AppFetchConfig, AppFetchResponseMapping, FetchConfigTestResult };
