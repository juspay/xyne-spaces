import { BaseRepository } from './base';
import {
  Workspace,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  QueryOptions,
} from '@/types/database';
import { WorkspaceJoinPolicy, WorkspaceType } from '@xyne/shared';

export class WorkspaceRepository extends BaseRepository<Workspace, CreateWorkspaceInput, UpdateWorkspaceInput> {
  constructor() {
    super('workspace');
  }

  async create(data: CreateWorkspaceInput): Promise<Workspace> {
    return await this.db.workspace.create({
      data: {
        ...data,
        workspaceType: (data as any).workspaceType ?? WorkspaceType.ENTERPRISE,
        joinPolicy: (data as any).joinPolicy ?? WorkspaceJoinPolicy.INVITE_ONLY,
      },
    });
  }

  async findById(id: string): Promise<Workspace | null> {
    return await this.db.workspace.findUnique({
      where: { id },
    });
  }

  async findFirst(options?: QueryOptions): Promise<Workspace | null> {
    const { where } = options || {};
    return await this.db.workspace.findFirst({
      where,
    });
  }

  async findMany(options?: QueryOptions): Promise<Workspace[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.workspace.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async update(id: string, data: UpdateWorkspaceInput): Promise<Workspace> {
    return await this.db.workspace.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<Workspace> {
    return await this.db.workspace.delete({
      where: { id },
    });
  }
}
