import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { logLLMCallStart } from '@/agents/agentLogger';
import { formatErrors, validate } from '@/services/entityExtraction/pipeline';

const TAG = '[RADAR-PARSER]';
const AGENT_NAME = 'RadarParser';

/** 429s are transient concurrency limits on the shared endpoint — back off, don't fail. */
const RATE_LIMIT_MAX_RETRIES = 6;
/** Schema-repair round-trips after the first response. */
const MAX_REPAIR_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 300_000;

/** Per-message text cap so one pasted log dump can't blow the prompt budget. */
const MAX_MESSAGE_TEXT_CHARS = 2000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface ParserWindowMessage {
  id: string;
  author: { id: string; name: string };
  text: string;
  /** Users explicitly @mentioned in this message — the only legal pending_on sources. */
  mentions: Array<{ id: string; name: string }>;
  timestamp_iso: string;
}

export interface ParserOpenItem {
  id: string;
  title: string;
  context: string | null;
  requested_by: string[];
  pending_on: string[];
}

export interface ParserOperation {
  op: 'create' | 'resolve' | 'reassign';
  sourceMessageId: string;
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

const SYSTEM_PROMPT = `You are the state-transition parser of Radar, an execution-tracking engine for workplace chat.

Radar tracks "execution items": concrete asks or commitments inside a thread. Each item has requested_by (who is waiting on it) and pending_on (who must act next — who "holds the ball"). An item is a ball being passed, not a task board entry.

You receive one thread's current state:
- open_items: the thread's currently open items.
- new_messages: messages that arrived since the last parse, in chronological order. Each lists its author and the users it explicitly @mentions.
- context_messages: the last few ALREADY-PROCESSED messages from just before new_messages, oldest first. Read them to understand what the thread is about, but they were handled in earlier passes: never cite one as a sourceMessageId, and never create an item for an ask that appears only there.
- known_users: id -> name for everyone involved so far (authors, mentions, item participants). Use it to match a name in prose to an id.

Decide which state transitions the new messages imply. Operations:

1. "create" — a new concrete ask or commitment that no open item already covers. title: short imperative summary of what must happen. contextSummary: one sentence of context. requestedBy: who is asking/waiting (usually the author). pendingOn: who must act.
   An ask includes a DIRECT QUESTION aimed at a specific person: asking someone for a status, an answer, a review, an update or a decision puts the ball with them until they respond. "@dev-bot what's the status of PR 25?" IS a trackable item (pendingOn: dev-bot, title: "Share the status of PR 25").
2. "resolve" — an open item is FULFILLED: the thing asked for was actually delivered (the information given, the work verifiably done), the requester confirmed or accepted the outcome, or the ask was explicitly withdrawn/cancelled. itemId: the open item's id.
3. "reassign" — the ball moved on an open item: it was explicitly handed to someone, someone claimed it, or the ball bounced back to the asker: a clarifying question, a dispute ("works for me", "cannot reproduce", "I don't think that's a bug"), or any reply the requester must now verify, confirm or answer before the item can close. itemId + new pendingOn (a bounce-back goes to requested_by).

A reply is not fulfillment. When the assignee responds without delivering what was asked — they push back, can't reproduce, disagree, answer partially, or hand back a question — the item stays OPEN and the ball moves to whoever must act next (usually the requester, via reassign). Only the requester's confirmation, an objectively delivered result, or an explicit withdrawal closes an item.

Assignment rules:
- pendingOn may contain user ids that appear anywhere in this input: a message's mentions list, a message author (e.g. claiming the work — "I'll take this"), or the requested_by / pending_on of an open item (the thread's history — someone already involved can be inferred as the assignee when the conversation clearly points at them).
- Answer in ids only — never invent an id for a name you cannot match to one given in this input.
- An actionable ask with no inferable assignee is still tracked: create it with pendingOn: [].
- Every operation cites sourceMessageId: the message in this window that caused it.
- Every operation includes reason: ONE short sentence explaining why this operation follows from the messages (e.g. why this person holds the ball, or what confirmed completion).

Be conservative about chatter: greetings, acknowledgements, thanks, FYIs and status updates someone volunteers produce NO operations — an empty operations array is the normal answer for such windows. A bare @mention with no request text is a HANDOFF, not noise: tagging someone under shared content (a report, a table, a log, an error) or into a thread puts that content in front of them — create an item pending on the mentioned user, titled from what the content or thread is about (e.g. "Review the tagging coverage report"). The ONLY exception is an explicit cc: when the message itself marks the mention as informational — "cc @x", "fyi @x", "looping in @x for visibility" — it is not an ask, create nothing. But do not confuse conservatism with dropping real asks: a request or question directed at a mentioned user is never chatter. Do not create an item for something an open item already covers; do not resolve on a vague "ok" unless it clearly confirms completion.

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
  ): Promise<ParsedTransitions> {
    // Same resolution as entity extraction (entityLlmClient.ts): radar's own
    // key when one is minted, otherwise the shared gateway key. A dedicated key
    // keeps radar's rate limit and spend off the quota other features use.
    const apiKey = config.radar.litellmApiKey || config.litellm.apiKey;
    const baseUrl = config.litellm.baseUrl;
    const keyName = config.radar.litellmApiKey
      ? 'RADAR_EXECUTION_LITELLM_API_KEY'
      : 'LITELLM_API_KEY';
    if (!apiKey || !baseUrl) {
      throw new Error('LiteLLM is not configured: set LITELLM_BASE_URL and an API key');
    }

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
