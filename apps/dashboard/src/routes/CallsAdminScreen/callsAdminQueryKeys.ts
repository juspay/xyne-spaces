import type {
  CallAdminCallFilters,
  CallAdminSeriesFilters,
} from '../../services/Call/callAdminService';

export const callsAdminPrefix = ['calls-admin'] as const;

export const callsAdminCallsKey = (filters: CallAdminCallFilters) =>
  [...callsAdminPrefix, 'calls', filters] as const;

export const callsAdminSeriesKey = (filters: CallAdminSeriesFilters) =>
  [...callsAdminPrefix, 'series', filters] as const;
