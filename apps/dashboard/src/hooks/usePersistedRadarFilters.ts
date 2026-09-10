import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type RadarTimeRange = 'any' | 'today' | '7d' | '30d' | 'custom';

const TIME_RANGES: RadarTimeRange[] = ['any', 'today', '7d', '30d', 'custom'];

/** What survives a reload. The transient bits of the panel — which rail tab is
 *  open, the picker search boxes, the calendar's visible month — are not here:
 *  they describe the popover, not the feed the user chose to look at. */
export interface RadarFilters {
  pendingMe: boolean;
  pendingOthers: boolean;
  pendingUsers: Set<string>;
  requestedByUsers: Set<string>;
  filterChannels: Set<string>;
  timeRange: RadarTimeRange;
  customFrom: string;
  customTo: string;
}

const DEFAULT_FILTERS: RadarFilters = {
  pendingMe: true,
  pendingOthers: true,
  pendingUsers: new Set(),
  requestedByUsers: new Set(),
  filterChannels: new Set(),
  timeRange: 'any',
  customFrom: '',
  customTo: '',
};

const STORAGE_PREFIX = 'xyne:radar-filters';

const storageKeyFor = (userId: string): string => `${STORAGE_PREFIX}:${userId}`;

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(x => typeof x === 'string');

const toSet = (v: unknown): Set<string> => (isStringArray(v) ? new Set(v) : new Set());

const readStorage = (key: string): RadarFilters => {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return DEFAULT_FILTERS;
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      pendingMe: typeof p['pendingMe'] === 'boolean' ? p['pendingMe'] : DEFAULT_FILTERS.pendingMe,
      pendingOthers:
        typeof p['pendingOthers'] === 'boolean'
          ? p['pendingOthers']
          : DEFAULT_FILTERS.pendingOthers,
      pendingUsers: toSet(p['pendingUsers']),
      requestedByUsers: toSet(p['requestedByUsers']),
      filterChannels: toSet(p['filterChannels']),
      timeRange: TIME_RANGES.includes(p['timeRange'] as RadarTimeRange)
        ? (p['timeRange'] as RadarTimeRange)
        : DEFAULT_FILTERS.timeRange,
      customFrom: typeof p['customFrom'] === 'string' ? p['customFrom'] : '',
      customTo: typeof p['customTo'] === 'string' ? p['customTo'] : '',
    };
  } catch {
    return DEFAULT_FILTERS;
  }
};

const writeStorage = (key: string, filters: RadarFilters): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        pendingMe: filters.pendingMe,
        pendingOthers: filters.pendingOthers,
        pendingUsers: [...filters.pendingUsers],
        requestedByUsers: [...filters.requestedByUsers],
        filterChannels: [...filters.filterChannels],
        timeRange: filters.timeRange,
        customFrom: filters.customFrom,
        customTo: filters.customTo,
      }),
    );
  } catch {
    // Quota or private mode — the filters still hold for this session.
  }
};

export interface PersistedRadarFilters extends RadarFilters {
  setPendingMe: Dispatch<SetStateAction<boolean>>;
  setPendingOthers: Dispatch<SetStateAction<boolean>>;
  setPendingUsers: Dispatch<SetStateAction<Set<string>>>;
  setRequestedByUsers: Dispatch<SetStateAction<Set<string>>>;
  setFilterChannels: Dispatch<SetStateAction<Set<string>>>;
  setTimeRange: Dispatch<SetStateAction<RadarTimeRange>>;
  setCustomFrom: Dispatch<SetStateAction<string>>;
  setCustomTo: Dispatch<SetStateAction<string>>;
  clearAllFilters: () => void;
}

/**
 * Radar's filter selection, mirrored to localStorage per user so the feed comes
 * back the way it was left instead of resetting to everything on every visit.
 */
export const usePersistedRadarFilters = (userId: string | undefined): PersistedRadarFilters => {
  const storageKey = userId ? storageKeyFor(userId) : null;

  const [filters, setFilters] = useState<RadarFilters>(() =>
    storageKey ? readStorage(storageKey) : DEFAULT_FILTERS,
  );

  // The panel mounts before auth necessarily has a user, and the key is the
  // user id — so a key arriving late still gets its stored selection, unless
  // the user has already picked something in the meantime.
  const hydratedKeyRef = useRef<string | null>(storageKey);
  const touchedRef = useRef(false);

  useEffect(() => {
    if (!storageKey || hydratedKeyRef.current === storageKey) return;
    hydratedKeyRef.current = storageKey;
    if (touchedRef.current) return;
    setFilters(readStorage(storageKey));
  }, [storageKey]);

  const setField = useCallback(
    <K extends keyof RadarFilters>(key: K, value: SetStateAction<RadarFilters[K]>): void => {
      touchedRef.current = true;
      setFilters(prev => {
        const nextValue =
          typeof value === 'function'
            ? (value as (p: RadarFilters[K]) => RadarFilters[K])(prev[key])
            : value;
        if (nextValue === prev[key]) return prev;
        const next: RadarFilters = { ...prev, [key]: nextValue };
        if (storageKey) writeStorage(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const clearAllFilters = useCallback(() => {
    touchedRef.current = true;
    const next: RadarFilters = {
      ...DEFAULT_FILTERS,
      pendingMe: false,
      pendingOthers: false,
      pendingUsers: new Set(),
      requestedByUsers: new Set(),
      filterChannels: new Set(),
    };
    if (storageKey) writeStorage(storageKey, next);
    setFilters(next);
  }, [storageKey]);

  const setters = useMemo(
    () => ({
      setPendingMe: (v: SetStateAction<boolean>) => setField('pendingMe', v),
      setPendingOthers: (v: SetStateAction<boolean>) => setField('pendingOthers', v),
      setPendingUsers: (v: SetStateAction<Set<string>>) => setField('pendingUsers', v),
      setRequestedByUsers: (v: SetStateAction<Set<string>>) => setField('requestedByUsers', v),
      setFilterChannels: (v: SetStateAction<Set<string>>) => setField('filterChannels', v),
      setTimeRange: (v: SetStateAction<RadarTimeRange>) => setField('timeRange', v),
      setCustomFrom: (v: SetStateAction<string>) => setField('customFrom', v),
      setCustomTo: (v: SetStateAction<string>) => setField('customTo', v),
    }),
    [setField],
  );

  return { ...filters, ...setters, clearAllFilters };
};
