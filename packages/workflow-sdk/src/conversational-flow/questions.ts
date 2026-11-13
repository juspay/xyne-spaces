/**
 * Reading what a screen asks a person for.
 *
 * Three kinds, because three are what a conversation can ask for: something
 * typed, something picked, something attached. Each is one field of a WAIT's
 * form, and its `name` is what the answer is called from then on.
 *
 * The WAIT sits before the frame, which is the whole point: a section's case is
 * opened by its whole subtree, so a jump aimed at a screen four levels down
 * still descends through it. That is why no jump has to carry an answer and no
 * router can skip one.
 *
 * What navigates is not here. The screen's own question offers the ways in,
 * because someone comes back to it; this one offers only the ways out.
 */
import { pauseFormToJsonSchema } from '../util/pause-form-schema.js';
import type { PauseForm, PauseFormField } from '../types/pause-state.js';
import { asArray, asRec, asSteps, str, type Rec, type Step } from './json.js';
import { fieldPicked, fieldRouted, splitDestination, type PromptContext } from './prompt.js';
import type { DeclaredField, PromptOption, Question, QuestionDraft, QuestionField } from './types.js';

/** `steps.<question>.output.resumeData.data.<name>` — what a search for an answer looks for. */
export function answerPath(questionId: string, name: string): string {
  return `steps.${questionId}.output.resumeData.data.${name}`;
}

/** How one answer is quoted, from anywhere inside the frame it is asked before. */
export function answerRef(questionId: string, name: string): string {
  return `{{${answerPath(questionId, name)}}}`;
}

/**
 * A question and whatever guards it: the WAIT asked on the way in, and the
 * branch that lets them leave instead of answering.
 */
export function readQuestion(wait: Step, guard: Step | undefined, ctx: PromptContext): Question {
  const config = asRec(wait.config);
  const fields = fieldsOf(wait);

  // Navigation here is the pick the guard acts on and, when that guard routes
  // it, the box they typed into. Everything else is asked for its own sake.
  const picked = fieldPicked(guard ? [guard] : [], wait.id, ctx.routeKey);
  const routed = fieldRouted(guard, wait.id, fields);
  const navigation = new Set([picked, routed].filter((n): n is string => n !== undefined));
  const asked = fields.filter((field) => !navigation.has(str(field['name']) ?? ''));

  return {
    id: wait.id,
    says: asArray(config['prompt']).map((line) => str(line) ?? ''),
    purpose: str(config['purpose']),
    header: str(config['reason']),
    asks: asked.map(asQuestionField).filter((ask): ask is QuestionField => ask !== undefined),
    answers: answersOf(asked),
    options: waysOut(fields, picked, guard, ctx),
    choiceField: picked,
    routedField: routed,
  };
}

/**
 * The ways out it offers, and where each goes — read off the guard, because the
 * guard is what acts on them. The way on is not one of these: it belongs to the
 * frame, and the editor draws it from there.
 */
function waysOut(fields: Rec[], picked: string | undefined, guard: Step | undefined, ctx: PromptContext): PromptOption[] {
  const select = picked === undefined ? undefined : fields.find((f) => str(f['name']) === picked);
  if (!select || guard?.type !== 'CONDITIONAL') return [];
  const to = splitDestination(asSteps(asRec(guard.config)['if_true']), ctx);
  return asArray(select['options'])
    .map(asRec)
    .map((option): PromptOption => {
      const value = String(option['value'] ?? '');
      return {
        label: str(option['label']) ?? value,
        value,
        // The guard carries the pick on whole, so an option opens what it names.
        to: to?.kind === 'choice' ? { kind: 'screen', screen: value } : (to ?? { kind: 'none' }),
        back: false,
      };
    });
}

/**
 * What the answers are called, and of what type — read off the same form the
 * step shows, through the same mapping the step publishes its output shape with.
 *
 * One entry per field and no deeper: an attachment's answer is the attachment,
 * not its name and its bytes, and a path into one would be a reference the
 * picker could offer and the engine could not fill.
 */
function answersOf(fields: Rec[]): DeclaredField[] {
  const shape = asRec(pauseFormToJsonSchema({ fields } as unknown as PauseForm)['properties']);
  return fields
    .map((field) => str(field['name']))
    .filter((name): name is string => name !== undefined && name !== '')
    .map((name) => ({ path: name, type: str(asRec(shape[name])['type']) }));
}

/** One form field in this layer's terms, or nothing when it is not a kind we ask in. */
function asQuestionField(field: Rec): QuestionField | undefined {
  const name = str(field['name']);
  const kind = KIND_OF[str(field['type']) ?? ''];
  if (!name || !kind) return undefined;
  return {
    kind,
    name,
    label: str(field['label']) ?? name,
    required: field['required'] === true,
    choices: asArray(field['options'])
      .map(asRec)
      .map((option) => str(option['value']) ?? str(option['label']) ?? '')
      .filter(Boolean),
    multiple: field['multiple'] === true,
  };
}

/**
 * What each kind of answer is called, everywhere.
 *
 * Fixed rather than named by the author: a client reads `selectedOptions` in
 * every workflow it ever talks to, instead of whatever this flow's author happened
 * to call it. The cost is one of each kind per question, which is what a form in
 * a chat is anyway — one thing to type, one to pick, one to attach.
 */
export const ANSWER_KEY: Record<QuestionDraft['kind'], string> = {
  text: 'textInput',
  choice: 'selectedOptions',
  attachment: 'attachments',
};

const KIND_OF: Record<string, QuestionField['kind'] | undefined> = {
  text: 'text',
  textarea: 'text',
  number: 'text',
  select: 'choice',
  attachment: 'attachment',
};

/**
 * The form a question asks, from the fields the author named — the other half of
 * {@link asQuestionField}, kept beside it so one shape is described once.
 */
export function formFor(asks: readonly QuestionField[]): Rec {
  return {
    fields: asks.map((ask): PauseFormField => {
      const base = { name: ANSWER_KEY[ask.kind], label: ask.label, ...(ask.required ? { required: true } : {}) };
      if (ask.kind === 'choice') {
        return { ...base, type: 'select', options: ask.choices.map((choice) => ({ label: choice, value: choice })) };
      }
      if (ask.kind === 'attachment') return { ...base, type: 'attachment', ...(ask.multiple ? { multiple: true } : {}) };
      return { ...base, type: 'textarea', rows: 3 };
    }),
  };
}

function fieldsOf(step: Step): Rec[] {
  return asArray(asRec(asRec(step.config)['form'])['fields']).map(asRec);
}
