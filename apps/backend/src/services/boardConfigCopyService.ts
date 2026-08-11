import { createHash } from 'crypto';
import { BoardType, TicketStatusV2, FormContextType, FormEntityType, ApproverType } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { redisService } from '@/services/redisService';
import { boardConfigCopySnapshotService } from '@/services/boardConfigCopySnapshotService';
import { calculateETADeadline, recomputeOverallTicketEta } from '@/utils/etaCalculation';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { logger } from '@/utils/logger';
import {
  boardConfigCopyQueue,
  BoardConfigCopyJobData,
  BoardConfigCopyTicketRemap,
  BoardConfigCopyFieldRepoint,
} from '@/queues/boardConfigCopyQueue';

const TAG = '[BoardConfigCopy]';

// How long a prepared copy stays claimable. The plan is stashed server-side between
// `prepareCopy` and `startTicketMigration` rather than round-tripped through the client:
// by the time migration starts the old stages are already deleted, so this payload is the
// only remaining record of where each ticket should land — it must not be client-forgeable.
const PENDING_MIGRATION_TTL_SECONDS = 3600;
const pendingMigrationKey = (targetBoardId: string): string =>
  `board-config-copy:pending-migration:${targetBoardId}`;

// The only categories every board is guaranteed to have at least one stage of — enforced
// by mutators.ts's board.update validation ("Board must have at least one TODO, one
// STARTED, and one COMPLETED stage"). PAUSED/CANCELLED have no such guarantee.
const COMPULSORY_TICKET_STATUS_CATEGORIES = new Set<string>([
  TicketStatusV2.TODO,
  TicketStatusV2.STARTED,
  TicketStatusV2.COMPLETED,
]);

export interface CopyCategorySelection {
  customFields: boolean;
  roles: boolean;
  stages: boolean;
}

export interface StageRemapOverride {
  oldStageId: string;
  // sourceStageId of the translated new stage this old stage's tickets should land on
  newStageId: string;
}

export interface CopyRequestInput {
  sourceBoardId: string;
  targetBoardId: string;
  categories: CopyCategorySelection;
}

export interface PrepareCopyInput extends CopyRequestInput {
  stageRemapOverrides?: StageRemapOverride[];
  dryRun: boolean;
}

interface SourceStageRow {
  id: string;
  name: string;
  eta: number | null;
  sequenceNumber: number;
  defaultTicketStatusV2: string;
  requestApprovalOnEntry: boolean;
  prStatuses: string[];
  approvers: Array<{ approverId: string; approverType: 'USER' | 'ROLE' }>;
  formId?: string;
}

interface SourceTransitionRow {
  fromStageId: string | null;
  toStageId: string;
  formId?: string;
  requiresApproval: boolean;
  bypassApprovalForAutomation: boolean;
  requestApprovalOnEntry: boolean;
  visitSlaMode?: string;
  fixedEtaHours?: number | null;
  onReenter?: string;
  approvers: Array<{ approverId: string; approverType: 'USER' | 'ROLE' }>;
}

export interface OldStageInfo {
  id: string;
  name: string;
  defaultTicketStatusV2: string;
  ticketCount: number;
}

export interface NewStagePreview {
  sourceStageId: string;
  name: string;
  defaultTicketStatusV2: string;
  sequenceNumber: number;
}

export interface PlanCopyResult {
  errors: string[];
  warnings: string[];
  sourceBoard?: { id: string; name: string; boardType: string };
  targetBoard?: { id: string; name: string; boardType: string };
  newStages?: NewStagePreview[];
  oldStages?: OldStageInfo[];
  suggestedMapping?: Record<string, string>; // oldStageId -> sourceStageId
  requiresExplicit?: string[]; // oldStageIds with tickets that still need an explicit mapping
}

// ─── Prepared client-side mutation payloads ───────────────────────────────
// Everything below is handed to the dashboard verbatim and passed straight into the SAME
// Zero mutators the board editor uses (`board.update`, `formContextMapping.upsert`,
// `nonLinear.syncTransitions`). Board configuration is not written server-side at all —
// only the two things a browser genuinely cannot do (the object-storage snapshot and the
// Prisma-only form clone) happen here.

export interface PreparedStage {
  id: string;
  name: string;
  eta?: number;
  sequenceNumber: number;
  defaultTicketStatusV2: string;
  requestApprovalOnEntry: boolean;
  prStatuses: string[];
  approvers: Array<{ approverId: string; approverType: 'USER' | 'ROLE' }>;
  formId?: string;
}

export interface PreparedBoardUpdate {
  boardId: string;
  boardType: string;
  /**
   * The COMPLETE metadata blob to persist — `board.update` replaces `metadata` wholesale
   * rather than merging, so this is the target's existing metadata with the copied keys
   * already layered on top (and custom-field ids remapped onto the cloned form).
   */
  metadata: Record<string, unknown>;
  /**
   * Present only when stages are being copied. `board.update` treats this as the board's
   * complete desired stage set: stages here are upserted, and any stage on the board that
   * is absent is deleted along with its approvers/PR-status/form mappings. That single
   * property is what replaces the old worker's separate insert and delete phases.
   */
  stages?: PreparedStage[];
  prStatusMappingIds?: Record<string, string>;
}

export interface PreparedBoardFormMapping {
  contextId: string;
  contextType: string;
  entityType: string;
  formId: string;
  mappingId: string;
}

export interface PreparedTransition {
  id: string;
  fromStageId: string | null;
  toStageId: string;
  formId?: string;
  requiresApproval: boolean;
  bypassApprovalForAutomation: boolean;
  requestApprovalOnEntry: boolean;
  visitSlaMode?: string;
  fixedEtaHours?: number | null;
  onReenter?: string;
  approvers: Array<{ id: string; approverId: string; approverType: string }>;
}

export interface PrepareCopyResult {
  dryRun: boolean;
  snapshotPath?: string;
  customFieldsCopied: boolean;
  rolesCopied: boolean;
  newStageCount: number;
  deletedOldStageCount: number;
  /** Tickets the follow-up migration job will need to move; 0 means no job is needed. */
  ticketsToMigrate: number;
  warnings: string[];
  boardUpdate: PreparedBoardUpdate;
  boardFormMapping: PreparedBoardFormMapping | null;
  transitions: PreparedTransition[] | null;
  /** True when a prepared migration plan was stashed and `startTicketMigration` should be called. */
  hasPendingMigration: boolean;
}

export class BoardConfigCopyValidationError extends Error {
  constructor(
    public readonly errors: string[],
    public readonly requiresExplicit?: string[],
  ) {
    super(errors[0] ?? 'Validation failed');
    this.name = 'BoardConfigCopyValidationError';
  }
}

export class BoardConfigCopyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardConfigCopyConflictError';
  }
}

export class BoardConfigCopyService {
  // ─── Validation ─────────────────────────────────────────────────────────

  private async validateBoards(sourceBoardId: string, targetBoardId: string, workspaceId: string) {
    const errors: string[] = [];

    if (sourceBoardId === targetBoardId) {
      errors.push('Source and target boards must differ');
    }

    const [sourceBoard, targetBoard] = await Promise.all([
      db.board.findFirst({ where: { id: sourceBoardId, workspaceId } }),
      db.board.findFirst({ where: { id: targetBoardId, workspaceId } }),
    ]);

    if (!sourceBoard) errors.push('Source board not found');
    if (!targetBoard) errors.push('Target board not found');

    if (sourceBoard && targetBoard && sourceBoard.projectId !== targetBoard.projectId) {
      errors.push('Source and target boards must be in the same project');
    }

    if (sourceBoard?.boardType === BoardType.RELEASE || targetBoard?.boardType === BoardType.RELEASE) {
      errors.push('Release boards are not supported for config copy');
    }

    return { errors, sourceBoard, targetBoard };
  }

  // ─── Stage reads ────────────────────────────────────────────────────────

  private async getSourceStagesOrdered(boardId: string): Promise<SourceStageRow[]> {
    const stages = await db.stage.findMany({
      where: { boardId },
      orderBy: { sequenceNumber: 'asc' },
    });
    if (stages.length === 0) return [];

    const stageIds = stages.map(s => s.id);
    const [approvers, prMappings, formMappings] = await Promise.all([
      db.stageApprovers.findMany({ where: { stageId: { in: stageIds } } }),
      db.stagePRStatusMapping.findMany({ where: { stageId: { in: stageIds } } }),
      db.formContextMapping.findMany({
        where: { contextId: { in: stageIds }, contextType: FormContextType.STAGE, entityType: FormEntityType.TICKET },
      }),
    ]);

    const approversByStage = new Map<string, Array<{ approverId: string; approverType: 'USER' | 'ROLE' }>>();
    for (const a of approvers) {
      if (!a.stageId) continue;
      const type = (a.approverType ?? ApproverType.USER) === ApproverType.ROLE ? 'ROLE' : 'USER';
      const approverId = type === 'ROLE' ? a.roleId : a.userId;
      if (!approverId) continue;
      const list = approversByStage.get(a.stageId) ?? [];
      list.push({ approverId, approverType: type });
      approversByStage.set(a.stageId, list);
    }

    const prByStage = new Map<string, string[]>();
    for (const m of prMappings) {
      const list = prByStage.get(m.stageId) ?? [];
      list.push(m.prStatus);
      prByStage.set(m.stageId, list);
    }

    const formByStage = new Map<string, string>();
    for (const m of formMappings) {
      formByStage.set(m.contextId, m.formId);
    }

    return stages.map(s => ({
      id: s.id,
      name: s.name,
      eta: s.eta,
      sequenceNumber: s.sequenceNumber,
      defaultTicketStatusV2: s.defaultTicketStatusV2,
      requestApprovalOnEntry: s.requestApprovalOnEntry ?? false,
      prStatuses: prByStage.get(s.id) ?? [],
      approvers: approversByStage.get(s.id) ?? [],
      formId: formByStage.get(s.id),
    }));
  }

  private async getSourceTransitions(boardId: string): Promise<SourceTransitionRow[]> {
    const transitions = await db.stageTransition.findMany({ where: { boardId } });
    if (transitions.length === 0) return [];

    const transitionIds = transitions.map(t => t.id);
    const approvers = await db.stageApprovers.findMany({ where: { transitionId: { in: transitionIds } } });

    const approversByTransition = new Map<string, Array<{ approverId: string; approverType: 'USER' | 'ROLE' }>>();
    for (const a of approvers) {
      if (!a.transitionId) continue;
      const type = (a.approverType ?? ApproverType.USER) === ApproverType.ROLE ? 'ROLE' : 'USER';
      const approverId = type === 'ROLE' ? a.roleId : a.userId;
      if (!approverId) continue;
      const list = approversByTransition.get(a.transitionId) ?? [];
      list.push({ approverId, approverType: type });
      approversByTransition.set(a.transitionId, list);
    }

    return transitions.map(t => ({
      fromStageId: t.fromStageId,
      toStageId: t.toStageId,
      formId: t.formId ?? undefined,
      requiresApproval: t.requiresApproval ?? false,
      bypassApprovalForAutomation: t.bypassApprovalForAutomation ?? false,
      requestApprovalOnEntry: t.requestApprovalOnEntry ?? false,
      visitSlaMode: t.visitSlaMode ?? undefined,
      fixedEtaHours: t.fixedEtaHours,
      onReenter: t.onReenter ?? undefined,
      approvers: approversByTransition.get(t.id) ?? [],
    }));
  }

  private async getOldStagesWithTicketCounts(targetBoardId: string): Promise<OldStageInfo[]> {
    const [stages, counts] = await Promise.all([
      db.stage.findMany({ where: { boardId: targetBoardId }, orderBy: { sequenceNumber: 'asc' } }),
      db.ticket.groupBy({ by: ['stageName'], where: { boardId: targetBoardId }, _count: { _all: true } }),
    ]);
    const countByName = new Map(counts.map(c => [c.stageName, c._count._all]));
    return stages.map(s => ({
      id: s.id,
      name: s.name,
      defaultTicketStatusV2: s.defaultTicketStatusV2,
      ticketCount: countByName.get(s.name) ?? 0,
    }));
  }

  // ─── Deterministic id derivation ────────────────────────────────────────

  /**
   * Stable, content-derived id — same inputs always produce the same output. The new
   * stage/transition ids are derived rather than random so that re-running a prepare for
   * the same source/target pair converges on the same rows (`board.update` upserts by id)
   * instead of minting a duplicate stage set.
   */
  private deriveDeterministicId(...parts: string[]): string {
    const hash = createHash('sha256').update(parts.join(':')).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }

  // ─── Remap plan resolution ──────────────────────────────────────────────

  private computeSuggestedMapping(
    oldStages: OldStageInfo[],
    newStages: NewStagePreview[],
  ): Record<string, string> {
    const suggestion: Record<string, string> = {};
    for (const old of oldStages) {
      if (old.ticketCount === 0) continue;
      const match = newStages.find(n => n.defaultTicketStatusV2 === old.defaultTicketStatusV2);
      if (match) suggestion[old.id] = match.sourceStageId;
    }
    return suggestion;
  }

  /**
   * Resolves which new stage each old-stage-with-tickets should land on. Every old
   * stage with tickets always requires an explicit admin-supplied mapping — there is
   * no auto-resolution to an "initial stage" or similar. Returns the resolved mapping
   * (oldStageId -> sourceStageId), the list of old stage ids still missing an override,
   * and any supplied overrides that were rejected for a category mismatch.
   *
   * Invariant: a ticket may only be remapped to a new stage of the SAME defaultTicketStatusV2
   * category it's currently in (e.g. a STARTED-status ticket can only land on a STARTED-status
   * new stage) — enforced here, not just in the frontend picker, so a malformed/bypassed
   * request can't violate it.
   *
   * Exception: this only applies to the three categories every board is guaranteed to have
   * at least one stage of (TODO/STARTED/COMPLETED — enforced on every board save, see
   * mutators.ts's board.update validation). PAUSED and CANCELLED are optional categories a
   * source board may have zero stages of, so an old stage in either of those categories may
   * be remapped to a new stage of ANY category — otherwise a source board without e.g. a
   * CANCELLED stage could never resolve a target's CANCELLED-category tickets at all.
   */
  private resolveRemapPlan(
    oldStages: OldStageInfo[],
    newStages: NewStagePreview[],
    overrides: StageRemapOverride[],
  ): { mapping: Map<string, string>; requiresExplicit: string[]; invalidCategoryOverrides: string[] } {
    const overrideByOldStage = new Map(overrides.map(o => [o.oldStageId, o.newStageId]));
    const newStageBySourceId = new Map(newStages.map(s => [s.sourceStageId, s]));
    const mapping = new Map<string, string>();
    const requiresExplicit: string[] = [];
    const invalidCategoryOverrides: string[] = [];

    for (const old of oldStages) {
      if (old.ticketCount === 0) continue;

      const override = overrideByOldStage.get(old.id);
      if (!override) {
        requiresExplicit.push(old.id);
        continue;
      }

      const overrideStage = newStageBySourceId.get(override);
      if (!overrideStage) {
        invalidCategoryOverrides.push(old.id);
        continue;
      }
      const categoryIsCompulsory = COMPULSORY_TICKET_STATUS_CATEGORIES.has(old.defaultTicketStatusV2);
      if (categoryIsCompulsory && overrideStage.defaultTicketStatusV2 !== old.defaultTicketStatusV2) {
        invalidCategoryOverrides.push(old.id);
        continue;
      }
      mapping.set(old.id, override);
    }

    return { mapping, requiresExplicit, invalidCategoryOverrides };
  }

  // ─── Plan (read-only) ───────────────────────────────────────────────────

  async planCopy(input: CopyRequestInput, workspaceId: string): Promise<PlanCopyResult> {
    const { errors, sourceBoard, targetBoard } = await this.validateBoards(
      input.sourceBoardId,
      input.targetBoardId,
      workspaceId,
    );
    if (errors.length > 0 || !sourceBoard || !targetBoard) {
      return { errors, warnings: [] };
    }

    const result: PlanCopyResult = {
      errors: [],
      warnings: [],
      sourceBoard: { id: sourceBoard.id, name: sourceBoard.name, boardType: sourceBoard.boardType },
      targetBoard: { id: targetBoard.id, name: targetBoard.name, boardType: targetBoard.boardType },
    };

    if (!input.categories.stages) {
      return result;
    }

    const sourceStages = await this.getSourceStagesOrdered(sourceBoard.id);
    const newStages: NewStagePreview[] = sourceStages.map(s => ({
      sourceStageId: s.id,
      name: s.name,
      defaultTicketStatusV2: s.defaultTicketStatusV2,
      sequenceNumber: s.sequenceNumber,
    }));
    const oldStages = await this.getOldStagesWithTicketCounts(targetBoard.id);

    const suggestedMapping = this.computeSuggestedMapping(oldStages, newStages);
    const { requiresExplicit } = this.resolveRemapPlan(oldStages, newStages, []);

    if (sourceBoard.boardType !== targetBoard.boardType) {
      result.warnings.push(
        `Target board type will change from ${targetBoard.boardType} to ${sourceBoard.boardType} to match the source board.`,
      );
    }

    return { ...result, newStages, oldStages, suggestedMapping, requiresExplicit };
  }

  // ─── Custom-field helpers ───────────────────────────────────────────────

  private parseFieldOptions(raw: string): Array<{ id: string; value: string }> | undefined {
    try {
      return JSON.parse(raw) as Array<{ id: string; value: string }>;
    } catch (error) {
      logger.warn(`${TAG} Failed to parse fieldOptions JSON — dropping options for this field`, { error });
      return undefined;
    }
  }

  /**
   * `fieldOrder` entries are `{fieldId, fieldType: 'core'|'custom'}`. Core entries are keyed
   * by field NAME (stable, safe to copy as-is). Custom entries are keyed by a resolved field
   * id that only means something on the form it was resolved from — rewritten through
   * `idMap` (old field id -> new field id on the cloned form), or dropped if unresolvable.
   */
  private remapFieldOrder(raw: unknown, idMap: Map<string, string>): unknown {
    if (!Array.isArray(raw)) return raw;
    const result: Array<{ fieldId: string; fieldType: string }> = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as { fieldId?: unknown; fieldType?: unknown };
      if (typeof e.fieldId !== 'string' || typeof e.fieldType !== 'string') continue;
      if (e.fieldType !== 'custom') {
        result.push({ fieldId: e.fieldId, fieldType: e.fieldType });
        continue;
      }
      const newId = idMap.get(e.fieldId);
      if (newId) result.push({ fieldId: newId, fieldType: 'custom' });
    }
    return result;
  }

  /** Rewrites a Record<fieldId, T> (e.g. customFieldVisibility) through idMap, dropping keys with no match. */
  private remapFieldKeyedRecord(raw: unknown, idMap: Map<string, string>): unknown {
    if (!raw || typeof raw !== 'object') return raw;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const newKey = idMap.get(key);
      if (newKey) result[newKey] = value;
    }
    return result;
  }

  /**
   * Clones the source board's ticket custom-fields form. Stays on Prisma (and stays
   * server-side) because `formsRepository.createWithFields` owns global-field dedup, branch
   * validation and sequence allocation that several other features depend on — reproducing
   * it as a Zero mutator would mean maintaining a second copy of that logic.
   *
   * Creates the new Form only; binding it to the target board is left to the caller's
   * `formContextMapping.upsert` mutation, so the clone is inert until the client commits.
   */
  private async cloneSourceCustomFieldsForm(
    sourceBoard: { id: string; projectId: string; workspaceId: string },
    targetBoardId: string,
    actorUserId: string,
  ): Promise<{
    clonedFormId: string | null;
    sourceOldToNewFieldId: Map<string, string>;
    targetOldFormId: string | null;
    fieldRepoints: BoardConfigCopyFieldRepoint[];
    warnings: string[];
  }> {
    const warnings: string[] = [];
    const sourceOldToNewFieldId = new Map<string, string>();
    const fieldRepoints: BoardConfigCopyFieldRepoint[] = [];
    let targetOldFormId: string | null = null;

    const sourceMapping = await db.formContextMapping.findFirst({
      where: { contextId: sourceBoard.id, contextType: FormContextType.BOARD, entityType: FormEntityType.TICKET },
    });
    if (!sourceMapping) return { clonedFormId: null, sourceOldToNewFieldId, targetOldFormId, fieldRepoints, warnings };

    const sourceForm = await repositories.forms.findFormWithFields(sourceMapping.formId);
    if (!sourceForm) return { clonedFormId: null, sourceOldToNewFieldId, targetOldFormId, fieldRepoints, warnings };

    const newForm = await repositories.forms.createWithFields({
      formName: `${sourceForm.formName} Copy`,
      ...(sourceForm.formDescription ? { formDescription: sourceForm.formDescription } : {}),
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
      workspaceId: sourceBoard.workspaceId,
      createdBy: actorUserId,
      projectId: sourceBoard.projectId,
      fields: sourceForm.fields.map(f => {
        const parsedOptions = f.fieldOptions ? this.parseFieldOptions(f.fieldOptions) : undefined;
        return {
          fieldName: f.fieldName,
          fieldType: f.fieldType,
          ...(parsedOptions !== undefined ? { fieldOptions: parsedOptions } : {}),
          isOptional: f.isOptional,
          ...(f.parentOptionId !== undefined ? { parentOptionId: f.parentOptionId } : {}),
        };
      }),
    });

    // createWithFields is never given an explicit fieldId, so a cloned field lands on
    // whichever GlobalField already exists for (projectId, fieldName, fieldType) —
    // normally the SAME id the source used (same project), but a fresh id when the
    // source field predates the global-field system (a "legacy" field). Resolve the
    // real mapping from what was actually created, rather than assuming ids survived.
    const newFormWithFields = await repositories.forms.findFormWithFields(newForm.id);
    if (!newFormWithFields) {
      return { clonedFormId: newForm.id, sourceOldToNewFieldId, targetOldFormId, fieldRepoints, warnings };
    }

    for (const oldField of sourceForm.fields) {
      const match = newFormWithFields.fields.find(
        nf => nf.fieldName === oldField.fieldName && nf.fieldType === oldField.fieldType,
      );
      if (match) sourceOldToNewFieldId.set(oldField.id, match.id);
    }

    // Match the target's OLD form (about to be unbound) against the same new form, by
    // normalized name — this is what lets a field that exists on both boards keep its
    // ticket values editable after the swap. The repointing itself is per-ticket data, so
    // it is deferred to the migration job rather than done here.
    const targetMapping = await db.formContextMapping.findFirst({
      where: { contextId: targetBoardId, contextType: FormContextType.BOARD, entityType: FormEntityType.TICKET },
    });
    if (targetMapping) {
      const targetOldForm = await repositories.forms.findFormWithFields(targetMapping.formId);
      if (targetOldForm) {
        targetOldFormId = targetOldForm.id;
        for (const oldField of targetOldForm.fields) {
          const normalizedName = oldField.fieldName.trim().toLowerCase();
          const match = newFormWithFields.fields.find(
            nf => nf.fieldName.trim().toLowerCase() === normalizedName,
          );
          if (!match) continue; // unique to the target — left as-is, shown read-only
          if (match.fieldType !== oldField.fieldType) {
            warnings.push(
              `Field "${oldField.fieldName}" exists on both boards with different types — its existing ticket values were left as-is rather than risk showing a value of the wrong type.`,
            );
            continue;
          }
          fieldRepoints.push({ oldFieldId: oldField.id, newFieldId: match.id });
        }
      }
    }

    return { clonedFormId: newForm.id, sourceOldToNewFieldId, targetOldFormId, fieldRepoints, warnings };
  }

  // ─── Prepare (server-side work only; the client commits the config) ─────

  /**
   * Computes everything the dashboard needs to apply this copy through the ordinary Zero
   * mutators, and performs the two steps a browser can't: writing the pre-copy snapshot and
   * cloning the custom-fields form. Deliberately writes NO board configuration itself —
   * stages, transitions, form binding and metadata are all committed by the client, exactly
   * like an ordinary board edit.
   *
   * Any ticket-level work (stage remap, custom-field value repointing) is stashed as a
   * pending migration plan and picked up by `startTicketMigration` once the client's
   * mutations land.
   */
  async prepareCopy(
    input: PrepareCopyInput,
    actorUserId: string,
    workspaceId: string,
  ): Promise<PrepareCopyResult> {
    const { errors, sourceBoard, targetBoard } = await this.validateBoards(
      input.sourceBoardId,
      input.targetBoardId,
      workspaceId,
    );
    if (errors.length > 0 || !sourceBoard || !targetBoard) {
      throw new BoardConfigCopyValidationError(errors.length > 0 ? errors : ['Validation failed']);
    }

    const warnings: string[] = [];
    const targetMetadata: Record<string, unknown> = {
      ...((targetBoard.metadata as Record<string, unknown> | null) ?? {}),
    };
    const sourceMetadata = (sourceBoard.metadata as Record<string, unknown> | null) ?? {};

    // ── Stage set ────────────────────────────────────────────────────────
    let preparedStages: PreparedStage[] | undefined;
    let prStatusMappingIds: Record<string, string> | undefined;
    let preparedTransitions: PreparedTransition[] | null = null;
    const ticketRemap: BoardConfigCopyTicketRemap[] = [];
    let oldStageCount = 0;
    let ticketsToMigrate = 0;

    if (input.categories.stages) {
      const sourceStages = await this.getSourceStagesOrdered(sourceBoard.id);
      const newStagesPreview: NewStagePreview[] = sourceStages.map(s => ({
        sourceStageId: s.id,
        name: s.name,
        defaultTicketStatusV2: s.defaultTicketStatusV2,
        sequenceNumber: s.sequenceNumber,
      }));
      const oldStages = await this.getOldStagesWithTicketCounts(targetBoard.id);
      oldStageCount = oldStages.length;
      ticketsToMigrate = oldStages.reduce((sum, s) => sum + s.ticketCount, 0);

      const { mapping, requiresExplicit, invalidCategoryOverrides } = this.resolveRemapPlan(
        oldStages,
        newStagesPreview,
        input.stageRemapOverrides ?? [],
      );

      if (invalidCategoryOverrides.length > 0) {
        throw new BoardConfigCopyValidationError(
          [
            'Some stage mappings target a stage with a different status than the tickets being moved — ' +
              'a ticket can only be remapped to a new stage of the same status.',
          ],
          invalidCategoryOverrides,
        );
      }
      if (requiresExplicit.length > 0) {
        throw new BoardConfigCopyValidationError(
          ['Some old stages with tickets still need an explicit target stage'],
          requiresExplicit,
        );
      }

      const sourceStageIdToNewStageId = new Map(
        sourceStages.map(s => [s.id, this.deriveDeterministicId('board-config-copy-stage', targetBoard.id, s.id)]),
      );

      preparedStages = sourceStages.map(s => ({
        id: sourceStageIdToNewStageId.get(s.id)!,
        name: s.name,
        ...(s.eta !== null ? { eta: s.eta } : {}),
        sequenceNumber: s.sequenceNumber,
        defaultTicketStatusV2: s.defaultTicketStatusV2,
        requestApprovalOnEntry: s.requestApprovalOnEntry,
        prStatuses: s.prStatuses,
        approvers: s.approvers,
        ...(s.formId ? { formId: s.formId } : {}),
      }));

      // board.update requires a caller-supplied id for every PR-status mapping it inserts,
      // keyed "<sequenceNumber>-<prStatus>".
      prStatusMappingIds = {};
      for (const stage of preparedStages) {
        for (const prStatus of stage.prStatuses) {
          prStatusMappingIds[`${stage.sequenceNumber}-${prStatus}`] = this.deriveDeterministicId(
            'board-config-copy-pr-mapping',
            stage.id,
            prStatus,
          );
        }
      }

      if (sourceBoard.boardType === BoardType.NON_LINEAR) {
        const sourceTransitions = await this.getSourceTransitions(sourceBoard.id);
        preparedTransitions = sourceTransitions.map(t => {
          const fromStageId = t.fromStageId ? (sourceStageIdToNewStageId.get(t.fromStageId) ?? null) : null;
          const toStageId = sourceStageIdToNewStageId.get(t.toStageId)!;
          return {
            id: this.deriveDeterministicId(
              'board-config-copy-transition',
              targetBoard.id,
              fromStageId ?? 'ROOT',
              toStageId,
            ),
            fromStageId,
            toStageId,
            ...(t.formId ? { formId: t.formId } : {}),
            requiresApproval: t.requiresApproval,
            bypassApprovalForAutomation: t.bypassApprovalForAutomation,
            requestApprovalOnEntry: t.requestApprovalOnEntry,
            ...(t.visitSlaMode ? { visitSlaMode: t.visitSlaMode } : {}),
            ...(t.fixedEtaHours !== undefined && t.fixedEtaHours !== null ? { fixedEtaHours: t.fixedEtaHours } : {}),
            ...(t.onReenter ? { onReenter: t.onReenter } : {}),
            approvers: t.approvers.map(a => ({
              id: this.deriveDeterministicId('board-config-copy-approver', toStageId, a.approverId, a.approverType),
              approverId: a.approverId,
              approverType: a.approverType,
            })),
          };
        });
      }

      // Every old stage's landing target, resolved now. The old Stage rows are deleted the
      // moment the client's board.update lands, so this is the only surviving record of
      // where each ticket belongs — including a same-category fallback for stages that were
      // empty at prepare time but could receive a ticket in the meantime.
      const futureStagesEtaHoursByNewStageId: Record<string, number> = {};
      if (sourceBoard.boardType !== BoardType.NON_LINEAR) {
        for (const stage of preparedStages) {
          futureStagesEtaHoursByNewStageId[stage.id] = preparedStages
            .filter(s => s.sequenceNumber > stage.sequenceNumber)
            .reduce((sum, s) => sum + (s.eta ?? 0), 0);
        }
      } else {
        for (const stage of preparedStages) futureStagesEtaHoursByNewStageId[stage.id] = 0;
      }

      const orderedNewStages = [...preparedStages].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      const newStageNames = new Set(preparedStages.map(s => s.name));

      for (const old of oldStages) {
        // A name the new stage set still provides needs no migration — the ticket's
        // stageName text already resolves to the freshly-upserted stage.
        if (newStageNames.has(old.name)) continue;

        const mappedSourceStageId = mapping.get(old.id);
        const target = mappedSourceStageId
          ? preparedStages.find(s => s.id === sourceStageIdToNewStageId.get(mappedSourceStageId))
          : (orderedNewStages.find(s => s.defaultTicketStatusV2 === old.defaultTicketStatusV2) ??
            orderedNewStages[0]);
        if (!target) continue;

        ticketRemap.push({
          oldStageId: old.id,
          oldStageName: old.name,
          newStageId: target.id,
          newStageName: target.name,
          newStageEta: target.eta ?? null,
          newStageStatusV2: target.defaultTicketStatusV2,
          futureStagesEtaHours: futureStagesEtaHoursByNewStageId[target.id] ?? 0,
        });
      }
    }

    // ── Custom fields & roles → board metadata ───────────────────────────
    let clonedFormId: string | null = null;
    let targetOldFormId: string | null = null;
    let fieldRepoints: BoardConfigCopyFieldRepoint[] = [];
    let customFieldsCopied = false;
    let rolesCopied = false;

    if (input.categories.customFields && !input.dryRun) {
      const clone = await this.cloneSourceCustomFieldsForm(
        { id: sourceBoard.id, projectId: sourceBoard.projectId, workspaceId: sourceBoard.workspaceId },
        targetBoard.id,
        actorUserId,
      );
      clonedFormId = clone.clonedFormId;
      targetOldFormId = clone.targetOldFormId;
      fieldRepoints = clone.fieldRepoints;
      warnings.push(...clone.warnings);

      if (clonedFormId) targetMetadata['customFieldsFormId'] = clonedFormId;
      targetMetadata['fieldOrder'] = this.remapFieldOrder(sourceMetadata['fieldOrder'], clone.sourceOldToNewFieldId);
      targetMetadata['ticketFormConfig'] = sourceMetadata['ticketFormConfig'];
      targetMetadata['customFieldVisibility'] = this.remapFieldKeyedRecord(
        sourceMetadata['customFieldVisibility'],
        clone.sourceOldToNewFieldId,
      );
      customFieldsCopied = true;
    } else if (input.categories.customFields) {
      customFieldsCopied = true; // dry run — reported, not performed
    }

    if (input.categories.roles) {
      targetMetadata['assignmentRoles'] = sourceMetadata['assignmentRoles'] ?? [];
      targetMetadata['ticketControlRoleIds'] = sourceMetadata['ticketControlRoleIds'] ?? [];
      targetMetadata['bitbucketEventRoles'] = sourceMetadata['bitbucketEventRoles'] ?? {};
      rolesCopied = true;
    }

    const boardUpdate: PreparedBoardUpdate = {
      boardId: targetBoard.id,
      boardType: sourceBoard.boardType,
      metadata: targetMetadata,
      ...(preparedStages ? { stages: preparedStages, prStatusMappingIds } : {}),
    };

    const boardFormMapping: PreparedBoardFormMapping | null = clonedFormId
      ? {
          contextId: targetBoard.id,
          contextType: FormContextType.BOARD,
          entityType: FormEntityType.TICKET,
          formId: clonedFormId,
          mappingId: this.deriveDeterministicId('board-config-copy-form-mapping', targetBoard.id, clonedFormId),
        }
      : null;

    const result: PrepareCopyResult = {
      dryRun: input.dryRun,
      customFieldsCopied,
      rolesCopied,
      newStageCount: preparedStages?.length ?? 0,
      deletedOldStageCount: preparedStages ? oldStageCount : 0,
      ticketsToMigrate,
      warnings,
      boardUpdate,
      boardFormMapping,
      transitions: preparedTransitions,
      hasPendingMigration: false,
    };

    if (input.dryRun) {
      return result;
    }

    // Snapshot before handing anything back — the client is about to mutate the board, so
    // there must already be a restore point. Fail closed: no snapshot, no copy.
    try {
      const snapshot = await boardConfigCopySnapshotService.captureSnapshot({
        targetBoardId: targetBoard.id,
        sourceBoardId: sourceBoard.id,
        workspaceId,
        actorUserId,
      });
      result.snapshotPath = snapshot.path;
    } catch (error) {
      logger.error(`${TAG} Snapshot failed for board ${targetBoard.id} — aborting before any change`, error);
      // The form clone committed independently; drop it rather than leave it orphaned.
      if (clonedFormId) {
        await db.form.delete({ where: { id: clonedFormId } }).catch(cleanupError => {
          logger.error(`${TAG} Failed to clean up orphaned form ${clonedFormId} after a failed snapshot`, cleanupError);
        });
      }
      throw new BoardConfigCopyValidationError([
        'Could not back up the target board before copying, so nothing was changed. Please retry.',
      ]);
    }
    void boardConfigCopySnapshotService.sweepExpiredSnapshots();

    const needsMigration = ticketRemap.length > 0 || fieldRepoints.length > 0;
    if (needsMigration) {
      const jobData: BoardConfigCopyJobData = {
        targetBoardId: targetBoard.id,
        workspaceId,
        actorUserId,
        ticketRemap,
        fieldRepoints,
        targetOldFormId,
        clonedFormId,
        snapshotPath: result.snapshotPath!,
      };
      await redisService.set(
        pendingMigrationKey(targetBoard.id),
        JSON.stringify(jobData),
        PENDING_MIGRATION_TTL_SECONDS,
      );
      result.hasPendingMigration = true;
    }

    return result;
  }

  /**
   * Enqueues the ticket-migration job the client's just-committed config left pending.
   * Reads the plan from the server-side stash rather than the request body: by now the old
   * stages are gone, so a caller-supplied remap could silently send tickets anywhere.
   */
  async startTicketMigration(targetBoardId: string, workspaceId: string): Promise<{ jobId: string } | null> {
    const raw = await redisService.get(pendingMigrationKey(targetBoardId));
    if (!raw) return null;

    const jobData = JSON.parse(raw) as BoardConfigCopyJobData;
    if (jobData.workspaceId !== workspaceId || jobData.targetBoardId !== targetBoardId) {
      logger.warn(`${TAG} Refusing to start migration — stashed plan does not match caller's workspace/board`);
      return null;
    }

    const { enqueued, reason } = await boardConfigCopyQueue.addJob(jobData);
    if (!enqueued) {
      throw new BoardConfigCopyConflictError(reason ?? 'A migration is already in progress for this board');
    }
    await redisService.del(pendingMigrationKey(targetBoardId));
    return { jobId: targetBoardId };
  }

  // ─── Worker-facing: per-ticket work only ─────────────────────────────────

  async findTicketsOnOldStages(
    targetBoardId: string,
    oldStageNames: string[],
    cursor: string | null,
    take: number,
  ): Promise<Array<{ id: string; stageName: string }>> {
    return db.ticket.findMany({
      where: {
        boardId: targetBoardId,
        stageName: { in: oldStageNames },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, stageName: true },
      orderBy: { id: 'asc' },
      take,
    });
  }

  /**
   * Moves a single ticket off its old stage onto the resolved new stage. Idempotent —
   * guarded by `stageName: oldStageName` so a retry after a partial run is a safe no-op
   * for tickets that already moved.
   */
  async applyStageRemap(
    ticketId: string,
    targetBoardId: string,
    oldStageId: string,
    oldStageName: string,
    target: { newStageId: string; newStageName: string; newStageEta: number | null; newStageStatusV2: string; futureStagesEtaHours: number },
    actorUserId: string,
  ): Promise<'updated' | 'skipped'> {
    return db.$transaction(async tx => {
      const ticket = await tx.ticket.findFirst({
        where: { id: ticketId, boardId: targetBoardId, stageName: oldStageName },
        select: { id: true, workspaceId: true, statusV2: true },
      });
      if (!ticket) return 'skipped';

      const now = new Date();

      const targetStageEta =
        target.newStageEta !== null && target.newStageEta > 0 ? calculateETADeadline(now, target.newStageEta) : now;
      const recomputedEta = recomputeOverallTicketEta(targetStageEta, now, target.futureStagesEtaHours);
      const statusChanged = ticket.statusV2 !== target.newStageStatusV2;

      // Compare-and-swap: re-assert `stageName: oldStageName` at write time instead of
      // trusting the read above. If a user moved this ticket through the UI in between,
      // Postgres re-evaluates the predicate against their committed row and matches zero
      // rows — the human's change wins and the job leaves it alone. This runs before the
      // ETA-ledger writes so the lost-the-race path has no side effects to undo.
      const { count } = await tx.ticket.updateMany({
        where: { id: ticket.id, boardId: targetBoardId, stageName: oldStageName },
        data: {
          stageName: target.newStageName,
          statusV2: target.newStageStatusV2,
          ...(statusChanged ? { statusUpdatedAt: now } : {}),
          ...(recomputedEta ? { eta: recomputedEta } : {}),
          updatedBy: actorUserId,
          updatedAt: now,
        },
      });
      if (count === 0) return 'skipped';

      await tx.ticketStageEta.updateMany({
        where: { ticketId: ticket.id, stageId: oldStageId, stageLeftAt: null },
        data: { stageLeftAt: now, updatedAt: now, updatedBy: actorUserId },
      });

      const existing = await tx.ticketStageEta.findFirst({
        where: { ticketId: ticket.id, stageId: target.newStageId },
      });
      if (existing) {
        await tx.ticketStageEta.update({
          where: { id: existing.id },
          data: {
            stageEnteredAt: now,
            stageLeftAt: null,
            ...(target.newStageEta !== null && target.newStageEta > 0 ? { stageEta: targetStageEta } : {}),
            updatedAt: now,
            updatedBy: actorUserId,
          },
        });
      } else if (target.newStageEta !== null && target.newStageEta > 0) {
        await tx.ticketStageEta.create({
          data: {
            ticketId: ticket.id,
            workspaceId: ticket.workspaceId,
            stageId: target.newStageId,
            stageEnteredAt: now,
            stageLeftAt: null,
            stageEta: targetStageEta,
            updatedBy: actorUserId,
          },
        });
      }

      // updateMany doesn't return the row, so re-read it for the markdown sync.
      const updatedTicket = await tx.ticket.findUnique({ where: { id: ticket.id } });
      if (updatedTicket) await syncConversationTicketMdFromPrismaTicket(tx, updatedTicket);

      return 'updated';
    });
  }

  /**
   * Repoints existing ticket custom-field values from the target board's old form onto the
   * cloned one, for fields both boards share — otherwise they'd become stale rows against
   * an unbound form, surfacing as un-editable "prefill" values that collide on save.
   *
   * Per-ticket data (one row per ticket per field), so it belongs to the migration job
   * rather than the client's config mutation — but it's a bulk UPDATE per field, not a
   * per-ticket round trip. Each field is independent: a failure is logged and skipped, and
   * the untouched rows stay exactly where they were.
   */
  async repointFormEntityValues(
    targetBoardId: string,
    targetOldFormId: string,
    clonedFormId: string,
    fieldRepoints: BoardConfigCopyFieldRepoint[],
    actorUserId: string,
  ): Promise<{ repointed: number; warnings: string[] }> {
    const warnings: string[] = [];
    let repointed = 0;

    for (const { oldFieldId, newFieldId } of fieldRepoints) {
      try {
        const { count } = await db.formEntityValues.updateMany({
          where: {
            fieldId: oldFieldId,
            formId: targetOldFormId,
            entityType: FormEntityType.TICKET,
            contextId: targetBoardId,
          },
          data: { fieldId: newFieldId, formId: clonedFormId, updatedAt: new Date() },
        });
        repointed += count;
      } catch (error) {
        logger.error(`${TAG} Failed to repoint ticket values for field ${oldFieldId} -> ${newFieldId}`, error);
        warnings.push(
          'Some existing ticket values for a shared custom field could not be repointed to the new form — they may need to be re-entered.',
        );
      }
    }

    logger.info(`${TAG} Repointed ${repointed} custom-field value(s) on board ${targetBoardId} for ${actorUserId}`);
    return { repointed, warnings };
  }
}

export const boardConfigCopyService = new BoardConfigCopyService();
