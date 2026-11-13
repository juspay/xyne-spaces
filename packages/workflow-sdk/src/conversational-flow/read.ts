/**
 * config → the conversational-flow view.
 *
 * The walk is the tree: each CYCLE is a section, each case inside it is a screen
 * or a section of its own, and a screen's place is where its case sits. Nothing
 * is inferred from where options point, so nothing the reader says can disagree
 * with what the engine will do.
 *
 * Returns `null` when the config is not this shape, which is how a caller knows
 * to fall back to the general builder.
 */
import type { WorkflowConfig } from '../types/workflow-config.js';
import { asArray, asRec, asSteps, str, type Rec, type Step } from './json.js';
import { declaredFields, readCall } from './calls.js';
import { readPrompt, splitDestination, type PromptContext } from './prompt.js';
import { readQuestion } from './questions.js';
import { caseKind, casesOf, isCall, isCycle, jumpsIn, partsOf, routeKeyOf, switchIn } from './shape.js';
import {
  AGENT_STEP_TYPE,
  type AskAiInfo,
  CLASSIFIER_STEP_TYPE,
  END_MESSAGE_KEY,
  HANDOFF_SECTION,
  optionsOf,
  QUESTION_SEPARATOR,
  type Call,
  type ConversationalFlow,
  type Condition,
  type Prompt,
  type Question,
  type RouterInfo,
  type Screen,
  type ScreenKind,
} from './types.js';

/**
 * What the conversation is started with: the manual trigger's own input schema,
 * under `context` — which is where the Conversation API puts what the caller
 * passed in. Undeclared, a flow simply promises nothing.
 */
function conversationInputs(config: WorkflowConfig): ConversationalFlow['inputs'] {
  const schema = asRec(asRec(asRec(config.trigger)['config'])['inputSchema']);
  const context = asRec(asRec(schema['properties'])['context']);
  return declaredFields(Object.keys(context).length > 0 ? context : {});
}

/** The way out an Ask AI agent answers with: `{{steps.<agent>.output.choice}}`. */
const AGENT_CHOICE = /^\{\{\s*steps\.[^.\s}]+\.output\.choice\s*\}\}$/;

export function readConversationalFlow(config: WorkflowConfig): ConversationalFlow | null {
  const top = asSteps(config.steps);
  const root = top.find(isCycle);
  if (!root) return null;
  const routeKey = routeKeyOf(root);
  if (!routeKey) return null;

  const ctx: PromptContext = { routeKey, typeOf: indexTypes(top) };
  const screens: Screen[] = [];
  // Calls before the conversation's own cycle belong to its first screen, and
  // so are in scope for every screen in the flow.
  const opening = top.slice(0, top.indexOf(root)).filter(isCall);
  readSection(root, opening.map((step) => readCall(step, 'conversation', undefined)), [], undefined, 0, [], ctx, screens);

  if (!screens.some((s) => s.id === root.id)) return null;
  markBackLinks(screens);
  return { rootScreen: root.id, routeKey, screens, inputs: conversationInputs(config) };
}

/**
 * One frame: the cycle whose id is this section's screen. Its own screen is a
 * case inside it, so what the section fetched — which sits outside the cycle —
 * is in scope for that screen and everything beside it.
 */
function readSection(
  cycle: Step,
  calls: Call[],
  /** What was asked on the way into this frame, when its author asked anything. */
  questions: Question[],
  parent: string | undefined,
  depth: number,
  frames: string[],
  ctx: PromptContext,
  out: Screen[],
): void {
  const routing = switchIn(cycle);
  if (!routing) return;
  const inside = [...frames, cycle.id];
  const children: string[] = [];

  for (const entry of casesOf(routing)) {
    const kind = caseKind(entry, ctx.routeKey);
    if (!kind) continue;
    const { calls: own, asking, rest } = partsOf(entry, ctx.routeKey);

    if (kind.kind === 'section') {
      const inner = rest.find(isCycle);
      if (!inner) continue;
      const asked = asking ? [readQuestion(asking.step, asking.guard, ctx)] : [];
      readSection(inner, own.map((c) => readCall(c.step, 'section', c.onFail)), asked, cycle.id, depth + 1, inside, ctx, out);
      children.push(inner.id);
      continue;
    }

    // The section's own screen keeps the section's place; everything else in
    // this switch sits one level in.
    const isOwn = kind.screen === cycle.id;
    out.push(
      readScreen(kind.screen, entry, rest, {
        calls: [...(isOwn ? calls : []), ...own.map((c) => readCall(c.step, 'screen', c.onFail))],
        questions: isOwn ? questions : [],
        parent: isOwn ? parent : cycle.id,
        depth: isOwn ? depth : depth + 1,
        frames: inside,
        hasFrame: isOwn,
        ctx,
      }),
    );
    if (!isOwn) children.push(kind.screen);
  }

  const own = out.find((s) => s.id === cycle.id);
  if (own) own.children = children;
}

interface Placement {
  calls: Call[];
  /** What the frame this screen owns asks on the way in. Only its own screen has one. */
  questions: Question[];
  parent: string | undefined;
  depth: number;
  frames: string[];
  /**
   * Whether this screen owns the cycle it sits in — the room it has for screens
   * beneath it. That room is what makes it a Menu rather than a Message, and it
   * is the author's to give or take away; an empty Menu is a screen waiting to
   * be filled, not a Message.
   */
  hasFrame: boolean;
  ctx: PromptContext;
}

function readScreen(id: string, entry: Rec, rest: Step[], at: Placement): Screen {
  const label = str(entry['label']);
  const screen: Screen = {
    id,
    title: label ?? humanise(id),
    kind: 'custom',
    parent: at.parent,
    depth: at.depth,
    children: [],
    hasFrame: at.hasFrame,
    frames: at.frames,
    calls: at.calls,
    about: undefined,
    questions: at.questions,
    versions: [],
    prompts: [],
    router: undefined,
    askAi: undefined,
    endValue: undefined,
    endMessage: undefined,
  };

  const [first] = rest;
  if (!first) return screen;

  // A SWITCH before any question is the screen asking more than one way: one
  // branch per condition, and `default` for when none of them hold. Follow-ups
  // are a SWITCH too, but always *after* a WAIT, so position tells them apart.
  if (first.type === 'SWITCH') {
    const versions = versionsOf(first, at.ctx, screen);
    if (versions) {
      screen.kind = versions;
      return screen;
    }
  }

  if (first.type === 'WAIT') {
    readPrompt(rest, at.ctx, screen.prompts);
    screen.about = str(first.description);
    if (isHandoff(first)) {
      screen.kind = 'handoff';
      return screen;
    }
    const askAi = readAskAi(rest, screen.prompts[0], at.ctx);
    if (askAi) {
      screen.kind = 'ask-ai';
      screen.askAi = askAi;
      return screen;
    }
    screen.kind = screen.hasFrame ? 'menu' : 'message';
    return screen;
  }

  // Its own case has nothing to ask — what it asks was asked on the way in, and
  // the screen inside it is where the answers are read. So it is passed through
  // once rather than returned to, which is what separates it from a Menu. The
  // frame is required: without one there is no way in to have been asked on.
  if (rest.length === 1 && first.type === 'GO_TO' && screen.hasFrame) {
    screen.kind = 'input';
    return screen;
  }

  if (rest.length === 1 && first.type === 'FINISH') {
    screen.kind = 'end';
    // A Finish has no question to carry its "about", so its own step does —
    // and writing one is what lets the router end a conversation here.
    screen.about = str(first.description);
    Object.assign(screen, endingOf(first));
    return screen;
  }

  const router = readRouter(rest, at.ctx);
  if (router) {
    screen.kind = 'router';
    screen.router = router;
  }
  return screen;
}

/**
 * Every way a screen asks, read in the order the switch tries them: each case's
 * question carries the condition it is asked under, and `default`'s carries
 * none. What the screen *is* comes from the version asked when nothing else
 * holds, since that is the one it always has.
 */
function versionsOf(switchStep: Step, ctx: PromptContext, screen: Screen): ScreenKind | null {
  const config = asRec(switchStep.config);
  const branches: Array<{ when: Condition | undefined; steps: Step[] }> = [
    ...asArray(config['cases']).map(asRec).map((entry) => ({
      when: asCondition(entry['condition']),
      steps: asSteps(entry['steps']),
    })),
    { when: undefined, steps: asSteps(config['default']) },
  ];

  // A Finish that closes differently: every branch is one FINISH, each with its
  // own last word and result. What the screen reports is the one that always holds.
  if (branches.every((b) => b.steps.length === 1 && b.steps[0]?.type === 'FINISH')) {
    for (const branch of branches) {
      const finish = branch.steps[0]!;
      screen.versions.push({ ...(branch.when ? { when: branch.when } : {}), promptId: finish.id, ...endingOf(finish) });
      if (!branch.when) {
        screen.about = str(finish.description);
        Object.assign(screen, endingOf(finish));
      }
    }
    return 'end';
  }
  if (!branches.every((b) => b.steps[0]?.type === 'WAIT')) return null;

  let kind: ScreenKind = 'custom';
  for (const branch of branches) {
    const from = screen.prompts.length;
    readPrompt(branch.steps, ctx, screen.prompts);
    const asked = screen.prompts[from];
    if (!asked) continue;
    if (branch.when) asked.when = branch.when;
    screen.versions.push({ ...(branch.when ? { when: branch.when } : {}), promptId: asked.id });
    // The version asked when nothing else holds is what the screen is.
    if (!branch.when) {
      screen.about = str(branch.steps[0]?.description) ?? screen.about;
      kind = isHandoff(branch.steps[0]!) ? 'handoff' : 'menu';
    }
  }
  return kind;
}

/** What a FINISH reports, and the last word that rides beside it under its reserved key. */
function endingOf(finish: Step): { endValue: Record<string, unknown>; endMessage: string | undefined } {
  const { [END_MESSAGE_KEY]: message, ...result } = asRec(asRec(finish.config)['with']);
  return { endValue: result, endMessage: str(message) };
}

/**
 * A router: a step that names the next screen, and a jump that carries its
 * answer on. Its candidates are settled from the screens its switch can open.
 */
function readRouter(rest: Step[], ctx: PromptContext): RouterInfo | undefined {
  const deciding = rest.find((s) => s.type === CLASSIFIER_STEP_TYPE || s.type === AGENT_STEP_TYPE);
  if (!deciding) return undefined;
  const carried = splitDestination(rest, ctx);
  if (carried?.kind !== 'dynamic' || carried.from !== deciding.id) return undefined;

  const config = asRec(deciding.config);
  // A classifier's choices are its classes; an agent's are the ids its answer
  // is allowed to name.
  const classes =
    deciding.type === CLASSIFIER_STEP_TYPE
      ? Object.keys(asRec(config['classes']))
      : enumOf(asRec(config['outputSchema']), ctx.routeKey);
  return {
    mode: deciding.type === CLASSIFIER_STEP_TYPE ? 'classifier' : 'agent',
    stepId: deciding.id,
    agent: str(config['agentSlug']),
    model: str(config['model']),
    credentialName: str(config['credentialName']),
    minConfidence: typeof config['minConfidence'] === 'number' ? config['minConfidence'] : undefined,
    task: str(config['instructions']) ?? str(config['task']),
    guidance: str(deciding.description),
    candidates: classes,
  };
}

/**
 * An agent that answers until they leave: the screen asks first, a typed
 * question goes to an agent that waits for a reply after each answer, and a
 * jump then carries the way out the agent was told to name.
 */
function readAskAi(rest: Step[], prompt: Prompt | undefined, ctx: PromptContext): AskAiInfo | undefined {
  const gate = rest[1];
  if (!prompt || gate?.type !== 'CONDITIONAL') return undefined;
  const typed = asSteps(asRec(gate.config)['if_true']);
  const agent = typed[0];
  if (agent?.type !== AGENT_STEP_TYPE || asRec(agent.config)['waitForReply'] !== true) return undefined;

  // What it answers with leaves the screen — as one jump, or as the chain of
  // them a deep screen needs; either way they all carry the same answer.
  const leaving = splitDestination(typed.slice(1), ctx);
  if (leaving?.kind !== 'dynamic' || leaving.from !== agent.id) return undefined;
  if (!AGENT_CHOICE.test(agentChoice(typed.slice(1), ctx.routeKey))) return undefined;

  const config = asRec(agent.config);
  const task = str(config['task']) ?? '';
  const at = task.lastIndexOf(QUESTION_SEPARATOR);
  return {
    stepId: agent.id,
    agent: str(config['agentSlug']),
    task: at === -1 ? task : task.slice(0, at),
    intro: prompt.says[0] ?? '',
    exits: prompt.options,
  };
}

/** A hand off is a WAIT that shows the `handoff` section — its one marker. */
function isHandoff(wait: Step): boolean {
  return asArray(asRec(wait.config)['display']).map(asRec).some((section) => section['id'] === HANDOFF_SECTION);
}

// ─── Settling what the walk cannot know alone ───

/** An option leads "back" when it opens one of the screen's own ancestors. */
function markBackLinks(screens: Screen[]): void {
  const parent = new Map(screens.map((s) => [s.id, s.parent]));
  for (const screen of screens) {
    const ancestors = new Set<string>();
    for (let at = parent.get(screen.id); at !== undefined; at = parent.get(at)) ancestors.add(at);
    for (const option of optionsOf(screen)) {
      if (option.to.kind === 'screen' && ancestors.has(option.to.screen)) option.back = true;
    }
  }
}

// ─── Plumbing ───

function indexTypes(steps: Step[], into: Map<string, string> = new Map()): Map<string, string> {
  for (const step of steps) {
    into.set(step.id, step.type);
    for (const value of Object.values(asRec(step.config))) {
      if (Array.isArray(value)) {
        indexTypes(asSteps(value), into);
        for (const entry of value) indexTypes(asSteps(asRec(entry)['steps']), into);
      } else if (value && typeof value === 'object') {
        for (const branch of Object.values(asRec(value))) indexTypes(asSteps(branch), into);
      }
    }
  }
  return into;
}

function humanise(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

export type { Prompt };

/** The ids an answer may name, from the shape the agent was told to reply in. */
function enumOf(schema: Rec, key: string): string[] {
  return asArray(asRec(asRec(schema['properties'])[key])['enum']).filter((v): v is string => typeof v === 'string');
}

/** What a branch's jumps carry as the next screen — they all carry the same. */
function agentChoice(steps: Step[], routeKey: string): string {
  const jump = jumpsIn(steps)[0];
  const carried = jump ? asRec(asRec(jump.config)['with'])[routeKey] : undefined;
  return typeof carried === 'string' ? carried : '';
}

/** A case's test, when it is one the layer can show: a leaf, or a group of them. */
function asCondition(value: unknown): Condition | undefined {
  const rec = asRec(value);
  for (const join of ['all', 'any'] as const) {
    if (!Array.isArray(rec[join])) continue;
    const parts = asArray(rec[join]).map(asCondition).filter((c): c is Condition => c !== undefined);
    return parts.length > 0 ? ({ [join]: parts } as Condition) : undefined;
  }
  const variable = str(rec['variable']);
  const operator = str(rec['operator']);
  return variable && operator
    ? ({ variable, operator, ...('value' in rec ? { value: rec['value'] } : {}) } as Condition)
    : undefined;
}
