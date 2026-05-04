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

Your job: read the agent's output and decide CONTINUE or STOP.

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

Respond with JSON: {"action": "continue" or "stop", "reason": "one sentence"}`,
          },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "chain_decision",
            strict: true,
            schema: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["continue", "stop"] },
                reason: { type: "string" },
              },
              required: ["action", "reason"],
              additionalProperties: false,
            },
          },
        },
        max_tokens: 150,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[chain-judge] LLM returned ${res.status}, defaulting to stop`);
      return { action: "stop", reason: `LLM error ${res.status}` };
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? "";

    try {
      const decision = JSON.parse(raw) as { action: string; reason: string };
      console.log(`[chain-judge] ${sourceAgent} → ${targetAgent}: ${decision.action} (${decision.reason})`);
      return {
        action: decision.action === "stop" ? "stop" : "continue",
        reason: decision.reason ?? "",
      };
    } catch {
      console.warn(`[chain-judge] Failed to parse JSON: ${raw.slice(0, 100)}, defaulting to stop`);
      return { action: "stop", reason: "JSON parse error" };
    }
  } catch (err) {
    console.warn(`[chain-judge] Failed, defaulting to stop:`, err instanceof Error ? err.message : err);
    return { action: "stop", reason: "fetch error" };
  }
}
