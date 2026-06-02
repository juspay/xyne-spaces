/**
 * Session Curator — runs on claw (where LITELLM_API_KEY lives).
 *
 * Called via /internal/curator/distill by claw-auth at batch-approval time.
 * Implementation moved here from claw-auth so LiteLLM credentials stay
 * scoped to one pod and "all LLM calls happen on claw" remains a clean
 * invariant.
 *
 * The taxonomy of "subsystems" is NOT hardcoded. It's the set of distinct
 * `subsystem:X` tags currently present in the agent's Hindsight bank.
 * The bank is the source of truth; admin shapes the taxonomy by approving
 * (or rejecting) new-subsystem proposals as they emerge from real sessions.
 *
 * Two LLM calls per session that touches subsystems:
 *   1. classifyTouchedSubsystems — returns existing subsystems matched +
 *      at most one new-subsystem proposal.
 *   2. proposeSubsystemUpdate — one call per touched subsystem; returns
 *      the full updated memory text or action=none.
 *
 * Failures (LLM timeout, bad JSON, missing env) absorbed → return [].
 */

import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import type { SessionTranscriptForCurator, SubsystemUpdate } from "xyne-claw-shared";

const LITELLM_URL = (process.env["LITELLM_URL"] ?? "https://grid.ai.example.com").replace(/\/$/, "");
const LITELLM_API_KEY = process.env["LITELLM_API_KEY"] ?? "";
const CURATOR_MODEL = process.env["MEMORY_CURATOR_MODEL"] ?? "claude-haiku-4-5-20251001";
const CURATOR_TIMEOUT_MS = Number(process.env["MEMORY_CURATOR_TIMEOUT_MS"] ?? 30_000);

const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_MEMORY_CHARS = 1_500;
const MIN_CONFIDENCE = 0.7;
const MAX_NEW_SUBSYSTEMS_PER_SESSION = 1;

interface KnownSubsystem {
  name: string;
  memoryId: string;
  content: string;
}

async function getKnownSubsystems(agentSlug: string): Promise<KnownSubsystem[]> {
  try {
    const provider = getMemoryProvider();
    const bankId = bankIdForAgent(agentSlug);
    const page = await provider.listMemories(bankId, { limit: 200 });
    const out: KnownSubsystem[] = [];
    const seen = new Set<string>();
    for (const m of page.memories) {
      const subsystemTag = (m.tags ?? []).find((t) => t.startsWith("subsystem:"));
      if (!subsystemTag || !m.id) continue;
      const name = subsystemTag.slice("subsystem:".length).trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, memoryId: m.id, content: m.content ?? "" });
    }
    return out;
  } catch (err) {
    console.warn(`[curator] Failed to list known subsystems — treating bank as empty agentSlug=${agentSlug}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function buildTranscriptBlob(t: SessionTranscriptForCurator): string {
  if (t.transcript) return t.transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  return `Task: ${t.task}\n\nFinal response:\n${t.result}`.slice(0, MAX_TRANSCRIPT_CHARS);
}

/**
 * Forced-tool-call output schemas. We use `tool_choice: { type: "function",
 * function: { name } }` to require the model to emit exactly one tool call
 * with arguments matching the schema. LiteLLM normalizes this across
 * providers (claude-haiku, gpt, gemini) — arguments come back as a
 * guaranteed-valid JSON string, no markdown fence, no prose.
 *
 * Previously we relied on `response_format: json_object`. claude-haiku
 * via LiteLLM passthrough sometimes wrapped that output in ```json``` and
 * broke JSON.parse. Tool calls don't have that failure mode.
 */
const CLASSIFY_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_classification",
    description: "Emit the subsystem classification result for the given session.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        existing: {
          type: "array",
          items: { type: "string" },
          description:
            "Subsystem slugs (from the existing-subsystems list) that this session demonstrably touched. Empty array if none.",
        },
        newProposals: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string", description: "kebab-case, lowercase, ≤ 30 chars" },
              why: { type: "string", description: "≤ 200 chars, why this is a new coherent area" },
            },
            required: ["name", "why"],
          },
          description:
            "Up to ONE new-subsystem proposal if the session reveals a coherent area not covered by any existing subsystem. Empty array otherwise.",
        },
      },
      required: ["existing", "newProposals"],
    },
  },
};

const PROPOSE_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_proposal",
    description:
      "Emit a subsystem-memory update proposal, or action=none to skip this session for this subsystem.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["update", "create", "none"],
          description:
            "update: replace the existing memory. create: first memory for a brand-new subsystem. none: this session doesn't add anything material.",
        },
        proposedContent: {
          type: "string",
          description:
            "Full proposed memory text (replaces existing entirely). ≤ 1500 chars. Empty string if action=none.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "≥ 0.7 required to use action=update|create. Below that, return action=none.",
        },
        reasoning: {
          type: "string",
          description: "≤ 300 chars. What this update adds/corrects and why it transfers to future sessions.",
        },
      },
      required: ["action", "proposedContent", "confidence", "reasoning"],
    },
  },
};

const CLASSIFY_SYSTEM_PROMPT = `You classify an agent session transcript into subsystems of the agent's domain.

A "subsystem" is a coherent area of the codebase / system the agent works in (examples: notifications, ticket-creation, zero-cache-sync). You will be given the agent's CURRENT subsystem list — each subsystem with its current memory text describing it.

Your job:
1. Read the transcript.
2. Decide which of the existing subsystems the session DEMONSTRABLY touched (evidence in the transcript content, not your general knowledge).
3. If the session clearly involves a coherent area NOT covered by any existing subsystem, propose at most ONE new subsystem name (kebab-case, ≤ 30 chars, descriptive).

Rules:
- Default to empty arrays. Most sessions don't touch any subsystem clearly.
- "Touched" means the agent did real work in that area — not just mentioned a word.
- Do NOT propose a new subsystem just because a transcript term doesn't exactly match an existing name. Reuse the closest existing subsystem if it's a fit.
- New subsystems are rare. The bar is HIGH: the session must reveal a coherent area that genuinely doesn't fit any existing subsystem.

Call the emit_classification tool with your result. The tool schema enforces the output shape.`;

function buildClassifyUserPrompt(t: SessionTranscriptForCurator, known: KnownSubsystem[]): string {
  const knownBlock =
    known.length === 0
      ? "(No subsystems exist yet — the taxonomy is empty. If the session reveals a coherent area, propose a new subsystem.)"
      : known
          .map(
            (k) =>
              `- **${k.name}**\n${(k.content || "(empty memory)")
                .slice(0, 500)
                .split("\n")
                .map((l) => `    ${l}`)
                .join("\n")}`,
          )
          .join("\n\n");

  return [
    `Agent: ${t.agentSlug}`,
    `User: ${t.userId}`,
    `Tools used: ${t.toolsUsed.length > 0 ? t.toolsUsed.join(", ") : "(none)"}`,
    "",
    `Existing subsystems for this agent:`,
    knownBlock,
    "",
    "Transcript:",
    buildTranscriptBlob(t),
  ].join("\n");
}

const PROPOSE_SYSTEM_PROMPT = `You maintain a single memory document for one subsystem of an agent's domain.

You will be given:
  - The subsystem name.
  - The current memory text (or "(no existing memory)" for a brand-new subsystem).
  - A session transcript that demonstrably touched this subsystem.

Decide whether the session reveals NEW or CORRECTING understanding worth integrating into the subsystem's memory.

Rules:
1. Bias toward CONNECTED UNDERSTANDING over isolated facts. The memory is a coherent description of the subsystem — how it works, what its components are, how to debug it, what to avoid. NOT a list of trivia.
2. Bias toward architecture / patterns over file:line. Line numbers age out. Prefer "creation lives in xyne-backend, delivery in notification-worker" over "X is at backend/src/Y.ts:142".
3. Only integrate facts demonstrably present in this transcript. If you'd be relying on general knowledge of the codebase to make a claim, drop it.
4. If the session contradicts the existing memory, prefer transcript evidence — and explicitly note the correction in your reasoning.
5. If the session adds nothing material (already covered, too trivial, too session-specific), return action="none".
6. The proposed content REPLACES the existing memory entirely on approve — write the full new text, not a diff.
7. Hard cap: proposed content ≤ 1500 chars. Trim or summarize aggressively if integrating would exceed it.

Call the emit_proposal tool with your result. Rules enforced by the schema + this prompt:
- confidence ≥ 0.7 to use action=update or action=create. Below that, return action=none.
- action=create ONLY when there is no existing memory (you'll be told). Otherwise use update.
- proposedContent is the full new memory text, not a diff. Empty string when action=none.`;

function buildProposeUserPrompt(
  t: SessionTranscriptForCurator,
  subsystem: string,
  existingContent: string | null,
): string {
  return [
    `Subsystem: ${subsystem}`,
    "",
    "Current memory:",
    existingContent === null ? "(no existing memory — this would be a new memory)" : existingContent,
    "",
    `Session transcript (agent: ${t.agentSlug}, user: ${t.userId}, tools: ${t.toolsUsed.join(", ") || "(none)"}):`,
    buildTranscriptBlob(t),
  ].join("\n");
}

interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/**
 * Some LiteLLM provider paths (notably MiniMax / minimaxai/minimax-m2)
 * emit tool calls as XML in `message.content` instead of OpenAI-style
 * `tool_calls`. Shape:
 *
 *   <minimax:tool_call>
 *   <invoke name="emit_classification">
 *     <parameter name="existing">[]</parameter>
 *     <parameter name="newProposals">[{"name":"spaces","why":"..."}]</parameter>
 *   </invoke>
 *   </minimax:tool_call>
 *
 * Each <parameter> value is the JSON-encoded argument. If LiteLLM later
 * starts normalizing this into proper `tool_calls`, this fallback simply
 * stops firing — no harm done.
 */
function tryParseXmlToolCall(content: string, expectedToolName: string): unknown | null {
  if (!content) return null;
  const invokeMatch = content.match(/<invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/invoke>/);
  if (!invokeMatch) return null;
  const [, toolName, body] = invokeMatch;
  if (toolName !== expectedToolName) return null;
  const out: Record<string, unknown> = {};
  const paramRe = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/g;
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(body ?? "")) !== null) {
    const [, key, rawValue] = m;
    if (!key) continue;
    const trimmed = (rawValue ?? "").trim();
    // Try JSON; fall back to raw string for plain text params.
    try {
      out[key] = JSON.parse(trimmed);
    } catch {
      out[key] = trimmed;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Call the curator LLM with a forced tool call. The provider must emit
 * exactly one tool call whose arguments match the tool's JSON schema —
 * no content prose, no markdown fence. Returns the parsed arguments
 * object (or null on any failure).
 */
async function llmCall(
  systemPrompt: string,
  userPrompt: string,
  tool: ToolSpec,
  sessionId: string,
): Promise<unknown | null> {
  if (!LITELLM_API_KEY) {
    console.warn(`[curator] LITELLM_API_KEY not set sessionId=${sessionId}`);
    return null;
  }
  const body = {
    model: CURATOR_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    tools: [tool],
    tool_choice: { type: "function", function: { name: tool.function.name } },
  };
  try {
    const res = await fetch(`${LITELLM_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LITELLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CURATOR_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[curator] LiteLLM non-OK sessionId=${sessionId} status=${res.status} body=${text.slice(0, 300)}`);
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const message = data.choices?.[0]?.message;
    const toolCalls = message?.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      // Fallback: some providers (MiniMax via LiteLLM) emit tool calls as XML
      // in `content` rather than `tool_calls`. Try to extract.
      const fallbackContent = String(message?.content ?? "");
      const xmlParsed = tryParseXmlToolCall(fallbackContent, tool.function.name);
      if (xmlParsed !== null) {
        console.info(
          `[curator] parsed XML-style tool_call from content sessionId=${sessionId} tool=${tool.function.name}`,
        );
        return xmlParsed;
      }
      console.warn(
        `[curator] expected tool_call but got content-only sessionId=${sessionId} sample=${fallbackContent.slice(0, 200)}`,
      );
      return null;
    }
    const call = toolCalls[0];
    if (call?.function?.name && call.function.name !== tool.function.name) {
      console.warn(
        `[curator] unexpected tool_call name sessionId=${sessionId} expected=${tool.function.name} got=${call.function.name}`,
      );
      return null;
    }
    const argsRaw = call?.function?.arguments;
    if (typeof argsRaw !== "string" || argsRaw.length === 0) {
      console.warn(`[curator] tool_call arguments missing sessionId=${sessionId}`);
      return null;
    }
    try {
      return JSON.parse(argsRaw);
    } catch {
      // Fallback: some providers (MiniMax via LiteLLM) put XML-style tool
      // call markup IN the arguments string instead of JSON. Parse that out.
      const xmlParsed = tryParseXmlToolCall(argsRaw, tool.function.name);
      if (xmlParsed !== null) {
        console.info(
          `[curator] parsed XML-style arguments sessionId=${sessionId} tool=${tool.function.name}`,
        );
        return xmlParsed;
      }
      console.warn(
        `[curator] tool_call arguments not valid JSON or XML sessionId=${sessionId} sample=${argsRaw.slice(0, 200)}`,
      );
      return null;
    }
  } catch (err) {
    console.error(`[curator] LLM call failed sessionId=${sessionId} err=${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

interface RawClassification {
  existing?: unknown;
  newProposals?: unknown;
}
interface RawProposal {
  action?: unknown;
  proposedContent?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
}

function sanitizeSubsystemName(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const cleaned = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!cleaned || cleaned.length > 30) return null;
  return cleaned;
}

async function classifyTouchedSubsystems(
  t: SessionTranscriptForCurator,
  known: KnownSubsystem[],
): Promise<{ existing: string[]; newProposals: Array<{ name: string; why: string }> }> {
  const result = await llmCall(
    CLASSIFY_SYSTEM_PROMPT,
    buildClassifyUserPrompt(t, known),
    CLASSIFY_TOOL,
    t.sessionId,
  );
  if (!result) return { existing: [], newProposals: [] };

  const raw = result as RawClassification;
  const knownSet = new Set(known.map((k) => k.name));

  const existing = Array.isArray(raw.existing)
    ? raw.existing
        .map((x) => (typeof x === "string" ? sanitizeSubsystemName(x) : null))
        .filter((n): n is string => !!n && knownSet.has(n))
    : [];

  const newProposalsRaw = Array.isArray(raw.newProposals) ? raw.newProposals : [];
  const newProposals: Array<{ name: string; why: string }> = [];
  for (const p of newProposalsRaw) {
    if (typeof p !== "object" || p === null) continue;
    const pp = p as { name?: unknown; why?: unknown };
    const name = sanitizeSubsystemName(pp.name);
    if (!name) continue;
    if (knownSet.has(name)) continue;
    const why = typeof pp.why === "string" ? pp.why.slice(0, 200) : "";
    newProposals.push({ name, why });
    if (newProposals.length >= MAX_NEW_SUBSYSTEMS_PER_SESSION) break;
  }

  return { existing, newProposals };
}

async function proposeSubsystemUpdate(
  t: SessionTranscriptForCurator,
  subsystem: string,
  existingContent: string | null,
): Promise<SubsystemUpdate | null> {
  const result = await llmCall(
    PROPOSE_SYSTEM_PROMPT,
    buildProposeUserPrompt(t, subsystem, existingContent),
    PROPOSE_TOOL,
    t.sessionId,
  );
  if (!result) return null;

  const raw = result as RawProposal;
  const action = raw.action === "update" || raw.action === "create" ? raw.action : "none";
  if (action === "none") return null;
  if (action === "update" && existingContent === null) return null;
  if (action === "create" && existingContent !== null) return null;

  const content = typeof raw.proposedContent === "string" ? raw.proposedContent.trim() : "";
  const confidence = typeof raw.confidence === "number" ? raw.confidence : -1;
  const reasoning = typeof raw.reasoning === "string" ? raw.reasoning.trim() : "";

  if (!content || content.length > MAX_MEMORY_CHARS) return null;
  if (confidence < MIN_CONFIDENCE || confidence > 1) return null;
  if (!reasoning) return null;

  return {
    subsystem,
    action,
    proposedContent: content,
    reasoning,
    confidence,
    replacesMemoryId: null,
    isNewSubsystem: false,
  };
}

/**
 * Distill ONE session into subsystem update candidates. Returns [] when
 * nothing in this session is worth retaining as durable subsystem knowledge.
 *
 * Called by claw's /internal/curator/distill endpoint.
 */
export async function distillSession(t: SessionTranscriptForCurator): Promise<SubsystemUpdate[]> {
  const known = await getKnownSubsystems(t.agentSlug);

  const classification = await classifyTouchedSubsystems(t, known);
  if (classification.existing.length === 0 && classification.newProposals.length === 0) {
    console.info(`[curator] No subsystems touched sessionId=${t.sessionId} agentSlug=${t.agentSlug} knownCount=${known.length}`);
    return [];
  }

  const updates: SubsystemUpdate[] = [];

  for (const name of classification.existing) {
    const existing = known.find((k) => k.name === name);
    if (!existing) continue;
    const proposal = await proposeSubsystemUpdate(t, name, existing.content);
    if (proposal) {
      proposal.replacesMemoryId = existing.memoryId;
      proposal.isNewSubsystem = false;
      updates.push(proposal);
    }
  }

  for (const { name, why } of classification.newProposals) {
    const proposal = await proposeSubsystemUpdate(t, name, null);
    if (proposal) {
      proposal.isNewSubsystem = true;
      proposal.reasoning = `[NEW SUBSYSTEM PROPOSAL — ${why}] ${proposal.reasoning}`.slice(0, 500);
      updates.push(proposal);
    }
  }

  console.info(`[curator] Distilled sessionId=${t.sessionId} agentSlug=${t.agentSlug} updates=${updates.length} existingTouched=${classification.existing.length} newProposed=${classification.newProposals.length}`);

  return updates;
}
