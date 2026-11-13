/**
 * Where what someone types goes.
 *
 * A screen's question carries its own answer to that: the jump in its typed
 * branch names a router. It is authored, not derived — one screen inside Payments
 * may keep its typing in Payments while its neighbour asks the router at the top,
 * and a rule that recomputed it would erase that exception on the next edit.
 *
 * What *is* derived is validity. A router only serves the screens its own frame
 * encloses, so a screen that moves out of a section can end up naming a router
 * that is no longer above it. `repairTypedRouting` fixes exactly those, and
 * leaves every valid choice as the author left it.
 */
import type { WorkflowConfig } from '../types/workflow-config.js';
import { asArray, asRec } from './json.js';
import { caseFor } from './locate.js';
import { carriedTo, textKeyOf } from './rounds.js';
import { routersFor } from './routers.js';
import { jumpsIn, partsOf, typedGatesIn } from './shape.js';
import type { ConversationalFlow } from './types.js';

/** Aim every typed jump on a screen at `routerId`, keeping what it carries. */
export function pointTypingAt(draft: WorkflowConfig, flow: ConversationalFlow, screenId: string, routerId: string): void {
  const screen = flow.screens.find((s) => s.id === screenId);
  if (!screen || screen.kind === 'router') return;
  const entry = caseFor(draft, flow, screen);
  if (!entry) return;
  const text = textKeyOf(draft, flow);

  for (const gate of typedGatesIn(partsOf(entry, flow.routeKey).rest)) {
    for (const jump of jumpsIn(asArray(gate.config['if_true']))) {
      const typed = asRec(jump.config['with'])[text];
      jump.config['with'] = { ...carriedTo(draft, flow, routerId), ...(typed !== undefined ? { [text]: typed } : {}) };
      jump.config['target'] = flow.rootScreen;
    }
  }
}

/**
 * Send typing somewhere it can actually be read, where it cannot be now.
 *
 * Only a screen that names a *router* is repaired, and only when that router has
 * gone or is no longer above it — a screen moved out of the section it was scoped
 * to. Everything else is left exactly as the author left it:
 *
 * - typing answered by an agent, which names no screen at all (an Ask AI screen);
 * - typing aimed at an ordinary screen, which is a choice and not a mistake;
 * - a screen with no router above it, which keeps what it has rather than being
 *   aimed at something that cannot read it.
 */
export function repairTypedRouting(draft: WorkflowConfig, flow: ConversationalFlow): void {
  for (const screen of flow.screens) {
    if (screen.kind === 'router') continue;
    const to = screen.prompts.find((p) => p.freeText)?.freeText;
    if (to?.kind !== 'screen') continue;

    const named = flow.screens.find((s) => s.id === to.screen);
    if (named && named.kind !== 'router') continue;
    const reachable = routersFor(flow, screen.id);
    if (named && reachable.some((r) => r.id === named.id)) continue;
    const nearest = reachable[0];
    if (nearest) pointTypingAt(draft, flow, screen.id, nearest.id);
  }
}
