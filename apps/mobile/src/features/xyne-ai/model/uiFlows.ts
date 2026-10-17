import type { FlowDefinition } from '@xyne/shared';

import type { PendingAction } from '../api/xyneAIEvents';

const hasFlowToken = (flow: FlowDefinition): boolean => {
  const token = flow.data?.['__xyneFlowToken'];
  return typeof token === 'string' && token.length > 0;
};

/**
 * Adds a card to a turn's list, keyed by `screenId`. The latest wins, except that
 * a copy without `__xyneFlowToken` never replaces one with it: a `/live` replay
 * would otherwise strip the card's ability to submit.
 */
export function mergeUiFlows(
  existing: FlowDefinition[],
  incoming: FlowDefinition,
): FlowDefinition[] {
  const at = existing.findIndex(flow => flow.screenId === incoming.screenId);
  if (at < 0) return [...existing, incoming];
  const current = existing[at];
  if (current && hasFlowToken(current) && !hasFlowToken(incoming)) return existing;
  return existing.map((flow, index) => (index === at ? incoming : flow));
}

/** The stored message the card's token was minted for; mid-run the turn has no id of its own. */
export function flowMessageId(flow: FlowDefinition, fallback: string | undefined): string {
  const stored = flow.data?.['chatMessageId'];
  return typeof stored === 'string' && stored ? stored : (fallback ?? '');
}

/** A card carrying an action's signature is that approval; without one the action stays. */
export function unpresentedPendingActions(
  actions: PendingAction[],
  flows: FlowDefinition[],
): PendingAction[] {
  const presented = new Set(flows.map(flow => flow.data?.['pendingSignature']).filter(Boolean));
  return actions.filter(({ signature }) => !presented.has(signature));
}
