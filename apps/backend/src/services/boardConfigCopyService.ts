import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { BoardType, FormContextType, FormEntityType, ApproverType } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
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
   * new stage). This is enforced here — not just in the frontend picker — so a
   * malformed/bypassed request can't violate it.
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
      if (!overrideStage || overrideStage.defaultTicketStatusV2 !== old.defaultTicketStatusV2) {
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

  private async copyCustomFieldsAndRoles(
    sourceBoard: { id: string; projectId: string; workspaceId: string },
    targetBoard: { id: string; metadata: Prisma.JsonValue },
    categories: CopyCategorySelection,
    actorUserId: string,
  ): Promise<{ customFieldsCopied: boolean; rolesCopied: boolean }> {
    const targetMetadata = { ...(targetBoard.metadata as Record<string, unknown> | null) };
    let customFieldsCopied = false;
    let rolesCopied = false;

    await db.$transaction(async tx => {
      if (categories.customFields) {
        const sourceMapping = await tx.formContextMapping.findFirst({
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
              fields: sourceForm.fields.map(f => ({
                fieldName: f.fieldName,
                fieldType: f.fieldType,
                ...(f.fieldOptions ? { fieldOptions: JSON.parse(f.fieldOptions) } : {}),
                isOptional: f.isOptional,
                ...(f.parentOptionId !== undefined ? { parentOptionId: f.parentOptionId } : {}),
              })),
            });

            // FormContextMapping has @@unique([contextId, entityType]) — a stale target
            // mapping must go before the new one can be inserted.
            await tx.formContextMapping.deleteMany({
              where: { contextId: targetBoard.id, contextType: FormContextType.BOARD, entityType: FormEntityType.TICKET },
            });
            await tx.formContextMapping.create({
              data: {
                id: randomUUID(),
                formId: newForm.id,
                contextId: targetBoard.id,
                contextType: FormContextType.BOARD,
                entityType: FormEntityType.TICKET,
                workspaceId: sourceBoard.workspaceId,
              },
            });
            targetMetadata['customFieldsFormId'] = newForm.id;
          }
        }

        const sourceBoardRow = await tx.board.findUnique({ where: { id: sourceBoard.id } });
        const sourceMetadata = (sourceBoardRow?.metadata as Record<string, unknown> | null) ?? {};
        targetMetadata['fieldOrder'] = sourceMetadata['fieldOrder'];
        targetMetadata['ticketFormConfig'] = sourceMetadata['ticketFormConfig'];
        targetMetadata['customFieldVisibility'] = sourceMetadata['customFieldVisibility'];
        customFieldsCopied = true;
      }

      if (categories.roles) {
        const sourceBoardRow = await tx.board.findUnique({ where: { id: sourceBoard.id } });
        const sourceMetadata = (sourceBoardRow?.metadata as Record<string, unknown> | null) ?? {};
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

    return { customFieldsCopied, rolesCopied };
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

    const { customFieldsCopied, rolesCopied } = await this.copyCustomFieldsAndRoles(
      sourceBoard,
      targetBoard,
      input.categories,
      actorUserId,
    );

    if (!input.categories.stages) {
      return {
        summary: {
          customFieldsCopied,
          rolesCopied,
          stages: { batches: 0, processed: 0, updated: 0, skipped: 0, errors: 0, failedTicketIds: [], newStageCount: 0, deletedOldStageCount: 0 },
          warnings: [],
        },
      };
    }

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
      oldStages: oldStages.map(o => ({ id: o.id, name: o.name })),
      ticketRemapByOldStageId,
      customFieldsCopied,
      rolesCopied,
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

      await tx.ticketStageEta.updateMany({
        where: { ticketId: ticket.id, stageId: oldStageId, stageLeftAt: null },
        data: { stageLeftAt: now, updatedAt: now, updatedBy: actorUserId },
      });

      const targetStageEta =
        target.newStageEta !== null && target.newStageEta > 0 ? calculateETADeadline(now, target.newStageEta) : now;

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

      const recomputedEta = recomputeOverallTicketEta(targetStageEta, now, target.futureStagesEtaHours);
      const statusChanged = ticket.statusV2 !== target.newStageStatusV2;

      const updatedTicket = await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          stageName: target.newStageName,
          statusV2: target.newStageStatusV2,
          ...(statusChanged ? { statusUpdatedAt: now } : {}),
          ...(recomputedEta ? { eta: recomputedEta } : {}),
          updatedBy: actorUserId,
          updatedAt: now,
        },
      });

      await syncConversationTicketMdFromPrismaTicket(tx, updatedTicket);

      return 'updated';
    });
  }

  async countTicketsOnOldStages(targetBoardId: string, oldStageNames: string[]): Promise<number> {
    if (oldStageNames.length === 0) return 0;
    return db.ticket.count({ where: { boardId: targetBoardId, stageName: { in: oldStageNames } } });
  }

  async deleteOldStagesPhase(targetBoardId: string, oldStageIds: string[], newBoardType: string, actorUserId: string): Promise<void> {
    if (oldStageIds.length === 0) {
      await db.board.update({ where: { id: targetBoardId }, data: { boardType: newBoardType, updatedBy: actorUserId, updatedAt: new Date() } });
      return;
    }

    await db.$transaction(async tx => {
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

      await tx.board.update({
        where: { id: targetBoardId },
        data: { boardType: newBoardType, updatedBy: actorUserId, updatedAt: new Date() },
      });
    });

    logger.info(`${TAG} Deleted ${oldStageIds.length} old stages on board ${targetBoardId}, boardType now ${newBoardType}`);
  }
}

export const boardConfigCopyService = new BoardConfigCopyService();
