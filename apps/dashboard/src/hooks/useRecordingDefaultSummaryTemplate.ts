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
 * The "Set as default" offer appears once a user keeps switching to the same
 * template: after more than `DEFAULT_SUMMARY_TEMPLATE_OFFER_SWITCHES` switches,
 * and again every that-many switches after a "Not now". Counts are per browser,
 * like the other one-time hints; the setting itself always lives in Preferences.
 */
export const DEFAULT_SUMMARY_TEMPLATE_OFFER_SWITCHES = 5;
export const SUMMARY_TEMPLATE_SWITCHES_KEY = 'xyne:summary-template-switches';

interface TemplateSwitchRecord {
  count: number;
  /** The `count` at which the offer was last shown; 0 means never. */
  offeredAt: number;
}

type TemplateSwitchMap = Record<string, TemplateSwitchRecord>;

const readSwitches = (): TemplateSwitchMap => {
  try {
    const raw = localStorage.getItem(SUMMARY_TEMPLATE_SWITCHES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const map: TemplateSwitchMap = {};
    for (const [templateId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const record = value as Partial<TemplateSwitchRecord> | null;
      map[templateId] = {
        count: typeof record?.count === 'number' ? record.count : 0,
        offeredAt: typeof record?.offeredAt === 'number' ? record.offeredAt : 0,
      };
    }
    return map;
  } catch {
    return {};
  }
};

const writeSwitches = (map: TemplateSwitchMap): void => {
  try {
    localStorage.setItem(SUMMARY_TEMPLATE_SWITCHES_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable: the count simply does not accumulate on this device.
  }
};

const getSwitchRecord = (map: TemplateSwitchMap, templateId: string): TemplateSwitchRecord =>
  map[templateId] ?? { count: 0, offeredAt: 0 };

/** Counts one more switch to the template and returns the new total. */
export const recordSummaryTemplateSwitch = (templateId: string): number => {
  const map = readSwitches();
  const record = getSwitchRecord(map, templateId);
  const next = { ...record, count: record.count + 1 };
  writeSwitches({ ...map, [templateId]: next });
  return next.count;
};

/** More than the threshold of switches, and the threshold again since the last offer. */
export const shouldOfferDefaultSummaryTemplate = (templateId: string): boolean => {
  const { count, offeredAt } = getSwitchRecord(readSwitches(), templateId);
  return (
    count > DEFAULT_SUMMARY_TEMPLATE_OFFER_SWITCHES &&
    count - offeredAt >= DEFAULT_SUMMARY_TEMPLATE_OFFER_SWITCHES
  );
};

/** Remembers that the offer was shown at the current count, which snoozes it. */
export const markDefaultSummaryTemplateOffered = (templateId: string): void => {
  const map = readSwitches();
  const record = getSwitchRecord(map, templateId);
  writeSwitches({ ...map, [templateId]: { ...record, offeredAt: record.count } });
};
