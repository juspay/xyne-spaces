import { useEffect, useSyncExternalStore } from 'react';
import {
  getDailyBriefEnabledState,
  loadDailyBriefEnabled,
  setDailyBriefEnabled,
  subscribeDailyBriefEnabled,
} from '../stores/dailyBriefEnabledStore';

export function useDailyBriefEnabled(): {
  /** null while the config is still loading. */
  enabled: boolean | null;
  loading: boolean;
  saving: boolean;
  setEnabled: (enabled: boolean) => void;
} {
  const state = useSyncExternalStore(subscribeDailyBriefEnabled, getDailyBriefEnabledState);

  useEffect(() => {
    void loadDailyBriefEnabled();
  }, []);

  return {
    enabled: state.enabled,
    loading: state.enabled === null,
    saving: state.saving,
    setEnabled: setDailyBriefEnabled,
  };
}
