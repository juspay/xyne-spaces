/**
 * Backend-local re-export of the canonical language list — see
 * packages/shared/src/utils/languageCodes.ts for the actual data and full rationale.
 * The list itself lives in @xyne/shared so the dashboard's language picker
 * (usePreferredLanguage.ts) derives from the exact same source instead of keeping its
 * own hand-synced copy.
 */
export {
  SUPPORTED_LANGUAGES,
  toFranc6393,
  fromFranc6393,
  languageLabel,
  type LanguageCodeEntry,
} from '@xyne/shared';
