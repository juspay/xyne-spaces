/**
 * A new conversation: the smallest one that runs, and grows.
 *
 *   CYCLE start  input { screen: 'start', text: '' }
 *   └ SWITCH start_route
 *      ├ start      — the first screen: a greeting, no options yet
 *      ├ ai_router  — typed text → a classifier (or an agent) names the screen
 *      ├ done       — Finish
 *      └ default    → start
 *
 * The conversation's own cycle is named after its first screen, because a
 * section and its screen are one thing; every section added later is a cycle
 * inside this one. This is the one place that names the round's keys (`screen`,
 * `text`) and the fields (`choice`, `message`) — every later edit copies
 * whatever shape the flow already has.
 *
 * Everything derived — what the router may open and how it is asked, the
 * headings, where each jump is aimed — is left to `settle`.
 */
import type { WorkflowConfig } from '../types/workflow-config.js';
import type { Rec } from './json.js';
import { refreshDerived } from './settle.js';
import { carrying, cycleStep, DEFAULT_ROUTE_KEY, finishStep, jumpStep, screenCase, switchStep } from './shape.js';
import { AGENT_STEP_TYPE, CLASSIFIER_STEP_TYPE } from './types.js';

export { CONVERSATIONAL_FLOW_KIND } from '../types/known-types.js';
import { CONVERSATIONAL_FLOW_KIND } from '../types/known-types.js';

/** How typed messages are routed: a classifier model, or an agent asked for JSON. */
export type NewRouter =
  | {
      kind: 'classifier';
      model?: string;
      credentialName?: string;
      /** Below this, send them back to the first screen instead of guessing. */
      minConfidence?: number;
    }
  | { kind: 'agent'; agentSlug?: string };

export interface NewConversationalFlow {
  config: WorkflowConfig;
  /** Stored on the workflow so it opens in the conversational-flow editor. */
  metadata: { kind: typeof CONVERSATIONAL_FLOW_KIND };
}

export function createConversationalFlow(
  options: {
    /** How typed text is routed. A classifier unless an agent is asked for. */
    router?: NewRouter;
    /** Shorthand for `router: { kind: 'agent', agentSlug }`. */
    agentSlug?: string;
    greeting?: string;
    /** The first screen's name, and the heading on it. */
    title?: string;
  } = {},
): NewConversationalFlow {
  const title = options.title?.trim() || 'Start';
  const greeting = options.greeting?.trim() || 'Hi! How can I help?';
  const first = 'start';
  const keys = [DEFAULT_ROUTE_KEY, TEXT_KEY];
  const home = (screen: string) => carrying(keys, DEFAULT_ROUTE_KEY, screen);
  const typed = `{{steps.ask_${first}.output.resumeData.data.message}}`;

  const config = {
    trigger: { type: 'MANUAL', config: {} },
    steps: [
      cycleStep(first, { [DEFAULT_ROUTE_KEY]: first, [TEXT_KEY]: '' }, [
        switchStep(
          `${first}_route`,
          [
            screenCase(first, title, [
              {
                id: `ask_${first}`,
                type: 'WAIT',
                config: {
                  reason: title,
                  prompt: [greeting],
                  form: {
                    fields: [
                      { type: 'select', name: 'choice', label: 'Choose one', options: [] },
                      { type: 'text', name: 'message', label: 'Or type your question' },
                    ],
                  },
                },
              },
              {
                id: `typed_${first}`,
                type: 'CONDITIONAL',
                config: {
                  condition: {
                    all: [
                      { variable: typed, operator: 'exists' },
                      { variable: typed, operator: 'neq', value: '' },
                    ],
                  },
                  if_true: [jumpStep(`route_${first}`, first, { ...home(ROUTER_ID), [TEXT_KEY]: typed })],
                  if_false: [
                    jumpStep(`go_${first}`, first, home(`{{steps.ask_${first}.output.resumeData.data.choice}}`)),
                  ],
                },
              },
            ]),
            screenCase(ROUTER_ID, 'AI router', decidingWith(options), DEFAULT_ROUTE_KEY),
            screenCase('done', 'Finish', [finishStep('finish', first, { outcome: 'done' })]),
          ],
          [jumpStep('unknown_screen', first, home(first))],
        ),
      ]),
    ],
  } as unknown as WorkflowConfig;

  return { config: refreshDerived(config), metadata: { kind: CONVERSATIONAL_FLOW_KIND } };
}

/** The key holding what they typed, on the way to the router. */
const TEXT_KEY = 'text';
const ROUTER_ID = 'ai_router';

/**
 * What reads a typed message, and the jump that carries its answer on. A
 * classifier puts the message in one of the screens; an agent is asked for the
 * same answer as JSON. What either is told is written by `settle`.
 */
function decidingWith(options: { router?: NewRouter; agentSlug?: string }): unknown[] {
  const router: NewRouter =
    options.router ?? (options.agentSlug ? { kind: 'agent', agentSlug: options.agentSlug } : { kind: 'classifier' });
  const keys = [DEFAULT_ROUTE_KEY, TEXT_KEY];

  if (router.kind === 'agent') {
    const step: Rec = {
      id: 'classify',
      type: AGENT_STEP_TYPE,
      config: { agentSlug: router.agentSlug?.trim() ?? '', task: '', outputType: 'json' },
    };
    return [step, jumpStep('go_classified', 'start', carrying(keys, DEFAULT_ROUTE_KEY, `{{steps.classify.output.response.${DEFAULT_ROUTE_KEY}}}`))];
  }

  const step: Rec = {
    id: 'classify',
    type: CLASSIFIER_STEP_TYPE,
    config: {
      input: '',
      instructions: '',
      classes: {},
      ...(router.model ? { model: router.model } : {}),
      ...(router.credentialName ? { credentialName: router.credentialName } : {}),
      ...(router.minConfidence !== undefined ? { minConfidence: router.minConfidence } : {}),
    },
  };
  return [step, jumpStep('go_classified', 'start', carrying(keys, DEFAULT_ROUTE_KEY, '{{steps.classify.output.class}}'))];
}
