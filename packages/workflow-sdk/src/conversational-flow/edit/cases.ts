/**
 * Putting a case somewhere, and taking one out.
 *
 * A screen is a case; where that case sits is where the screen is. So the only
 * structural move in the whole layer is lifting a case out of one switch and
 * putting it in another — and the one thing that takes care is that a screen with
 * nothing inside it and a screen with screens inside it are written differently:
 *
 *   a leaf     case eq(screen)      [its calls…, its question]
 *   a section  case any(subtree)    [its calls…, CYCLE [ its own case, its children ]]
 *
 * So giving a leaf its first child promotes it — its steps move inside the new
 * loop unchanged, and its calls with them, which is why promotion changes nothing
 * about what it fetches or when. Taking the last child away demotes it back.
 *
 * Everything that adds, moves or removes anything goes through here, screens and
 * routers alike, so the shape is maintained in one place.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray, asSteps, type Rec } from '../json.js';
import { caseFor, cycleAt, sectionCaseFor } from '../locate.js';
import { carriedTo, inheritedInput } from '../rounds.js';
import { ConversationalFlowEditError } from '../settle.js';
import { caseListIn, caseKind, cycleStep, isCycle, jumpStep, partsOf, screenCase, sectionCase, switchIn, switchStep } from '../shape.js';
import type { ConversationalFlow, Screen } from '../types.js';

/**
 * The switch a screen's children live in — making one if this is the first
 * child, which is what turns a screen into a section.
 */
export function frameFor(
  draft: WorkflowConfig,
  flow: ConversationalFlow,
  screenId: string,
  /**
   * Whether what is going in is a way *out* — a Finish or a hand off. A Message
   * answers and sends people back, so it holds no branch of the conversation;
   * owning the ending it offers is not a branch, and stays allowed.
   */
  opts?: { wayOut?: boolean },
): Rec[] {
  const screen = requireScreen(flow, screenId);
  if (screen.kind === 'message' && opts?.wayOut !== true) {
    throw new ConversationalFlowEditError(
      `“${screen.title}” is a Message — it answers and sends people back. Make it a Menu to put screens inside it.`,
    );
  }
  if (screen.hasFrame) {
    const cycle = cycleAt(draft, [...screen.frames], flow.routeKey);
    const routing = cycle ? switchIn(cycle) : undefined;
    if (!routing) throw new ConversationalFlowEditError(`“${screen.title}” has nowhere to hold a screen.`);
    return caseListIn(routing);
  }

  return promote(draft, flow, screen);
}

/**
 * Give a screen room beneath it: its own case, steps and all, moves inside a new
 * loop. Its calls go with it, which is why this changes nothing about what it
 * fetches or when.
 */
export function promote(draft: WorkflowConfig, flow: ConversationalFlow, screen: Screen): Rec[] {
  const own = caseFor(draft, flow, screen);
  const holder = holderOf(draft, flow, screen);
  if (!own || !holder) throw new ConversationalFlowEditError(`“${screen.title}” is not somewhere a screen can go.`);
  const at = holder.findIndex((entry) => entry === own);
  const routing = switchStep(`${screen.id}_route`, [screenCase(screen.id, screen.title, asArray(own['steps']), flow.routeKey)], [
    jumpStep(`${screen.id}_unknown`, flow.rootScreen, carriedTo(draft, flow, flow.rootScreen)),
  ]);
  holder.splice(at, 1, sectionCase([screen.id], screen.title, [cycleStep(screen.id, inheritedInput(draft, flow), [routing])], flow.routeKey));
  return caseListIn(routing);
}

/** Take a screen's case out of the switch it sits in, demoting its parent if it was the last. */
export function lift(draft: WorkflowConfig, flow: ConversationalFlow, screenId: string): Rec {
  const screen = requireScreen(flow, screenId);
  const holder = holderOf(draft, flow, screen);
  if (!holder) throw new ConversationalFlowEditError(`“${screen.title}” is not in a switch.`);
  const own = screen.hasFrame ? sectionCaseFor(draft, flow, screen) : caseFor(draft, flow, screen);
  const at = holder.findIndex((entry) => entry === own);
  if (at < 0) throw new ConversationalFlowEditError(`“${screen.title}” is not where it says it is.`);
  const [lifted] = holder.splice(at, 1);
  // Emptying a Menu leaves a Menu. Its room is the author's to take away, with
  // `setScreenType`, not something that disappears because the last screen left.
  return lifted!;
}

/** Take a screen's room away again: its loop comes off, its steps stay. */
export function demote(draft: WorkflowConfig, flow: ConversationalFlow, screen: Screen): void {
  const section = sectionCaseFor(draft, flow, screen);
  const holder = holderOf(draft, flow, screen);
  if (!section || !holder) return;
  const cycle = partsOf(section, flow.routeKey).rest.find(isCycle);
  const routing = cycle ? switchIn(cycle) : undefined;
  if (!routing) return;
  const own = caseListIn(routing).find((entry) => {
    const kind = caseKind(entry, flow.routeKey);
    return kind?.kind === 'screen' && kind.screen === screen.id;
  });
  if (!own) return;
  // Whatever the section itself fetched now belongs to the screen it was.
  const calls = partsOf(section, flow.routeKey).calls.map((c) => c.step);
  const at = holder.findIndex((entry) => entry === section);
  holder.splice(at, 1, screenCase(screen.id, screen.title, [...calls, ...asSteps(own['steps'])], flow.routeKey));
}

/** The list of cases a screen's own case sits in. */
function holderOf(draft: WorkflowConfig, flow: ConversationalFlow, screen: Screen): Rec[] | undefined {
  const frames = screen.hasFrame ? screen.frames.slice(0, -1) : screen.frames;
  if (frames.length === 0) return undefined;
  const cycle = cycleAt(draft, frames, flow.routeKey);
  const routing = cycle ? switchIn(cycle) : undefined;
  return routing ? caseListIn(routing) : undefined;
}

function requireScreen(flow: ConversationalFlow, id: string): Screen {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new ConversationalFlowEditError(`There is no screen “${id}”.`);
  return screen;
}
