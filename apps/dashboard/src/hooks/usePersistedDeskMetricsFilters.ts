import { useState, useCallback } from 'react';
import { type DateRangeValue } from '../components/ui/DateRangeFilter';
import { TicketPriority } from '@xyne/shared';

type RangeLabel =
  | 'Today'
  | 'Yesterday'
  | 'Last 7 days'
  | 'Last 30 days'
  | 'Last 60 days'
  | 'Last 90 days'
  | 'custom';

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
  const s60 = new Date(today);
  s60.setDate(s60.getDate() - 59);
  const s90 = new Date(today);
  s90.setDate(s90.getDate() - 89);
  if (isSameDay(dr.startDate, today) && isSameDay(dr.endDate, today)) return 'Today';
  if (isSameDay(dr.startDate, yest) && isSameDay(dr.endDate, yest)) return 'Yesterday';
  if (isSameDay(dr.startDate, s7) && isSameDay(dr.endDate, today)) return 'Last 7 days';
  if (isSameDay(dr.startDate, s30) && isSameDay(dr.endDate, today)) return 'Last 30 days';
  if (isSameDay(dr.startDate, s60) && isSameDay(dr.endDate, today)) return 'Last 60 days';
  if (isSameDay(dr.startDate, s90) && isSameDay(dr.endDate, today)) return 'Last 90 days';
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
    case 'Last 60 days': {
      const s = new Date(today);
      s.setDate(s.getDate() - 59);
      return { startDate: startOfDay(s), endDate: endOfDay(today) };
    }
    case 'Last 90 days': {
      const s = new Date(today);
      s.setDate(s.getDate() - 89);
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

const isTicketPriorityArray = (v: unknown): v is TicketPriority[] =>
  isStringArray(v) &&
  v.every(priority => Object.values(TicketPriority).includes(priority as TicketPriority));

const isPerKeyValues = (v: unknown): v is Record<string, string[]> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(isStringArray);

const CHART_VIEWS = ['priority', 'trend', 'assignee', 'tags'] as const;
export type ChartView = (typeof CHART_VIEWS)[number];

const isChartView = (value: unknown): value is ChartView =>
  CHART_VIEWS.includes(value as ChartView);

const ACTIVE_TABS = ['overview', 'agents', 'desks'] as const;
export type ActiveTab = (typeof ACTIVE_TABS)[number];

const isActiveTab = (value: unknown): value is ActiveTab =>
  ACTIVE_TABS.includes(value as ActiveTab);

interface StoredFilters {
  rangeLabel: RangeLabel;
  customStart?: string;
  customEnd?: string;
  startTime: string;
  endTime: string;
  selectedAssigneeIds: string[];
  selectedStageNames: string[];
  selectedPriorities: TicketPriority[];
  selectedUserGroupIds: string[];
  selectedTagCategory: string | null;
  selectedTagValues: string[];
  selectedAiCategories: string[];
  // Per-field selected values or text terms: { Tag: ['EMI', 'UPI'], Tone: ['Neutral'] }
  selectedCustomFieldValues: Record<string, string[]>;
  comparedChannelIds: string[];
  chartView: ChartView;
  activeTab: ActiveTab;
}

const DEFAULT_STORED: StoredFilters = {
  rangeLabel: 'Last 7 days',
  startTime: '00:00',
  endTime: '23:59',
  selectedAssigneeIds: [],
  selectedStageNames: [],
  selectedPriorities: [],
  selectedUserGroupIds: [],
  selectedTagCategory: null,
  selectedTagValues: [],
  selectedAiCategories: [],
  selectedCustomFieldValues: {},
  comparedChannelIds: [],
  chartView: 'priority',
  activeTab: 'overview',
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
      'Last 60 days',
      'Last 90 days',
      'custom',
    ];
    const result: StoredFilters = {
      rangeLabel: validLabels.includes(p['rangeLabel'] as RangeLabel)
        ? (p['rangeLabel'] as RangeLabel)
        : DEFAULT_STORED.rangeLabel,
      startTime: typeof p['startTime'] === 'string' ? p['startTime'] : DEFAULT_STORED.startTime,
      endTime: typeof p['endTime'] === 'string' ? p['endTime'] : DEFAULT_STORED.endTime,
      selectedAssigneeIds: isStringArray(p['selectedAssigneeIds'])
        ? p['selectedAssigneeIds']
        : typeof p['selectedAssigneeId'] === 'string'
          ? [p['selectedAssigneeId']]
          : [],
      selectedStageNames: isStringArray(p['selectedStageNames']) ? p['selectedStageNames'] : [],
      selectedPriorities: isTicketPriorityArray(p['selectedPriorities'])
        ? p['selectedPriorities']
        : [],
      selectedUserGroupIds: isStringArray(p['selectedUserGroupIds'])
        ? p['selectedUserGroupIds']
        : [],
      selectedTagCategory:
        typeof p['selectedTagCategory'] === 'string' ? p['selectedTagCategory'] : null,
      selectedTagValues: isStringArray(p['selectedTagValues']) ? p['selectedTagValues'] : [],
      selectedAiCategories: isStringArray(p['selectedAiCategories'])
        ? p['selectedAiCategories']
        : [],
      // Handle migration from old string[] format → default to empty
      selectedCustomFieldValues: isPerKeyValues(p['selectedCustomFieldValues'])
        ? p['selectedCustomFieldValues']
        : {},
      comparedChannelIds: isStringArray(p['comparedChannelIds']) ? p['comparedChannelIds'] : [],
      chartView: isChartView(p['chartView']) ? p['chartView'] : DEFAULT_STORED.chartView,
      activeTab: isActiveTab(p['activeTab']) ? p['activeTab'] : DEFAULT_STORED.activeTab,
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
  selectedAssigneeIds: string[];
  selectedStageNames: string[];
  selectedPriorities: TicketPriority[];
  selectedUserGroupIds: string[];
  selectedTagCategory: string | null;
  selectedTagValues: string[];
  selectedAiCategories: string[];
  selectedCustomFieldValues: Record<string, string[]>;
  comparedChannelIds: string[];
  chartView: ChartView;
  activeTab: ActiveTab;
  setDateRange: (dr: DateRangeValue, st: string, et: string) => void;
  setSelectedAssigneeIds: (ids: string[]) => void;
  setSelectedStageNames: (names: string[]) => void;
  setSelectedPriorities: (priorities: TicketPriority[]) => void;
  setSelectedUserGroupIds: (ids: string[]) => void;
  setSelectedTagCategory: (cat: string | null) => void;
  setSelectedTagValues: (vals: string[]) => void;
  setSelectedAiCategories: (categories: string[]) => void;
  setSelectedCustomFieldValues: (vals: Record<string, string[]>) => void;
  setComparedChannelIds: (ids: string[]) => void;
  setChartView: (view: ChartView) => void;
  setActiveTab: (tab: ActiveTab) => void;
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

  const setSelectedAssigneeIds = useCallback(
    (ids: string[]) => {
      persist(prev => ({ ...prev, selectedAssigneeIds: ids }));
    },
    [persist],
  );

  const setSelectedStageNames = useCallback(
    (names: string[]) => {
      persist(prev => ({ ...prev, selectedStageNames: names }));
    },
    [persist],
  );

  const setSelectedPriorities = useCallback(
    (priorities: TicketPriority[]) => {
      persist(prev => ({ ...prev, selectedPriorities: priorities }));
    },
    [persist],
  );

  const setSelectedUserGroupIds = useCallback(
    (ids: string[]) => {
      persist(prev => ({ ...prev, selectedUserGroupIds: ids }));
    },
    [persist],
  );

  const setSelectedTagCategory = useCallback(
    (cat: string | null) => {
      // Changing category always clears specific tag selections
      persist(prev => ({ ...prev, selectedTagCategory: cat, selectedTagValues: [] }));
    },
    [persist],
  );

  const setSelectedTagValues = useCallback(
    (vals: string[]) => {
      persist(prev => ({ ...prev, selectedTagValues: vals }));
    },
    [persist],
  );

  const setSelectedAiCategories = useCallback(
    (categories: string[]) => {
      persist(prev => ({ ...prev, selectedAiCategories: categories }));
    },
    [persist],
  );

  const setSelectedCustomFieldValues = useCallback(
    (vals: Record<string, string[]>) => {
      persist(prev => ({ ...prev, selectedCustomFieldValues: vals }));
    },
    [persist],
  );

  const setComparedChannelIds = useCallback(
    (ids: string[]) => {
      const extras = [...new Set(ids.filter(id => id !== channelId))];
      persist(prev => ({ ...prev, comparedChannelIds: extras }));
    },
    [persist, channelId],
  );

  const setChartView = useCallback(
    (view: ChartView) => {
      persist(prev => ({ ...prev, chartView: view }));
    },
    [persist],
  );

  const setActiveTab = useCallback(
    (tab: ActiveTab) => {
      persist(prev => ({ ...prev, activeTab: tab }));
    },
    [persist],
  );

  return {
    dateRange,
    startTime: stored.startTime,
    endTime: stored.endTime,
    selectedAssigneeIds: stored.selectedAssigneeIds,
    selectedStageNames: stored.selectedStageNames,
    selectedPriorities: stored.selectedPriorities,
    selectedUserGroupIds: stored.selectedUserGroupIds,
    selectedTagCategory: stored.selectedTagCategory,
    selectedTagValues: stored.selectedTagValues,
    selectedAiCategories: stored.selectedAiCategories,
    selectedCustomFieldValues: stored.selectedCustomFieldValues,
    comparedChannelIds: stored.comparedChannelIds,
    chartView: stored.chartView,
    activeTab: stored.activeTab,
    setDateRange,
    setSelectedAssigneeIds,
    setSelectedStageNames,
    setSelectedPriorities,
    setSelectedUserGroupIds,
    setSelectedTagCategory,
    setSelectedTagValues,
    setSelectedAiCategories,
    setSelectedCustomFieldValues,
    setComparedChannelIds,
    setChartView,
    setActiveTab,
  };
};
