/**
 * Canonical list of trusted first-party origins for the Xyne Spaces app.
 *
 * Used by:
 *  - Frontend (dashboard/src/App.tsx) – anchor click origin checks
 *  - Backend  (backend/src/utils/urlUtils.ts) – internal link detection
 *
 * Keep this as the single source of truth; do not copy-paste into other files.
 */
export const TRUSTED_ORIGINS: string[] = [
  'https://spaces.xyne.juspay.net',
  'https://app.spaces.xyne.juspay.net',
  'https://app.spaces.sandbox.xyne.juspay.net',
  'https://xyne-spaces.web.app',
  'https://xyne-spaces.web',
  'https://spaces.sandbox.xyne.juspay.net',
];
