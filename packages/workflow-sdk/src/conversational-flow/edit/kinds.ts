/**
 * Changing what kind of screen a screen is.
 *
 * The screen keeps its place in the tree, its name, its wording, what the router
 * is told about it, and anything it fetches on the way in — only the steps that
 * make it *that kind of screen* are rebuilt. So this is one write: the case's
 * steps, after the calls, replaced by what `build.ts` says this kind is made of.
 *
 * Menu and Message are one kind here. Which one a screen reads as follows from
 * whether anything is inside it, so asking for the other is not a change.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray, asRec, asSteps } from '../json.js';
import { caseFor } from '../locate.js';
import { demote, promote } from './cases.js';
import { ConversationalFlowEditError, requireFlow, settle } from '../settle.js';
import { routersFor } from '../routers.js';
import { partsOf, stepIn } from '../shape.js';
import { QUESTION_SEPARATOR, type ConversationalFlow, type Screen, type ScreenKind } from '../types.js';
import { AskAiUnsupported, stepsForKind } from './build.js';
import { optionList, waysBack } from './options.js';

/** The kinds an author can ask for. A router is made by adding one, not by conversion. */
export type NewScreenType = 'menu' | 'message' | 'ask-ai' | 'end' | 'handoff';

export function setScreenType(
  config: WorkflowConfig,
  screenId: string,
  type: NewScreenType,
  options: { agentSlug?: string } = {},
): WorkflowConfig {
  const flow = requireFlow(config);
  const screen = requireScreen(flow, screenId);
  if (screen.kind === 'router') {
    throw new ConversationalFlowEditError('A router decides where typed messages go; it isn’t a screen people see.');
  }
  if (screen.kind === 'input') {
    throw new ConversationalFlowEditError('An input screen asks for something on the way into the screens inside it; it is added rather than converted.');
  }
  if (sameKind(screen.kind, type)) return config;

  // Menu ↔ Message is only ever about the room beneath: the steps are the same,
  // so neither direction rebuilds the screen or touches what it says.
  const roomy = (k: ScreenKind | NewScreenType) => k === 'menu';
  if ((screen.kind === 'menu' || screen.kind === 'message') && (type === 'menu' || type === 'message')) {
    if (roomy(type) === screen.hasFrame) return config;
    // The first screen's objection comes before anything about its contents, as
    // it does on the path below: telling someone to move what is inside the
    // screen a conversation starts at asks for an outside that doesn't exist.
    if (screen.id === flow.rootScreen) {
      throw new ConversationalFlowEditError('The first screen holds the conversation; it is always a Menu.');
    }
    if (!roomy(type)) refuseIfItHoldsScreens(flow, screen);
    return settle(config, (draft) => {
      const live = requireFlow(draft);
      const at = requireScreen(live, screenId);
      if (roomy(type)) promote(draft, live, at);
      else demote(draft, live, at);
    });
  }

  const keepsOptions = asksSomething(type);
  if (screen.id === flow.rootScreen && !keepsOptions) {
    throw new ConversationalFlowEditError('The first screen opens the conversation, so it has to be one people can answer.');
  }
  if (!keepsOptions) refuseIfItHoldsScreens(flow, screen);

  // Whatever it said carries over: a Message turned into a Finish says it last.
  const wording = screen.prompts[0]?.says.join('\n\n') ?? screen.askAi?.intro ?? screen.endMessage ?? '';
  const hadOptions = asksSomething(screen.kind);

  try {
    return settle(config, (draft) => {
      const live = requireFlow(draft);
      const at = requireScreen(live, screenId);
      const entry = caseFor(draft, live, at);
      if (!entry) return;

      const kept = keepsOptions && hadOptions && at.prompts[0] ? clone(optionList(draft, live, at, at.prompts[0].id)) : undefined;
      const built = buildFor(draft, live, at, type, { wording, agentSlug: options.agentSlug });
      // Converting between the kinds that ask something keeps every option the
      // author made; converting from one that asks nothing starts from the ways back.
      if (kept) selectOptions(built[0]).splice(0, Infinity, ...kept);
      if (at.about) asRec(built[0])['description'] = at.about;

      // The calls it makes on the way in are the author's and stay where they are.
      const steps = asSteps(entry['steps']);
      const lead = steps.slice(0, steps.length - partsOf(entry, live.routeKey).rest.length);
      entry['steps'] = [...lead, ...built];

      // A Menu is a screen with room beneath it. Rebuilding the steps doesn't
      // make that room, so a screen asked to become one is given it here —
      // otherwise asking for a Menu quietly hands back a Message.
      if (type === 'menu') {
        const rebuilt = requireFlow(draft);
        const now = requireScreen(rebuilt, screenId);
        if (!now.hasFrame) promote(draft, rebuilt, now);
      }
    });
  } catch (error) {
    if (error instanceof AskAiUnsupported) throw new ConversationalFlowEditError(error.message);
    throw error;
  }
}

function buildFor(
  draft: WorkflowConfig,
  flow: ConversationalFlow,
  screen: Screen,
  type: NewScreenType,
  args: { wording: string; agentSlug: string | undefined },
): unknown[] {
  const nearest = routersFor(flow, screen.id)[0];
  return stepsForKind(draft, flow, type, {
    screenId: screen.id,
    title: screen.title,
    prompt: args.wording,
    options: waysBack(flow, screen),
    ...(nearest ? { router: nearest.id } : {}),
    ...(args.agentSlug ? { agentSlug: args.agentSlug } : {}),
  });
}

/**
 * What an Ask AI screen's agent is and how it is briefed.
 *
 * The question the person typed stays appended to the instructions, because that
 * is how the agent is given it — changing the brief never takes it away.
 */
export function setAskAi(
  config: WorkflowConfig,
  screenId: string,
  patch: { agent?: string; task?: string; intro?: string },
): WorkflowConfig {
  const flow = requireFlow(config);
  const screen = requireScreen(flow, screenId);
  if (!screen.askAi) throw new ConversationalFlowEditError(`“${screen.title}” doesn’t answer with an agent.`);

  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const at = requireScreen(live, screenId);
    const entry = caseFor(draft, live, at);
    const steps = entry ? partsOf(entry, live.routeKey).rest : [];
    const agent = stepIn(steps, at.askAi?.stepId ?? '');
    if (!agent) return;

    if (patch.agent !== undefined) agent.config['agentSlug'] = patch.agent.trim();
    if (patch.task !== undefined) {
      const task = typeof agent.config['task'] === 'string' ? agent.config['task'] : '';
      const question = task.lastIndexOf(QUESTION_SEPARATOR);
      agent.config['task'] = patch.task + (question === -1 ? '' : task.slice(question));
    }
    if (patch.intro !== undefined) {
      const wait = stepIn(steps, at.prompts[0]?.id ?? '');
      if (wait) wait.config['prompt'] = [patch.intro];
    }
  });
}

/**
 * What changing a screen's kind would cost, in the author's words — empty when
 * nothing is lost.
 *
 * The editor asks before it converts, and this is what it asks about. It lives
 * beside {@link setScreenType} because it describes what that function does: a
 * list kept anywhere else drifts from the conversion it is warning about.
 *
 * Refusals are not costs. A Menu holding screens cannot become anything else at
 * all, and says so when you try; nothing is destroyed to find that out.
 */
export function whatChangingTypeCosts(flow: ConversationalFlow, screenId: string, type: NewScreenType): string[] {
  const screen = flow.screens.find((s) => s.id === screenId);
  if (!screen || screen.kind === type) return [];

  const costs: string[] = [];
  // An agent's task is the longest thing an author writes; nothing carries it.
  // Said as two things rather than one, so a sentence listing several reads.
  if (screen.kind === 'ask-ai' && type !== 'ask-ai') {
    costs.push('the agent it asks');
    if (screen.askAi?.task) costs.push('what it is told to do');
  }
  // Only the kinds that ask keep a list of options — and a hand off's are
  // written for it by `writeHandoffs`, so they are not the author's to lose.
  if (!asksSomething(type) && screen.kind !== 'handoff' && screen.prompts.some((p) => p.options.some((o) => !o.back))) {
    costs.push('every option on this screen');
  }
  // What a screen asks on the way in belongs to the room beneath it, because
  // that is what the answers are in scope for. Lose the room, lose the question.
  if (screen.questions.length > 0 && type !== 'menu') costs.push('what it asks on the way in');
  // A hand off says nothing of its own; everything else carries its wording.
  if (type === 'handoff' && (screen.prompts[0]?.says.some(Boolean) || screen.endMessage || screen.askAi?.intro)) {
    costs.push('what it says');
  }
  return costs;
}

// ─── Plumbing ───

/** The kinds that ask something, and so have options to keep. */
function asksSomething(kind: ScreenKind | NewScreenType): boolean {
  return kind === 'menu' || kind === 'message';
}

/**
 * Menu and Message are built from the same steps — what separates them is the
 * room a Menu has beneath it. So going between the two is not a rebuild: it is
 * giving that room or taking it away, which {@link setScreenType} does on its
 * own before it decides there is nothing else to do.
 */
function sameKind(kind: ScreenKind, wanted: NewScreenType): boolean {
  return kind === wanted;
}

/** The options of whatever a kind's first step is, live. */
function selectOptions(step: unknown): unknown[] {
  const fields = asArray(asRec(asRec(asRec(step)['config'])['form'])['fields']).map(asRec);
  const select = fields.find((f) => f['type'] === 'select');
  if (!select) return [];
  if (!Array.isArray(select['options'])) select['options'] = [];
  return select['options'] as unknown[];
}

function requireScreen(flow: ConversationalFlow, id: string): Screen {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new ConversationalFlowEditError(`There is no screen “${id}”.`);
  return screen;
}

/**
 * Refuse a conversion that would leave what is inside with nowhere to be.
 *
 * Only a Menu has room beneath it, so every other kind reaches this same
 * question — and has to put it in the same words, which is why it is asked in
 * one place rather than at each conversion.
 */
function refuseIfItHoldsScreens(flow: ConversationalFlow, screen: Screen): void {
  if (screen.children.length === 0) return;
  const inside = flow.screens.filter((s) => s.parent === screen.id).map((s) => s.title);
  throw new ConversationalFlowEditError(
    `Move ${list(inside)} somewhere else first — ${inside.length === 1 ? 'it is' : 'they are'} inside “${screen.title}”.`,
  );
}

function list(titles: string[]): string {
  if (titles.length <= 1) return titles.map((t) => `“${t}”`).join('');
  const quoted = titles.map((t) => `“${t}”`);
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
