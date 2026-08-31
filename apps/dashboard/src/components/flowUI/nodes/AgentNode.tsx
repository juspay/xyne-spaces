import React from 'react';
import type { AgentProps, FlowComponent } from '@xyne/shared';
import { DraftAgentCard } from './agent/DraftAgentCard';
import { ProfileAgentCard } from './agent/ProfileAgentCard';

/**
 * Agent artifact — ONE node type for every agent surface.
 *
 * `props.variant` is the discriminant. It selects the chrome and the
 * affordances; the identity block underneath is the same component in every
 * branch (see agent/AgentIdentityBlock.tsx), which is what keeps a drafted
 * agent, a created agent and a described agent recognisably the same object.
 *
 *   draft   → pending: capability chips toggle, Approve/Decline footer.
 *             created | rejected: the same identity, chip + audit, no buttons.
 *   profile → a live agent, read-only.
 *
 * ── Wire contract (backend emits this) ──────────────────────────────────────
 * Source of truth + zod validation: shared/src/validation/flowSchema.ts
 * (`agentComponentSchema`). Built by xyne-claw-shared's `buildAgentCardFlow`.
 * The whole FlowDefinition is JSON-stringified, `"`→`&quot;` escaped, and stored
 * in messages.content as `<div data-flow-json="…">Flow JSON</div>`. Post once,
 * then `updateMessage` the SAME screenId to advance phases.
 *
 *   { version: '2.0', screenId: 'agent-card-<requestId>', title: 'Agent',
 *     state: { … },                                 // always empty at emit
 *     data: { actionType: 'agent-card', requestId, agentSlug, userId, … },
 *     components: [{ id: 'agent', type: 'agent', props: <AgentProps> }] }
 *
 * `id` must stay 'agent' — it is both the reconciliation key and the flow-state
 * key the backend reads the capability selection from. props is `.strict()`:
 * unknown keys are rejected, and a NEW surface is a new `variant` branch rather
 * than a new field on an existing one.
 *
 * Everything actionable (which request, which user may decide, where to post)
 * travels in `flowJSON.data`, never in props — the whole flowJSON round-trips
 * through the browser, so props are display data and nothing else.
 */
export const AgentNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as AgentProps | undefined;
  if (!props) {
    return null;
  }

  if (props.variant === 'draft') {
    return <DraftAgentCard node={node} props={props} />;
  }
  return <ProfileAgentCard node={node} props={props} />;
};
