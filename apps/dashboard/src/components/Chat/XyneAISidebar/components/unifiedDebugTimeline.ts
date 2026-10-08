import type { DebugArtifactBundle, DebugEventRecord } from '../utils/XyneAITypes';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function eventKey(event: Record<string, unknown>): string {
  const kind = asString(event['kind']);
  const seq = event['seq'];
  if (typeof seq === 'number' || typeof seq === 'string') return `${kind}:${String(seq)}`;
  return [kind, asString(event['toolCallId']), asString(event['at'])].join(':');
}

function mergeEvents(persisted: unknown, live: DebugEventRecord[]): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  if (Array.isArray(persisted)) {
    for (const event of persisted) {
      if (isRecord(event)) merged.set(eventKey(event), event);
    }
  }
  for (const event of live)
    merged.set(
      eventKey(event as unknown as Record<string, unknown>),
      event as unknown as Record<string, unknown>,
    );
  return [...merged.values()].sort((left, right) => {
    const leftAt = Date.parse(asString(left['at']));
    const rightAt = Date.parse(asString(right['at']));
    if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) {
      return leftAt - rightAt;
    }
    const leftSeq = typeof left['seq'] === 'number' ? left['seq'] : Number.NaN;
    const rightSeq = typeof right['seq'] === 'number' ? right['seq'] : Number.NaN;
    return Number.isFinite(leftSeq) && Number.isFinite(rightSeq) ? leftSeq - rightSeq : 0;
  });
}

/**
 * Builds one canonical debugger model while a run is active. Live SSE events
 * enrich their matching persisted run instead of rendering as a second trace.
 */
export function mergeLiveDebugTimeline(
  bundle: DebugArtifactBundle | null,
  liveEvents: DebugEventRecord[],
  conversationId: string,
): DebugArtifactBundle | null {
  if (liveEvents.length === 0) return bundle;

  const sessionStart = liveEvents.find(event => event.kind === 'session_start');
  const sessionId = asString(sessionStart?.data['sessionId']);
  const rootLiveEvents = liveEvents.filter(event => !event.subagentName);
  const base: DebugArtifactBundle = bundle
    ? {
        ...bundle,
        runs: bundle.runs.map(run => ({ ...run, data: { ...run.data } })),
        subagents: bundle.subagents.map(subagent => ({
          ...subagent,
          data: { ...subagent.data },
        })),
      }
    : {
        conversationId,
        debugSession: null,
        debugEvents: null,
        runs: [],
        subagents: [],
      };

  const matchesSession = (data: Record<string, unknown>): boolean =>
    Boolean(sessionId) && asString(data['sessionId']) === sessionId;
  let matchedRoot = false;

  if (base.debugSession && matchesSession(base.debugSession)) {
    base.debugSession = {
      ...base.debugSession,
      events: mergeEvents(base.debugSession['events'], rootLiveEvents),
    };
    matchedRoot = true;
  }
  base.runs = base.runs.map(run => {
    if (!matchesSession(run.data)) return run;
    matchedRoot = true;
    return {
      ...run,
      data: { ...run.data, events: mergeEvents(run.data['events'], rootLiveEvents) },
    };
  });

  if (!matchedRoot) {
    const fallbackSession = base.debugSession;
    const canUseFallback = !sessionId && fallbackSession;
    base.debugSession = {
      ...(canUseFallback ? fallbackSession : {}),
      ...(sessionStart?.data ?? {}),
      ...(sessionId ? { sessionId } : {}),
      startedAt: sessionStart?.at ?? fallbackSession?.['startedAt'] ?? liveEvents[0]?.at,
      task:
        asString(sessionStart?.data['task']) || asString(fallbackSession?.['task']) || 'Live run',
      events: mergeEvents(canUseFallback ? fallbackSession?.['events'] : [], rootLiveEvents),
    };
  }

  const liveSubagents = new Map<string, DebugEventRecord[]>();
  for (const event of liveEvents) {
    if (!event.subagentName) continue;
    const key = `${event.parentToolCallId ?? 'unknown'}:${event.subagentName}`;
    const events = liveSubagents.get(key) ?? [];
    events.push(event);
    liveSubagents.set(key, events);
  }
  for (const [key, events] of liveSubagents) {
    const first = events[0];
    if (!first) continue;
    const existingIndex = base.subagents.findIndex(subagent => {
      const data = subagent.data;
      return (
        asString(data['parentSessionId']) === sessionId &&
        asString(data['parentToolCallId']) === (first.parentToolCallId ?? '') &&
        asString(data['subagentName']) === first.subagentName
      );
    });
    const existing = existingIndex >= 0 ? base.subagents[existingIndex] : undefined;
    const data = {
      ...(existing?.data ?? {}),
      parentSessionId: sessionId,
      parentToolCallId: first.parentToolCallId ?? '',
      subagentName: first.subagentName,
      task: asString(first.data['task']) || asString(first.data['question']) || 'Subagent task',
      events: mergeEvents(existing?.data['events'], events),
    };
    if (existingIndex >= 0) {
      base.subagents[existingIndex] = { ...existing!, data };
    } else {
      base.subagents.push({ fileName: `live-${sessionId || 'run'}-${key}.json`, data });
    }
  }

  return base;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Trace resolution layer
 *
 * claw's v2 writer no longer ships every payload inline on every event. Three
 * encodings sit between a raw event and something renderable, and each one
 * renders BLANK if the panel reads the field naively:
 *   1. blob refs        — the value moved to the run's blob log; a sibling
 *                         `<field>Ref` carries `{ hash, bytes, preview }`.
 *   2. back-references  — a value identical to an earlier event's carries
 *                         `<field>UnchangedFromSeq: <seq>` and nothing else.
 *   3. transcript cursor — turns carry `messagesTo` (a count) instead of a
 *                         copy of the messages, which was O(turns²) on the wire.
 * Everything the panel renders goes through the helpers below, so a payload
 * that was captured but not inlined always shows SOMETHING (its preview plus
 * what is missing) rather than an empty panel.
 * ──────────────────────────────────────────────────────────────────────────── */

/** A payload the v2 writer interned into the blob log instead of inlining. */
export type BlobRefLike = {
  hash: string;
  bytes?: number;
  originalBytes?: number;
  truncated?: boolean;
  preview?: string;
};

export function asBlobRef(value: unknown): BlobRefLike | null {
  if (!isRecord(value) || typeof value['hash'] !== 'string') return null;
  return value as BlobRefLike;
}

export type ResolvedField = {
  text: string;
  /** Bytes for a ref (what the writer stored), chars for an inline string. */
  size: number;
  truncated: boolean;
  isRef: boolean;
};

/**
 * Reads a payload field that may arrive inline OR as a blob ref — either in the
 * field itself or in its `<field>Ref` sibling, which is what survives when the
 * blob content could not be resolved. A ref renders its preview rather than an
 * empty panel, so "captured but not inlined" never looks like "nothing here".
 */
export function resolveFieldText(data: Record<string, unknown>, key: string): ResolvedField | null {
  const inline = data[key];
  if (typeof inline === 'string') {
    return inline ? { text: inline, size: inline.length, truncated: false, isRef: false } : null;
  }
  const ref = asBlobRef(inline) ?? asBlobRef(data[`${key}Ref`]);
  if (!ref) return null;
  const preview = typeof ref.preview === 'string' ? ref.preview : '';
  return {
    text: preview,
    size: typeof ref.bytes === 'number' ? ref.bytes : preview.length,
    truncated: ref.truncated === true || ref.originalBytes !== undefined || !preview,
    isRef: true,
  };
}

export function fieldSizeLabel(field: ResolvedField): string {
  return `${field.size} ${field.isRef ? 'bytes' : 'chars'}${field.truncated ? ' · truncated' : ''}`;
}

/**
 * What a ref-backed field is actually showing. On the LIVE channel a ref is
 * always just its ~200-char preview — the payload stays in claw's blob log
 * until the run finishes and the trace is materialized, and we deliberately
 * don't push a 28 KB system prompt over the wire every turn. Say that, instead
 * of letting a preview pass for the whole value.
 */
export function refNote(field: ResolvedField, live = false): string {
  const head = field.text ? 'preview' : 'not inlined';
  const tail = live ? ' · full content available when the run completes' : '';
  return `${head} · ${field.size} bytes${field.truncated ? ' · truncated' : ''}${tail}`;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Palette diffs arrive under two spellings: a `tool_palette_change` event names
 * them `added`/`removed`, while `paletteAdded`/`paletteRemoved` is what the
 * materializer folds off an `llm_request` onto its `session_prompt`. Read both
 * so a palette row renders its chips on either shape.
 */
export function paletteList(
  data: Record<string, unknown>,
  folded: 'paletteAdded' | 'paletteRemoved',
  own: 'added' | 'removed',
): string[] {
  const foldedList = stringList(data[folded]);
  return foldedList.length > 0 ? foldedList : stringList(data[own]);
}

export type SkillEntry = { name: string; description: string; location: string };

export function skillEntries(value: unknown): SkillEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (!isRecord(item)) return [];
    const name = asString(item['name']);
    return name
      ? [{ name, description: asString(item['description']), location: asString(item['location']) }]
      : [];
  });
}

export type ToolEntry = { name: string; description: string; parameters: unknown };

/** Full definitions when the trace has them, name-only rows when it only kept
 *  `toolNames` — a shorter list is still the truth about what was offered. */
export function toolEntries(data: Record<string, unknown>): ToolEntry[] {
  const tools = data['tools'];
  if (Array.isArray(tools)) {
    return tools.flatMap((item: unknown) => {
      if (!isRecord(item)) return [];
      const name = asString(item['name']);
      return name
        ? [{ name, description: asString(item['description']), parameters: item['parameters'] }]
        : [];
    });
  }
  return stringList(data['toolNames']).map(name => ({
    name,
    description: '',
    parameters: undefined,
  }));
}

/**
 * The messages a turn's panel should show. Newer traces carry only the cursor
 * (`messagesTo`) and expect the reader to slice the RUN's transcript; older ones
 * embedded the prefix per event. Accept both so a trace written before the
 * cursor change still renders.
 */
export function resolvePanelMessages(
  data: Record<string, unknown>,
  transcript: unknown[] | undefined,
): unknown[] | undefined {
  const embedded = data['messages'];
  if (Array.isArray(embedded)) return embedded as unknown[];
  const cursor = data['messagesTo'];
  if (!transcript || typeof cursor !== 'number') return undefined;
  return transcript.slice(0, Math.max(0, Math.min(cursor, transcript.length)));
}

export type TimelineEvent = Record<string, unknown> & { startedAt?: string };

/**
 * Kinds that never earn a timeline row: stream bookkeeping and transcript
 * deltas (`message_append`). `llm_request`/`llm_response` are not listed —
 * compactTimeline folds them onto their turn's `session_prompt` row instead.
 */
const HIDDEN_TIMELINE_KINDS = new Set(['message_update', 'stream_rate', 'message_append']);

/** Request fields the materializer lifts onto the turn's `session_prompt`;
 *  mirrored here (with their blob-ref spellings) for the live fold below. */
const FOLD_REQUEST_FIELDS = [
  'systemPrompt',
  'tools',
  'toolNames',
  'availableSkills',
  'temperature',
  'maxTokens',
  'thinkingLevel',
  'fastMode',
  'model',
  'provider',
  'paletteAdded',
  'paletteRemoved',
  'messagesFrom',
  'messagesTo',
] as const;

/** `llm_response` fields the materializer renames onto the prompt row — what
 *  the request-params strip reads for stop reason, cache hit/miss and TTFT. */
const FOLD_RESPONSE_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['usage', 'responseUsage'],
  ['stopReason', 'responseStopReason'],
  ['ttftMs', 'ttftMs'],
];

/**
 * Merge one `llm_request` / `llm_response` onto its turn's prompt row, the way
 * materialization does for a completed run. Ref spellings ride along: live
 * events carry `systemPromptRef` where a materialized one carries the inlined
 * `systemPrompt`, and the row renderer reads either.
 */
function foldLlmEvent(row: TimelineEvent, event: TimelineEvent): TimelineEvent {
  const eventData = isRecord(event['data']) ? event['data'] : {};
  const merged: Record<string, unknown> = { ...(isRecord(row['data']) ? row['data'] : {}) };
  if (asString(event['kind']) === 'llm_request') {
    for (const field of FOLD_REQUEST_FIELDS) {
      const refKey = `${field}Ref`;
      // The request's value REPLACES the prompt row's in EITHER spelling:
      // session_prompt carries only the persona prompt, which must not shadow
      // the true effective one just because it arrived inline and this didn't.
      if (eventData[field] !== undefined) {
        merged[field] = eventData[field];
        delete merged[refKey];
      } else if (eventData[refKey] !== undefined) {
        merged[refKey] = eventData[refKey];
        delete merged[field];
      }
    }
  } else {
    for (const [from, to] of FOLD_RESPONSE_FIELDS) {
      if (eventData[from] !== undefined) merged[to] = eventData[from];
    }
  }
  return { ...row, data: merged };
}

/**
 * Fields the materializer emits once per run and back-references thereafter
 * (`<field>UnchangedFromSeq`), because a 48-tool catalog and a 28 KB system
 * prompt are identical on every call and re-sending them per turn doubled the
 * bundle. Rehydrate here so every downstream renderer still sees a plain value.
 */
const DEDUPED_FOLD_FIELDS = ['systemPrompt', 'tools', 'toolNames', 'availableSkills'] as const;

function rehydrateRepeatedPayloads(events: unknown[]): unknown[] {
  const bySeq = new Map<number, Record<string, unknown>>();
  for (const value of events) {
    if (!isRecord(value) || typeof value['seq'] !== 'number') continue;
    if (isRecord(value['data'])) bySeq.set(value['seq'], value['data']);
  }
  let touched = false;
  const out = events.map(value => {
    if (!isRecord(value) || !isRecord(value['data'])) return value;
    const eventData = value['data'];
    let data: Record<string, unknown> | null = null;
    for (const field of DEDUPED_FOLD_FIELDS) {
      const from = eventData[`${field}UnchangedFromSeq`];
      if (typeof from !== 'number') continue;
      const source = bySeq.get(from)?.[field];
      if (source === undefined) continue;
      data ??= { ...eventData };
      data[field] = source;
    }
    if (!data) return value;
    touched = true;
    return { ...value, data };
  });
  return touched ? out : events;
}

/**
 * Collapse the raw event stream into the rows the timeline shows: back-refs
 * rehydrated, bookkeeping hidden, each turn's `llm_request`/`llm_response`
 * folded onto its `session_prompt`, and each tool's start/end/update folded
 * into one row.
 */
export function compactTimeline(rawEvents: unknown[]): TimelineEvent[] {
  const events = rehydrateRepeatedPayloads(rawEvents);
  const compacted: TimelineEvent[] = [];
  const pendingTools = new Map<string, number>();
  // Prompt row per LLM call, so this turn's `llm_request` / `llm_response` fold
  // onto it. Materialization does the same fold for a completed run; doing it
  // here too keeps the LIVE timeline from showing a duplicate LLM row every
  // turn, and gives the live prompt row the request's params.
  const promptRows = new Map<number, number>();
  // A call's prompt row and its request/response are produced by different
  // hooks, so the request can arrive first. Knowing up front which calls DO get
  // a prompt row lets us hold the fold instead of emitting a duplicate LLM row.
  const promptCalls = new Set<number>();
  for (const value of events) {
    if (
      isRecord(value) &&
      asString(value['kind']) === 'session_prompt' &&
      typeof value['llmCall'] === 'number'
    ) {
      promptCalls.add(value['llmCall']);
    }
  }
  const deferredFolds = new Map<number, TimelineEvent[]>();
  // Tool rows stay addressable after their end event lands, so a late
  // `tool_invocation_update` (background task finishing) folds into the same
  // row instead of appearing as an orphan event.
  const toolRows = new Map<string, number>();

  for (const value of events) {
    if (!isRecord(value) || HIDDEN_TIMELINE_KINDS.has(asString(value['kind']))) continue;
    const event = value as TimelineEvent;
    const kind = asString(event['kind']);
    const llmCall = typeof event['llmCall'] === 'number' ? event['llmCall'] : undefined;
    if (kind === 'session_prompt') {
      const rowIndex = compacted.length;
      compacted.push(event);
      if (llmCall === undefined || promptRows.has(llmCall)) continue;
      promptRows.set(llmCall, rowIndex);
      for (const held of deferredFolds.get(llmCall) ?? []) {
        compacted[rowIndex] = foldLlmEvent(compacted[rowIndex]!, held);
      }
      deferredFolds.delete(llmCall);
      continue;
    }
    if (kind === 'llm_request' || kind === 'llm_response') {
      const rowIndex = llmCall !== undefined ? promptRows.get(llmCall) : undefined;
      if (rowIndex !== undefined) {
        compacted[rowIndex] = foldLlmEvent(compacted[rowIndex]!, event);
        continue;
      }
      if (llmCall !== undefined && promptCalls.has(llmCall)) {
        deferredFolds.set(llmCall, [...(deferredFolds.get(llmCall) ?? []), event]);
        continue;
      }
      // No prompt row for this call (a compaction or follow-up call has none),
      // so the request stands on its own — same fallback as materialization.
      if (kind === 'llm_request') compacted.push(event);
      continue;
    }
    const toolCallId = asString(event['toolCallId']);
    if (kind === 'tool_invocation_update') {
      const updateId =
        toolCallId || (isRecord(event['data']) ? asString(event['data']['toolCallId']) : '');
      const rowIndex = toolRows.get(updateId);
      if (rowIndex === undefined) continue;
      const row = compacted[rowIndex]!;
      compacted[rowIndex] = {
        ...row,
        data: {
          ...(isRecord(row['data']) ? row['data'] : {}),
          ...(isRecord(event['data']) ? event['data'] : {}),
        },
      };
      continue;
    }
    if (kind === 'tool_execution_start' && toolCallId) {
      pendingTools.set(toolCallId, compacted.length);
      toolRows.set(toolCallId, compacted.length);
      compacted.push(event);
      continue;
    }
    if (kind === 'tool_execution_end' && toolCallId && pendingTools.has(toolCallId)) {
      const index = pendingTools.get(toolCallId)!;
      const start = compacted[index]!;
      compacted[index] = {
        ...event,
        startedAt: asString(start['at']),
        data: {
          ...(isRecord(start['data']) ? start['data'] : {}),
          ...(isRecord(event['data']) ? event['data'] : {}),
        },
      };
      pendingTools.delete(toolCallId);
      continue;
    }
    compacted.push(event);
  }

  return compacted;
}

/**
 * Non-fatal read problems for every run on screen. Runs share most warnings
 * (same blob log, same GCS miss), so dedupe — otherwise the notice turns into a
 * wall of the same line.
 */
export function collectDebugWarnings(bundle: DebugArtifactBundle | null): string[] {
  if (!bundle) return [];
  const sources: unknown[] = [
    bundle.warnings,
    bundle.debugSession?.['warnings'],
    ...(bundle.runs ?? []).map(run => run.data['warnings']),
    ...(bundle.subagents ?? []).map(sub => sub.data['warnings']),
  ];
  return [...new Set(sources.flatMap(source => stringList(source)))];
}
