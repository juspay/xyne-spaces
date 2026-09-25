import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';

/**
 * Slack Connect — resolve a canvas's `connectId` for connectId-scoped child queries.
 *
 * Zero synced-query args are set on the client and shipped to the server, so the client must
 * always pass `connectId` for the server's connectId branch (gated by the Superposition CAC flag
 * connect_query_enabled_canvas) to take effect. This reads the canvas row (already cached in
 * any canvas view) and returns
 * its `connectId`. Returns undefined when the canvas isn't loaded or has no connectId yet
 * (pre-backfill) — in which case the child queries fall back to the canvasId path.
 */
export function useCanvasConnectId(canvasId: string | undefined): string | undefined {
  const [canvas] = useCachedQuery(queries.getCanvas({ canvasId: canvasId || '' }), {
    enabled: Boolean(canvasId),
  });
  return (canvas as { connectId?: string | null } | undefined)?.connectId ?? undefined;
}
