import {
  classifyCreateTurn,
  firstDraftFields,
  namedCapabilityFields,
  parseLocalRename,
  shouldGeneratePrompt,
  type CreateTurnClassification,
  type CreateTurnField,
} from './classifyCreateTurn.ts';
import { buildDraftCanvasPatch, draftFromModelReply } from './canvasFromIdentity.ts';
import { progressLabelForField, PROGRESS_THINKING } from './createProgressLabel.ts';
import type { HubPlanField, HubPlanPatch, HubPlanResult } from './hubPlan.ts';
import type {
  AgentCreateChatPatch,
  AgentCreateField,
  AgentCreateHubRow,
  CreateHubSuggestions,
} from './types.ts';
import { slicePatch } from './mergeChatPatch.ts';

/** Beat between pointing at a section and writing into it: long enough to see the shimmer move. */
const ANTICIPATE_MS = 120;
/** A text reveal never takes longer than this, whatever the length (instructions). */
const REVEAL_LONG_MS = 900;
/** Name, handle and description: quick, but still visibly written in. */
const REVEAL_SHORT_MS = 260;
const REVEAL_SETTLE_MS = 60;
const REVEAL_MAX_STEPS = 48;
const SHORT_TEXT = 60;

/**
 * Where a reveal pauses: every few characters for short text, word ends for long
 * text, thinned to at most `maxSteps` evenly spaced cuts. The last cut is always
 * the full length.
 */
export function revealCutPoints(text: string, maxSteps = REVEAL_MAX_STEPS): number[] {
  if (!text) return [];
  const ends: number[] = [];
  if (text.length <= SHORT_TEXT) {
    const chunk = Math.max(1, Math.ceil(text.length / 14));
    for (let end = chunk; end < text.length; end += chunk) ends.push(end);
  } else {
    for (const match of text.matchAll(/\S+\s*/g)) ends.push(match.index + match[0].length);
  }
  if (ends[ends.length - 1] !== text.length) ends.push(text.length);
  if (ends.length <= maxSteps) return ends;
  const thinned = new Set<number>();
  for (let step = 1; step <= maxSteps; step++) {
    thinned.add(ends[Math.round((step * ends.length) / maxSteps) - 1] ?? text.length);
  }
  return [...thinned];
}

type SetWritingField = (field: AgentCreateField | null, hubRow?: AgentCreateHubRow | null) => void;
type SetAttentionField = (
  field: AgentCreateField | null,
  hubRow?: AgentCreateHubRow | null,
) => void;
type SetProgressLabel = (label: string | null) => void;

async function beginFieldAttention(args: {
  field: AgentCreateField;
  hubRow: AgentCreateHubRow | null;
  setAttentionField?: SetAttentionField | undefined;
  setProgressLabel?: SetProgressLabel | undefined;
  sleep: (ms: number) => Promise<void>;
}): Promise<void> {
  args.setAttentionField?.(args.field, args.hubRow);
  args.setProgressLabel?.(progressLabelForField(args.field, args.hubRow));
  await args.sleep(ANTICIPATE_MS);
}

async function revealTextField(args: {
  field: AgentCreateField;
  hubRow: AgentCreateHubRow | null;
  text: string;
  sourceId: string;
  writeMs: number;
  patchForText: (partial: string) => AgentCreateChatPatch;
  setWritingField: SetWritingField;
  setAttentionField?: SetAttentionField | undefined;
  setProgressLabel?: SetProgressLabel | undefined;
  applyChatPatch: (
    sourceId: string,
    patch: AgentCreateChatPatch,
    options: { highlight: boolean },
  ) => AgentCreateField[];
  sleep: (ms: number) => Promise<void>;
}): Promise<void> {
  const full = args.text;
  if (!full) {
    return;
  }
  await beginFieldAttention({
    field: args.field,
    hubRow: args.hubRow,
    setAttentionField: args.setAttentionField,
    setProgressLabel: args.setProgressLabel,
    sleep: args.sleep,
  });
  args.setWritingField(args.field, args.hubRow);
  await args.sleep(REVEAL_SETTLE_MS);
  // Time-boxed: a long prompt lands in under a second instead of being typed out.
  const cuts = revealCutPoints(full);
  const budgetMs = full.length > SHORT_TEXT * 2 ? REVEAL_LONG_MS : REVEAL_SHORT_MS;
  const stepMs = Math.max(16, Math.floor(budgetMs / Math.max(cuts.length, 1)));
  for (const end of cuts) {
    const partial = full.slice(0, end);
    args.applyChatPatch(
      `${args.sourceId}-${args.field}-${partial.length}`,
      args.patchForText(partial),
      {
        highlight: false,
      },
    );
    await args.sleep(stepMs);
  }
  await args.sleep(REVEAL_SETTLE_MS);
  args.setWritingField(null);
}

function pickPatch(
  patch: AgentCreateChatPatch,
  fields: readonly CreateTurnField[],
): AgentCreateChatPatch {
  const next: AgentCreateChatPatch = {};
  for (const field of fields) {
    Object.assign(next, slicePatch(patch, field));
  }
  return next;
}

export interface CreateCanvasSnapshot {
  empty: boolean;
  name: string;
  slug: string;
  description: string;
  instructions: string;
}

export interface ParsedCreateChatAction {
  visible: string;
  draftIntent: string | null;
  renameTo: string | null;
  idle: boolean;
  ask: boolean;
}

export type CreateCanvasAction =
  | { type: 'idle' }
  | { type: 'rename'; name: string }
  | {
      type: 'draft';
      intent: string;
      visibleReply: string;
      fields: CreateTurnField[];
    };

/** Hubs before instructions so the prompt can reference selected capabilities. */
export const CREATE_REVEAL_FIELD_ORDER: readonly CreateTurnField[] = [
  'name',
  'slug',
  'description',
  'tools',
  'skills',
  'knowledge',
  'systemPrompt',
];

export function incomingPatchForCreateDraft(args: {
  visibleReply: string;
  intent: string;
  generatedPrompt: string;
  fields: readonly CreateTurnField[];
  canvasEmpty: boolean;
}): AgentCreateChatPatch {
  const { visibleReply, intent, generatedPrompt, fields, canvasEmpty } = args;
  const draft = buildDraftCanvasPatch({
    visibleReply,
    intent,
    generatedPrompt,
    fillName: fields.includes('name'),
    fillSlug: fields.includes('slug'),
    fillDescription: fields.includes('description') && canvasEmpty,
    fillInstructions: fields.includes('systemPrompt'),
  });
  const incoming: AgentCreateChatPatch = {};
  if (draft.name) incoming.name = draft.name;
  if (draft.slug) incoming.slug = draft.slug;
  if (draft.description) incoming.description = draft.description;
  if (draft.systemPrompt) incoming.systemPrompt = draft.systemPrompt;
  return incoming;
}

export async function revealCreatePatchFields(args: {
  fields: readonly CreateTurnField[];
  incoming: AgentCreateChatPatch;
  sourceId: string;
  writeMs: number;
  toolsHubRow?: AgentCreateHubRow;
  setWritingField: SetWritingField;
  setAttentionField?: SetAttentionField | undefined;
  setProgressLabel?: SetProgressLabel | undefined;
  applyChatPatch: (
    sourceId: string,
    patch: AgentCreateChatPatch,
    options: { highlight: boolean },
  ) => AgentCreateField[];
  sleep: (ms: number) => Promise<void>;
  onFieldComplete?: (field: CreateTurnField, hubRow: AgentCreateHubRow | null) => void;
  /** Fires right after a hub slice lands on the canvas (before the settle pause). */
  onFieldApplied?: (field: CreateTurnField) => void;
}): Promise<void> {
  const patch = pickPatch(args.incoming, [...args.fields]);
  const reveal = CREATE_REVEAL_FIELD_ORDER.filter(field => args.fields.includes(field));
  for (const field of reveal) {
    const slice = slicePatch(patch, field);
    if (Object.keys(slice).length === 0) continue;
    const hubRow: AgentCreateHubRow | null =
      field === 'tools'
        ? (args.toolsHubRow ?? 'mcp')
        : field === 'skills'
          ? 'skills'
          : field === 'knowledge'
            ? 'knowledge'
            : null;

    const revealArgs: {
      sourceId: string;
      writeMs: number;
      setWritingField: SetWritingField;
      setAttentionField?: SetAttentionField | undefined;
      setProgressLabel?: SetProgressLabel | undefined;
      applyChatPatch: (
        sourceId: string,
        patch: AgentCreateChatPatch,
        options: { highlight: boolean },
      ) => AgentCreateField[];
      sleep: (ms: number) => Promise<void>;
    } = {
      sourceId: args.sourceId,
      writeMs: args.writeMs,
      setWritingField: args.setWritingField,
      applyChatPatch: args.applyChatPatch,
      sleep: args.sleep,
    };
    if (args.setAttentionField) revealArgs.setAttentionField = args.setAttentionField;
    if (args.setProgressLabel) revealArgs.setProgressLabel = args.setProgressLabel;

    if (field === 'name' && typeof slice.name === 'string') {
      await revealTextField({
        field,
        hubRow,
        text: slice.name,
        patchForText: partial => ({ name: partial }),
        ...revealArgs,
      });
      args.onFieldComplete?.(field, hubRow);
      continue;
    }
    if (field === 'slug' && typeof slice.slug === 'string') {
      await revealTextField({
        field,
        hubRow,
        text: slice.slug,
        patchForText: partial => ({ slug: partial }),
        ...revealArgs,
      });
      args.onFieldComplete?.(field, hubRow);
      continue;
    }
    if (field === 'description' && typeof slice.description === 'string') {
      await revealTextField({
        field,
        hubRow,
        text: slice.description,
        patchForText: partial => ({ description: partial }),
        ...revealArgs,
      });
      args.onFieldComplete?.(field, hubRow);
      continue;
    }
    if (field === 'systemPrompt' && typeof slice.systemPrompt === 'string') {
      await revealTextField({
        field,
        hubRow,
        text: slice.systemPrompt,
        patchForText: partial => ({ systemPrompt: partial }),
        ...revealArgs,
      });
      args.onFieldComplete?.(field, hubRow);
      continue;
    }

    await beginFieldAttention({
      field,
      hubRow,
      ...(args.setAttentionField ? { setAttentionField: args.setAttentionField } : {}),
      ...(args.setProgressLabel ? { setProgressLabel: args.setProgressLabel } : {}),
      sleep: args.sleep,
    });
    args.setWritingField(field, hubRow);
    await args.sleep(REVEAL_SETTLE_MS);
    const changed = args.applyChatPatch(`${args.sourceId}-${field}`, slice, { highlight: false });
    if (!changed.includes(field)) {
      args.setWritingField(null);
      continue;
    }
    args.onFieldApplied?.(field);
    await args.sleep(args.writeMs);
    args.setWritingField(null);
    args.onFieldComplete?.(field, hubRow);
  }
}

const DRAFT_RE = /^\s*XYNE_CREATE_DRAFT:\s*(.+?)\s*$/im;
const RENAME_RE = /^\s*XYNE_CREATE_RENAME:\s*(.+?)\s*$/im;
const IDLE_RE = /^\s*XYNE_CREATE_IDLE\b/im;
const ASK_RE = /^\s*XYNE_CREATE_ASK\b/im;
const PARTIAL_MARKER_TAIL = /\n?\s*XYNE_CREATE_[A-Z]*\s*:?\s*[^\n]*$/i;
const PARTIAL_DRAFT_MARKER = /\bXYNE_CREATE_DRAFT\b/i;

/**
 * Hub-adapted Xyne Agent authoring brain (from seed-xyne-agent AUTHORING_PROMPT_APPENDIX).
 * Tools stay disabled on Hub create — markers drive the canvas instead of propose-agent cards.
 */
export const HUB_AUTHORING_PROMPT_APPENDIX = `

# Agent authoring

You author agents the same way as Xyne Agent, but this screen uses canvas markers — not propose-agent cards.

When the user asks to create a new agent:
1. If the ask is vague ("make an agent", "create a bot") with no job named: ask what job it should do. Emit XYNE_CREATE_ASK. Do not draft. At most two questions per turn.
2. Once a job is named ("standup scribe for eng"): draft name, description, and a thin system prompt with Identity, numbered Operational Workflow, tool usage, Guardrails, decision rules, error recovery, and two contrastive examples. Prefer a procedure skill on the Skills row for long steps.
3. If the job can send, delete, pay, force-push, or post publicly: prefer drafting with ask-first permission. Only emit XYNE_CREATE_ASK alone when the risk choice is ambiguous and no draft can proceed. If the user already said draft/review/ask-first/approve, emit XYNE_CREATE_DRAFT (do not ask). Never skip hub binds for a risk question when the job is already named.
4. Emit XYNE_CREATE_DRAFT: <one-line intent> when drafting. Do not narrate "Drafted …" or paste Name/Description/Instructions into chat — the client writes the canvas.
5. Do not claim hubs (MCP, tools, skills, knowledge) were selected unless the client will bind them. Do not claim the agent exists until the user hits Create. Do not mention markers. "Just draft" / "you pick" skips questions once.
`;

function markerLineRe(): RegExp {
  return /^\s*XYNE_CREATE_(?:DRAFT|RENAME|IDLE|ASK)\s*(?::\s*.+)?\s*$/gim;
}

export function buildCreateModeInstructions(snapshot: CreateCanvasSnapshot): string {
  const canvas = snapshot.empty
    ? 'The canvas is empty (Untitled). Do not write to it unless you emit XYNE_CREATE_DRAFT.'
    : [
        'Canvas already has a draft:',
        snapshot.name.trim() ? `- name: ${snapshot.name.trim()}` : '- name: (empty)',
        snapshot.slug.trim() ? `- handle: @${snapshot.slug.trim()}` : '- handle: (empty)',
        snapshot.description.trim()
          ? `- description: ${snapshot.description.trim().slice(0, 180)}`
          : '- description: (empty)',
        snapshot.instructions.trim()
          ? `- instructions: ${snapshot.instructions.trim().slice(0, 280)}`
          : '- instructions: (empty)',
      ].join('\n');

  return `You are Xyne AI on the agent-create screen — the same Ask AI chat as /ai/chat, with Xyne Agent authoring judgment.
Left pane is this conversation. The canvas on the right is the agent spec (name, handle, description, instructions, MCP, tools, skills, knowledge). You do not write the canvas yourself; the client writes it only when you emit a draft marker.

${canvas}
${HUB_AUTHORING_PROMPT_APPENDIX}

Rules:
1. Greetings, UI questions, explanations, and nonsense (random characters, gibberish): reply in chat only. End with XYNE_CREATE_IDLE. Do not draft.
2. Vague create asks with no job ("make an agent", "create a bot"): ask "What job should it do?" Emit XYNE_CREATE_ASK. Do not draft. Later turns: at most two questions (who for, what it reads/writes, what it must never do).
3. A named job ("standup scribe for eng", "agent that posts Slack digests"): draft. Emit XYNE_CREATE_DRAFT: <one-line intent>. If the user already said draft/review/ask-first, do not emit XYNE_CREATE_ASK alone — draft with ask-first permission. Only ask a risk question when the send/write choice is still ambiguous.
4. First drafts fill name, handle, description, and instructions (Workflow + Guardrails required). The client binds Hub chips from the catalog — never claim MCP, subagent, skills, or knowledge are on the canvas; section lines after each write are the source of truth.
5. Canvas edits (rename, shorter instructions, add Slack): emit DRAFT or RENAME as appropriate.
   Rename-only: XYNE_CREATE_RENAME: <new name>
6. Never mention these markers to the user. Never claim the canvas is filled unless you emitted DRAFT or RENAME. "Just draft" skips intake.`;
}

export function createModeQuery(userText: string, snapshot: CreateCanvasSnapshot): string {
  return `${userText}\n\n---\n${buildCreateModeInstructions(snapshot)}`;
}

/** True when the model is (or will be) driving a canvas draft — hold chat ack until sections land. */
export function shouldHoldDraftChatAck(text: string): boolean {
  if (PARTIAL_DRAFT_MARKER.test(text)) return true;
  const marker = parseCreateChatAction(text);
  return Boolean(marker.draftIntent);
}

export function sectionCompleteChatLine(args: {
  field: CreateTurnField;
  hubRow?: AgentCreateHubRow | null;
  name?: string | null;
  /** Human labels of tools bound to the canvas — never invent email/X. Chips are SoT. */
  toolLabels?: readonly string[] | null;
  /** Tools offered as dashed chips (same `subagent:` / `builtin:` label scheme). */
  suggestedToolLabels?: readonly string[] | null;
  /** Skill display name when a skill chip was actually bound. */
  skillLabel?: string | null;
  /** Skill offered as a dashed chip. */
  suggestedSkillLabel?: string | null;
  /** Knowledge label when a KB chip was actually bound. */
  knowledgeLabel?: string | null;
  /** Knowledge offered as a dashed chip. */
  suggestedKnowledgeLabel?: string | null;
  /** When true, field was requested but catalog had no match — honest miss. */
  bindMiss?: boolean;
}): string | null {
  const {
    field,
    name = null,
    toolLabels = null,
    suggestedToolLabels = null,
    skillLabel = null,
    suggestedSkillLabel = null,
    knowledgeLabel = null,
    suggestedKnowledgeLabel = null,
    bindMiss = false,
  } = args;
  const joinLines = (...lines: Array<string | null>): string | null => {
    const kept = lines.filter((line): line is string => Boolean(line));
    return kept.length > 0 ? kept.join(' ') : null;
  };
  const added = (text: string | null | undefined): string | null =>
    text?.trim() ? `Added ${text.trim()}.` : null;
  const suggested = (text: string | null | undefined): string | null =>
    text?.trim() ? `Suggested (tap + to add): ${text.trim()}.` : null;
  if (field === 'name') {
    const trimmed = name?.trim();
    return trimmed ? `Name set to ${trimmed}.` : 'Name is on the canvas.';
  }
  if (field === 'systemPrompt') {
    return 'Instructions are on the canvas.';
  }
  if (field === 'tools') {
    const bound = describeToolLabels(toolLabels);
    const offered = describeToolLabels(suggestedToolLabels);
    if (!bound && !offered) {
      return bindMiss ? "Couldn't bind tools — no catalog match." : null;
    }
    return joinLines(added(bound), suggested(offered));
  }
  if (field === 'skills') {
    const bound = skillLabel?.trim() ? `skill: ${skillLabel.trim()}` : null;
    const offered = suggestedSkillLabel?.trim() ? `skill: ${suggestedSkillLabel.trim()}` : null;
    if (!bound && !offered) return bindMiss ? "Couldn't bind a skill — none available." : null;
    return joinLines(added(bound), suggested(offered));
  }
  if (field === 'knowledge') {
    const bound = knowledgeLabel?.trim() ? `knowledge: ${knowledgeLabel.trim()}` : null;
    const offered = suggestedKnowledgeLabel?.trim()
      ? `knowledge: ${suggestedKnowledgeLabel.trim()}`
      : null;
    if (!bound && !offered) {
      return bindMiss ? "Couldn't bind knowledge — no collections available." : null;
    }
    return joinLines(added(bound), suggested(offered));
  }
  return null;
}

/** "MCP: Slack; subagent: web-research; built-in: Web search" — null when empty. */
function describeToolLabels(raw: readonly string[] | null | undefined): string | null {
  const labels = (raw ?? []).map(label => label.trim()).filter(Boolean);
  if (labels.length === 0) return null;
  const subagent = labels
    .filter(label => label.startsWith('subagent:'))
    .map(label => label.slice('subagent:'.length));
  const builtin = labels
    .filter(label => label.startsWith('builtin:'))
    .map(label => label.slice('builtin:'.length));
  const mcp = labels.filter(
    label => !label.startsWith('subagent:') && !label.startsWith('builtin:'),
  );
  const parts: string[] = [];
  if (mcp.length > 0) parts.push(`MCP: ${mcp.join(', ')}`);
  if (subagent.length > 0) parts.push(`subagent: ${subagent.join(', ')}`);
  if (builtin.length > 0) parts.push(`built-in: ${builtin.join(', ')}`);
  return parts.length > 0 ? parts.join('; ') : null;
}

export function stripCreateMarkers(text: string, streaming = false): string {
  let next = text.replace(markerLineRe(), '');
  if (streaming) {
    next = next.replace(PARTIAL_MARKER_TAIL, '');
  }
  return next.replace(/\n{3,}/g, '\n\n');
}

export function parseCreateChatAction(text: string): ParsedCreateChatAction {
  const draftRaw = text.match(DRAFT_RE)?.[1]?.trim() ?? '';
  const renameRaw = text.match(RENAME_RE)?.[1]?.trim() ?? '';
  const draftIntent =
    draftRaw && !/^(none|idle|n\/a|-)$/i.test(draftRaw) ? draftRaw.slice(0, 500) : null;
  const renameTo =
    renameRaw && !/^(none|idle|n\/a|-)$/i.test(renameRaw) ? renameRaw.slice(0, 80) : null;
  const ask = ASK_RE.test(text) && !draftIntent && !renameTo;
  return {
    visible: stripCreateMarkers(text).trim(),
    draftIntent,
    renameTo,
    idle: (IDLE_RE.test(text) || ask) && !draftIntent && !renameTo,
    ask,
  };
}

export function visibleCreateReply(text: string, streaming: boolean): string {
  // Draft / rename: hold premature ack while streaming. After markers are cleared,
  // section-complete lines (appended by the client) are shown as normal chat text.
  if (shouldHoldDraftChatAck(text)) {
    if (streaming) return '';
    const stripped = stripCreateMarkers(text, false).trim();
    if (
      !stripped ||
      looksLikeCreateProfileDump(stripped) ||
      /^Drafted .+ on the canvas\.?$/i.test(stripped)
    ) {
      return '';
    }
    return stripped;
  }
  const stripped = stripCreateMarkers(text, streaming);
  const compacted = compactCreateDraftChatReply(stripped);
  return streaming ? compacted : compacted.trim();
}

/** True when the model pasted a Name/Description/Instructions/Rules profile wall into chat. */
export function looksLikeCreateProfileDump(text: string): boolean {
  const body = text.trim();
  if (!body) return false;
  const labelHits = [
    /(?:^|\n)\s*[-*•]?\s*\*?\*?Name\*?\*?\s*(?:\/\s*handle)?\s*:/i,
    /(?:^|\n)\s*[-*•]?\s*\*?\*?Description\*?\*?\s*:/i,
    /(?:^|\n)\s*[-*•]?\s*\*?\*?Instructions\*?\*?\s*:/i,
    /(?:^|\n)\s*[-*•]?\s*\*?\*?Rules\*?\*?\s*:/i,
    /\*\*[^*]+\*\*\s*\(@[a-z0-9][a-z0-9-]{0,62}\)/i,
  ].filter(re => re.test(body)).length;
  return labelHits >= 2;
}

export function briefCreateDraftAck(agentName?: string | null): string {
  const name = agentName?.trim();
  if (name) {
    return `Drafted ${name} on the canvas.`;
  }
  return 'Drafted the agent on the canvas.';
}

/**
 * Chat should only acknowledge drafts. Keep the raw reply for canvas parsing;
 * display uses this so profile fields are not duplicated as a markdown wall.
 */
export function compactCreateDraftChatReply(visible: string, agentName?: string | null): string {
  const text = visible.trim();
  if (!text || !looksLikeCreateProfileDump(text)) {
    return visible;
  }
  const stated = draftFromModelReply(text);
  return briefCreateDraftAck(agentName?.trim() || stated.name || null);
}

function fieldsForDraft(userText: string, canvasEmpty: boolean): CreateTurnField[] {
  if (canvasEmpty) {
    return firstDraftFields(userText);
  }
  const classification = classifyCreateTurn(userText, canvasEmpty);
  if (classification.kind === 'edit' && classification.fields.length > 0) {
    return classification.fields;
  }
  // Capability nouns → hub patches, never instructions-only.
  const caps = namedCapabilityFields(userText);
  if (caps.length > 0) return caps;
  return ['systemPrompt'];
}

/**
 * Canvas writes are gated here. The chat reply is always the streamed model.
 * The model chooses reply / ask / edit via markers. Classifier only maps
 * which fields to write — never whether to interview before drafting.
 */
const HUB_CAPABILITY_FIELDS = new Set<CreateTurnField>(['tools', 'skills', 'knowledge']);

function hubCapabilityFieldsFromEdit(
  classification: CreateTurnClassification,
): CreateTurnField[] | null {
  if (classification.kind !== 'edit' || classification.fields.length === 0) return null;
  if (!classification.fields.every(field => HUB_CAPABILITY_FIELDS.has(field))) return null;
  return classification.fields;
}

export function decideCreateCanvasAction(args: {
  userText: string;
  canvasEmpty: boolean;
  marker: ParsedCreateChatAction;
}): CreateCanvasAction {
  const { userText, canvasEmpty, marker } = args;
  const localRename = parseLocalRename(userText);
  const renameTo = marker.renameTo?.trim() || localRename;

  if (marker.draftIntent) {
    return {
      type: 'draft',
      intent: marker.draftIntent,
      visibleReply: marker.visible,
      fields: fieldsForDraft(userText, canvasEmpty),
    };
  }

  if (canvasEmpty && !marker.ask) {
    const stated = draftFromModelReply(marker.visible);
    const statedName = stated.name?.trim() ?? '';
    const statedSpec = Boolean(stated.description?.trim() || stated.systemPrompt?.trim());
    if (statedName && (statedSpec || (!marker.idle && /\bdraft\b/i.test(marker.visible)))) {
      return {
        type: 'draft',
        intent: userText.trim().slice(0, 500) || statedName,
        visibleReply: marker.visible,
        fields: fieldsForDraft(userText, canvasEmpty),
      };
    }
  }

  if (renameTo) {
    return { type: 'rename', name: renameTo };
  }

  if (marker.idle || marker.ask) {
    if (!canvasEmpty && marker.idle && !marker.ask) {
      const hubFields = hubCapabilityFieldsFromEdit(classifyCreateTurn(userText, canvasEmpty));
      if (hubFields) {
        return {
          type: 'draft',
          intent: userText.trim().slice(0, 500),
          visibleReply: marker.visible,
          fields: hubFields,
        };
      }
    }
    // Risk ask on a named empty-canvas job: still draft hubs (permission stays
    // ask-first). Pure vague asks without capability cues remain idle.
    if (marker.ask && canvasEmpty) {
      const fields = firstDraftFields(userText);
      if (fields.includes('tools') || fields.includes('skills') || fields.includes('knowledge')) {
        return {
          type: 'draft',
          intent: userText.trim().slice(0, 500),
          visibleReply: marker.visible,
          fields,
        };
      }
    }
    return { type: 'idle' };
  }

  const classification = classifyCreateTurn(userText, canvasEmpty);

  if (classification.kind !== 'edit') {
    return { type: 'idle' };
  }

  if (localRename) {
    return { type: 'rename', name: localRename };
  }

  if (!shouldGeneratePrompt(classification, canvasEmpty, userText)) {
    return { type: 'idle' };
  }

  // Empty-canvas first jobs require a draft marker so greetings and
  // gibberish cannot fill the spec. Follow-up edits on a filled canvas may.
  if (canvasEmpty) {
    return { type: 'idle' };
  }

  return {
    type: 'draft',
    intent: userText,
    visibleReply: marker.visible,
    fields: classification.fields,
  };
}

/**
 * How long past the identity prelude the hub plan may still take before the
 * regex binds go on the canvas and the late picks arrive as chips only.
 */
export const HUB_PLAN_SOFT_DEADLINE_MS = 1_200;

const HUB_FIELDS: readonly HubPlanField[] = ['tools', 'skills', 'knowledge'];

interface HubPlanOutcome {
  plan: HubPlanResult;
  resolved: HubPlanPatch;
}

const PLAN_PENDING = Symbol('hub-plan-pending');

function planPromptIntent(intent: string, summary: string): string {
  return summary
    ? `${intent}\n\nSelected capabilities:\n${summary}\nWrite operating instructions that use these tools when relevant.`
    : intent;
}

/** Hub canvas write: model draft identity first, then reveal fields with writingField held at caret. */
export async function applyCreateHubDraft(args: {
  action: Extract<CreateCanvasAction, { type: 'draft' }>;
  canvasEmpty: boolean;
  existingSystemPrompt: string;
  writeMs: number;
  sourceId: string;
  generateAgentPrompt: (intent: string, existingPrompt?: string) => Promise<string>;
  setWritingField: SetWritingField;
  setAttentionField?: SetAttentionField | undefined;
  setProgressLabel?: SetProgressLabel | undefined;
  applyChatPatch: (
    sourceId: string,
    patch: AgentCreateChatPatch,
    options: { highlight: boolean },
  ) => AgentCreateField[];
  sleep: (ms: number) => Promise<void>;
  /** Fallbacks: used when there is no hub plan or the plan is not an XOR one. */
  fillTools?: (incoming: AgentCreateChatPatch) => Promise<string[] | void>;
  fillSkills?: (incoming: AgentCreateChatPatch) => Promise<string | void>;
  fillKnowledge?: (incoming: AgentCreateChatPatch) => Promise<string | void>;
  /**
   * Started by the caller at the top of the turn so the ~1s call hides behind
   * the identity animation. Needs `resolveHubPlan` to take effect.
   */
  hubPlan?: Promise<HubPlanResult | null> | undefined;
  /** Resolves a plan against the catalog / skills / KB into a canvas patch. */
  resolveHubPlan?: ((plan: HubPlanResult) => Promise<HubPlanPatch | null>) | undefined;
  /** Regex-only tool binds, applied when the plan misses the soft deadline. */
  fillToolsLocal?: ((incoming: AgentCreateChatPatch) => Promise<string[] | void>) | undefined;
  /** Dashed chips for the given hubs (also called for a plan that lands late). */
  onHubSuggestions?:
    | ((suggestions: CreateHubSuggestions, hubs: readonly HubPlanField[]) => void)
    | undefined;
  /** Dev-only timing hook. */
  onPerfMark?: ((mark: 'tools-filled' | 'prompt-done') => void) | undefined;
  toolsHubRow?: AgentCreateHubRow;
  /** Chat announces after each section write settles (canvas-first). */
  onSectionComplete?: (line: string) => void;
}): Promise<void> {
  const { action, canvasEmpty } = args;
  let toolsHubRow = args.toolsHubRow ?? 'mcp';
  let fields: readonly CreateTurnField[] = action.fields;
  const generateInstructions = fields.includes('systemPrompt') || canvasEmpty;
  let toolLabels: string[] = [];
  let suggestedToolLabels: string[] = [];
  let skillLabel: string | null = null;
  let suggestedSkillLabel: string | null = null;
  let knowledgeLabel: string | null = null;
  let suggestedKnowledgeLabel: string | null = null;
  let toolsMiss = false;
  let skillsMiss = false;
  let knowledgeMiss = false;
  const preludeFields = CREATE_REVEAL_FIELD_ORDER.filter(
    field =>
      action.fields.includes(field) &&
      field !== 'systemPrompt' &&
      field !== 'tools' &&
      field !== 'skills' &&
      field !== 'knowledge',
  );
  // Closure-mutated state lives on an object so control-flow narrowing stays honest.
  const state: { prompt: Promise<string> | null; deadlinePassed: boolean } = {
    prompt: null,
    deadlinePassed: false,
  };
  const existingPrompt = args.existingSystemPrompt.trim() || undefined;
  const startPrompt = (promptIntent: string): Promise<string> =>
    Promise.resolve()
      .then(() => args.generateAgentPrompt(promptIntent, existingPrompt))
      // Keep drafting from chat-stated Instructions/Rules or an intent fallback.
      .catch(() => '')
      .then(text => {
        args.onPerfMark?.('prompt-done');
        return text;
      });

  // Resolve the plan into a patch the moment it lands (overlaps the identity
  // prelude) and start the instructions prompt from its richer summary.
  const { hubPlan, resolveHubPlan } = args;
  const planOutcome: Promise<HubPlanOutcome | null> =
    hubPlan && resolveHubPlan
      ? hubPlan
          .then(async (plan): Promise<HubPlanOutcome | null> => {
            if (!plan || plan.source !== 'xor') return null;
            const resolved = await resolveHubPlan(plan);
            return resolved ? { plan, resolved } : null;
          })
          .catch(() => null)
          .then(outcome => {
            if (outcome && !state.deadlinePassed && generateInstructions) {
              state.prompt = startPrompt(planPromptIntent(action.intent, outcome.resolved.summary));
            }
            return outcome;
          })
      : Promise.resolve(null);

  args.setProgressLabel?.(PROGRESS_THINKING);

  if (preludeFields.length > 0) {
    const preludePatch = incomingPatchForCreateDraft({
      visibleReply: action.visibleReply,
      intent: action.intent,
      generatedPrompt: '',
      fields: preludeFields,
      canvasEmpty,
    });
    const revealArgs: Parameters<typeof revealCreatePatchFields>[0] = {
      incoming: preludePatch,
      sourceId: args.sourceId,
      writeMs: args.writeMs,
      toolsHubRow,
      setWritingField: args.setWritingField,
      applyChatPatch: args.applyChatPatch,
      sleep: args.sleep,
      fields: [],
    };
    if (args.setAttentionField) revealArgs.setAttentionField = args.setAttentionField;
    if (args.setProgressLabel) revealArgs.setProgressLabel = args.setProgressLabel;
    const announceField = (field: CreateTurnField, hubRow: AgentCreateHubRow | null): void => {
      if (field !== 'name') return;
      const line = sectionCompleteChatLine({
        field,
        hubRow,
        name: typeof preludePatch.name === 'string' ? preludePatch.name : null,
      });
      if (line) args.onSectionComplete?.(line);
    };
    if (args.onSectionComplete) revealArgs.onFieldComplete = announceField;
    if (preludeFields.includes('name')) {
      await revealCreatePatchFields({
        ...revealArgs,
        fields: ['name'],
      });
    }
    const restPrelude = preludeFields.filter(field => field !== 'name');
    if (restPrelude.length > 0) {
      await revealCreatePatchFields({
        ...revealArgs,
        fields: restPrelude,
      });
    }
  }

  const incoming: AgentCreateChatPatch = {};
  const beginHubFill = async (
    field: 'tools' | 'skills' | 'knowledge',
    row: AgentCreateHubRow,
  ): Promise<void> => {
    await beginFieldAttention({
      field,
      hubRow: row,
      ...(args.setAttentionField ? { setAttentionField: args.setAttentionField } : {}),
      ...(args.setProgressLabel ? { setProgressLabel: args.setProgressLabel } : {}),
      sleep: args.sleep,
    });
    args.setWritingField(field, row);
    await args.sleep(REVEAL_SETTLE_MS);
  };
  // Hubs whose chips the plan may decide; edits only touch what the user asked for.
  const suggestionHubs = (): HubPlanField[] =>
    canvasEmpty ? [...HUB_FIELDS] : HUB_FIELDS.filter(field => action.fields.includes(field));

  // Hubs first (channel/DM order): bind real catalog ids before instructions.
  let planned: HubPlanOutcome | null = null;
  let localBindsOnly = false;
  if (hubPlan && resolveHubPlan) {
    const settled = await Promise.race([
      planOutcome,
      args.sleep(HUB_PLAN_SOFT_DEADLINE_MS).then((): typeof PLAN_PENDING => PLAN_PENDING),
    ]);
    if (settled === PLAN_PENDING) {
      // Too slow: regex binds now, whatever the plan finds later becomes chips only.
      state.deadlinePassed = true;
      localBindsOnly = true;
      void planOutcome.then(outcome => {
        if (outcome) args.onHubSuggestions?.(outcome.resolved.allSuggestions, suggestionHubs());
      });
    } else {
      planned = settled;
    }
  }

  if (planned) {
    // The plan already decided every hub: no fill stage, straight to the reveal.
    const { resolved } = planned;
    Object.assign(incoming, resolved.patch);
    if (canvasEmpty) {
      // First draft: a hub the regexes missed still gets filled when the plan has picks.
      const current = fields;
      fields = [...current, ...resolved.fields.filter(field => !current.includes(field))];
    }
    toolsHubRow = resolved.preferredHubRow;
    toolLabels = resolved.labels;
    suggestedToolLabels = resolved.suggestedLabels;
    skillLabel = resolved.skillLabels.join(', ') || null;
    suggestedSkillLabel = resolved.suggestedSkillLabels.join(', ') || null;
    knowledgeLabel = resolved.knowledgeLabels.join(', ') || null;
    suggestedKnowledgeLabel = resolved.suggestedKnowledgeLabels.join(', ') || null;
  } else {
    const fillTools = localBindsOnly ? args.fillToolsLocal : args.fillTools;
    if (fields.includes('tools') && fillTools) {
      await beginHubFill('tools', toolsHubRow);
      const labels = await fillTools(incoming);
      if (Array.isArray(labels)) {
        toolLabels = labels.map(label => label.trim()).filter(Boolean);
      }
      toolsMiss = toolLabels.length === 0;
      // Point attention at a row that actually received chips.
      if (toolLabels.some(label => label.startsWith('subagent:'))) toolsHubRow = 'subagent';
      else if (toolLabels.some(label => label.startsWith('builtin:'))) toolsHubRow = 'builtin';
      else if (toolLabels.length > 0) toolsHubRow = 'mcp';
    }

    if (!localBindsOnly && fields.includes('skills') && args.fillSkills) {
      await beginHubFill('skills', 'skills');
      const bound = await args.fillSkills(incoming);
      skillLabel = typeof bound === 'string' && bound.trim() ? bound.trim() : null;
      skillsMiss = !skillLabel;
    }

    if (!localBindsOnly && fields.includes('knowledge') && args.fillKnowledge) {
      await beginHubFill('knowledge', 'knowledge');
      const bound = await args.fillKnowledge(incoming);
      knowledgeLabel = typeof bound === 'string' && bound.trim() ? bound.trim() : null;
      knowledgeMiss = !knowledgeLabel;
    }

    // Start the prompt now so it overlaps the hub reveal instead of following it.
    if (generateInstructions && !state.prompt) {
      const selectedSummary = summarizeSelectedCapabilities(incoming);
      state.prompt = startPrompt(
        selectedSummary
          ? `${action.intent}\n\nSelected capabilities: ${selectedSummary}. Write operating instructions that use these tools when relevant.`
          : action.intent,
      );
    }
  }

  // --- Reveal hub chips -------------------------------------------------------
  let toolsMarked = false;
  const markToolsFilled = (): void => {
    if (toolsMarked) return;
    toolsMarked = true;
    args.onPerfMark?.('tools-filled');
  };
  const announced = new Set<CreateTurnField>();
  const hubLine = (field: CreateTurnField, hubRow: AgentCreateHubRow | null): string | null =>
    sectionCompleteChatLine({
      field,
      hubRow,
      toolLabels,
      suggestedToolLabels,
      skillLabel,
      suggestedSkillLabel,
      knowledgeLabel,
      suggestedKnowledgeLabel,
    });
  const hubTailFields = CREATE_REVEAL_FIELD_ORDER.filter(
    field => fields.includes(field) && (HUB_FIELDS as readonly CreateTurnField[]).includes(field),
  );
  const hubTailArgs: Parameters<typeof revealCreatePatchFields>[0] = {
    fields: hubTailFields,
    incoming,
    sourceId: args.sourceId,
    writeMs: args.writeMs,
    toolsHubRow,
    setWritingField: args.setWritingField,
    applyChatPatch: args.applyChatPatch,
    sleep: args.sleep,
    onFieldApplied: field => {
      if (field === 'tools') markToolsFilled();
    },
  };
  if (args.setAttentionField) hubTailArgs.setAttentionField = args.setAttentionField;
  if (args.setProgressLabel) hubTailArgs.setProgressLabel = args.setProgressLabel;
  if (args.onSectionComplete) {
    hubTailArgs.onFieldComplete = (field, hubRow): void => {
      if (field !== 'tools' && field !== 'skills' && field !== 'knowledge') return;
      announced.add(field);
      const line = hubLine(field, hubRow);
      if (line) args.onSectionComplete?.(line);
    };
  }
  await revealCreatePatchFields(hubTailArgs);

  if (planned) {
    args.onHubSuggestions?.(planned.resolved.suggestions, suggestionHubs());
    // Hubs with only suggested chips have no canvas write to announce; say so in chat.
    for (const field of hubTailFields) {
      if (announced.has(field)) continue;
      const line = hubLine(field, null);
      if (line) args.onSectionComplete?.(line);
    }
  }
  markToolsFilled();

  // --- Instructions -----------------------------------------------------------
  if (generateInstructions) {
    args.setAttentionField?.('systemPrompt', null);
    args.setProgressLabel?.(progressLabelForField('systemPrompt'));
    const generatedPrompt = state.prompt ? await state.prompt : '';
    Object.assign(
      incoming,
      incomingPatchForCreateDraft({
        visibleReply: action.visibleReply,
        intent: action.intent,
        generatedPrompt,
        fields: action.fields,
        canvasEmpty,
      }),
    );
  }

  const instructionArgs: Parameters<typeof revealCreatePatchFields>[0] = {
    fields: fields.includes('systemPrompt') ? ['systemPrompt'] : [],
    incoming,
    sourceId: args.sourceId,
    writeMs: args.writeMs,
    toolsHubRow,
    setWritingField: args.setWritingField,
    applyChatPatch: args.applyChatPatch,
    sleep: args.sleep,
  };
  if (args.setAttentionField) instructionArgs.setAttentionField = args.setAttentionField;
  if (args.setProgressLabel) instructionArgs.setProgressLabel = args.setProgressLabel;
  if (args.onSectionComplete) {
    instructionArgs.onFieldComplete = (field): void => {
      if (field !== 'systemPrompt') return;
      const line = sectionCompleteChatLine({ field });
      if (line) args.onSectionComplete?.(line);
    };
  }
  await revealCreatePatchFields(instructionArgs);

  // Honest misses when the field was requested but nothing landed on the canvas.
  // A plan (or a plan still in flight) decides hubs itself: no false "couldn't bind".
  if (args.onSectionComplete && !planned && !localBindsOnly) {
    if (fields.includes('tools') && toolsMiss) {
      const line = sectionCompleteChatLine({ field: 'tools', toolLabels: [], bindMiss: true });
      if (line) args.onSectionComplete(line);
    }
    if (fields.includes('skills') && skillsMiss) {
      const line = sectionCompleteChatLine({ field: 'skills', bindMiss: true });
      if (line) args.onSectionComplete(line);
    }
    if (fields.includes('knowledge') && knowledgeMiss) {
      const line = sectionCompleteChatLine({ field: 'knowledge', bindMiss: true });
      if (line) args.onSectionComplete(line);
    }
  }

  args.setWritingField(null);
  args.setAttentionField?.(null);
  args.setProgressLabel?.(null);
}

function summarizeSelectedCapabilities(patch: AgentCreateChatPatch): string {
  const parts: string[] = [];
  if (patch.tools) {
    for (const name of patch.tools.subagents ?? []) parts.push(`subagent ${name}`);
    for (const name of patch.tools.gateway ?? []) parts.push(`MCP/gateway ${name}`);
    for (const name of (patch.tools.direct ?? []).slice(0, 10)) parts.push(name);
    for (const name of (patch.tools.custom ?? []).slice(0, 6)) parts.push(name);
  }
  if (Array.isArray(patch.selectedSkillIds) && patch.selectedSkillIds.length > 0) {
    parts.push(`${patch.selectedSkillIds.length} skill(s)`);
  }
  if (Array.isArray(patch.selectedKbResources) && patch.selectedKbResources.length > 0) {
    parts.push('knowledge base');
  }
  return parts.join(', ');
}
