import { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { Board, Stage } from '@prisma/client';
import {
  BoardType,
  PRStatusEvent,
  TicketStatusV2,
  type FlowPlan,
} from '@xyne/shared';
import { createWithStagesTx } from '@/bypassAcl/transactions/boardRepository';


export interface CreateStageInput {
  name: string;
  eta?: number;
  sequenceNumber: number;
  defaultTicketStatusV2?: TicketStatusV2;
  prStatuses?: PRStatusEvent[];
}

export interface CreateBoardInput {
  name: string;
  description?: string;
  projectId: string;
  createdBy: string;
  workspaceId: string;
  boardType?: BoardType;
  metadata?: Record<string, unknown>;
  flowPlan?: FlowPlan;
}

export interface CreateBoardWithStagesInput extends CreateBoardInput {
  stages?: Omit<CreateStageInput, 'boardId' | 'createdBy'>[];
}

export type StageWithPRStatuses = Stage & {
  prStatuses?: PRStatusEvent[];
};

export type BoardWithStages = Board & {
  stages?: StageWithPRStatuses[];
};

export class BoardRepository {
  db: PrismaClient;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  async validateRequired(value: any, fieldName: string): Promise<void> {
    if (value === undefined || value === null || value === '') {
      throw new Error(`${fieldName} is required`);
    }
  }

  async validateString(value: any, fieldName: string, maxLength?: number): Promise<void> {
    await this.validateRequired(value, fieldName);

    if (typeof value !== 'string') {
      throw new Error(`${fieldName} must be a string`);
    }

    if (maxLength && value.length > maxLength) {
      throw new Error(`${fieldName} must be less than ${maxLength} characters`);
    }
  }

  async createWithStages(data: CreateBoardWithStagesInput): Promise<BoardWithStages> {
    await this.validateString(data.name, 'name', 255);
    await this.validateString(data.projectId, 'projectId');
    await this.validateString(data.createdBy, 'createdBy');
    await this.validateString(data.workspaceId, 'workspaceId');

    await this.validateNameUnique(data.name, data.projectId);

    // Validate PR status uniqueness across stages
    if (data.stages && data.stages.length > 0) {
      await this.validatePRStatusUniqueness(data.stages);
    }

    // Use transaction to create board and stages together
    return await createWithStagesTx(this, data);
  }

  /**
   * Sync PR status mappings for a stage - differential update (only add/remove changed mappings)
   * Uses transaction for atomicity
   */
  async syncStagePRStatusMappings(
    tx: any,
    stageId: string,
    prStatuses: PRStatusEvent[],
    workspaceId: string
  ): Promise<void> {
    // Fetch existing mappings
    const existingMappings = await tx.stagePRStatusMapping.findMany({
      where: { stageId },
    });

    // Create sets for comparison
    const existingPRStatuses = new Set(existingMappings.map((m: any) => m.prStatus));
    const newPRStatuses = new Set(prStatuses);

    // Find mappings to delete (exist in DB but not in new array)
    const mappingIdsToDelete = existingMappings
      .filter((mapping: any) => !newPRStatuses.has(mapping.prStatus))
      .map((mapping: any) => mapping.id);

    // Find PR statuses to add (exist in new array but not in DB)
    const prStatusesToAdd = prStatuses.filter(
      prStatus => !existingPRStatuses.has(prStatus)
    );

    // Delete only removed mappings
    if (mappingIdsToDelete.length > 0) {
      await tx.stagePRStatusMapping.deleteMany({
        where: {
          id: { in: mappingIdsToDelete },
        },
      });
    }

    // Insert only new mappings
    if (prStatusesToAdd.length > 0) {
      await tx.stagePRStatusMapping.createMany({
        data: prStatusesToAdd.map(prStatus => ({
          stageId,
          prStatus,
          workspaceId,
        })),
      });
    }
  }

  /**
   * Validate that each PR status is only used in one stage
   */
  async validatePRStatusUniqueness(stages: Array<{ name: string; prStatuses?: PRStatusEvent[] }>): Promise<void> {
    const prStatusUsage = new Map<PRStatusEvent, string>();

    for (const stage of stages) {
      if (stage.prStatuses) {
        for (const status of stage.prStatuses) {
          if (prStatusUsage.has(status)) {
            throw new Error(
              `PR status '${status}' is used in multiple stages: '${prStatusUsage.get(status)}' and '${stage.name}'`
            );
          }
          prStatusUsage.set(status, stage.name);
        }
      }
    }
  }

  async validateNameUnique(name: string, projectId: string, excludeId?: string): Promise<void> {
    const existing = await this.db.board.findFirst({
      where: {
        name,
        projectId,
      },
    });

    if (existing && existing.id !== excludeId) {
      throw new Error(`Board with name '${name}' already exists in this project`);
    }
  }

  async checkDuplicateName(name: string, projectId: string, excludeId?: string): Promise<boolean> {
    const existing = await this.db.board.findFirst({
      where: {
        name,
        projectId,
      },
    });
    return !!(existing && existing.id !== excludeId);
  }

  async findBoardById(id: string): Promise<{ name: string; boardType: BoardType; projectId: string } | null> {
    const board = await this.db.board.findUnique({
      where: { id },
      select: { name: true, boardType: true, projectId: true },
    });
    return board ? { ...board, boardType: board.boardType as BoardType } : null;
  }

  async findDefaultBoardIdForProject(projectId: string): Promise<string> {
    const board = await this.db.board.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!board) {
      throw new Error('No boards found for project');
    }

    return board.id;
  }

  /**
   * Find board by ID with full details including projectId
   * Used for validating board belongs to correct project
   */
  async findById(id: string): Promise<Board | null> {
    return await this.db.board.findUnique({
      where: { id },
    });
  }

  async findBoardsByProject(projectId: string): Promise<Board[]> {
    return await this.db.board.findMany({
      where: { projectId },
    });
  }

  async findOldestBoardByProject(projectId: string): Promise<Board | null> {
    return await this.db.board.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }
}

