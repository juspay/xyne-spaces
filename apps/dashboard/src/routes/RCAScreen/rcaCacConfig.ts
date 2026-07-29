/* eslint-disable @typescript-eslint/naming-convention */
import type { SelectOption } from './RCAScreen.types';

type RcaCategoryConfig = {
  issueCategories: string[];
  coeActions: string[];
};

type RcaBugTypeConfig = {
  categories: Record<string, RcaCategoryConfig>;
};

type SharedCoeActionConfig = {
  kind: 'quick_fix' | 'action';
  hiddenFromRegularList?: boolean;
};

export interface RcaCacConfig {
  version: number;
  bugTypes: Record<string, RcaBugTypeConfig>;
  impactTypes: string[];
  quickFixOptions: string[];
  sharedCoeActions: Record<string, SharedCoeActionConfig>;
}

const DISPLAY_LABEL_OVERRIDES: Record<string, string> = {
  ui_ux: 'UI/UX',
  p_u: 'P/U',
  n: 'N',
  c: 'C',
  sla_breach: 'SLA Breach',
  pr_release: 'PR Release',
  not_knowing_the_limits_of_the_system:
    'Not Knowing the Limits of the System - Not enough resources will fall into this category.',
  non_critical_services_affecting_critical_service:
    'Non Critical services affecting Critical service',
  no_early_detection: 'No Early Detection - No Monitoring or proactive alerts',
  backward_incompatible_changes: 'Backward Incompatible Changes - Cannot Rollback / Revert',
  exceptions_not_handled: 'Exceptions Not handled',
  external_system_issues: 'External System Issues - We do not have Control over it.',
  backward_compatible_changes: 'Backward Compatible Changes',
  staggered_releases_with_ab_monitoring: 'Staggered releases with AB Monitoring.',
  framework_approach_horizontal_global_solution:
    'Framework Approach - Horizontal Global solution than pointed solution',
  proactive_monitoring_alerts: 'Proactive Monitoring / Alerts to capture anomalies in production',
  graceful_handling_informing_user_to_come_back_later:
    'Graceful handling - Informing user to come back later, etc',
};

export const formatRcaValue = (value: string): string =>
  DISPLAY_LABEL_OVERRIDES[value] ??
  value
    .split('_')
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');

export const DEFAULT_RCA_CAC_CONFIG: RcaCacConfig = {
  version: 1,
  bugTypes: {
    reliability: {
      categories: {
        capacity: {
          issueCategories: [
            'not_knowing_the_limits_of_the_system',
            'non_critical_services_affecting_critical_service',
            'no_early_detection',
          ],
          coeActions: [
            'dynamic_scaling',
            'rate_limit',
            'timeouts',
            'internal_retries',
            'global_monitoring_and_call_alerts',
            'isolation_of_critical_vs_non_critical',
          ],
        },
        change: {
          issueCategories: [
            'backward_incompatible_changes',
            'blast_radius_not_controlled',
            'exceptions_not_handled',
          ],
          coeActions: [
            'backward_compatible_changes',
            'staggered_releases_with_ab_monitoring',
            'timeouts',
            'retries',
            'framework_approach_horizontal_global_solution',
            'proactive_monitoring_alerts',
          ],
        },
        fault: {
          issueCategories: ['external_system_issues'],
          coeActions: [
            'redundant_systems_with_failover',
            'fallback_systems',
            'graceful_handling_informing_user_to_come_back_later',
          ],
        },
      },
    },
    performance: {
      categories: {
        n: {
          issueCategories: [],
          coeActions: ['corrective', 'preventive', 'alerts'],
        },
        c: {
          issueCategories: [],
          coeActions: ['corrective', 'preventive', 'alerts'],
        },
        p_u: {
          issueCategories: [],
          coeActions: ['corrective', 'preventive', 'alerts'],
        },
      },
    },
    ui_ux: {
      categories: {
        ui_ux: {
          issueCategories: [],
          coeActions: ['corrective', 'preventive', 'alerts'],
        },
      },
    },
  },
  impactTypes: ['latency_increase', 'outage', 'revenue_loss', 'data_inconsistency', 'sla_breach'],
  quickFixOptions: ['revert', 'restart', 'pr_release', 'none'],
  sharedCoeActions: {
    quick_fixes_done: {
      kind: 'quick_fix',
      hiddenFromRegularList: true,
    },
  },
};

const toOptions = (
  values: readonly string[],
  format: (value: string) => string = formatRcaValue,
): SelectOption[] =>
  values.map(value => ({
    value,
    label: format(value),
  }));

export const getRcaBugTypeEntries = (config: RcaCacConfig): Array<[string, RcaBugTypeConfig]> =>
  Object.entries(config.bugTypes);

export const getRcaBugTypeConfig = (
  config: RcaCacConfig,
  bugTypeValue: string,
): RcaBugTypeConfig | null => config.bugTypes[bugTypeValue] ?? null;

export const getRcaBugTypeValues = (config: RcaCacConfig): string[] => Object.keys(config.bugTypes);

export const getRcaBugTypeOptions = (config: RcaCacConfig): SelectOption[] =>
  toOptions(getRcaBugTypeValues(config));

export const getRcaCategoryValues = (config: RcaCacConfig): string[] =>
  Array.from(
    new Set(
      getRcaBugTypeEntries(config).flatMap(([, bugTypeConfig]) =>
        Object.keys(bugTypeConfig.categories),
      ),
    ),
  );

export const getRcaCategoryOptions = (config: RcaCacConfig): SelectOption[] =>
  toOptions(getRcaCategoryValues(config));

export const getRcaCategoryValuesForBugType = (
  config: RcaCacConfig,
  bugTypeValue: string,
): string[] => Object.keys(getRcaBugTypeConfig(config, bugTypeValue)?.categories ?? {});

export const getRcaCategoryConfig = (
  config: RcaCacConfig,
  bugTypeValue: string,
  categoryValue: string,
): RcaCategoryConfig | null =>
  getRcaBugTypeConfig(config, bugTypeValue)?.categories[categoryValue] ?? null;

export const getRcaCategoryConfigByValue = (
  config: RcaCacConfig,
  categoryValue: string,
): RcaCategoryConfig | null => {
  for (const [, bugTypeConfig] of getRcaBugTypeEntries(config)) {
    const match = bugTypeConfig.categories[categoryValue];
    if (match) return match;
  }
  return null;
};

export const getRcaIssueCategoryValues = (
  config: RcaCacConfig,
  bugTypeValue: string,
  categoryValue: string,
): string[] => getRcaCategoryConfig(config, bugTypeValue, categoryValue)?.issueCategories ?? [];

export const getRcaIssueCategoryOptions = (
  config: RcaCacConfig,
  bugTypeValue: string,
  categoryValue: string,
): SelectOption[] => toOptions(getRcaIssueCategoryValues(config, bugTypeValue, categoryValue));

export const requiresIssueCategory = (
  config: RcaCacConfig,
  bugTypeValue: string,
  categoryValue: string,
): boolean => getRcaIssueCategoryValues(config, bugTypeValue, categoryValue).length > 0;

export const getRcaCoeActionValues = (
  config: RcaCacConfig,
  bugTypeValue: string,
  categoryValue: string,
): string[] => getRcaCategoryConfig(config, bugTypeValue, categoryValue)?.coeActions ?? [];

export const getRcaCoeActionOptions = (
  config: RcaCacConfig,
  bugTypeValue: string,
  categoryValue: string,
): SelectOption[] => toOptions(getRcaCoeActionValues(config, bugTypeValue, categoryValue));

export const getRcaImpactTypeOptions = (config: RcaCacConfig): SelectOption[] =>
  toOptions(config.impactTypes);

export const getRcaQuickFixOptions = (config: RcaCacConfig): SelectOption[] =>
  toOptions(config.quickFixOptions);

export const getSharedCoeActionValues = (config: RcaCacConfig): string[] =>
  Object.keys(config.sharedCoeActions);

export const getSharedHiddenCoeActionValues = (config: RcaCacConfig): string[] =>
  getSharedCoeActionValues(config).filter(
    actionValue => config.sharedCoeActions[actionValue]?.hiddenFromRegularList,
  );

export const getQuickFixActionValue = (config: RcaCacConfig): string | undefined =>
  getSharedCoeActionValues(config).find(
    actionValue => config.sharedCoeActions[actionValue]?.kind === 'quick_fix',
  );
