import { BaseRepository } from './base';
import {
  Resource,
  CreateResourceInput,
  UpdateResourceInput,
  QueryOptions,
  ResourceWithAccess,
  PaginationOptions,
  PaginatedResult,
} from '@/types/database';
import { aclAuditService } from '@/services/aclAuditService';

export class ResourceRepository extends BaseRepository<Resource, CreateResourceInput, UpdateResourceInput> {
  constructor() {
    super('resource');
  }

  async create(data: CreateResourceInput, actorUserId?: string): Promise<Resource> {
    await this.validateString(data.name, 'name', 255);

    const resource = await this.db.resource.create({
      data,
    });

    // Log audit event
    await aclAuditService.logResourceCreated(resource.id, resource.name, actorUserId);

    return resource;
  }

  async findById(id: string): Promise<Resource | null> {
    return await this.db.resource.findUnique({
      where: { id },
    });
  }

  async findByName(name: string): Promise<Resource | null> {
    return await this.db.resource.findUnique({
      where: { name },
    });
  }

  async findMany(options?: QueryOptions): Promise<Resource[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.resource.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async findManyPaginated(options: PaginationOptions & { where?: any }): Promise<PaginatedResult<Resource>> {
    const { page, pageSize, where } = options;
    const paginationQuery = this.buildPaginationQuery({ page, pageSize });

    return this.paginate(
      () => this.db.resource.findMany({
        ...paginationQuery,
        where,
        orderBy: { name: 'asc' },
      }),
      () => this.db.resource.count({ where }),
      { page, pageSize }
    );
  }

  async update(id: string, data: UpdateResourceInput, actorUserId?: string): Promise<Resource> {
    if (data.name) {
      await this.validateString(data.name, 'name', 255);
    }

    const resource = await this.db.resource.update({
      where: { id },
      data,
    });

    // Log audit event
    await aclAuditService.logResourceUpdated(resource.id, resource.name, actorUserId);

    return resource;
  }

  async delete(id: string, actorUserId?: string): Promise<Resource> {
    // Get resource name before deletion for audit log
    const resource = await this.findById(id);

    const deletedResource = await this.db.resource.delete({
      where: { id },
    });

    // Log audit event
    if (resource) {
      await aclAuditService.logResourceDeleted(resource.id, resource.name, actorUserId);
    }

    return deletedResource;
  }

  async findWithAccess(id: string): Promise<ResourceWithAccess | null> {
    return await this.db.resource.findUnique({
      where: { id },
      include: {
        resourceAccess: true,
      },
    });
  }

  async findBySearch(searchTerm: string, options?: PaginationOptions): Promise<PaginatedResult<Resource> | Resource[]> {
    const searchFilter = this.createSearchFilter(searchTerm, ['name', 'description']);

    if (options) {
      return this.findManyPaginated({
        ...options,
        where: searchFilter,
      });
    }

    return this.findMany({ where: searchFilter });
  }

  async validateNameUnique(name: string, excludeId?: string): Promise<void> {
    const existing = await this.db.resource.findUnique({
      where: { name },
    });

    if (existing && existing.id !== excludeId) {
      throw new Error(`Resource with name '${name}' already exists`);
    }
  }

  async getAccessCount(resourceId: string): Promise<number> {
    return await this.db.resourceAccess.count({
      where: { resourceId },
    });
  }

  async findResourcesWithAccess(): Promise<ResourceWithAccess[]> {
    return await this.db.resource.findMany({
      include: {
        resourceAccess: true,
      },
      orderBy: { name: 'asc' },
    });
  }
}