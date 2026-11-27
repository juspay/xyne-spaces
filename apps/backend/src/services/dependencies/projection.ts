import type { DependencyEdge } from '@xyne/shared';

/** Public id for a restricted edge is an authenticated opaque token, never a legacy mapping id. */
export function projectDependencyEdges(
  edges: readonly DependencyEdge[],
  visibleTicketIds: ReadonlySet<string>,
  opaqueId: (edgeId: string) => string,
) {
  return edges.map(edge => {
    const blockerVisible = visibleTicketIds.has(edge.blockerTicketId);
    const dependentVisible = visibleTicketIds.has(edge.dependentTicketId);
    const restricted = !blockerVisible || !dependentVisible;
    const id = restricted ? opaqueId(edge.id) : edge.id;
    return {
      id, kind: edge.kind, strength: edge.strength,
      blockerTicketId: blockerVisible ? edge.blockerTicketId : `restricted:${id}:blocker`,
      dependentTicketId: dependentVisible ? edge.dependentTicketId : `restricted:${id}:dependent`,
      gatedStageId: dependentVisible ? edge.gatedStageId : null,
      satisfiedStageId: blockerVisible ? edge.satisfiedStageId : null,
      satisfiedAt: edge.satisfiedAt, reviewNeededAt: edge.reviewNeededAt,
      // Reasons are user-authored and can name hidden tickets. Return no free text here.
      override: edge.override ? { at: edge.override.at, by: null, reason: null } : null,
      restricted,
    };
  });
}
