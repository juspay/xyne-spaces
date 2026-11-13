/**
 * Calls: what a frame fetches on the way in.
 *
 * Where the step sits is the whole meaning, so that is the only thing these
 * edits decide:
 *
 *   before the first screen's cycle   once per conversation, in scope everywhere
 *   before a section's cycle          once per entry to it, in scope inside it
 *   before a question                 every visit, in scope on that screen
 *
 * However someone arrives — tapped down, typed and routed straight in, came
 * back — they pass through the frames above them, so what those frames fetched
 * has been fetched. That is the property the whole shape exists for, and it is
 * not maintained anywhere: it is where the step is.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray, asRec, asSteps, type Rec, type Step } from '../json.js';
import { caseFor, sectionCaseFor } from '../locate.js';
import { guardTarget, isCall, isCycle } from '../shape.js';
import { ConversationalFlowEditError, requireFlow, settle } from '../settle.js';
import type { Call, CallScope, ConversationalFlow, Screen } from '../types.js';

/** What this layer is willing to write. Anything else is somebody's typo. */
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

export interface CallDraft {
  /** What to call it — shown in the editor and in the run's trace. */
  title: string;
  /** The HTTP step's own config: `url`, `method`, `headers`, `body`, `response`, … */
  request: Record<string, unknown>;
}

/** How a call's answer is quoted, from anywhere inside its frame. */
export function callRef(callId: string, path = 'body'): string {
  return `{{steps.${callId}.output.${path}}}`;
}

/**
 * Fetch something on the way into `screenId`.
 *
 * The scope follows the screen unless it is asked for: a section fetches for
 * everything inside it, a leaf for itself, and the first screen for the whole
 * conversation — which is what an id passed in at the start is usually for.
 */
export function addCall(
  config: WorkflowConfig,
  screenId: string,
  draft: CallDraft,
  scope?: CallScope,
): { config: WorkflowConfig; callId: string } {
  const flow = requireFlow(config);
  const screen = requireScreen(flow, screenId);
  const at = scope ?? defaultScope(flow, screen);
  refuseImpossible(flow, screen, at);

  const request = checked(draft.request);
  const title = draft.title.trim();
  let callId = '';
  const next = settle(config, (draft2) => {
    const flow2 = requireFlow(draft2);
    const where = placeFor(draft2, flow2, requireScreen(flow2, screenId), at);
    callId = unique(slug(title || 'call'), takenIds(draft2));
    where.steps.splice(where.at, 0, { id: callId, type: 'HTTP_REQUEST', ...(title ? { title } : {}), config: request });
  });
  return { config: next, callId };
}

/**
 * Move a lookup so it runs in front of a different screen.
 *
 * Where it sits *is* its scope, so this is the only way to change one — and it
 * is the honest way to say it: not "pick a scope" but "pick what it runs before".
 * Its guard moves with it; where a failed one goes is unchanged unless the new
 * place cannot have one.
 */
export function moveCall(config: WorkflowConfig, callId: string, screenId: string, scope?: CallScope): WorkflowConfig {
  const flow = requireFlow(config);
  const { screen: from, call } = ownerOf(flow, callId);
  const to = requireScreen(flow, screenId);
  const at = scope ?? defaultScope(flow, to);
  if (from.id === screenId && call.scope === at) return config;
  refuseImpossible(flow, to, at);

  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const taken = cut(draft, live, callId);
    const where = placeFor(draft, live, requireScreen(live, screenId), at);
    where.steps.splice(where.at, 0, ...taken);
  });
}

/** Take a call and its guard out of wherever they are, and hand them back. */
function cut(draft: WorkflowConfig, flow: ConversationalFlow, callId: string): unknown[] {
  const { screen } = ownerOf(flow, callId);
  for (const entry of [sectionCaseFor(draft, flow, screen), caseFor(draft, flow, screen), { steps: draft.steps } as unknown as Rec]) {
    if (!entry) continue;
    const steps = asArray(entry['steps']);
    const at = steps.findIndex((step) => asRec(step)['id'] === callId);
    if (at === -1) continue;
    const guard = guardTarget(asSteps(steps)[at + 1], callId, flow.routeKey) === undefined ? 1 : 2;
    return steps.splice(at, guard);
  }
  throw new ConversationalFlowEditError(`“${callId}” is not where it says it is.`);
}

/**
 * Rewrite a call. The request replaces what was there — the editor holds the
 * whole request, so merging halves of two would be guesswork — and where a
 * failed one goes is `setCallFallback`'s, so it is left alone.
 */
export function setCall(config: WorkflowConfig, callId: string, draft: CallDraft): WorkflowConfig {
  const flow = requireFlow(config);
  ownerOf(flow, callId);
  const request = checked(draft.request);
  const title = draft.title.trim();
  return settle(config, (d) => {
    const step = callStep(d, requireFlow(d), callId);
    step.config = request;
    if (title) step.title = title;
    else delete step.title;
  });
}

/** Stop fetching it, and take the guard that said where a failed one goes. */
export function removeCall(config: WorkflowConfig, callId: string): WorkflowConfig {
  const flow = requireFlow(config);
  const { call } = ownerOf(flow, callId);
  const used = quotedIn(flow, callId);
  if (used.length > 0) {
    throw new ConversationalFlowEditError(`“${call.title}” is quoted in ${used.join(', ')}. Take it out of the wording first.`);
  }
  return settle(config, (d) => {
    const flow2 = requireFlow(d);
    const { steps, index } = stepsAround(d, flow2, callId);
    steps.splice(index, call.onFail === undefined ? 1 : 2);
  });
}

/**
 * Where to go when it cannot be reached — or `null` to drop that, after which
 * an unanswered call fails the conversation.
 */
export function setCallFallback(config: WorkflowConfig, callId: string, to: string | null): WorkflowConfig {
  const flow = requireFlow(config);
  const { screen, call } = ownerOf(flow, callId);
  if (call.scope === 'conversation') {
    throw new ConversationalFlowEditError(
      `“${call.title}” runs before the conversation starts, so there is nowhere to send anyone if it fails. Move it onto “${screen.title}” to give it one.`,
    );
  }
  if (to !== null) {
    const target = requireScreen(flow, to);
    if (target.id === screen.id) {
      throw new ConversationalFlowEditError(`“${screen.title}” can’t fall back to itself — it would fetch the same thing again.`);
    }
    if (target.kind === 'router') {
      throw new ConversationalFlowEditError('A router reads typed messages. Send a failed call to a screen that says something.');
    }
  }

  return settle(config, (d) => {
    const flow2 = requireFlow(d);
    const { steps, index } = stepsAround(d, flow2, callId);
    const step = asRec(steps[index]);
    const had = call.onFail !== undefined;

    if (to === null) {
      if (had) steps.splice(index + 1, 1);
      const settings = asRec(step['settings']);
      delete settings['onError'];
      if (Object.keys(settings).length > 0) step['settings'] = settings;
      else delete step['settings'];
      return;
    }

    // Without this the run stops where the call failed and the conversation is
    // simply gone; with it, the guard below decides what the person sees.
    step['settings'] = { ...asRec(step['settings']), onError: 'continue' };
    const guard = {
      id: `${callId}_failed`,
      type: 'CONDITIONAL',
      config: {
        // An answer that never arrived has no `ok` at all, which is not `true` either.
        condition: { variable: callRef(callId, 'ok'), operator: 'neq', value: true },
        // `settle` aims it at the frame that encloses it.
        if_true: [{ id: `${callId}_failed_go`, type: 'GO_TO', config: { target: flow2.rootScreen, with: carried(d, flow2, to) } }],
        if_false: [],
      },
    };
    steps.splice(index + 1, had ? 1 : 0, guard);
  });
}

/** Where a call's answer is quoted, in the author's terms. */
export function quotedIn(flow: ConversationalFlow, callId: string): string[] {
  const needle = `steps.${callId}.`;
  const out: string[] = [];
  for (const screen of flow.screens) {
    for (const prompt of screen.prompts) {
      if (prompt.says.some((line) => line.includes(needle))) out.push(`what “${screen.title}” says`);
      for (const option of prompt.options) if (option.label.includes(needle)) out.push(`an option on “${screen.title}”`);
    }
    // Every way a Finish closes, when it has more than one.
    for (const ending of screen.versions.length > 0 ? screen.versions : [screen]) {
      if (ending.endMessage?.includes(needle)) out.push(`the farewell on “${screen.title}”`);
      for (const [key, value] of Object.entries(ending.endValue ?? {})) {
        if (typeof value === 'string' && value.includes(needle)) out.push(`“${screen.title}” → ${key}`);
      }
    }
    for (const call of screen.calls) {
      if (call.id !== callId && JSON.stringify(call.request).includes(needle)) out.push(`the request of “${call.title}”`);
    }
  }
  return out;
}

// ─── Where a call goes ───

function defaultScope(flow: ConversationalFlow, screen: Screen): CallScope {
  if (screen.id === flow.rootScreen) return 'conversation';
  return screen.hasFrame ? 'section' : 'screen';
}

function refuseImpossible(flow: ConversationalFlow, screen: Screen, scope: CallScope): void {
  if (screen.kind === 'router') {
    throw new ConversationalFlowEditError('A router only decides where a typed message goes; it has nothing to fetch.');
  }
  if (scope === 'conversation' && screen.id !== flow.rootScreen) {
    throw new ConversationalFlowEditError(`Only “${flow.rootScreen}” runs before the conversation starts.`);
  }
  if (scope === 'section' && !screen.hasFrame) {
    throw new ConversationalFlowEditError(`“${screen.title}” holds no screens, so there is no section to fetch for.`);
  }
}

/** The list a call belongs in, and where its turn comes in that list. */
function placeFor(
  config: WorkflowConfig,
  flow: ConversationalFlow,
  screen: Screen,
  scope: CallScope,
): { steps: unknown[]; at: number } {
  if (scope === 'conversation') {
    const steps = asArray(config.steps);
    return { steps, at: steps.findIndex((step) => isCycle(step as Step)) };
  }
  const entry = scope === 'section' ? sectionCaseFor(config, flow, screen) : caseFor(config, flow, screen);
  if (!entry) throw new ConversationalFlowEditError(`“${screen.title}” is not somewhere a call can go.`);
  const steps = asArray(entry['steps']);
  entry['steps'] = steps;
  return { steps, at: leading(steps) };
}

/** How many steps at the top of a list are already calls (and their guards). */
function leading(steps: unknown[]): number {
  let at = 0;
  while (at < steps.length && isCall(steps[at] as Step)) {
    at += 1;
    if (asRec(steps[at])['type'] === 'CONDITIONAL') at += 1;
  }
  return at;
}

/** The list holding a call, and where in it the call sits. */
function stepsAround(config: WorkflowConfig, flow: ConversationalFlow, callId: string): { steps: unknown[]; index: number } {
  const { screen, call } = ownerOf(flow, callId);
  const { steps } = placeFor(config, flow, screen, call.scope);
  const index = steps.findIndex((step) => asRec(step)['id'] === callId);
  if (index < 0) throw new ConversationalFlowEditError(`Step “${callId}” is missing.`);
  return { steps, index };
}

function callStep(config: WorkflowConfig, flow: ConversationalFlow, callId: string): Step {
  const { steps, index } = stepsAround(config, flow, callId);
  return steps[index] as Step;
}

function ownerOf(flow: ConversationalFlow, callId: string): { screen: Screen; call: Call } {
  for (const screen of flow.screens) {
    const call = screen.calls.find((c) => c.id === callId);
    if (call) return { screen, call };
  }
  throw new ConversationalFlowEditError(`There is nothing called “${callId}” to fetch.`);
}

function requireScreen(flow: ConversationalFlow, id: string): Screen {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new ConversationalFlowEditError(`There is no screen “${id}”.`);
  return screen;
}

/** What a jump carries: every key a round starts with, and where it is going. */
function carried(config: WorkflowConfig, flow: ConversationalFlow, screen: string): Rec {
  const root = asArray(config.steps).find((step) => isCycle(step as Step)) as Step | undefined;
  const out: Rec = {};
  for (const key of Object.keys(asRec(root?.config['input']))) out[key] = key === flow.routeKey ? screen : '';
  out[flow.routeKey] = screen;
  return out;
}

/** A request this layer is willing to write, with what it insists on settled. */
function checked(request: Record<string, unknown>): Rec {
  const url = typeof request['url'] === 'string' ? request['url'].trim() : '';
  if (!url) throw new ConversationalFlowEditError('A call needs an address.');
  const method = typeof request['method'] === 'string' ? request['method'].toUpperCase() : 'GET';
  if (!METHODS.has(method)) throw new ConversationalFlowEditError(`“${method}” isn’t a method this can call.`);
  return { ...JSON.parse(JSON.stringify(request)) as Rec, url, method };
}

function takenIds(config: WorkflowConfig): Set<string> {
  const out = new Set<string>();
  const walk = (steps: unknown[]): void => {
    for (const raw of steps) {
      const step = asRec(raw);
      if (typeof step['id'] === 'string') out.add(step['id']);
      for (const value of Object.values(asRec(step['config']))) {
        if (!Array.isArray(value)) continue;
        walk(value);
        for (const entry of value) walk(asArray(asRec(entry)['steps']));
      }
    }
  };
  walk(asArray(config.steps));
  return out;
}

function unique(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base}_${n}`;
  return name;
}

function slug(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'call';
}

