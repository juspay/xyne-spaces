/**
 * Attached-context default-fill for xyne-spaces MCP tool calls.
 *
 * When the user attaches a channel/ticket/call to their message, we want the
 * agent's `spaces-*` tool calls to be SCOPED to those items by default — even
 * when the LLM forgets to pass channelId / conversationId itself. Without this,
 * "what's happening here" with a channel attached returns global results that
 * have nothing to do with the user's intent.
 *
 * Flow:
 *   /run                → storeForSession(sessionId, items)
 *   /:sid/mcp/call      → loadForSession(sid) → injectDefaults(tool, params, items)
 *
 * Injection rule: ONLY when the LLM's args are missing the field. If the model
 * passes a value, we never overwrite it.
 */
import { redisService } from "../redis.js";
import { errMsg } from "../lib/errors.js";
import type { AttachedContextRef } from "../services/agentChatContextService.js";
import { createLogger } from "../logger.js";

const log = createLogger("attached-ctx");

const KEY_PREFIX = "mcp:attached_ctx:";
const TTL_SECONDS = 30 * 60; // 30 min — long enough for an active turn, short enough to not pile up

function key(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

export async function storeForSession(sessionId: string, items: AttachedContextRef[]): Promise<void> {
  if (!sessionId || !items?.length) return;
  try {
    await redisService.getConnection().set(key(sessionId), JSON.stringify(items), "EX", TTL_SECONDS);
  } catch (err) {
    log.warn(`[attached-ctx] store failed for ${sessionId}:`, errMsg(err));
  }
}

export async function loadForSession(sessionId: string): Promise<AttachedContextRef[] | undefined> {
  if (!sessionId) return undefined;
  try {
    const raw = await redisService.getConnection().get(key(sessionId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as AttachedContextRef[];
    return Array.isArray(parsed) ? parsed : undefined;
  } catch (err) {
    log.warn(`[attached-ctx] load failed for ${sessionId}:`, errMsg(err));
    return undefined;
  }
}

/**
 * Merge defaults from attached items into the tool's params.
 *
 * Only fills slots the model left undefined/empty — never overwrites a value
 * the LLM provided explicitly. Returns a new object; does not mutate input.
 *
 * Multi-item handling (important):
 *  - Comma-separated fields (`in` on spaces-search) get ALL ids joined.
 *  - Single-value fields (`channelId`, `conversationId`) get filled ONLY when
 *    there's exactly one candidate. Picking one of N would silently scope the
 *    agent to a wrong-but-plausible subset of what the user attached. When
 *    ambiguous, we skip — the prompt-level "# Attached context" block already
 *    lists every item with its tool hint, so the agent can fan out itself.
 */
export function injectDefaults(
  serverType: string,
  tool: string,
  params: Record<string, unknown>,
  items: AttachedContextRef[] | undefined,
): Record<string, unknown> {
  if (serverType !== "xyne-spaces" || !items?.length) return params;

  const channels = items.filter((i) => i.type === "channel");
  const tickets = items.filter((i) => i.type === "ticket");
  const calls = items.filter((i) => i.type === "call");

  // Collect every thread the user pointed at, dedup'd, in priority order
  // (ticket → call → channel). When exactly one thread is on the table we can
  // default-fill conversationId; more than one and we leave it to the agent.
  const threadIds = [
    ...tickets.map((t) => t.threadId),
    ...calls.map((c) => c.threadId),
    ...channels.map((c) => c.threadId),
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  const uniqueThreadIds = [...new Set(threadIds)];
  const uniqueChannelIds = [...new Set(channels.map((c) => c.id))];

  const singleChannelId = uniqueChannelIds.length === 1 ? uniqueChannelIds[0] : undefined;
  const singleThreadId = uniqueThreadIds.length === 1 ? uniqueThreadIds[0] : undefined;
  const allChannelIdsCsv = uniqueChannelIds.length > 0 ? uniqueChannelIds.join(",") : undefined;

  const isEmpty = (v: unknown): boolean =>
    v === undefined || v === null || (typeof v === "string" && v.trim().length === 0);

  const out: Record<string, unknown> = { ...params };
  const set = (k: string, v: string | undefined): void => {
    if (v && isEmpty(out[k])) out[k] = v;
  };

  switch (tool) {
    case "spaces-search":
      // `in` is comma-separated channel id filter — pass ALL attached channels.
      set("in", allChannelIdsCsv);
      break;
    case "spaces-tickets":
    case "spaces-activity":
    case "spaces-canvases":
    case "spaces-calls":
    case "spaces-trigger-agent":
      // `channelId` is single-valued — only fill when unambiguous.
      set("channelId", singleChannelId);
      if (tool === "spaces-trigger-agent") set("conversationId", singleThreadId);
      break;
    case "spaces-messages":
    case "spaces-emails":
    case "spaces-thread-attachments":
      // `conversationId` is single-valued — only fill when unambiguous.
      set("conversationId", singleThreadId);
      break;
    // Tools intentionally not injected:
    //  - spaces-channels (filters by name, no id slot)
    //  - spaces-message-detail / spaces-fetch-attachment (need specific id)
    //  - spaces-read-canvas / spaces-edit-canvas (need viewAccessId, NOT canvas.id)
    //  - spaces-create-* / spaces-update-* / spaces-publish-* (write tools — approval-gated)
    //  - spaces-meeting-insights, spaces-memory-* (no channel/thread scope)
    default:
      return out;
  }

  // Note when we actually filled something so the runtime trace is debuggable.
  const filled = Object.keys(out).filter((k) => out[k] !== params[k]);
  if (filled.length > 0) {
    log.info(
      `[attached-ctx] injected defaults for ${tool}: ${filled.join(", ")} ` +
      `(channels=${uniqueChannelIds.length}, threads=${uniqueThreadIds.length})`
    );
  }
  return out;
}
