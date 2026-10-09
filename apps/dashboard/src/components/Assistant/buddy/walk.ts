import {
  LIMITS,
  MAX_STEPS,
  MESSAGES,
  MIN_PROBABILITY,
  STOPPED,
  SURE_CLICK,
  SURE_NONE,
} from './constants';
import { decide, type Decision, type JevResult } from './decide';
import { groupControls } from './options';
import { hiddenTargets, type HiddenTarget, type MenuItem, type Peeked } from './paths';

// One request: read the screen and ask Jev; when nothing fits, look inside the menus on screen
// and ask once more. Every pick is checked before it is used, so a control that only looks like
// the request is never clicked. A pick that opens a page is followed: Buddy looks there for
// something more specific, as a person would. It sees the app only through a WalkEnv, so the eval
// can replay it.

export interface WalkControl extends MenuItem {
  id: string;
}

/** A control on screen, or an item inside one of its closed menus. */
export type Option<C extends WalkControl> = C | HiddenTarget<C>;

/** The app as the walk sees it: the live screen in Buddy, recorded screens in the eval. */
export interface WalkEnv<C extends WalkControl> {
  /** The controls on screen, and the menus among them worth a peek. */
  readScreen(): { controls: C[]; openers: C[] };
  /** Opens a menu and reads it, leaving it open; `close` shuts it again. */
  peek(opener: C): Promise<Peeked<C>>;
  close(menu: Peeked<C>): Promise<void>;
  route(request: string, options: { id: string; description: string }[]): Promise<JevResult>;
  /** Whether the control is what was asked ('same'), a way to it ('leads') or not ('other'). */
  check(request: string, label: string): Promise<string | undefined>;
  /** Where the user is, so a step that led to a new page can go on there. */
  here(): string;
  /** Clicks or points at the option; what to say. */
  use(option: Option<C>): Promise<string>;
  /** Highlights the options and asks if one of them is what the user meant; what to say. */
  ask(options: Option<C>[]): Promise<string>;
  log(step: string, detail?: string, data?: unknown): void;
  aborted(): boolean;
}

interface Round<C extends WalkControl> {
  optionOf: (id: string) => Option<C> | undefined;
  decision: Decision;
  /** Worth looking in menus: nothing fits and it is not plainly a question. */
  unsure: boolean;
  /** Jev's top pick, however weak: a menu it leans to is looked in first. */
  leaning?: string;
  /** The pick the check turned down: it only looked like what was asked. */
  offTarget?: Option<C>;
  /** The menu left open for the pick inside it, closed again if the pick is not used. */
  open?: Peeked<C>;
}

/** What to say, null to let Ask AI answer, or STOPPED. */
interface WalkResult {
  reply: string | null;
  why: string;
}

const traceOf = ({ id, use, label, track }: WalkControl): Partial<WalkControl> => ({
  id,
  use,
  label,
  track,
});

const inMenu = <C extends WalkControl>(option: Option<C> | undefined): option is HiddenTarget<C> =>
  !!option && 'opener' in option;

/** The menu item the round acts on, if any. */
const menuItemOf = <C extends WalkControl>({
  optionOf,
  decision,
}: Pick<Round<C>, 'optionOf' | 'decision'>): HiddenTarget<C> | undefined => {
  const chosen = decision.kind === 'act' ? optionOf(decision.id) : undefined;
  return inMenu(chosen) ? chosen : undefined;
};

/** A "which one?" that offers something inside a menu. */
const asksAboutMenu = <C extends WalkControl>({
  optionOf,
  decision,
}: Pick<Round<C>, 'optionOf' | 'decision'>): boolean =>
  decision.kind === 'ask' && decision.ids.some(id => inMenu(optionOf(id)));

async function choose<C extends WalkControl>(
  request: string,
  env: WalkEnv<C>,
  controls: C[],
  menus: Peeked<C>[] = [],
  onTheWay = false,
): Promise<Round<C> | null> {
  const hidden = hiddenTargets(controls, menus);
  if (hidden.length > 0) env.log('offered from menus', `${hidden.length}`, hidden.map(traceOf));
  const groups = groupControls<Option<C>>([...controls, ...hidden]);
  const options = groups.map(({ id, description }) => ({ id, description }));
  env.log('asked Jev', `${options.length} options for ${controls.length} controls`);
  const result = await env.route(request, options);
  if (env.aborted()) return null;
  env.log('Jev answered', result.route, result);
  const byId = new Map(groups.map(group => [group.id, group.members[0]]));
  const optionOf = (id: string): Option<C> | undefined => byId.get(id);
  // On a page the walk went into on purpose, a likely link onward is followed, not asked about;
  // a control that does something still has to be sure.
  const pick = result.route === 'unavailable' ? undefined : optionOf(result.chosen ?? '');
  const sure = onTheWay && pick?.href ? MIN_PROBABILITY : SURE_CLICK;
  const decision = decide(result, id => optionOf(id)?.text ?? id, sure);
  const probability = result.route === 'unavailable' ? 0 : (result.probability ?? 0);
  const plainlyQuestion =
    result.route !== 'unavailable' && result.chosen === 'none' && probability >= SURE_NONE;
  const unsure = decision.kind === 'ask_ai' && !plainlyQuestion;
  const leaning = result.route === 'unavailable' ? undefined : result.chosen;
  const round = { optionOf, decision, unsure, ...(leaning && { leaning }) };
  // While looking in menus only a pick inside one counts, so the rest need no check.
  if (menus.length > 0 && !menuItemOf(round) && !asksAboutMenu(round)) return round;
  return checked(request, env, round);
}

/** What the decision would use: its pick, or the two it asks between. */
const pickedIds = (decision: Decision): string[] =>
  decision.kind === 'act' ? [decision.id] : decision.kind === 'ask' ? decision.ids : [];

/**
 * Turns down picks that are not what was asked, so the walk looks further instead of using them;
 * a "which one?" offers only the picks that pass.
 */
async function checked<C extends WalkControl>(
  request: string,
  env: WalkEnv<C>,
  round: Round<C>,
): Promise<Round<C> | null> {
  const picks = pickedIds(round.decision)
    .map(round.optionOf)
    .filter((pick): pick is Option<C> => !!pick);
  const [first] = picks;
  if (!first) return round;
  const verdicts = await Promise.all(picks.map(pick => env.check(request, pick.label)));
  if (env.aborted()) return null;
  if (verdicts.every(verdict => verdict === 'other')) {
    env.log('turned down', `"${first.text}" only looks like what was asked`);
    const why = `the closest was "${first.text}", which is something else`;
    return { ...round, decision: { kind: 'ask_ai', why }, unsure: true, offTarget: first };
  }
  if (round.decision.kind !== 'ask') return round;
  const ids = picks.filter((_, i) => verdicts[i] !== 'other').map(pick => pick.id);
  return { ...round, decision: { ...round.decision, ids } };
}

/** After a look in a menu, Jev is now sure of a visible control it first only leaned to. */
const confirms = <C extends WalkControl>(round: Round<C>, first: Round<C>): boolean =>
  round.decision.kind === 'act' && pickedIds(first.decision).includes(round.decision.id);

/**
 * Looks in one menu at a time, as a person would, until Jev picks something inside one, or the
 * menu leaves Jev sure of its first pick. Other visible controls already had their chance, so
 * asking again never promotes one of them.
 */
async function lookInMenus<C extends WalkControl>(
  request: string,
  env: WalkEnv<C>,
  controls: C[],
  openers: C[],
  first: Round<C>,
  onTheWay: boolean,
): Promise<Round<C> | null> {
  const menus: Peeked<C>[] = [];
  for (const opener of openers) {
    if (env.aborted()) return null;
    const menu = await env.peek(opener);
    menus.push(menu);
    const round = await choose(request, env, controls, menus, onTheWay);
    const item = round && menuItemOf(round);
    if (item?.opener !== opener) await env.close(menu);
    if (!round) return null;
    if (confirms(round, first)) return round;
    if (item || asksAboutMenu(round))
      return item?.opener === opener ? { ...round, open: menu } : round;
  }
  return first;
}

async function act<C extends WalkControl>(
  env: WalkEnv<C>,
  { optionOf, decision }: Round<C>,
): Promise<string | null> {
  if (decision.kind === 'ask') {
    const options = decision.ids.map(optionOf).filter((o): o is Option<C> => !!o);
    if (options.length > 0) return env.ask(options);
  }
  const chosen = decision.kind === 'act' ? optionOf(decision.id) : undefined;
  if (!chosen) {
    env.log('not handled', `${decision.why}, so Ask AI answers`);
    return null;
  }
  env.log('chose', `${chosen.id} → ${chosen.use}: ${chosen.label}`);
  return env.use(chosen);
}

/**
 * Menus Jev picks, asks about or leans to are looked inside, like branches; when it is unsure and
 * leans nowhere useful, all of them, but not on a page the walk went into on purpose.
 */
function menusToLookIn<C extends WalkControl>(
  { decision, unsure, leaning }: Round<C>,
  openers: C[],
  onTheWay: boolean,
): C[] {
  const picked = [...pickedIds(decision), ...(leaning ? [leaning] : [])];
  const branches = openers.filter(opener => picked.includes(opener.id));
  if (branches.length > 0) return branches;
  return unsure && !onTheWay ? openers.slice(0, LIMITS.peeks) : [];
}

/** One screen: read it, ask Jev, and look inside its menus when that is worth it. */
async function lookHere<C extends WalkControl>(
  request: string,
  env: WalkEnv<C>,
  onTheWay: boolean,
): Promise<Round<C> | null | undefined> {
  const { controls, openers } = env.readScreen();
  env.log('read screen', `${controls.length} controls`, controls.map(traceOf));
  if (controls.length === 0) return undefined;
  const round = await choose(request, env, controls, [], onTheWay);
  if (!round) return null;
  const menus = menusToLookIn(round, openers, onTheWay);
  if (menus.length === 0) return round;
  env.log('peeking', `${round.decision.why}, so looking in up to ${menus.length} menus`);
  return lookInMenus(request, env, controls, menus, round, onTheWay);
}

/** Closes the menu a round kept open for a pick that was not used after all. */
async function closeUnused<C extends WalkControl>(
  env: WalkEnv<C>,
  round: Round<C> | null | undefined,
): Promise<void> {
  if (round?.open) await env.close(round.open);
}

/** A round that uses an option the user said yes to. */
const confirmedRound = <C extends WalkControl>(option: Option<C>): Round<C> => ({
  optionOf: () => option,
  decision: { kind: 'act', id: option.id, why: 'the user said yes' },
  unsure: false,
});

/** On a page the walk went into, the control that led there again, or a link to the page. */
const leadsBack = <C extends WalkControl>(pick: Option<C>, via: Option<C>, here: string): boolean =>
  pick.href === here || (pick.track === via.track && pick.text === via.text);

/**
 * Walks to what was asked. `confirmed` is an option the user just said yes to: it is used first,
 * and the walk goes on from where it leads.
 */
export async function runWalk<C extends WalkControl>(
  request: string,
  env: WalkEnv<C>,
  confirmed?: Option<C>,
): Promise<WalkResult> {
  env.log('heard', `“${request}”`);
  const visited = [env.here()];
  /** The control that took Buddy into the page it is on, and what it said then. */
  let entered: { via: Option<C>; reply: string } | undefined;
  for (let step = 1; step <= MAX_STEPS; step++) {
    const round =
      step === 1 && confirmed ? confirmedRound(confirmed) : await lookHere(request, env, !!entered);
    if (round === null || env.aborted()) {
      await closeUnused(env, round);
      env.log('stopped', 'while looking');
      return { reply: STOPPED, why: 'stopped' };
    }
    const why = round?.decision.why ?? 'no controls on screen';
    const missed = !round || round.offTarget || round.decision.kind === 'ask_ai';
    // Nothing more specific on a page the walk went into: that page is the answer, unless what
    // came closest there was turned down.
    if (entered && missed) {
      const reply = round?.offTarget ? MESSAGES.notThere(entered.via.text) : entered.reply;
      return { reply, why };
    }
    if (round?.offTarget) return { reply: MESSAGES.notHere(round.offTarget.text), why };
    if (!round) return { reply: null, why };
    const pick = round.decision.kind === 'act' ? round.optionOf(round.decision.id) : undefined;
    // Picking the way back to the page the walk went into means this page is the answer.
    if (entered && pick && leadsBack(pick, entered.via, env.here())) {
      await closeUnused(env, round);
      return { reply: MESSAGES.opened(pick.text), why: 'arrived' };
    }
    const reply = await act(env, round);
    if (reply === STOPPED || env.aborted()) {
      await closeUnused(env, round);
      env.log('stopped', 'while acting');
      return { reply: STOPPED, why: 'stopped' };
    }
    if (entered && reply && round.decision.kind === 'ask') {
      return { reply: `${entered.reply} ${reply}`, why };
    }
    if (!reply || !pick || visited.includes(env.here())) return { reply, why };
    visited.push(env.here());
    entered = { via: pick, reply };
    env.log(
      'going on',
      `"${pick.text}" opened a page, so looking there for something more specific`,
    );
  }
  return { reply: entered?.reply ?? null, why: 'walked as far as it goes' };
}
