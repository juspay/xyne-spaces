/**
 * What a screen says, and whether it takes typing.
 *
 * The wording is the WAIT's own prompt, and can quote anything the frames
 * around it fetched. Typing is the CONDITIONAL after it: with one, a message
 * goes to the router; without, the screen only takes what it offers.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray, asRec, asSteps, type Rec, type Step } from '../json.js';
import { caseFor } from '../locate.js';
import { routersFor } from '../routers.js';
import { carriedTo, textKeyOf } from '../rounds.js';
import { ConversationalFlowEditError, requireFlow, settle } from '../settle.js';
import { jumpStep, partsOf, stepIn } from '../shape.js';
import type { ConversationalFlow, Screen } from '../types.js';

/**
 * What the screen says — one message, or several sent one after another. It may
 * quote what any frame around it fetched.
 *
 * The whole list at once, because that is what the editor holds: adding,
 * removing and reordering are all the same edit, and a per-message setter would
 * be three more ways to say this one.
 */
export function setPromptSays(config: WorkflowConfig, promptId: string, says: string[]): WorkflowConfig {
  requireFlow(config);
  return settle(config, (draft) => {
    const flow = requireFlow(draft);
    questionStep(draft, flow, promptId).config['prompt'] = [...says];
  });
}

/**
 * "The router sends people here when…" — what the router is told about this
 * screen. On a Finish it is also what allows typing to end a conversation here.
 */
export function setAbout(config: WorkflowConfig, screenId: string, about: string): WorkflowConfig {
  const flow = requireFlow(config);
  requireScreen(flow, screenId);
  const text = about.trim();
  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const screen = requireScreen(live, screenId);
    const entry = caseFor(draft, live, screen);
    const step = entry ? partsOf(entry, live.routeKey).rest[0] : undefined;
    if (!step) throw new ConversationalFlowEditError(`“${screen.title}” has nothing to describe.`);
    if (text) step.description = text;
    else delete step.description;
  });
}

/**
 * Whether a typed message is taken here.
 *
 * With typing, the question carries a text field and the steps after it split:
 * something typed goes to the router, a tap goes wherever the option says.
 * Without, the text field goes and the tap is all that is left.
 */
export function setTypingAllowed(config: WorkflowConfig, screenId: string, allowed: boolean): WorkflowConfig {
  const flow = requireFlow(config);
  const screen = requireScreen(flow, screenId);
  const prompt = screen.prompts[0];
  if (!prompt) throw new ConversationalFlowEditError(`“${screen.title}” doesn’t ask anything.`);
  if ((prompt.textField !== undefined) === allowed) return config;

  // The nearest router that serves this screen: a section's own, when it has one.
  const router = routersFor(flow, screenId)[0];
  if (allowed && !router) {
    throw new ConversationalFlowEditError('This flow has no router, so a typed message would have nowhere to go.');
  }

  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const entry = caseFor(draft, live, requireScreen(live, screenId));
    if (!entry) return;
    const steps = asSteps(entry['steps']);
    const { rest } = partsOf(entry, live.routeKey);
    // Whatever the screen fetches on the way in stays exactly where it is.
    const leading = steps.slice(0, steps.length - rest.length);

    // A screen that asks more than one way has one question per branch, and
    // typing is about the screen — so every branch changes together.
    if (rest.length === 1 && rest[0]?.type === 'SWITCH') {
      const versions = asRec(rest[0].config);
      for (const raw of asArray(versions['cases'])) {
        const branch = asRec(raw);
        branch['steps'] = retell(draft, live, asSteps(branch['steps']), allowed, router?.id);
      }
      versions['default'] = retell(draft, live, asSteps(versions['default']), allowed, router?.id);
      return;
    }

    const [wait, ...after] = rest;
    if (!wait) return;
    const fields = fieldsIn(wait);

    if (!allowed) {
      const field = fields.findIndex((f) => f['type'] === 'text' || f['type'] === 'textarea');
      if (field >= 0) fields.splice(field, 1);
      // What the tap did is all that is left of the branch that split them.
      const gate = after[0];
      const tapped = gate?.type === 'CONDITIONAL' ? asSteps(asRec(gate.config)['if_false']) : after;
      entry['steps'] = [...leading, wait, ...tapped];
      return;
    }

    const name = textFieldName(live);
    fields.push({ type: 'text', name, label: 'Or type your question' });
    const typed = `{{steps.${wait.id}.output.resumeData.data.${name}}}`;
    const gate: Step = {
      id: `typed_${screenId}`,
      type: 'CONDITIONAL',
      config: {
        condition: { all: [{ variable: typed, operator: 'exists' }, { variable: typed, operator: 'neq', value: '' }] },
        if_true: [
          jumpStep(`typed_go_${screenId}`, live.rootScreen, {
            ...carriedTo(draft, live, router!.id),
            [textKeyOf(draft, live)]: typed,
          }),
        ],
        if_false: after,
      },
    };
    entry['steps'] = [...leading, wait, gate];
  });
}

/**
 * One way of asking, with typing turned on or off. The question keeps whatever
 * it says and offers; only what happens to a typed message changes.
 */
function retell(
  draft: WorkflowConfig,
  flow: ConversationalFlow,
  asked: Step[],
  allowed: boolean,
  routerId: string | undefined,
): Step[] {
  const [wait, ...after] = asked;
  if (!wait) return asked;
  const fields = fieldsIn(wait);

  if (!allowed) {
    const at = fields.findIndex((f) => f['type'] === 'text' || f['type'] === 'textarea');
    if (at >= 0) fields.splice(at, 1);
    // What the tap did is all that is left of the branch that split them.
    const gate = after[0];
    const tapped = gate?.type === 'CONDITIONAL' ? asSteps(asRec(gate.config)['if_false']) : after;
    return [wait, ...tapped];
  }
  if (!routerId) return asked;

  const name = textFieldName(flow);
  fields.push({ type: 'text', name, label: 'Or type your question' });
  const typed = `{{steps.${wait.id}.output.resumeData.data.${name}}}`;
  return [
    wait,
    {
      id: `typed_${wait.id}`,
      type: 'CONDITIONAL',
      config: {
        condition: { all: [{ variable: typed, operator: 'exists' }, { variable: typed, operator: 'neq', value: '' }] },
        if_true: [jumpStep(`typed_go_${wait.id}`, flow.rootScreen, { ...carriedTo(draft, flow, routerId), [textKeyOf(draft, flow)]: typed })],
        if_false: after,
      },
    },
  ];
}

// ─── Plumbing ───

function questionStep(config: WorkflowConfig, flow: ConversationalFlow, promptId: string): Step {
  for (const screen of flow.screens) {
    if (!screen.prompts.some((p) => p.id === promptId)) continue;
    const entry = caseFor(config, flow, screen);
    const wait = entry ? stepIn(partsOf(entry, flow.routeKey).rest, promptId) : undefined;
    if (wait) return wait;
  }
  throw new ConversationalFlowEditError(`There is no question “${promptId}”.`);
}

function fieldsIn(wait: Step): Rec[] {
  const form = asRec(wait.config['form']);
  if (!Array.isArray(form['fields'])) form['fields'] = [];
  wait.config['form'] = form;
  return form['fields'] as Rec[];
}

/** The name this flow already gives its text field, so a screen matches the rest. */
function textFieldName(flow: ConversationalFlow): string {
  for (const screen of flow.screens) {
    for (const prompt of screen.prompts) if (prompt.textField) return prompt.textField;
  }
  return 'message';
}

function requireScreen(flow: ConversationalFlow, id: string): Screen {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new ConversationalFlowEditError(`There is no screen “${id}”.`);
  return screen;
}
