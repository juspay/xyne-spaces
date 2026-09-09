import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { logLLMCallStart } from '@/agents/agentLogger';
import { formatErrors, validate } from '@/services/entityExtraction/pipeline';

const TAG = '[RADAR-PARSER]';
const AGENT_NAME = 'RadarParser';

/** 429s are transient concurrency limits on the shared endpoint — back off, don't fail. */
const RATE_LIMIT_MAX_RETRIES = config.radar.rateLimitMaxRetries;
/** Schema-repair round-trips after the first response. */
const MAX_REPAIR_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = config.radar.parserTimeoutMs;

/** Per-message text cap so one pasted log dump can't blow the prompt budget. */
const MAX_MESSAGE_TEXT_CHARS = config.radar.maxMessageTextChars;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface ParserWindowMessage {
  id: string;
  author: { id: string; name: string };
  text: string;
  /** Users explicitly @mentioned in this message — the only legal pending_on sources. */
  mentions: Array<{ id: string; name: string }>;
  timestamp_iso: string;
  /**
   * Short per-window thread label (T1, T2 …), or null for a message posted
   * straight into the main flow. The window is a flat, time-ordered transcript
   * — in a DM it spans every conversation in the channel — so without this the
   * model cannot tell a reply from a message that merely follows it in time.
   */
  thread?: string | null;
  /** Whether this message opened its thread or replies within it. */
  thread_role?: 'root' | 'reply';
}

export interface ParserOpenItem {
  id: string;
  title: string;
  context: string | null;
  requested_by: string[];
  pending_on: string[];
  /** The message that raised this item. Sent on a reaction pass so the model
   *  can tell "the tick is ON the ask" from "the tick is on an answer" — it
   *  cannot infer that link, and without it a tick on the ask reads as a
   *  message that settles nothing. */
  source_message_id?: string;
  /** Thread this item was raised in, using the same labels as the messages.
   *  Set only when that thread also appears in this window, which is what lets
   *  a bare "approved" be matched to the item it belongs to rather than to the
   *  nearest open one. */
  thread?: string | null;
}

export interface ParserOperation {
  op: 'create' | 'resolve' | 'reassign' | 'dismiss';
  sourceMessageId: string;
  /** Handle a create declares so a resolve in the SAME response can cite it.
   *  Real ids are minted by the database, so this is the only way to say
   *  "the item I am creating here". */
  tempId?: string;
  title?: string;
  contextSummary?: string;
  requestedBy?: string[];
  pendingOn?: string[];
  itemId?: string;
  /** One-sentence model justification — surfaced in the debug trail. */
  reason?: string;
}

export interface ParsedTransitions {
  operations: ParserOperation[];
  /** The model's one-sentence read of the window — why these ops, or why none. */
  assessment?: string;
}

/**
 * Everything the model may return, structurally. Per-op required fields
 * (create needs title, resolve/reassign need itemId) are the validator box's
 * job — the pipeline validator can't express conditionals, and in dark mode
 * a structurally-loose op is still worth logging.
 */
const TRANSITIONS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['operations', 'assessment'],
  properties: {
    assessment: { type: 'string' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'sourceMessageId'],
        properties: {
          op: { enum: ['create', 'resolve', 'reassign'] },
          sourceMessageId: { type: 'string' },
          tempId: { type: 'string' },
          title: { type: 'string' },
          contextSummary: { type: 'string' },
          requestedBy: { type: 'array', items: { type: 'string' } },
          pendingOn: { type: 'array', items: { type: 'string' } },
          itemId: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

/**
 * What "resolve" means, in one place. The window parser and the reaction
 * matcher must agree on this or the same conversation settles differently
 * depending on whether someone typed "done" or clicked a tick.
 */
const RESOLVE_MEANING =
  'an open item is FULFILLED: the thing asked for was actually delivered (the ' +
  'information given, the work verifiably done), the requester confirmed or ' +
  'accepted the outcome, or the ask was explicitly withdrawn/cancelled';

const SYSTEM_PROMPT = `You are the state-transition parser of Radar, an execution-tracking engine for workplace chat.

Radar tracks "execution items": concrete asks or commitments inside a thread. Each item has requested_by (who is waiting on it) and pending_on (who must act next — who "holds the ball"). An item is a ball being passed, not a task board entry.

You receive one thread's current state:
- open_items: the thread's currently open items.
- new_messages: messages that arrived since the last parse, in chronological order. Each lists its author and the users it explicitly @mentions.
- context_messages: the last few ALREADY-PROCESSED messages from just before new_messages, oldest first. Read them to understand what the thread is about, but they were handled in earlier passes: never cite one as a sourceMessageId, and never create an item for an ask that appears only there.
- known_users: id -> name for everyone involved so far (authors, mentions, item participants). Use it to match a name in prose to an id.

THREADS. Messages and open items may carry a "thread" label (T1, T2 …). Messages sharing a label are replies within one thread; "thread_role" marks the one that opened it. A message with thread null was posted into the main flow, not into any thread. The transcript is ordered by TIME ALONE, so a reply can be separated from the rest of its thread by unrelated messages sent in between — two adjacent messages are not necessarily about the same thing. When a short message carries no subject of its own ("done", "approved", "not needed", "ok that works"), attach it to the open item and the messages sharing ITS thread label, never to whatever merely precedes it in time. An item carrying a thread label was raised in that thread. If such a message's thread has no matching open item and nothing in context explains it, produce NO operation and say so in the assessment — do not attach it to the nearest open item. The labels are internal bookkeeping and are rebuilt every parse, so NEVER name one in the assessment: identify a thread by what it is about ("the PR review thread", "the thread about the branch cut") or by its opening message, never as "T1".
- reaction: present ONLY on a reaction pass (see below). Absent on an ordinary window parse.

Decide which state transitions the new messages imply. Operations:

1. "create" — a new concrete ask or commitment that no open item already covers. title: short imperative summary of what must happen. contextSummary: one sentence of context. requestedBy: who is asking/waiting (usually the author). pendingOn: who must act.
   An ask includes a DIRECT QUESTION aimed at a specific person: asking someone for a status, an answer, a review, an update or a decision puts the ball with them until they respond. "@dev-bot what's the status of PR 25?" IS a trackable item (pendingOn: dev-bot, title: "Share the status of PR 25").
2. "resolve" — ${RESOLVE_MEANING}. itemId: the open item's id, OR a tempId declared by a create in this same response.
2b. When this window carries BOTH a new ask and the message that settles it, do not choose between them: emit the "create" with a tempId ("t1", "t2", …) and a "resolve" citing that same tempId. That is the ONLY way to close something raised in this same window — real ids come from the database and do not exist yet. Never invent an itemId that is neither in open_items nor a tempId you declared here, and never redirect a resolve onto a different open item because it looks similar: if what is being settled was raised in this window, the tempId is the answer.
3. "reassign" — the ball moved on an open item: it was explicitly handed to someone, someone claimed it, or the ball bounced back to the asker: a clarifying question, a dispute ("works for me", "cannot reproduce", "I don't think that's a bug"), or any reply the requester must now verify, confirm or answer before the item can close. itemId + new pendingOn (a bounce-back goes to requested_by).

A reply is not fulfillment. When the assignee responds without delivering what was asked — they push back, can't reproduce, disagree, answer partially, or hand back a question — the item stays OPEN and the ball moves to whoever must act next (usually the requester, via reassign). Only the requester's confirmation, an objectively delivered result, or an explicit withdrawal closes an item.

Assignment rules:
- pendingOn may contain user ids that appear anywhere in this input: a message's mentions list, a message author (e.g. claiming the work — "I'll take this"), or the requested_by / pending_on of an open item (the thread's history — someone already involved can be inferred as the assignee when the conversation clearly points at them).
- Answer in ids only — never invent an id for a name you cannot match to one given in this input.
- An actionable ask with no inferable assignee is still tracked: create it with pendingOn: [].
- Every operation cites sourceMessageId: the message in this window that caused it.
- Every operation includes reason: ONE short sentence explaining why this operation follows from the messages (e.g. why this person holds the ball, or what confirmed completion).

REACTION PASS. When "reaction" is present, someone put a reaction on the single message in new_messages, and open_items has already been narrowed to items that person is party to. A reaction carries no text: the emoji's NAME is the only signal of intent, and the emoji and the message decide together.

The only legal operation on a reaction pass is "resolve", and an empty operations array is the normal answer. Emit one only when BOTH hold:
  - the emoji asserts COMPLETION — a tick, a check mark, "done", "shipped", "fixed". An emoji meaning seen, received or in progress ("eyes", "on-it", "checking", "reviewing", a thumbs-up) is NOT completion; nor is a celebration, a joke or a heart. Beware negations: "not-done" is not a completion. When an emoji could plausibly mean either, treat it as acknowledgement and emit nothing.
  - the reacted message settles ONE specific open item, per the resolve rule above. An item whose source_message_id equals the reacted message's id was RAISED BY that message: a completion emoji there is not a comment on a delivery, it is the reactor asserting that item is now finished — resolve it.
Topical overlap is not settlement: a tick on a lunch plan settles nothing, even when the reactor holds open work in the thread. If two items fit equally well, emit nothing — a wrong close costs more than a missed one.

Be conservative about chatter: greetings, acknowledgements, thanks, FYIs and status updates someone volunteers produce NO operations — an empty operations array is the normal answer for such windows. A bare @mention with no request text is a HANDOFF, not noise: tagging someone under shared content (a report, a table, a log, an error) or into a thread puts that content in front of them — create an item pending on the mentioned user, titled from what the content or thread is about (e.g. "Review the tagging coverage report"). The ONLY exception is an explicit cc: when the message itself marks the mention as informational — "cc @x", "fyi @x", "looping in @x for visibility" — it is not an ask, create nothing. But do not confuse conservatism with dropping real asks: a request or question directed at a mentioned user is never chatter. Do not create an item for something an open item already covers — check open_items BEFORE every create, and treat a near-match as a match: the same work described in different words, a follow-up nudge on an ask already tracked ("any update on this?", "still waiting"), or a restatement with more detail is the SAME item, not a new one. Create a second item only when you are confident it is genuinely a different piece of work; when it could plausibly be either, say so in the assessment and create nothing; do not resolve on a vague "ok" unless it clearly confirms completion.

Besides operations, ALWAYS return assessment: ONE short sentence giving your overall read of this window — what the messages were and why you produced these operations. When operations is empty this matters most: say exactly why nothing is trackable (e.g. "bare mention used as a cc on a shared report — no ask directed at anyone").

Coverage is judged by WHAT is asked, not by who is asked or where. A tracked thread's follow-ups often add NEW asks: if "share the status of X" is already open and someone then asks "is this affecting Y too? can you confirm", that is a DIFFERENT ask — create a second item. One message can carry several distinct asks; create one item per distinct ask. A new ask whose target is not mentioned in this window still gets created, with pendingOn: [] — never drop a real ask because nobody was tagged.`;

interface LiteLLMResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * One LiteLLM /chat/completions call. Plain fetch, mirroring
 * services/messageClassification — single-shot, no tools.
 */
async function callLiteLLM(
  auth: { apiKey: string; baseUrl: string; keyName: string },
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const url = `${auth.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const supportsThinkingToggle = /glm/i.test(model);

  logLLMCallStart(AGENT_NAME, model, auth.keyName);

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        // State transitions want determinism, not variety.
        temperature: 0,
        ...(supportsThinkingToggle && { chat_template_kwargs: { enable_thinking: false } }),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
      const waitMs = Math.min(30_000, 1500 * 2 ** attempt) + Math.floor(Math.random() * 500);
      logger.warn(`${TAG} Rate limited, backing off`, { attempt: attempt + 1, waitMs, model });
      await response.body?.cancel();
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      throw new Error(`LiteLLM error: ${response.status} ${(await response.text()).slice(0, 500)}`);
    }
    const data = (await response.json()) as LiteLLMResponse;
    return data.choices?.[0]?.message?.content ?? '';
  }
}

/** Tolerates code fences, <think> traces and surrounding prose around the JSON. */
function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const attempt = (candidate: string) => {
    try {
      return { ok: true as const, value: JSON.parse(candidate) };
    } catch {
      return null;
    }
  };
  const direct = attempt(cleaned);
  if (direct) return direct;
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const sliced = attempt(cleaned.slice(start, end + 1));
    if (sliced) return sliced;
  }
  return { ok: false, error: cleaned.slice(0, 200) || '(empty response)' };
}

class RadarParser {
  /**
   * Same resolution as entity extraction (entityLlmClient.ts): radar's own key
   * when one is minted, otherwise the shared gateway key. A dedicated key keeps
   * radar's rate limit and spend off the quota other features use.
   */
  private resolveAuth(): { apiKey: string; baseUrl: string; keyName: string } {
    const apiKey = config.radar.litellmApiKey || config.litellm.apiKey;
    const baseUrl = config.litellm.baseUrl;
    const keyName = config.radar.litellmApiKey
      ? 'RADAR_EXECUTION_LITELLM_API_KEY'
      : 'LITELLM_API_KEY';
    if (!apiKey || !baseUrl) {
      throw new Error('LiteLLM is not configured: set LITELLM_BASE_URL and an API key');
    }
    return { apiKey, baseUrl, keyName };
  }

  /**
   * One parse call per drained window. Returns the model's proposed
   * transitions after schema validation with repair retries; throws when the
   * model can't produce schema-valid output (the caller treats a parser
   * failure as non-fatal in dark mode).
   */
  async parseWindow(
    openItems: ParserOpenItem[],
    newMessages: ParserWindowMessage[],
    knownUsers: Record<string, string> = {},
    contextMessages: ParserWindowMessage[] = [],
    reaction?: { by: string; emoji: string },
  ): Promise<ParsedTransitions> {
    const { apiKey, baseUrl, keyName } = this.resolveAuth();

    const model = config.radar.parserModel;
    if (!model) {
      throw new Error('No model configured: set RADAR_PARSER_MODEL');
    }

    const input = {
      open_items: openItems,
      new_messages: newMessages.map(m => ({
        ...m,
        text: m.text.slice(0, MAX_MESSAGE_TEXT_CHARS),
      })),
      context_messages: contextMessages.map(m => ({
        ...m,
        text: m.text.slice(0, MAX_MESSAGE_TEXT_CHARS),
      })),
      known_users: knownUsers,
      ...(reaction ? { reaction } : {}),
    };

    const messages = [
      {
        role: 'system',
        content:
          `${SYSTEM_PROMPT}\n\nRespond with JSON only — no prose, no code fences — ` +
          `matching this JSON Schema:\n${JSON.stringify(TRANSITIONS_SCHEMA)}`,
      },
      { role: 'user', content: JSON.stringify(input, null, 2) },
    ];

    let lastError = '';
    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
      const raw = await callLiteLLM({ apiKey, baseUrl, keyName }, model, messages);
      const parsed = tryParseJson(raw);

      if (!parsed.ok) {
        lastError = `Response was not valid JSON: ${parsed.error}`;
      } else {
        const errors = validate(parsed.value, TRANSITIONS_SCHEMA);
        if (errors.length === 0) return parsed.value as ParsedTransitions;
        lastError = formatErrors(errors);
      }

      logger.warn(`${TAG} response rejected, retrying`, {
        attempt: attempt + 1,
        error: lastError.slice(0, 300),
      });
      messages.push({ role: 'assistant', content: raw.slice(0, 4000) });
      messages.push({
        role: 'user',
        content:
          `That response did not match the required schema:\n${lastError}\n\n` +
          `Return only valid JSON matching the schema. No prose, no code fences.`,
      });
    }

    throw new Error(
      `Parser failed to produce schema-valid transitions after ${MAX_REPAIR_ATTEMPTS + 1} attempts. ` +
        `Last error: ${lastError}`,
    );
  }
}

export const radarParser = new RadarParser();
