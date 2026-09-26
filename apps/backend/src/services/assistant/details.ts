import { z } from 'zod';
import type { ActionDefinition } from '@xyne/shared/assistant';

/**
 * Reads the details of a request as the user said them: "Daniel", "hello", "ABC". Only words
 * and option ids come back — never ids of records. Records are found afterwards by
 * `records.ts`, under the user's permissions.
 *
 * The prompt is built from the actions' own field descriptions, so a new action needs no
 * change here.
 */

/** Words for each field, by field id. `many` fields may hold several names. */
export type FieldWords = Record<string, string | string[]>;

export interface ReadDetails {
  /** The action the words belong to, as the model read it; null when none fits. */
  action: string | null;
  fields: FieldWords;
}

/** One chat message for the language model. */
export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

const replySchema = z.object({
  action: z.string().nullable(),
  fields: z.record(z.union([z.string(), z.array(z.string())])).default({}),
});

const INSTRUCTIONS = [
  'You read requests made to a workspace assistant and copy out their details. Reply with JSON only:',
  '{"action": <one action id from `actions`, or null>, "fields": {<field id>: <value>}}.',
  'Rules:',
  '- `action`: the action `request` asks for. If `inProgress` is set and `request` continues it, use that action.',
  '- Include only details the user actually said. Never guess, never fill in defaults.',
  '- Copy words exactly as said, without the request around them ("tell Priya hi" → recipient "Priya", message "hi").',
  '- For person and channel fields, copy the name as said. For choice fields, answer with one option id.',
  '- For fields marked many, answer with a list.',
].join('\n');

/** The messages that ask the model which action the words belong to and what each detail is. */
export function detailsPrompt(
  text: string,
  candidates: readonly ActionDefinition[],
  inProgress: { action: string; asking: string | null } | null,
): ChatMessage[] {
  const request = {
    request: text,
    ...(inProgress ? { inProgress } : {}),
    actions: candidates.map(describeAction),
  };
  return [
    { role: 'system', content: INSTRUCTIONS },
    { role: 'user', content: JSON.stringify(request) },
  ];
}

/**
 * Reads the model's reply. Anything that is not the expected JSON gives no details; an
 * action outside `candidates` is dropped.
 */
export function parseDetailsReply(
  reply: string,
  candidates: readonly ActionDefinition[],
): ReadDetails {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(reply));
  } catch {
    return NO_DETAILS;
  }
  const parsed = replySchema.safeParse(json);
  if (!parsed.success) return NO_DETAILS;
  const known = new Set(candidates.map(action => action.id));
  const action = parsed.data.action && known.has(parsed.data.action) ? parsed.data.action : null;
  return { action, fields: parsed.data.fields };
}

export const NO_DETAILS: ReadDetails = { action: null, fields: {} };

function describeAction(action: ActionDefinition): Record<string, unknown> {
  return {
    id: action.id,
    description: action.intent.description,
    fields: Object.fromEntries(
      Object.entries(action.fields).map(([id, field]) => [
        id,
        {
          means: field.describe,
          kind: field.kind,
          ...(field.many ? { many: true } : {}),
          ...(field.options ? { options: field.options.map(option => option.id) } : {}),
        },
      ]),
    ),
  };
}

/** Some models wrap JSON in ```json fences despite being told not to. */
function stripCodeFence(reply: string): string {
  return reply.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
}
