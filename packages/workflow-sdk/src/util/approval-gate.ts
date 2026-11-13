/**
 * Resolving a deployment's {@link ApprovalConfig} against the components a
 * workflow actually uses.
 *
 * Here rather than on the runtime because it is a pure reading of policy: no
 * adapters, no I/O, nothing to mock. The runtime's part is deciding what to do
 * with the answer.
 */

import type { ApprovalConfig, ApprovalGate } from '../types/approval.js';
import { ApprovalRequirement } from '../types/approval.js';
import type { ComponentRef } from '../types/component-ref.js';

/**
 * Whether these components oblige their workflow to be reviewed, and which
 * types asked for it.
 *
 * Most-specific first: the per-kind map, then `default`. `steps` and `triggers`
 * are read by kind and never crossed — a rule naming a step must not reach a
 * trigger that happens to share its type string.
 *
 * Callers pass what `ConfigValidator.components()` returned, which skips types
 * the registry does not know. That reads here as "nothing to gate", and is safe
 * rather than merely tolerable: a component no connector provides cannot
 * execute either, so the run it would have gated cannot do the thing the gate
 * exists to catch.
 */
export function approvalGate(
  policy: ApprovalConfig,
  components: readonly ComponentRef[],
): ApprovalGate {
  const gatedBy: string[] = [];
  for (const ref of components) {
    const declared = (ref.kind === 'step' ? policy.steps : policy.triggers)?.[ref.type];
    if ((declared ?? policy.default) !== ApprovalRequirement.REQUIRED) continue;
    if (!gatedBy.includes(ref.type)) gatedBy.push(ref.type);
  }
  return { required: gatedBy.length > 0, gatedBy };
}
