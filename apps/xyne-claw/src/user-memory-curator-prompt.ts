// Static LLM text + prompt assembly for the user-memory curator (user-memory-curator.ts owns the call + retry loop).
import { USER_MEMORY_SUBSYSTEMS, type ExistingUserMemory, type UserMemoryRecord } from "xyne-claw-shared";

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
export const MAX_CANDIDATES_PER_BATCH = 100;

export const EMIT_CANDIDATES_TOOL = {
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

export const SYSTEM_PROMPT = `You distill concrete, specific facts about a single user from their own Spaces activity — messages they posted, calls they hosted, canvases they authored, and (when present) reply records that pair an incoming message directed AT the user with how the user actually answered it.

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

export function buildUserPrompt(
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
