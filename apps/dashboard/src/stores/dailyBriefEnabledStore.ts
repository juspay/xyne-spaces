import { toast } from 'sonner';
import { dailyBriefApi } from '../api/dailyBriefApi';

export interface DailyBriefEnabledState {
  /** null until the config has been fetched at least once. */
  enabled: boolean | null;
  saving: boolean;
}

let state: DailyBriefEnabledState = { enabled: null, saving: false };
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<DailyBriefEnabledState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener();
  }
}

export function getDailyBriefEnabledState(): DailyBriefEnabledState {
  return state;
}

export function subscribeDailyBriefEnabled(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

export function loadDailyBriefEnabled(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (state.enabled !== null && !force) return Promise.resolve();
  inFlight = dailyBriefApi
    .getConfig()
    .then(config => {
      set({ enabled: config.enabled });
    })
    .catch(() => {
      set({ enabled: false });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function setDailyBriefEnabled(next: boolean): void {
  const previous = state.enabled;
  set({ enabled: next, saving: true });
  void dailyBriefApi
    .saveConfig({ enabled: next })
    .then(config => {
      set({ enabled: config.enabled });
      toast.success(next ? 'Morning brief turned on' : 'Morning brief turned off');
    })
    .catch(() => {
      set({ enabled: previous });
      toast.error('Could not update your morning brief.');
    })
    .finally(() => {
      set({ saving: false });
    });
}
