import { useCallback, useEffect } from 'react';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { DEFAULT_UI_LOCALE, SUPPORTED_UI_LOCALES, setUiLocale, type UiLocale } from '../locales';

const isUiLocale = (value: string): value is UiLocale =>
  (SUPPORTED_UI_LOCALES as readonly string[]).includes(value);

interface UseDisplayLanguageResult {
  displayLanguage: UiLocale;
  setDisplayLanguage: (locale: UiLocale) => void;
}

// App-UI locale — separate from `preferredLanguage`, which drives message
// translation. Mirrors useChannelSort's userPreference read/write shape.
export const useDisplayLanguage = (): UseDisplayLanguageResult => {
  const zero = useZero();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);
  const rawDisplayLanguage = userPreference?.displayLanguage;
  const displayLanguage =
    rawDisplayLanguage && isUiLocale(rawDisplayLanguage) ? rawDisplayLanguage : DEFAULT_UI_LOCALE;

  // Keeps i18next's active language in lockstep with the synced preference —
  // covers first load and a change arriving from another device/tab.
  useEffect(() => {
    void setUiLocale(displayLanguage);
  }, [displayLanguage]);

  const setDisplayLanguage = useCallback(
    (locale: UiLocale): void => {
      void setUiLocale(locale); // apply immediately — don't wait on the sync round-trip
      void zero.mutate(
        mutators.userPreference.setDisplayLanguage({
          id: userPreference?.id ?? crypto.randomUUID(),
          displayLanguage: locale,
          timestamp: Date.now(),
        }),
      );
    },
    [zero, userPreference?.id],
  );

  return { displayLanguage, setDisplayLanguage };
};
