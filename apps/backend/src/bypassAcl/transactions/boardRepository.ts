import { transaction } from '../base';
import { BoardRepository, CreateBoardWithStagesInput } from '@/database/repositories/boardRepository';
import { EntitySequenceService } from '@/services/entitySequenceService';
import { Prisma } from '@prisma/client';
import { Stage } from '@prisma/client';
import { BoardType, mergeBoardEtaManagement, defaultAutoRecomputeEnabled, serializeFlowPlan, PRStatusEvent, FLOW_STAGE_TRANSITIONS } from '@xyne/shared';


export function createWithStagesTx(self: BoardRepository, data: CreateBoardWithStagesInput) {
  return transaction(['Board', 'Stage', 'StagePRStatusMapping', 'StageTransition'], 'createWithStages: board, stages, PR status mappings and flow transitions must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    const resolvedBoardType = data.boardType || BoardType.DEFAULT;
    // Written explicitly (rather than left to the parse-time fallback) so a board's
    // automation state is never ambiguous - but the VALUE comes from the same
    // `defaultAutoRecomputeEnabled` a pre-existing board of this type falls back to at
    // read time, so a new board and a pre-existing untouched board of the same type can
    // never disagree.
    const metadataWithEtaDefaults = mergeBoardEtaManagement(data.metadata ?? null, resolvedBoardType, {
      autoRecomputeEnabled: defaultAutoRecomputeEnabled(resolvedBoardType),
      standardPathStageIds: [],
    });

    const board = await tx.board.create({
      data: {
        name: data.name,
        description: data.description,
        projectId: data.projectId,
        workspaceId: data.workspaceId,
        createdBy: data.createdBy,
        boardType: resolvedBoardType,
        metadata: metadataWithEtaDefaults as Prisma.InputJsonValue,
        ...(data.flowPlan !== undefined && { flowPlan: serializeFlowPlan(data.flowPlan) }),
      },
    });

    let stages: Array<Stage & { prStatuses?: PRStatusEvent[] }> = [];
    if (data.stages && data.stages.length > 0) {
      let currentMaxSequence = 0;
      const stagesToCreate = [];
      for (const stage of data.stages) {
        const sequenceNumber = await EntitySequenceService.getNextBoardStageSequence(
          board.id,
          currentMaxSequence,
        );
        currentMaxSequence = Math.max(currentMaxSequence, sequenceNumber);
        stagesToCreate.push({
          name: stage.name,
          eta: stage.eta ?? 0,
          sequenceNumber,
          boardId: board.id,
          workspaceId: data.workspaceId,
          createdBy: data.createdBy,
          ...(stage.defaultTicketStatusV2 && {
            defaultTicketStatusV2: stage.defaultTicketStatusV2,
          }),
        });
      }

      await tx.stage.createMany({
        data: stagesToCreate,
      });

      const rawStages = await tx.stage.findMany({
        where: { boardId: board.id },
        orderBy: { sequenceNumber: 'asc' },
      });

      // Fetch PR status mappings for each stage
      const stageIds = rawStages.map(s => s.id);
      const prStatusMappings = await tx.stagePRStatusMapping.findMany({
        where: { stageId: { in: stageIds } },
      });

      // Map stages with their PR statuses
      const prStatusMap = new Map<string, PRStatusEvent[]>();
      for (const mapping of prStatusMappings) {
        if (!prStatusMap.has(mapping.stageId)) {
          prStatusMap.set(mapping.stageId, []);
        }
        prStatusMap.get(mapping.stageId)!.push(mapping.prStatus as PRStatusEvent);
      }

      stages = rawStages.map(stage => ({
        ...stage,
        prStatuses: prStatusMap.get(stage.id) || [],
      }));

      if (board.boardType === BoardType.FLOW) {
        const stageByName = new Map(rawStages.map(stage => [stage.name, stage]));
        await tx.stageTransition.createMany({
          data: FLOW_STAGE_TRANSITIONS.map(([fromName, toName]) => ({
            workspaceId: data.workspaceId,
            boardId: board.id,
            fromStageId: stageByName.get(fromName)!.id,
            toStageId: stageByName.get(toName)!.id,
            requiresApproval: false,
            bypassApprovalForAutomation: true,
            createdAt: new Date(),
          })),
          skipDuplicates: true,
        });
      }

      // Sync PR status mappings for each stage (in case input had them)
      for (let i = 0; i < stages.length; i++) {
        const inputStage = data.stages[i];
        if (inputStage.prStatuses && inputStage.prStatuses.length > 0) {
          await self.syncStagePRStatusMappings(tx, stages[i].id, inputStage.prStatuses, data.workspaceId);
        }
      }
    }

    return {
      ...board,
      stages,
    };
  });
}
