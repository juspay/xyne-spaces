/** Dependency rules accept both Prisma dates and Zero epoch-millisecond dates. */
export type DependencyDate = Date | number | string;
export type DependencyStrength = 'SOFT' | 'HARD';
export type DependencyOrigin = 'MANUAL' | 'BOARD_RULE' | 'PROCESS_RULE' | 'AI';

export interface BoardDependencyPolicy {
  defaultStrength: DependencyStrength;
  hardGateStageIds: string[];
  automationOnSoftGate: 'PROCEED' | 'STOP';
}

export interface DependencyOverride {
  at: DependencyDate;
  by: string | null;
  reason: string | null;
}

export interface DependencyEdge {
  id: string;
  kind: 'BLOCKS' | 'CHILD';
  blockerTicketId: string;
  dependentTicketId: string;
  strength: DependencyStrength;
  gatedStageId: string | null;
  satisfiedStageId: string | null;
  satisfiedAt: DependencyDate | null;
  reviewNeededAt: DependencyDate | null;
  override: DependencyOverride | null;
}

export interface DependencyGatingColumns {
  strength?: string | null;
  gatedStageId?: string | null;
  satisfiedAt?: DependencyDate | null;
  overriddenAt?: DependencyDate | null;
  overriddenBy?: string | null;
  overrideReason?: string | null;
}

export interface DependencyReferenceRow extends DependencyGatingColumns {
  id: string;
  relationType: string;
  sourceTicketId: string;
  targetTicketId: string;
  satisfiedStageId?: string | null;
  reviewNeededAt?: DependencyDate | null;
}

export interface DependencySubTicketMapping extends DependencyGatingColumns {
  id: string;
  ticketId: string;
  subTicketId: string;
}

export interface DependencyStage {
  id: string;
  boardId: string;
  name: string;
  sequenceNumber: number;
  defaultTicketStatusV2: string;
  eta?: number | null;
}

export interface DependencyBoard {
  id: string;
  boardType: string;
  metadata?: unknown;
}

export interface DependencyTicket {
  id: string;
  boardId: string;
  stageName: string;
  statusV2?: string | null;
  eta?: DependencyDate | null;
  /** The deadline of the current, active TicketStageEta visit, not a previous visit. */
  activeStageEta?: DependencyDate | null;
}

export interface DependencyContext {
  ticketsById: ReadonlyMap<string, DependencyTicket>;
  boardsById: ReadonlyMap<string, DependencyBoard>;
  stagesByBoard: ReadonlyMap<string, readonly DependencyStage[]>;
  /** Authorized outgoing stage ids for each NON_LINEAR ticket's current stage. */
  nextStageIdsByTicket?: ReadonlyMap<string, readonly string[]>;
}

export type DependencyPrimaryState =
  | 'Blocked'
  | 'Needs review'
  | 'At risk'
  | 'Paused'
  | 'Gated later'
  | 'Unblocked';

export interface DependencyState {
  primary: DependencyPrimaryState | null;
  blockedBy: DependencyEdge[];
  blocking: DependencyEdge[];
  atRiskDays?: number;
}
