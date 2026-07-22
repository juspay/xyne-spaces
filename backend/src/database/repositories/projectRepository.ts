import { BaseRepository } from './base';
import { Project, ProjectType, TicketStatusV2 } from '@prisma/client';
import { QueryOptions, PaginationOptions, PaginatedResult } from '@/types/database';
import { sanitizeProjectCode } from '@xyne/shared';
import { EntitySequenceService } from '@/services/entitySequenceService';
//import { queueProjectIngestion } from '@/queues/vespaQueue';

export interface CreateProjectInput {
  name: string;
  description?: string;
  createdBy: string;
  code: string;
  workspaceId: string;
  type?: ProjectType;
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
    await this.validateNameUnique(data.name, undefined, data.workspaceId);

    // Validate project code
    await this.validateProjectCode(data.code, undefined, data.workspaceId);

    // Use transaction to create project and default board together
    const result =  await this.db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: data.name,
          description: data.description,
          createdBy: data.createdBy,
          code: data.code,
          type: ProjectType.DEFAULT,
          workspace: { connect: { id: data.workspaceId } },
        }
      });

      // Automatically create a default board for the project
      const board = await tx.board.create({
        data: {
          name: data.name,
          projectId: project.id,
          workspaceId: data.workspaceId,
          createdBy: data.createdBy,
        }
      });

      // Create default stages for the board with proper status mappings.
      // Allocate from the shared counter so deleting a stage never makes its
      // sequence number available again.
      let currentMaxStageSequence = 0;
      const defaultStages = [];
      for (const stage of [
        { name: 'To Do', defaultTicketStatusV2: TicketStatusV2.TODO },
        { name: 'In Progress', defaultTicketStatusV2: TicketStatusV2.STARTED },
        { name: 'Review', defaultTicketStatusV2: TicketStatusV2.STARTED },
        { name: 'Completed', defaultTicketStatusV2: TicketStatusV2.COMPLETED },
      ]) {
        const sequenceNumber = await EntitySequenceService.getNextBoardStageSequence(
          board.id,
          currentMaxStageSequence,
        );
        currentMaxStageSequence = Math.max(currentMaxStageSequence, sequenceNumber);
        defaultStages.push({
          ...stage,
          sequenceNumber,
          boardId: board.id,
          createdBy: data.createdBy,
        });
      }

      await tx.stage.createMany({
        data: defaultStages,
      });

      return project;
    });


    return result;
  }

  async findById(id: string): Promise<Project | null> {
    return await this.db.project.findUnique({
      where: { id }
    });
  }

  async findByName(name: string, workspaceId: string): Promise<Project | null> {
    return await this.db.project.findFirst({ where: { name, workspaceId } });
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

  async update(id: string, data: UpdateProjectInput, workspaceId?: string): Promise<Project> {
    if (data.name && workspaceId) {
      await this.validateString(data.name, 'name', 255);
      await this.validateNameUnique(data.name, id, workspaceId);
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

  async validateNameUnique(name: string, excludeId: string | undefined, workspaceId: string): Promise<void> {
    const existing = await this.db.project.findFirst({
      where: { name, workspaceId }
    });

    if (existing && existing.id !== excludeId) {
      throw new Error(`Project with name '${name}' already exists in this workspace`);
    }
  }

  async checkDuplicateName(name: string, excludeId: string | undefined, workspaceId: string): Promise<boolean> {
    const existing = await this.db.project.findFirst({
      where: { name, workspaceId }
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
   * Format: 2+ uppercase alphanumeric characters (e.g., "EU", "PR", "X2", "PROJ", "PRO1", "XY2")
   */
  async validateProjectCode(code: string, excludeId: string | undefined, workspaceId: string): Promise<void> {
    // Sanitize using shared utility
    const sanitizedCode = sanitizeProjectCode(code);

    // Validate format: at least 2 uppercase alphanumeric characters
    if (sanitizedCode.length < 2) {
      throw new Error(`Project code must be at least 2 uppercase alphanumeric characters (e.g., EU, PR, X2)`);
    }

    // Check uniqueness
    const existing = await this.db.project.findFirst({
      where: { code: sanitizedCode, workspaceId }
    });

    if (existing && existing.id !== excludeId) {
      throw new Error(`Project code '${sanitizedCode}' is already in use by '${existing.name}'`);
    }
  }

  /**
   * Check if project code exists and return existing project info if it does
   * Returns null if code is available
   */
  async checkDuplicateCodeWithInfo(code: string, excludeId: string | undefined, workspaceId: string): Promise<{ exists: boolean; existingProject?: { name: string } }> {
    const sanitizedCode = sanitizeProjectCode(code);
    const existing = await this.db.project.findFirst({
      where: { code: sanitizedCode, workspaceId }
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
  async checkDuplicateCode(code: string, excludeId: string | undefined, workspaceId: string): Promise<boolean> {
    const result = await this.checkDuplicateCodeWithInfo(code, excludeId, workspaceId);
    return result.exists;
  }

  /**
   * Get the DM project ID for a workspace
   */
  async getDMProjectId(workspaceId: string): Promise<string | null> {
    const project = await this.db.project.findFirst({
      where: {
        workspaceId,
        code: 'DM',
        type: ProjectType.DM,
      },
    });
    return project?.id ?? null;
  }
}
