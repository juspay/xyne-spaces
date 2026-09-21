import {
  classifyCreateTurn,
  firstDraftFields,
  parseLocalRename,
  shouldGeneratePrompt,
  type CreateTurnField,
} from './classifyCreateTurn.ts';

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
      fields: CreateTurnField[];
    };

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
2. A job, even a thin one ("standup bot", "I wanna do A", "make an agent that …"): draft a usable agent from reasonable defaults. Say what you filled, briefly. Then emit XYNE_CREATE_DRAFT: <one-line intent>. Do not interview first.
3. Ask 1–3 short questions only when a draft would be wrong without the answer (two contradictory jobs, which of two systems). Then emit XYNE_CREATE_ASK and do not draft. Unanswered questions never block Create.
4. First drafts fill name, handle, description, and instructions only. Leave MCP, tools, skills, and knowledge empty unless the user named them.
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
  return streaming ? stripped : stripped.trim();
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
      fields: fieldsForDraft(userText, canvasEmpty),
    };
  }

  if (renameTo) {
    return { type: 'rename', name: renameTo };
  }

  if (marker.idle || marker.ask) {
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
    fields: classification.fields,
  };
}
