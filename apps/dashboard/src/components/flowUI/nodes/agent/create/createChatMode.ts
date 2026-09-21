import {
  classifyCreateTurn,
  FIRST_DESCRIBE_FIELDS,
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
}

export type CreateCanvasAction =
  | { type: 'idle' }
  | { type: 'rename'; name: string }
  | {
      type: 'draft';
      intent: string;
      fields: CreateTurnField[];
      askAfter?: boolean;
    };

const DRAFT_RE = /^\s*XYNE_CREATE_DRAFT:\s*(.+?)\s*$/im;
const RENAME_RE = /^\s*XYNE_CREATE_RENAME:\s*(.+?)\s*$/im;
const IDLE_RE = /^\s*XYNE_CREATE_IDLE\b/im;
const PARTIAL_MARKER_TAIL = /\n?\s*XYNE_CREATE_[A-Z]*\s*:?\s*[^\n]*$/i;

function markerLineRe(): RegExp {
  return /^\s*XYNE_CREATE_(?:DRAFT|RENAME|IDLE)\s*(?::\s*.+)?\s*$/gim;
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

Rules:
1. Greetings, UI questions, explanations, and nonsense (random characters, gibberish): reply in chat only. Do not draft.
2. Thin or ambiguous agent requests ("make an agent", "build a standup agent"): ask 1–3 short follow-up questions. Do not draft yet. The user can skip and type on the canvas.
3. When you actually have enough to draft (a real job, skip/just draft, or an explicit canvas edit), say so briefly, then emit exactly one marker on its own last line:
   XYNE_CREATE_DRAFT: <one-line intent the canvas should be filled from>
   Rename-only: XYNE_CREATE_RENAME: <new name>
   Not drafting: XYNE_CREATE_IDLE
4. Never mention these markers to the user. Never claim the canvas is filled unless you emitted DRAFT or RENAME.`;
}

export function createModeQuery(userText: string, snapshot: CreateCanvasSnapshot): string {
  return `${buildCreateModeInstructions(snapshot)}\n\nUser message:\n${userText}`;
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
  return {
    visible: stripCreateMarkers(text).trim(),
    draftIntent,
    renameTo,
    idle: IDLE_RE.test(text) && !draftIntent && !renameTo,
  };
}

export function visibleCreateReply(text: string, streaming: boolean): string {
  const stripped = stripCreateMarkers(text, streaming);
  return streaming ? stripped : stripped.trim();
}

function fieldsForDraft(
  userText: string,
  canvasEmpty: boolean,
  intakePending: boolean,
): { fields: CreateTurnField[]; askAfter?: boolean } {
  const classification = classifyCreateTurn(userText, canvasEmpty, {
    ...(intakePending && canvasEmpty ? { intakePending: true } : {}),
  });
  if (classification.kind === 'edit' && classification.fields.length > 0) {
    return {
      fields: classification.fields,
      ...(classification.askAfter ? { askAfter: true } : {}),
    };
  }
  return { fields: canvasEmpty ? FIRST_DESCRIBE_FIELDS : ['systemPrompt'] };
}

/**
 * Canvas writes are gated here. The chat reply is always the streamed model.
 * Marker is the source of truth. Classifier is only a fallback for skip/intake
 * answers and follow-up edits — never for greetings, Q&A, or gibberish.
 */
export function decideCreateCanvasAction(args: {
  userText: string;
  canvasEmpty: boolean;
  intakePending: boolean;
  marker: ParsedCreateChatAction;
}): CreateCanvasAction {
  const { userText, canvasEmpty, intakePending, marker } = args;
  const localRename = parseLocalRename(userText);
  const renameTo = marker.renameTo?.trim() || localRename;

  if (marker.draftIntent) {
    const planned = fieldsForDraft(userText, canvasEmpty, intakePending);
    return {
      type: 'draft',
      intent: marker.draftIntent,
      fields: planned.fields,
      ...(planned.askAfter ? { askAfter: true } : {}),
    };
  }

  if (renameTo) {
    return { type: 'rename', name: renameTo };
  }

  if (marker.idle) {
    return { type: 'idle' };
  }

  const classification = classifyCreateTurn(userText, canvasEmpty, {
    ...(intakePending && canvasEmpty ? { intakePending: true } : {}),
  });

  if (classification.kind !== 'edit') {
    return { type: 'idle' };
  }

  if (localRename) {
    return { type: 'rename', name: localRename };
  }

  if (!shouldGeneratePrompt(classification, canvasEmpty, userText)) {
    return { type: 'idle' };
  }

  // First describe on an empty canvas requires a draft marker. Follow-up edits
  // and intake skip/answers may fill without one.
  if (canvasEmpty && !intakePending) {
    return { type: 'idle' };
  }

  return {
    type: 'draft',
    intent: userText,
    fields: classification.fields,
    ...(classification.askAfter ? { askAfter: true } : {}),
  };
}
