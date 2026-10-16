import { BoardType } from '@xyne/shared';

/**
 * Pure gate check for the release-completion move. No I/O.
 *
 * The resolver returns the route a ticket takes to its Completed stage
 * (`path`, excluding the current stage). The move itself is one write, but it
 * must not skip anything a human would have hit had they moved the ticket stage
 * by stage. So every hop on the route is checked, in order, and the first hop
 * that needs a human stops the move:
 *
 *   NON_LINEAR / FLOW (edge-gated, mirrors transitionTicket):
 *     - NOT_ALLOWED: the `from` stage has explicit outgoing edges and none
 *                    (explicit or global) leads to `to`
 *     - FORM:        the edge carries a form
 *     - APPROVAL:    the edge requires approval and is NOT opted into
 *                    `bypassApprovalForAutomation`
 *   DEFAULT / RELEASE (stage-gated, mirrors the linear board UI):
 *     - FORM:        the stage has a STAGE form mapping
 *     - APPROVAL:    the stage has approvers (linear boards have no automation
 *                    bypass flag)
 */

export interface GateTransition {
  id: string;
  fromStageId: string | null;
  toStageId: string;
  formId: string | null;
  requiresApproval: boolean | null;
  bypassApprovalForAutomation: boolean | null;
}

export interface LinearStageGate {
  hasForm: boolean;
  hasApprovers: boolean;
}

export type ReleaseCompletionGate = 'NOT_ALLOWED' | 'FORM' | 'APPROVAL';

export type ReleaseCompletionGateResult =
  | { kind: 'CLEAR' }
  | {
      kind: 'BLOCKED';
      gate: ReleaseCompletionGate;
      /** Index into `path` of the gated stage. */
      hopIndex: number;
      /** Stage the ticket would be on when it hits the gate (null = unknown current stage). */
      fromStageId: string | null;
      toStageId: string;
      /** Gated edge (NON_LINEAR / FLOW only). */
      transitionId: string | null;
    };

export interface EvaluateReleaseCompletionGatesInput {
  boardType: string;
  currentStageId: string | null;
  path: ReadonlyArray<string>;
  transitions: ReadonlyArray<GateTransition>;
  /** DEFAULT / RELEASE only: per-stage form / approver presence. */
  linearStageGates: ReadonlyMap<string, LinearStageGate>;
}

export function evaluateReleaseCompletionGates(input: EvaluateReleaseCompletionGatesInput): ReleaseCompletionGateResult {
  const { boardType, currentStageId, path, transitions, linearStageGates } = input;
  const isLinear = boardType === BoardType.DEFAULT || boardType === BoardType.RELEASE;

  let from: string | null = currentStageId;
  for (let i = 0; i < path.length; i++) {
    const to = path[i]!;
    const blocked = (gate: ReleaseCompletionGate, transitionId: string | null = null): ReleaseCompletionGateResult => ({
      kind: 'BLOCKED',
      gate,
      hopIndex: i,
      fromStageId: from,
      toStageId: to,
      transitionId,
    });

    if (isLinear) {
      const g = linearStageGates.get(to);
      if (g?.hasForm) return blocked('FORM');
      if (g?.hasApprovers) return blocked('APPROVAL');
    } else {
      const hasOutgoing = from != null && transitions.some(t => t.fromStageId === from);
      const edge =
        (from != null ? transitions.find(t => t.fromStageId === from && t.toStageId === to) : undefined)
        ?? transitions.find(t => t.fromStageId == null && t.toStageId === to)
        ?? null;
      if (hasOutgoing && !edge) return blocked('NOT_ALLOWED');
      if (edge?.formId) return blocked('FORM', edge.id);
      if (edge?.requiresApproval && !(edge.bypassApprovalForAutomation ?? false)) return blocked('APPROVAL', edge.id);
    }
    from = to;
  }
  return { kind: 'CLEAR' };
}
