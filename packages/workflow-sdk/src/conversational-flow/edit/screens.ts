/**
 * Adding, naming, moving and removing screens.
 *
 * A screen is a case; where that case sits is where the screen is, and putting a
 * case somewhere is `cases.ts`'s job. What is left here is what an author means
 * by adding, naming, moving or removing a screen: which options follow it, and
 * what a new one asks.
 *
 * Everything derived — the subtrees each section claims, where each jump is
 * aimed, the headings — is `settle`'s, and runs after every one of these.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asRec, asSteps, type Rec } from '../json.js';
import { caseFor, sectionCaseFor } from '../locate.js';
import { routersFor } from '../routers.js';
import { ConversationalFlowEditError, requireFlow, settle } from '../settle.js';
import { screenCase } from '../shape.js';
import { subtreeOf } from '../tree.js';
import { stepsForKind } from './build.js';
import type { NewScreenType } from './kinds.js';
import { frameFor, lift, promote } from './cases.js';
import { copyWithFreshIds, idsIn } from './clone.js';
import {
  dropOptionsTo,
  optionList,
  optionListIfAny,
  relabelOptionsTo,
  removeOption,
  retargetOption,
  setWayBack,
  waysBackTo,
} from './options.js';
import type { ConversationalFlow, Screen } from '../types.js';

export interface NewScreen {
  title: string;
  /** The screen it goes inside. */
  parent: string;
  /** What kind of screen it is. A plain one that asks, unless another is named. */
  type?: NewScreenType;
  /** Its id, when the caller wants to choose one; otherwise made from the title. */
  id?: string;
  /** The agent an Ask AI screen asks. */
  agentSlug?: string;
}

/**
 * Put a new screen inside `parent`, and give the parent an option that opens it.
 *
 * Its question is modelled on one the flow already has, so the field names and
 * the way typed text is handled stay whatever this flow uses.
 */
export function addScreen(config: WorkflowConfig, args: NewScreen): { config: WorkflowConfig; screenId: string } {
  const flow = requireFlow(config);
  const parent = requireScreen(flow, args.parent);
  refuseAsAParent(parent);

  const title = args.title.trim();
  if (!title) throw new ConversationalFlowEditError('A screen needs a name.');
  const screenId = unique(args.id ?? slug(title), new Set(flow.screens.map((s) => s.id)));

  const next = settle(config, (draft) => {
    const at = requireFlow(draft);
    const holder = frameFor(draft, at, args.parent, { wayOut: args.type === 'end' || args.type === 'handoff' });
    const parent = requireScreen(at, args.parent);
    const built = newScreenSteps(draft, at, screenId, title, parent, args);
    holder.push(screenCase(screenId, title, built, at.routeKey));
    // A Menu is created with its room already there, so screens can go inside it
    // straight away; a Message is created without any, and stays that way until
    // someone asks for it.
    if (args.type === 'menu') {
      const made = requireFlow(draft);
      promote(draft, made, requireScreen(made, screenId));
    }
    const settled = requireFlow(draft);
    offerOn(draft, settled, args.parent, { label: title, value: screenId });
  });
  return { config: next, screenId };
}

/**
 * Copy a screen — its wording, options and where they lead — not the screens
 * beneath it; those stay where they are and the copy reaches them the same way
 * the original did.
 *
 * `as: 'sibling'` (the default) puts the copy beside the original, inside the
 * same screen, and links it from there. `as: 'child'` puts it inside the
 * original, which promotes a leaf into a section exactly as adding a screen
 * would. Either way the copy is a case of its own: every step inside it takes a
 * new id, and every `{{steps.…}}` reference between them moves with it, so
 * nothing collides with the screen it came from.
 */
export function duplicateScreen(
  config: WorkflowConfig,
  screenId: string,
  opts?: { as?: 'sibling' | 'child' },
): { config: WorkflowConfig; screenId: string } {
  const as = opts?.as ?? 'sibling';
  const flow = requireFlow(config);
  const screen = requireScreen(flow, screenId);
  if (screen.kind === 'router') throw new ConversationalFlowEditError('A router decides where typed messages go; a flow has just one.');

  // Where the copy is linked from: the screen itself for a child, its parent
  // for a sibling.
  const linkFrom = as === 'child' ? screen.id : screen.parent;
  if (as === 'sibling' && screen.id === flow.rootScreen) {
    throw new ConversationalFlowEditError('The first screen is the conversation; a copy of it beside itself would have nowhere to be reached from.');
  }
  if (!linkFrom) throw new ConversationalFlowEditError(`Nothing leads to “${screen.title}”, so a copy would be unreachable.`);

  // Whatever links the copy has to be able to offer it. `offerOn` leaves a
  // screen that asks nothing alone, which would leave the copy unreachable —
  // so it is refused here rather than made and orphaned.
  const from = requireScreen(flow, linkFrom);
  if (from.kind === 'end') throw new ConversationalFlowEditError(`“${from.title}” ends the conversation, so nothing can follow it.`);
  if (!from.prompts[0] || from.prompts[0].options.length === 0) {
    throw new ConversationalFlowEditError(`“${from.title}” doesn’t offer options, so it can’t lead to a copy.`);
  }

  const title = `${screen.title} copy`;
  const newId = unique(slug(title), new Set(flow.screens.map((s) => s.id)));

  const next = settle(config, (draft) => {
    const at = requireFlow(draft);
    const source = caseFor(draft, at, requireScreen(at, screenId));
    if (!source) throw new ConversationalFlowEditError(`“${screen.title}” is not somewhere a screen can be copied from.`);
    // Taken before the holder is asked for: making a leaf hold screens moves the
    // original's case into a new loop, and the copy is of what it was.
    const steps = copyWithFreshIds(asSteps(source['steps']), newId, idsIn(draft.steps));

    const holder = frameFor(draft, requireFlow(draft), linkFrom);
    holder.push(screenCase(newId, title, steps as unknown as unknown[], at.routeKey));

    // The flow is read again: promotion may have moved the screen we link from.
    offerOn(draft, requireFlow(draft), linkFrom, { label: title, value: newId });
  });
  return { config: next, screenId: newId };
}

/**
 * Put a new screen into the path above `screenId`: whatever used to open that
 * screen now opens the new one, and the new one opens it.
 *
 * In a tree "above" is not the previous link in a chain — it is a step inserted
 * between a screen and the screen that leads to it. So the old screen, and
 * everything beneath it, moves inside the new one: the map then draws the path
 * the conversation actually takes.
 *
 * Built from the edits an author could make by hand — add a screen, point the
 * parent's option at it, move the old screen inside, offer it there — so each
 * part is the real operation and `settle` re-derives the jumps after every one.
 * What this adds is that the sequence, and its guards, live in one place.
 *
 * There is no kind to choose: a kind is read from the shape, and this screen
 * ends up holding the one below it, so it is a menu by construction.
 */
export function insertScreenAbove(
  config: WorkflowConfig,
  screenId: string,
  args: { title: string },
): { config: WorkflowConfig; screenId: string } {
  const flow = requireFlow(config);
  const below = requireScreen(flow, screenId);
  if (below.id === flow.rootScreen) {
    throw new ConversationalFlowEditError('The first screen is where every conversation starts; nothing can come before it.');
  }
  const parentId = below.parent;
  if (!parentId) {
    throw new ConversationalFlowEditError(`Nothing leads to “${below.title}”, so there is no path to insert into.`);
  }
  const title = args.title.trim();
  if (!title) throw new ConversationalFlowEditError('A screen needs a name.');

  const parentPrompt = requireScreen(flow, parentId).prompts[0];
  if (!parentPrompt) throw new ConversationalFlowEditError(`“${requireScreen(flow, parentId).title}” doesn’t offer options.`);

  const made = addScreen(config, { title, parent: parentId, type: 'menu' });
  let next = made.config;
  const inserted = made.screenId;

  const optionsOn = (c: WorkflowConfig, holder: string) => {
    const live = requireFlow(c);
    const prompt = requireScreen(live, holder).prompts[0];
    return prompt ? { promptId: prompt.id, options: prompt.options } : undefined;
  };

  // The parent already had an option opening the old screen — the author's own
  // wording, in its own place in the menu. That option is what now opens the new
  // screen; the plain one `addScreen` added goes, so nothing written is lost.
  const parentOptions = optionsOn(next, parentId);
  if (parentOptions) {
    const plain = parentOptions.options.findIndex((o) => o.to.kind === 'screen' && o.to.screen === inserted);
    if (plain !== -1) next = removeOption(next, parentOptions.promptId, plain);
    const live = optionsOn(next, parentId);
    const written = live?.options.findIndex((o) => !o.back && o.to.kind === 'screen' && o.to.screen === screenId) ?? -1;
    if (live && written !== -1) next = retargetOption(next, live.promptId, written, inserted);
  }

  // The old screen, and everything under it, moves inside the new one, and
  // `moveScreen` carries the way in with it — so the new screen offers the old
  // one as soon as it holds it, which is how anyone reaches it now.
  next = moveScreen(next, screenId, inserted);

  return { config: next, screenId: inserted };
}

/** What the screen is called. Its id is what other things name it by, and stays. */
export function renameScreen(config: WorkflowConfig, screenId: string, title: string): WorkflowConfig {
  const trimmed = title.trim();
  if (!trimmed) throw new ConversationalFlowEditError('A screen needs a name.');
  const flow = requireFlow(config);
  requireScreen(flow, screenId);
  return settle(config, (draft) => {
    const at = requireFlow(draft);
    const screen = requireScreen(at, screenId);
    const own = caseFor(draft, at, screen);
    if (own) own['label'] = trimmed;
    const section = screen.hasFrame ? sectionCaseFor(draft, at, screen) : undefined;
    if (section) section['label'] = trimmed;
    relabelOptionsTo(draft, at, screenId, trimmed);
  });
}

/**
 * Why a screen cannot move into another, or `undefined` when it can. Asked in
 * one place so a destination the editor offers is one the move accepts; a list
 * built from its own copy of these rules would drift from the edit.
 *
 * Moving a screen into the one it is already inside is not refused — it is the
 * place it is already in, and the move simply has nothing to do.
 */
function whyMoveIsRefused(flow: ConversationalFlow, screenId: string, parentId: string): string | undefined {
  const screen = flow.screens.find((s) => s.id === screenId);
  const parent = flow.screens.find((s) => s.id === parentId);
  if (!screen) return `There is no screen “${screenId}”.`;
  if (!parent) return `There is no screen “${parentId}”.`;
  if (screen.id === flow.rootScreen) return 'The first screen is the conversation; it cannot move.';
  if (parent.kind !== 'menu') return `“${parent.title}” can’t hold screens — only a Menu can.`;
  if (subtreeOf(flow, screenId).includes(parentId)) {
    return `“${parent.title}” is inside “${screen.title}”, so it cannot also hold it.`;
  }
  return undefined;
}

/** Whether a screen can move into another — what `moveScreen` would say. */
export function moveIsValid(flow: ConversationalFlow, screenId: string, parentId: string): boolean {
  return whyMoveIsRefused(flow, screenId, parentId) === undefined;
}

/** Move a screen, and everything inside it, into another screen. */
export function moveScreen(config: WorkflowConfig, screenId: string, parentId: string): WorkflowConfig {
  const flow = requireFlow(config);
  const screen = requireScreen(flow, screenId);
  const refused = whyMoveIsRefused(flow, screenId, parentId);
  if (refused) throw new ConversationalFlowEditError(refused);
  if (screen.parent === parentId) return config;

  let next = settle(config, (draft) => {
    // The option that opened it moves too, wording and condition and all: a
    // screen people reach by tapping is still reached by tapping afterwards,
    // from whatever now holds it. Taken before the case is lifted, because
    // lifting is what makes the old parent stop being its parent.
    const taken = screen.parent ? takeOptionOff(draft, requireFlow(draft), screen.parent, screenId) : undefined;
    const lifted = lift(draft, requireFlow(draft), screenId);
    frameFor(draft, requireFlow(draft), parentId).push(lifted);
    offerOn(draft, requireFlow(draft), parentId, taken ?? { label: screen.title, value: screenId });
  });

  // A way back is generated from where a screen sits, and everything here just
  // moved. Each screen that offered them gets them again, now going through the
  // new parent; one that had them turned off stays that way.
  for (const id of subtreeOf(requireFlow(next), screenId)) {
    const moved = requireFlow(next).screens.find((s) => s.id === id);
    if (moved?.prompts.some((p) => p.options.some((o) => o.back))) next = setWayBack(next, id, true);
  }
  return next;
}

/** Where everything inside a screen goes when it is emptied out. */
export type Emptying = { kind: 'into'; screen: string } | { kind: 'delete' };

/**
 * Take everything inside a screen out of it — into another screen, or away for
 * good.
 *
 * This is the answer to the refusals: a section cannot stop being one while it
 * still holds screens, and the two honest things to do about that are to put
 * them somewhere else or to say they are not wanted. Both are spelled out here
 * rather than folded into the conversions, so removing a screen and changing
 * what kind it is can offer the author the same choice.
 */
export function emptyScreen(config: WorkflowConfig, screenId: string, where: Emptying): WorkflowConfig {
  const flow = requireFlow(config);
  const screen = requireScreen(flow, screenId);
  if (screen.children.length === 0) return config;

  if (where.kind === 'delete') {
    let next = config;
    // Deepest first: a screen that still holds screens cannot be removed, and
    // reversing the outline order puts every child before whatever holds it.
    for (const id of subtreeOf(flow, screenId).slice(1).reverse()) next = removeScreen(next, id);
    return next;
  }

  const into = requireScreen(flow, where.screen);
  if (subtreeOf(flow, screenId).includes(into.id)) {
    throw new ConversationalFlowEditError(
      `“${into.title}” is inside “${screen.title}”, so it cannot hold what comes out of it.`,
    );
  }
  // Asked of every one of them before any of them moves, so a destination that
  // suits some and not others is refused outright instead of half applied.
  for (const id of screen.children) {
    const refused = whyMoveIsRefused(flow, id, into.id);
    if (refused) throw new ConversationalFlowEditError(refused);
  }

  let next = config;
  for (const id of screen.children) next = moveScreen(next, id, into.id);
  return next;
}

/**
 * Remove a screen, and the options that opened it. A screen with screens inside
 * it is refused: they would go with it, and that is a different decision.
 */
export function removeScreen(config: WorkflowConfig, screenId: string): WorkflowConfig {
  const flow = requireFlow(config);
  const screen = requireScreen(flow, screenId);
  if (screen.id === flow.rootScreen) throw new ConversationalFlowEditError('The first screen can’t be removed.');
  if (screen.children.length > 0) {
    throw new ConversationalFlowEditError(
      `Move what is inside “${screen.title}” somewhere else first — ${screen.children.length === 1 ? 'it would go' : 'they would go'} with it.`,
    );
  }
  return settle(config, (draft) => {
    const at = requireFlow(draft);
    lift(draft, at, screenId);
    dropOptionsTo(draft, requireFlow(draft), screenId);
  });
}

/**
 * What a new screen is made of. A screen that asks is the common case; every
 * other kind is built the same way `setScreenType` builds it, so a screen
 * created as a Finish and a screen turned into one are the same screen.
 */
export function newScreenSteps(
  draft: WorkflowConfig,
  flow: ConversationalFlow,
  screenId: string,
  title: string,
  parent: Screen,
  args: NewScreen,
): unknown[] {
  const nearest = routersFor(flow, parent.id)[0];
  return stepsForKind(draft, flow, args.type, {
    screenId,
    title,
    prompt: '',
    options: waysBackTo(flow, parent.id),
    // Typing goes wherever typing goes from the screen it sits in.
    ...(nearest ? { router: nearest.id } : {}),
    ...(args.agentSlug ? { agentSlug: args.agentSlug } : {}),
  });
}

/**
 * Whether a screen can hold another, and why not when it cannot.
 *
 * One rule, asked by everything that puts a screen inside another, so the map,
 * the inspector and every edit agree about where something may go.
 */
export function refuseAsAParent(parent: Screen): void {
  if (parent.kind === 'router') {
    throw new ConversationalFlowEditError('A router decides where typed messages go; nothing sits inside it.');
  }
  if (parent.kind === 'end') {
    throw new ConversationalFlowEditError(`“${parent.title}” ends the conversation, so nothing follows it.`);
  }
  if (parent.kind === 'input') {
    throw new ConversationalFlowEditError(`Answering “${parent.title}” opens the one screen inside it; branch from there instead.`);
  }
}

/** Take the option that opens `screenId` off `holderId`, and hand it back. */
function takeOptionOff(draft: WorkflowConfig, flow: ConversationalFlow, holderId: string, screenId: string): Rec | undefined {
  const holder = flow.screens.find((s) => s.id === holderId);
  if (!holder) return undefined;
  for (const prompt of holder.prompts) {
    const options = optionListIfAny(draft, flow, holder, prompt.id);
    if (!options) continue;
    const at = options.findIndex((o) => asRec(o)['value'] === screenId && asRec(o)['back'] !== true);
    if (at !== -1) return options.splice(at, 1)[0];
  }
  return undefined;
}

/** Give the parent an option that opens the new screen, above its ways back. */
export function offerOn(draft: WorkflowConfig, flow: ConversationalFlow, screenId: string, option: Rec): void {
  const screen = requireScreen(flow, screenId);
  const asking = screen.prompts[0];
  if (!asking) return;
  const options = optionList(draft, flow, screen, asking.id);
  const firstBack = asking.options.findIndex((o) => o.back);
  options.splice(firstBack === -1 ? options.length : firstBack, 0, option);
}

// ─── Plumbing ───

function requireScreen(flow: ConversationalFlow, id: string): Screen {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new ConversationalFlowEditError(`There is no screen “${id}”.`);
  return screen;
}

function unique(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base}_${n}`;
  return name;
}

function slug(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'screen';
}
