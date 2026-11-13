/**
 * What the conversation is started with.
 *
 * A flow that quotes `{{trigger.context.orderId}}` is making a promise about
 * what whoever starts it will pass in. Declaring that promise is what lets the
 * validator check the references, the editor offer them, and the Test tab ask
 * for them — undeclared, all three are guessing.
 *
 * It is written on the trigger's own `inputSchema`, which is the mechanism the
 * manual trigger already has for exactly this; nothing new is stored.
 */
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asRec, type Rec } from '../json.js';
import { ConversationalFlowEditError, requireFlow, settle } from '../settle.js';

/** One thing the conversation is started with. */
export interface ConversationInput {
  /** A dotted name, as it will be quoted: `orderId`, `customer.tier`. */
  path: string;
  type?: 'string' | 'number' | 'boolean';
}

/**
 * Declare them, replacing whatever was declared before. The list is the whole
 * promise, so removing a name is how you stop promising it.
 */
export function setConversationInputs(config: WorkflowConfig, inputs: readonly ConversationInput[]): WorkflowConfig {
  requireFlow(config);
  const named = inputs.filter((input) => input.path.trim() !== '');
  for (const input of named) {
    if (/[^A-Za-z0-9_.]/.test(input.path)) {
      throw new ConversationalFlowEditError(`“${input.path}” can only use letters, numbers, underscores and dots.`);
    }
  }

  return settle(config, (draft) => {
    const trigger = asRec(draft.trigger);
    const triggerConfig = asRec(trigger['config']);
    trigger['config'] = triggerConfig;
    draft.trigger = trigger as WorkflowConfig['trigger'];

    if (named.length === 0) {
      delete triggerConfig['inputSchema'];
      return;
    }
    // The Conversation API puts what the caller passed under `context`, so that
    // is where the promise has to be made.
    triggerConfig['inputSchema'] = {
      type: 'object',
      properties: { context: shapeOf(named) },
    };
  });
}

/** Dotted names → the JSON Schema the trigger declares them with. */
function shapeOf(inputs: readonly ConversationInput[]): Rec {
  const root: Rec = { type: 'object', properties: {} };
  for (const input of inputs) {
    let node = root;
    const parts = input.path.split('.').map((p) => p.trim()).filter(Boolean);
    parts.forEach((part, at) => {
      const properties = asRec(node['properties']);
      node['properties'] = properties;
      if (at === parts.length - 1) properties[part] = { type: input.type ?? 'string' };
      else {
        const next = asRec(properties[part]);
        next['type'] = 'object';
        properties[part] = next;
        node = next;
      }
    });
  }
  return root;
}
