/**
 * Finding a screen's case in the config, by the frames it sits inside.
 *
 * `screen.frames` is the path of cycles around it, so walking those cycles is
 * the whole of it — no searching, and no id conventions.
 */
import type { WorkflowConfig } from '../types/workflow-config.js';
import { asSteps, type Rec, type Step } from './json.js';
import { caseKind, casesOf, isCycle, partsOf, switchIn } from './shape.js';
import type { ConversationalFlow, Screen } from './types.js';

/** The cycle the conversation itself is. */
export function rootCycle(config: WorkflowConfig): Step | undefined {
  return asSteps(config.steps).find(isCycle);
}

/** The cycle named by the last of `frames`, walking down from the conversation. */
export function cycleAt(config: WorkflowConfig, frames: readonly string[], routeKey: string): Step | undefined {
  let cycle = rootCycle(config);
  if (!cycle || cycle.id !== frames[0]) return undefined;
  for (const frame of frames.slice(1)) {
    const routing = switchIn(cycle);
    if (!routing) return undefined;
    const next = casesOf(routing)
      .filter((entry) => caseKind(entry, routeKey)?.kind === 'section')
      .map((entry) => partsOf(entry, routeKey).rest.find(isCycle))
      .find((inner) => inner?.id === frame);
    if (!next) return undefined;
    cycle = next;
  }
  return cycle;
}

/** The case that holds one screen: its steps are what that screen is. */
export function caseFor(config: WorkflowConfig, flow: ConversationalFlow, screen: Screen): Rec | undefined {
  const cycle = cycleAt(config, screen.frames, flow.routeKey);
  if (!cycle) return undefined;
  const routing = switchIn(cycle);
  if (!routing) return undefined;
  return casesOf(routing).find((entry) => {
    const kind = caseKind(entry, flow.routeKey);
    return kind?.kind === 'screen' && kind.screen === screen.id;
  });
}

/**
 * The case that holds a section: its condition is the section's subtree, and
 * its steps are the section's calls and its cycle. It sits in the switch of the
 * frame above, which is where a section is reached from.
 */
export function sectionCaseFor(config: WorkflowConfig, flow: ConversationalFlow, screen: Screen): Rec | undefined {
  const above = screen.frames.slice(0, -1);
  if (above.length === 0) return undefined;
  const cycle = cycleAt(config, above, flow.routeKey);
  const routing = cycle ? switchIn(cycle) : undefined;
  if (!routing) return undefined;
  return casesOf(routing).find((entry) => {
    const kind = caseKind(entry, flow.routeKey);
    return kind?.kind === 'section' && partsOf(entry, flow.routeKey).rest.find(isCycle)?.id === screen.id;
  });
}

/**
 * The innermost frame that holds both ends — where a jump between them
 * belongs, so that leaving one does not unwind more than it has to.
 *
 * Takes frame paths rather than screens, because a call on a section sits
 * outside that section's own cycle and so is enclosed by one frame fewer.
 */
export function commonFrame(from: readonly string[], to: readonly string[]): string {
  let shared = from[0] ?? '';
  for (let at = 0; at < Math.min(from.length, to.length); at += 1) {
    if (from[at] !== to[at]) break;
    shared = from[at]!;
  }
  return shared;
}
