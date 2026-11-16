/**
 * Canonical list of trusted first-party origins for the Xyne Spaces app.
 *
 * Used by:
 *  - Frontend (dashboard/src/App.tsx) – anchor click origin checks
 *
 * Deployment hosts come from the build-time env (`VITE_TRUSTED_ORIGINS`, a
 * comma-separated list of origins such as "https://example.org"); no
 * deployment hostname is hardcoded here. Keep this as the single source of
 * truth; do not copy-paste into other files.
 */
// This package also runs in Node, where import.meta.env is absent.
const env = (import.meta as ImportMeta & {
  env?: { VITE_TRUSTED_ORIGINS?: string };
}).env;

const configuredOrigins = (env?.VITE_TRUSTED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const TRUSTED_ORIGINS: string[] = [...configuredOrigins];
