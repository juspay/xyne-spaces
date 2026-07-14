import { BaseRepository } from './base';
import {
  Model,
  CreateModelInput,
  UpdateModelInput,
  QueryOptions,
} from '@/types/database';

export class ModelRepository extends BaseRepository<Model, CreateModelInput, UpdateModelInput> {
  constructor() {
    super('model');
  }

  async create(data: CreateModelInput): Promise<Model> {
    return await this.db.model.create({
      data,
    });
  }

  async findById(id: string): Promise<Model | null> {
    return await this.db.model.findUnique({
      where: { id },
    });
  }

  async findByIdAndWorkspaceId(id: string, workspaceId: string): Promise<Model | null> {
    return await this.db.model.findUnique({
      where: { id, workspaceId },
    });
  }

  async findByUserDefinedId(userDefinedId: string): Promise<Model | null> {
    return await this.db.model.findUnique({
      where: { userDefinedId },
    });
  }

  async findByUserDefinedIdAndWorkspaceId(
    userDefinedId: string,
    workspaceId: string,
  ): Promise<Model | null> {
    return await this.db.model.findUnique({
      where: { userDefinedId, workspaceId },
    });
  }

  async findMany(options?: QueryOptions): Promise<Model[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.model.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async update(id: string, data: UpdateModelInput): Promise<Model> {
    return await this.db.model.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<Model> {
    return await this.db.model.delete({
      where: { id },
    });
  }

  async findByProvider(provider: string, workspaceId?: string): Promise<Model[]> {
    return await this.db.model.findMany({
      where: {
        provider,
        ...(workspaceId ? { workspaceId } : {}),
      },
    });
  }

  async findByName(name: string, workspaceId: string): Promise<Model[]> {
    return await this.db.model.findMany({
      where: { name, workspaceId },
    });
  }

  async findWithAgents(id: string) {
    return await this.db.model.findUnique({
      where: { id },
      include: {
        agents: true,
      },
    });
  }

  async findBySearch(searchTerm: string, workspaceId?: string): Promise<Model[]> {
    const searchFilter = this.createSearchFilter(searchTerm, ['name', 'provider', 'userDefinedId']);
    return this.findMany({
      where: {
        ...searchFilter,
        ...(workspaceId ? { workspaceId } : {}),
      },
    });
  }
  
  async upsert(userDefinedId: string, data: CreateModelInput): Promise<Model> {
    return await this.db.model.upsert({
      where: { userDefinedId },
      create: data,
      update: {
        name: data.name,
        provider: data.provider,
        updatedAt: new Date(),
      },
    });
  }
}
