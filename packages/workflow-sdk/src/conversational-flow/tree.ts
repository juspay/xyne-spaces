/**
 * The tree, now that the config is one: walking it is walking the screens'
 * `parent` and `children`, which the reader took from where their cases sit.
 */
import { optionsOf, type ConversationalFlow, type Screen } from './types.js';

/** A screen's ancestors, nearest first. */
export function ancestorsOf(flow: ConversationalFlow, id: string): string[] {
  const parent = new Map(flow.screens.map((s) => [s.id, s.parent]));
  const out: string[] = [];
  for (let at = parent.get(id); at !== undefined; at = parent.get(at)) out.push(at);
  return out;
}

/** A screen and everything under it, in the order the switches list them. */
/**
 * Outside the menu: a router, an ending, a hand off.
 *
 * Every screen can lead to one, so where they sit in the config says nothing
 * about where they belong in the menu — which is why the map draws them apart
 * rather than as children of whichever frame happens to hold them.
 */
export function outsideMenu(screen: Screen): boolean {
  return screen.kind === 'router' || screen.kind === 'end' || screen.kind === 'handoff';
}

/**
 * The screens inside each screen, in the order its switch lists them — the same
 * `children` every screen already carries, gathered once for drawing the tree.
 */
export function childrenOf(flow: ConversationalFlow): Map<string, Screen[]> {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  const out = new Map<string, Screen[]>();
  for (const screen of flow.screens) {
    const kids = screen.children.map((id) => byId.get(id)).filter((s): s is Screen => s !== undefined);
    if (kids.length > 0) out.set(screen.id, kids);
  }
  return out;
}

export function subtreeOf(flow: ConversationalFlow, id: string): string[] {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  const out: string[] = [];
  const visit = (at: string): void => {
    out.push(at);
    for (const child of byId.get(at)?.children ?? []) visit(child);
  };
  visit(id);
  return out;
}

/** Screens depth-first from the first one, the way an outline reads. */
export function treeOrder(flow: ConversationalFlow): Screen[] {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  return subtreeOf(flow, flow.rootScreen)
    .map((id) => byId.get(id))
    .filter((s): s is Screen => s !== undefined);
}

/**
 * "Payments › Charges › Charged twice" — how the flow words where someone is.
 *
 * The first screen is left out: it is the conversation, not a place inside it.
 */
export function breadcrumb(flow: ConversationalFlow, screen: Screen): string {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  const chain = [...[...ancestorsOf(flow, screen.id)].reverse(), screen.id];
  const titles = chain.filter((id) => id !== flow.rootScreen).map((id) => byId.get(id)?.title ?? id);
  return titles.length > 0 ? titles.join(' › ') : screen.title;
}

/**
 * How this flow words going back to the first screen — "Main menu", usually —
 * taken from wherever it already says it, so nothing invents a second wording.
 */
export function mainMenuLabel(flow: ConversationalFlow): string | undefined {
  for (const screen of flow.screens) {
    const option = optionsOf(screen).find((o) => o.back && o.to.kind === 'screen' && o.to.screen === flow.rootScreen);
    if (option) return option.label;
  }
  return undefined;
}
