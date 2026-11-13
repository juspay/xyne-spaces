/**
 * A Finish: what the conversation says as it closes, and what it reports.
 *
 * Both ride in what the FINISH carries — the value the conversation's own cycle
 * returns. `message` is reserved for the farewell, because a person reads it;
 * everything else is for whoever runs the flow.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asRec, type Rec } from '../json.js';
import { caseFor } from '../locate.js';
import { ConversationalFlowEditError, requireFlow, settle } from '../settle.js';
import { partsOf, stepIn } from '../shape.js';
import { END_MESSAGE_KEY, type ConversationalFlow, type Screen } from '../types.js';

/**
 * What it says as it closes. Empty for a silent ending.
 *
 * `versionId` names one way of closing, on a Finish that has several; left out,
 * it is the one that closes when nothing else holds.
 */
export function setEndMessage(config: WorkflowConfig, screenId: string, message: string, versionId?: string): WorkflowConfig {
  requireEnding(requireFlow(config), screenId);
  const text = message.trim();
  return settle(config, (draft) => {
    const carried = carriedBy(draft, requireFlow(draft), screenId, versionId);
    if (text) carried[END_MESSAGE_KEY] = text;
    else delete carried[END_MESSAGE_KEY];
  });
}

/**
 * What the run reports when it ends here — a category, a team, a reference.
 * The farewell rides in the same object and is kept.
 */
export function setEndResult(
  config: WorkflowConfig,
  screenId: string,
  value: Record<string, unknown>,
  versionId?: string,
): WorkflowConfig {
  requireEnding(requireFlow(config), screenId);
  return settle(config, (draft) => {
    const carried = carriedBy(draft, requireFlow(draft), screenId, versionId);
    const farewell = carried[END_MESSAGE_KEY];
    for (const key of Object.keys(carried)) delete carried[key];
    Object.assign(carried, value);
    if (typeof farewell === 'string' && farewell) carried[END_MESSAGE_KEY] = farewell;
  });
}

/** The object the Finish carries, live, so a caller can change it in place. */
function carriedBy(config: WorkflowConfig, flow: ConversationalFlow, screenId: string, versionId?: string): Rec {
  const screen = requireEnding(flow, screenId);
  const entry = caseFor(config, flow, screen);
  const rest = entry ? partsOf(entry, flow.routeKey).rest : [];
  // One of several ways of closing sits inside the versions switch, by its own id.
  const id = versionId ?? screen.versions.find((v) => !v.when)?.promptId;
  const finish = id ? stepIn(rest, id) : rest.find((step) => step.type === 'FINISH');
  if (finish?.type !== 'FINISH') throw new ConversationalFlowEditError(`“${screen.title}” doesn’t end the conversation.`);
  if (!finish.config['with']) finish.config['with'] = {};
  return asRec(finish.config['with']);
}

function requireEnding(flow: ConversationalFlow, id: string): Screen {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new ConversationalFlowEditError(`There is no screen “${id}”.`);
  if (screen.kind !== 'end') throw new ConversationalFlowEditError(`“${screen.title}” isn’t a Finish screen.`);
  return screen;
}
