import {
  ASKS_A_QUESTION,
  ASKS_FOR_A_WAY,
  CURRENT,
  LIMITS,
  MAX_PAGES,
  MESSAGES,
  MAKES_SOMETHING,
  MIN_PROBABILITY,
  OPENS_SOMETHING,
  STEP_BREAK,
  STOPPED,
  SURE_CLICK,
  SURE_NONE,
} from './constants';
import { decide, type Decision, type JevResult } from './decide';
import { controlKey, normalise } from './history';
import { groupControls } from './options';
import { hiddenTargets, type HiddenTarget, type MenuItem, type Peeked } from './paths';

// Sees the app only through a WalkEnv, so the eval can replay it.

export interface WalkControl extends MenuItem {
  id: string;
}

/** Whether it was used: an item can be gone from its menu. */
export interface Used {
  reply: string;
  acted: boolean;
}

export type Option<C extends WalkControl> = C | HiddenTarget<C>;

export interface WalkEnv<C extends WalkControl> {
  readScreen(): { controls: C[]; openers: C[] };
  /** Leaves the menu open; `close` shuts it again. */
  peek(opener: C): Promise<Peeked<C>>;
  close(menu: Peeked<C>): Promise<void>;
  route(request: string, options: { id: string; description: string }[]): Promise<JevResult>;
  /** Whether the control is what was asked ('same'), a way to it ('leads') or not ('other'). */
  check(request: string, label: string): Promise<JevResult>;
  here(): string;
  use(option: Option<C>): Promise<Used>;
  ask(options: Option<C>[]): Promise<string>;
  log(step: string, detail?: string, data?: unknown): void;
  aborted(): boolean;
  settle?(): Promise<void>;
  tried?: ReadonlySet<string>;
  /** Controls the last "Did you mean…?" asked about: landing on one again is the user's yes. */
  askedAbout?: ReadonlySet<string>;
}

interface Round<C extends WalkControl> {
  optionOf: (id: string) => Option<C> | undefined;
  decision: Decision;
  probability: number;
  /** Worth looking in menus: nothing fits and it is not plainly a question. */
  unsure: boolean;
  /** Jev's top pick, however weak: a menu it leans to is looked in first. */
  leaning?: string;
  offTarget?: Option<C>;
  /** The menu left open for the pick inside it, closed again if the pick is not used. */
  open?: Peeked<C>;
}

/** What to say, null to let Ask AI answer, or STOPPED. */
interface WalkResult {
  reply: string | null;
  why: string;
  ended?: 'clicked' | 'asked';
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

const menuItemOf = <C extends WalkControl>({
  optionOf,
  decision,
}: Pick<Round<C>, 'optionOf' | 'decision'>): HiddenTarget<C> | undefined => {
  const chosen = decision.kind === 'act' ? optionOf(decision.id) : undefined;
  return inMenu(chosen) ? chosen : undefined;
};

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
  // On a page walked into on purpose, a likely link onward is followed, not asked about.
  const pick = result.route === 'unavailable' ? undefined : optionOf(result.chosen ?? '');
  const sure = onTheWay && pick?.href ? MIN_PROBABILITY : SURE_CLICK;
  const decision = decide(result, id => optionOf(id)?.text ?? id, sure);
  const probability = result.route === 'unavailable' ? 0 : (result.probability ?? 0);
  const plainlyQuestion =
    result.route !== 'unavailable' &&
    result.chosen === 'none' &&
    (probability >= SURE_NONE || ASKS_A_QUESTION.test(request));
  const unsure = decision.kind === 'ask_ai' && !plainlyQuestion && result.route !== 'unavailable';
  const leaning = result.route === 'unavailable' ? undefined : result.chosen;
  const round = { optionOf, decision, probability, unsure, ...(leaning && { leaning }) };
  // While looking in menus only a pick inside one counts, so the rest need no check.
  if (menus.length > 0 && !menuItemOf(round) && !asksAboutMenu(round)) return round;
  return checked(request, env, round);
}

const pickedIds = (decision: Decision): string[] =>
  decision.kind === 'act' ? [decision.id] : decision.kind === 'ask' ? decision.ids : [];

/** Whether the check found the pick is something else; a link only goes somewhere (and back), so only when Jev is sure. */
const isOther = ({ href }: WalkControl, result: JevResult): boolean =>
  result.route !== 'unavailable' &&
  result.chosen === 'other' &&
  (!href || (result.probability ?? 0) >= MIN_PROBABILITY);

/** Turns down picks that are not what was asked; a "which one?" offers only the picks that pass. */
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
  const lean = passed.find(pick => pick.id === round.leaning);
  // The same "Did you mean…?" again: the user asking for it again is their yes to Jev's pick.
  const again = lean ?? only;
  if (again && passed.every(pick => env.askedAbout?.has(controlKey(pick)))) {
    const why = `"${again.text}" was asked about and asked for again`;
    return { ...round, decision: { kind: 'act', id: again.id, why } };
  }
  // Jev leaned to it and the check is sure it is what was asked: nothing to ask, if it can be undone.
  if (passed.length === 1 && only && isSure(results[picks.indexOf(only)]) && undoable(only)) {
    return {
      ...round,
      decision: { kind: 'act', id: only.id, why: `Jev and the check: "${only.text}"` },
    };
  }
  // When Jev splits between links only, its pick is followed and looked on from if the check is
  // sure it leads there, so a channel not listed here is found in Chat, not asked about.
  const onlyLinks = passed.every(pick => !!pick.href && undoable(pick));
  if (lean && onlyLinks && leadsThere(results[picks.indexOf(lean)])) {
    const why = `following "${lean.text}", which the check says leads there`;
    return { ...round, decision: { kind: 'act', id: lean.id, why } };
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

/** Of two picks that both pass, the one on this page, unless the request names the other page. */
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

const isSure = (result: JevResult | undefined): boolean =>
  result?.route !== undefined &&
  result.route !== 'unavailable' &&
  result.chosen === 'same' &&
  (result.probability ?? 0) >= SURE_CLICK;

const leadsThere = (result: JevResult | undefined): boolean =>
  result?.route !== undefined &&
  result.route !== 'unavailable' &&
  (result.chosen === 'same' || result.chosen === 'leads') &&
  (result.probability ?? 0) >= SURE_CLICK;

const undoable = (option: WalkControl): boolean =>
  option.use === 'click' &&
  (!!option.href || isTab(option) || !!option.opens || OPENS_SOMETHING.test(option.text));

const isTab = ({ label }: WalkControl): boolean => label.startsWith('tab ');

/** After a look in a menu, Jev is now sure of a visible control it first only leaned to. */
const confirms = <C extends WalkControl>(round: Round<C>, first: Round<C>): boolean =>
  round.decision.kind === 'act' && pickedIds(first.decision).includes(round.decision.id);

/**
 * Looks in one menu at a time until Jev picks something inside one, or the menu leaves Jev sure of
 * its first pick. Visible controls Jev first turned to are not promoted.
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
    if (item?.opener !== menu.opener) await env.close(menu);
    if (!round) return null;
    if (confirms(round, first)) return round;
    if (item || asksAboutMenu(round))
      return item?.opener === menu.opener ? { ...round, open: menu } : round;
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

/** One menu of each kind, in screen order, to look in without a lead; of row menus, the current row's first. */
export function menusToSweep<C extends WalkControl>(openers: C[]): C[] {
  const byKind = new Map<string, C>();
  for (const opener of openers.filter(({ opens }) => opens !== 'dialog')) {
    const kind = opener.track || opener.text;
    const kept = byKind.get(kind);
    if (!kept || (!isCurrent(kept) && isCurrent(opener))) byKind.set(kind, opener);
  }
  return [...byKind.values()];
}

/**
 * Menus Jev picks, asks about or leans to; when unsure and leaning nowhere useful, one of each
 * kind, but not on a page walked into on purpose.
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

async function closeUnused<C extends WalkControl>(
  env: WalkEnv<C>,
  round: Round<C> | null | undefined,
): Promise<void> {
  if (round?.open) await env.close(round.open);
}

/**
 * When Jev only leans between pages ("general channel": Chat or Administration, General), the page
 * it leans to is looked in, not asked about: going to a page changes nothing. A control that does
 * something is still asked about.
 */
function followsLink<C extends WalkControl>(round: Round<C>): Round<C> {
  if (round.decision.kind !== 'ask' || round.probability < MIN_PROBABILITY) return round;
  const leaned = round.decision.ids.map(round.optionOf).filter((o): o is Option<C> => !!o);
  const [first] = leaned;
  if (!first || !leaned.every(o => !!o.href && o.use === 'click' && !isCurrent(o))) return round;
  const why = `Jev leaned to "${first.text}", a page to look in`;
  return { ...round, decision: { kind: 'act', id: first.id, why } };
}

const confirmedRound = <C extends WalkControl>(option: Option<C>): Round<C> => ({
  optionOf: () => option,
  decision: { kind: 'act', id: option.id, why: 'the user said yes' },
  unsure: false,
  probability: 1,
});

/**
 * On a page walked into: a control already used, or a link to the page open now. One only marked
 * current (#general shown while Chat's address is still /chat/dir) is clicked, so the page stays.
 */
const leadsBack = <C extends WalkControl>(
  pick: Option<C>,
  used: ReadonlySet<string>,
  here: string,
): boolean => (!!pick.href && pick.href === here) || used.has(controlKey(pick));

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

function untried<C extends WalkControl>(env: WalkEnv<C>, item: MenuItem): boolean {
  if (!env.tried?.size) return true;
  const places = new Set([...env.tried].map(key => key.split('|').at(-1)).filter(Boolean));
  return !env.tried.has(controlKey(item)) && !(item.href && places.has(item.href));
}

const wordsOf = (text: string): string[] =>
  normalise(text).replace(/^\d+ /, '').split(' ').filter(Boolean);

/** How many words all of these start with, leaving the first at least one of its own. */
function sharedStart(lists: string[][]): number {
  const [first = []] = lists;
  let shared = 0;
  while (shared < first.length - 1 && lists.every(words => words[shared] === first[shared])) {
    shared++;
  }
  return shared;
}

/** A control's label without its name, destination and "(current)" mark: rows of one kind (channel links, DM rows) look alike. */
const shapeOf = ({ label }: WalkControl): string =>
  label
    .replace(/"[^"]*"/, '""')
    .replace(/\s*\(goes to [^)]*\)/, '')
    .replace(CURRENT, '')
    .trim();

const kindOf = (control: WalkControl): string => `${control.track}|${shapeOf(control)}`;

/**
 * The rows a request can name: clickable controls of a repeating kind (channels, DMs, canvases),
 * by their text and by the text past the words every row of the kind starts with.
 */
function itemNames<C extends WalkControl>(controls: C[]): Map<C, string[]> {
  const kinds = new Map<string, C[]>();
  for (const control of controls) {
    if (control.track && control.use === 'click' && !control.opens) {
      const kind = kindOf(control);
      const rows = kinds.get(kind);
      if (rows) rows.push(control);
      else kinds.set(kind, [control]);
    }
  }
  const names = new Map<C, string[]>();
  for (const rows of kinds.values()) {
    if (rows.length < 2) continue;
    const words = rows.map(row => wordsOf(row.text));
    const shared = sharedStart(words);
    rows.forEach((row, i) => {
      const own = words[i] ?? [];
      names.set(
        row,
        [own.join(' '), own.slice(shared).join(' ')].filter(name => name.length >= 3),
      );
    });
  }
  return names;
}

/**
 * The item the request names: the longest of its names said as whole words, when exactly one item
 * has that name and that item is not the current one.
 */
function namedItem<C extends WalkControl>(
  request: string,
  controls: C[],
): { item: C; name: string } | undefined {
  const said = ` ${normalise(request)} `;
  const named = [...itemNames(controls)].flatMap(([item, names]) =>
    names.filter(name => said.includes(` ${name} `)).map(name => ({ item, name })),
  );
  const longest = Math.max(0, ...named.map(({ name }) => name.length));
  const best = named.filter(({ name }) => name.length === longest);
  const [first] = best;
  if (!first || best.some(({ item }) => item !== first.item) || isCurrent(first.item)) {
    return undefined;
  }
  return first;
}

/** Whether a text says the name: its words in a row, each equal to or starting with the name's ("unreads" says "unread"). */
const saysName = (text: string, name: string): boolean => {
  const words = wordsOf(text);
  const nameWords = name.split(' ');
  return words.some((_, i) => nameWords.every((word, j) => words[i + j]?.startsWith(word)));
};

/**
 * On the first page, a request naming an item on screen goes to it when Jev picked something else,
 * unless the pick has the same name (Administration's "General") and no row of that kind is current.
 */
function towardNamed<C extends WalkControl>(
  round: Round<C>,
  request: string,
  controls: C[],
): Round<C> {
  if (round.decision.kind === 'ask_ai' || round.offTarget) return round;
  const named = namedItem(request, controls);
  if (!named) return round;
  // Ids come from separate reads of the screen and can shift, so controls are compared by what they are.
  const namedKey = controlKey(named.item);
  const ids = pickedIds(round.decision);
  const isNamed = (id: string): boolean => {
    const option = round.optionOf(id);
    return !!option && controlKey(option) === namedKey;
  };
  if (ids.some(isNamed)) return round;
  const [first] = ids;
  const pick = first === undefined ? undefined : round.optionOf(first);
  // An item of a menu named for the item ("Duplicate" in "More actions for test") acts on it already.
  if (inMenu(pick) && saysName(pick.opener.text, named.name)) return round;
  const sameName = saysName(pick?.text ?? '', named.name);
  const kind = kindOf(named.item);
  const inKind = controls.some(c => c !== named.item && kindOf(c) === kind && isCurrent(c));
  if (sameName && !inKind) return round;
  const why = `the request names "${named.item.text}", so it is opened first`;
  return { ...confirmedRound(named.item), decision: { kind: 'act', id: named.item.id, why } };
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
  const lookedAgain = new Set<string>();
  const used = new Set<string>();
  let entered: { via: Option<C>; reply: string } | undefined;
  for (let step = 1; step <= MAX_PAGES; step++) {
    const looked =
      step === 1 && confirmed ? confirmedRound(confirmed) : await lookHere(request, env, !!entered);
    const found = looked && followsLink(looked);
    if (found === null || env.aborted()) {
      await closeUnused(env, found);
      env.log('stopped', 'while looking');
      return { reply: STOPPED, why: 'stopped' };
    }
    const round =
      found && !entered && !confirmed
        ? towardNamed(
            found,
            request,
            env.readScreen().controls.filter(control => untried(env, control)),
          )
        : found;
    if (round !== found) await closeUnused(env, found);
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
 * Walks a request step by step, each on the screen the one before left, going on only after a click:
 * what changes data is pointed at, and a "Did you mean…?" waits. `resume` goes on after a yes.
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
