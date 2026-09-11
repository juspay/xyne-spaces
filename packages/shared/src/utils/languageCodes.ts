/**
 * The single source of truth for every language the app's translation feature
 * supports — backend (`apps/backend/src/services/translation/languageCodes.ts`) and
 * dashboard (`apps/dashboard/src/hooks/usePreferredLanguage.ts`) both import this
 * instead of keeping their own copy. Previously each maintained a separately
 * hand-written list, kept in sync only by a comment (not the compiler) — a language
 * added to one and not the other would silently drift, e.g. the UI offering a language
 * the backend can't translate to, or vice versa. One list means one edit.
 *
 * `UserPreference.preferredLanguage` and `Message.sourceLang` are stored as plain
 * ISO 639-1 (e.g. "es"), which is also exactly what LibreTranslate's `source`/`target`
 * fields expect (libreTranslator.ts) — no translation-side code mapping needed. The one
 * conversion still required is for `franc` (language *detection*, not translation),
 * which returns ISO 639-3 (e.g. "spa") instead of ISO 639-1 — see `iso6393` below.
 *
 * Matches LibreTranslate's full supported set (docs.libretranslate.com/guides/
 * supported_languages — 48 language pairs via Argos Translate), minus two entries
 * (`pb` Portuguese-Brazil, `zt` Chinese-Traditional) that aren't real ISO 639-1 codes —
 * they're Argos-specific region/script variants of `pt`/`zh`, which are already listed.
 * `iso6393` prefers the specific code `franc` actually emits (e.g. Arabic's
 * macrolanguage code is `ara`, but franc only ever detects the individual-language code
 * `arb`) over the generic ISO 639-3 mapping, verified against franc's own data
 * (node_modules/franc/data.js) rather than assumed — franc has no model at all for 8 of
 * these (eu, bn, zh, el, ga, ja, ko, th: none of its 7 supported scripts are Han,
 * Hangul, Thai, or cover Basque/Bengali/Greek/Irish), so source-language
 * auto-detection will never fire for those — same pre-existing gap zh/ja/ko/th already
 * had. They still work for translation and manual "Change translation language"
 * selection; only automatic detection is affected (flagged per-entry below).
 *
 * Extending this list isn't free: LibreTranslate must actually have the language loaded
 * (see the `translation` service's `--load-only` list in docker-compose.local.yml) or
 * translation requests for it will fail.
 */
export interface LanguageCodeEntry {
  /** ISO 639-1 — what the app stores, what LibreTranslate's API expects, and what
   * users pick in settings. */
  iso6391: string;
  /** ISO 639-3 — what `franc` returns from detection (backend-only concern, but kept
   * alongside `label` so there's one row per language rather than two lists to update). */
  iso6393: string;
  /** Human-readable name shown in the dashboard's language pickers. */
  label: string;
}

export const SUPPORTED_LANGUAGES: LanguageCodeEntry[] = [
  { iso6391: 'en', iso6393: 'eng', label: 'English' },
  { iso6391: 'es', iso6393: 'spa', label: 'Spanish' },
  { iso6391: 'fr', iso6393: 'fra', label: 'French' },
  { iso6391: 'de', iso6393: 'deu', label: 'German' },
  { iso6391: 'it', iso6393: 'ita', label: 'Italian' },
  { iso6391: 'pt', iso6393: 'por', label: 'Portuguese' },
  { iso6391: 'ru', iso6393: 'rus', label: 'Russian' },
  { iso6391: 'zh', iso6393: 'cmn', label: 'Chinese' }, // not franc-detectable (no Han script model)
  { iso6391: 'ja', iso6393: 'jpn', label: 'Japanese' }, // not franc-detectable (no Han script model)
  { iso6391: 'ko', iso6393: 'kor', label: 'Korean' }, // not franc-detectable (no Hangul model)
  { iso6391: 'ar', iso6393: 'arb', label: 'Arabic' },
  { iso6391: 'hi', iso6393: 'hin', label: 'Hindi' },
  { iso6391: 'tr', iso6393: 'tur', label: 'Turkish' },
  { iso6391: 'vi', iso6393: 'vie', label: 'Vietnamese' },
  { iso6391: 'id', iso6393: 'ind', label: 'Indonesian' },
  { iso6391: 'nl', iso6393: 'nld', label: 'Dutch' },
  { iso6391: 'pl', iso6393: 'pol', label: 'Polish' },
  { iso6391: 'sv', iso6393: 'swe', label: 'Swedish' },
  { iso6391: 'th', iso6393: 'tha', label: 'Thai' }, // not franc-detectable (no Thai script model)
  { iso6391: 'he', iso6393: 'heb', label: 'Hebrew' },
  // Added when expanding from 20 to LibreTranslate's full 46-language set:
  { iso6391: 'sq', iso6393: 'als', label: 'Albanian' },
  { iso6391: 'az', iso6393: 'azj', label: 'Azerbaijani' },
  { iso6391: 'eu', iso6393: 'eus', label: 'Basque' }, // not franc-detectable
  { iso6391: 'bn', iso6393: 'ben', label: 'Bengali' }, // not franc-detectable
  { iso6391: 'bg', iso6393: 'bul', label: 'Bulgarian' },
  { iso6391: 'ca', iso6393: 'cat', label: 'Catalan' },
  { iso6391: 'cs', iso6393: 'ces', label: 'Czech' },
  { iso6391: 'da', iso6393: 'dan', label: 'Danish' },
  { iso6391: 'eo', iso6393: 'epo', label: 'Esperanto' },
  { iso6391: 'et', iso6393: 'ekk', label: 'Estonian' },
  { iso6391: 'fi', iso6393: 'fin', label: 'Finnish' },
  { iso6391: 'gl', iso6393: 'glg', label: 'Galician' },
  { iso6391: 'el', iso6393: 'ell', label: 'Greek' }, // not franc-detectable
  { iso6391: 'hu', iso6393: 'hun', label: 'Hungarian' },
  { iso6391: 'ga', iso6393: 'gle', label: 'Irish' }, // not franc-detectable
  { iso6391: 'ky', iso6393: 'kir', label: 'Kyrgyz' },
  { iso6391: 'lv', iso6393: 'lvs', label: 'Latvian' },
  { iso6391: 'lt', iso6393: 'lit', label: 'Lithuanian' },
  { iso6391: 'ms', iso6393: 'zlm', label: 'Malay' },
  { iso6391: 'nb', iso6393: 'nob', label: 'Norwegian Bokmål' },
  { iso6391: 'fa', iso6393: 'pes', label: 'Persian' },
  { iso6391: 'ro', iso6393: 'ron', label: 'Romanian' },
  { iso6391: 'sk', iso6393: 'slk', label: 'Slovak' },
  { iso6391: 'sl', iso6393: 'slv', label: 'Slovenian' },
  { iso6391: 'tl', iso6393: 'tgl', label: 'Filipino' },
  { iso6391: 'uk', iso6393: 'ukr', label: 'Ukrainian' },
  { iso6391: 'ur', iso6393: 'urd', label: 'Urdu' },
];

const byIso6391 = new Map(SUPPORTED_LANGUAGES.map(e => [e.iso6391, e]));
const byIso6393 = new Map(SUPPORTED_LANGUAGES.map(e => [e.iso6393, e]));

/** ISO 639-1 -> ISO 639-3, for passing a stored/selected language to `franc`'s `only` filter. */
export const toFranc6393 = (iso6391: string): string | undefined => byIso6391.get(iso6391)?.iso6393;

/** ISO 639-3 -> ISO 639-1, for turning franc's detection result back into what the app stores. */
export const fromFranc6393 = (iso6393: string): string | undefined => byIso6393.get(iso6393)?.iso6391;

/** Human-readable name for a stored ISO 639-1 code, e.g. for "Translated from {name}" copy. */
export const languageLabel = (iso6391: string): string | undefined => byIso6391.get(iso6391)?.label;
