/**
 * The one place that knows what the config looks like.
 *
 * Reading and editing both go through here, so the shape is stated once:
 *
 *   a section  = a case whose condition is its subtree, holding
 *                [its calls…, a CYCLE whose id is the section's screen]
 *   a screen   = a case whose condition is that screen, holding
 *                [its calls…, the WAIT (or FINISH, or the router's steps)]
 *   a jump     = a GO_TO naming the nearest cycle enclosing both ends
 *
 * A section's CYCLE takes the section's screen id, which is what makes a jump
 * read as `target: 'payments'` — the frame and the screen are the same thing.
 */
import { asArray, asRec, asSteps, str, type Rec, type Step } from './json.js';

/** The round-state key a switch tests, and how a condition names it. */
export const DEFAULT_ROUTE_KEY = 'screen';

export function screenRef(routeKey: string = DEFAULT_ROUTE_KEY): string {
  return `{{steps.__loop.output.input.${routeKey}}}`;
}

/** How many rounds one frame may run before it gives up. */
export const MAX_ROUNDS = 200;

// ─── Building ───

export function cycleStep(id: string, input: Rec, body: unknown[]): Step {
  return { id, type: 'CYCLE', config: { input, maxIterations: MAX_ROUNDS, body } };
}

export function switchStep(id: string, cases: Rec[], fallback: unknown[]): Step {
  return { id, type: 'SWITCH', config: { cases, default: fallback } };
}

/** A case for one screen: it opens only when that screen is the target. */
export function screenCase(screen: string, label: string, steps: unknown[], routeKey = DEFAULT_ROUTE_KEY): Rec {
  return { label, condition: { variable: screenRef(routeKey), operator: 'eq', value: screen }, steps };
}

/**
 * A case for a section: it opens when the target is anywhere inside it, so the
 * descent runs the section's calls on the way to whatever it holds.
 */
export function sectionCase(subtree: readonly string[], label: string, steps: unknown[], routeKey = DEFAULT_ROUTE_KEY): Rec {
  return {
    label,
    condition: { any: subtree.map((screen) => ({ variable: screenRef(routeKey), operator: 'eq', value: screen })) },
    steps,
  };
}

/** A jump to `screen`, caught by the cycle named `target`. */
export function jumpStep(id: string, target: string, carried: Rec): Step {
  return { id, type: 'GO_TO', config: { target, with: carried } };
}

/**
 * What a jump carries: the screen it opens, and every other key the round
 * started with passed on unchanged. A cycle refuses a jump that carries
 * anything else, which is what keeps every frame's state the same shape.
 */
export function carrying(keys: readonly string[], routeKey: string, screen: string): Rec {
  const out: Rec = {};
  for (const key of keys) out[key] = key === routeKey ? screen : screenRef(key);
  out[routeKey] = screen;
  return out;
}

export function finishStep(id: string, target: string, value: Rec): Step {
  return { id, type: 'FINISH', config: { target, with: value } };
}

// ─── Reading ───

export type CaseKind =
  | { kind: 'screen'; screen: string }
  | { kind: 'section'; subtree: string[] };

/**
 * What a case is for, from its condition alone: one screen, or every screen in
 * a section. Anything else is a shape this view does not write and cannot read.
 */
export function caseKind(entry: Rec, routeKey: string): CaseKind | null {
  const condition = asRec(entry['condition']);
  const ref = screenRef(routeKey);
  const named = (c: Rec): string | undefined =>
    c['variable'] === ref && c['operator'] === 'eq' && typeof c['value'] === 'string' ? c['value'] : undefined;

  const one = named(condition);
  if (one !== undefined) return { kind: 'screen', screen: one };

  const group = asArray(condition['any']).map(asRec).map(named);
  if (group.length > 0 && group.every((v): v is string => v !== undefined)) return { kind: 'section', subtree: group };
  return null;
}

export const isCycle = (step: Step | undefined): boolean => step?.type === 'CYCLE';
export const isCall = (step: Step | undefined): boolean => step?.type === 'HTTP_REQUEST';

/** The SWITCH a cycle routes with: the one control step in its body. */
export function switchIn(cycle: Step): Step | undefined {
  return asSteps(cycle.config['body']).find((s) => s.type === 'SWITCH');
}

/** The cases of a switch, to read. */
export function casesOf(switchStep: Step): Rec[] {
  return asArray(switchStep.config['cases']).map(asRec);
}

/**
 * The switch's own list of cases, to change — `casesOf` hands back a copy, which
 * is what you want for reading and useless for anything else.
 */
export function caseListIn(switchStep: Step): Rec[] {
  if (!Array.isArray(switchStep.config['cases'])) switchStep.config['cases'] = [];
  return switchStep.config['cases'] as Rec[];
}

/** A call, and where a failed one sends people. */
export interface CallSteps {
  step: Step;
  /** The screen its guard opens, when it has one. */
  onFail: string | undefined;
}

/**
 * The guard after a call: when it did not come back, open a screen instead.
 * An answer that never arrived has no `ok` at all, which is not `true` either.
 */
export function guardTarget(step: Step | undefined, callId: string, routeKey: string): string | undefined {
  if (step?.type !== 'CONDITIONAL') return undefined;
  const condition = asRec(asRec(step.config)['condition']);
  const expected = `{{steps.${callId}.output.ok}}`;
  if (condition['variable'] !== expected || condition['operator'] !== 'neq' || condition['value'] !== true) return undefined;
  const branch = asSteps(asRec(step.config)['if_true']);
  if (branch.length !== 1 || branch[0]!.type !== 'GO_TO') return undefined;
  const screen = asRec(branch[0]!.config['with'])[routeKey];
  return typeof screen === 'string' ? screen : undefined;
}

/**
 * A case's steps, split where the frame it feeds begins: the calls it makes on
 * the way in — each with the guard that says where a failed one goes — and then
 * whatever they are for.
 *
 * For a section that is its CYCLE; for a screen, its question. Preparation
 * always precedes the thing it prepares, which is what puts a call's answer in
 * scope for it.
 */
export function partsOf(
  entry: Rec,
  routeKey = DEFAULT_ROUTE_KEY,
): { calls: CallSteps[]; asking: AskingSteps | undefined; rest: Step[] } {
  const steps = asSteps(entry['steps']);
  const calls: CallSteps[] = [];
  let at = 0;
  while (isCall(steps[at])) {
    const step = steps[at]!;
    const onFail = guardTarget(steps[at + 1], step.id, routeKey);
    calls.push({ step, onFail });
    at += onFail === undefined ? 1 : 2;
  }
  const asking = askedBefore(steps, at);
  return { calls, asking: asking.way, rest: steps.slice(at + asking.taken) };
}

/** A question asked on the way in, with the branch that lets them leave instead. */
export interface AskingSteps {
  step: Step;
  guard: Step | undefined;
}

/**
 * A question asked before the frame it feeds, which position alone says: a WAIT
 * with the cycle behind it, or with the branch that lets them leave and then the
 * cycle. A WAIT with no frame after it is the screen's own question.
 *
 * One question, not several. A screen may ask its *own* question more than one
 * way — a SWITCH of them, one per condition — but not this one: every way would
 * be its own WAIT with its own id, and what reads the answer from inside the
 * frame can only name one of them. Asking differently belongs to the screen
 * inside, which can also branch on what was just answered. Several ways here
 * would need the answers to outlive the WAIT they were given to.
 */
function askedBefore(steps: Step[], at: number): { way: AskingSteps | undefined; taken: number } {
  const step = steps[at];
  if (step?.type !== 'WAIT') return { way: undefined, taken: 0 };
  const next = steps[at + 1];
  if (next && isCycle(next)) return { way: { step, guard: undefined }, taken: 1 };
  const after = steps[at + 2];
  if (next?.type === 'CONDITIONAL' && after && isCycle(after)) return { way: { step, guard: next }, taken: 2 };
  return { way: undefined, taken: 0 };
}

/** The key a cycle starts each round with — how a switch knows what to open. */
export function routeKeyOf(cycle: Step): string | undefined {
  const keys = Object.keys(asRec(cycle.config['input']));
  return keys.find((k) => k === DEFAULT_ROUTE_KEY) ?? keys[0];
}

/**
 * Every step of a kind in a run of steps, however deeply branched — through both
 * halves of a conditional and through a switch's cases, which is where a
 * follow-up question and everything it leads to lives.
 */
export function stepsIn(steps: unknown[], type: string, out: Step[] = []): Step[] {
  for (const step of asSteps(steps)) {
    if (step.type === type) out.push(step);
    for (const value of Object.values(asRec(step.config))) {
      if (!Array.isArray(value)) continue;
      stepsIn(value, type, out);
      // A switch's cases are not steps; what each opens is.
      for (const entry of value) stepsIn(asArray(asRec(entry)['steps']), type, out);
    }
  }
  return out;
}

/**
 * The gates that tell typing from tapping: a CONDITIONAL on what was typed into
 * a question. A call's guard tests `output.ok` and so is never one of these.
 */
export function typedGatesIn(steps: unknown[]): Step[] {
  return stepsIn(steps, 'CONDITIONAL').filter((step) => {
    const condition = asRec(step.config['condition']);
    const first = asRec(asArray(condition['all'])[0]);
    const variable = str(first['variable']) ?? str(condition['variable']) ?? '';
    return variable.includes('.output.resumeData.data.');
  });
}

/** One step by id, anywhere in a run of steps — a follow-up's question included. */
export function stepIn(steps: unknown[], id: string): Step | undefined {
  for (const step of asSteps(steps)) {
    if (step.id === id) return step;
    for (const value of Object.values(asRec(step.config))) {
      if (!Array.isArray(value)) continue;
      const found = stepIn(value, id) ?? value.map((entry) => stepIn(asArray(asRec(entry)['steps']), id)).find(Boolean);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Every jump in a run of steps.
 *
 * One destination is sometimes written as several jumps — the same answer
 * carried on, tested by which frame it lands in — so both halves of the layer
 * need to see them all.
 */
export function jumpsIn(steps: unknown[], out: Step[] = []): Step[] {
  return stepsIn(steps, 'GO_TO', out);
}

/** Where a jump sends someone, when it names a literal screen. */
export function jumpTarget(step: Step, routeKey: string): { target: string; screen: string } | undefined {
  if (step.type !== 'GO_TO') return undefined;
  const target = str(step.config['target']);
  const screen = asRec(step.config['with'])[routeKey];
  if (!target || typeof screen !== 'string') return undefined;
  return { target, screen };
}
