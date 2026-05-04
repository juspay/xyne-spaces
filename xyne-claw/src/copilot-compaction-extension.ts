/**
 * Pi-mono extension that preserves copilot `respond-to-user` exchanges
 * during auto-compaction.
 *
 * Problem: In copilot mode, user replies are injected as tool_results for
 * the respond-to-user tool call. The compaction serializer only keeps
 * `type: "text"` content from user messages, so these replies are silently
 * dropped — the summarizer never sees them.
 *
 * Fix: Hook `session_before_compact`, extract respond-to-user exchanges
 * from the messages being compacted, and re-run compact() with
 * customInstructions that force the summarizer to preserve them.
 */

import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { compact } from "@mariozechner/pi-coding-agent";

interface Exchange {
  index: number;
  agent: string;
  user: string;
}

export const preserveCopilotContext: ExtensionFactory = (pi) => {
  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, signal } = event;
    const { messagesToSummarize } = preparation;

    const exchanges: Exchange[] = [];

    for (let i = 0; i < messagesToSummarize.length; i++) {
      const msg = messagesToSummarize[i] as unknown as Record<string, unknown>;
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

      for (const block of msg.content as Record<string, unknown>[]) {
        if (block.type !== "toolCall" || block.name !== "respond-to-user") continue;

        const agentText = ((block.arguments as Record<string, unknown>)?.message as string) ?? "";
        const callId = block.id as string; // ToolCall uses `id`, not `toolCallId`

        // Walk forward to find the matching result
        for (let j = i + 1; j < messagesToSummarize.length; j++) {
          const r = messagesToSummarize[j] as unknown as Record<string, unknown>;

          // Case 1: proper ToolResultMessage { role: "toolResult", toolCallId }
          if (r.role === "toolResult" && r.toolCallId === callId) {
            const parts = Array.isArray(r.content) ? r.content : [];
            const userText = (parts as { type: string; text?: string }[])
              .filter(c => c.type === "text")
              .map(c => c.text ?? "")
              .join("");
            if (userText) {
              exchanges.push({ index: i, agent: agentText.slice(0, 500), user: userText });
            }
            break;
          }

          // Case 2: raw injected { role: "user", content: [{ type: "tool_result", content }] }
          if (r.role === "user" && Array.isArray(r.content)) {
            const toolResultBlock = (r.content as Record<string, unknown>[]).find(
              c => c.type === "tool_result" && c.tool_use_id === callId,
            );
            if (toolResultBlock) {
              const userText = (toolResultBlock.content as string) ?? "";
              if (userText) {
                exchanges.push({ index: i, agent: agentText.slice(0, 500), user: userText });
              }
              break;
            }
          }
        }
      }
    }

    if (exchanges.length === 0) return; // no copilot exchanges, let default compaction run

    // Sort by original position (chronological order)
    exchanges.sort((a, b) => a.index - b.index);

    const conversationLog = exchanges
      .map((ex, i) => {
        const lines = [];
        if (ex.agent) lines.push(`  Agent said: ${ex.agent}`);
        lines.push(`  User replied: ${ex.user}`);
        return `${i + 1}.\n${lines.join("\n")}`;
      })
      .join("\n");

    const customInstructions =
      `CRITICAL: The following are actual user replies from a copilot chat thread. ` +
      `They MUST be preserved verbatim in the "Critical Context" section of the summary ` +
      `because they contain the user's decisions, requests, and intent:\n\n${conversationLog}`;

    const model = ctx.model;
    if (!model) {
      console.warn("[copilot-compaction] No model available, falling back to default compaction");
      return;
    }

    const apiKey = await ctx.modelRegistry.getApiKey(model);
    if (!apiKey) {
      console.warn("[copilot-compaction] No API key available, falling back to default compaction");
      return;
    }

    try {
      const result = await compact(preparation, model, apiKey, customInstructions, signal);
      console.log(`[copilot-compaction] Preserved ${exchanges.length} respond-to-user exchange(s) in compaction summary`);
      return { compaction: result };
    } catch (err) {
      console.error("[copilot-compaction] Custom compaction failed, falling back to default:", err);
      return; // let default compaction proceed
    }
  });
};
