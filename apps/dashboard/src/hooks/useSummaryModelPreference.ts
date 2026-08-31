import { useCallback, useEffect, useState } from 'react';

export type SummaryModelPreference = 'fast' | 'thinking';

// Recording summary LLM tier, kept per-browser like the other recording UI
// preferences (see recordingTabPreference.ts). Default 'fast': the cheaper
// model is used for everyone unless they opt into 'thinking'. This value is
// also ferried to the backend at recording start (see recordingService) so the
// headless call-end auto-generation can honour a 'thinking' default — the
// server cannot read localStorage itself.
const STORAGE_KEY = 'xyne:summary-model-preference';
// Same-tab reactivity: `storage` events only fire in *other* tabs, so writes
// broadcast this custom event for hooks mounted in the writing tab.
const CHANGE_EVENT = 'xyne:summary-model-preference-changed';

/** Reads the stored tier; anything but an explicit 'thinking' is treated as 'fast'. */
export const getSummaryModelPreference = (): SummaryModelPreference => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'thinking' ? 'thinking' : 'fast';
  } catch {
    return 'fast';
  }
};

const writeSummaryModelPreference = (value: SummaryModelPreference): void => {
  try {
    localStorage.setItem(STORAGE_KEY, value);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // localStorage unavailable (private mode / disabled) — non-fatal; the
    // preference simply won't persist this session.
  }
};

export const useSummaryModelPreference = (): {
  summaryModelPreference: SummaryModelPreference;
  setSummaryModelPreference: (value: SummaryModelPreference) => void;
} => {
  const [summaryModelPreference, setState] =
    useState<SummaryModelPreference>(getSummaryModelPreference);

  useEffect(() => {
    const sync = (): void => setState(getSummaryModelPreference());
    // Cross-tab (`storage`) and same-tab (custom event) both re-read the store.
    window.addEventListener('storage', sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return (): void => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  const setSummaryModelPreference = useCallback((value: SummaryModelPreference): void => {
    writeSummaryModelPreference(value);
    setState(value);
  }, []);

  return { summaryModelPreference, setSummaryModelPreference };
};
