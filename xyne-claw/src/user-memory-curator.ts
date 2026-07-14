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
  type ExistingUserMemory,
  type UserMemoryCandidatePayload,
  type UserMemoryRecord,
  type UserMemorySubsystem,
} from "xyne-claw-shared";
import { fetchLiteLLMWithRetry } from "./litellm-retry.js";

import { createLogger } from "./logger.js";
const log = createLogger("user-memory-curator");

const LITELLM_URL = (process.env["LITELLM_URL"] ?? "https://grid.ai.example.com").replace(/\/$/, "");
const LITELLM_API_KEY = process.env["LITELLM_API_KEY"] ?? "";
// Model name passed to LiteLLM for the distill call. Reads from `LITELLM_MODEL`
// to share the same env var with other LiteLLM-backed paths in this service
// (avoids having to keep two model env vars in sync when we upgrade Haiku).
const CURATOR_MODEL = process.env["LITELLM_MODEL"] ?? "claude-haiku-4-5-20251001";
const CURATOR_TIMEOUT_MS = Number(process.env["USER_MEMORY_CURATOR_TIMEOUT_MS"] ?? 600_000);

/** Hard cap per batch — over this the prompt blows past Haiku's window. */
const MAX_RECORDS_PER_BATCH = 50;
const MAX_TEXT_CHARS_PER_RECORD = 1_500;
/** Raised from 12 → 20: the enriched prompt scans a broad facet checklist
 *  (voice, response patterns, per-person tone, expertise, …) and a rich batch
 *  legitimately surfaces more distinct grounded facts than the old bland pass.
 *  The ≥0.7 signal bar + "merge near-duplicates" rule keep quantity honest. */
const MAX_CANDIDATES_PER_BATCH = 20;

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
                  "Single concrete fact about the user, ≤ 1500 chars, written in third person ('the user…' or 'the user prefers…'). One fact per candidate. No generic statements; ground each in the records. For style/voice facts, embed a short real example or trigger in quotes (e.g. acks with 'on it', never 'I will get to it') — a voice fact with no example is too vague to use.",
              },
              subsystem: {
                type: "string",
                enum: [...USER_MEMORY_SUBSYSTEMS],
                description:
                  "MUST be one of the eight fixed labels. style=voice + response/interaction mechanics (length, structure, openers, sign-offs, emoji, punctuation, register, how they ack/ask/disagree), expertise=domain knowledge & systems they demonstrably know, projects=ongoing work/codenames they drive, relationships=who they work with AND how the tone shifts per person, preferences=tools/workflow/formatting conventions they prefer or reject, decisions=judgment calls + the reasoning + date, context=identity/role/team/tenure, docs=references to canvases they authored.",
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

const SYSTEM_PROMPT = `You distill concrete, specific facts about a single user from their own Spaces activity — messages they posted, calls they hosted, canvases they authored, and (when present) reply records that pair an incoming message directed AT the user with how the user actually answered it.

Your output is reviewed by the user, then fed to their personal "Digital Twin" agent, which replies to chats AS the user. The Twin needs two things from you, and dropping either one breaks it:
- **WHAT** the user knows, owns, prefers, and decides — so the Twin has something to say.
- **HOW** the user actually communicates — their voice, their response shapes, and how they treat different people — so the reply reads like THEM and not a generic bot.
Cover both, exhaustively. Your job is comprehensive extraction: sweep the whole batch and surface every distinct, grounded signal — do not stop after a few facts.

# Two kinds of input record

- **Solo records** (type = message / call / canvas): something the user authored. Source for what they work on, know, prefer, decide — and, from the phrasing itself, their voice.
- **Reply records** (type = mention_reply): an incoming message aimed at the user (a question, request, or @mention) PAIRED with the user's own reply. These are the highest-signal source for **response patterns** — study the pair, not just the reply. What were they asked, and exactly how did they answer: length, opener, tone, structure, whether they ask a clarifying question back, how quickly they commit?

# The bar for "concrete"

A memory is concrete when it names at least one of:
- a **specific project, codename, repo, or system** ("the XYZ Migration Workflow", "the merchant-onboarding flow in spaces-backend")
- a **specific person** by handle or name ("collaborates with @aalok.jha and @shriharsha.m on the Agent Platform")
- a **specific tool, library, or surface** ("uses BullMQ for background jobs, not Sidekiq")
- a **specific decision and why** ("gated global-connector edits behind admin approval after the env-{} regression on 2026-05-22")
- a **specific communication pattern with a real trigger or example** ("acks review requests with a lowercase 'on it — easy bits first', rarely a full sentence")
- a **specific role or responsibility** ("owns the Digital Twin curator pipeline end-to-end")

Abstract claims true of any senior engineer — "communicates clearly", "is technical", "is collaborative", "prefers concise communication" — are ALL rejected. They tell the Twin nothing.

# Facet checklist — sweep every batch across ALL of these

Walk this list before you finish and emit a grounded candidate for each DISTINCT concrete signal the batch actually evidences. Most batches hit only some facets — that's expected. Never manufacture one to fill a slot; never leave a real, evidenced one on the table.

**STYLE — voice + response mechanics** (subsystem "style"):
- Message length & structure: one-liners vs multi-paragraph; prose vs bullets; do they lead with the answer or with context?
- Openers & sign-offs: greetings, "hey", "cc:", how they close — or that they never do.
- Emoji / reactions: whether, which ones, and where (👍 to ack, 🙏 to thank).
- Punctuation & casing quirks: all-lowercase, trailing "…", em-dashes, exclamation habit.
- Register: formal vs casual; recurring slang/idioms; abbreviations they reuse ("lgtm", "wdyt", "ptal").
- Directness: blunt vs hedged; how they disagree, say no, or deliver bad news.
- Humor / sarcasm — and where it shows up.
- Technical explanation style: code snippets, links, file:line citations, numbered steps.
- Acknowledgement & commitment style: "on it", "ack", "will do by EOD".
- How they ASK: what they ask first, whether they front-load context, how they request review or info.

**RELATIONSHIPS — per-person interaction** (subsystem "relationships"):
- Who they interact with most, and how the tone SHIFTS per person (terse with peer X, deferential to manager Y, jokey with Z).
- Who reviews their work, who they mentor, who they escalate to, cross-team contacts.
- How they address people (first name, @handle, nicknames).

**EXPERTISE** ("expertise"): specific domains, systems, files, languages, tools they demonstrably know; depth signals (debugging a named subsystem, reviewing others' code in area X).

**PROJECTS** ("projects"): ongoing work, codenames, what they drive or own right now.

**PREFERENCES** ("preferences"): tools / workflows / conventions they prefer OR reject; formatting conventions; process opinions.

**DECISIONS** ("decisions"): judgment calls, the reasoning, and the date.

**CONTEXT** ("context"): role, team, tenure, identity, working hours / timezone if evident.

**DOCS** ("docs"): canvases or docs they authored, with the topic.

# Reading reply records (type = mention_reply)

Capture the pattern as **trigger → response**, and route it:
- The response SHAPE (length, tone, opener, whether they ask back) → "style".
- If the tone is specific to WHO asked → "relationships".
Examples:
- "When asked for a status update, replies with a 2-3 line summary and calls out the current blocker first — no greeting."
- "When @priya requests a review, acks within the hour with a one-line caveat like 'lgtm-ing the easy bits first' rather than a full review."
- "Answers ambiguous asks with a clarifying question before committing — usually about the deadline."

# Good vs bad

BAD: "The user prefers concise communication."
GOOD: "Defaults to a 3-line summary followed by code citations for technical questions in #engineering — rarely uses bullet lists."

BAD: "The user is collaborative."
GOOD: "Pairs with @aalok.jha on agent-platform changes and @shriharsha.m on Spaces schema/ACL work; replies to those two within the hour, batches everyone else."

BAD: "The user responds to messages."
GOOD: "Acknowledges requests with a lowercase 'on it' plus a rough ETA in the same line; almost never uses greetings or sign-offs."

BAD: "The user makes informed decisions."
GOOD: "Decided on 2026-05-22 to ship the workspaceId fix to /channel/openDm immediately rather than wait for the unified release — noted in the Digital Twin design canvas."

# Rules

1. **One concrete fact per candidate.** Never bundle two. Split "owns the curator AND writes lowercase acks" → two candidates.
2. **Ground every fact** in record IDs from the input. If you can't cite ≥1 record, do not emit.
3. **At least one specific entity OR one concrete, exampled communication pattern is required.** Skip vague ones even if they feel true.
4. **Be comprehensive, not repetitive.** Cover every facet the batch evidences, but MERGE near-duplicate observations into the single most specific phrasing — don't emit five variations of "writes short replies".
5. **Calibrate volume to signal density.** A rich batch may yield 12-20 candidates; a batch of routine one-word messages may yield 0-2. Never manufacture to hit a count.
6. **Subsystem selection is constrained** to the eight fixed labels in the tool schema. Never invent one.
7. **Third person + present tense.** "The user prefers X", "the user acks with …". Past tense only for dated decisions.
8. **For style/voice facts, embed a short REAL example or trigger** (3-8 words, quoted) — "'on it', never 'I will get to it'". A voice fact without an example is usually too vague to use.
9. **Avoid PII bleed.** No names of private individuals (customers, interview candidates). Frequent public collaborators (teammates, manager) are fine.
10. **No speculation.** If a record is ambiguous, skip it — don't guess.

Call emit_user_candidates with your result. The tool schema enforces the shape.`;

/** Cap how many existing memories we inline (prompt-size guard) and how much
 *  of each we show — enough for the curator to recognise a match without
 *  blowing the window on a heavy user. */
const MAX_EXISTING_IN_PROMPT = 120;
const MAX_EXISTING_TEXT_CHARS = 300;

function buildUserPrompt(
  records: UserMemoryRecord[],
  window: { from: string; to: string },
  existingMemories: ExistingUserMemory[],
): string {
  const lines: string[] = [
    `Time window: ${window.from} → ${window.to}`,
    `Records: ${records.length}`,
  ];

  if (existingMemories.length > 0) {
    const shown = existingMemories.slice(0, MAX_EXISTING_IN_PROMPT);
    lines.push(
      "",
      "ALREADY KNOWN (memories previously approved for this user). Do NOT re-emit a",
      "fact that one of these already captures — that just creates a duplicate for",
      "the user to re-approve. Only emit a candidate when it is genuinely NEW, or a",
      "materially MORE SPECIFIC version of something below (a vague existing note",
      "made concrete). Skip trivial rewordings.",
      "",
    );
    for (const m of shown) {
      lines.push(`- (${m.subsystem}) ${(m.text ?? "").slice(0, MAX_EXISTING_TEXT_CHARS)}`);
    }
    if (existingMemories.length > shown.length) {
      lines.push(`… and ${existingMemories.length - shown.length} more not shown.`);
    }
  }

  lines.push("", "Records:");
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
  existingMemories: ExistingUserMemory[] = [],
): Promise<UserMemoryCandidatePayload[]> {
  if (records.length === 0) return [];
  if (!LITELLM_API_KEY) {
    log.warn("[user-memory-curator] LITELLM_API_KEY not set — skipping");
    return [];
  }

  const batch = records.slice(0, MAX_RECORDS_PER_BATCH);
  if (records.length > MAX_RECORDS_PER_BATCH) {
    log.warn(`[user-memory-curator] batch truncated ${records.length} → ${MAX_RECORDS_PER_BATCH} records userId=${userId}`);
  }

  let raw: string | undefined;
  try {
    const res = await fetchLiteLLMWithRetry(`${LITELLM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LITELLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CURATOR_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(batch, window, existingMemories) },
        ],
        tools: [EMIT_CANDIDATES_TOOL],
        tool_choice: { type: "function", function: { name: EMIT_CANDIDATES_TOOL.function.name } },
        temperature: 0.2,
      }),
    }, { timeoutMs: CURATOR_TIMEOUT_MS, label: `user-memory-curator:${userId}` });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(`[user-memory-curator] LiteLLM returned ${res.status} userId=${userId}: ${body.slice(0, 200)}`);
      return [];
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };

    raw = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!raw) {
      log.warn(`[user-memory-curator] no tool_call in response userId=${userId}`);
      return [];
    }
  } catch (err) {
    log.warn(`[user-memory-curator] LLM call failed userId=${userId}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  let parsed: { candidates?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn(`[user-memory-curator] bad JSON from LLM userId=${userId}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  if (!Array.isArray(parsed.candidates)) {
    log.warn(`[user-memory-curator] malformed candidates field userId=${userId}`);
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
