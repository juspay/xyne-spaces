import { useSelector } from '@xstate/react';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { stateMachineActor } from '../machines/stateMachine';

/**
 * Keep in sync with SUPPORTED_LANGUAGES in
 * apps/backend/src/services/translation/languageCodes.ts — matches LibreTranslate's
 * full supported set (docs.libretranslate.com/guides/supported_languages), minus `pb`/
 * `zt` (Argos-specific region/script variants of `pt`/`zh`, not real ISO 639-1 codes;
 * see languageCodes.ts for the full rationale).
 */
export const PREFERRED_LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'tr', label: 'Turkish' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'id', label: 'Indonesian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'sv', label: 'Swedish' },
  { value: 'th', label: 'Thai' },
  { value: 'he', label: 'Hebrew' },
  { value: 'sq', label: 'Albanian' },
  { value: 'az', label: 'Azerbaijani' },
  { value: 'eu', label: 'Basque' },
  { value: 'bn', label: 'Bengali' },
  { value: 'bg', label: 'Bulgarian' },
  { value: 'ca', label: 'Catalan' },
  { value: 'cs', label: 'Czech' },
  { value: 'da', label: 'Danish' },
  { value: 'eo', label: 'Esperanto' },
  { value: 'et', label: 'Estonian' },
  { value: 'fi', label: 'Finnish' },
  { value: 'gl', label: 'Galician' },
  { value: 'el', label: 'Greek' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'ga', label: 'Irish' },
  { value: 'ky', label: 'Kyrgyz' },
  { value: 'lv', label: 'Latvian' },
  { value: 'lt', label: 'Lithuanian' },
  { value: 'ms', label: 'Malay' },
  { value: 'nb', label: 'Norwegian Bokmål' },
  { value: 'fa', label: 'Persian' },
  { value: 'ro', label: 'Romanian' },
  { value: 'sk', label: 'Slovak' },
  { value: 'sl', label: 'Slovenian' },
  { value: 'tl', label: 'Filipino' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'ur', label: 'Urdu' },
];

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
