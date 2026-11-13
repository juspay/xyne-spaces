/**
 * What a round carries.
 *
 * Every frame starts a round with the same keys — where they are, and what they
 * typed on the way — because a jump may name any frame and a cycle refuses a
 * round that carries anything else. The root cycle's `input` is the record of
 * those keys, so it is the one place to ask.
 */
import type { WorkflowConfig } from '../types/workflow-config.js';
import { asRec, type Rec } from './json.js';
import { cycleAt } from './locate.js';
import { screenRef } from './shape.js';
import type { ConversationalFlow } from './types.js';

/** The keys the conversation's own round carries, in the order it declares them. */
export function roundKeys(config: WorkflowConfig, flow: ConversationalFlow): string[] {
  return Object.keys(rootInput(config, flow));
}

/**
 * The key holding what they typed: the round's other key. A flow that has none
 * — nowhere to type — still answers, so a caller can build the field.
 */
export function textKeyOf(config: WorkflowConfig, flow: ConversationalFlow): string {
  return roundKeys(config, flow).find((key) => key !== flow.routeKey) ?? 'text';
}

/** How a step inside a frame names what they typed. */
export function textRef(config: WorkflowConfig, flow: ConversationalFlow): string {
  return screenRef(textKeyOf(config, flow));
}

/**
 * What a frame inside the conversation starts its round with: each key passed
 * in from the round around it, so scope flows inwards and a jump may name any
 * frame at all.
 */
export function inheritedInput(config: WorkflowConfig, flow: ConversationalFlow): Rec {
  const out: Rec = {};
  for (const key of roundKeys(config, flow)) out[key] = screenRef(key);
  return out;
}

/** A round aimed at `screen`, carrying nothing else. */
export function carriedTo(config: WorkflowConfig, flow: ConversationalFlow, screen: string): Rec {
  const out: Rec = {};
  for (const key of roundKeys(config, flow)) out[key] = '';
  out[flow.routeKey] = screen;
  return out;
}

function rootInput(config: WorkflowConfig, flow: ConversationalFlow): Rec {
  return asRec(cycleAt(config, [flow.rootScreen], flow.routeKey)?.config['input']);
}
