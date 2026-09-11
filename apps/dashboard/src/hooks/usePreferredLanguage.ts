import { useSelector } from '@xstate/react';
import { SUPPORTED_LANGUAGES } from '@xyne/shared';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { stateMachineActor } from '../machines/stateMachine';

/**
 * Derived from @xyne/shared's SUPPORTED_LANGUAGES — the single source of truth for
 * every language the translation feature supports (see
 * packages/shared/src/utils/languageCodes.ts for the full list and rationale). This
 * used to be a separately hand-written array here, kept in sync with the backend's own
 * copy only by a comment; a language added to one and not the other would silently
 * drift. Deriving from the shared list means there's exactly one place to edit.
 */
export const PREFERRED_LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = SUPPORTED_LANGUAGES.map(
  ({ iso6391, label }) => ({ value: iso6391, label }),
);

/**
 * App-wide language that incoming messages get translated to. Backend writes a
 * translation into `message_translations` for every distinct preferred language
 * present in a room — this is the one client-side setting driving which of those
 * rows a viewer's messages resolve to.
 */
export const usePreferredLanguage = (): {
  preferredLanguage: string;
  setPreferredLanguage: (value: string) => void;
} => {
  const zero = useZero();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);

  const preferredLanguage = userPreference?.preferredLanguage ?? 'en';

  const setPreferredLanguage = (value: string): void => {
    void zero.mutate(
      mutators.userPreference.setPreferredLanguage({
        id: userPreference?.id ?? crypto.randomUUID(),
        preferredLanguage: value,
        timestamp: Date.now(),
      }),
    );
  };

  return { preferredLanguage, setPreferredLanguage };
};
