const STORAGE_KEY = 'xyne_video_positions';

const MAX_ENTRIES = 100;
const MIN_RESUME_SECONDS = 1;
const END_THRESHOLD_SECONDS = 2;

let positions: Map<string, number> | null = null;

const load = (): Map<string, number> => {
  if (positions) {
    return positions;
  }
  positions = new Map<string, number>();
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, number>;
      for (const [key, time] of Object.entries(parsed)) {
        if (typeof time === 'number' && isFinite(time)) {
          positions.set(key, time);
        }
      }
    }
  } catch {
    // Corrupt or unavailable storage — start empty.
  }
  return positions;
};

const persist = (map: Map<string, number>): void => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // Quota or private-mode failures are non-fatal; the in-memory map still works.
  }
};

export const getVideoPosition = (key: string | undefined): number | undefined => {
  if (!key) {
    return undefined;
  }
  return load().get(key);
};

export const saveVideoPosition = (
  key: string | undefined,
  time: number,
  duration?: number,
): void => {
  if (!key || !isFinite(time)) {
    return;
  }

  const map = load();
  const isNearEnd =
    duration !== undefined && isFinite(duration) && duration > 0
      ? time >= duration - END_THRESHOLD_SECONDS
      : false;

  if (time < MIN_RESUME_SECONDS || isNearEnd) {
    if (map.delete(key)) {
      persist(map);
    }
    return;
  }

  map.delete(key);
  map.set(key, time);

  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next();
    if (oldest.done) {
      break;
    }
    map.delete(oldest.value);
  }

  persist(map);
};

export const clearVideoPosition = (key: string | undefined): void => {
  if (!key) {
    return;
  }
  const map = load();
  if (map.delete(key)) {
    persist(map);
  }
};
