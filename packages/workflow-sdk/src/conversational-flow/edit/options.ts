/**
 * The options a question offers.
 *
 * A question, not a screen: a screen with follow-ups asks several, each with its
 * own answers, so every edit here names the question it is about.
 *
 * An option is a line in that question's select field, and its value is the
 * screen it opens — so adding one is adding a line, and where the jump that
 * carries the answer is aimed is `settle`'s business, not the author's.
 *
 * The ways back are generated from where the screen sits: one per screen above
 * it, and the first screen last. They are rewritten rather than edited, which
 * is why they can be turned off and on as a whole.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray, asRec, str, type Rec, type Step } from '../json.js';
import { caseFor, sectionCaseFor } from '../locate.js';
import { ConversationalFlowEditError, requireFlow, settle } from '../settle.js';
import { partsOf, stepIn } from '../shape.js';
import { ancestorsOf, mainMenuLabel } from '../tree.js';
import { leavesOf } from '../conditions.js';
import type { Condition, ConversationalFlow, Prompt, Screen } from '../types.js';

export interface NewOption {
  label: string;
  /** The screen it opens. */
  screen: string;
}

/** Offer a screen. New options go above the ways back, where they read first. */
export function addOption(config: WorkflowConfig, promptId: string, option: NewOption, at?: number): WorkflowConfig {
  const flow = requireFlow(config);
  const { screen, prompt } = promptIn(flow, promptId);
  const label = option.label.trim();
  if (!label) throw new ConversationalFlowEditError('An option needs a label.');
  requireScreen(flow, option.screen);
  const firstBack = prompt.options.findIndex((o) => o.back);
  const where = at ?? (firstBack === -1 ? prompt.options.length : firstBack);

  return settle(config, (draft) => {
    const live = requireFlow(draft);
    optionList(draft, live, requireScreen(live, screen.id), promptId).splice(where, 0, { label, value: option.screen });
  });
}

export function relabelOption(config: WorkflowConfig, promptId: string, index: number, label: string): WorkflowConfig {
  const trimmed = label.trim();
  if (!trimmed) throw new ConversationalFlowEditError('An option needs a label.');
  return onOption(config, promptId, index, (option) => {
    option['label'] = trimmed;
  });
}

/** Point an option at another screen. */
export function retargetOption(config: WorkflowConfig, promptId: string, index: number, to: string): WorkflowConfig {
  const flow = requireFlow(config);
  requireScreen(flow, to);
  return onOption(config, promptId, index, (option) => {
    option['value'] = to;
  });
}

/**
 * Offer an option only when a condition holds — or, given `undefined`, always.
 *
 * It stays one option in one list, because that is what it is: the question is
 * the same one, and a line of it appears or it doesn't. The engine filters the
 * list as it asks, so nothing downstream has to know a choice existed — the gate
 * that reads the answer is untouched, and so is where the option leads.
 */
export function setOptionCondition(
  config: WorkflowConfig,
  promptId: string,
  index: number,
  when: Condition | undefined,
): WorkflowConfig {
  if (when) requireCondition(when);
  return onOption(config, promptId, index, (option) => {
    if (when) option['when'] = when as unknown as Rec;
    else delete option['when'];
  });
}

/** Every leaf of a condition must say what it reads and how. */
function requireCondition(when: Condition): void {
  const leaves = leavesOf(when);
  if (leaves.length === 0) throw new ConversationalFlowEditError('A condition needs something to test.');
  for (const leaf of leaves) {
    if (!leaf.variable.trim()) throw new ConversationalFlowEditError('Say which value decides.');
    if (!leaf.operator.trim()) throw new ConversationalFlowEditError('Say how to compare it.');
  }
}

export function moveOption(config: WorkflowConfig, promptId: string, from: number, to: number): WorkflowConfig {
  const flow = requireFlow(config);
  const { screen, prompt } = promptIn(flow, promptId);
  if (from < 0 || from >= prompt.options.length) throw new ConversationalFlowEditError('No such option.');
  const at = Math.max(0, Math.min(to, prompt.options.length - 1));
  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const options = optionList(draft, live, requireScreen(live, screen.id), promptId);
    const [moved] = options.splice(from, 1);
    if (moved) options.splice(at, 0, moved);
  });
}

export function removeOption(config: WorkflowConfig, promptId: string, index: number): WorkflowConfig {
  return onOption(config, promptId, index, undefined, (options, at) => {
    options.splice(at, 1);
  });
}

/**
 * One question's ways back: an option per screen above it, and the first screen
 * last. Generated, so turning it on after a move gives the ways back from where
 * the screen now sits.
 *
 * Private, because "offer the way back" is a property of a screen — see
 * {@link setWayBack}, which is the whole screen's.
 */
function setPromptWayBack(config: WorkflowConfig, promptId: string, on: boolean): WorkflowConfig {
  const flow = requireFlow(config);
  const { screen } = promptIn(flow, promptId);
  if (screen.id === flow.rootScreen) throw new ConversationalFlowEditError('The first screen has nowhere to go back to.');

  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const options = optionList(draft, live, requireScreen(live, screen.id), promptId);
    const kept = options.filter((option) => !isWayBack(live, screen.id, str(asRec(option)['value'])));
    options.splice(0, options.length, ...kept, ...(on ? waysBack(live, requireScreen(live, screen.id)) : []));
  });
}

/**
 * Whether a screen offers the way back: an option per screen above it, and the
 * first screen last.
 *
 * A screen asks with one question or with several, and every one of them carries
 * the ways back — so this is the screen's setting, which is also the only id an
 * author has in hand. A question with nothing to pick from has nowhere to put
 * them, so it is passed over rather than refused.
 */
export function setWayBack(config: WorkflowConfig, screenId: string, on: boolean): WorkflowConfig {
  const flow = requireFlow(config);
  const screen = requireScreen(flow, screenId);
  if (screen.id === flow.rootScreen) throw new ConversationalFlowEditError('The first screen has nowhere to go back to.');

  let next = config;
  for (const asking of [...screen.prompts, ...screen.questions]) {
    if (asking.choiceField === undefined) continue;
    next = setPromptWayBack(next, asking.id, on);
  }
  return next;
}

/** The ways back a screen would offer: each screen above it, the first one last. */
export function waysBack(flow: ConversationalFlow, screen: Screen): Rec[] {
  return wayBackOptions(flow, passedThrough(flow, ancestorsOf(flow, screen.id)));
}

/**
 * Ancestors someone can actually return to.
 *
 * An input screen asks on the way in and then moves on, so it has nothing to
 * show a second time: landing on it again would only read the answer it already
 * has and send them straight back down. Going back goes *past* it.
 */
function passedThrough(flow: ConversationalFlow, ids: string[]): string[] {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  return ids.filter((id) => byId.get(id)?.kind !== 'input');
}

/**
 * The ways back a screen put inside `parentId` would offer — the parent, then
 * whatever the parent goes back to. For building a screen that does not exist
 * yet, and so has no ancestors to ask for.
 */
export function waysBackTo(flow: ConversationalFlow, parentId: string): Rec[] {
  return wayBackOptions(flow, passedThrough(flow, [parentId, ...ancestorsOf(flow, parentId)]));
}

/** How a way back is worded: the first screen by name, everything else with an arrow. */
function wayBackOptions(flow: ConversationalFlow, ids: string[]): Rec[] {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  return ids.map((id) => ({
    label: id === flow.rootScreen ? (mainMenuLabel(flow) ?? byId.get(id)?.title ?? 'Main menu') : `↑ ${byId.get(id)?.title ?? id}`,
    value: id,
  }));
}

export function isWayBack(flow: ConversationalFlow, screenId: string, value: string | undefined): boolean {
  return value !== undefined && ancestorsOf(flow, screenId).includes(value);
}

// ─── Shared with the edits that move screens around ───

/**
 * The live list of options a question offers. Anything that changes options —
 * here, or a screen being added, renamed or removed — goes through this, so the
 * shape of a question is known in one place.
 */
export function optionList(
  config: WorkflowConfig,
  flow: ConversationalFlow,
  screen: Screen,
  promptId: string,
): Rec[] {
  const wait = waitAsking(config, flow, screen, promptId);
  const fields = asArray(asRec(wait?.config['form'])['fields']).map(asRec);
  // By name, because a question may ask for a choice of its own: the field it is
  // navigated by is the one the flow reads, which the layer has already settled.
  const navigates = navigatedBy(screen, promptId);
  const select = fields.find((f) => str(f['name']) === navigates) ?? fields.find((f) => f['type'] === 'select');
  if (!select) throw new ConversationalFlowEditError(`“${screen.title}” doesn’t offer options.`);
  if (!Array.isArray(select['options'])) select['options'] = [];
  return select['options'] as Rec[];
}

/**
 * The WAIT an edit names: the screen's own question, or the one asked on the way
 * in, which sits outside the frame and so outside the screen's own case.
 */
function waitAsking(config: WorkflowConfig, flow: ConversationalFlow, screen: Screen, promptId: string): Step | undefined {
  const entry = caseFor(config, flow, screen);
  const own = entry ? stepIn(partsOf(entry, flow.routeKey).rest, promptId) : undefined;
  if (own) return own;
  if (!screen.questions.some((q) => q.id === promptId) || !screen.hasFrame) return undefined;
  const section = sectionCaseFor(config, flow, screen);
  const asking = section ? partsOf(section, flow.routeKey).asking : undefined;
  return asking?.step.id === promptId ? asking.step : undefined;
}

/** What that question is navigated by, as it was read. */
function navigatedBy(screen: Screen, promptId: string): string | undefined {
  const asked = screen.questions.find((q) => q.id === promptId);
  if (asked) return asked.choiceField;
  return screen.prompts.find((p) => p.id === promptId)?.choiceField;
}

/** Every question a screen asks: its own, and the one asked on the way in. */
export function questionIdsOf(screen: Screen): string[] {
  return [...screen.prompts.map((p) => p.id), ...screen.questions.map((q) => q.id)];
}

/** Take away every option that opened `screenId`, wherever it is offered. */
export function dropOptionsTo(config: WorkflowConfig, flow: ConversationalFlow, screenId: string): void {
  for (const screen of flow.screens) {
    for (const promptId of questionIdsOf(screen)) {
      const options = optionListIfAny(config, flow, screen, promptId);
      if (!options) continue;
      for (let at = options.length - 1; at >= 0; at -= 1) {
        if (asRec(options[at])['value'] === screenId) options.splice(at, 1);
      }
    }
  }
}

/** Rename a screen wherever an option names it, keeping a way back's arrow. */
export function relabelOptionsTo(config: WorkflowConfig, flow: ConversationalFlow, screenId: string, title: string): void {
  for (const screen of flow.screens) {
    for (const promptId of questionIdsOf(screen)) {
      const options = optionListIfAny(config, flow, screen, promptId);
      for (const raw of options ?? []) {
        const option = asRec(raw);
        if (option['value'] !== screenId) continue;
        option['label'] = String(option['label'] ?? '').startsWith('↑ ') ? `↑ ${title}` : title;
      }
    }
  }
}

export function optionListIfAny(config: WorkflowConfig, flow: ConversationalFlow, screen: Screen, promptId: string): Rec[] | undefined {
  try {
    return optionList(config, flow, screen, promptId);
  } catch {
    return undefined;
  }
}

// ─── Plumbing ───

function onOption(
  config: WorkflowConfig,
  promptId: string,
  index: number,
  change?: (option: Rec) => void,
  onList?: (options: Rec[], at: number) => void,
): WorkflowConfig {
  const flow = requireFlow(config);
  const { screen, prompt } = promptIn(flow, promptId);
  if (index < 0 || index >= prompt.options.length) throw new ConversationalFlowEditError('No such option.');
  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const options = optionList(draft, live, requireScreen(live, screen.id), promptId);
    if (onList) onList(options, index);
    else if (change) change(asRec(options[index]));
  });
}

/**
 * The question an edit names, and the screen that asks it — its own, or the one
 * it asks on the way in. Both offer options, so both are edited the same way.
 */
export function promptIn(
  flow: ConversationalFlow,
  promptId: string,
): { screen: Screen; prompt: Pick<Prompt, 'id' | 'options'> } {
  for (const screen of flow.screens) {
    const asking = [...screen.prompts, ...screen.questions].find((p) => p.id === promptId);
    if (asking) return { screen, prompt: asking };
  }
  throw new ConversationalFlowEditError(`There is no question “${promptId}”.`);
}

function requireScreen(flow: ConversationalFlow, id: string): Screen {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new ConversationalFlowEditError(`There is no screen “${id}”.`);
  return screen;
}
