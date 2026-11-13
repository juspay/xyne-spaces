/**
 * Asking the flow about its routers.
 *
 * A router is a screen like any other, so which screens it serves is not stored
 * anywhere: it is the frame the router sits in. A router in the conversation's
 * own frame reaches everything; one inside a section reaches that section and
 * what is below it. Scoping is therefore a question about position, which is
 * what every query here answers.
 */
import { ancestorsOf, breadcrumb, subtreeOf } from './tree.js';
import type { ConversationalFlow, Screen } from './types.js';

/** Every router in the flow, as the tree reads them. */
export function routersOf(flow: ConversationalFlow): Screen[] {
  return flow.screens.filter((s) => s.kind === 'router');
}

/** The router in the conversation's own frame — the one that reaches everything. */
export function flowRouter(flow: ConversationalFlow): Screen | undefined {
  return routersOf(flow).find((s) => frameOf(flow, s) === flow.rootScreen);
}

/** The screen whose frame something sits in: the conversation, or a section. */
export function frameOf(flow: ConversationalFlow, screen: Screen): string {
  return screen.frames[screen.frames.length - 1] ?? flow.rootScreen;
}

/**
 * The section a router serves — undefined for the one that serves the whole
 * flow, and for anything that is not a router: only a router has a scope.
 */
export function scopeOf(flow: ConversationalFlow, router: Screen): Screen | undefined {
  if (!router.router) return undefined;
  const frame = frameOf(flow, router);
  return frame === flow.rootScreen ? undefined : flow.screens.find((s) => s.id === frame);
}

/**
 * Where typed text goes from a screen: the router its question names.
 *
 * It is authored — one screen inside Payments may keep its typing in Payments
 * while its neighbour sends everything to the top — so it is read, not derived.
 */
export function routerFor(flow: ConversationalFlow, screenId: string): Screen | undefined {
  const screen = flow.screens.find((s) => s.id === screenId);
  for (const prompt of screen?.prompts ?? []) {
    const to = prompt.freeText;
    if (to?.kind !== 'screen') continue;
    const router = flow.screens.find((s) => s.id === to.screen && s.kind === 'router');
    if (router) return router;
  }
  return undefined;
}

/**
 * The routers a screen may send typing to: the ones whose frame encloses it.
 *
 * Innermost first, so "keep this in Payments" reads before "look anywhere".
 */
export function routersFor(flow: ConversationalFlow, screenId: string): Screen[] {
  const enclosing = [screenId, ...ancestorsOf(flow, screenId)];
  return routersOf(flow)
    .filter((router) => enclosing.includes(frameOf(flow, router)))
    .sort((a, b) => enclosing.indexOf(frameOf(flow, a)) - enclosing.indexOf(frameOf(flow, b)));
}

/** Whether typing on `screenId` could reach `routerId` at all. */
export function routingIsValid(flow: ConversationalFlow, screenId: string, routerId: string): boolean {
  return routersFor(flow, screenId).some((router) => router.id === routerId);
}

/** The screens a router may open: its own frame's subtree, as `settle` wrote it. */
export function candidatesOf(flow: ConversationalFlow, router: Screen): Screen[] {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  return router.router?.candidates.map((id) => byId.get(id)).filter((s): s is Screen => s !== undefined) ?? [];
}

/** The screens a router anywhere in the flow could open. */
export function routableScreens(flow: ConversationalFlow): Screen[] {
  const byId = new Map(flow.screens.map((s) => [s.id, s]));
  return subtreeOf(flow, flow.rootScreen)
    .map((id) => byId.get(id))
    .filter((s): s is Screen => s !== undefined)
    .filter((s) => s.kind !== 'router')
    .filter((s) => s.kind !== 'end' || (s.about ?? '') !== '');
}

/** The endings a router may choose — the ones whose author said when they apply. */
export function endsByTyping(flow: ConversationalFlow): Screen[] {
  return flow.screens.filter((s) => s.kind === 'end' && (s.about ?? '') !== '');
}

/** How to name a router in the editor: what it asks, and what it reaches. */
export function routerName(flow: ConversationalFlow, router: Screen): string {
  const section = scopeOf(flow, router);
  const reach = section ? `${breadcrumb(flow, section)} and below` : 'anywhere';
  return `${serviceName(router)} · ${reach}`;
}

function serviceName(router: Screen): string {
  const info = router.router;
  if (!info) return 'Router';
  if (info.mode === 'classifier') return info.credentialName ?? info.model ?? 'Classifier';
  if (info.mode === 'agent') return info.agent ?? 'AI agent';
  return 'Keywords';
}
