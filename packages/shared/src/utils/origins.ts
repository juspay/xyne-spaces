/**
 * Canonical list of trusted first-party origins for the Xyne Spaces app.
 *
 * Used by:
 *  - Frontend (dashboard/src/App.tsx) – anchor click origin checks
 *  - Backend  (backend/src/utils/urlUtils.ts) – internal link detection
 *
 * Keep this as the single source of truth; do not copy-paste into other files.
 */
// Deployment origins beyond the serving origin (same-origin anchors are
// always trusted by callers) are injected at build time via
// VITE_TRUSTED_ORIGINS (comma-separated). Outside a bundler — plain node
// ESM — import.meta.env is undefined and only the public web-app origins
// remain, which is the safe default for self-hosted builds.
const viteEnv = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env;
const injectedTrustedOrigins = (viteEnv?.["VITE_TRUSTED_ORIGINS"] || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
export const TRUSTED_ORIGINS: string[] = [
  "https://xyne-spaces.web.app",
  "https://xyne-spaces.web",
  ...injectedTrustedOrigins,
];
