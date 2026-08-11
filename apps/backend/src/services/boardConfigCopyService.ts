import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { BoardType, TicketStatusV2, FormContextType, FormEntityType, ApproverType } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { boardConfigCopySnapshotService } from '@/services/boardConfigCopySnapshotService';
import { calculateETADeadline, recomputeOverallTicketEta } from '@/utils/etaCalculation';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { logger } from '@/utils/logger';
import {
  boardConfigCopyQueue,
  BoardConfigCopyJobData,
  BoardConfigCopyStageInput,
  BoardConfigCopyTransitionInput,
  BoardConfigCopySummary,
} from '@/queues/boardConfigCopyQueue';

const TAG = '[BoardConfigCopy]';

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

export interface ExecuteCopyInput extends CopyRequestInput {
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

  // ─── Custom fields & roles (fast, synchronous) ─────────────────────────

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
   * Public (not private) and id-keyed rather than board-object-keyed: called both from
   * `executeCopy`'s synchronous no-stages path and from the worker's phase 0, so it fetches
   * its own board rows instead of trusting a caller-supplied snapshot that may be stale by
   * the time an async job actually runs.
   */
  async copyCustomFieldsAndRoles(
    sourceBoardId: string,
    targetBoardId: string,
    categories: CopyCategorySelection,
    actorUserId: string,
  ): Promise<{ customFieldsCopied: boolean; rolesCopied: boolean; customFieldWarnings: string[] }> {
    const [sourceBoard, targetBoard] = await Promise.all([
      db.board.findUnique({ where: { id: sourceBoardId }, select: { id: true, projectId: true, workspaceId: true } }),
      db.board.findUnique({ where: { id: targetBoardId }, select: { id: true, metadata: true } }),
    ]);
    if (!sourceBoard || !targetBoard) {
      return { customFieldsCopied: false, rolesCopied: false, customFieldWarnings: [] };
    }

    const targetMetadata = { ...(targetBoard.metadata as Record<string, unknown> | null) };
    let customFieldsCopied = false;
    let rolesCopied = false;
    const customFieldWarnings: string[] = [];

    // Cloning the source form (if any) happens OUTSIDE the transaction below on purpose:
    // formsRepository.createWithFields runs its own db.$transaction internally, and Prisma
    // doesn't nest/join $transaction calls made on the same client — it's a second,
    // independent transaction that commits as soon as createWithFields returns, regardless
    // of what happens afterward. Pretending it was part of the outer transaction was
    // misleading; instead we create it first and explicitly clean it up in the catch below
    // if the rest of the operation fails.
    let clonedFormId: string | null = null;
    const oldToNewFieldId = new Map<string, string>();

    // Fields present on BOTH the target's old form and the new cloned form (matched by
    // normalized name, since that's the same identity rule assertNoNameCollisions itself
    // uses) — their ticket values must be repointed onto the new form/field afterward so
    // they stay editable instead of becoming stuck "prefill" rows that collide on save
    // (see boardFormEntityValues.ts's formId-agnostic fallback + formEntityValue.createV2's
    // insert-only path). Populated below, consumed once the transaction below commits.
    // Fields unique to the target board are deliberately left out of this map — their old
    // Form/FormFields rows and value rows are untouched and shown read-only on ticket detail.
    let targetOldFormId: string | null = null;
    const targetOldToNewFieldId = new Map<string, string>();

    if (categories.customFields) {
      const sourceMapping = await db.formContextMapping.findFirst({
        where: { contextId: sourceBoard.id, contextType: FormContextType.BOARD, entityType: FormEntityType.TICKET },
      });

      if (sourceMapping) {
        const sourceForm = await repositories.forms.findFormWithFields(sourceMapping.formId);
        if (sourceForm) {
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
          clonedFormId = newForm.id;

          // createWithFields is never given an explicit fieldId, so a cloned field lands on
          // whichever GlobalField already exists for (projectId, fieldName, fieldType) —
          // normally the SAME id the source used (same project), but a fresh id when the
          // source field predates the global-field system (a "legacy" field). Resolve the
          // real mapping from what was actually created, rather than assuming ids survived.
          const newFormWithFields = await repositories.forms.findFormWithFields(newForm.id);
          if (newFormWithFields) {
            for (const oldField of sourceForm.fields) {
              const match = newFormWithFields.fields.find(
                nf => nf.fieldName === oldField.fieldName && nf.fieldType === oldField.fieldType,
              );
              if (match) oldToNewFieldId.set(oldField.id, match.id);
            }

            // Match the target's OLD form (about to be unbound) against the same new form,
            // by normalized name — this is what lets a field that exists on both boards
            // keep its ticket values editable after the swap.
            const targetMapping = await db.formContextMapping.findFirst({
              where: { contextId: targetBoard.id, contextType: FormContextType.BOARD, entityType: FormEntityType.TICKET },
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
                    customFieldWarnings.push(
                      `Field "${oldField.fieldName}" exists on both boards with different types — its existing ticket values were left as-is rather than risk showing a value of the wrong type.`,
                    );
                    continue;
                  }
                  targetOldToNewFieldId.set(oldField.id, match.id);
                }
              }
            }
          }
        }
      }
    }

    try {
      await db.$transaction(async tx => {
        const sourceBoardRow =
          categories.customFields || categories.roles
            ? await tx.board.findUnique({ where: { id: sourceBoard.id } })
            : null;
        const sourceMetadata = (sourceBoardRow?.metadata as Record<string, unknown> | null) ?? {};

        if (categories.customFields) {
          if (clonedFormId) {
            // FormContextMapping has @@unique([contextId, entityType]) — a stale target
            // mapping must go before the new one can be inserted.
            await tx.formContextMapping.deleteMany({
              where: { contextId: targetBoard.id, contextType: FormContextType.BOARD, entityType: FormEntityType.TICKET },
            });
            await tx.formContextMapping.create({
              data: {
                id: randomUUID(),
                formId: clonedFormId,
                contextId: targetBoard.id,
                contextType: FormContextType.BOARD,
                entityType: FormEntityType.TICKET,
                workspaceId: sourceBoard.workspaceId,
              },
            });
            targetMetadata['customFieldsFormId'] = clonedFormId;
          }

          targetMetadata['fieldOrder'] = this.remapFieldOrder(sourceMetadata['fieldOrder'], oldToNewFieldId);
          targetMetadata['ticketFormConfig'] = sourceMetadata['ticketFormConfig'];
          targetMetadata['customFieldVisibility'] = this.remapFieldKeyedRecord(
            sourceMetadata['customFieldVisibility'],
            oldToNewFieldId,
          );
          customFieldsCopied = true;
        }

        if (categories.roles) {
          targetMetadata['assignmentRoles'] = sourceMetadata['assignmentRoles'] ?? [];
          targetMetadata['ticketControlRoleIds'] = sourceMetadata['ticketControlRoleIds'] ?? [];
          targetMetadata['bitbucketEventRoles'] = sourceMetadata['bitbucketEventRoles'] ?? {};
          rolesCopied = true;
        }

        if (customFieldsCopied || rolesCopied) {
          await tx.board.update({
            where: { id: targetBoard.id },
            data: {
              metadata: targetMetadata as Prisma.InputJsonValue,
              updatedBy: actorUserId,
              updatedAt: new Date(),
            },
          });
        }
      });
    } catch (error) {
      // The form clone above already committed independently of this transaction — clean
      // it up rather than leaving an orphaned Form/FormFields nothing references.
      if (clonedFormId) {
        await db.form.delete({ where: { id: clonedFormId } }).catch(cleanupError => {
          logger.error(`${TAG} Failed to clean up orphaned form ${clonedFormId} after a failed copy`, cleanupError);
        });
      }
      throw error;
    }

    // Repoint ticket values for fields shared by both boards so they remain first-class,
    // editable rows on the new form instead of stale rows pointing at the just-unbound old
    // one. Runs after the mapping swap has committed — each field's remap is independent
    // and safe to skip on failure (the row just stays where it was, still recoverable).
    if (clonedFormId && targetOldFormId && targetOldToNewFieldId.size > 0) {
      for (const [oldFieldId, newFieldId] of targetOldToNewFieldId) {
        try {
          await db.formEntityValues.updateMany({
            where: {
              fieldId: oldFieldId,
              formId: targetOldFormId,
              entityType: FormEntityType.TICKET,
              contextId: targetBoard.id,
            },
            data: { fieldId: newFieldId, formId: clonedFormId, updatedAt: new Date() },
          });
        } catch (error) {
          logger.error(`${TAG} Failed to repoint ticket values for field ${oldFieldId} -> ${newFieldId}`, error);
          customFieldWarnings.push(
            'Some existing ticket values for a shared custom field could not be repointed to the new form — they may need to be re-entered.',
          );
        }
      }
    }

    return { customFieldsCopied, rolesCopied, customFieldWarnings };
  }

  // ─── Execute ─────────────────────────────────────────────────────────────

  async executeCopy(
    input: ExecuteCopyInput,
    actorUserId: string,
    workspaceId: string,
  ): Promise<{ jobId?: string; summary?: BoardConfigCopySummary }> {
    const { errors, sourceBoard, targetBoard } = await this.validateBoards(
      input.sourceBoardId,
      input.targetBoardId,
      workspaceId,
    );
    if (errors.length > 0 || !sourceBoard || !targetBoard) {
      throw new BoardConfigCopyValidationError(errors.length > 0 ? errors : ['Validation failed']);
    }

    if (input.dryRun) {
      return { summary: await this.buildDryRunSummary(input, targetBoard) };
    }

    // Snapshot first — before a single row is touched — so there is always a restore point
    // for a copy that turns out to be wrong. Deliberately fail-closed: if the snapshot
    // can't be written we abort while the board is still untouched, rather than run a
    // destructive, irreversible operation with no undo.
    let snapshotPath: string;
    try {
      const snapshot = await boardConfigCopySnapshotService.captureSnapshot({
        targetBoardId: targetBoard.id,
        sourceBoardId: sourceBoard.id,
        workspaceId,
        actorUserId,
      });
      snapshotPath = snapshot.path;
    } catch (error) {
      logger.error(`${TAG} Snapshot failed for board ${targetBoard.id} — aborting before any change`, error);
      throw new BoardConfigCopyValidationError([
        'Could not back up the target board before copying, so nothing was changed. Please retry.',
      ]);
    }
    void boardConfigCopySnapshotService.sweepExpiredSnapshots();

    // No async leg for this path — customFields/roles copy is the entire operation, so it
    // runs synchronously here and the request/response IS the transaction boundary.
    if (!input.categories.stages) {
      const { customFieldsCopied, rolesCopied, customFieldWarnings } = await this.copyCustomFieldsAndRoles(
        sourceBoard.id,
        targetBoard.id,
        input.categories,
        actorUserId,
      );
      return {
        summary: {
          customFieldsCopied,
          rolesCopied,
          snapshotPath,
          stages: { batches: 0, processed: 0, updated: 0, skipped: 0, errors: 0, failedTicketIds: [], newStageCount: 0, deletedOldStageCount: 0 },
          warnings: customFieldWarnings,
        },
      };
    }

    // When stages ARE selected, customFields/roles are deliberately NOT copied here —
    // they're deferred to phase 0 of the worker job below, so one job owns the entire
    // mutation sequence. Previously this ran synchronously and committed before the stage
    // job was even enqueued: if the stage job later failed, the board was left with new
    // fields/roles bound but old stages intact — a half-migrated state with no job record
    // reflecting it. Folding this into the job means a failure anywhere in the sequence
    // (including here) surfaces as a single failed job, and nothing runs before it that
    // could itself be left dangling if the job never got created.

    const sourceStages = await this.getSourceStagesOrdered(sourceBoard.id);
    const sourceTransitions =
      sourceBoard.boardType === BoardType.NON_LINEAR ? await this.getSourceTransitions(sourceBoard.id) : [];
    const newStagesPreview: NewStagePreview[] = sourceStages.map(s => ({
      sourceStageId: s.id,
      name: s.name,
      defaultTicketStatusV2: s.defaultTicketStatusV2,
      sequenceNumber: s.sequenceNumber,
    }));
    const oldStages = await this.getOldStagesWithTicketCounts(targetBoard.id);

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

    // Mint fresh ids for every new stage/transition up front so the job payload is
    // fully self-contained and phase 1 (insert) can safely `upsert` on retry.
    const sourceStageIdToNewStageId = new Map(sourceStages.map(s => [s.id, randomUUID()]));

    const newStages: BoardConfigCopyStageInput[] = sourceStages.map(s => ({
      id: sourceStageIdToNewStageId.get(s.id)!,
      name: s.name,
      eta: s.eta,
      sequenceNumber: s.sequenceNumber,
      defaultTicketStatusV2: s.defaultTicketStatusV2,
      requestApprovalOnEntry: s.requestApprovalOnEntry,
      prStatuses: s.prStatuses,
      approvers: s.approvers,
      ...(s.formId ? { formId: s.formId } : {}),
    }));

    const newTransitions: BoardConfigCopyTransitionInput[] = sourceTransitions.map(t => ({
      id: randomUUID(),
      fromStageId: t.fromStageId ? (sourceStageIdToNewStageId.get(t.fromStageId) ?? null) : null,
      toStageId: sourceStageIdToNewStageId.get(t.toStageId)!,
      ...(t.formId ? { formId: t.formId } : {}),
      requiresApproval: t.requiresApproval,
      bypassApprovalForAutomation: t.bypassApprovalForAutomation,
      requestApprovalOnEntry: t.requestApprovalOnEntry,
      ...(t.visitSlaMode ? { visitSlaMode: t.visitSlaMode } : {}),
      ...(t.fixedEtaHours !== undefined && t.fixedEtaHours !== null ? { fixedEtaHours: t.fixedEtaHours } : {}),
      ...(t.onReenter ? { onReenter: t.onReenter } : {}),
      approvers: t.approvers,
    }));

    const newStageById = new Map(newStages.map(s => [s.id, s]));
    const futureStagesEtaHoursByNewStageId: Record<string, number> = {};
    if (sourceBoard.boardType !== BoardType.NON_LINEAR) {
      for (const stage of newStages) {
        futureStagesEtaHoursByNewStageId[stage.id] = newStages
          .filter(s => s.sequenceNumber > stage.sequenceNumber)
          .reduce((sum, s) => sum + (s.eta ?? 0), 0);
      }
    } else {
      for (const stage of newStages) futureStagesEtaHoursByNewStageId[stage.id] = 0;
    }

    const ticketRemapByOldStageId: BoardConfigCopyJobData['ticketRemapByOldStageId'] = {};
    for (const [oldStageId, sourceStageId] of mapping.entries()) {
      const newStageId = sourceStageIdToNewStageId.get(sourceStageId);
      const newStage = newStageId ? newStageById.get(newStageId) : undefined;
      if (!newStageId || !newStage) continue;
      ticketRemapByOldStageId[oldStageId] = {
        newStageId,
        newStageName: newStage.name,
        newStageEta: newStage.eta,
        newStageStatusV2: newStage.defaultTicketStatusV2,
        futureStagesEtaHours: futureStagesEtaHoursByNewStageId[newStageId] ?? 0,
      };
    }

    const jobData: BoardConfigCopyJobData = {
      targetBoardId: targetBoard.id,
      sourceBoardId: sourceBoard.id,
      actorUserId,
      workspaceId,
      newBoardType: sourceBoard.boardType,
      newStages,
      newTransitions,
      // All old stages get deleted regardless of ticket count — only the ones with
      // tickets need an entry in ticketRemapByOldStageId.
      oldStages: oldStages.map(o => ({
        id: o.id,
        name: o.name,
        defaultTicketStatusV2: o.defaultTicketStatusV2,
      })),
      ticketRemapByOldStageId,
      futureStagesEtaHoursByNewStageId,
      copyCustomFields: input.categories.customFields,
      copyRoles: input.categories.roles,
      snapshotPath,
    };

    const { enqueued, reason } = await boardConfigCopyQueue.addJob(jobData);
    if (!enqueued) {
      throw new BoardConfigCopyConflictError(reason ?? 'A copy is already in progress for this board');
    }

    return { jobId: targetBoard.id };
  }

  private async buildDryRunSummary(
    input: ExecuteCopyInput,
    targetBoard: { id: string },
  ): Promise<BoardConfigCopySummary> {
    const warnings: string[] = [];
    let ticketCount = 0;
    if (input.categories.stages) {
      const oldStages = await this.getOldStagesWithTicketCounts(targetBoard.id);
      ticketCount = oldStages.reduce((sum, s) => sum + s.ticketCount, 0);
    }
    return {
      customFieldsCopied: input.categories.customFields,
      rolesCopied: input.categories.roles,
      stages: {
        batches: Math.ceil(ticketCount / 50),
        processed: ticketCount,
        updated: ticketCount,
        skipped: 0,
        errors: 0,
        failedTicketIds: [],
        newStageCount: 0,
        deletedOldStageCount: 0,
      },
      warnings,
    };
  }

  // ─── Worker-facing phases ────────────────────────────────────────────────

  async insertNewStagesPhase(job: BoardConfigCopyJobData): Promise<void> {
    await db.$transaction(async tx => {
      for (const stage of job.newStages) {
        await tx.stage.upsert({
          where: { id: stage.id },
          create: {
            id: stage.id,
            workspaceId: job.workspaceId,
            name: stage.name,
            eta: stage.eta,
            boardId: job.targetBoardId,
            sequenceNumber: stage.sequenceNumber,
            createdBy: job.actorUserId,
            updatedBy: job.actorUserId,
            defaultTicketStatusV2: stage.defaultTicketStatusV2,
            requestApprovalOnEntry: stage.requestApprovalOnEntry,
          },
          update: {
            name: stage.name,
            eta: stage.eta,
            sequenceNumber: stage.sequenceNumber,
            defaultTicketStatusV2: stage.defaultTicketStatusV2,
            requestApprovalOnEntry: stage.requestApprovalOnEntry,
            updatedBy: job.actorUserId,
          },
        });

        for (const prStatus of stage.prStatuses) {
          await tx.stagePRStatusMapping.upsert({
            where: { stageId_prStatus: { stageId: stage.id, prStatus } },
            create: { id: randomUUID(), stageId: stage.id, prStatus, workspaceId: job.workspaceId },
            update: {},
          });
        }

        if (stage.formId) {
          await tx.formContextMapping.upsert({
            where: {
              contextId_contextType_formId: {
                contextId: stage.id,
                contextType: FormContextType.STAGE,
                formId: stage.formId,
              },
            },
            create: {
              id: randomUUID(),
              formId: stage.formId,
              contextId: stage.id,
              contextType: FormContextType.STAGE,
              entityType: FormEntityType.TICKET,
              workspaceId: job.workspaceId,
            },
            update: {},
          });
        }

        for (const approver of stage.approvers) {
          if (approver.approverType === 'ROLE') {
            await tx.stageApprovers.upsert({
              where: {
                stageId_roleId_approverType: {
                  stageId: stage.id,
                  roleId: approver.approverId,
                  approverType: approver.approverType,
                },
              },
              create: {
                id: randomUUID(),
                stageId: stage.id,
                approverType: approver.approverType,
                roleId: approver.approverId,
                workspaceId: job.workspaceId,
              },
              update: {},
            });
          } else {
            await tx.stageApprovers.upsert({
              where: {
                stageId_userId_approverType: {
                  stageId: stage.id,
                  userId: approver.approverId,
                  approverType: approver.approverType,
                },
              },
              create: {
                id: randomUUID(),
                stageId: stage.id,
                approverType: approver.approverType,
                userId: approver.approverId,
                workspaceId: job.workspaceId,
              },
              update: {},
            });
          }
        }
      }

      for (const transition of job.newTransitions) {
        await tx.stageTransition.upsert({
          where: { id: transition.id },
          create: {
            id: transition.id,
            workspaceId: job.workspaceId,
            boardId: job.targetBoardId,
            fromStageId: transition.fromStageId,
            toStageId: transition.toStageId,
            formId: transition.formId,
            requiresApproval: transition.requiresApproval,
            bypassApprovalForAutomation: transition.bypassApprovalForAutomation,
            requestApprovalOnEntry: transition.requestApprovalOnEntry,
            visitSlaMode: transition.visitSlaMode,
            fixedEtaHours: transition.fixedEtaHours,
            onReenter: transition.onReenter,
            createdAt: new Date(),
          },
          update: {
            requiresApproval: transition.requiresApproval,
            bypassApprovalForAutomation: transition.bypassApprovalForAutomation,
            requestApprovalOnEntry: transition.requestApprovalOnEntry,
            visitSlaMode: transition.visitSlaMode,
            fixedEtaHours: transition.fixedEtaHours,
            onReenter: transition.onReenter,
          },
        });

        for (const approver of transition.approvers) {
          if (approver.approverType === 'ROLE') {
            await tx.stageApprovers.upsert({
              where: {
                transitionId_roleId_approverType: {
                  transitionId: transition.id,
                  roleId: approver.approverId,
                  approverType: approver.approverType,
                },
              },
              create: {
                id: randomUUID(),
                transitionId: transition.id,
                approverType: approver.approverType,
                roleId: approver.approverId,
                workspaceId: job.workspaceId,
              },
              update: {},
            });
          } else {
            await tx.stageApprovers.upsert({
              where: {
                transitionId_userId_approverType: {
                  transitionId: transition.id,
                  userId: approver.approverId,
                  approverType: approver.approverType,
                },
              },
              create: {
                id: randomUUID(),
                transitionId: transition.id,
                approverType: approver.approverType,
                userId: approver.approverId,
                workspaceId: job.workspaceId,
              },
              update: {},
            });
          }
        }
      }
    });
  }

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

  async countTicketsOnOldStages(targetBoardId: string, oldStageNames: string[]): Promise<number> {
    if (oldStageNames.length === 0) return 0;
    return db.ticket.count({ where: { boardId: targetBoardId, stageName: { in: oldStageNames } } });
  }

  /**
   * Flips the target board's type and — only if no ticket still sits on an old stage —
   * deletes the old stages. The "is it safe?" count runs inside the very transaction that
   * does the deleting, so a ticket that lands on an old stage concurrently either commits
   * before the count (we see it and back off) or after the delete (the worker's follow-up
   * sweep catches it). Returns `deleted: false` instead of throwing: leaving an old stage
   * behind is harmless clutter, whereas deleting one out from under a ticket is corruption.
   */
  async deleteOldStagesPhase(
    targetBoardId: string,
    oldStageIds: string[],
    oldStageNames: string[],
    newBoardType: string,
    actorUserId: string,
  ): Promise<{ deleted: boolean; remaining: number }> {
    if (oldStageIds.length === 0) {
      await db.board.update({ where: { id: targetBoardId }, data: { boardType: newBoardType, updatedBy: actorUserId, updatedAt: new Date() } });
      return { deleted: true, remaining: 0 };
    }

    return db.$transaction(async tx => {
      const remaining =
        oldStageNames.length > 0
          ? await tx.ticket.count({ where: { boardId: targetBoardId, stageName: { in: oldStageNames } } })
          : 0;

      // The board type flips either way — the copied stage set is already live on this
      // board, so the board must describe itself correctly even if the old stages survive.
      await tx.board.update({
        where: { id: targetBoardId },
        data: { boardType: newBoardType, updatedBy: actorUserId, updatedAt: new Date() },
      });

      if (remaining > 0) {
        logger.warn(
          `${TAG} Skipping old-stage delete on board ${targetBoardId} — ${remaining} ticket(s) still on an old stage`,
        );
        return { deleted: false, remaining };
      }

      await tx.stageApprovers.deleteMany({ where: { stageId: { in: oldStageIds } } });
      await tx.stagePRStatusMapping.deleteMany({ where: { stageId: { in: oldStageIds } } });
      await tx.formContextMapping.deleteMany({ where: { contextId: { in: oldStageIds }, contextType: FormContextType.STAGE } });

      // Scoped to transitions that reference an OLD stage id — phase 1 (insertNewStagesPhase)
      // already inserted the copied transitions under the same boardId, referencing only NEW
      // stage ids, so an unfiltered `where: { boardId }` here would delete those too.
      const oldTransitions = await tx.stageTransition.findMany({
        where: {
          boardId: targetBoardId,
          OR: [{ fromStageId: { in: oldStageIds } }, { toStageId: { in: oldStageIds } }],
        },
        select: { id: true },
      });
      const oldTransitionIds = oldTransitions.map(t => t.id);
      if (oldTransitionIds.length > 0) {
        await tx.stageApprovers.deleteMany({ where: { transitionId: { in: oldTransitionIds } } });
        await tx.stageTransition.deleteMany({ where: { id: { in: oldTransitionIds } } });
      }

      await tx.stage.deleteMany({ where: { id: { in: oldStageIds } } });

      logger.info(
        `${TAG} Deleted ${oldStageIds.length} old stages on board ${targetBoardId}, boardType now ${newBoardType}`,
      );
      return { deleted: true, remaining: 0 };
    });
  }
}

export const boardConfigCopyService = new BoardConfigCopyService();
