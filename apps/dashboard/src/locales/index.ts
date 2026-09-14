import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from './en/common.json';
import enSidebar from './en/sidebar.json';
import enPlaceholders from './en/placeholders.json';

export const SUPPORTED_UI_LOCALES = ['en', 'es'] as const;
export type UiLocale = (typeof SUPPORTED_UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE: UiLocale = 'en';

type NonDefaultLocale = Exclude<UiLocale, typeof DEFAULT_UI_LOCALE>;

// Non-default locales are code-split — their namespace bundles are only
// fetched once a user actually switches to them, so the default English
// bundle (below, loaded eagerly for zero-latency first paint) pays no cost
// for locales most users never select.
const NON_DEFAULT_LOCALE_LOADERS: Record<NonDefaultLocale, () => Promise<Record<string, object>>> =
  {
    es: async () => ({
      common: (await import('./es/common.json')).default,
      sidebar: (await import('./es/sidebar.json')).default,
      placeholders: (await import('./es/placeholders.json')).default,
    }),
  };

void i18next.use(initReactI18next).init({
  lng: DEFAULT_UI_LOCALE,
  fallbackLng: DEFAULT_UI_LOCALE,
  defaultNS: 'common',
  ns: ['common', 'sidebar', 'placeholders'],
  resources: {
    en: { common: enCommon, sidebar: enSidebar, placeholders: enPlaceholders },
  },
  interpolation: {
    // React already escapes interpolated values; i18next's own escaping on
    // top of that double-encodes punctuation in translated strings.
    escapeValue: false,
  },
  returnEmptyString: false,
});

// Activates a UI locale, lazily fetching its namespace bundles on first use.
// Safe to call repeatedly (e.g. from a preference sync effect) — only the
// first call per locale triggers a network/chunk fetch.
export const setUiLocale = async (locale: UiLocale): Promise<void> => {
  if (locale !== DEFAULT_UI_LOCALE && !i18next.hasResourceBundle(locale, 'common')) {
    const bundles = await NON_DEFAULT_LOCALE_LOADERS[locale]();
    for (const [ns, resource] of Object.entries(bundles)) {
      i18next.addResourceBundle(locale, ns, resource);
    }
  }
  await i18next.changeLanguage(locale);
};

export default i18next;
