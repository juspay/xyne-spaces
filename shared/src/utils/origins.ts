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

/**
 * Paths hosted on internal Xyne domains that live outside the React app.
 * Links to these paths should open in the system browser (Electron) or a
 * new tab (web) rather than being routed within the React app.
 *
 * Used by:
 *  - dashboard/src/components/Chat/RenderMessageWithHTML/internalLinkUtils.ts
 *  - electron/src/window/manager.ts
 *
 * Add new entries here when a new external tool/service is deployed on the
 * same domain (e.g. '/grafana', '/kibana').
 * Matching is prefix-based: '/claw' covers '/claw' and '/claw/anything'.
 */
export const EXTERNAL_XYNE_PATHS: string[] = ['/claw', '/changelog', '/demo', '/apps/downloads'];
