import { CONFIG } from "../../config.js";
import { errMsg } from "../errors.js";
import type { WebhookCommandCtx } from "./context.js";

// ── /clear ── wipe this thread's agent session in claw-pod, then ack and
// stop. The agent forgets all prior context; the next message starts fresh.
export async function handleClear(ctx: WebhookCommandCtx): Promise<void> {
  const { agent, payload, log } = ctx;
  let cleared = false;
  try {
    const r = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/clear-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}) },
      body: JSON.stringify({ userId: payload.userId, conversationId: payload.conversationId, agentSlug: agent.slug }),
    });
    cleared = (r as unknown as { ok: boolean }).ok;
  } catch (err) {
    log.warn("Failed to clear claw session", { error: errMsg(err) });
  }
  await ctx.reply(
    cleared
      ? "🧹 Cleared this thread's context — I'll start fresh on your next message."
      : "⚠️ Couldn't clear the conversation context. Please try again.",
    "Failed to post /clear reply",
  );
}
