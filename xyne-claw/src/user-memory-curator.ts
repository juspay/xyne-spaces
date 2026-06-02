/**
 * User-Memory Curator — runs on claw, fed by claw-auth via
 * POST /internal/user-memory/distill.
 *
 * Distills a batch of a single user's authored Spaces records (messages /
 * hosted calls / authored canvases) into candidate facts about that user,
 * tagged into one of eight fixed subsystems.
 *
 * Difference from the session curator (curator.ts):
 *   - Input is THIS user's records, not an agent's transcript.
 *   - Output is FACTS ABOUT the user, not subsystem-memory updates.
 *   - Taxonomy is fixed (8 labels — see USER_MEMORY_SUBSYSTEMS) and the
 *     curator MUST pick one, never invent.
 *   - Returns 0..N candidates per call; expectation is most batches emit
 *     a handful of high-signal facts, not one per record.
 *
 * Same forced-tool-call pattern as the session curator for guaranteed-valid
 * JSON output across providers.
 *
 * Failures (LLM timeout, bad JSON, missing env) → return []. The caller
 * skips the batch and logs; no batch fails the whole pipeline.
 */

import {
  USER_MEMORY_SUBSYSTEMS,
  type UserMemoryCandidatePayload,
  type UserMemoryRecord,
  type UserMemorySubsystem,
} from "xyne-claw-shared";

const LITELLM_URL = (process.env["LITELLM_URL"] ?? "https://grid.ai.example.com").replace(/\/$/, "");
const LITELLM_API_KEY = process.env["LITELLM_API_KEY"] ?? "";
// Model name passed to LiteLLM for the distill call. Reads from `LITELLM_MODEL`
// to share the same env var with other LiteLLM-backed paths in this service
// (avoids having to keep two model env vars in sync when we upgrade Haiku).
const CURATOR_MODEL = process.env["LITELLM_MODEL"] ?? "claude-haiku-4-5-20251001";
const CURATOR_TIMEOUT_MS = Number(process.env["USER_MEMORY_CURATOR_TIMEOUT_MS"] ?? 60_000);

/** Hard cap per batch — over this the prompt blows past Haiku's window. */
const MAX_RECORDS_PER_BATCH = 50;
const MAX_TEXT_CHARS_PER_RECORD = 1_500;
const MAX_CANDIDATES_PER_BATCH = 12;

const EMIT_CANDIDATES_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_user_candidates",
    description: "Emit candidate facts about the user, drawn from the provided records.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        candidates: {
          type: "array",
          maxItems: MAX_CANDIDATES_PER_BATCH,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              text: {
                type: "string",
                description:
                  "Single concrete fact about the user, ≤ 1500 chars, written in third person ('the user…' or 'the user prefers…'). One fact per candidate. No generic statements; ground each in the records.",
              },
              subsystem: {
                type: "string",
                enum: [...USER_MEMORY_SUBSYSTEMS],
                description:
                  "MUST be one of the eight fixed labels. style=communication style/tone, expertise=domain knowledge, projects=ongoing work, relationships=collaborators/manager, preferences=tools/workflow conventions, decisions=judgment calls, context=identity/role, docs=references to authored canvases.",
              },
              signalScore: {
                type: "number",
                minimum: 0,
                maximum: 1,
                description:
                  "0-1. 1 = strongly evidenced across multiple records or a deliberate authored statement; 0.7+ = clear in one record; <0.7 should not be emitted at all (skip the candidate instead).",
              },
              groundedOnIds: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                description:
                  "IDs from the input records[] that ground this fact. The server attaches these as sourceRefs. ≥1 required; if you can't cite a record, do not emit.",
              },
            },
            required: ["text", "subsystem", "signalScore", "groundedOnIds"],
          },
        },
      },
      required: ["candidates"],
    },
  },
};

const SYSTEM_PROMPT = `You distill concrete, specific facts about a single user from their own authored Spaces activity (messages they posted in public/team channels, calls they hosted, canvases they authored).

Your output is read by the user themselves for approval, then fed to their personal "Digital Twin" agent. A future LLM will recall these memories when impersonating the user — so they must be **specific enough to actually influence the impersonation**, not bland summaries.

# The bar for "concrete"

A memory is concrete when it names at least one of:
- a **specific project, codename, repo, or system** ("the XYZ Migration Workflow", "the merchant-onboarding flow in spaces-backend")
- a **specific person** by handle or name ("collaborates with @aalok.jha and @shriharsha.m on the Agent Platform")
- a **specific tool, library, or surface** ("uses BullMQ for background jobs, not Sidekiq", "writes Prisma migrations by hand rather than via Studio")
- a **specific decision they made and why** ("chose to gate global-connector edits behind admin approval after the env-{} regression on 2026-05-22")
- a **specific stylistic pattern with at least one example trigger** ("when an LLM call fails, immediately logs err.name + err.cause rather than just err.message")
- a **specific role or responsibility** ("owns the Digital Twin curator pipeline end-to-end — fetcher, curator, retention, recall gate")

Abstract claims like "the user communicates clearly", "the user is technical", "the user is helpful" are ALL rejected. They're true of any senior engineer and tell the Twin nothing.

# Good vs bad

BAD: "The user prefers concise communication."
GOOD: "When responding to long technical questions in #engineering, the user defaults to a 3-line summary followed by code citations — rarely uses bullet lists."

BAD: "The user works on infrastructure."
GOOD: "The user is the sole owner of the xyne-claw-auth service's MCP runner — every recent change to mcp/runner.ts and mcp/connector-definitions.ts is theirs."

BAD: "The user collaborates with their team."
GOOD: "The user pairs frequently with @aalok.jha on agent-platform changes, and with @shriharsha.m on Spaces-side schema/ACL work. PRs from these two get reviewed within hours; others are batched."

BAD: "The user makes informed decisions."
GOOD: "The user decided on 2026-05-22 to ship the workspaceId fix to /channel/openDm immediately rather than wait for the unified Spaces release — recorded in the Digital Twin design canvas."

# Rules

1. **One concrete fact per candidate.** Never bundle two. Split "owns the curator AND uses Haiku 4.5" → two candidates.
2. **Ground every fact** in record IDs from the input. If you can't cite ≥1 record, do not emit.
3. **At least one specific entity (project / person / tool / decision / role) is required.** Skip the candidate if it doesn't have one — even if it feels true.
4. **Calibrate output volume to signal density.** A batch of 40 high-signal records about a specific project may produce 8-12 concrete candidates; a batch of routine standup messages may produce 0-2. Don't manufacture facts to hit a count.
5. **Subsystem selection is constrained.** Pick from the eight fixed labels in the tool schema. Never invent a new label.
6. **Third person + present tense.** "The user prefers X", "the user owns the Y flow", "the user works closely with @Z on …". Past-tense only for dated decisions.
7. **Quote sparingly but specifically.** Don't paste whole messages, but a 5-10 word identifying phrase from one ("'lockdown' on the security canvas", "the 'no-mock-DB-in-integration-tests' guideline") is much better than abstracting it away.
8. **Avoid PII bleed.** Don't include names of *private* individuals (e.g. customer names, candidates being interviewed). Frequent public collaborators (team members, manager) are fine.
9. **No speculation.** If a record is ambiguous, skip it — don't guess.

Call emit_user_candidates with your result. The tool schema enforces the shape.`;

function buildUserPrompt(records: UserMemoryRecord[], window: { from: string; to: string }): string {
  const lines: string[] = [
    `Time window: ${window.from} → ${window.to}`,
    `Records: ${records.length}`,
    "",
    "Records:",
  ];
  for (const r of records) {
    const headerBits = [`[${r.id}]`, r.type, r.ts];
    if (r.channelName) headerBits.push(`#${r.channelName}`);
    else if (r.channelId) headerBits.push(`channel=${r.channelId}`);
    if (r.title) headerBits.push(`title="${r.title.slice(0, 80)}"`);
    lines.push(headerBits.join(" "));
    lines.push((r.text ?? "").slice(0, MAX_TEXT_CHARS_PER_RECORD));
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Run the user-memory curator on a batch of records. Returns the raw
 * candidate payloads (server-side attaches sourceRefs from the input ids
 * before persisting).
 */
export async function distillUserMemory(
  userId: string,
  window: { from: string; to: string },
  records: UserMemoryRecord[],
): Promise<UserMemoryCandidatePayload[]> {
  if (records.length === 0) return [];
  if (!LITELLM_API_KEY) {
    console.warn("[user-memory-curator] LITELLM_API_KEY not set — skipping");
    return [];
  }

  const batch = records.slice(0, MAX_RECORDS_PER_BATCH);
  if (records.length > MAX_RECORDS_PER_BATCH) {
    console.warn(`[user-memory-curator] batch truncated ${records.length} → ${MAX_RECORDS_PER_BATCH} records userId=${userId}`);
  }

  let raw: string | undefined;
  try {
    const res = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LITELLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CURATOR_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(batch, window) },
        ],
        tools: [EMIT_CANDIDATES_TOOL],
        tool_choice: { type: "function", function: { name: EMIT_CANDIDATES_TOOL.function.name } },
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(CURATOR_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[user-memory-curator] LiteLLM returned ${res.status} userId=${userId}: ${body.slice(0, 200)}`);
      return [];
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };

    raw = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!raw) {
      console.warn(`[user-memory-curator] no tool_call in response userId=${userId}`);
      return [];
    }
  } catch (err) {
    console.warn(`[user-memory-curator] LLM call failed userId=${userId}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  let parsed: { candidates?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[user-memory-curator] bad JSON from LLM userId=${userId}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  if (!Array.isArray(parsed.candidates)) {
    console.warn(`[user-memory-curator] malformed candidates field userId=${userId}`);
    return [];
  }

  const recordIds = new Set(batch.map((r) => r.id));
  const subsystemSet = new Set<UserMemorySubsystem>(USER_MEMORY_SUBSYSTEMS);
  const out: UserMemoryCandidatePayload[] = [];

  for (const c of parsed.candidates) {
    if (!c || typeof c !== "object") continue;
    const cand = c as Record<string, unknown>;
    const text = typeof cand["text"] === "string" ? (cand["text"] as string).trim() : "";
    const subsystem = cand["subsystem"];
    const signalScore = typeof cand["signalScore"] === "number" ? (cand["signalScore"] as number) : 0;
    const groundedOnIds = Array.isArray(cand["groundedOnIds"])
      ? (cand["groundedOnIds"] as unknown[]).filter((id): id is string => typeof id === "string")
      : [];

    if (!text || text.length > 1_500) continue;
    if (typeof subsystem !== "string" || !subsystemSet.has(subsystem as UserMemorySubsystem)) continue;
    if (signalScore < 0.7) continue;
    const validIds = groundedOnIds.filter((id) => recordIds.has(id));
    if (validIds.length === 0) continue;

    out.push({
      text,
      subsystem: subsystem as UserMemorySubsystem,
      signalScore: Math.min(1, Math.max(0, signalScore)),
      groundedOnIds: validIds,
    });
  }

  return out;
}
