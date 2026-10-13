import { useSelector } from '@xstate/react';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { stateMachineActor } from '../machines/stateMachine';

/** The code-backed "Default summary" template that has no database row. */
export const DEFAULT_SUMMARY_TEMPLATE_ID = 'default';

/**
 * The summary template every new recording uses, synced through `user_preferences`
 * (`recordingDefaultSummaryTemplateId`; calls may get their own column later).
 * `null` means every new recording gets the automatic template pick.
 */
export const useRecordingDefaultSummaryTemplate = (): {
  defaultSummaryTemplateId: string | null;
  setDefaultSummaryTemplateId: (templateId: string | null) => void;
} => {
  const zero = useZero();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);

  const setDefaultSummaryTemplateId = (templateId: string | null): void => {
    void zero.mutate(
      mutators.userPreference.setRecordingDefaultSummaryTemplate({
        id: userPreference?.id ?? crypto.randomUUID(),
        recordingDefaultSummaryTemplateId: templateId,
        timestamp: Date.now(),
      }),
    );
  };

  return {
    defaultSummaryTemplateId: userPreference?.recordingDefaultSummaryTemplateId ?? null,
    setDefaultSummaryTemplateId,
  };
};

/**
 * The "Set as default" offer on a template switch is shown once per browser,
 * like the other one-time hints; the setting itself always lives in Preferences.
 */
export const DEFAULT_SUMMARY_TEMPLATE_NUDGE_KEY = 'xyne:default-summary-template-nudge-shown';

export const hasShownDefaultSummaryTemplateNudge = (): boolean => {
  try {
    return localStorage.getItem(DEFAULT_SUMMARY_TEMPLATE_NUDGE_KEY) === 'true';
  } catch {
    return true;
  }
};

export const markDefaultSummaryTemplateNudgeShown = (): void => {
  try {
    localStorage.setItem(DEFAULT_SUMMARY_TEMPLATE_NUDGE_KEY, 'true');
  } catch {
    // Storage unavailable: the nudge may show again next time, which is harmless.
  }
};
