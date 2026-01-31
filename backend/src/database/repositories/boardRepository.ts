import { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { Board, Stage } from '@prisma/client';

export interface CreateStageInput {
  name: string;
  eta: number;
  sequenceNumber: number;
}

export interface CreateBoardInput {
  name: string;
  projectId: string;
  createdBy: string;
}

export interface CreateBoardWithStagesInput extends CreateBoardInput {
  stages?: Omit<CreateStageInput, 'boardId' | 'createdBy'>[];
}

export type BoardWithStages = Board & {
  stages?: Stage[];
};

export class BoardRepository {
  protected db: PrismaClient;

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

    await this.validateNameUnique(data.name);

    // Use transaction to create board and stages together
    return await this.db.$transaction(async (tx) => {
      const board = await tx.board.create({
        data: {
          name: data.name,
          projectId: data.projectId,
          createdBy: data.createdBy,
        },
      });

      let stages: Stage[] = [];
      if (data.stages && data.stages.length > 0) {
        await tx.stage.createMany({
          data: data.stages.map(stage => ({
            ...stage,
            boardId: board.id,
            createdBy: data.createdBy,
          })),
        });

        stages = await tx.stage.findMany({
          where: { boardId: board.id },
          orderBy: { sequenceNumber: 'asc' },
        });
      }

      return {
        ...board,
        stages,
      };
    });
  }

  async validateNameUnique(name: string, excludeId?: string): Promise<void> {
    const existing = await this.db.board.findUnique({
      where: { name },
    });

    if (existing && existing.id !== excludeId) {
      throw new Error(`Board with name '${name}' already exists`);
    }
  }

  async checkDuplicateName(name: string, excludeId?: string): Promise<boolean> {
    const existing = await this.db.board.findUnique({
      where: { name },
    });
    return !!(existing && existing.id !== excludeId);
  }

  async findBoardById(id: string): Promise<{ name: string } | null> {
    return await this.db.board.findUnique({
      where: { id },
      select: { name: true },
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
