/**
 * What each kind of screen is made of.
 *
 * One place, because two edits need it: adding a screen, and changing what kind
 * an existing one is. Every builder models itself on a question the flow already
 * has — the same field names, the same way of telling typing from tapping — so a
 * screen added to a flow looks like the rest of it rather than like this file.
 *
 * Nothing here is derived: the headings, the subtrees, where the jumps are
 * aimed and what a hand off offers are all written by `settle` afterwards.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray, asRec, str, type Rec, type Step } from '../json.js';
import { caseFor } from '../locate.js';
import { carriedTo, textKeyOf } from '../rounds.js';
import { finishStep, jumpStep, partsOf } from '../shape.js';
import {
  AGENT_STEP_TYPE,
  CLASSIFIER_STEP_TYPE,
  END_MESSAGE_KEY,
  HANDOFF_SECTION,
  optionsOf,
  QUESTION_SEPARATOR,
  type ConversationalFlow,
  type Screen,
} from '../types.js';

/** Everything the builders share: who is being built, and what it says. */
export interface Building {
  screenId: string;
  title: string;
  /** What the screen says. */
  prompt: string;
  /** The options it offers — its ways back, and whatever its kind adds. */
  options: Rec[];
  /** The router its typed text goes to. Without one, the flow's own. */
  router?: string;
  /**
   * The heading above it. Left out for a screen, whose heading is where it sits
   * and so is written by `settle`; given for a follow-up, which is asked inside
   * another question rather than anywhere of its own.
   */
  header?: string;
}

/**
 * What a screen of this kind is made of — the one place that decides, so a screen
 * created as a Finish and a screen turned into one are the same screen.
 */
export function stepsForKind(
  draft: WorkflowConfig,
  flow: ConversationalFlow,
  kind: 'menu' | 'message' | 'ask-ai' | 'end' | 'handoff' | undefined,
  args: Building & { agentSlug?: string },
): unknown[] {
  if (kind === 'end') return endingSteps(flow, args);
  if (kind === 'handoff') return handoffSteps(draft, flow, args);
  if (kind === 'ask-ai') {
    return askAiSteps(draft, flow, { ...args, prompt: args.prompt || `Ask me anything about ${args.title.toLowerCase()}.` });
  }
  if (kind === 'message') {
    // Somewhere to go when it is done, if the flow has an ending that belongs to
    // no branch in particular.
    const exit = sharedExit(flow, args.screenId);
    if (exit) args.options.push({ label: 'That’s all', value: exit.id });
  }
  return questionSteps(draft, flow, args);
}

/** A screen that asks: the question, and where each answer goes. */
export function questionSteps(draft: WorkflowConfig, flow: ConversationalFlow, args: Building): unknown[] {
  const waitId = `ask_${args.screenId}`;
  const fields = fieldsFor(draft, flow, modelPrompt(flow));
  const select = fields.find((f) => f['type'] === 'select');
  if (select) select['options'] = args.options;

  // Without a heading, `settle` writes where the screen sits once it knows.
  const wait: Rec = {
    id: waitId,
    type: 'WAIT',
    config: { ...(args.header !== undefined ? { reason: args.header } : {}), prompt: args.prompt ? [args.prompt] : [], form: { fields } },
  };

  // What they tapped is carried on as the next screen.
  const tapped: unknown[] = [
    jumpStep(`go_${args.screenId}`, flow.rootScreen, {
      ...carriedTo(draft, flow, flow.rootScreen),
      [flow.routeKey]: `{{steps.${waitId}.output.resumeData.data.${str(select?.['name']) ?? 'choice'}}}`,
    }),
  ];

  const textField = str(fields.find((f) => f['type'] === 'text')?.['name']);
  const router = args.router ?? flow.screens.find((s) => s.kind === 'router')?.id;
  if (!router || !textField) return [wait, ...tapped];
  return [wait, typedGate(draft, flow, args.screenId, waitId, textField, router, tapped)];
}

/**
 * The end of the conversation. Whatever the screen said becomes its last word,
 * so turning a Message into a Finish keeps its wording instead of dropping it.
 */
export function endingSteps(flow: ConversationalFlow, args: Pick<Building, 'screenId' | 'prompt'>): unknown[] {
  return [
    finishStep(`finish_${args.screenId}`, flow.rootScreen, {
      ...(args.prompt ? { [END_MESSAGE_KEY]: args.prompt } : {}),
      outcome: args.screenId,
    }),
  ];
}

/**
 * A person has it from here.
 *
 * The run pauses on a WAIT only they answer — no text box, since the customer is
 * talking to them now — and a jump carries their answer on: an ending closes the
 * conversation, a screen sends it back into the flow. What they may choose is
 * written by `settle`.
 */
export function handoffSteps(draft: WorkflowConfig, flow: ConversationalFlow, args: Pick<Building, 'screenId'>): unknown[] {
  const waitId = `handoff_${args.screenId}`;
  const fields = fieldsFor(draft, flow, modelPrompt(flow)).filter((f) => f['type'] === 'select');
  for (const field of fields) field['options'] = [];
  const select = fields[0];

  return [
    {
      id: waitId,
      type: 'WAIT',
      config: {
        mode: 'approval',
        prompt: [],
        display: [{ id: HANDOFF_SECTION, label: 'Handed off to a person', value: '' }],
        form: { fields },
      },
    },
    jumpStep(`go_${args.screenId}`, flow.rootScreen, {
      ...carriedTo(draft, flow, flow.rootScreen),
      [flow.routeKey]: `{{steps.${waitId}.output.resumeData.data.${str(select?.['name']) ?? 'choice'}}}`,
    }),
  ];
}

/**
 * An agent that answers until they leave.
 *
 * It opens like any screen — the intro, the ways out, a text box — and a typed
 * question goes to an agent that answers and then waits for a reply: another
 * question is answered in place, and tapping one of the ways out carries them
 * there. So the whole exchange is one round of the conversation.
 */
export function askAiSteps(draft: WorkflowConfig, flow: ConversationalFlow, args: Building & { agentSlug?: string }): unknown[] {
  const built = questionSteps(draft, flow, args);
  const gate = built[1] as Step | undefined;
  if (gate?.type !== 'CONDITIONAL') {
    throw new AskAiUnsupported('Ask AI needs a flow whose screens take typed messages.');
  }

  const waitId = `ask_${args.screenId}`;
  const agentId = `ai_${args.screenId}`;
  const textField = str(
    asArray(asRec(asRec((built[0] as Rec)['config'])['form'])['fields']).map(asRec).find((f) => f['type'] === 'text')?.['name'],
  );
  const agent: Rec = {
    id: agentId,
    type: AGENT_STEP_TYPE,
    config: {
      agentSlug: args.agentSlug ?? flow.screens.find((s) => s.router?.mode === 'agent')?.router?.agent ?? '',
      task:
        `Answer their questions about ${args.title}. Use your connected systems and sources, and say so plainly when you are not sure.` +
        QUESTION_SEPARATOR +
        `{{steps.${waitId}.output.resumeData.data.${textField ?? 'message'}}}`,
      outputType: 'string',
      waitForReply: true,
    },
  };
  // The agent is told to name one of the ways out; that is what ends the exchange.
  gate.config['if_true'] = [
    agent,
    jumpStep(`leave_${args.screenId}`, flow.rootScreen, {
      ...carriedTo(draft, flow, flow.rootScreen),
      [flow.routeKey]: `{{steps.${agentId}.output.choice}}`,
    }),
  ];
  return built;
}

export class AskAiUnsupported extends Error {
  override readonly name = 'AskAiUnsupported';
}

/** What decides where typed text goes: a classifier model, or one of the agents. */
export type RouterMode =
  | { mode: 'classifier'; model?: string; credentialName?: string; minConfidence?: number }
  | { mode: 'agent'; agentSlug: string };

/**
 * A router: the step that reads a typed message and names a screen, and the jump
 * that carries its answer on.
 *
 * What it is told, the screens it may choose and where an unsure message goes are
 * all written by `settle`, from the frame the router ends up in.
 */
export function routerSteps(
  draft: WorkflowConfig,
  flow: ConversationalFlow,
  args: { screenId: string; wanted: RouterMode; stepId?: string },
): unknown[] {
  const stepId = args.stepId ?? `decide_${args.screenId}`;
  const step = decidingStep(stepId, args.wanted);
  return [
    step,
    jumpStep(`go_${args.screenId}`, flow.rootScreen, {
      ...carriedTo(draft, flow, flow.rootScreen),
      [flow.routeKey]: routerAnswer(stepId, args.wanted, flow.routeKey),
    }),
  ];
}

/** The deciding step itself, keeping anything the author wrote on the old one. */
export function decidingStep(stepId: string, wanted: RouterMode, description?: string): Rec {
  const kept = { id: stepId, ...(description ? { description } : {}) };
  if (wanted.mode === 'agent') {
    // Its brief and the shape of its answer are written by `settle`.
    return { ...kept, type: AGENT_STEP_TYPE, config: { agentSlug: wanted.agentSlug.trim(), task: '', outputType: 'json' } };
  }
  return {
    ...kept,
    type: CLASSIFIER_STEP_TYPE,
    config: {
      input: '',
      instructions: '',
      classes: {},
      ...(wanted.model ? { model: wanted.model } : {}),
      ...(wanted.credentialName ? { credentialName: wanted.credentialName } : {}),
      ...(wanted.minConfidence !== undefined ? { minConfidence: wanted.minConfidence } : {}),
    },
  };
}

/** How the jump after a router names what it chose. */
export function routerAnswer(stepId: string, wanted: RouterMode, routeKey: string): string {
  return wanted.mode === 'classifier' ? `{{steps.${stepId}.output.class}}` : `{{steps.${stepId}.output.response.${routeKey}}}`;
}

/**
 * The ending a new Message screen offers as "That's all": a way out of the
 * conversation that belongs to no branch in particular.
 *
 * A Finish that says something ("Your driver is 3 minutes away") is that
 * branch's own ending, and offering it from an unrelated screen would put words
 * in its mouth. So: a silent Finish first, then whichever ending the most
 * screens already lead to, and none at all when every ending belongs somewhere.
 */
export function sharedExit(flow: ConversationalFlow, exclude: string): Screen | undefined {
  const ends = flow.screens.filter((s) => s.kind === 'end' && s.id !== exclude);
  const silent = ends.filter((s) => s.endMessage === undefined);
  if (silent.length > 0) return silent[0];
  const leads = (id: string) =>
    flow.screens.filter((s) => optionsOf(s).some((o) => o.to.kind === 'screen' && o.to.screen === id)).length;
  return ends.filter((s) => leads(s.id) > 1).sort((a, b) => leads(b.id) - leads(a.id))[0];
}

// ─── What every question shares ───

/** Typing goes to the router; tapping goes wherever the tap says. */
function typedGate(
  draft: WorkflowConfig,
  flow: ConversationalFlow,
  screenId: string,
  waitId: string,
  textField: string,
  routerId: string,
  tapped: unknown[],
): Rec {
  const typed = `{{steps.${waitId}.output.resumeData.data.${textField}}}`;
  return {
    id: `typed_${screenId}`,
    type: 'CONDITIONAL',
    config: {
      condition: {
        all: [
          { variable: typed, operator: 'exists' },
          { variable: typed, operator: 'neq', value: '' },
        ],
      },
      if_true: [jumpStep(`typed_go_${screenId}`, flow.rootScreen, { ...carriedTo(draft, flow, routerId), [textKeyOf(draft, flow)]: typed })],
      if_false: tapped,
    },
  };
}

/** A question this flow already has, to model a new one on. */
function modelPrompt(flow: ConversationalFlow): string | undefined {
  return flow.screens.find((s) => (s.kind === 'menu' || s.kind === 'message') && s.prompts[0])?.prompts[0]?.id;
}

/** The form fields this flow uses, with the options emptied for a new screen. */
function fieldsFor(draft: WorkflowConfig, flow: ConversationalFlow, promptId: string | undefined): Rec[] {
  const fallback: Rec[] = [
    { type: 'select', name: 'choice', label: 'Choose one', options: [] },
    { type: 'text', name: 'message', label: 'Or type your question' },
  ];
  if (!promptId) return fallback;
  for (const screen of flow.screens) {
    if (!screen.prompts.some((p) => p.id === promptId)) continue;
    const entry = caseFor(draft, flow, screen);
    const wait = entry ? partsOf(entry, flow.routeKey).rest.find((s) => s.id === promptId) : undefined;
    const fields = asArray(asRec(wait?.config['form'])['fields']).map(asRec);
    if (fields.length === 0) break;
    // Only what navigates: what a screen asks for is its own, and copying it
    // would have every screen added afterwards asking the same thing.
    const navigates = new Set(
      [screen.prompts.find((p) => p.id === promptId)?.choiceField, textField(screen, promptId)].filter(
        (name): name is string => name !== undefined,
      ),
    );
    return fields
      .filter((field) => navigates.has(str(field['name']) ?? ''))
      .map((field) => ({ ...clone(field), ...(field['type'] === 'select' ? { options: [] } : {}) }));
  }
  return fallback;
}

/** The box this question's text goes in, routed or kept — still navigation to copy. */
function textField(screen: Screen, promptId: string): string | undefined {
  return screen.prompts.find((p) => p.id === promptId)?.textField;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
