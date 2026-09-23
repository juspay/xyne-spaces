import {
  classifyCreateTurn,
  firstDraftFields,
  parseLocalRename,
  shouldGeneratePrompt,
  type CreateTurnClassification,
  type CreateTurnField,
} from './classifyCreateTurn.ts';
import { buildDraftCanvasPatch, draftFromModelReply } from './canvasFromIdentity.ts';
import type { AgentCreateChatPatch, AgentCreateField, AgentCreateHubRow } from './types.ts';
import { slicePatch } from './mergeChatPatch.ts';

async function revealTextField(args: {
  field: AgentCreateField;
  hubRow: AgentCreateHubRow | null;
  text: string;
  sourceId: string;
  writeMs: number;
  patchForText: (partial: string) => AgentCreateChatPatch;
  setWritingField: (
    field: AgentCreateField | null,
    hubRow?: AgentCreateHubRow | null,
  ) => void;
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
  args.setWritingField(args.field, args.hubRow);
  await args.sleep(Math.max(48, Math.min(args.writeMs, 120)));
  const chunk = full.length > 120 ? 3 : 1;
  const steps = Math.ceil(full.length / chunk);
  const stepMs = Math.max(18, Math.min(Math.floor(args.writeMs / Math.max(steps, 1)), 55));
  for (let end = chunk; end <= full.length + chunk - 1; end += chunk) {
    const partial = full.slice(0, Math.min(end, full.length));
    args.applyChatPatch(`${args.sourceId}-${args.field}-${partial.length}`, args.patchForText(partial), {
      highlight: false,
    });
    await args.sleep(stepMs);
  }
  await args.sleep(Math.max(48, Math.min(args.writeMs, 120)));
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

export const CREATE_REVEAL_FIELD_ORDER: readonly CreateTurnField[] = [
  'name',
  'slug',
  'description',
  'systemPrompt',
  'tools',
  'skills',
  'knowledge',
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
  setWritingField: (
    field: AgentCreateField | null,
    hubRow?: AgentCreateHubRow | null,
  ) => void;
  applyChatPatch: (
    sourceId: string,
    patch: AgentCreateChatPatch,
    options: { highlight: boolean },
  ) => AgentCreateField[];
  sleep: (ms: number) => Promise<void>;
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

    if (field === 'name' && typeof slice.name === 'string') {
      await revealTextField({
        field,
        hubRow,
        text: slice.name,
        sourceId: args.sourceId,
        writeMs: args.writeMs,
        patchForText: partial => ({ name: partial }),
        setWritingField: args.setWritingField,
        applyChatPatch: args.applyChatPatch,
        sleep: args.sleep,
      });
      continue;
    }
    if (field === 'slug' && typeof slice.slug === 'string') {
      await revealTextField({
        field,
        hubRow,
        text: slice.slug,
        sourceId: args.sourceId,
        writeMs: args.writeMs,
        patchForText: partial => ({ slug: partial }),
        setWritingField: args.setWritingField,
        applyChatPatch: args.applyChatPatch,
        sleep: args.sleep,
      });
      continue;
    }
    if (field === 'description' && typeof slice.description === 'string') {
      await revealTextField({
        field,
        hubRow,
        text: slice.description,
        sourceId: args.sourceId,
        writeMs: args.writeMs,
        patchForText: partial => ({ description: partial }),
        setWritingField: args.setWritingField,
        applyChatPatch: args.applyChatPatch,
        sleep: args.sleep,
      });
      continue;
    }
    if (field === 'systemPrompt' && typeof slice.systemPrompt === 'string') {
      await revealTextField({
        field,
        hubRow,
        text: slice.systemPrompt,
        sourceId: args.sourceId,
        writeMs: args.writeMs,
        patchForText: partial => ({ systemPrompt: partial }),
        setWritingField: args.setWritingField,
        applyChatPatch: args.applyChatPatch,
        sleep: args.sleep,
      });
      continue;
    }

    args.setWritingField(field, hubRow);
    await args.sleep(Math.max(48, Math.min(args.writeMs, 120)));
    const changed = args.applyChatPatch(`${args.sourceId}-${field}`, slice, { highlight: false });
    if (!changed.includes(field)) {
      args.setWritingField(null);
      continue;
    }
    await args.sleep(args.writeMs);
    args.setWritingField(null);
  }
}

const DRAFT_RE = /^\s*XYNE_CREATE_DRAFT:\s*(.+?)\s*$/im;
const RENAME_RE = /^\s*XYNE_CREATE_RENAME:\s*(.+?)\s*$/im;
const IDLE_RE = /^\s*XYNE_CREATE_IDLE\b/im;
const ASK_RE = /^\s*XYNE_CREATE_ASK\b/im;
const PARTIAL_MARKER_TAIL = /\n?\s*XYNE_CREATE_[A-Z]*\s*:?\s*[^\n]*$/i;

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

  return `You are Xyne AI on the agent-create screen — the same chat as /ai/chat.
Left pane is this conversation. The canvas on the right is the agent spec (name, handle, description, instructions, MCP, tools, skills, knowledge). You do not write the canvas yourself; the client writes it only when you emit a draft marker.

${canvas}

Default to a usable draft. The user can discover and edit the rest on the canvas.

Rules:
1. Greetings, UI questions, explanations, and nonsense (random characters, gibberish): reply in chat only. End with XYNE_CREATE_IDLE. Do not draft.
2. A job, even a thin one ("standup bot", "I wanna do A", "make an agent that …"): draft a usable agent from reasonable defaults. Reply with one short sentence that names the agent (e.g. "Drafted Design Radar on the canvas."). Then emit XYNE_CREATE_DRAFT: <one-line intent>. Do not interview first.
3. Ask 1–3 short questions only when a draft would be wrong without the answer (two contradictory jobs, which of two systems). Then emit XYNE_CREATE_ASK and do not draft. Unanswered questions never block Create.
4. First drafts fill name, handle, description, and instructions on the canvas only. Never paste Name, Description, Instructions, or Rules into chat — the canvas is the source of truth. Leave MCP, tools, skills, and knowledge empty unless the user named them.
5. Canvas edits (rename, shorter instructions, add Slack): emit DRAFT or RENAME as appropriate.
   Rename-only: XYNE_CREATE_RENAME: <new name>
6. Never mention these markers to the user. Never claim the canvas is filled unless you emitted DRAFT or RENAME.`;
}

export function createModeQuery(userText: string, snapshot: CreateCanvasSnapshot): string {
  return `${userText}\n\n---\n${buildCreateModeInstructions(snapshot)}`;
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
export function compactCreateDraftChatReply(
  visible: string,
  agentName?: string | null,
): string {
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

export const WALK_STANDUP_USER_TEXT = 'I want a standup scribe for the eng team.';
export const WALK_CHAT_RENAME_USER_TEXT = 'Walk chat rename: Agent Title From Chat.';
export const WALK_SKILL_HUB_USER_TEXT = 'Walk: add one skill to the agent hub.';
export const WALK_BUILTIN_HUB_USER_TEXT = 'Walk: add one builtin tool to the agent hub.';
export const WALK_KNOWLEDGE_HUB_USER_TEXT = 'Walk: add one knowledge source to the agent hub.';

/** Deterministic live-walk canvas actions (not the scripted route player). */
export function resolveWalkCreateAction(userText: string): CreateCanvasAction | null {
  const trimmed = userText.trim();
  if (trimmed === WALK_STANDUP_USER_TEXT) {
    return {
      type: 'draft',
      intent: 'standup scribe for the eng team',
      // Structured seed for canvas parsing only; chat display compacts profile dumps.
      visibleReply:
        '**Name**: Standup Scribe (@standup-scribe)\n' +
        '**Description**: Captures daily standups for the eng team.\n' +
        '**Instructions**:\nYou are Standup Scribe. Capture blockers, progress, and next steps for the eng team.\n' +
        'XYNE_CREATE_DRAFT: standup scribe for the eng team',
      fields: firstDraftFields(trimmed),
    };
  }
  if (trimmed === WALK_CHAT_RENAME_USER_TEXT) {
    return { type: 'rename', name: 'Agent Title From Chat' };
  }
  if (trimmed === WALK_SKILL_HUB_USER_TEXT) {
    return {
      type: 'draft',
      intent: trimmed,
      visibleReply: '',
      fields: ['skills'],
    };
  }
  if (trimmed === WALK_BUILTIN_HUB_USER_TEXT) {
    return {
      type: 'draft',
      intent: trimmed,
      visibleReply: '',
      fields: ['tools'],
    };
  }
  if (trimmed === WALK_KNOWLEDGE_HUB_USER_TEXT) {
    return {
      type: 'draft',
      intent: trimmed,
      visibleReply: '',
      fields: ['knowledge'],
    };
  }
  return null;
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
    if (
      statedName &&
      (statedSpec || (!marker.idle && /\bdraft\b/i.test(marker.visible)))
    ) {
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

/** Hub canvas write: model draft identity first, then reveal fields with writingField held at caret. */
export async function applyCreateHubDraft(args: {
  action: Extract<CreateCanvasAction, { type: 'draft' }>;
  canvasEmpty: boolean;
  existingSystemPrompt: string;
  writeMs: number;
  sourceId: string;
  generateAgentPrompt: (intent: string, existingPrompt?: string) => Promise<string>;
  setWritingField: (
    field: AgentCreateField | null,
    hubRow?: 'mcp' | 'skills' | 'knowledge' | null,
  ) => void;
  applyChatPatch: (
    sourceId: string,
    patch: AgentCreateChatPatch,
    options: { highlight: boolean },
  ) => AgentCreateField[];
  sleep: (ms: number) => Promise<void>;
  fillTools?: (incoming: AgentCreateChatPatch) => Promise<void>;
  fillSkills?: (incoming: AgentCreateChatPatch) => Promise<void>;
  fillKnowledge?: (incoming: AgentCreateChatPatch) => Promise<void>;
  toolsHubRow?: AgentCreateHubRow;
}): Promise<void> {
  const { action, canvasEmpty } = args;
  const toolsHubRow = args.toolsHubRow ?? 'mcp';
  const generateInstructions = action.fields.includes('systemPrompt') || canvasEmpty;
  const preludeFields = CREATE_REVEAL_FIELD_ORDER.filter(
    field =>
      action.fields.includes(field) &&
      field !== 'systemPrompt' &&
      field !== 'tools' &&
      field !== 'skills' &&
      field !== 'knowledge',
  );

  if (preludeFields.length > 0) {
    const preludePatch = incomingPatchForCreateDraft({
      visibleReply: action.visibleReply,
      intent: action.intent,
      generatedPrompt: '',
      fields: preludeFields,
      canvasEmpty,
    });
    const revealArgs = {
      incoming: preludePatch,
      sourceId: args.sourceId,
      writeMs: args.writeMs,
      toolsHubRow,
      setWritingField: args.setWritingField,
      applyChatPatch: args.applyChatPatch,
      sleep: args.sleep,
    };
    if (preludeFields.includes('name')) {
      await revealCreatePatchFields({
        fields: ['name'],
        ...revealArgs,
      });
      await args.sleep(args.writeMs * 2);
    }
    const restPrelude = preludeFields.filter(field => field !== 'name');
    if (restPrelude.length > 0) {
      await revealCreatePatchFields({
        fields: restPrelude,
        ...revealArgs,
      });
    }
  }

  const incoming: AgentCreateChatPatch = {};

  if (generateInstructions) {
    let generatedPrompt = '';
    try {
      generatedPrompt = await args.generateAgentPrompt(
        action.intent,
        args.existingSystemPrompt.trim() ? args.existingSystemPrompt.trim() : undefined,
      );
    } catch {
      // Keep drafting from chat-stated Instructions/Rules or an intent fallback.
      generatedPrompt = '';
    }
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

  if (action.fields.includes('tools') && args.fillTools) {
    args.setWritingField('tools', toolsHubRow);
    await args.sleep(Math.max(48, Math.min(args.writeMs, 120)));
    await args.fillTools(incoming);
  }

  if (action.fields.includes('skills') && args.fillSkills) {
    args.setWritingField('skills', 'skills');
    await args.sleep(Math.max(48, Math.min(args.writeMs, 120)));
    await args.fillSkills(incoming);
  }

  if (action.fields.includes('knowledge') && args.fillKnowledge) {
    args.setWritingField('knowledge', 'knowledge');
    await args.sleep(Math.max(48, Math.min(args.writeMs, 120)));
    await args.fillKnowledge(incoming);
  }

  const tailFields = CREATE_REVEAL_FIELD_ORDER.filter(
    field =>
      action.fields.includes(field) &&
      (field === 'systemPrompt' ||
        field === 'tools' ||
        field === 'skills' ||
        field === 'knowledge'),
  );

  await revealCreatePatchFields({
    fields: tailFields,
    incoming,
    sourceId: args.sourceId,
    writeMs: args.writeMs,
    toolsHubRow,
    setWritingField: args.setWritingField,
    applyChatPatch: args.applyChatPatch,
    sleep: args.sleep,
  });
}
