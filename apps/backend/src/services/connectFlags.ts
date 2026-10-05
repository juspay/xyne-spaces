import { superpositionClient } from '@/services/superpositionClient';
import { logger } from '@/utils/logger';

/**
 * Slack Connect — Prisma ACL reach switch (canvas).
 *
 * Same Superposition CAC key the Zero query builder uses (`connect_query_enabled_canvas`), so both
 * the Prisma reach and the Zero read path flip together. Defaults OFF and fails closed to OFF: the
 * reach then stays the legacy `{ workspaceId }` scope (see `connectReachWhere`).
 *
 * The Zero server syncs the value into a shared cell per query request, but plain REST Prisma reads
 * have no such sync. This accessor reads CAC directly, behind a short in-process TTL cache so the
 * six canvas ACL tables don't each pay a CAC round-trip per request.
 */
const CONNECT_QUERY_ENABLED_CANVAS_KEY = 'connect_query_enabled_canvas';
const TTL_MS = 30_000;

let cachedValue = false;
let cachedAt = 0;
let inFlight: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  try {
    const enabled = await superpositionClient.getBooleanValue(
      CONNECT_QUERY_ENABLED_CANVAS_KEY,
      false,
      {},
    );
    cachedValue = enabled === true;
  } catch (error) {
    // Fail closed: keep the reach on the safe legacy workspace scope.
    logger.error('Failed to read connect canvas reach flag from superposition', { error });
    cachedValue = false;
  }
  cachedAt = Date.now();
  return cachedValue;
}

/** True when the canvas Prisma reach should resolve tenancy via connect_group (CAC-gated, TTL-cached). */
export async function isConnectCanvasReachEnabled(): Promise<boolean> {
  const age = Date.now() - cachedAt;
  if (age < TTL_MS) return cachedValue;
  // Collapse concurrent refreshes (e.g. the six canvas tables in one request) into one CAC call.
  if (!inFlight) {
    inFlight = refresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
