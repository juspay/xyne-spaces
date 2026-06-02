/**
 * LLM-as-judge for agent chain continuation decisions.
 * Uses structured JSON output to determine if a chain should continue or stop.
 */

import { LITELLM } from "./config.js";

export async function judgeChainContinuation(
  agentResult: string,
  sourceAgent: string,
  targetAgent: string,
  taskTemplate?: string,
  userQuery?: string,
  judgeContext?: string,
): Promise<{ action: "continue" | "stop"; reason: string }> {
  try {
    const contextParts: string[] = [];
    if (userQuery) contextParts.push(`User's original request: "${userQuery}"`);
    if (taskTemplate) contextParts.push(`If continued, "${targetAgent}" will be asked: "${taskTemplate}"`);
    if (judgeContext) contextParts.push(`Decision guidelines from the chain owner:\n${judgeContext}`);
    contextParts.push(`Agent "${sourceAgent}" just finished and produced the output below.`);
    contextParts.push(`You must decide: should "${targetAgent}" be triggered next?`);

    const userContent = [
      ...contextParts,
      "",
      `--- ${sourceAgent} Output ---`,
      agentResult.slice(0, 2000),
    ].join("\n");

    const res = await fetch(`${LITELLM.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.apiKey}`,
      },
      body: JSON.stringify({
        model: LITELLM.model,
        messages: [
          {
            role: "system",
            content: `You control an agent chain. Two agents collaborate to fulfill the user's request.

Your job: read the agent's output and decide CONTINUE or STOP, then call the \`decide\` tool with your decision.

STOP if:
- The agent completed the user's request — the answer/task is done
- The agent is asking the USER (human) a question or waiting for human input
- The agent cannot proceed without clarification from the user
- The output is an error or empty

CONTINUE if:
- The agent produced work that the next agent needs to act on (e.g. found issues to fix, created something to review)
- The agent explicitly handed off to the next agent with actionable items
- The task from the user's request is not yet fulfilled and the next agent can make progress WITHOUT human input

Key: if the agent needs a HUMAN to respond, STOP. Chains are agent-to-agent only.

You MUST call the \`decide\` tool — do not respond in plain text.`,
          },
          { role: "user", content: userContent },
        ],
        // Force a tool call. response_format: json_schema isn't reliably
        // enforced by Kimi via vLLM (reasoning prose leaks before JSON);
        // function calling with tool_choice IS, and it works across most
        // OpenAI-compatible models including Kimi.
        tools: [
          {
            type: "function",
            function: {
              name: "decide",
              description: "Decide whether the agent chain should continue or stop.",
              parameters: {
                type: "object",
                properties: {
                  action: { type: "string", enum: ["continue", "stop"], description: "continue triggers the target agent; stop ends the chain" },
                  reason: { type: "string", description: "Brief justification, max 80 characters. Be concise." },
                },
                required: ["action", "reason"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "decide" } },
        // Kimi/vLLM occasionally writes verbose reasons even with the prompt
        // cap. 200 was too tight — saw real prod truncations like "...waiting
        // for hu" in JSON parse errors. 400 leaves headroom; tool args still
        // tend to be ~50-80 tokens in practice.
        max_tokens: 400,
        temperature: 0,
      }),
      // Kimi via vLLM is slow under load; 15s timed out repeatedly in prod.
      // 30s is still well under the upstream webhook timeout (60s).
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.warn(`[chain-judge] LLM returned ${res.status}, defaulting to stop`);
      return { action: "stop", reason: `LLM error ${res.status}` };
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const message = data.choices?.[0]?.message;
    // Prefer the forced tool call. If for some reason the model still emitted
    // plain text (Kimi token-drop, vLLM serving glitch, etc.), fall back to
    // parsing message.content via the balanced-brace extractor.
    const toolArgs = message?.tool_calls?.[0]?.function?.arguments ?? "";
    const raw = toolArgs || (message?.content ?? "");

    // Brace extractor: handles the rare case where the model leaks reasoning
    // prose around the JSON (vLLM not enforcing tool_choice strictly, model
    // refusing the tool, etc.). Strict parse is tried first.
    const extractFirstJsonObject = (s: string): string | null => {
      let depth = 0;
      let start = -1;
      let inString = false;
      let escape = false;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === "{") {
          if (depth === 0) start = i;
          depth++;
        } else if (ch === "}") {
          depth--;
          if (depth === 0 && start >= 0) return s.slice(start, i + 1);
        }
      }
      return null;
    };

    const tryParse = (text: string): { action: string; reason: string } | null => {
      try { return JSON.parse(text) as { action: string; reason: string }; }
      catch { return null; }
    };

    let decision = tryParse(raw);
    if (!decision) {
      const block = extractFirstJsonObject(raw);
      if (block) decision = tryParse(block);
    }

    if (decision) {
      console.log(`[chain-judge] ${sourceAgent} → ${targetAgent}: ${decision.action} (${decision.reason})`);
      return {
        action: decision.action === "stop" ? "stop" : "continue",
        reason: decision.reason ?? "",
      };
    }
    console.warn(`[chain-judge] Failed to parse JSON: ${raw.slice(0, 200)}, defaulting to stop`);
    return { action: "stop", reason: "JSON parse error" };
  } catch (err) {
    console.warn(`[chain-judge] Failed, defaulting to stop:`, err instanceof Error ? err.message : err);
    return { action: "stop", reason: "fetch error" };
  }
}
