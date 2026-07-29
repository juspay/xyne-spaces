/**
 * Server-side replay of one eval turn against an agent.
 *
 * Calls claw-auth's own agent-chat SSE endpoint (the same one the browser uses)
 * and consumes the stream to the final `done` event — so the background run
 * worker reuses the entire existing chat path (agent dispatch, callbacks,
 * persistence) instead of reimplementing it. Returns the agent's answer +
 * reasoning + tool calls for the turn result.
 */
import { CONFIG } from "../config.js";

export interface ReplayResult {
  content: string;
  status: "completed" | "failed" | "cancelled";
  reasoning: string;
  toolInvocations: unknown[];
  sessionId?: string;
}

const REPLAY_TIMEOUT_MS = Number(process.env["EVAL_REPLAY_TIMEOUT_MS"] ?? 600_000);

export async function replayTurn(
  slug: string,
  message: string,
  conversationId: string,
  userId: string,
  providerOverride?: { provider: string; model?: string },
  abortSignal?: AbortSignal,
): Promise<ReplayResult> {
  const url = `${CONFIG.internalUrl.replace(/\/$/, "")}/claw/api/v1/agent-chat/${encodeURIComponent(slug)}/chat`;
  const timeout = AbortSignal.timeout(REPLAY_TIMEOUT_MS);
  const signal = abortSignal ? AbortSignal.any([timeout, abortSignal]) : timeout;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-s2s-key": CONFIG.xyneClawS2sKey,
      "x-user-id": userId,
    },
    body: JSON.stringify({ message, conversationId, userId, ...(providerOverride ? { providerOverride } : {}) }),
    signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`agent-chat ${res.status}: ${t.slice(0, 200)}`);
  }

  let reasoning = "";
  const tools: unknown[] = [];
  let sessionId: string | undefined;
  let reply: { content?: string; status?: string } | null = null;
  let buffer = "";
  let currentEvent = "";
  let dataLines: string[] = [];

  const flush = () => {
    if (!currentEvent || dataLines.length === 0) {
      currentEvent = "";
      dataLines = [];
      return;
    }
    try {
      const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      if (currentEvent === "run" && typeof data["sessionId"] === "string") sessionId = data["sessionId"];
      else if (currentEvent === "reasoning" && typeof data["delta"] === "string") reasoning += data["delta"];
      else if (currentEvent === "tool" && data["toolInvocation"]) tools.push(data["toolInvocation"]);
      else if (currentEvent === "done") reply = data as { content?: string; status?: string };
    } catch {
      /* ignore malformed event */
    }
    dataLines = [];
    currentEvent = "";
  };

  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") flush();
      else if (line.startsWith("event: ")) currentEvent = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
      else if (dataLines.length > 0) dataLines.push(line);
    }
  }
  flush();

  if (!reply) throw new Error("no reply received from agent-chat");
  const r = reply as { content?: string; status?: string };
  const status: ReplayResult["status"] =
    r.status === "completed" ? "completed" : r.status === "cancelled" ? "cancelled" : "failed";
  return {
    content: typeof r.content === "string" ? r.content : "",
    status,
    reasoning,
    toolInvocations: tools,
    ...(sessionId ? { sessionId } : {}),
  };
}
