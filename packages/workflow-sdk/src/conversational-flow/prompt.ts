/**
 * Reading what a screen asks.
 *
 * A question is a WAIT with a select field (the options) and, when typing is
 * allowed, a text field. What follows it says where each answer goes:
 *
 *   WAIT ask_x
 *   CONDITIONAL  they typed something  → GO_TO the router carrying the text
 *                otherwise             → GO_TO carrying their pick, or a SWITCH
 *                                        that opens a follow-up question
 *
 * Everything here is recognised by the WAIT's own output contract — never by an
 * id or a naming convention.
 */
import { asArray, asRec, asSteps, str, type Rec, type Step } from './json.js';
import { jumpsIn, stepsIn } from './shape.js';
import type { Destination, Prompt, PromptOption } from './types.js';

/** `{{steps.<wait>.output.resumeData.data.<field>}}` — a WAIT's own answer. */
const WAIT_FIELD = /^\{\{\s*steps\.([^.\s}]+)\.output\.resumeData\.data\.([A-Za-z0-9_]+)\s*\}\}$/;
const STEP_OUTPUT = /^\{\{\s*steps\.([^.\s}]+)\.output\b/;

export interface PromptContext {
  routeKey: string;
  /** Step id → its type, for saying what decides a dynamic destination. */
  typeOf: Map<string, string>;
}

/** A pick forwarded as the next screen, before it is expanded per option. */
type Resolved = Destination | { kind: 'choice'; wait: string; field: string };

/**
 * Read a WAIT-led run of steps into `out`.
 * Returns the id of the question read, so a parent option can point at it.
 */
export function readPrompt(steps: Step[], ctx: PromptContext, out: Prompt[]): string {
  const wait = steps[0]!;
  const config = asRec(wait.config);
  const fields = asArray(asRec(config['form'])['fields']).map(asRec);

  // Which fields navigate is settled by what reads them — a jump carries the one
  // they picked, a gate tests the one they typed into — so a field the author
  // added to be answered for its own sake is never mistaken for either. Type is
  // the guess only where nothing reads them yet.
  const after = steps.slice(1);
  const [gate] = after;
  const tested = gate?.type === 'CONDITIONAL' ? fieldTested(asRec(gate.config)['condition'], wait.id) : undefined;
  const select = fieldOf(fields, fieldPicked(after, wait.id, ctx.routeKey), SELECT) ?? only(fields, SELECT);
  const text = fieldOf(fields, tested, TEXT) ?? only(fields, TEXT);

  const prompt: Prompt = {
    id: wait.id,
    says: asArray(config['prompt']).map((line) => str(line) ?? ''),
    header: str(config['reason']),
    choiceField: str(select?.['name']),
    textField: str(text?.['name']),
    options: [],
    freeText: undefined,
    ...(typeof select?.['options'] === 'string' ? { optionsFrom: String(select['options']) } : {}),
  };
  out.push(prompt);

  // Typed text is split off by a CONDITIONAL testing this WAIT's own text field;
  // its other branch is what happens when an option was picked. A gate that
  // tests something else — or a box nothing tests — routes nothing, so what they
  // type there is an answer the screen keeps rather than a message to route.
  let picked = after;
  if (gate?.type === 'CONDITIONAL' && tested !== undefined && tested === prompt.textField) {
    const config = asRec(gate.config);
    prompt.freeText = finalise(destinationOf(asSteps(config['if_true']), ctx));
    picked = asSteps(config['if_false']);
  }

  const byValue = pickedDestinations(picked, wait.id, prompt.choiceField, ctx);
  prompt.options = asArray(select?.['options']).map(asRec).map((option): PromptOption => {
    const value = String(option['value'] ?? '');
    const to = byValue(value);
    const when = option['when'];
    return {
      label: str(option['label']) ?? value,
      value,
      // A pick forwarded whole opens the screen the option names.
      to: to.kind === 'choice' ? { kind: 'screen', screen: value } : to,
      back: false,
      // Kept as written: the engine reads it, and the editor edits it in place.
      ...(when !== undefined && when !== null ? { when: when as NonNullable<PromptOption['when']> } : {}),
    };
  });
  return wait.id;
}

/**
 * Where each answer leads. A pick may be forwarded whole — every option opens
 * the screen it names — or branched by a SWITCH on this question's own answer,
 * one case per option, with the rest falling to its default.
 */
function pickedDestinations(
  picked: Step[],
  waitId: string,
  choiceField: string | undefined,
  ctx: PromptContext,
): (value: string) => Resolved {
  const [only] = picked;
  if (only?.type === 'SWITCH' && picked.length === 1) {
    const config = asRec(only.config);
    const cases = asArray(config['cases']).map(asRec);
    const onThisAnswer = cases.every((entry) => {
      const condition = asRec(entry['condition']);
      return condition['operator'] === 'eq' && refersTo(condition['variable'], waitId, choiceField);
    });
    if (onThisAnswer) {
      const branches = new Map<string, Resolved>();
      for (const entry of cases) {
        branches.set(String(asRec(entry['condition'])['value']), destinationOf(asSteps(entry['steps']), ctx));
      }
      const fallback = destinationOf(asSteps(config['default']), ctx);
      return (value) => branches.get(value) ?? fallback;
    }
  }
  const whole = destinationOf(picked, ctx);
  return () => whole;
}

/**
 * The box a guard routes what they typed out of, when it routes one. A box
 * nothing tests is an answer the screen keeps, not a message to send on.
 */
export function fieldRouted(guard: Step | undefined, waitId: string, fields: Rec[]): string | undefined {
  if (guard?.type !== 'CONDITIONAL') return undefined;
  return str(fieldOf(fields, fieldTested(asRec(guard.config)['condition'], waitId), TEXT)?.['name']);
}

const SELECT: ReadonlySet<string> = new Set(['select']);
const TEXT: ReadonlySet<string> = new Set(['text', 'textarea']);

/**
 * The one field of these types, where nothing reads any of them — a question
 * half written, with its jump still to come. Two and the answer is unknowable,
 * so it is left unknown rather than guessed at by their order.
 */
function only(fields: Rec[], types: ReadonlySet<string>): Rec | undefined {
  const of = fields.filter((f) => types.has(str(f['type']) ?? ''));
  return of.length === 1 ? of[0] : undefined;
}

/** A form field by name, when it is one of `types` — nothing if it is neither. */
function fieldOf(fields: Rec[], name: string | undefined, types: ReadonlySet<string>): Rec | undefined {
  if (name === undefined) return undefined;
  return fields.find((f) => str(f['name']) === name && types.has(str(f['type']) ?? ''));
}

/** The field of `waitId`'s own answer a reference reads, if it reads one. */
function fieldRead(variable: unknown, waitId: string): string | undefined {
  if (typeof variable !== 'string') return undefined;
  const match = WAIT_FIELD.exec(variable);
  return match?.[1] === waitId ? match[2] : undefined;
}

/** The field a condition tests — how a gate names the box they typed into. */
function fieldTested(condition: unknown, waitId: string): string | undefined {
  const rec = asRec(condition);
  for (const part of [rec, ...asArray(rec['all']).map(asRec), ...asArray(rec['any']).map(asRec)]) {
    const name = fieldRead(part['variable'], waitId);
    if (name !== undefined) return name;
  }
  return undefined;
}

/**
 * The field whatever follows the question treats as the next screen: carried by
 * a jump, or tested by a switch that branches one case per option.
 */
export function fieldPicked(after: Step[], waitId: string, routeKey: string): string | undefined {
  for (const jump of jumpsIn(after)) {
    const name = fieldRead(asRec(asRec(jump.config)['with'])[routeKey], waitId);
    if (name !== undefined) return name;
  }
  // However deeply it sits: on a screen that takes typing, the switch that
  // branches one case per option is inside the gate's other half.
  for (const step of stepsIn(after, 'SWITCH')) {
    for (const entry of asArray(asRec(step.config)['cases']).map(asRec)) {
      const name = fieldRead(asRec(entry['condition'])['variable'], waitId);
      if (name !== undefined) return name;
    }
  }
  return undefined;
}

/** Does this reference read `field` off `waitId`'s answer? */
function refersTo(variable: unknown, waitId: string, field: string | undefined): boolean {
  if (typeof variable !== 'string' || !field) return false;
  const match = WAIT_FIELD.exec(variable);
  return match?.[1] === waitId && match[2] === field;
}

/** What a run of steps leads to: a jump, or an end. */
function destinationOf(steps: Step[], ctx: PromptContext): Resolved {
  const [first] = steps;
  if (!first) return { kind: 'none' };
  // A question here would be a follow-up asked inside the screen, which this
  // layer no longer models; such a flow needs migrating, and says so by showing
  // the answer leading nowhere rather than quietly leading somewhere wrong.
  if (first.type === 'WAIT') return { kind: 'none' };
  if (steps.length === 1 && (first.type === 'GO_TO' || first.type === 'FINISH')) return jumpDestination(first, ctx);
  return splitDestination(steps, ctx) ?? { kind: 'none' };
}

/**
 * One destination written as several jumps: the same answer carried on, tested
 * by which frame it lands in. They all say the same thing, so reading one is
 * reading the destination.
 */
export function splitDestination(steps: Step[], ctx: PromptContext): Resolved | undefined {
  const jumps = jumpsIn(steps);
  if (jumps.length === 0) return undefined;
  const carried = new Set(jumps.map((jump) => String(asRec(asRec(jump.config)['with'])[ctx.routeKey])));
  if (carried.size !== 1) return undefined;
  return jumpDestination(jumps[0]!, ctx);
}

/**
 * A GO_TO carries the screen it opens; a FINISH carries what the conversation
 * reports. Which cycle catches the jump is not the view's business — that is
 * settled from where the two screens sit.
 */
export function jumpDestination(step: Step, ctx: PromptContext): Resolved {
  const carried = asRec(asRec(step.config)['with']);
  if (step.type === 'FINISH') return { kind: 'end', value: carried };
  if (step.type !== 'GO_TO') return { kind: 'none' };

  const next = carried[ctx.routeKey];
  if (typeof next !== 'string' || next === '') return { kind: 'none' };
  if (!next.includes('{{')) return { kind: 'screen', screen: next };

  const pick = WAIT_FIELD.exec(next);
  if (pick && ctx.typeOf.get(pick[1]!) === 'WAIT') return { kind: 'choice', wait: pick[1]!, field: pick[2]! };

  const source = STEP_OUTPUT.exec(next);
  if (source) return { kind: 'dynamic', from: source[1]!, fromType: ctx.typeOf.get(source[1]!) };
  return { kind: 'none' };
}

/** A pick forwarded outside an option list has no single screen to name. */
export function finalise(resolved: Resolved): Destination {
  return resolved.kind === 'choice' ? { kind: 'none' } : resolved;
}
