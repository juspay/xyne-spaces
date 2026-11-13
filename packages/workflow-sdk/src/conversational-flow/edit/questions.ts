/**
 * A screen whose purpose is to ask, and what it asks for.
 *
 * The question is written where a section's lookup goes — before the frame —
 * which is the whole point. A section's case is opened by its whole subtree, so
 * a jump aimed at a screen four levels down still descends through it: no jump
 * has to carry an answer, and no router can skip one.
 *
 * The whole list in one edit, because that is what the editor holds: adding one,
 * renaming one and dropping one are the same act. An empty list is a question
 * with nothing to fill in yet, not the absence of one.
 *
 * Nothing it navigates by is the author's to write. Answering is how they go on,
 * so the only thing offered is not answering — the ways out, from `waysBack`,
 * the same list every other screen offers.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray, asRec, str, type Rec } from '../json.js';
import { sectionCaseFor } from '../locate.js';
import { ANSWER_KEY, formFor } from '../questions.js';
import { frameFor } from './cases.js';
import { newScreenSteps, offerOn, refuseAsAParent } from './screens.js';
import { carriedTo, inheritedInput } from '../rounds.js';
import { ConversationalFlowEditError, requireFlow, settle } from '../settle.js';
import { cycleStep, jumpStep, partsOf, screenCase, sectionCase, switchStep, type AskingSteps } from '../shape.js';
import type { ConversationalFlow, QuestionDraft, QuestionField, Screen } from '../types.js';
import { setWayBack, waysBack } from './options.js';
import type { NewScreenType } from './kinds.js';

/**
 * Add a screen whose whole purpose is to ask for something.
 *
 * It is a frame with one screen inside it and nothing of its own to ask twice:
 * the question sits before the frame, so whatever they answer is in scope for
 * the screen inside and everything below it, and its own case only moves on.
 * That is why it is passed through once rather than returned to.
 */
export function addInputScreen(
  config: WorkflowConfig,
  args: {
    parent: string;
    title: string;
    /** What it asks for. An empty list is a question with nothing to fill in yet. */
    asks?: readonly QuestionDraft[];
    /** What the answers are for, for whoever reads the runs. */
    purpose?: string;
    /** The one screen inside it — where the answers are read. */
    next?: { title: string; type?: NewScreenType };
  },
): { config: WorkflowConfig; screenId: string; nextId: string } {
  const flow = requireFlow(config);
  const parent = requireScreen(flow, args.parent);
  refuseAsAParent(parent);
  const title = args.title.trim();
  if (!title) throw new ConversationalFlowEditError('A screen needs a name.');

  const taken = new Set(flow.screens.map((s) => s.id));
  const screenId = unique(slug(title), taken);
  taken.add(screenId);
  const nextTitle = args.next?.title?.trim() || 'What happens next';
  const nextId = unique(slug(nextTitle), taken);

  // The frame and the screen inside it are written together, because neither is
  // a screen on its own: the question needs somewhere to let them in to, and
  // what is inside needs the question in front of it.
  let next = settle(config, (draft) => {
    const live = requireFlow(draft);
    const inside = screenCase(nextId, nextTitle, newScreenSteps(draft, live, nextId, nextTitle, requireScreen(live, args.parent), {
      title: nextTitle,
      parent: args.parent,
      ...(args.next?.type ? { type: args.next.type } : {}),
    }), live.routeKey);
    frameFor(draft, live, args.parent).push(
      sectionCase([screenId, nextId], title, [
        cycleStep(screenId, inheritedInput(draft, live), [
          switchStep(`${screenId}_route`, [
            // Answering is the way on, so its own case has only to move on.
            screenCase(screenId, title, [jumpStep(`into_${screenId}`, screenId, carriedTo(draft, live, nextId))], live.routeKey),
            inside,
          ], [jumpStep(`${screenId}_unknown`, screenId, carriedTo(draft, live, nextId))]),
        ]),
      ], live.routeKey),
    );
    offerOn(draft, requireFlow(draft), args.parent, { label: title, value: screenId });
  });

  next = setWayBack(next, nextId, true);
  next = setQuestion(next, screenId, args.asks ?? []);
  if (args.purpose) next = setQuestionPurpose(next, screenId, args.purpose);
  return { config: next, screenId, nextId };
}

/**
 * Ask for these, in this order, on the way into `screenId`.
 *
 * An empty list is a question with nothing to fill in yet, not the absence of
 * one: an input screen always asks, because that is what it is for — at the
 * least, which way on they are taking.
 */
export function setQuestion(config: WorkflowConfig, screenId: string, asks: readonly QuestionDraft[]): WorkflowConfig {
  const flow = requireFlow(config);
  const asked = checked(flow, requireAskable(flow, screenId), asks);

  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const screen = requireAskable(live, screenId);
    const section = sectionCaseFor(draft, live, screen);
    if (!section) throw new ConversationalFlowEditError(`“${screen.title}” has no frame to ask on the way into.`);
    // The array has to be the one the config holds, since it is spliced below.
    const steps = asArray(section['steps']);
    section['steps'] = steps;

    // Out with whatever it asked before: this list is the whole question.
    const before = partsOf(section, live.routeKey).asking;
    const said = before ? asArray(asRec(before.step.config)['prompt']) : [];
    const purpose = before ? str(asRec(before.step.config)['purpose']) : undefined;
    const waitId = before?.step.id ?? unique(`ask_${screenId}_entry`, takenIds(draft));

    const choice = choiceFieldName(live);
    const form = formFor(asked);
    // Answering is how they go on — the screen inside opens by itself — so the
    // only thing to offer is not answering. An author may take even that away.
    const ways = waysBack(live, screen);
    if (ways.length > 0) (form['fields'] as Rec[]).push({ type: 'select', name: choice, label: 'Or', options: ways });

    const at = before ? steps.findIndex((step) => asRec(step)['id'] === before.step.id) : steps.findIndex(isCycleStep);
    steps.splice(
      at < 0 ? steps.length : at,
      before ? (before.guard ? 2 : 1) : 0,
      { id: waitId, type: 'WAIT', config: { mode: 'approval', prompt: said, form, ...(purpose ? { purpose } : {}) } },
      ...(ways.length > 0 ? [leaving(draft, live, waitId, choice)] : []),
    );
  });
}

/**
 * What its answers are for, in a word the people reading the runs will know —
 * `feedback`, or whatever this flow calls its own kind of question. Empty takes
 * the label off again.
 *
 * It is never read by the flow: it is for whoever receives the answers, which
 * is why it is a word rather than a list this layer polices.
 */
export function setQuestionPurpose(config: WorkflowConfig, screenId: string, purpose: string): WorkflowConfig {
  const flow = requireFlow(config);
  requireAskable(flow, screenId);
  const word = purpose.trim();

  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const way = askingOn(draft, live, requireAskable(live, screenId));
    if (!way) throw new ConversationalFlowEditError('This screen doesn’t ask for anything.');
    if (word) way.step.config['purpose'] = word;
    else delete way.step.config['purpose'];
  });
}

/**
 * What it says while asking — one message, or several. It may quote whatever the
 * frames around it fetched, since those ran before it.
 */
export function setQuestionSays(config: WorkflowConfig, screenId: string, says: string[]): WorkflowConfig {
  const flow = requireFlow(config);
  requireAskable(flow, screenId);
  // Written as given, as a screen's own wording is: the list is the whole of
  // what it says, and an empty line is a box waiting to be typed in rather
  // than a line to throw away.
  const lines = [...says];

  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const way = askingOn(draft, live, requireAskable(live, screenId));
    if (!way) throw new ConversationalFlowEditError('This screen doesn’t ask for anything on the way in.');
    way.step.config['prompt'] = lines;
  });
}

// ─── Plumbing ───

/** The question a screen asks on the way in, live, so a caller can change it. */
function askingOn(draft: WorkflowConfig, flow: ConversationalFlow, screen: Screen): AskingSteps | undefined {
  const section = sectionCaseFor(draft, flow, screen);
  return section ? partsOf(section, flow.routeKey).asking : undefined;
}

/** Whether a step is the frame a question is asked in front of. */
function isCycleStep(step: unknown): boolean {
  return asRec(step)['type'] === 'CYCLE';
}

/**
 * The branch that lets them leave instead of answering.
 *
 * Nothing picked falls through to the frame, which is how answering opens the
 * screen inside: that is what the question is for, so it needs no button.
 */
function leaving(draft: WorkflowConfig, flow: ConversationalFlow, waitId: string, choice: string): Rec {
  const ref = `{{steps.${waitId}.output.resumeData.data.${choice}}}`;
  return {
    id: `leave_${waitId}`,
    type: 'CONDITIONAL',
    config: {
      condition: {
        all: [
          { variable: ref, operator: 'exists' },
          { variable: ref, operator: 'neq', value: '' },
        ],
      },
      if_true: [
        jumpStep(`left_${waitId}`, flow.rootScreen, { ...carriedTo(draft, flow, flow.rootScreen), [flow.routeKey]: ref }),
      ],
    },
  };
}

/** How a refusal says which kind is already asked for. */
const VERB: Record<QuestionDraft['kind'], string> = { text: 'type', choice: 'pick', attachment: 'attach' };

/** What this flow calls the field a question is navigated by, so a new one matches. */
function choiceFieldName(flow: ConversationalFlow): string {
  for (const screen of flow.screens) {
    for (const prompt of screen.prompts) if (prompt.choiceField) return prompt.choiceField;
  }
  return 'choice';
}

/**
 * The fields as they will be written: labelled, one of each kind, and named by
 * the kind rather than by the author — so the same answer is called the same
 * thing in every flow. A row with no label is one nobody has filled in.
 */
function checked(
  flow: ConversationalFlow,
  screen: Screen,
  asks: readonly QuestionDraft[],
): QuestionField[] {
  const seen = new Set<QuestionField['kind']>();
  const out: QuestionField[] = [];
  for (const ask of asks) {
    const label = ask.label.trim();
    if (label === '') continue;
    // One of each kind, because the key is the kind: two things to pick would
    // both be `selectedOptions`, and the second would overwrite the first.
    if (seen.has(ask.kind)) {
      throw new ConversationalFlowEditError(`It already asks for something to ${VERB[ask.kind]}; a question asks for one of each.`);
    }
    seen.add(ask.kind);
    if (ask.required && waysBack(flow, screen).length === 0) {
      throw new ConversationalFlowEditError(`“${label}” can’t be required here: there would be no way past it.`);
    }
    out.push({
      ...ask,
      name: ANSWER_KEY[ask.kind],
      label,
      required: ask.required === true,
      choices: ask.choices ?? [],
      multiple: ask.multiple === true,
    });
  }
  return out;
}

/**
 * Only an input screen asks on the way in.
 *
 * A screen that also has a question of its own would ask twice — once on the way
 * in and again every time someone came back to it — so asking belongs to the
 * kind whose whole purpose is to ask, and {@link addInputScreen} is how one is made.
 */
function requireAskable(flow: ConversationalFlow, id: string): Screen {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new ConversationalFlowEditError(`There is no screen “${id}”.`);
  if (screen.kind !== 'input') {
    throw new ConversationalFlowEditError(`“${screen.title}” isn’t a screen that asks for something — add one inside it instead.`);
  }
  return screen;
}

function takenIds(config: WorkflowConfig): Set<string> {
  const out = new Set<string>();
  const walk = (steps: unknown[]): void => {
    for (const raw of steps) {
      const step = asRec(raw);
      if (typeof step['id'] === 'string') out.add(step['id']);
      for (const value of Object.values(asRec(step['config']))) {
        if (!Array.isArray(value)) continue;
        walk(value);
        for (const entry of value) walk(asArray(asRec(entry)['steps']));
      }
    }
  };
  walk(asArray(config.steps));
  return out;
}

/** An id from a title, as every other screen gets one. */
function slug(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'screen';
}

/** A screen by id, or a refusal naming it. */
function requireScreen(flow: ConversationalFlow, id: string): Screen {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new ConversationalFlowEditError(`There is no screen “${id}”.`);
  return screen;
}

function unique(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base}_${n}`;
  return name;
}
