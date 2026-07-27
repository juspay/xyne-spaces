import { useState, useCallback } from 'react';
import { type DateRangeValue } from '../components/ui/DateRangeFilter';

type RangeLabel = 'Today' | 'Yesterday' | 'Last 7 days' | 'Last 30 days' | 'custom';

const startOfDay = (d: Date): Date => {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
};
const endOfDay = (d: Date): Date => {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
};
const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const detectLabel = (dr: DateRangeValue): RangeLabel => {
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const s7 = new Date(today);
  s7.setDate(s7.getDate() - 6);
  const s30 = new Date(today);
  s30.setDate(s30.getDate() - 29);
  if (isSameDay(dr.startDate, today) && isSameDay(dr.endDate, today)) return 'Today';
  if (isSameDay(dr.startDate, yest) && isSameDay(dr.endDate, yest)) return 'Yesterday';
  if (isSameDay(dr.startDate, s7) && isSameDay(dr.endDate, today)) return 'Last 7 days';
  if (isSameDay(dr.startDate, s30) && isSameDay(dr.endDate, today)) return 'Last 30 days';
  return 'custom';
};

const rangeFromLabel = (
  label: RangeLabel,
  customStart?: string,
  customEnd?: string,
): DateRangeValue => {
  const today = new Date();
  switch (label) {
    case 'Today':
      return { startDate: startOfDay(today), endDate: endOfDay(today) };
    case 'Yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { startDate: startOfDay(y), endDate: endOfDay(y) };
    }
    case 'Last 7 days': {
      const s = new Date(today);
      s.setDate(s.getDate() - 6);
      return { startDate: startOfDay(s), endDate: endOfDay(today) };
    }
    case 'Last 30 days': {
      const s = new Date(today);
      s.setDate(s.getDate() - 29);
      return { startDate: startOfDay(s), endDate: endOfDay(today) };
    }
    case 'custom':
      return {
        startDate: customStart ? new Date(customStart) : startOfDay(today),
        endDate: customEnd ? new Date(customEnd) : endOfDay(today),
      };
  }
};

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(x => typeof x === 'string');

const isPerKeyValues = (v: unknown): v is Record<string, string[]> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(isStringArray);

interface StoredFilters {
  rangeLabel: RangeLabel;
  customStart?: string;
  customEnd?: string;
  startTime: string;
  endTime: string;
  selectedAssigneeId: string | null;
  selectedCustomFieldKeys: string[];
  // Per-key checkbox selections: { Tag: ['EMI', 'UPI'], Tone: ['Neutral'] }
  selectedCustomFieldValues: Record<string, string[]>;
}

const DEFAULT_STORED: StoredFilters = {
  rangeLabel: 'Last 7 days',
  startTime: '00:00',
  endTime: '23:59',
  selectedAssigneeId: null,
  selectedCustomFieldKeys: [],
  selectedCustomFieldValues: {},
};

const readStorage = (key: string): StoredFilters => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_STORED;
    const p = JSON.parse(raw) as Record<string, unknown>;
    const validLabels: RangeLabel[] = [
      'Today',
      'Yesterday',
      'Last 7 days',
      'Last 30 days',
      'custom',
    ];
    const result: StoredFilters = {
      rangeLabel: validLabels.includes(p['rangeLabel'] as RangeLabel)
        ? (p['rangeLabel'] as RangeLabel)
        : DEFAULT_STORED.rangeLabel,
      startTime: typeof p['startTime'] === 'string' ? p['startTime'] : DEFAULT_STORED.startTime,
      endTime: typeof p['endTime'] === 'string' ? p['endTime'] : DEFAULT_STORED.endTime,
      selectedAssigneeId:
        typeof p['selectedAssigneeId'] === 'string' ? p['selectedAssigneeId'] : null,
      selectedCustomFieldKeys: isStringArray(p['selectedCustomFieldKeys'])
        ? p['selectedCustomFieldKeys']
        : [],
      // Handle migration from old string[] format → default to empty
      selectedCustomFieldValues: isPerKeyValues(p['selectedCustomFieldValues'])
        ? p['selectedCustomFieldValues']
        : {},
    };
    if (typeof p['customStart'] === 'string') result.customStart = p['customStart'];
    if (typeof p['customEnd'] === 'string') result.customEnd = p['customEnd'];
    return result;
  } catch {
    return DEFAULT_STORED;
  }
};

const writeStorage = (key: string, filters: StoredFilters): void => {
  try {
    localStorage.setItem(key, JSON.stringify(filters));
  } catch {
    /* quota / private mode */
  }
};

export interface PersistedDeskMetricsFilters {
  dateRange: DateRangeValue;
  startTime: string;
  endTime: string;
  selectedAssigneeId: string | null;
  selectedCustomFieldKeys: string[];
  selectedCustomFieldValues: Record<string, string[]>;
  setDateRange: (dr: DateRangeValue, st: string, et: string) => void;
  setSelectedAssigneeId: (id: string | null) => void;
  setSelectedCustomFieldKeys: (keys: string[]) => void;
  setSelectedCustomFieldValues: (vals: Record<string, string[]>) => void;
}

export const usePersistedDeskMetricsFilters = (
  userId: string | undefined,
  channelId: string,
): PersistedDeskMetricsFilters => {
  const storageKey = userId ? `desk-metrics-filters-${userId}-${channelId}` : null;

  const [stored, setStored] = useState<StoredFilters>(() =>
    storageKey ? readStorage(storageKey) : DEFAULT_STORED,
  );

  const persist = useCallback(
    (updater: (prev: StoredFilters) => StoredFilters) => {
      setStored(prev => {
        const next = updater(prev);
        if (storageKey) writeStorage(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const dateRange = rangeFromLabel(stored.rangeLabel, stored.customStart, stored.customEnd);

  const setDateRange = useCallback(
    (dr: DateRangeValue, st: string, et: string) => {
      const label = detectLabel(dr);
      persist(prev => {
        const next: StoredFilters = { ...prev, rangeLabel: label, startTime: st, endTime: et };
        if (label === 'custom') {
          next.customStart = dr.startDate.toISOString();
          next.customEnd = dr.endDate.toISOString();
        } else {
          delete next.customStart;
          delete next.customEnd;
        }
        return next;
      });
    },
    [persist],
  );

  const setSelectedAssigneeId = useCallback(
    (id: string | null) => {
      persist(prev => ({ ...prev, selectedAssigneeId: id }));
    },
    [persist],
  );

  const setSelectedCustomFieldKeys = useCallback(
    (keys: string[]) => {
      persist(prev => ({ ...prev, selectedCustomFieldKeys: keys }));
    },
    [persist],
  );

  const setSelectedCustomFieldValues = useCallback(
    (vals: Record<string, string[]>) => {
      persist(prev => ({ ...prev, selectedCustomFieldValues: vals }));
    },
    [persist],
  );

  return {
    dateRange,
    startTime: stored.startTime,
    endTime: stored.endTime,
    selectedAssigneeId: stored.selectedAssigneeId,
    selectedCustomFieldKeys: stored.selectedCustomFieldKeys,
    selectedCustomFieldValues: stored.selectedCustomFieldValues,
    setDateRange,
    setSelectedAssigneeId,
    setSelectedCustomFieldKeys,
    setSelectedCustomFieldValues,
  };
};
