import { config } from '@/config/env';

/**
 * Slack Connect — Prisma ACL reach switch (canvas).
 *
 * Backed by the `CONNECT_QUERY_ENABLED_CANVAS` env var (see config/env.ts), not Superposition CAC:
 * the flag flips once (after the prod backfill), so a static env value flipped by redeploy is
 * predictable — unlike a CAC read that was cached per request and didn't reliably reflect at runtime.
 * Default OFF → the reach stays the legacy `{ workspaceId }` scope (see `connectReachWhere`).
 */
export function isConnectCanvasReachEnabled(): boolean {
  return config.connectQueryEnabledCanvas;
}
