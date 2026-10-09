import { globalClickTracker } from '../../../services/Analytics/globalClickTracker';

/**
 * Analytics for the desk settings form. Field *names* only — prompts,
 * aliases, CC addresses and signature bodies are user content and never
 * leave the client through tracking.
 */

/** Boolean preferences whose flips are reported as FEATURE_TOGGLED. */
export const DESK_FEATURE_FIELDS = {
  autoAIDraft: 'auto_draft',
  autoMergeEmails: 'auto_merge',
  twoStepSendEnabled: 'two_step_send',
  metricsEnabled: 'metrics',
  deskReportEnabled: 'desk_report',
  appWebhookDeliveryEnabled: 'app_webhook',
} as const;

export type DeskFeature =
  | (typeof DESK_FEATURE_FIELDS)[keyof typeof DESK_FEATURE_FIELDS]
  | 'classification'
  | 'priority_classification';

/** Keys whose value differs between two flat snapshots. */
export function changedKeys<T extends Record<string, unknown>>(draft: T, server: T): string[] {
  return Object.keys(server).filter(k => !Object.is(draft[k], server[k]));
}

export interface DeskSettingsSaveTrack {
  deskType: string | null | undefined;
  channelId: string;
  tab: string | undefined;
  changedFields: string[];
  latencyMs: number;
}

export function trackDeskSettingsSaved(args: DeskSettingsSaveTrack): void {
  globalClickTracker.trackManualEvent('DeskSettings', 'SETTINGS_SAVED', undefined, {
    ...(args.deskType && { deskType: args.deskType }),
    channelId: args.channelId,
    ...(args.tab && { tab: args.tab }),
    changedFields: args.changedFields,
    changedCount: args.changedFields.length,
    latencyMs: args.latencyMs,
  });
}

export function trackDeskSettingsSaveFailed(
  args: DeskSettingsSaveTrack & { errorKind: string },
): void {
  globalClickTracker.trackManualEvent('DeskSettings', 'SETTINGS_SAVE_FAILED', undefined, {
    ...(args.deskType && { deskType: args.deskType }),
    channelId: args.channelId,
    ...(args.tab && { tab: args.tab }),
    changedFields: args.changedFields,
    changedCount: args.changedFields.length,
    latencyMs: args.latencyMs,
    errorKind: args.errorKind,
  });
}

export function trackDeskFeatureToggled(args: {
  feature: DeskFeature;
  to: boolean;
  deskType: string | null | undefined;
  channelId: string;
  agentSlug?: string | null | undefined;
}): void {
  globalClickTracker.trackManualEvent('DeskSettings', 'FEATURE_TOGGLED', undefined, {
    feature: args.feature,
    to: args.to,
    ...(args.deskType && { deskType: args.deskType }),
    channelId: args.channelId,
    ...(args.agentSlug && { agentSlug: args.agentSlug }),
  });
}

export function errorKindOf(err: unknown): string {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  if (typeof status === 'number') return `http_${status}`;
  return err instanceof Error ? err.name : 'unknown';
}
