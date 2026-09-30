/**
 * Client for the streamed create-canvas draft (POST /claw/api/v1/agents/draft).
 *
 * One request drafts or edits the whole canvas and answers as server-sent
 * events, so the first field lands about a second after send instead of after
 * a full chat run, an XOR call and a separate prompt call. The wire contract
 * lives in packages/xyne-claw-shared/src/stream/agent-draft-events.ts; the
 * types below mirror the parts the canvas reads (the dashboard does not depend
 * on that package).
 *
 * Pure apart from `streamAgentDraft`, so node tests can load it.
 */
import { CLAW_API_BASE, ClawApiError } from '@/services/claw/clawRequest';
import type { AvailableTools, ToolSuggestion } from '@/services/claw/clawToolsTypes';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import type { KbCollectionNode } from '@/services/claw/clawKnowledgeBaseTypes';
import {
  buildBuiltinCatalog,
  disableEntry as disableBuiltinEntry,
  isEntryEnabled as isBuiltinEntryEnabled,
} from '@/routes/AIScreen/library/shared/pickers/builtin/builtinCatalog';
import {
  buildMcpCatalog,
  disableEntry as disableMcpEntry,
  isEntryEnabled as isMcpEntryEnabled,
} from '@/routes/AIScreen/library/shared/pickers/mcp/mcpCatalog';
import { scheduleLabel, type CreateSchedule } from './agentSchedule';
import {
  CUSTOM_PROPERTY_TYPES,
  createCustomProperty,
  type CustomProperty,
  type CustomPropertyType,
} from './customProperty';
import type {
  AgentCreateChatPatch,
  AgentCreateField,
  AgentCreateFormState,
  AgentCreateHubRow,
  AgentPermissionMode,
} from './types';

// ---------------------------------------------------------------------------
// Wire types (mirror of agent-draft-events.ts)
// ---------------------------------------------------------------------------

export type DraftField =
  | 'name'
  | 'handle'
  | 'description'
  | 'instructions'
  | 'tools'
  | 'skills'
  | 'knowledge'
  | 'permission'
  | 'schedule'
  | 'properties';

export type DraftHub = 'mcp' | 'builtin' | 'subagent' | 'skill' | 'knowledge';

export type DraftMode = 'chat' | 'ask' | 'draft' | 'edit';

export type DraftSchedule =
  | { kind: 'repeat'; cron: string; timezone: string; label: string; task: string }
  | { kind: 'once'; at: string; timezone: string; label: string; task: string };

export type DraftPropertyOp =
  | { op: 'set'; title: string; type: CustomPropertyType; value: string }
  | { op: 'remove'; title: string };

export interface DraftCapabilityRef {
  hub: DraftHub;
  id: string;
  label: string;
}

export interface AgentDraftRequest {
  draftId: string;
  turnId: string;
  message: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  canvas: {
    name: string;
    handle: string;
    description: string;
    instructions: string;
    permissionMode: AgentPermissionMode;
    schedule: DraftSchedule | null;
    capabilities: DraftCapabilityRef[];
    customProperties: Array<{ title: string; type: CustomPropertyType; value: string }>;
  };
  userOwned: DraftField[];
  timezone: string;
}

/** How much conversation goes back each turn (xyne-claw-shared DRAFT_HISTORY_*). */
export const DRAFT_HISTORY_TURNS = 12;
export const DRAFT_HISTORY_TURN_CHARS = 2_000;

/** A research step the Build chat took before answering ("Searching the web…"). */
export interface DraftActivity {
  id: string;
  kind: 'search';
  status: 'running' | 'done' | 'failed';
  label: string;
  detail?: string;
  sources?: Array<{ title: string; url: string }>;
}

/** A change the conversation points at; tapping it sends `message` as the next turn. */
export interface DraftSuggestion {
  id: string;
  label: string;
  message: string;
}

/** A follow-up question; a narrower form of the question card's UserQuestionItem. */
export interface DraftQuestion {
  id: string;
  /** One or two words: the question's chip ("Job", "Schedule"). */
  label: string;
  question: string;
  type: 'single_choice' | 'multiple_choice';
  options: Array<{ label: string; description?: string }>;
}

export type AgentDraftEvent =
  | { event: 'started' }
  | { event: 'mode'; mode: DraftMode; fields: DraftField[] }
  | {
      event: 'identity';
      name?: string;
      handle?: string;
      description?: string;
      handleAdjusted?: { requested: string; reason: 'taken' };
    }
  | { event: 'permission'; mode: AgentPermissionMode; reason: string }
  | ({ event: 'schedule'; op: 'set' } & DraftSchedule)
  | { event: 'schedule'; op: 'clear' }
  | { event: 'schedule'; op: 'invalid'; text: string; error: string }
  | { event: 'properties'; ops: DraftPropertyOp[] }
  | { event: 'field.start'; field: DraftField }
  | {
      event: 'plan';
      op: 'replace' | 'add';
      plan: ToolSuggestion;
      remove: Array<{ hub: DraftHub; id: string }>;
    }
  | { event: 'instructions.delta'; text: string }
  | { event: 'instructions.section'; heading: string; markdown: string }
  | { event: 'instructions.done'; text: string; contract: { ok: boolean; error?: string } }
  | { event: 'ack'; text: string }
  | { event: 'reply.delta'; text: string }
  | ({ event: 'activity' } & DraftActivity)
  | { event: 'suggestion'; suggestions: DraftSuggestion[] }
  | { event: 'question'; id: string; questions: DraftQuestion[] }
  | { event: 'warning'; stage: string; message: string }
  | { event: 'done'; status: 'completed' | 'partial' | 'cancelled' }
  | { event: 'error'; code: string; message: string; retryable: boolean };

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** Split a growing SSE buffer into complete events; comment frames are skipped. */
export function readDraftEvents(buffer: string): { events: AgentDraftEvent[]; rest: string } {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  const events: AgentDraftEvent[] = [];
  for (const frame of frames) {
    let name = '';
    const data: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!name || data.length === 0) continue;
    try {
      const body = JSON.parse(data.join('\n')) as Record<string, unknown>;
      events.push({ ...body, event: name } as AgentDraftEvent);
    } catch {
      // One bad frame should not lose the rest of the turn.
    }
  }
  return { events, rest };
}

/**
 * POST the turn and hand each event to `onEvent` as it arrives. Throws
 * `ClawApiError` when the request is refused before streaming starts (the
 * caller can fall back to the chat path); after that, problems arrive as
 * `error` events.
 */
export async function streamAgentDraft(
  request: AgentDraftRequest,
  onEvent: (event: AgentDraftEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Streaming needs the raw response body, which the axios services can't give.
  // eslint-disable-next-line local-rules/no-fetch-use-axios
  const res = await fetch(`${CLAW_API_BASE}/api/v1/agents/draft`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(request),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ClawApiError(res.status, body.error ?? `Draft failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = readDraftEvents(buffer);
    buffer = rest;
    for (const event of events) onEvent(event);
  }
}

// ---------------------------------------------------------------------------
// Canvas ⇄ draft mapping
// ---------------------------------------------------------------------------

/** Which canvas field (and hub row) a `field.start` points at, for the shimmer. */
export function canvasFieldFor(field: DraftField): {
  field: AgentCreateField;
  hubRow: AgentCreateHubRow | null;
} {
  switch (field) {
    case 'handle':
      return { field: 'slug', hubRow: null };
    case 'instructions':
      return { field: 'systemPrompt', hubRow: null };
    case 'tools':
      return { field: 'tools', hubRow: 'mcp' };
    case 'skills':
      return { field: 'skills', hubRow: 'skills' };
    case 'knowledge':
      return { field: 'knowledge', hubRow: 'knowledge' };
    case 'permission':
      return { field: 'permissionMode', hubRow: null };
    default:
      return { field, hubRow: null };
  }
}

/** Fields the user edited or is editing: the draft must leave them alone. */
export function userOwnedFields(
  dirty: Partial<Record<AgentCreateField, boolean>>,
  focused: AgentCreateField | null,
): DraftField[] {
  const owned = new Set<AgentCreateField>(
    (Object.keys(dirty) as AgentCreateField[]).filter(field => dirty[field]),
  );
  if (focused) owned.add(focused);
  const map: Partial<Record<AgentCreateField, DraftField>> = {
    name: 'name',
    slug: 'handle',
    description: 'description',
    systemPrompt: 'instructions',
    tools: 'tools',
    skills: 'skills',
    knowledge: 'knowledge',
    permissionMode: 'permission',
    schedule: 'schedule',
    properties: 'properties',
  };
  return [...owned].flatMap(field => (map[field] ? [map[field]] : []));
}

export function toDraftSchedule(schedule: CreateSchedule | null): DraftSchedule | null {
  if (!schedule) return null;
  const label = scheduleLabel(schedule);
  return schedule.kind === 'once'
    ? { kind: 'once', at: schedule.at, timezone: schedule.timezone, label, task: schedule.task }
    : {
        kind: 'repeat',
        cron: schedule.cron,
        timezone: schedule.timezone,
        label,
        task: schedule.task,
      };
}

export function fromDraftSchedule(schedule: DraftSchedule): CreateSchedule {
  return schedule.kind === 'once'
    ? { kind: 'once', at: schedule.at, timezone: schedule.timezone, task: schedule.task }
    : { kind: 'repeat', cron: schedule.cron, timezone: schedule.timezone, task: schedule.task };
}

/** Apply property ops by title (case-insensitive): set updates or appends, remove drops. */
export function applyPropertyOps(
  current: readonly CustomProperty[],
  ops: readonly DraftPropertyOp[],
): CustomProperty[] {
  let next = [...current];
  const key = (title: string): string => title.trim().toLowerCase();
  for (const op of ops) {
    if (op.op === 'remove') {
      next = next.filter(row => key(row.title) !== key(op.title));
      continue;
    }
    if (!CUSTOM_PROPERTY_TYPES.includes(op.type)) continue;
    const index = next.findIndex(row => key(row.title) === key(op.title));
    if (index >= 0) {
      const row = next[index];
      if (row) next[index] = { ...row, type: op.type, value: op.value };
    } else {
      next.push({ ...createCustomProperty(op.type), title: op.title, value: op.value });
    }
  }
  return next;
}

export interface DraftCatalogContext {
  catalog: AvailableTools | null;
  skills: Skill[];
  collections: KbCollectionNode[];
}

/** What is on the canvas, as refs the draft can name when it edits or removes. */
export function capabilityRefs(
  form: AgentCreateFormState,
  context: DraftCatalogContext | null,
): DraftCapabilityRef[] {
  const refs: DraftCapabilityRef[] = [];
  if (context?.catalog) {
    for (const entry of buildMcpCatalog(context.catalog, [])) {
      if (isMcpEntryEnabled(form.tools, entry)) {
        refs.push({ hub: 'mcp', id: entry.slug, label: entry.label });
      }
    }
    for (const entry of buildBuiltinCatalog(context.catalog)) {
      if (isBuiltinEntryEnabled(form.tools, entry)) {
        refs.push({ hub: 'builtin', id: entry.source, label: entry.label });
      }
    }
  }
  for (const name of form.tools.subagents) refs.push({ hub: 'subagent', id: name, label: name });
  for (const id of form.selectedSkillIds) {
    const skill = context?.skills.find(item => item.id === id);
    refs.push({ hub: 'skill', id, label: skill?.label || skill?.name || id });
  }
  for (const grant of form.selectedKbResources) {
    const collection = context?.collections.find(item => item.id === grant.collectionId);
    refs.push({
      hub: 'knowledge',
      id: grant.collectionId,
      label: collection?.name ?? grant.collectionId,
    });
  }
  return refs;
}

/** The canvas patch that removes what the draft asked to drop. */
export function removalPatch(
  form: AgentCreateFormState,
  removals: ReadonlyArray<{ hub: DraftHub; id: string }>,
  context: DraftCatalogContext | null,
): AgentCreateChatPatch {
  if (removals.length === 0) return {};
  let tools = form.tools;
  let skills = form.selectedSkillIds;
  let grants = form.selectedKbResources;
  const mcp = context?.catalog ? buildMcpCatalog(context.catalog, []) : [];
  const builtin = context?.catalog ? buildBuiltinCatalog(context.catalog) : [];
  for (const removal of removals) {
    if (removal.hub === 'mcp') {
      const entry = mcp.find(item => item.slug === removal.id);
      if (entry)
        tools = { ...disableMcpEntry(mcp, tools, entry), callableAgents: tools.callableAgents };
    } else if (removal.hub === 'builtin') {
      const entry = builtin.find(item => item.source === removal.id);
      if (entry)
        tools = { ...disableBuiltinEntry(tools, entry), callableAgents: tools.callableAgents };
    } else if (removal.hub === 'subagent') {
      tools = { ...tools, subagents: tools.subagents.filter(name => name !== removal.id) };
    } else if (removal.hub === 'skill') {
      skills = skills.filter(id => id !== removal.id);
    } else {
      grants = grants.filter(grant => grant.collectionId !== removal.id);
    }
  }
  const patch: AgentCreateChatPatch = {};
  if (tools !== form.tools) patch.tools = tools;
  if (skills !== form.selectedSkillIds) patch.selectedSkillIds = skills;
  if (grants !== form.selectedKbResources) patch.selectedKbResources = grants;
  return patch;
}

/**
 * The chat line for a turn that changed the canvas but sent no chat text. The
 * draft's only reply is its closing `ack`, and the model can leave it blank.
 */
export function silentTurnReply(mode: DraftMode | null, name: string): string {
  if (mode === 'draft') return name.trim() ? `Drafted ${name.trim()}.` : 'Drafted the agent.';
  return 'Updated the canvas.';
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Earlier titles for a section, so an old prompt's section is replaced, not duplicated. */
const SECTION_ALIASES: Record<string, readonly string[]> = { tools: ['When to use each tool'] };

/** Titles a late tools section goes in front of (xyne-claw's TOOLS_INSERT_BEFORE). */
export const TOOLS_INSERT_BEFORE: readonly string[] = ['Rules', 'Guardrails'];

/** A section title alone on its line: `Rules`, `Rules:` or `## Rules`. */
const titleLine = (titles: readonly string[]): string =>
  `(?:#{1,3}[ \\t]*)?(?:${titles.map(escapeRe).join('|')})[ \\t]*:?[ \\t]*(?=\\n|$)`;

/** Where a section ends: a blank line before the next title, a `## ` heading, or the end. */
const SECTION_END = '(?=\\n[ \\t]*\\n(?:#{1,3}[ \\t]*)?[^\\s\\d-][^\\n]{0,40}\\n|\\n#{1,3} |$)';

/**
 * Replace the section titled `heading` with `section` (title line included), or
 * add it: in front of the first `insertBefore` title the text has, else at the end.
 * Mirrors xyne-claw's replaceSection so the live text matches the final one.
 */
export function replaceSection(
  text: string,
  heading: string,
  section: string,
  insertBefore: readonly string[] = [],
): string {
  const titles = [heading, ...(SECTION_ALIASES[heading.toLowerCase()] ?? [])];
  const existing = new RegExp(`(^|\\n)${titleLine(titles)}[\\s\\S]*?${SECTION_END}`, 'i');
  if (existing.test(text))
    return text.replace(existing, (_match, lead: string) => `${lead}${section}`);
  if (insertBefore.length > 0) {
    const next = new RegExp(`(^|\\n)${titleLine(insertBefore)}`, 'i').exec(text);
    if (next) {
      const at = next.index + (next[1] ?? '').length;
      return `${text.slice(0, at)}${section}\n\n${text.slice(at)}`;
    }
  }
  return `${text.trimEnd()}\n\n${section}`;
}

/**
 * Markdown the writer slipped in anyway (heading marks, bold markers, star
 * bullets), and the blank line it likes to leave between a title and its list,
 * removed while the instructions stream so the plain-text box never flashes
 * `##` or `**`. xyne-claw cleans the final text the same way.
 */
export function plainInstructions(text: string): string {
  return text
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/__([^_\n]+?)__/g, '$1')
    .replace(/^([ \t]*)[*•][ \t]+/gm, '$1- ')
    .replace(/^([^\s\d-][^\n.!?]{0,40})\n[ \t]*\n(?=[ \t]*(?:-|\d+\.)[ \t])/gm, '$1\n');
}

// ---------------------------------------------------------------------------
// Chat follow-ups
// ---------------------------------------------------------------------------

/** The card's own "skip" answer. */
const SKIPPED = 'Skip this question';

/**
 * Question-card answers as the next Build message, one sentence per question:
 * "Job: Review pull requests. Schedule: Weekdays at 9am; release branches only."
 * A skipped question reads "you decide", so the draft picks a sensible default.
 */
export function serializeAnswers(
  questions: readonly DraftQuestion[],
  answers: Record<string, string | string[]>,
  notes: Record<string, string>,
): string {
  const sentences = questions.map(question => {
    const raw = answers[question.id];
    const chosen = (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .map(value => value.trim())
      .filter(Boolean);
    const note = notes[question.id]?.trim() ?? '';
    const skipped = chosen.includes(SKIPPED) && !note;
    const picked = chosen.filter(value => value !== SKIPPED).join(', ');
    const answer = skipped
      ? 'you decide'
      : [picked, note].filter(Boolean).join('; ') || 'you decide';
    return `${question.label}: ${answer.replace(/[.\s]+$/, '')}.`;
  });
  return sentences.join(' ').slice(0, 4_000);
}

/** A Build chat message as the history needs it. */
export interface DraftHistoryMessage {
  type: 'user' | 'bot';
  content: string;
  failed?: boolean;
  /** Questions the reply asked on a card, so the next turn knows they were asked. */
  asked?: readonly DraftQuestion[];
}

/** The last turns, oldest first, trimmed; a reply that showed a card says what it asked. */
export function buildDraftHistory(
  messages: readonly DraftHistoryMessage[],
): Array<{ role: 'user' | 'assistant'; text: string }> {
  return messages
    .filter(message => !message.failed && message.content.trim().length > 0)
    .slice(-DRAFT_HISTORY_TURNS)
    .map(message => {
      const asked = message.asked?.length
        ? ` (Asked: ${message.asked
            .map(q => `${q.label}: ${q.options.map(option => option.label).join(' / ')}`)
            .join('; ')})`
        : '';
      return {
        role: message.type === 'user' ? ('user' as const) : ('assistant' as const),
        text: `${message.content.trim()}${asked}`.slice(0, DRAFT_HISTORY_TURN_CHARS),
      };
    });
}

/** Questions safe to put on a card; anything malformed means the reply shows as text only. */
export function guardQuestions(raw: unknown): DraftQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is DraftQuestion => {
    if (!item || typeof item !== 'object') return false;
    const q = item as Record<string, unknown>;
    return (
      typeof q['id'] === 'string' &&
      typeof q['label'] === 'string' &&
      typeof q['question'] === 'string' &&
      (q['type'] === 'single_choice' || q['type'] === 'multiple_choice') &&
      Array.isArray(q['options']) &&
      q['options'].length >= 2 &&
      q['options'].every(
        option =>
          option &&
          typeof option === 'object' &&
          typeof (option as { label?: unknown }).label === 'string',
      )
    );
  });
}
