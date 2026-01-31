import { BaseRepository } from './base';
import {
  UserGroup,
  CreateUserGroupInput,
  UpdateUserGroupInput,
  QueryOptions,
  UserGroupWithMappings,
  PaginationOptions,
  PaginatedResult,
} from '@/types/database';
import { aclAuditService } from '@/services/aclAuditService';

export interface CreateUserGroupWithUsersInput extends CreateUserGroupInput {
  userIds?: string[];
}

export class UserGroupRepository extends BaseRepository<UserGroup, CreateUserGroupInput, UpdateUserGroupInput> {
  constructor() {
    super('userGroup');
  }

  async create(data: CreateUserGroupInput, actorUserId?: string): Promise<UserGroup> {
    await this.validateString(data.name, 'name', 100);

    // Validate alias if provided
    if (data.alias) {
      this.validateAlias(data.alias);
      await this.validateAliasUnique(data.alias);
    }

    const userGroup = await this.db.userGroup.create({
      data,
    });

    // Log audit event
    await aclAuditService.logUserGroupCreated(userGroup.id, userGroup.name, actorUserId);

    return userGroup;
  }

  async createWithUsers(data: CreateUserGroupWithUsersInput, actorUserId?: string): Promise<UserGroup> {
    await this.validateString(data.name, 'name', 100);

    // Validate alias if provided
    if (data.alias) {
      this.validateAlias(data.alias);
      await this.validateAliasUnique(data.alias);
    }

    // Use transaction to create user group and user mappings together
    return await this.db.$transaction(async (tx) => {
      const userGroup = await tx.userGroup.create({
        data: {
          name: data.name,
          alias: data.alias || null,
          description: data.description || null,
          metadata: data.metadata,
        },
      });

      // Create user mappings if userIds are provided
      if (data.userIds && data.userIds.length > 0) {
        await tx.userGroupMapping.createMany({
          data: data.userIds.map(userId => ({
            userGroupId: userGroup.id,
            userId,
          })),
        });
      }

      // Log audit event
      await aclAuditService.logUserGroupCreated(userGroup.id, userGroup.name, actorUserId);

      return userGroup;
    });
  }

  async findById(id: string): Promise<UserGroup | null> {
    return await this.db.userGroup.findUnique({
      where: { id },
    });
  }

  async findByName(name: string): Promise<UserGroup | null> {
    return await this.db.userGroup.findUnique({
      where: { name },
    });
  }

  async findMany(options?: QueryOptions): Promise<UserGroup[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.userGroup.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async findManyPaginated(options: PaginationOptions & { where?: any }): Promise<PaginatedResult<UserGroup>> {
    const { page, pageSize, where } = options;
    const paginationQuery = this.buildPaginationQuery({ page, pageSize });

    return this.paginate(
      () => this.db.userGroup.findMany({
        ...paginationQuery,
        where,
        orderBy: { createdAt: 'desc' },
      }),
      () => this.db.userGroup.count({ where }),
      { page, pageSize }
    );
  }

  async update(id: string, data: UpdateUserGroupInput, actorUserId?: string): Promise<UserGroup> {
    if (data.name) {
      await this.validateString(data.name, 'name', 100);
    }

    // Validate alias if provided
    if (data.alias && typeof data.alias === 'string') {
      this.validateAlias(data.alias);
      await this.validateAliasUnique(data.alias, id);
    }

    const userGroup = await this.db.userGroup.update({
      where: { id },
      data,
    });

    // Log audit event
    await aclAuditService.logUserGroupUpdated(userGroup.id, userGroup.name, actorUserId);

    return userGroup;
  }

  async delete(id: string, actorUserId?: string): Promise<UserGroup> {
    // Get user group name before deletion for audit log
    const userGroup = await this.findById(id);

    const deletedUserGroup = await this.db.userGroup.delete({
      where: { id },
    });

    // Log audit event
    if (userGroup) {
      await aclAuditService.logUserGroupDeleted(userGroup.id, userGroup.name, actorUserId);
    }

    return deletedUserGroup;
  }

  async findWithMappings(id: string): Promise<UserGroupWithMappings | null> {
    const group = await this.db.userGroup.findUnique({
      where: { id }
    });

    if (!group) return null;

    // Fetch all mappings for this group
    const mappings = await this.db.userGroupMapping.findMany({
      where: { userGroupId: id }
    });

    if (mappings.length === 0) {
      return {
        ...group,
        userGroupMappings: []
      } as UserGroupWithMappings;
    }

    // Extract user IDs from mappings
    const userIds = mappings.map(m => m.userId);

    // Fetch all users in ONE batch query
    const users = await this.db.user.findMany({
      where: { id: { in: userIds } }
    });

    // Create a map for quick lookup
    const userMap = new Map(users.map(u => [u.id, u]));

    // Combine mappings with their corresponding users
    const userGroupMappings = mappings.map(mapping => ({
      ...mapping,
      user: userMap.get(mapping.userId) || null
    }));

    return {
      ...group,
      userGroupMappings
    } as UserGroupWithMappings;
  }

  async findBySearch(searchTerm: string, options?: PaginationOptions): Promise<PaginatedResult<UserGroup> | UserGroup[]> {
    const searchFilter = this.createSearchFilter(searchTerm, ['name', 'alias', 'description']);

    if (options) {
      return this.findManyPaginated({
        ...options,
        where: searchFilter,
      });
    }

    return this.findMany({ where: searchFilter });
  }

  async getUserCount(groupId: string): Promise<number> {
    return await this.db.userGroupMapping.count({
      where: { userGroupId: groupId },
    });
  }

  async validateNameUnique(name: string, excludeId?: string): Promise<void> {
    const existing = await this.db.userGroup.findUnique({
      where: { name },
    });

    if (existing && existing.id !== excludeId) {
      throw new Error(`User group with name '${name}' already exists`);
    }
  }

  /**
   * Validate alias format: lowercase, no spaces, only hyphens and underscores allowed
   */
  validateAlias(alias: string): void {
    // Check length (minimum 2, maximum 50 characters)
    if (alias.length < 2 || alias.length > 50) {
      throw new Error('Group alias must be between 2 and 50 characters');
    }

    // Check format: lowercase letters, numbers, hyphens, and underscores only
    const aliasRegex = /^[a-z0-9_-]+$/;
    if (!aliasRegex.test(alias)) {
      throw new Error('Group alias can only contain lowercase letters, numbers, hyphens (-), and underscores (_)');
    }

    // Must start with a letter or number (not a special character)
    if (!/^[a-z0-9]/.test(alias)) {
      throw new Error('Group alias must start with a letter or number');
    }

    // Must end with a letter or number (not a special character)
    if (!/[a-z0-9]$/.test(alias)) {
      throw new Error('Group alias must end with a letter or number');
    }

    // Cannot have consecutive special characters
    if (/[-_]{2,}/.test(alias)) {
      throw new Error('Group alias cannot have consecutive hyphens or underscores');
    }
  }

  /**
   * Validate that alias is unique
   */
  async validateAliasUnique(alias: string, excludeId?: string): Promise<void> {
    const existing = await this.db.userGroup.findUnique({
      where: { alias },
    });

    if (existing && existing.id !== excludeId) {
      throw new Error(`Group alias '${alias}' is already taken`);
    }
  }

  /**
   * Find group by alias
   */
  async findByAlias(alias: string): Promise<UserGroup | null> {
    return await this.db.userGroup.findUnique({
      where: { alias },
    });
  }

  async findByMetadataField(key: string, value: string): Promise<UserGroup | null> {
    return await this.db.userGroup.findFirst({
      where: {
        metadata: {
          path: [key],
          equals: value,
        },
      },
    });
  }

}
