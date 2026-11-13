/**
 * Which screen a step of a run belongs to.
 *
 * The engine addresses every step by the frames it ran inside — the cycles it
 * is in and the case each switch opened:
 *
 *   root:body#3/root_route:case_1#0/payments:body#0/payments_route:case_0#0/ask_payments
 *   └ round 3 of the conversation │ the Payments case │ round 0 of Payments │ its own case │ the question
 *
 * So reading a run is walking the same tree the config is, one frame at a time.
 * Nothing is matched by id or by name: the path says which case, and the case
 * says which screen.
 */
import type { WorkflowConfig } from '../types/workflow-config.js';
import { rootCycle } from './locate.js';
import { caseKind, casesOf, isCycle, partsOf, switchIn } from './shape.js';
import type { ConversationalFlow, Screen } from './types.js';

/** `<switch>:case_<n>#<round>` — a switch, and the case it opened. */
const CASE_FRAME = /^(.+):case_(\d+)#\d+$/;

interface Frame {
  switchId: string;
  caseIndex: number;
}

/** The cases a node path opened, outermost first. */
function framesIn(nodePath: string): Frame[] {
  const out: Frame[] = [];
  for (const segment of nodePath.split('/')) {
    const match = CASE_FRAME.exec(segment);
    if (match) out.push({ switchId: match[1]!, caseIndex: Number(match[2]) });
  }
  return out;
}

/**
 * The screen a step ran for, or undefined when it ran somewhere that is not a
 * screen — a switch's fallback, or a step outside the conversation entirely.
 *
 * A step in a section's case but outside its cycle — what that section fetches
 * on the way in — belongs to the section itself, which is why the walk keeps
 * the last screen it saw rather than insisting on the deepest.
 */
export function screenAtPath(config: WorkflowConfig, flow: ConversationalFlow, nodePath: string): Screen | undefined {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  let cycle = rootCycle(config);
  let screen: Screen | undefined;

  for (const frame of framesIn(nodePath)) {
    const routing = cycle ? switchIn(cycle) : undefined;
    if (!routing || routing.id !== frame.switchId) return screen;
    const entry = casesOf(routing)[frame.caseIndex];
    const kind = entry ? caseKind(entry, flow.routeKey) : null;
    if (!entry || !kind) return screen;

    if (kind.kind === 'screen') return byId.get(kind.screen);
    cycle = partsOf(entry, flow.routeKey).rest.find(isCycle);
    screen = byId.get(cycle?.id ?? '') ?? screen;
  }
  return screen;
}

/**
 * The rounds a step ran in, outermost first — round 2 of the conversation, then
 * round 0 of the section inside it, and so on. Comparing these in order is what
 * puts a run back in the order it happened.
 */
export function roundsIn(nodePath: string): number[] {
  return [...nodePath.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
}
