import {
  ASKS_FOR_A_WAY,
  CURRENT,
  LIMITS,
  MAX_PAGES,
  MESSAGES,
  MAKES_SOMETHING,
  MIN_PROBABILITY,
  STEP_BREAK,
  STOPPED,
  SURE_CLICK,
  SURE_NONE,
} from './constants';
import { decide, type Decision, type JevResult } from './decide';
import { controlKey, normalise } from './history';
import { groupControls, type ControlGroup } from './options';
import { hiddenTargets, type HiddenTarget, type MenuItem, type Peeked } from './paths';

// One request: read the screen and ask Jev; when nothing fits, look inside the menus on screen
// and ask once more. Every pick is checked before it is used, so a control that only looks like
// the request is never clicked. A pick that opens a page is followed: Buddy looks there for
// something more specific, as a person would. A request of several steps ("open general and
// leave it") is walked one step at a time. It sees the app only through a WalkEnv, so the eval
// can replay it.

export interface WalkControl extends MenuItem {
  id: string;
}

/** What using an option said, and whether it was used: an item can be gone from its menu. */
export interface Used {
  reply: string;
  acted: boolean;
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
  check(request: string, label: string): Promise<JevResult>;
  /** Where the user is, so a step that led to a new page can go on there. */
  here(): string;
  /** Clicks or points at the option. */
  use(option: Option<C>): Promise<Used>;
  /** Highlights the options and asks if one of them is what the user meant; what to say. */
  ask(options: Option<C>[]): Promise<string>;
  log(step: string, detail?: string, data?: unknown): void;
  aborted(): boolean;
  /** Waits for the page to hold still, as a page that loads in parts may still be filling in. */
  settle?(): Promise<void>;
  /** The control the user said yes to for this request before (its controlKey), if any. */
  chosenBefore?(request: string): string | undefined;
  /** Controls this request already used and that did not help: not offered again. */
  tried?: ReadonlySet<string>;
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
  /** How it ended: on a click the next step can go on from, or on a "Did you mean…?". */
  ended?: 'clicked' | 'asked';
  /** After a "Did you mean…?": the step it asked about, then the steps after it. */
  left?: string[];
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
  const hidden = hiddenTargets(controls, menus).filter(item => untried(env, item));
  if (hidden.length > 0) env.log('offered from menus', `${hidden.length}`, hidden.map(traceOf));
  const groups = groupControls<Option<C>>([...controls, ...hidden]);
  const options = groups.map(({ id, description }) => ({ id, description }));
  env.log('asked Jev', `${options.length} options for ${controls.length} controls`);
  let result = await env.route(request, options);
  // Jev can be down for a moment: ask once more before going on without it.
  if (result.route === 'unavailable' && !env.aborted()) result = await env.route(request, options);
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
  // Without Jev, what is in the menus could not be judged either.
  const unsure = decision.kind === 'ask_ai' && !plainlyQuestion && result.route !== 'unavailable';
  const leaning = result.route === 'unavailable' ? undefined : result.chosen;
  const round = { optionOf, decision, unsure, ...(leaning && { leaning }) };
  // While looking in menus only a pick inside one counts, so the rest need no check.
  if (menus.length > 0 && !menuItemOf(round) && !asksAboutMenu(round)) return round;
  const verified = await checked(request, env, round);
  return verified && chosenBefore(request, env, groups, result, verified);
}

/**
 * The control the user said yes to for this request before, when it is here and Jev leans to it,
 * or Jev is unsure and nothing else passed the check.
 */
function chosenBefore<C extends WalkControl>(
  request: string,
  env: WalkEnv<C>,
  groups: ControlGroup<Option<C>>[],
  result: JevResult,
  round: Round<C>,
): Round<C> {
  const key = env.chosenBefore?.(request);
  if (!key || round.decision.kind === 'act') return round;
  const group = groups.find(({ members }) => members.some(member => controlKey(member) === key));
  if (!group) return round;
  const leanedTo =
    result.route !== 'unavailable' &&
    [result.chosen, ...(result.route === 'actions' ? result.actionIds : [])].includes(group.id);
  const others = pickedIds(round.decision).filter(id => id !== group.id);
  if (!leanedTo && others.length > 0) return round;
  const why = `"${group.members[0].text}" is what the user chose for this before`;
  const { offTarget: _turnedDown, ...kept } = round;
  return { ...kept, decision: { kind: 'act', id: group.id, why }, unsure: false };
}

/** What the decision would use: its pick, or the two it asks between. */
const pickedIds = (decision: Decision): string[] =>
  decision.kind === 'act' ? [decision.id] : decision.kind === 'ask' ? decision.ids : [];

/**
 * Whether the check found the pick is something else. A link only goes somewhere, and back, so it
 * is turned down only when Jev is sure.
 */
const isOther = ({ href }: WalkControl, result: JevResult): boolean =>
  result.route !== 'unavailable' &&
  result.chosen === 'other' &&
  (!href || (result.probability ?? 0) >= MIN_PROBABILITY);

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
  const results = await Promise.all(picks.map(pick => env.check(request, pick.label)));
  if (env.aborted()) return null;
  const others = picks.map((pick, i) => isOther(pick, results[i] ?? { route: 'unavailable' }));
  if (others.every(Boolean)) {
    env.log('turned down', `"${first.text}" only looks like what was asked`);
    const why = `the closest was "${first.text}", which is something else`;
    return { ...round, decision: { kind: 'ask_ai', why }, unsure: true, offTarget: first };
  }
  if (round.decision.kind !== 'ask') return round;
  const passed = picks.filter((_, i) => !others[i]);
  const [only] = passed;
  // Jev leaned to it and the check is sure it is what was asked: nothing to ask, if it can be undone.
  if (passed.length === 1 && only && isSure(results[picks.indexOf(only)]) && undoable(only)) {
    return {
      ...round,
      decision: { kind: 'act', id: only.id, why: `Jev and the check: "${only.text}"` },
    };
  }
  const local = closest(request, passed, env.here());
  if (local) {
    const why = `"${local.text}" is on this page`;
    const decision: Decision = undoable(local)
      ? { kind: 'act', id: local.id, why }
      : { kind: 'ask', ids: [local.id], why };
    return { ...round, decision };
  }
  return { ...round, decision: { ...round.decision, ids: passed.map(pick => pick.id) } };
}

/**
 * Of two picks that both pass, the one on this page rather than a link to another page, unless
 * the request names that other page.
 */
function closest<C extends WalkControl>(
  request: string,
  passed: Option<C>[],
  here: string,
): Option<C> | undefined {
  const isLocal = (option: Option<C>): boolean => !option.href || option.href === here;
  const [local, ...more] = passed.filter(isLocal);
  const [elsewhere] = passed.filter(option => !isLocal(option));
  if (passed.length !== 2 || !local || more.length > 0 || !elsewhere) return undefined;
  const said = normalise(request);
  const names = (option: Option<C>): boolean => said.includes(normalise(option.text));
  return names(elsewhere) && !names(local) ? undefined : local;
}

/** The check is sure the control is what was asked, not just a way to it. */
const isSure = (result: JevResult | undefined): boolean =>
  result?.route !== undefined &&
  result.route !== 'unavailable' &&
  result.chosen === 'same' &&
  (result.probability ?? 0) >= SURE_CLICK;

/** Going somewhere, switching a tab or opening a menu: nothing that cannot be undone. */
const undoable = (option: WalkControl): boolean =>
  option.use === 'click' && (!!option.href || isTab(option) || !!option.opens);

const isTab = ({ label }: WalkControl): boolean => label.startsWith('tab ');

/** After a look in a menu, Jev is now sure of a visible control it first only leaned to. */
const confirms = <C extends WalkControl>(round: Round<C>, first: Round<C>): boolean =>
  round.decision.kind === 'act' && pickedIds(first.decision).includes(round.decision.id);

/**
 * Looks in one menu at a time, as a person would, until Jev picks something inside one, or the
 * menu leaves Jev sure of its first pick. Visible controls Jev first turned to are not promoted;
 * when it first had no pick worth asking about, a later answer is checked and settles it.
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
    const firstHadNone = pickedIds(first.decision).length === 0 && !first.offTarget;
    if (firstHadNone && pickedIds(round.decision).length > 0) return checked(request, env, round);
  }
  return first;
}

async function act<C extends WalkControl>(
  env: WalkEnv<C>,
  { optionOf, decision }: Round<C>,
): Promise<Used | { reply: null; acted: false }> {
  if (decision.kind === 'ask') {
    const options = decision.ids.map(optionOf).filter((o): o is Option<C> => !!o);
    if (options.length > 0) return { reply: await env.ask(options), acted: false };
  }
  const chosen = decision.kind === 'act' ? optionOf(decision.id) : undefined;
  if (!chosen) {
    env.log('not handled', `${decision.why}, so Ask AI answers`);
    return { reply: null, acted: false };
  }
  env.log('chose', `${chosen.id} → ${chosen.use}: ${chosen.label}`);
  return env.use(chosen);
}

const isCurrent = ({ label }: WalkControl): boolean => label.includes(CURRENT);

/**
 * One menu of each kind, in screen order, to look in without a lead: row menus share a kind, and
 * of those the current row's is the one asked about most.
 */
export function menusToSweep<C extends WalkControl>(openers: C[]): C[] {
  const byKind = new Map<string, C>();
  for (const opener of openers) {
    const kind = opener.track || opener.text;
    const kept = byKind.get(kind);
    if (!kept || (!isCurrent(kept) && isCurrent(opener))) byKind.set(kind, opener);
  }
  return [...byKind.values()];
}

/**
 * Menus Jev picks, asks about or leans to are looked inside, like branches; when it is unsure and
 * leans nowhere useful, one of each kind, but not on a page the walk went into on purpose.
 */
function menusToLookIn<C extends WalkControl>(
  { decision, unsure, leaning }: Round<C>,
  openers: C[],
  onTheWay: boolean,
): C[] {
  const picked = new Set([...pickedIds(decision), ...(leaning ? [leaning] : [])]);
  const branches = openers.filter(opener => picked.has(opener.id));
  if (branches.length > 0) return branches;
  return unsure && !onTheWay ? menusToSweep(openers).slice(0, LIMITS.peeks) : [];
}

/** One screen: read it, ask Jev, and look inside its menus when that is worth it. */
async function lookHere<C extends WalkControl>(
  request: string,
  env: WalkEnv<C>,
  onTheWay: boolean,
): Promise<Round<C> | null | undefined> {
  const screen = env.readScreen();
  const [controls, openers] = [screen.controls, screen.openers].map(found =>
    found.filter(control => untried(env, control)),
  ) as [C[], C[]];
  env.log('read screen', `${controls.length} controls`, controls.map(traceOf));
  if (controls.length === 0) return undefined;
  let pool = controls;
  let round = await choose(request, env, pool, [], onTheWay);
  // A pick the check turned down is left out and Jev asked again, before looking in menus.
  for (let retry = 0; round?.offTarget && retry < LIMITS.retries; retry++) {
    const turnedDown = round.offTarget;
    env.log('asking again', `without "${turnedDown.text}"`);
    pool = pool.filter(control => control.id !== turnedDown.id);
    if (pool.length === 0) break;
    round = await choose(request, env, pool, [], onTheWay);
  }
  if (!round) return null;
  const menus = menusToLookIn(round, openers, onTheWay);
  if (menus.length === 0) return round;
  env.log('peeking', `${round.decision.why}, so looking in up to ${menus.length} menus`);
  return lookInMenus(request, env, pool, menus, round, onTheWay);
}

/** Closes the menu a round kept open for a pick that was not used after all. */
async function closeUnused<C extends WalkControl>(
  env: WalkEnv<C>,
  round: Round<C> | null | undefined,
): Promise<void> {
  if (round?.open) await env.close(round.open);
}

/**
 * When Jev only leans between pages ("general channel": Chat or Administration, General), the page
 * it leans to is looked in, not asked about: going to a page changes nothing, and what was asked
 * for is usually inside it. A control that does something is still asked about.
 */
function followsLink<C extends WalkControl>(round: Round<C>): Round<C> {
  if (round.decision.kind !== 'ask') return round;
  const leaned = round.decision.ids.map(round.optionOf).filter((o): o is Option<C> => !!o);
  const [first] = leaned;
  if (!first || !leaned.every(o => !!o.href && o.use === 'click' && !isCurrent(o))) return round;
  const why = `Jev leaned to "${first.text}", a page to look in`;
  return { ...round, decision: { kind: 'act', id: first.id, why } };
}

/** A round that uses an option the user said yes to. */
const confirmedRound = <C extends WalkControl>(option: Option<C>): Round<C> => ({
  optionOf: () => option,
  decision: { kind: 'act', id: option.id, why: 'the user said yes' },
  unsure: false,
});

/**
 * On a page the walk went into, a control the walk already used, or a link to the page: to it, or
 * marked as where the user is.
 */
const leadsBack = <C extends WalkControl>(
  pick: Option<C>,
  used: ReadonlySet<string>,
  here: string,
): boolean =>
  (!!pick.href && (pick.href === here || isCurrent(pick))) || used.has(controlKey(pick));

/** Jev's pick is where the user already is: a link to this page, or a link or tab marked current. */
function alreadyThere<C extends WalkControl>(
  { decision, optionOf }: Round<C>,
  here: string,
): Option<C> | undefined {
  const [first] = pickedIds(decision);
  const pick = first === undefined ? undefined : optionOf(first);
  if (!pick) return undefined;
  const current = (!!pick.href || isTab(pick)) && isCurrent(pick);
  return pick.href === here || current ? pick : undefined;
}

/** Not a control this request already tried, nor another way to the same place. */
function untried<C extends WalkControl>(env: WalkEnv<C>, item: MenuItem): boolean {
  if (!env.tried?.size) return true;
  const places = new Set([...env.tried].map(key => key.split('|').at(-1)).filter(Boolean));
  return !env.tried.has(controlKey(item)) && !(item.href && places.has(item.href));
}

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
  /** Pages already looked at a second time. */
  const lookedAgain = new Set<string>();
  /** The controls this walk used: never used twice. */
  const used = new Set<string>();
  /** The control that took Buddy into the page it is on, and what it said then. */
  let entered: { via: Option<C>; reply: string } | undefined;
  for (let step = 1; step <= MAX_PAGES; step++) {
    const looked =
      step === 1 && confirmed ? confirmedRound(confirmed) : await lookHere(request, env, !!entered);
    const round = looked && followsLink(looked);
    if (round === null || env.aborted()) {
      await closeUnused(env, round);
      env.log('stopped', 'while looking');
      return { reply: STOPPED, why: 'stopped' };
    }
    // On a page the walk went into, nothing found (or only the way back) may be a page still
    // filling in: it is looked at once more, after it has held still, before it is the answer.
    const early =
      !!entered &&
      (!round ||
        round.offTarget ||
        round.decision.kind === 'ask_ai' ||
        (round.decision.kind === 'act' &&
          !!round.optionOf(round.decision.id) &&
          leadsBack(round.optionOf(round.decision.id)!, used, env.here())));
    if (early && env.settle && !lookedAgain.has(env.here())) {
      lookedAgain.add(env.here());
      await closeUnused(env, round);
      env.log('looking again', 'the page may still be loading');
      await env.settle();
      step--;
      continue;
    }
    const why = round?.decision.why ?? 'no controls on screen';
    const missed = !round || round.offTarget || round.decision.kind === 'ask_ai';
    // Nothing more specific on a page the walk went into: that page is the answer, unless what
    // came closest there was turned down.
    if (entered && missed) {
      if (round?.offTarget) return { reply: MESSAGES.notThere(entered.via.text), why };
      return { reply: entered.reply, why, ended: 'clicked' };
    }
    if (round?.offTarget) return { reply: MESSAGES.notHere(round.offTarget.text), why };
    if (!round) return { reply: null, why };
    const pick = round.decision.kind === 'act' ? round.optionOf(round.decision.id) : undefined;
    const there = !entered && alreadyThere(round, env.here());
    if (there) {
      await closeUnused(env, round);
      return { reply: MESSAGES.alreadyIn(there.text), why: 'already there', ended: 'clicked' };
    }
    // Picking the way back to the page the walk went into means this page is the answer.
    if (entered && pick && leadsBack(pick, used, env.here())) {
      await closeUnused(env, round);
      return { reply: MESSAGES.opened(pick.text), why: 'arrived', ended: 'clicked' };
    }
    const { reply, acted } = await act(env, round);
    if (acted && pick) used.add(controlKey(pick));
    if (reply === STOPPED || env.aborted()) {
      await closeUnused(env, round);
      env.log('stopped', 'while acting');
      return { reply: STOPPED, why: 'stopped' };
    }
    if (entered && reply && round.decision.kind === 'ask') {
      return { reply: `${entered.reply} ${reply}`, why, ended: 'asked' };
    }
    // A page that a button made (a new canvas, say) is what was asked for: nothing to look for.
    const made = !pick?.href && MAKES_SOMETHING.test(pick?.text ?? '');
    if (!acted || !pick || made || visited.includes(env.here())) {
      if (reply && round.decision.kind === 'ask') return { reply, why, ended: 'asked' };
      return { reply, why, ...(acted && pick?.use === 'click' && { ended: 'clicked' as const }) };
    }
    visited.push(env.here());
    entered = { via: pick, reply };
    env.log(
      'going on',
      `"${pick.text}" opened a page, so looking there for something more specific`,
    );
  }
  return { reply: entered?.reply ?? null, why: 'walked as far as it goes', ended: 'clicked' };
}

/** The steps of a request, split where it joins them; never before a one-word part ("and sent"). */
export function stepsOf(request: string): string[] {
  const [first = '', ...rest] = request.trim().split(STEP_BREAK);
  const steps = [first];
  for (let i = 0; i < rest.length; i += 2) {
    const joint = rest[i] ?? '';
    const part = rest[i + 1] ?? '';
    if (part.split(/\s+/).filter(Boolean).length >= 2 && steps.length < LIMITS.steps) {
      steps.push(part);
    } else {
      steps[steps.length - 1] += joint + part;
    }
  }
  return steps;
}

/**
 * Walks a request step by step, each step on the screen the one before left, and goes on only
 * after a click: what changes data is pointed at for the user to finish, and a "Did you mean…?"
 * waits for the answer. `resume` goes on after a yes: the option chosen, then the steps left.
 */
export async function runSteps<C extends WalkControl>(
  request: string,
  env: WalkEnv<C>,
  resume?: { confirmed?: Option<C>; steps: string[] },
): Promise<WalkResult> {
  // "How do I…", "where can I…": asked the way to something, it is what the user wants done.
  const doing = request.replace(ASKS_FOR_A_WAY, '').trim() || request;
  const steps = resume?.steps ?? stepsOf(doing);
  const replies: string[] = [];
  let result: WalkResult = { reply: null, why: 'nothing to do' };
  for (const [i, step] of steps.entries()) {
    result = await runWalk(step, env, i === 0 ? resume?.confirmed : undefined);
    if (result.reply === STOPPED) return result;
    if (result.reply === null) {
      if (i > 0) return { ...result, reply: [...replies, MESSAGES.noStep(step)].join(' ') };
      // The first step is nothing to do: the request was not several steps after all.
      if (steps.length > 1 && !resume) return runSteps(request, env, { steps: [doing] });
      return result;
    }
    replies.push(result.reply);
    if (result.ended === 'asked')
      return { ...result, reply: replies.join(' '), left: steps.slice(i) };
    if (result.ended !== 'clicked') break;
  }
  return { ...result, reply: replies.join(' ') };
}
