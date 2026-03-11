import { BaseRepository } from './base';
import { Project } from '@prisma/client';
import { QueryOptions, PaginationOptions, PaginatedResult } from '@/types/database';
import { sanitizeProjectCode } from '@xyne/shared';
//import { queueProjectIngestion } from '@/queues/vespaQueue';

export interface CreateProjectInput {
  name: string;
  description?: string;
  createdBy: string;
  code: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  updatedBy?: string;
  code?: string;
}

export interface StageObject {
  name: string;
  eta: number; // in hours
}

export class ProjectRepository extends BaseRepository<Project, CreateProjectInput, UpdateProjectInput> {
  constructor() {
    super('project');
  }

  async create(data: CreateProjectInput): Promise<Project> {
    await this.validateString(data.name, 'name', 255);
    await this.validateString(data.createdBy, 'createdBy');

    if (data.description) {
      await this.validateString(data.description, 'description', 1000);
    }

    // Check for duplicate name
    await this.validateNameUnique(data.name);

    // Validate project code
    await this.validateProjectCode(data.code);

    // Use transaction to create project and default board together
    const result =  await this.db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: data.name,
          description: data.description,
          createdBy: data.createdBy,
          code: data.code,
        }
      });

      // Automatically create a default board for the project
      const board = await tx.board.create({
        data: {
          name: data.name,
          projectId: project.id,
          createdBy: data.createdBy,
        }
      });

      // Create default stages for the board
      await tx.stage.createMany({
        data: [
          {
            name: 'To Do',
            sequenceNumber: 1,
            boardId: board.id,
            createdBy: data.createdBy,
          },
          {
            name: 'In Progress',
            sequenceNumber: 2,
            boardId: board.id,
            createdBy: data.createdBy,
          },
          {
            name: 'Review',
            sequenceNumber: 3,
            boardId: board.id,
            createdBy: data.createdBy,
          },
          {
            name: 'Completed',
            sequenceNumber: 4,
            boardId: board.id,
            createdBy: data.createdBy,
          },
        ]
      });

      return project;
    });

    // Queue project for Vespa ingestion with complete data
    // try {
    //   // Fetch user names for createdBy
    //   const createdByUser = await this.db.user.findUnique({
    //     where: { id: result.createdBy },
    //     select: { name: true }
    //   });

    //   // Get all stages for this project (through boards)
    //   const boards = await this.db.board.findMany({
    //     where: {
    //       projectId: result.id
    //     }
    //   });

    //   const boardIds = boards.map(b => b.id);

    //   const stages = await this.db.stage.findMany({
    //     where: {
    //       boardId: {
    //         in: boardIds
    //       }
    //     },
    //     orderBy: {
    //       sequenceNumber: 'asc'
    //     }
    //   });

    //   const projectWithStages = {
    //     ...result,
    //     createdBy: createdByUser?.name, // Send name instead of ID
    //     stages: stages.map(s => s.name), // Send only stage names as array
    //     updatedAt: new Date(result.createdAt || Date.now()),
    //     createdAt: new Date(result.createdAt || Date.now()),
    //   };

    //   await queueProjectIngestion(projectWithStages, 'feed');
    // } catch (error) {
    //   console.error(`[VESPA-FLOW] Failed to queue project for Vespa: ${result.id}`, error);
    //   // Don't throw - project is still created in DB
    // }

    return result;
  }

  async findById(id: string): Promise<Project | null> {
    return await this.db.project.findUnique({
      where: { id }
    });
  }

  async findByName(name: string): Promise<Project | null> {
    return await this.db.project.findUnique({
      where: { name }
    });
  }

  async findMany(options?: QueryOptions): Promise<Project[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.project.findMany({
      skip,
      take,
      orderBy: orderBy || { createdAt: 'desc' },
      where,
    });
  }

  async findManyPaginated(options: PaginationOptions & { where?: any }): Promise<PaginatedResult<Project>> {
    const { page, pageSize, where } = options;
    const paginationQuery = this.buildPaginationQuery({ page, pageSize });

    return this.paginate(
      () => this.db.project.findMany({
        ...paginationQuery,
        where,
        orderBy: { createdAt: 'desc' },
      }),
      () => this.db.project.count({ where }),
      { page, pageSize }
    );
  }

  async update(id: string, data: UpdateProjectInput): Promise<Project> {
    if (data.name) {
      await this.validateString(data.name, 'name', 255);
      await this.validateNameUnique(data.name, id);
    }

    if (data.description) {
      await this.validateString(data.description, 'description', 1000);
    }

    if (data.updatedBy) {
      await this.validateString(data.updatedBy, 'updatedBy');
    }

    const result = await this.db.project.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      }
    });

    // Queue project update for Vespa with complete data
    // try {
    //   // Fetch user names for createdBy and updatedBy
    //   const [createdByUser, updatedByUser] = await Promise.all([
    //     this.db.user.findUnique({ where: { id: result.createdBy }, select: { name: true } }),
    //     result.updatedBy ? this.db.user.findUnique({ where: { id: result.updatedBy }, select: { name: true } }) : Promise.resolve(null)
    //   ]);

    //   // Get all stages for this project
    //   const boards = await this.db.board.findMany({
    //     where: {
    //       projectId: result.id
    //     }
    //   });

    //   const boardIds = boards.map(b => b.id);

    //   const stages = await this.db.stage.findMany({
    //     where: {
    //       boardId: {
    //         in: boardIds
    //       }
    //     },
    //     orderBy: {
    //       sequenceNumber: 'asc'
    //     }
    //   });

    //   const projectWithStages = {
    //     ...result,
    //     createdBy: createdByUser?.name, // Send name instead of ID
    //     updatedBy: updatedByUser?.name, // Send name instead of ID
    //     stages: stages.map(s => s.name), // Send only stage names as array
    //     updatedAt: new Date(result.updatedAt || Date.now()),
    //     createdAt: new Date(result.createdAt || Date.now()),
    //   };

    //   await queueProjectIngestion(projectWithStages, 'update');
    // } catch (error) {
    //   console.error(`[VESPA-FLOW] Failed to queue project update for Vespa: ${result.id}`, error);
    //   // Don't throw - project is still updated in DB
    // }

    return result;
  }

  async delete(id: string): Promise<Project> {
    const result = await this.db.project.delete({
      where: { id }
    });

    // Queue project deletion from Vespa - only need ID
    // try {
    //   await queueProjectIngestion({ id: result.id }, 'delete');
    // } catch (error) {
    //   console.error(`[VESPA-FLOW] Failed to queue project deletion for Vespa: ${result.id}`, error);
    //   // Don't throw - project is still deleted in DB
    // }

    return result;
  }

  async validateNameUnique(name: string, excludeId?: string): Promise<void> {
    const existing = await this.db.project.findUnique({
      where: { name },
    });

    if (existing && existing.id !== excludeId) {
      throw new Error(`Project with name '${name}' already exists`);
    }
  }

  async checkDuplicateName(name: string, excludeId?: string): Promise<boolean> {
    const existing = await this.db.project.findUnique({
      where: { name },
    });
    return !!(existing && existing.id !== excludeId);
  }

  async findBySearch(searchTerm: string, options?: PaginationOptions): Promise<PaginatedResult<Project> | Project[]> {
    const searchFilter = this.createSearchFilter(searchTerm, ['name', 'description']);

    if (options) {
      return this.findManyPaginated({
        ...options,
        where: searchFilter,
      });
    }

    return this.findMany({ where: searchFilter });
  }

  /**
   * Validate project code format and uniqueness
   * Format: 3+ uppercase alphanumeric characters (e.g., "EUL", "INT", "PROJ", "PRO1", "XY2")
   */
  async validateProjectCode(code: string, excludeId?: string): Promise<void> {
    // Sanitize using shared utility
    const sanitizedCode = sanitizeProjectCode(code);

    // Validate format: at least 3 uppercase alphanumeric characters
    if (sanitizedCode.length < 3) {
      throw new Error(`Project code must be at least 3 uppercase alphanumeric characters (e.g., EUL, PRO1, XY2)`);
    }

    // Check uniqueness
    const existing = await this.db.project.findFirst({
      where: { code: sanitizedCode },
    });

    if (existing && existing.id !== excludeId) {
      throw new Error(`Project code '${sanitizedCode}' is already in use by '${existing.name}'`);
    }
  }

  /**
   * Check if project code exists and return existing project info if it does
   * Returns null if code is available
   */
  async checkDuplicateCodeWithInfo(code: string, excludeId?: string): Promise<{ exists: boolean; existingProject?: { name: string } }> {
    const sanitizedCode = sanitizeProjectCode(code);
    const existing = await this.db.project.findFirst({
      where: { code: sanitizedCode },
    });

    if (existing && existing.id !== excludeId) {
      return {
        exists: true,
        existingProject: { name: existing.name }
      };
    }
    return { exists: false };
  }

  /**
   * Check if project code exists (legacy method for backward compatibility)
   */
  async checkDuplicateCode(code: string, excludeId?: string): Promise<boolean> {
    const result = await this.checkDuplicateCodeWithInfo(code, excludeId);
    return result.exists;
  }
}
