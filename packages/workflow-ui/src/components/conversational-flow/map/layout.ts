/**
 * Where each card goes on the map. Pure and deterministic: the same flow and
 * fold state always give the same picture, so nothing about positions is stored
 * and nobody drags boxes around.
 *
 * A tree that grows left→right (`right`, the default) or top→bottom (`down`).
 * Every depth is one row (or column), as deep as its biggest card, so the
 * levels of the conversation line up. Across it, each screen owns a band as
 * wide as its own card or its visible subtree, whichever is wider, and sits
 * centred in it — so sibling subtrees never overlap and a parent lines up with
 * its children.
 *
 * Lines are drawn only where they explain something: to a screen beneath
 * (`child`) or across the tree (`jump`). The way back and typed-text routing
 * are shown on the cards themselves, not as lines.
 *
 * Every lookup is a node, in front of whatever it feeds. That is the whole point
 * of drawing a tree: where a node sits says when it runs, so a lookup drawn
 * before a screen has already said "this was fetched first" — no box, no chip
 * and no second way of saying it.
 *
 * Endings and hand offs sit outside the menu tree — any screen may lead to one,
 * so none of them has a parent. True of the menu, unhelpful in a picture: an
 * ending exactly one screen leads to is that branch's own ending and belongs
 * beside it. So the drawing adopts those, and leaves the shared ways out
 * ("That's all", reached from everywhere) in a row beneath, where twenty lines
 * would only tangle.
 */
import { type Call, type ConversationalFlow, optionsOf, outsideMenu, type Screen, waysOn } from '@xyne/workflow-sdk/conversational-flow';

export const CARD_WIDTH = 264;
const OUTSIDE_GAP = 96;

/** Which way the conversation reads: each step deeper goes down, or right. */
export type MapDirection = 'down' | 'right';

/** `depth`: between one level and the next. `sibling`: between neighbouring subtrees. */
const GAPS: Record<MapDirection, { depth: number; sibling: number }> = {
  down: { depth: 72, sibling: 28 },
  right: { depth: 96, sibling: 20 },
};

/** Card anatomy, shared with the card components so drawing and layout agree. */
export const CARD = {
  header: 40,
  message: 54,
  row: 30,
  chips: 34,
  footer: 30,
  padding: 8,
} as const;

export interface CardBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** How many screens are hidden beneath this card because it is folded. */
  hiddenBelow: number;
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  /**
   * Where the line leaves: an option row (`<promptId>:<index>`) or `card` when
   * the map reads left→right; always the card's `bottom` when it reads down,
   * where children sit in the order their options are listed.
   */
  handle: string;
  kind: 'child' | 'jump';
}

/** A card on the map: a screen, or something fetched in front of one. */
export type MapNode = { kind: 'screen'; screen: Screen } | { kind: 'call'; call: Call; owner: Screen };

export interface MapLayout {
  cards: CardBox[];
  edges: MapEdge[];
  width: number;
  height: number;
  /** What each card is, by id — a screen, or a lookup in front of one. */
  nodes: Map<string, MapNode>;
  /** Owner screen → the endings drawn beneath it, so cards agree with lines. */
  owned: Map<string, Screen[]>;
}

/**
 * The rows a card draws: where someone goes on from this screen.
 *
 * A screen that asks for something goes on by being answered, so its row is the
 * screen inside it — which is what joins it to the rest of the map.
 */
export function forwardRows(screen: Screen): Array<{ label: string; handle: string; to: string | undefined }> {
  // A hand off can be sent anywhere; drawing that would be a line to every card.
  if (screen.kind === 'handoff') return [];
  const prompt = screen.prompts[0];
  return waysOn(screen).map((o, i) => ({
    label: o.label,
    handle: prompt ? `${prompt.id}:${i}` : `${screen.id}:on`,
    to: o.to.kind === 'screen' ? o.to.screen : undefined,
  }));
}

/** A lookup's card: its name, and the address it calls under it. */
export const CALL_CARD_HEIGHT = CARD.header + CARD.row + CARD.padding;

export function cardSize(node: MapNode, folded: boolean, childCount: number): { w: number; h: number } {
  if (node.kind === 'call') return { w: CARD_WIDTH, h: CALL_CARD_HEIGHT };
  const screen = node.screen;
  const hasBack = optionsOf(screen).some((o) => o.back);
  let h = CARD.header + CARD.padding;
  switch (screen.kind) {
    case 'menu':
    case 'message':
    // What it asks for is drawn as its message; its one row is the way on.
    case 'input':
      h += CARD.message + forwardRows(screen).length * CARD.row + (hasBack ? CARD.chips : 0);
      break;
    case 'ask-ai':
      h += CARD.message + CARD.row + (hasBack ? CARD.chips : 0);
      break;
    case 'end':
      // Room for the farewell, when it has one.
      h += (screen.endMessage ? CARD.message : 0) + CARD.row;
      break;
    case 'handoff':
    case 'router':
    case 'custom':
      h += CARD.row;
      break;
  }
  if (folded && childCount > 0) h += CARD.footer;
  return { w: CARD_WIDTH, h };
}

/**
 * The chain in front of a screen: what it fetches, in the order it fetches it,
 * then the screen itself. A line from the parent arrives at the first of those,
 * which is what makes a lookup read as "before".
 */
export function chainOf(screen: Screen): string[] {
  return [...screen.calls.map((c) => c.id), screen.id];
}

/** Every card on the map: screens, and the lookups that run in front of them. */
export function mapNodes(flow: ConversationalFlow): Map<string, MapNode> {
  const out = new Map<string, MapNode>();
  for (const screen of flow.screens) {
    out.set(screen.id, { kind: 'screen', screen });
    for (const call of screen.calls) out.set(call.id, { kind: 'call', call, owner: screen });
  }
  return out;
}

export function layoutFlow(
  flow: ConversationalFlow,
  folded: ReadonlySet<string> = new Set(),
  direction: MapDirection = 'right',
): MapLayout {
  const down = direction === 'down';
  const gap = GAPS[direction];
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  const owned = ownedExits(flow);
  const children = withOwnedExits(orderedChildren(flow), owned, flow);
  const root = byId.get(flow.rootScreen);
  const cards: CardBox[] = [];
  const placed = new Map<string, CardBox>();

  const nodes = mapNodes(flow);
  /** The head of a screen's chain: what it fetches first, or the screen itself. */
  const headOf = (id: string) => chainOf(byId.get(id) ?? ({ calls: [], id } as unknown as Screen))[0]!;

  /**
   * What follows a card: a lookup is followed by the next lookup and then by the
   * screen it feeds; a screen by the screens inside it, each entered through
   * whatever it fetches on the way in.
   */
  const kidsOf = (id: string): string[] => {
    const node = nodes.get(id);
    if (!node) return [];
    if (node.kind === 'call') {
      const chain = chainOf(node.owner);
      return [chain[chain.indexOf(id) + 1]!];
    }
    if (folded.has(id)) return [];
    return (children.get(id) ?? []).map((kid) => headOf(kid.id));
  };

  const sizeOf = (id: string) => {
    const node = nodes.get(id);
    if (!node) return { w: CARD_WIDTH, h: CARD.header };
    return cardSize(node, folded.has(id), node.kind === 'screen' ? (children.get(id) ?? []).length : 0);
  };
  // "Along" runs with depth; "across" runs between siblings.
  const along = (id: string) => (down ? sizeOf(id).h : sizeOf(id).w);
  const across = (id: string) => (down ? sizeOf(id).w : sizeOf(id).h);
  /** Screens hidden beneath a folded card — lookups are not screens. */
  const descendants = (id: string): number =>
    (children.get(id) ?? []).reduce((n, c) => n + 1 + descendants(c.id), 0);

  // How much room across a subtree needs, given what is folded.
  const bandCache = new Map<string, number>();
  const band = (id: string): number => {
    const cached = bandCache.get(id);
    if (cached !== undefined) return cached;
    const w = Math.max(across(id), kidsBand(id));
    bandCache.set(id, w);
    return w;
  };
  const kidsBand = (id: string) => kidsOf(id).reduce((sum, k, i) => sum + band(k) + (i > 0 ? gap.sibling : 0), 0);

  // Each level starts where the previous level's biggest card ends.
  const levelSize: number[] = [];
  const measure = (id: string, depth: number): void => {
    levelSize[depth] = Math.max(levelSize[depth] ?? 0, along(id));
    for (const k of kidsOf(id)) measure(k, depth + 1);
  };
  const levelStart: number[] = [];

  const place = (id: string, depth: number, start: number): void => {
    const size = sizeOf(id);
    const across0 = start + (band(id) - across(id)) / 2;
    const along0 = levelStart[depth]!;
    const box: CardBox = {
      id,
      x: down ? across0 : along0,
      y: down ? along0 : across0,
      w: size.w,
      h: size.h,
      hiddenBelow: folded.has(id) ? descendants(id) : 0,
    };
    cards.push(box);
    placed.set(id, box);
    let at = start + (band(id) - kidsBand(id)) / 2;
    for (const k of kidsOf(id)) {
      place(k, depth + 1, at);
      at += band(k) + gap.sibling;
    }
  };

  if (root && !outsideMenu(root)) {
    measure(headOf(root.id), 0);
    for (let d = 0; d < levelSize.length; d++) levelStart[d] = d === 0 ? 0 : levelStart[d - 1]! + levelSize[d - 1]! + gap.depth;
    place(headOf(root.id), 0, 0);
  }
  const treeBottom = cards.reduce((m, c) => Math.max(m, c.y + c.h), 0);

  // Screens outside the menu (ends, anything no option reaches) sit in a row
  // beneath it. A router is not a card: a chip on its section says it instead.
  const adopted = new Set([...owned.values()].flat().map((s) => s.id));
  const outside = flow.screens.filter((s) => outsideMenu(s) && s.kind !== 'router' && !adopted.has(s.id));
  let x = 0;
  for (const id of outside.flatMap((s) => chainOf(s))) {
    const size = sizeOf(id);
    const box: CardBox = { id, x, y: cards.length ? treeBottom + OUTSIDE_GAP : 0, w: size.w, h: size.h, hiddenBelow: 0 };
    cards.push(box);
    placed.set(id, box);
    x += CARD_WIDTH + GAPS.right.depth;
  }

  const edges: MapEdge[] = [];
  // What a screen fetches is drawn in front of it, and joined to it.
  for (const screen of flow.screens) {
    const chain = chainOf(screen);
    for (let at = 0; at + 1 < chain.length; at += 1) {
      const [from, to] = [chain[at]!, chain[at + 1]!];
      if (placed.has(from) && placed.has(to)) {
        edges.push({ id: `${from}->${to}`, from, to, handle: down ? 'bottom' : 'card', kind: 'child' });
      }
    }
  }
  for (const s of flow.screens) {
    if (!placed.has(s.id) || folded.has(s.id)) continue;
    const seen = new Set<string>();
    const mine = new Set((owned.get(s.id) ?? []).map((e) => e.id));
    const add = (to: string, handle: string) => {
      const target = byId.get(to);
      if (!target || (outsideMenu(target) && !adopted.has(to)) || seen.has(to)) return;
      // A line arrives at what the screen fetches, since that runs first.
      const head = headOf(to);
      if (!placed.has(head)) return;
      seen.add(to);
      const child = target.parent === s.id || mine.has(to);
      edges.push({ id: `${s.id}->${to}`, from: s.id, to: head, handle: down ? 'bottom' : handle, kind: child ? 'child' : 'jump' });
    };
    for (const row of forwardRows(s)) if (row.to) add(row.to, row.handle);
    // Follow-up questions reach screens from deeper prompts; those leave from the card.
    for (const p of s.prompts.slice(1)) {
      for (const o of p.options) if (!o.back && o.to.kind === 'screen') add(o.to.screen, 'card');
    }
  }

  const width = cards.reduce((m, c) => Math.max(m, c.x + c.w), 0);
  const height = cards.reduce((m, c) => Math.max(m, c.y + c.h), 0);
  return { cards, edges, nodes, width, height, owned };
}

/**
 * Endings and hand offs drawn as a screen's own: exactly one screen leads
 * there, so the picture can say what the menu cannot.
 */
export function ownedExits(flow: ConversationalFlow): Map<string, Screen[]> {
  const out = new Map<string, Screen[]>();
  for (const exit of flow.screens) {
    if (exit.kind !== 'end' && exit.kind !== 'handoff') continue;
    const leads = flow.screens.filter(
      (s) => !outsideMenu(s) && optionsOf(s).some((o) => o.to.kind === 'screen' && o.to.screen === exit.id),
    );
    if (leads.length !== 1) continue;
    const owner = leads[0]!.id;
    out.set(owner, [...(out.get(owner) ?? []), exit]);
  }
  return out;
}

/** The children a card is drawn with: its own screens, then the endings it owns. */
function withOwnedExits(
  children: Map<string, Screen[]>,
  owned: Map<string, Screen[]>,
  flow: ConversationalFlow,
): Map<string, Screen[]> {
  const out = new Map(children);
  for (const [ownerId, exits] of owned) {
    const owner = flow.screens.find((s) => s.id === ownerId);
    if (!owner) continue;
    const order = optionsOf(owner).map((o) => (o.to.kind === 'screen' ? o.to.screen : ''));
    out.set(ownerId, [...(out.get(ownerId) ?? []), ...exits].sort((a, b) => rank(order, a.id) - rank(order, b.id)));
  }
  return out;
}

/**
 * Children in the order their parent offers them, so lines leave the parent's
 * option rows without crossing, and a row of children reads like the menu.
 */
function orderedChildren(flow: ConversationalFlow): Map<string, Screen[]> {
  const out = new Map<string, Screen[]>();
  for (const parent of flow.screens) {
    // A router, an ending or a hand off is drawn apart, however the config holds it.
    const kids = flow.screens.filter((s) => s.parent === parent.id && !outsideMenu(s));
    if (kids.length === 0) continue;
    const order = optionsOf(parent).map((o) => (o.to.kind === 'screen' ? o.to.screen : ''));
    kids.sort((a, b) => rank(order, a.id) - rank(order, b.id));
    out.set(parent.id, kids);
  }
  return out;
}

function rank(order: string[], id: string): number {
  const i = order.indexOf(id);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}
