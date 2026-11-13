/**
 * Options that come from data rather than from a list an author wrote.
 *
 * A WAIT's select already accepts a reference in place of its array — the step's
 * own schema says so, and the resolver hands it the value rather than a string —
 * so this needs nothing new from the engine. What it needs is for the layer to
 * be able to say it, since a reader that only understands arrays shows an empty
 * screen and draws no lines.
 *
 * The trade is honest and worth stating: the destinations are no longer known
 * until it runs, so the map cannot draw where those taps go, and the router
 * cannot count them among the screens it may open.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray, asRec, str } from '../json.js';
import { caseFor } from '../locate.js';
import { ConversationalFlowEditError, requireFlow, settle } from '../settle.js';
import { partsOf, stepIn } from '../shape.js';
import type { ConversationalFlow, Screen } from '../types.js';
import { promptIn } from './options.js';

/**
 * Take this question's options from what a lookup found — `field` naming the
 * part of its answer that holds `[{ label, value }]`.
 */
export function setOptionsFromLookup(
  config: WorkflowConfig,
  promptId: string,
  callId: string,
  field: string,
): WorkflowConfig {
  const flow = requireFlow(config);
  const { screen } = promptIn(flow, promptId);
  const call = inScopeCall(flow, screen, callId);
  const path = field.trim();

  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const select = selectIn(draft, live, promptId);
    if (select) select['options'] = `{{steps.${call.id}.output.${path ? `body.${path}` : 'body'}}}`;
  });
}

/** Go back to a list the author writes, starting from nothing. */
export function setOptionsWritten(config: WorkflowConfig, promptId: string): WorkflowConfig {
  requireFlow(config);
  return settle(config, (draft) => {
    const live = requireFlow(draft);
    const select = selectIn(draft, live, promptId);
    if (select && typeof select['options'] === 'string') select['options'] = [];
  });
}

/** Where a question's options come from, when they come from a lookup. */
export function optionsFrom(screen: Screen, promptId: string): { callId: string; field: string } | undefined {
  const prompt = screen.prompts.find((p) => p.id === promptId);
  const ref = prompt?.optionsFrom;
  if (!ref) return undefined;
  const match = /^\{\{\s*steps\.([^.\s}]+)\.output\.body(?:\.([^\s}]+))?\s*\}\}$/.exec(ref);
  return match ? { callId: match[1]!, field: match[2] ?? '' } : undefined;
}

function selectIn(draft: WorkflowConfig, flow: ConversationalFlow, promptId: string): Record<string, unknown> | undefined {
  const { screen } = promptIn(flow, promptId);
  const entry = caseFor(draft, flow, screen);
  const wait = entry ? stepIn(partsOf(entry, flow.routeKey).rest, promptId) : undefined;
  return asArray(asRec(wait?.config['form'])['fields']).map(asRec).find((f) => str(f['type']) === 'select');
}

/** A lookup whose answer this screen can actually read. */
function inScopeCall(flow: ConversationalFlow, screen: Screen, callId: string) {
  const frames = [screen.id, ...screen.frames];
  for (const id of frames) {
    const on = flow.screens.find((s) => s.id === id);
    const call = on?.calls.find((c) => c.id === callId);
    if (call && (on?.id === screen.id || call.scope !== 'screen')) return call;
  }
  throw new ConversationalFlowEditError(`“${screen.title}” can’t read anything called “${callId}”.`);
}
