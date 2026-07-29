import { BaseRepository } from './base';
import {
  ResourceAccess,
  CreateResourceAccessInput,
  UpdateResourceAccessInput,
  QueryOptions,
  ResourceAccessWithDetails,
  PaginationOptions,
  PaginatedResult,
} from '@/types/database';
import { AccessType } from '@prisma/client';
import { aclAuditService } from '@/services/aclAuditService';

export class ResourceAccessRepository extends BaseRepository<ResourceAccess, CreateResourceAccessInput, UpdateResourceAccessInput> {
  constructor() {
    super('resourceAccess');
  }

  async create(data: CreateResourceAccessInput): Promise<ResourceAccess> {
    return await this.db.resourceAccess.create({
      data,
    });
  }

  async findById(id: string): Promise<ResourceAccess | null> {
    return await this.db.resourceAccess.findUnique({
      where: { id },
    });
  }

  async findMany(options?: QueryOptions): Promise<ResourceAccess[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.resourceAccess.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async findManyPaginated(options: PaginationOptions & { where?: any }): Promise<PaginatedResult<ResourceAccess>> {
    const { page, pageSize, where } = options;
    const paginationQuery = this.buildPaginationQuery({ page, pageSize });

    return this.paginate(
      () => this.db.resourceAccess.findMany({
        ...paginationQuery,
        where,
        orderBy: { createdAt: 'desc' },
      }),
      () => this.db.resourceAccess.count({ where }),
      { page, pageSize }
    );
  }

  async update(id: string, data: UpdateResourceAccessInput): Promise<ResourceAccess> {
    if (data.accessType) {
      await this.validateEnum(data.accessType, 'accessType', Object.values(AccessType));
    }

    return await this.db.resourceAccess.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<ResourceAccess> {
    return await this.db.resourceAccess.delete({
      where: { id },
    });
  }

  async findWithDetails(id: string): Promise<ResourceAccessWithDetails | null> {
    return await this.db.resourceAccess.findUnique({
      where: { id },
      include: {
        userGroup: true,
        user: true,
        resource: true,
      },
    });
  }

  async findByResource(resourceId: string): Promise<ResourceAccessWithDetails[]> {
    return await this.db.resourceAccess.findMany({
      where: { resourceId },
      include: {
        userGroup: true,
        user: true,
        resource: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByUser(userId: string): Promise<ResourceAccessWithDetails[]> {
    return await this.db.resourceAccess.findMany({
      where: { userId },
      include: {
        userGroup: true,
        user: true,
        resource: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByGroup(groupId: string): Promise<ResourceAccessWithDetails[]> {
    return await this.db.resourceAccess.findMany({
      where: { groupId },
      include: {
        userGroup: true,
        user: true,
        resource: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByAccessType(accessType: AccessType): Promise<ResourceAccess[]> {
    return await this.db.resourceAccess.findMany({
      where: { accessType },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findUserResourceAccess(userId: string, resourceId: string): Promise<ResourceAccess[]> {
    // Find direct user access
    const directAccess = await this.db.resourceAccess.findMany({
      where: {
        userId,
        resourceId,
      },
    });

    // Find group-based access through userGroupMappings
    const userGroupMappings = await this.db.userGroupMapping.findMany({
      where: { userId },
      select: { userGroupId: true },
    });

    let groupAccess: ResourceAccess[] = [];
    if (userGroupMappings && userGroupMappings.length > 0) {
      // Get access for all groups the user belongs to
      const groupIds = userGroupMappings.map(m => m.userGroupId);
      groupAccess = await this.db.resourceAccess.findMany({
        where: {
          groupId: { in: groupIds },
          resourceId,
        },
      });
    }

    return [...directAccess, ...groupAccess];
  }

  async hasAccess(userId: string, resourceId: string, accessType: AccessType): Promise<boolean> {
    const accessRecords = await this.findUserResourceAccess(userId, resourceId);
    return accessRecords.some(record => {
      // ADMIN has access to everything
      if (record.accessType === AccessType.ADMIN) return true;

      // Exact match
      if (record.accessType === accessType) return true;

      // WRITE access includes READ permissions
      if (accessType === AccessType.READ && record.accessType === AccessType.WRITE) return true;

      return false;
    });
  }

  async findAllUserAccess(userId: string): Promise<ResourceAccessWithDetails[]> {
    // Get user's direct access
    const directAccess = await this.findByUser(userId);

    // Get user's group access through userGroupMappings
    const userGroupMappings = await this.db.userGroupMapping.findMany({
      where: { userId },
      select: { userGroupId: true },
    });

    let groupAccess: ResourceAccessWithDetails[] = [];
    if (userGroupMappings && userGroupMappings.length > 0) {
      // Get access for all groups the user belongs to in a single query
      const groupIds = userGroupMappings.map(m => m.userGroupId);
      groupAccess = await this.db.resourceAccess.findMany({
        where: { groupId: { in: groupIds } },
        include: {
          userGroup: true,
          user: true,
          resource: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // Combine and deduplicate by resource and access type
    const allAccess = [...directAccess, ...groupAccess];
    const uniqueAccess = allAccess.filter((access, index, self) =>
      index === self.findIndex(a =>
        a.resourceId === access.resourceId &&
        a.accessType === access.accessType
      )
    );

    return uniqueAccess;
  }

  async revokeUserAccess(userId: string, resourceId: string, actorUserId?: string): Promise<void> {
    // Get access records before deletion for audit
    const accessRecords = await this.db.resourceAccess.findMany({
      where: { userId, resourceId },
      include: { resource: true, user: true },
    });

    await this.db.resourceAccess.deleteMany({
      where: {
        userId,
        resourceId,
      },
    });

    // Log audit events for each revoked access
    for (const access of accessRecords) {
      const description = `Revoked ${access.accessType} access from user ${access.user?.email} for resource ${access.resource.name}`;
      await aclAuditService.logPermissionRevoked(access.id, description, actorUserId);
    }
  }

  async revokeGroupAccess(groupId: string, resourceId: string, actorUserId?: string): Promise<void> {
    // Get access records before deletion for audit
    const accessRecords = await this.db.resourceAccess.findMany({
      where: { groupId, resourceId },
      include: { resource: true, userGroup: true },
    });

    await this.db.resourceAccess.deleteMany({
      where: {
        groupId,
        resourceId,
      },
    });

    // Log audit events for each revoked access
    for (const access of accessRecords) {
      const description = `Revoked ${access.accessType} access from group ${access.userGroup?.name} for resource ${access.resource.name}`;
      await aclAuditService.logPermissionRevoked(access.id, description, actorUserId);
    }
  }

  async grantAccess(data: {
    userId?: string;
    groupId?: string;
    resourceId: string;
    accessType: AccessType;
    workspaceId?: string;
  }, actorUserId?: string): Promise<ResourceAccess> {
    await this.validateEnum(data.accessType, 'accessType', Object.values(AccessType));
    await this.validateRequired(data.resourceId, 'resourceId');

    // Validate that either groupId or userId is provided, but not both
    if (!data.groupId && !data.userId) {
      throw new Error('Either groupId or userId must be provided');
    }

    if (data.groupId && data.userId) {
      throw new Error('Cannot provide both groupId and userId');
    }

    const createData: any = {
      accessType: data.accessType,
      resource: {
        connect: { id: data.resourceId }
      }
    };

    // Explicit tenant key for background/webhook paths (mettle sync, CLI) that
    // have no request-scoped context for the workspaceId stamper to read.
    if (data.workspaceId) {
      createData.workspaceId = data.workspaceId;
    }

    if (data.userId) {
      createData.user = {
        connect: { id: data.userId }
      };
    }

    if (data.groupId) {
      createData.userGroup = {
        connect: { id: data.groupId }
      };
    }

    const resourceAccess = await this.db.resourceAccess.create({
      data: createData,
      include: { resource: true, user: true, userGroup: true },
    });

    // Log audit event
    const targetType = data.userId ? 'user' : 'group';
    const targetName = data.userId
      ? resourceAccess.user?.email
      : resourceAccess.userGroup?.name;
    const description = `Granted ${data.accessType} access to ${targetType} ${targetName} for resource ${resourceAccess.resource.name}`;

    await aclAuditService.logPermissionGranted(resourceAccess.id, description, actorUserId);

    return resourceAccess;
  }
}