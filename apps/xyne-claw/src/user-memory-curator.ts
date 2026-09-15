/**
 * User-Memory Curator — runs on claw, fed by claw-auth via
 * POST /internal/user-memory/distill.
 *
 * Distills a batch of a single user's authored Spaces records (messages /
 * hosted calls / authored canvases) into candidate facts about that user,
 * tagged into one of the fixed subsystems (see USER_MEMORY_SUBSYSTEMS).
 *
 * Difference from the session curator (curator.ts):
 *   - Input is THIS user's records, not an agent's transcript.
 *   - Output is FACTS ABOUT the user, not subsystem-memory updates.
 *   - Taxonomy is fixed (see USER_MEMORY_SUBSYSTEMS) and the
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
  type UserMemoryCuratorEmittedCandidate,
  type UserMemoryCuratorTrace,
  type UserMemoryRecord,
  type UserMemorySubsystem,
} from "xyne-claw-shared";
import { fetchLiteLLMWithRetry } from "@xyne/litellm-client";

import { createLogger } from "./logger.js";
const log = createLogger("user-memory-curator");

const LITELLM_URL = (process.env["LITELLM_URL"] ?? "https://grid.ai.example.com").replace(/\/$/, "");
// Background job: prefer the low-priority automation key so curator bursts
// can't queue interactive agent turns on the main key's parallel-slot pool.
const LITELLM_API_KEY = process.env["LITELLM_AUTOMATION_API_KEY"]?.trim() || (process.env["LITELLM_API_KEY"] ?? "");
// Model name passed to LiteLLM for the distill call. MUST resolve from the same
// source as LITELLM_API_KEY above: LiteLLM keys are team-scoped and the teams'
// allowed-model lists are DISJOINT, so sending the interactive `LITELLM_MODEL`
// with the automation key is a hard 403 ("team not allowed to access model") —
// prod 2026-08-14, automation team allowed `private-large` but not
// `private-large-spaces`. Mirrors the key fallback order.
const CURATOR_MODEL = process.env["LITELLM_AUTOMATION_MODEL"]?.trim()
  || process.env["LITELLM_MODEL"]
  || "claude-haiku-4-5-20251001";
const CURATOR_TIMEOUT_MS = Number(process.env["USER_MEMORY_CURATOR_TIMEOUT_MS"] ?? 600_000);
// Per-retry timeout escalation: a slow LLM gateway is usually just slow, not
// stuck, so give each retry more room. attempt 1 = base (10m), attempt 2 =
// base+step (12m), attempt 3 = base+2·step (14m).
const CURATOR_TIMEOUT_STEP_MS = Number(process.env["USER_MEMORY_CURATOR_TIMEOUT_STEP_MS"] ?? 120_000);

/** Record-count backstop. The auth-side packer first enforces the ~80k-token
 * record-text budget, so this mainly lets batches of short messages use the
 * available context instead of stopping at the old 50-record ceiling. */
const MAX_RECORDS_PER_BATCH = 200;
const MAX_TEXT_CHARS_PER_RECORD = 1_500;
/** Assembled conversation units (type="conversation") carry a whole thread and
 *  legitimately need far more room than a single message. This is now a
 *  NON-CLIPPING backstop, not a real cap: the claw-auth batch packer
 *  (userMemoryBatcher) already bounds every record to ≤ its char budget
 *  (BATCH_TOKEN_BUDGET × 4 = 320k chars) by sub-chunking oversized units, so a
 *  full conversation unit (3k-char messages, whole thread, + async hydration)
 *  arrives already-bounded. Set at that same 320k ceiling so this slice never
 *  truncates a unit the packer already sized — the earlier 5k value re-clipped
 *  the very messages the 3k-per-message change was meant to preserve. */
const MAX_CONVERSATION_CHARS = 320_000;
/** A 200-record batch can contain many independent, grounded signals. Keep a
 * high output ceiling so combining short records does not reduce recall; the
 * ≥0.7 signal bar and "merge near-duplicates" rule still control quality. */
const MAX_CANDIDATES_PER_BATCH = 100;

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
                  "Single concrete fact about the user, written in third person ('the user…' or 'the user prefers…'). Keep it concise but complete. One fact per candidate. No generic statements; ground each in the records. For style/voice facts, embed a short real example or trigger in quotes (e.g. acks with 'on it', never 'I will get to it') — a voice fact with no example is too vague to use.",
              },
              subsystem: {
                type: "string",
                enum: [...USER_MEMORY_SUBSYSTEMS],
                description:
                  "MUST be one of the fixed labels. style=voice + response/interaction mechanics (length, structure, openers, sign-offs, emoji, punctuation, register, how they ack/ask/disagree), triage=respond-vs-ignore behaviour (which senders/channels/channel-types/topics/message-types they engage with vs stay silent on — feeds the auto-reply gate; keep separate from style), expertise=domain knowledge & systems they demonstrably know, projects=ongoing work/codenames they drive, relationships=who they work with AND how the tone shifts per person, preferences=tools/workflow/formatting conventions they prefer or reject, decisions=judgment calls + the reasoning + date, context=identity/role/team/tenure, docs=references to canvases they authored.",
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

# Kinds of input record

- **Solo records** (type = message / call / canvas): something the user authored. Source for what they work on, know, prefer, decide — and, from the phrasing itself, their voice.
- **Reply records** (type = mention_reply): an incoming message aimed at the user (a question, request, or @mention) PAIRED with the user's own reply. These are the highest-signal source for **response patterns** — study the pair, not just the reply. What were they asked, and exactly how did they answer: length, opener, tone, structure, whether they ask a clarifying question back, how quickly they commit?
- **Conversation units** (type = conversation): a full thread the user took part in. The first line names the channel + its TYPE (dm / group_dm / public / private), the message count, the user's role (AUTHOR / MENTIONED / PARTICIPANT), and — when they were mentioned — a behavioural verdict: RESPONDED (with latency) or IGNORED (with how long unanswered). Then the parent message (what the thread replies to) and every turn in order. **Other people's lines are CONTEXT only — extract facts about THE USER, never about a co-participant.** These are the richest source for BOTH the user's voice/response-shape AND when / where / with whom they answer vs ignore. See "Reading conversation units" below.

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

**TRIAGE — respond vs ignore** (subsystem "triage") — this facet FEEDS the respond/ignore gate, so label it precisely and keep it SEPARATE from STYLE (style = HOW they write; triage = WHETHER they reply at all):
- Which senders / channels / channel-types (DM vs public vs @channel broadcast) / topics they RESPOND to versus let sit or IGNORE.
- Response conditions: answer direct DMs but skip @channel broadcasts? reply fast to their manager but ignore marketing threads? engage on their own projects but not others'?
- Explicit non-response: mentions they were tagged in and NEVER replied to — and what those share (bot/automation pings, off-topic, out-of-hours, threads they don't drive). A tagged-but-unanswered mention is a first-class signal, not an absence of one.
- Only emit when the batch evidences a real engage-vs-silent PATTERN across ≥2 instances; don't infer from a single non-reply.

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

# Reading conversation units (type = conversation)

The behavioural header gives you the outcome — mine BOTH outcomes, and always weigh the channel TYPE (the same words mean different things in a private DM vs a public channel):
- **RESPONDED**: capture the response SHAPE → "style"; if the tone is specific to WHO asked or WHERE → "relationships". Note latency + prioritisation habits ("replies to direct DMs within minutes, lets #general @channel pings sit until EOD").
- **IGNORED**: a mention the user did NOT answer IN-THREAD is a real, first-class signal — but before calling it a true ignore, CHECK THE HYDRATION BLOCK (see below). If they engaged elsewhere, it's a cross-channel response habit, not an ignore. A genuine ignore (no engagement anywhere) is itself signal — capture WHAT they skip and WHERE ("leaves broad @channel FYIs in #announcements unanswered", "rarely replies to group_dm pings but always answers 1:1 DMs"). Route to "triage" (whether/where they engage) and, as apt, "relationships" (who they deprioritise). Only emit an ignore pattern when it's evidenced across ≥2 units — a single non-response is often just timing, not a pattern.
- **AUTHOR / PARTICIPANT** threads (no mention): read for how the user drives or joins a discussion — how they open, hand off, escalate, or close a thread.
Never emit a fact grounded only in a co-participant's line; the memory must be about the user.

## The hydration block ("What @you did NEXT, elsewhere")

An IGNORED unit may be followed by a block titled "What @you did NEXT, elsewhere". These lines are the SAME user's own later messages in OTHER channels/DMs, shown with the delay since the ping and the channel type/name. They exist because a user often answers a ping OUT-OF-THREAD — replying in another channel, or DMing the person who asked — which would otherwise look like an ignore. Read the block strictly as CONTEXT for ONE question: **did the user actually engage with this ping elsewhere, or truly ignore it?**
- If a follow-up plausibly ADDRESSES the ping (same topic, or a DM to the asker soon after) → this is a **cross-channel response pattern**, not an ignore. Emit a "triage" fact: e.g. "when @-mentioned in a public channel, tends not to reply in-thread but follows up by DMing the asker within the hour". Add "relationships"/"style" facts if the who/how is specific.
- If the follow-ups are UNRELATED (the user was just busy elsewhere) → treat the mention as a genuine ignore and read it as above.
- STAY GROUNDED: do NOT assume an unrelated next message is a reply. Only treat it as engagement when it plausibly addresses the ping. When in doubt, say nothing rather than invent a response.
- The hydration lines are CONTEXT ONLY — do NOT mine them for facts about what the user did in those other channels (those messages are curated in their own right). Use them solely to characterise the respond/ignore behaviour for THIS ping, and ground that fact on THIS unit's id.

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
5. **Calibrate volume to signal density.** A rich 200-record batch may yield dozens of candidates (up to 100); a batch of routine one-word messages may yield 0-2. Never manufacture to hit a count.
6. **Subsystem selection is constrained** to the eight fixed labels in the tool schema. Never invent one.
7. **Third person + present tense.** "The user prefers X", "the user acks with …". Past tense only for dated decisions.
8. **For style/voice facts, embed a short REAL example or trigger** (3-8 words, quoted) — "'on it', never 'I will get to it'". A voice fact without an example is usually too vague to use.
9. **Avoid PII bleed.** No names of private individuals (customers, interview candidates). Frequent public collaborators (teammates, manager) are fine.
10. **No speculation.** If a record is ambiguous, skip it — don't guess.

Call emit_user_candidates with your result. The tool schema enforces the shape.
IMPORTATNT NOTE: The memory text must be atleast 2 sentences and maximum 4 sentences`;

/** Cap how many existing memories we inline (prompt-size guard) and how much
 *  of each we show — enough for the curator to recognise a match without
 *  blowing the window on a heavy user. */
const MAX_EXISTING_IN_PROMPT = 120;
const MAX_EXISTING_TEXT_CHARS = 300;

/** Cap on prompt + raw-response text stored in the trace so a large batch
 *  can't bloat the persisted DigitalTwinPipelineEvent row. */
const TRACE_TEXT_CAP = 120_000;

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
    const textCap = r.type === "conversation" ? MAX_CONVERSATION_CHARS : MAX_TEXT_CHARS_PER_RECORD;
    lines.push((r.text ?? "").slice(0, textCap));
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Best-effort recovery when the forced tool_choice doesn't materialize as a
 * proper `tool_calls` array and the emit_user_candidates payload ends up in
 * message.content instead. Two shapes are handled:
 *
 *   1. Plain JSON — `{ "candidates": [...] }` (optionally fenced / wrapped in
 *      prose). Some gateways answer the forced call this way.
 *   2. GLM native tool-call markup that LiteLLM failed to normalize into
 *      tool_calls, e.g. (note the sometimes-doubled opening tag):
 *        <tool_call><tool_call>emit_user_candidates<arg_key>candidates</arg_key><arg_value>[...]</arg_value></tool_call>
 *      This is intermittent — glm-latest usually emits well-formed markup that
 *      LiteLLM parses fine; a malformed variant leaks through as text.
 *
 * Returns a JSON string that parses to `{ candidates: [...] }` (including an
 * empty array — a legitimate "no candidates" result), or null otherwise.
 */
function extractToolArgsFromContent(content: string): string | null {
  const stripped = content.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const tryParse = (s: string): string | null => {
    try {
      const obj = JSON.parse(s) as { candidates?: unknown };
      if (obj && typeof obj === "object" && Array.isArray(obj.candidates)) return s;
    } catch {
      /* not JSON — fall through */
    }
    return null;
  };

  // 1) Plain JSON payload in content — whole string, then first `{`…last `}`.
  const whole = tryParse(stripped);
  if (whole) return whole;
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  const sliced = first >= 0 && last > first ? tryParse(stripped.slice(first, last + 1)) : null;
  if (sliced) return sliced;

  // 2) GLM native tool-call markup — pull the `candidates` arg_value and
  //    rebuild the payload. Non-greedy up to the first </arg_value>.
  const argValue = stripped
    .match(/<arg_key>\s*candidates\s*<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/i)?.[1]
    ?.trim();
  if (argValue !== undefined) return tryParse(`{"candidates":${argValue}}`);

  return null;
}

/** How many times to (re)attempt the LLM call for a single batch before giving
 *  up. Transient model-output failures (no tool_call, bad/malformed JSON) and
 *  5xx/timeouts are RETRIED — the same prompt very often succeeds on a fresh
 *  sample, so a one-off formatting glitch no longer discards a whole batch of
 *  records (previously "malformed-candidates" → the window's records were lost). */
const CURATOR_MAX_ATTEMPTS = Math.max(1, Number(process.env["USER_MEMORY_CURATOR_MAX_ATTEMPTS"] ?? 3));

/** Error stages that are worth retrying (transient / output-quality). 4xx and
 *  no-api-key are permanent and are NOT retried. */
function isRetryableCuratorError(error: string): boolean {
  if (error === "no-tool-call" || error === "bad-json" || error === "malformed-candidates") return true;
  const httpMatch = error.match(/^llm-http-(\d+)$/);
  if (httpMatch) return Number(httpMatch[1]) >= 500;
  if (error === "no-api-key") return false;
  // Thrown errors (network / timeout / abort) surface as their message — retry.
  return true;
}

/** Per-attempt debug context, surfaced in the trace whether the attempt won or
 *  lost (thinking, finish reason, raw content, how the tool args were obtained). */
interface AttemptMeta {
  usage?: { promptTokens?: number; completionTokens?: number };
  reasoning?: string;
  finishReason?: string;
  rawContent?: string;
  toolCallName?: string;
  toolCallSource?: "tool_calls" | "recovered-content";
}

type AttemptResult =
  | {
      ok: true;
      candidates: UserMemoryCandidatePayload[];
      emitted: UserMemoryCuratorEmittedCandidate[];
      rawResponse: string;
      meta: AttemptMeta;
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      rawResponse?: string;
      meta: AttemptMeta;
      /** Present on "all-ungrounded": what the model emitted, so the caller can
       *  fall back to batch-level provenance instead of losing the batch. */
      emitted?: UserMemoryCuratorEmittedCandidate[];
      salvageable?: UserMemoryCuratorEmittedCandidate[];
    };

/** One LLM call + parse + server-side filter. Never throws — always resolves to
 *  an AttemptResult so the retry loop can decide whether to try again. */
async function runDistillAttempt(
  userId: string,
  prompt: string,
  batch: UserMemoryRecord[],
  timeoutMs: number,
): Promise<AttemptResult> {
  const meta: AttemptMeta = {};
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
          { role: "user", content: prompt },
        ],
        tools: [EMIT_CANDIDATES_TOOL],
        tool_choice: { type: "function", function: { name: EMIT_CANDIDATES_TOOL.function.name } },
        temperature: 0.2,
      }),
      // maxRetries:0 → ONE fetch here; the curator's own attempt loop is the
      // single retry ladder (with the escalating timeout). Avoids nesting this
      // primitive's 4× retry inside our 3× loop (which would multiply the time
      // budget and make the per-retry escalation incoherent).
    }, { timeoutMs, label: `user-memory-curator:${userId}`, maxRetries: 0 });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(`[user-memory-curator] LiteLLM returned ${res.status} userId=${userId}: ${body.slice(0, 200)}`);
      // Retry 5xx AND 429 (rate-limit) at the curator level now that the inner
      // helper no longer retries them (maxRetries:0 above).
      return { ok: false, error: `llm-http-${res.status}`, retryable: res.status >= 500 || res.status === 429, meta };
    }

    const data = (await res.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
          tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    if (data.usage) {
      meta.usage = {};
      if (typeof data.usage.prompt_tokens === "number") meta.usage.promptTokens = data.usage.prompt_tokens;
      if (typeof data.usage.completion_tokens === "number") meta.usage.completionTokens = data.usage.completion_tokens;
    }

    const choice = data.choices?.[0];
    const message = choice?.message;

    // Debug context — captured whether or not we end up with a usable tool
    // call, so a failed distill is as inspectable as a successful one.
    if (choice?.finish_reason !== undefined) meta.finishReason = choice.finish_reason;
    if (typeof message?.content === "string" && message.content.trim()) meta.rawContent = message.content;
    const reasoningRaw = message?.reasoning_content ?? message?.reasoning;
    if (typeof reasoningRaw === "string" && reasoningRaw.trim()) meta.reasoning = reasoningRaw;

    const toolCall = message?.tool_calls?.[0]?.function;
    raw = toolCall?.arguments;
    if (raw) {
      meta.toolCallSource = "tool_calls";
      if (typeof toolCall?.name === "string") meta.toolCallName = toolCall.name;
    }

    // Some gateways/models (observed with glm-latest via LiteLLM) don't honor
    // the forced tool_choice and instead answer with the emit_user_candidates
    // JSON in message.content. Recover from content when it parses as our
    // payload so a cooperative-but-non-conforming model still yields candidates.
    if (!raw && typeof message?.content === "string" && message.content.trim()) {
      const recovered = extractToolArgsFromContent(message.content);
      if (recovered) {
        log.warn(
          `[user-memory-curator] recovered candidates from message.content (no tool_call) userId=${userId} model=${CURATOR_MODEL}`,
        );
        raw = recovered;
        meta.toolCallSource = "recovered-content";
        meta.toolCallName = EMIT_CANDIDATES_TOOL.function.name;
      }
    }

    if (!raw) {
      // Diagnostics: forced tool_choice produced no tool_call AND content
      // didn't parse as our payload. Capture what the model actually returned
      // so the pipeline viewer ("Raw LLM response") and logs show the cause
      // (e.g. finish_reason=length truncation, a refusal, or plain prose).
      const toolCallCount = message?.tool_calls?.length ?? 0;
      const content = typeof message?.content === "string" ? message.content : "";
      const diag =
        `no tool_call — finish_reason=${choice?.finish_reason ?? "unknown"} ` +
        `tool_calls=${toolCallCount} content_chars=${content.length}\n` +
        `content:\n${content.slice(0, 4_000)}`;
      log.warn(
        `[user-memory-curator] no tool_call in response userId=${userId} model=${CURATOR_MODEL} ` +
          `finish_reason=${choice?.finish_reason ?? "unknown"} tool_calls=${toolCallCount} content_chars=${content.length} ` +
          `content_preview=${JSON.stringify(content.slice(0, 300))}`,
      );
      return { ok: false, error: "no-tool-call", retryable: true, rawResponse: diag, meta };
    }
  } catch (err) {
    log.warn(`[user-memory-curator] LLM call failed userId=${userId}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true, meta };
  }

  let parsed: { candidates?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn(`[user-memory-curator] bad JSON from LLM userId=${userId}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: "bad-json", retryable: true, rawResponse: raw, meta };
  }

  if (!Array.isArray(parsed.candidates)) {
    log.warn(`[user-memory-curator] malformed candidates field userId=${userId}`);
    return { ok: false, error: "malformed-candidates", retryable: true, rawResponse: raw, meta };
  }

  const recordIds = new Set(batch.map((r) => r.id));
  /** Cited ids that match no record in this batch — kept for diagnostics, since
   *  "the model cited something" and "the model cited OUR ids" are very
   *  different failures and the logs could not previously tell them apart. */
  const unknownCitedIds = new Set<string>();
  const subsystemSet = new Set<UserMemorySubsystem>(USER_MEMORY_SUBSYSTEMS);
  const out: UserMemoryCandidatePayload[] = [];
  const emitted: UserMemoryCuratorEmittedCandidate[] = [];

  if (parsed.candidates.length > MAX_CANDIDATES_PER_BATCH) {
    log.warn(
      `[user-memory-curator] candidate output truncated ${parsed.candidates.length} → ${MAX_CANDIDATES_PER_BATCH} userId=${userId}`,
    );
  }
  for (const c of parsed.candidates.slice(0, MAX_CANDIDATES_PER_BATCH)) {
    // malformed = the entry isn't an object; we can't report its fields.
    if (!c || typeof c !== "object") {
      emitted.push({ text: "", verdict: "dropped", dropReason: "malformed" });
      continue;
    }
    const cand = c as Record<string, unknown>;
    const text = typeof cand["text"] === "string" ? (cand["text"] as string).trim() : "";
    const subsystem = cand["subsystem"];
    const signalScore = typeof cand["signalScore"] === "number" ? (cand["signalScore"] as number) : 0;
    const groundedOnIds = Array.isArray(cand["groundedOnIds"])
      ? (cand["groundedOnIds"] as unknown[]).filter((id): id is string => typeof id === "string")
      : [];

    const base: UserMemoryCuratorEmittedCandidate = {
      text,
      verdict: "dropped",
      ...(typeof subsystem === "string" ? { subsystem } : {}),
      signalScore,
      groundedOnIds,
    };

    if (!text) {
      emitted.push({ ...base, dropReason: "empty" });
      continue;
    }
    if (typeof subsystem !== "string" || !subsystemSet.has(subsystem as UserMemorySubsystem)) {
      emitted.push({ ...base, dropReason: "bad-subsystem" });
      continue;
    }
    if (signalScore < 0.7) {
      emitted.push({ ...base, dropReason: "low-signal" });
      continue;
    }
    const validIds = groundedOnIds.filter((id) => recordIds.has(id));
    if (validIds.length === 0) {
      for (const id of groundedOnIds) unknownCitedIds.add(id);
      emitted.push({ ...base, dropReason: "ungrounded" });
      continue;
    }

    const kept: UserMemoryCandidatePayload = {
      text,
      subsystem: subsystem as UserMemorySubsystem,
      signalScore: Math.min(1, Math.max(0, signalScore)),
      groundedOnIds: validIds,
    };
    out.push(kept);
    emitted.push({ ...base, verdict: "kept", groundedOnIds: validIds });
  }

  // Every candidate the model produced was otherwise valid but cited ids we do
  // not recognise. That is a CITATION failure, not "the batch had nothing worth
  // remembering" — and it used to look identical to the latter: ok:true with an
  // empty list, no retry, a whole batch of good candidates silently gone.
  // Surface it as retryable so the loop gets another attempt.
  const ungroundedCount = emitted.filter((e) => e.dropReason === "ungrounded").length;
  if (out.length === 0 && ungroundedCount > 0) {
    log.warn(
      `[user-memory-curator] all ${ungroundedCount} candidate(s) cited unknown record ids userId=${userId} ` +
        `cited=[${Array.from(unknownCitedIds).slice(0, 5).join(", ")}] ` +
        `expected=[${Array.from(recordIds).slice(0, 3).join(", ")}]`,
    );
    return {
      ok: false,
      error: "all-ungrounded",
      retryable: true,
      rawResponse: raw,
      meta,
      emitted,
      salvageable: out.length === 0 ? emitted.filter((e) => e.dropReason === "ungrounded") : [],
    };
  }

  return { ok: true, candidates: out, emitted, rawResponse: raw, meta };
}

/**
 * Run the user-memory curator on a batch of records. Returns the raw
 * candidate payloads (server-side attaches sourceRefs from the input ids
 * before persisting) plus a full observability trace of the LLM exchange
 * (prompt, raw response, per-candidate keep/drop verdicts, failure stage).
 *
 * Retries the LLM call on transient/output-quality failures up to
 * CURATOR_MAX_ATTEMPTS so a one-off malformed response no longer drops the
 * batch's records permanently.
 */
export async function distillUserMemory(
  userId: string,
  window: { from: string; to: string },
  records: UserMemoryRecord[],
  existingMemories: ExistingUserMemory[] = [],
): Promise<{ candidates: UserMemoryCandidatePayload[]; trace: UserMemoryCuratorTrace }> {
  // Empty batch — no LLM call, no prompt. Empty trace with no error stage.
  if (records.length === 0) {
    return {
      candidates: [],
      trace: { model: CURATOR_MODEL, durationMs: 0, prompt: "", promptChars: 0, emitted: [] },
    };
  }

  const startedAt = Date.now();
  if (!LITELLM_API_KEY) {
    log.warn("[user-memory-curator] LITELLM_API_KEY not set — skipping");
    return {
      candidates: [],
      trace: {
        model: CURATOR_MODEL,
        durationMs: Date.now() - startedAt,
        prompt: "",
        promptChars: 0,
        emitted: [],
        error: "no-api-key",
      },
    };
  }

  const batch = records.slice(0, MAX_RECORDS_PER_BATCH);
  if (records.length > MAX_RECORDS_PER_BATCH) {
    log.warn(`[user-memory-curator] batch truncated ${records.length} → ${MAX_RECORDS_PER_BATCH} records userId=${userId}`);
  }

  const prompt = buildUserPrompt(batch, window, existingMemories);
  const promptChars = prompt.length;

  const traceBase = (meta: AttemptMeta, attempts: number) => ({
    model: CURATOR_MODEL,
    durationMs: Date.now() - startedAt,
    systemPrompt: SYSTEM_PROMPT.slice(0, TRACE_TEXT_CAP),
    prompt: prompt.slice(0, TRACE_TEXT_CAP),
    promptChars,
    attempts,
    ...(meta.finishReason !== undefined ? { finishReason: meta.finishReason } : {}),
    ...(meta.reasoning ? { reasoning: meta.reasoning.slice(0, TRACE_TEXT_CAP) } : {}),
    ...(meta.rawContent ? { rawContent: meta.rawContent.slice(0, TRACE_TEXT_CAP) } : {}),
    ...(meta.toolCallName ? { toolCallName: meta.toolCallName } : {}),
    ...(meta.toolCallSource ? { toolCallSource: meta.toolCallSource } : {}),
    ...(meta.usage ? { usage: meta.usage } : {}),
  });

  let last: AttemptResult | null = null;
  let attempts = 0;
  for (let i = 1; i <= CURATOR_MAX_ATTEMPTS; i++) {
    attempts = i;
    // Escalate the per-call timeout on each retry (10m → 12m → 14m).
    const attemptTimeoutMs = CURATOR_TIMEOUT_MS + (i - 1) * CURATOR_TIMEOUT_STEP_MS;
    const result = await runDistillAttempt(userId, prompt, batch, attemptTimeoutMs);
    last = result;

    if (result.ok) {
      if (i > 1) {
        log.info(`[user-memory-curator] succeeded on attempt ${i}/${CURATOR_MAX_ATTEMPTS} userId=${userId}`);
      }
      return {
        candidates: result.candidates,
        trace: {
          ...traceBase(result.meta, attempts),
          rawResponse: result.rawResponse.slice(0, TRACE_TEXT_CAP),
          emitted: result.emitted,
        },
      };
    }

    if (!result.retryable || i === CURATOR_MAX_ATTEMPTS) break;
    log.warn(
      `[user-memory-curator] attempt ${i}/${CURATOR_MAX_ATTEMPTS} failed (${result.error}) — retrying userId=${userId}`,
    );
    // Small linear backoff so a transient gateway blip has time to clear.
    await new Promise((r) => setTimeout(r, 400 * i));
  }

  // Exhausted retries (or a permanent failure). Surface the last attempt's
  // context + the failing stage in the trace.
  const f = last as Extract<AttemptResult, { ok: false }>;

  // SALVAGE: the model kept producing good candidates but never cited ids we
  // recognise. Dropping the whole batch loses real memories over a citation
  // formatting problem, so fall back to BATCH-level provenance: ground each
  // candidate on every record in the batch. Coarser than per-record grounding
  // (the reason it is a last resort, not the default), but the candidate
  // demonstrably came from these records, and sourceRefs still resolve — which
  // is what downstream event-timestamp picking needs.
  if (f.error === "all-ungrounded" && f.salvageable?.length) {
    const batchIds = batch.map((r) => r.id);
    const salvaged: UserMemoryCandidatePayload[] = f.salvageable
      .filter((e) => e.text && typeof e.subsystem === "string")
      .map((e) => ({
        text: e.text,
        subsystem: e.subsystem as UserMemorySubsystem,
        signalScore: Math.min(1, Math.max(0, e.signalScore ?? 0)),
        groundedOnIds: batchIds,
      }));
    if (salvaged.length > 0) {
      log.warn(
        `[user-memory-curator] salvaged ${salvaged.length} candidate(s) with batch-level grounding ` +
          `after ${attempts} attempt(s) userId=${userId}`,
      );
      return {
        candidates: salvaged,
        trace: {
          ...traceBase(f.meta, attempts),
          ...(f.rawResponse !== undefined ? { rawResponse: f.rawResponse.slice(0, TRACE_TEXT_CAP) } : {}),
          emitted: (f.emitted ?? []).map((e) =>
            e.dropReason === "ungrounded"
              ? { ...e, verdict: "kept" as const, groundedOnIds: batchIds }
              : e,
          ),
          error: "all-ungrounded-salvaged",
        },
      };
    }
  }

  return {
    candidates: [],
    trace: {
      ...traceBase(f.meta, attempts),
      ...(f.rawResponse !== undefined ? { rawResponse: f.rawResponse.slice(0, TRACE_TEXT_CAP) } : {}),
      emitted: f.emitted ?? [],
      error: f.error,
    },
  };
}
