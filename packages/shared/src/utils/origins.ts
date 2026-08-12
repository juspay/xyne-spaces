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
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'xyne-spaces://.',
  'xyne-spaces-dev://.',
  'xyne-spaces-sandbox://.',
];
