import { useCallback, useState } from 'react';

/** Which layout draws the feed. */
export type RadarViewMode = 'cards' | 'table';

const STORAGE_KEY = 'xyne:radar-view-mode';

/** Table is the default; only an explicit stored 'cards' switches it. */
const readStorage = (): RadarViewMode => {
  if (typeof window === 'undefined') return 'table';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'cards' ? 'cards' : 'table';
  } catch {
    return 'table';
  }
};

const writeStorage = (mode: RadarViewMode): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Quota or private mode — the choice still holds for this session.
  }
};

/**
 * Radar's cards/table choice, a per-browser view preference persisted so
 * leaving Radar doesn't reset it. Anything unknown falls back to Table.
 */
export const usePersistedRadarViewMode = (): [RadarViewMode, (mode: RadarViewMode) => void] => {
  const [viewMode, setViewModeState] = useState<RadarViewMode>(readStorage);

  const setViewMode = useCallback((mode: RadarViewMode): void => {
    setViewModeState(mode);
    writeStorage(mode);
  }, []);

  return [viewMode, setViewMode];
};
