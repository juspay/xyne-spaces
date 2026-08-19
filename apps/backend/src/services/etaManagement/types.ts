import type {
  EstimateSource,
  ForecastStatus,
  TicketEtaManagementPlanningRisk,
} from '@xyne/shared';

/**
 * Central ETA domain service types. Every function in this directory is
 * pure (no Prisma/Zero access) so the same decision logic can be reused
 * identically from Prisma call sites (ticketStageTransitionService.ts,
 * ticketRepository.ts) and Zero mutators (mutators.ts) - only the
 * data-loading glue differs per call site.
 *
 * `StageLike`/`TransitionLike` are deliberately minimal structural types
 * rather than `@prisma/client`'s `Stage`/`StageTransition` - Zero's
 * generated row types (also confusingly named `StageTransition`, exported
 * from `@xyne/shared`) use `| undefined` for optional columns where Prisma
 * uses `| null`, and carry different extra fields. Both the Prisma models
 * and Zero rows structurally satisfy these narrower types, so the same
 * pure functions run unmodified against either.
 */

export interface StageLike {
  id: string;
  sequenceNumber: number;
  eta: number | null | undefined;
}

export interface TransitionLike {
  id: string;
  fromStageId: string | null | undefined;
  toStageId: string;
  visitSlaMode: string | null | undefined;
  fixedEtaHours: number | null | undefined;
}

export interface RouteStep {
  stageId: string;
  /** The transition that would be used to enter this stage, when resolvable. */
  transition: TransitionLike | null;
  /**
   * True when this step is a Standard-Path step on a graphed NON_LINEAR
   * board, where an explicit or global StageTransition row is REQUIRED to
   * resolve an estimate - a null `transition` in that case is a config
   * error (PRD §6.3 "no matching transition on a graphed board"), not a
   * legitimate "unrestricted move". False for linear/DEFAULT/RELEASE
   * boards, where a null transition just means "use the stage default".
   */
  requireExplicitTransition: boolean;
}

export type RouteResolution =
  | { kind: 'ROUTE'; steps: RouteStep[] }
  /** Current stage isn't on the configured Standard Path (NON_LINEAR only). */
  | { kind: 'DEVIATED'; offPathStageId: string }
  /** Board type/config doesn't support forecasting this release (Flow, non-linear with no Standard Path, unknown current stage). */
  | { kind: 'NOT_APPLICABLE' };

export interface StepEstimate {
  stageId: string;
  hours: number;
  source: EstimateSource;
  /** Genuinely tracked deadline, as opposed to a deliberate no-SLA step (contributes 0 hours, not an error). */
  deadlineTracked: boolean;
  /** Hard config error (e.g. FIXED_HOURS with no value, or a required transition missing) - blocks the forecast, distinct from a deliberate NONE. */
  incomplete: boolean;
}

export interface ForecastResult {
  status: ForecastStatus;
  incompleteReason: string | null;
  incompleteStageIds: string[];
  forecastEta: Date | null;
}

export interface EtaUpdateDecision {
  newEta: Date | null;
  changed: boolean;
}

export type PlanningRiskTransitionKind = 'NONE' | 'DETECTED' | 'REOPENED' | 'RESOLVED' | 'UNCHANGED';

export interface PlanningRiskDecision {
  nextState: TicketEtaManagementPlanningRisk;
  transitionKind: PlanningRiskTransitionKind;
  /** Best-effort list of which fingerprint inputs changed, for the ETA_RISK_REOPENED activity. Ticket status is folded into the fingerprint but not separately stored, so a status-only change may not appear here even though it changed the fingerprint. */
  changedInputs: string[];
}
