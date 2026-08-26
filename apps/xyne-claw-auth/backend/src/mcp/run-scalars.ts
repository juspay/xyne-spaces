/**
 * Per-session run scalars for the dashboard-ai agent.
 *
 * The Spaces proxy sends the dashboard being edited (`draftId`), its data
 * source, and the optionally focused tile via `agentConfig` on /run. Storing
 * them here (keyed by the run's sessionId, same pattern as
 * attached-context-injector) lets the MCP /call boundary force-inject them
 * into every xyne-dashboard tool call — the model never has to (and cannot)
 * supply them itself.
 */

import { redisService } from "../redis.js";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";

const log = createLogger("run-scalars");

const KEY_PREFIX = "mcp:run_scalars:";
const TTL_SECONDS = 30 * 60; // matches attached-context TTL — one active turn

export interface RunScalars {
  dataSourceId?: string;
  draftId?: string;
  focusedComponentId?: string;
}

function key(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

export async function storeRunScalars(sessionId: string, scalars: RunScalars): Promise<void> {
  if (!sessionId) return;
  if (!scalars.dataSourceId && !scalars.draftId && !scalars.focusedComponentId) return;
  try {
    await redisService.getConnection().set(key(sessionId), JSON.stringify(scalars), "EX", TTL_SECONDS);
  } catch (err) {
    log.warn(`[run-scalars] store failed for ${sessionId}:`, errMsg(err));
  }
}

export async function loadRunScalars(sessionId: string): Promise<RunScalars> {
  if (!sessionId) return {};
  try {
    const raw = await redisService.getConnection().get(key(sessionId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RunScalars;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    log.warn(`[run-scalars] load failed for ${sessionId}:`, errMsg(err));
    return {};
  }
}
