import type {
  DependencyBoard,
  DependencyEdge,
  DependencyPrimaryState,
  DependencyStage,
} from '@xyne/shared';

export type PublicDependencyEdge = DependencyEdge & { restricted: boolean };
export interface DependencyTicketSummary {
  id: string;
  title: string;
  xyneId: string | null;
  boardId: string;
  stageName: string;
  assignedTo: string | null;
  eta: string | null;
}
export interface DependencyBatch {
  edges: PublicDependencyEdge[];
  tickets: DependencyTicketSummary[];
  boards: DependencyBoard[];
  stages: DependencyStage[];
  // Classification is performed with the shared rules on the server. Returning the
  // full graph so the browser could repeat it would disclose restricted endpoints.
  states: Record<
    string,
    {
      primary: DependencyPrimaryState | null;
      blockedBy: string[];
      blocking: string[];
      atRiskDays?: number;
    } | null
  >;
}
export interface DependencyTicketView {
  batch: DependencyBatch;
  error: string | null;
}
export const EMPTY_DEPENDENCY_BATCH: DependencyBatch = {
  edges: [],
  tickets: [],
  boards: [],
  stages: [],
  states: {},
};
