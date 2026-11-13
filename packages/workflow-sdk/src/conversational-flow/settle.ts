/**
 * What is true of the config once an edit is done, rather than something an
 * author maintains:
 *
 * - a section's case names its whole subtree, so a descent finds anything inside it;
 * - every frame starts a round with the same keys, so a jump may name any of them;
 * - every jump names the innermost frame holding both its ends;
 * - a question's heading is the breadcrumb, where it was the generated one;
 * - a router is told about the screens its own frame can open;
 * - typing that named a router no longer above it is sent to the nearest one.
 *
 * An edit calls `settle` rather than `mutate` when it can move any of those —
 * which, once the config is the tree, is most structural edits.
 */
import type { WorkflowConfig } from '../types/workflow-config.js';
import { asArray, asRec, type Rec, type Step } from './json.js';
import { writeJumps } from './jumps.js';
import { caseFor, cycleAt, sectionCaseFor } from './locate.js';
import { readConversationalFlow } from './read.js';
import { inheritedInput, textRef } from './rounds.js';
import { partsOf, sectionCase, stepsIn } from './shape.js';
import { breadcrumb, mainMenuLabel, subtreeOf, treeOrder } from './tree.js';
import { repairTypedRouting } from './typing.js';
import type { ConversationalFlow, Screen } from './types.js';

export class ConversationalFlowEditError extends Error {
  override readonly name = 'ConversationalFlowEditError';
}

/** Recompute everything derived, without any other change. */
export function refreshDerived(config: WorkflowConfig): WorkflowConfig {
  return settle(config, () => {});
}

/**
 * Apply `edit`, then make the config true again.
 *
 * A heading the author wrote is left alone: only the ones that still read as
 * the breadcrumb they were given are rewritten.
 */
export function settle(
  config: WorkflowConfig,
  edit: (draft: WorkflowConfig) => void,
  /** The config as the author last saw it, when this is part-way through a larger edit. */
  baseline: WorkflowConfig = config,
): WorkflowConfig {
  const before = requireFlow(baseline);
  const generated = new Set<string>();
  for (const screen of before.screens) {
    const heading = headingFor(before, screen);
    for (const prompt of screen.prompts) if (prompt.header === heading) generated.add(prompt.id);
  }

  const draft = clone(config);
  edit(draft);
  const after = requireFlow(draft);

  writeConditions(draft, after);
  writeFrames(draft, after);
  writeHeaders(draft, after, generated);
  writeRouters(draft, after);
  writeHandoffs(draft, after);
  repairTypedRouting(draft, after);
  writeJumps(draft, after);
  return draft;
}

export function requireFlow(config: WorkflowConfig): ConversationalFlow {
  const flow = readConversationalFlow(config);
  if (!flow) throw new ConversationalFlowEditError('This workflow is not a conversational flow.');
  return flow;
}

// ─── What each pass owns ───

/**
 * A section opens when the target is anywhere inside it, so its case names its
 * subtree as it stands — this is what makes a jump to a screen four levels down
 * find its way there without anyone writing a path.
 */
function writeConditions(draft: WorkflowConfig, flow: ConversationalFlow): void {
  for (const screen of flow.screens) {
    // Room, not occupancy: a Menu emptied of screens keeps its case, and its
    // condition has to stop naming the ones that left.
    if (!screen.hasFrame || screen.id === flow.rootScreen) continue;
    const entry = sectionCaseFor(draft, flow, screen);
    if (!entry) continue;
    const rebuilt = sectionCase(subtreeOf(flow, screen.id), screen.title, [], flow.routeKey);
    entry['condition'] = rebuilt['condition'];
    entry['label'] = screen.title;
  }
}

/**
 * Every frame starts a round with the same keys, each passed in from the round
 * around it. A cycle refuses a jump carrying anything else, so this is what
 * lets a jump name any frame at all.
 */
function writeFrames(draft: WorkflowConfig, flow: ConversationalFlow): void {
  const input = inheritedInput(draft, flow);
  if (Object.keys(input).length === 0) return;
  for (const screen of flow.screens) {
    if (!screen.hasFrame || screen.id === flow.rootScreen) continue;
    const cycle = cycleAt(draft, screen.frames, flow.routeKey);
    if (cycle) cycle.config['input'] = { ...input };
  }
}

/** The heading above a question: where they are, unless the author said otherwise. */
function writeHeaders(draft: WorkflowConfig, flow: ConversationalFlow, generated: Set<string>): void {
  for (const screen of flow.screens) {
    const heading = headingFor(flow, screen);
    // What a frame asks on the way in sits outside it, so it is reached through
    // the section's case rather than the screen's own.
    const section = screen.hasFrame ? sectionCaseFor(draft, flow, screen) : undefined;
    const asking = section ? partsOf(section, flow.routeKey).asking : undefined;
    const entry = caseFor(draft, flow, screen);
    for (const step of [
      ...(asking ? [asking.step] : []),
      ...(entry ? stepsIn(partsOf(entry, flow.routeKey).rest, 'WAIT') : []),
    ]) {
      if (generated.has(step.id) || step.config['reason'] === undefined) step.config['reason'] = heading;
    }
  }
}

/**
 * Where they are, as a heading. The first screen is the conversation rather than
 * a place inside it, so it is headed by its own name.
 */
function headingFor(flow: ConversationalFlow, screen: Screen): string {
  return breadcrumb(flow, screen) || screen.title;
}

/**
 * What a router may choose: the screens its own frame can open. A router at the
 * conversation's level reaches the whole flow; one inside a section reaches that
 * section — which is all scoping is, now that the frame says it.
 */
function writeRouters(draft: WorkflowConfig, flow: ConversationalFlow): void {
  for (const screen of flow.screens) {
    if (!screen.router || screen.router.mode !== 'classifier') continue;
    const entry = caseFor(draft, flow, screen);
    const step = entry ? partsOf(entry, flow.routeKey).rest.find((s: Step) => s.id === screen.router?.stepId) : undefined;
    if (!step) continue;

    const reachable = openableFrom(flow, screen);
    const classes: Rec = {};
    for (const to of reachable) classes[to.id] = describe(flow, to);
    step.config['classes'] = classes;
    step.config['instructions'] = instructionsFor(flow, screen, reachable);
    step.config['input'] = textRef(draft, flow);
    // Somewhere to send a message it cannot place, when the author set a bar at
    // all: its own frame, so an unsure message stays where the person is.
    if (typeof step.config['minConfidence'] === 'number') step.config['fallbackClass'] = frameOf(flow, screen);
    else delete step.config['fallbackClass'];
  }
  for (const screen of flow.screens) {
    if (!screen.router || screen.router.mode !== 'agent') continue;
    const entry = caseFor(draft, flow, screen);
    const step = entry ? partsOf(entry, flow.routeKey).rest.find((s: Step) => s.id === screen.router?.stepId) : undefined;
    if (step) writeAgentRouter(draft, flow, screen, step, openableFrom(flow, screen));
  }
}

/**
 * An agent asked to name the next screen. Unlike a classifier it is told in
 * prose, so the screens it may choose are both in what it is asked and in the
 * shape of the answer it must give.
 */
function writeAgentRouter(draft: WorkflowConfig, flow: ConversationalFlow, router: Screen, step: Step, reachable: Screen[]): void {
  const guidance = router.router?.guidance?.trim();
  step.config['task'] = [
    ...(guidance ? [guidance, ''] : []),
    `Someone in this conversation typed: "${textRef(draft, flow)}"`,
    '',
    'Send them to the screen that best answers it. The screens, with where each sits:',
    ...reachable.map((s) => `${s.id} (${breadcrumb(flow, s) || s.title})${s.children.length > 0 ? ' [section]' : ''} — ${s.about ?? aboutFor(flow, s)}`),
    '',
    'Prefer the deepest screen that matches; choose a [section] only when the message is too vague for anything inside it.',
    `If nothing fits, choose "${frameOf(flow, router)}".`,
    `Answer with JSON only: {"${flow.routeKey}": "<id from the list>", "reason": "<one short sentence>"}.`,
  ].join('\n');
  step.config['outputType'] = 'json';
  step.config['outputSchema'] = {
    type: 'object',
    properties: {
      [flow.routeKey]: { type: 'string', enum: reachable.map((s) => s.id) },
      reason: { type: 'string' },
    },
    required: [flow.routeKey, 'reason'],
  };
}

/** The screen whose frame a router sits in — the conversation itself, or a section. */
function frameOf(flow: ConversationalFlow, router: Screen): string {
  return router.frames[router.frames.length - 1] ?? flow.rootScreen;
}

/**
 * Where a hand off can go once the person is done: an ending closes the
 * conversation, any other screen hands it back into the flow. Endings first,
 * then the screens as the tree reads — never another hand off.
 */
function writeHandoffs(draft: WorkflowConfig, flow: ConversationalFlow): void {
  const handoffs = flow.screens.filter((s) => s.kind === 'handoff' && s.prompts[0]);
  if (handoffs.length === 0) return;
  const answerable = (s: Screen) => s.kind === 'menu' || s.kind === 'message' || s.kind === 'ask-ai';
  const options = [
    ...flow.screens.filter((s) => s.kind === 'end').map((s) => ({ label: s.title, value: s.id })),
    ...treeOrder(flow)
      .filter(answerable)
      .map((s) => ({
        label: s.id === flow.rootScreen ? (mainMenuLabel(flow) ?? s.title) : breadcrumb(flow, s),
        value: s.id,
      })),
  ];
  for (const handoff of handoffs) {
    // However many ways it hands off, the person answering has the same choices.
    const entry = caseFor(draft, flow, handoff);
    for (const wait of entry ? stepsIn(partsOf(entry, flow.routeKey).rest, 'WAIT') : []) {
      selectOptions(wait).splice(0, Infinity, ...options);
    }
  }
}

/** The options of a question, live, so a pass can replace them in place. */
function selectOptions(wait: Step): unknown[] {
  const fields = asArray(asRec(wait.config['form'])['fields']).map(asRec);
  const select = fields.find((f) => f['type'] === 'select');
  if (!select) return [];
  if (!Array.isArray(select['options'])) select['options'] = [];
  return select['options'] as unknown[];
}

/**
 * The screens a router in this frame can send someone to: everything its own
 * switch holds, and everything inside those — but never another router, and
 * never an ending whose author has not said when it applies.
 */
function openableFrom(flow: ConversationalFlow, router: Screen): Screen[] {
  const frame = frameOf(flow, router);
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  const inside = subtreeOf(flow, frame).map((id) => byId.get(id));
  // A router inside a section still needs a way out: a message that isn't about
  // this section at all belongs on the first screen, and "talk to a person"
  // works from anywhere. Without those it would have to pick the least bad
  // screen in the section, which is worse than saying "not here".
  const escapes = frame === flow.rootScreen ? [] : [byId.get(flow.rootScreen), ...flow.screens.filter((s) => s.kind === 'handoff')];

  const seen = new Set<string>();
  return [...inside, ...escapes]
    .filter((s): s is Screen => s !== undefined)
    .filter((s) => s.id !== router.id && s.kind !== 'router')
    .filter((s) => s.kind !== 'end' || (s.about ?? '') !== '')
    .filter((s) => !seen.has(s.id) && seen.add(s.id));
}

function describe(flow: ConversationalFlow, screen: Screen): string {
  if (screen.kind === 'end') return `Ends the conversation — ${screen.about ?? 'they are done'}`;
  const section = screen.children.length > 0 ? ' [section]' : '';
  return `${breadcrumb(flow, screen)}${section} — ${screen.about ?? aboutFor(flow, screen)}`;
}

/** What to say about a screen whose author has not said anything. */
function aboutFor(flow: ConversationalFlow, screen: Screen): string {
  return `the ${breadcrumb(flow, screen) || screen.title} screen`;
}

function instructionsFor(flow: ConversationalFlow, router: Screen, reachable: Screen[]): string {
  const guidance = router.router?.guidance?.trim();
  const list = reachable.map((s) => `${s.id} (${breadcrumb(flow, s)})`).join('\n');
  return [
    guidance,
    'Which screen answers this message? The screens are a tree; the path is shown in brackets.',
    list,
    'Prefer the deepest screen that matches.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ─── Plumbing ───

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
