/**
 * An assistant turn as ordered parts — thinking, text and tool calls in the
 * order the agent produced them: thinking → text → tools → thinking → … →
 * final answer. The same shape as Vercel AI SDK `UIMessage.parts` and
 * Anthropic content blocks.
 *
 * Streamed as deltas tagged with a `partId` and rendered as a step timeline.
 * Tool parts only reference their invocation by `toolCallId`: the invocation
 * itself (args, result, status) stays in the run's tool list.
 *
 * The dashboard's copy: it folds the stream it renders and groups the turn for
 * display. claw builds the parts (apps/xyne-claw/src/turn-parts.ts) and
 * claw-auth folds and stores them (apps/xyne-claw-auth/backend/src/lib/
 * chat-run-record.ts) with their own copies — change the shape or the fold in
 * all three together.
 */

export interface AssistantReasoningPart {
  type: 'reasoning';
  id: string;
  text: string;
  /** ISO time the thinking started / ended — "Thought for Ns". */
  startedAt?: string;
  endedAt?: string;
}

export interface AssistantTextPart {
  type: 'text';
  id: string;
  text: string;
  /** A draft the agent was asked to rewrite (e.g. to add citations): kept for
   *  the record, never shown, since its rewrite follows. */
  superseded?: true;
}

export interface AssistantToolPart {
  type: 'tool';
  /** The invocation's toolCallId. */
  id: string;
}

export type AssistantPart = AssistantReasoningPart | AssistantTextPart | AssistantToolPart;

export interface AssistantPartDelta {
  type: 'reasoning' | 'text';
  /** The block's id from claw (`<llm call>:<content index>`). Absent from an
   *  older server: a new part then starts whenever the type changes. */
  partId?: string | undefined;
  delta: string;
  /** ISO time of the delta, for thinking durations. */
  at?: string | undefined;
}

/** Thinking that is still open ends where the next part starts. */
function closeOpenReasoning(parts: AssistantPart[], at: string | undefined): AssistantPart[] {
  if (!at) return parts;
  const last = parts[parts.length - 1];
  if (last?.type !== 'reasoning' || last.endedAt) return parts;
  return [...parts.slice(0, -1), { ...last, endedAt: at }];
}

/** Append a streamed thinking/text delta. Returns a new array (the input is
 *  never mutated), so it can feed React state directly. */
export function applyPartDelta(parts: AssistantPart[], change: AssistantPartDelta): AssistantPart[] {
  if (!change.delta) return parts;
  const { type, partId, delta, at } = change;

  const index = partId
    ? parts.findIndex(part => part.id === partId && part.type === type)
    : parts.length - 1;
  const target = index >= 0 ? parts[index] : undefined;
  if (target && target.type === type) {
    const next = parts.slice();
    next[index] = { ...target, text: target.text + delta };
    return next;
  }

  const id = partId ?? `${type}-${parts.length}`;
  const created: AssistantPart =
    type === 'reasoning'
      ? { type, id, text: delta, ...(at ? { startedAt: at } : {}) }
      : { type, id, text: delta };
  return [...closeOpenReasoning(parts, at), created];
}

/** Record a tool call's place in the turn. Only top-level calls are parts; a
 *  subagent's calls nest under their parent through `parentToolCallId`. */
export function applyToolPart(
  parts: AssistantPart[],
  invocation: { toolCallId?: string | null; parentToolCallId?: string | null },
  at?: string,
): AssistantPart[] {
  const id = invocation.toolCallId;
  if (!id || invocation.parentToolCallId) return parts;
  if (parts.some(part => part.type === 'tool' && part.id === id)) return parts;
  return [...closeOpenReasoning(parts, at), { type: 'tool', id }];
}

/** End any thinking still open — at the end of the turn. */
export function closeAssistantParts(parts: AssistantPart[], at: string): AssistantPart[] {
  if (!parts.some(part => part.type === 'reasoning' && !part.endedAt)) return parts;
  return parts.map(part =>
    part.type === 'reasoning' && !part.endedAt ? { ...part, endedAt: at } : part,
  );
}

/** Parts for a message saved before parts existed: its thinking, its tool
 *  calls, then its answer — the order those messages always rendered in. */
export function legacyParts(message: {
  reasoning?: string | null | undefined;
  toolCallIds?: string[] | undefined;
  content?: string | null | undefined;
}): AssistantPart[] {
  const parts: AssistantPart[] = [];
  if (message.reasoning?.trim()) {
    parts.push({ type: 'reasoning', id: 'reasoning-0', text: message.reasoning });
  }
  for (const id of message.toolCallIds ?? []) parts.push({ type: 'tool', id });
  if (message.content) parts.push({ type: 'text', id: 'text-0', text: message.content });
  return parts;
}

export type TurnSegment =
  | { kind: 'text'; part: AssistantTextPart }
  | { kind: 'steps'; id: string; parts: Array<AssistantReasoningPart | AssistantToolPart> };

/**
 * The turn as the timeline shows it: each text block on its own, and each run
 * of thinking + tool calls between them as one collapsible group of steps.
 * Superseded drafts and blank text are left out.
 */
export function groupTurnParts(parts: AssistantPart[]): TurnSegment[] {
  const segments: TurnSegment[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      if (part.superseded || !part.text.trim()) continue;
      segments.push({ kind: 'text', part });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last?.kind === 'steps') last.parts.push(part);
    else segments.push({ kind: 'steps', id: `steps-${part.id}`, parts: [part] });
  }
  return segments;
}

const MAX_PARTS = 2000;

/** Keep only well-formed parts — for parts read back from storage or the
 *  wire. Returns null when there are none. */
export function normalizeAssistantParts(value: unknown): AssistantPart[] | null {
  if (!Array.isArray(value)) return null;
  const parts: AssistantPart[] = [];
  for (const raw of value.slice(0, MAX_PARTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const part = raw as Record<string, unknown>;
    const id = typeof part['id'] === 'string' ? part['id'] : null;
    if (!id) continue;
    const str = (key: string): string | undefined =>
      typeof part[key] === 'string' ? (part[key] as string) : undefined;
    if (part['type'] === 'tool') {
      parts.push({ type: 'tool', id });
    } else if (part['type'] === 'text' && typeof part['text'] === 'string') {
      parts.push({ type: 'text', id, text: part['text'], ...(part['superseded'] === true ? { superseded: true as const } : {}) });
    } else if (part['type'] === 'reasoning' && typeof part['text'] === 'string') {
      const startedAt = str('startedAt');
      const endedAt = str('endedAt');
      parts.push({
        type: 'reasoning',
        id,
        text: part['text'],
        ...(startedAt ? { startedAt } : {}),
        ...(endedAt ? { endedAt } : {}),
      });
    }
  }
  return parts.length > 0 ? parts : null;
}
