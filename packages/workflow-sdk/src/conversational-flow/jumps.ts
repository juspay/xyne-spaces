/**
 * Aiming every jump at the frame it belongs to.
 *
 * A jump names the cycle that catches it, and the engine unwinds everything
 * inside that cycle on the way. So the frame a jump names decides what survives
 * the move: name the section and its call is still in scope on the other side;
 * name the conversation and the section is left behind, to be entered again —
 * and fetched again — next time.
 *
 * The rule is one line: **the innermost frame that holds both ends**. Moving to
 * a sibling stays in the section; moving across the tree goes out to the
 * conversation; a Finish always ends the conversation.
 *
 * An answer that is carried on rather than named — a pick, a router's class —
 * can land in several frames, so it is split: one test per frame, deepest
 * first, all carrying the same answer. That is still one destination, written
 * as several jumps, and `prompt.ts` reads it back as one.
 */
import type { WorkflowConfig } from '../types/workflow-config.js';
import { asArray, asRec, asSteps, str, type Step } from './json.js';
import { caseFor, commonFrame, sectionCaseFor } from './locate.js';
import { isCycle, jumpsIn } from './shape.js';
import type { ConversationalFlow, Screen } from './types.js';

/** `{{steps.<id>.output…}}` — an answer carried on rather than named. */
const FROM_STEP = /^\{\{\s*steps\.([^.\s}]+)\.output\b/;

export function writeJumps(config: WorkflowConfig, flow: ConversationalFlow): void {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  for (const screen of flow.screens) {
    const entry = caseFor(config, flow, screen);
    if (entry) entry['steps'] = aimAll(asArray(entry['steps']), { from: screen, frames: screen.frames, flow, byId });

    // What a section fetches sits outside its own cycle, so a jump from there —
    // a failed call's way out — is enclosed by one frame fewer.
    if (!screen.hasFrame) continue;
    const section = sectionCaseFor(config, flow, screen);
    if (!section) continue;
    const steps = asArray(section['steps']);
    const at = steps.findIndex((step) => isCycle(asStep(step)));
    if (at < 0) continue;
    const outside = { from: screen, frames: screen.frames.slice(0, -1), flow, byId };
    section['steps'] = [...aimAll(steps.slice(0, at), outside), ...steps.slice(at)];
  }
}

interface Aiming {
  from: Screen;
  /** The frames enclosing the steps being aimed, innermost last. */
  frames: readonly string[];
  flow: ConversationalFlow;
  byId: Map<string, Screen>;
}

/** Every jump in a run of steps, however deeply branched, aimed. */
function aimAll(steps: unknown[], at: Aiming): unknown[] {
  return steps.flatMap((raw) => {
    const step = asStep(raw);
    if (!step) return [raw];

    if (step.type === 'GO_TO') return aim(step, at);
    // A split is derived, so it is taken apart and rebuilt rather than added to
    // — otherwise settling twice would split what was already split.
    const whole = collapse(step, at.flow.routeKey);
    if (whole) return aim(whole, at);
    if (step.type === 'FINISH') {
      // A Finish ends the conversation, so it names the conversation's own cycle.
      step.config['target'] = at.flow.rootScreen;
      return [step];
    }

    for (const [key, value] of Object.entries(step.config)) {
      if (!Array.isArray(value)) continue;
      // A switch's cases hold steps of their own; everything else is a branch.
      if (value.some((item) => asRec(item)['steps'] !== undefined)) {
        step.config[key] = value.map((item) => {
          const entry = asRec(item);
          return entry['steps'] === undefined ? item : { ...entry, steps: aimAll(asArray(entry['steps']), at) };
        });
      } else {
        step.config[key] = aimAll(value, at);
      }
    }
    return [step];
  });
}

/** One jump: named destination, or an answer that could land in several frames. */
function aim(step: Step, at: Aiming): unknown[] {
  const carried = asRec(step.config['with']);
  const going = carried[at.flow.routeKey];
  if (typeof going !== 'string' || going === '') return [step];

  if (!going.includes('{{')) {
    step.config['target'] = frameFor(going, at);
    return [step];
  }

  const groups = new Map<string, string[]>();
  for (const screen of candidates(going, at)) {
    const frame = frameFor(screen, at);
    groups.set(frame, [...(groups.get(frame) ?? []), screen]);
  }
  if (groups.size <= 1) {
    step.config['target'] = [...groups.keys()][0] ?? at.flow.rootScreen;
    return [step];
  }
  return [split(step, going, groups, at)];
}

/**
 * A split read back as the one jump it was: every branch carries the same
 * answer, and the fall-through is the jump the author's edit produced, id and
 * all.
 */
function collapse(step: Step, routeKey: string): Step | undefined {
  if (step.type !== 'CONDITIONAL') return undefined;
  const jumps = jumpsIn([step]);
  if (jumps.length < 2) return undefined;
  const carried = new Set(jumps.map((jump) => String(asRec(jump.config['with'])[routeKey])));
  if (carried.size !== 1) return undefined;

  let node: Step = step;
  while (node.type === 'CONDITIONAL') {
    const next = asSteps(asRec(node.config)['if_false'])[0];
    if (!next) return undefined;
    node = next;
  }
  return node.type === 'GO_TO' ? node : undefined;
}

/**
 * The same jump, tested by where the answer goes: the deepest frame first, so a
 * move that can stay inside a section does, and the outermost is the fall
 * through.
 */
function split(step: Step, going: string, groups: Map<string, string[]>, at: Aiming): Step {
  const depth = (frame: string) => at.byId.get(frame)?.frames.length ?? 0;
  const ordered = [...groups].sort((a, b) => depth(b[0]) - depth(a[0]));
  const [outermost, ...inner] = [...ordered].reverse();

  let node: Step = { ...step, config: { ...step.config, target: outermost![0] } };
  for (const [frame, screens] of inner) {
    node = {
      id: `${step.id}__at_${frame}`,
      type: 'CONDITIONAL',
      config: {
        condition: { any: screens.map((screen) => ({ variable: going, operator: 'eq', value: screen })) },
        if_true: [{ ...step, id: `${step.id}__in_${frame}`, config: { ...step.config, target: frame } }],
        if_false: [node],
      },
    };
  }
  return node;
}

/** The frame a jump from `from` to `screen` belongs in. */
function frameFor(screen: string, at: Aiming): string {
  const to = at.byId.get(screen);
  return to ? commonFrame(at.frames, to.frames) : at.flow.rootScreen;
}

/**
 * Where a carried answer could land: the options of the question it came from,
 * or the screens the router that produced it may choose. Anything else could go
 * anywhere, so it goes to the conversation.
 */
function candidates(going: string, at: Aiming): string[] {
  const source = FROM_STEP.exec(going)?.[1];
  if (!source) return [];
  const known = (ids: string[]) => ids.filter((id) => at.byId.has(id));

  for (const screen of at.flow.screens) {
    for (const prompt of screen.prompts) {
      if (prompt.id === source) return known(prompt.options.map((o) => o.value));
    }
    if (screen.router?.stepId === source) return known(screen.router.candidates);
    if (screen.askAi?.stepId === source) return known(screen.askAi.exits.map((o) => o.value));
  }
  return [];
}

function asStep(value: unknown): Step | undefined {
  const rec = asRec(value);
  return str(rec['id']) && str(rec['type']) ? (rec as unknown as Step) : undefined;
}
