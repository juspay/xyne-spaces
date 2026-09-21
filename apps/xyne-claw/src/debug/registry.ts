/**
 * Event registry — the single place that says what a debug event carries and
 * how big each field is allowed to get on disk.
 *
 * Adding an event is one entry here plus one `recorder.record()` call. The size
 * policy travels with the field declaration, so there is no second list to
 * remember (the old code had exactly that bug: a `leanEvents` strip in the
 * partial writer that the final writer didn't apply, which is how per-event
 * transcript embeds grew the file quadratically).
 *
 * Policies:
 *   plain()   — persisted as-is. Small scalars, counters, enums.
 *   ref(n)    — inline while the serialized value is ≤ n bytes, otherwise
 *               interned into blobs.jsonl and replaced by `<field>Ref`.
 *   ref()     — always interned.
 *   range()   — an index span into the transcript log, not a copy of it.
 *   drop()    — never persisted (re-derivable, or superseded).
 */

export type FieldPolicy =
  | { t: "plain" }
  | { t: "ref"; inlineUnder: number }
  | { t: "range" }
  | { t: "drop" };

export const plain = (): FieldPolicy => ({ t: "plain" });
export const ref = (inlineUnder = 0): FieldPolicy => ({ t: "ref", inlineUnder });
export const range = (): FieldPolicy => ({ t: "range" });
export const drop = (): FieldPolicy => ({ t: "drop" });

export interface EventSpec {
  fields: Record<string, FieldPolicy>;
  /** Policy for fields not named in `fields`. Defaults to `ref(4_000)`. */
  rest?: FieldPolicy;
  /** Never persisted — live channel only (high-frequency telemetry). */
  liveOnly?: true;
  /** Never pushed to the live channel — persisted only (bulk bookkeeping). */
  persistOnly?: true;
}

/** Identity helper; exists so the object literal keeps its literal key types. */
export function defineEvents<T extends Record<string, EventSpec>>(events: T): T {
  return events;
}

/**
 * Every kind the system emits.
 *
 * The 21 legacy kinds are preserved exactly — the dashboard, the debug HTML
 * exporter and DebugDrawer all switch on these strings, so removing one drops
 * rows silently rather than failing loudly.
 */
export const EVENTS = defineEvents({
  // ── Session lifecycle ────────────────────────────────────────────────────
  session_start: {
    fields: {
      conversationId: plain(),
      sessionId: plain(),
      agentSlug: plain(),
      userId: plain(),
      provider: plain(),
      model: plain(),
      thinking: plain(),
      speed: plain(),
      mode: plain(),
      systemPromptOverride: plain(),
      captureLevel: plain(),
      task: ref(4_000),
      context: ref(4_000),
    },
  },
  session_tools: {
    fields: { mode: plain(), toolCount: plain(), tools: ref(2_000) },
  },
  mode_switch: {
    fields: { from: plain(), to: plain(), reason: plain() },
  },
  session_end: {
    fields: {
      textLength: plain(),
      toolCount: plain(),
      tokenUsage: plain(),
      latency: plain(),
      durationMs: plain(),
      streamChars: plain(),
      streamCharsPerSec: plain(),
    },
  },
  session_cancelled: {
    fields: {
      reason: plain(),
      partialTextLength: plain(),
      toolCount: plain(),
      tokenUsage: plain(),
      atMs: plain(),
    },
  },
  session_error: {
    fields: { errorClass: plain(), atMs: plain(), error: ref(2_000) },
  },

  // ── Turn lifecycle ───────────────────────────────────────────────────────
  session_prompt: {
    fields: {
      kind: plain(),
      imagesCount: plain(),
      messageCount: plain(),
      turnIndex: plain(),
      timestamp: plain(),
      prompt: ref(2_000),
      // The persona prompt we hand to pi. The prompt actually sent to the model
      // — pi's assembled one, with <available_skills> appended — is captured by
      // llm_request instead, which is the whole point of the stream hook.
      systemPrompt: drop(),
      // Re-derivable from the transcript log; embedding it per turn is what made
      // the old traces O(turns^2).
      messages: drop(),
      messagesFrom: range(),
      messagesTo: range(),
    },
  },
  assistant_turn_end: {
    fields: {
      stopReason: plain(),
      errorMessage: plain(),
      streamChars: plain(),
      streamThinkingChars: plain(),
      streamTextChars: plain(),
      streamCharsPerSec: plain(),
      streamsCollected: plain(),
      usage: plain(),
      assistantText: ref(2_000),
      streamRateSamples: ref(1_000),
      message: drop(),
      messages: drop(),
      messagesFrom: range(),
      messagesTo: range(),
    },
  },
  thinking: {
    fields: { chars: plain(), text: ref(2_000) },
  },
  stream_rate: {
    fields: { streamsPerSec: plain(), streamsCollected: plain(), active: plain() },
    liveOnly: true,
  },

  // ── Tools ────────────────────────────────────────────────────────────────
  tool_execution_start: {
    fields: { toolName: plain(), args: ref(2_000) },
  },
  tool_execution_end: {
    fields: {
      toolName: plain(),
      isError: plain(),
      durationMs: plain(),
      status: plain(),
      background: plain(),
      backgroundState: plain(),
      backgroundTaskId: plain(),
      args: ref(2_000),
      // Cap is the 2 MB blob limit, NOT a second content cap: the string here is
      // exactly what the model saw, and re-truncating it would break MCP
      // `{"content":[...]}` envelopes that downstream parsers still read.
      result: ref(4_000),
      debug: ref(4_000),
      citations: ref(2_000),
    },
  },
  tool_invocation_update: {
    fields: {
      toolCallId: plain(),
      status: plain(),
      background: plain(),
      backgroundState: plain(),
      backgroundTaskId: plain(),
      durationMs: plain(),
      result: ref(4_000),
    },
  },
  tool_palette_change: {
    fields: {
      source: plain(),
      added: ref(2_000),
      removed: ref(2_000),
      activeCount: plain(),
      budget: plain(),
    },
  },

  // ── Model requests (new — the fix for the invisible system prompt) ───────
  llm_request: {
    fields: {
      model: plain(),
      provider: plain(),
      temperature: plain(),
      maxTokens: plain(),
      thinkingLevel: plain(),
      fastMode: plain(),
      toolCount: plain(),
      /** The TRUE effective system prompt, `<available_skills>` included. */
      systemPrompt: ref(),
      /** Full tool definitions: name, description, JSON schema. */
      tools: ref(),
      toolNames: ref(2_000),
      availableSkills: ref(2_000),
      paletteAdded: plain(),
      paletteRemoved: plain(),
      messagesFrom: range(),
      messagesTo: range(),
    },
  },
  llm_response: {
    fields: {
      stopReason: plain(),
      ttftMs: plain(),
      totalMs: plain(),
      errorMessage: plain(),
      usage: plain(),
    },
  },
  message_append: {
    fields: { from: plain(), to: plain(), count: plain(), messages: ref() },
    persistOnly: true,
  },

  // ── Recovery / control flow ─────────────────────────────────────────────
  compaction_start: {
    fields: { reason: plain(), tokensBefore: plain(), messageCount: plain() },
  },
  compaction_end: {
    fields: {
      reason: plain(),
      aborted: plain(),
      willRetry: plain(),
      errorMessage: plain(),
      tokensBefore: plain(),
      tokensAfter: plain(),
      messageCount: plain(),
      droppedMessageCount: plain(),
      summary: ref(2_000),
    },
  },
  auto_retry_start: {
    fields: { attempt: plain(), maxAttempts: plain(), errorMessage: plain(), reason: plain() },
  },
  auto_retry_end: {
    fields: { attempt: plain(), recovered: plain(), errorMessage: plain() },
  },
  provider_fallback: {
    fields: { fromProvider: plain(), toProvider: plain(), attempt: plain(), reason: plain() },
  },

  // ── Delegation ──────────────────────────────────────────────────────────
  subagent_start: {
    fields: {
      subagentName: plain(),
      childRunId: plain(),
      questionChars: plain(),
      provider: plain(),
      model: plain(),
      question: ref(2_000),
      toolNames: ref(2_000),
    },
  },
  subagent_end: {
    fields: {
      subagentName: plain(),
      childRunId: plain(),
      status: plain(),
      durationMs: plain(),
      textLength: plain(),
      providerError: plain(),
      toolsUsed: ref(2_000),
    },
  },
  background_subagents_delivered: {
    fields: { round: plain(), count: plain(), tasks: ref(2_000) },
  },
  delegation: {
    fields: {
      kind: plain(),
      caller: plain(),
      callee: plain(),
      depth: plain(),
      reason: plain(),
      detail: ref(2_000),
    },
  },

  // ── Skills ──────────────────────────────────────────────────────────────
  skill_loaded: {
    fields: { slug: plain(), path: plain(), viaToolCallId: plain() },
  },

  // ── Answer-quality reflections ──────────────────────────────────────────
  citation_reflection: {
    fields: {
      phase: plain(),
      round: plain(),
      maxRounds: plain(),
      outcome: plain(),
      initialCited: plain(),
      sourcesWereCiteable: plain(),
      finalCited: plain(),
    },
  },
  twin_deliver_reflection: {
    fields: { phase: plain(), round: plain(), delivered: plain(), action: plain() },
  },
  follow_up_generation_start: {
    fields: { model: plain(), sourceToolCallId: plain() },
  },
  follow_up_generation_end: {
    fields: {
      outcome: plain(),
      suggestionCount: plain(),
      durationMs: plain(),
      suggestions: ref(2_000),
    },
  },
});

export type DebugEventKind = keyof typeof EVENTS & string;

/** Kinds that existed before the v2 rewrite. Pinned by test — a rename here is
 *  a silent data loss for every consumer that switches on the string. */
export const LEGACY_EVENT_KINDS = [
  "session_start",
  "session_tools",
  "mode_switch",
  "session_prompt",
  "stream_rate",
  "thinking",
  "assistant_turn_end",
  "tool_execution_start",
  "tool_execution_end",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "citation_reflection",
  "twin_deliver_reflection",
  "follow_up_generation_start",
  "follow_up_generation_end",
  "background_subagents_delivered",
  "session_end",
  "session_cancelled",
  "session_error",
] as const;

/** Permissive fallback so an unregistered kind can never crash the recorder. */
const DEFAULT_SPEC: EventSpec = { fields: {}, rest: ref(4_000) };

export function isKnownKind(kind: string): kind is DebugEventKind {
  return Object.prototype.hasOwnProperty.call(EVENTS, kind);
}

export function specFor(kind: string): EventSpec {
  return isKnownKind(kind) ? EVENTS[kind] : DEFAULT_SPEC;
}

export function policyFor(spec: EventSpec, field: string): FieldPolicy {
  return spec.fields[field] ?? spec.rest ?? ref(4_000);
}
