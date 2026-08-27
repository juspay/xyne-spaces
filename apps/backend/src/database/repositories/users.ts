import { BaseRepository } from './base';
import {
  User,
  CreateUserInput,
  UpdateUserInput,
  QueryOptions,
  UserWithMappings,
  UserWithAccess,
  PaginationOptions,
  PaginatedResult,
} from '@/types/database';
import { Prisma } from '@prisma/client';
import { AuthProvider, UserStatus } from '@xyne/shared';
//import { queueUserIngestion } from '@/queues/vespaQueue';

export class UserRepository extends BaseRepository<User, CreateUserInput, UpdateUserInput> {
  constructor() {
    super('user');
  }

  async create(data: CreateUserInput): Promise<User> {
    await this.validateString(data.email, 'email', 255);
    await this.validateString(data.name, 'name', 255);
    await this.validateString(data.providerUserId, 'providerUserId', 255);

    if (data.authProvider) {
      await this.validateEnum(data.authProvider, 'authProvider', Object.values(AuthProvider));
    }

    if (data.status) {
      await this.validateEnum(data.status, 'status', Object.values(UserStatus));
    }

    const user = await this.db.user.create({
      data,
    });

    // No Vespa ingestion needed here: `this.db` is the shared client (DatabaseClient.getInstance),
    // so the setupUserVespaSync Prisma middleware fires on THIS create too — as it does for every
    // user create/upsert — and upserts the full user doc. If ever reviving the dead block below,
    // use a PARTIAL upsert, never a full 'feed' (a feed replaces the doc and wipes the
    // personalization worker's weights).
    // Queue user for Vespa ingestion
    // try {
    //   await queueUserIngestion(user, 'feed');
    // } catch (error) {
    //   // Log error but don't fail the user creation
    // }

    return user;
  }

  async findById(id: string): Promise<User | null> {
    return await this.db.user.findUnique({
      where: { id },
    });
  }

  /**
   * Resolve a caller-supplied user id, scoped to the caller's workspace. Use this
   * for ids from a request body: `findById` matches installation-wide, so it would
   * let a member reference any user in any workspace. Returns null both when the
   * user does not exist and when they exist elsewhere, so the two cannot be told
   * apart to enumerate accounts.
   */
  async findByIdInWorkspace(id: string, workspaceId: string): Promise<User | null> {
    return await this.db.user.findFirst({
      where: { id, workspaceId },
    });
  }

  async findByIdWithWorkspace(id: string): Promise<
    (User & { workspace: { id: string; name: string } }) | null
  > {
    return (await this.db.user.findUnique({
      where: { id },
      include: { workspace: { select: { id: true, name: true } } },
    })) as (User & { workspace: { id: string; name: string } }) | null;
  }

  async findByEmail(email: string, workspaceId: string): Promise<User | null> {
    return await this.db.user.findUnique({
      where: { email_workspaceId: { email, workspaceId } },
    });
  }

  async findByEmailCaseInsensitive(email: string, workspaceId: string): Promise<User | null> {
    return await this.db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, workspaceId },
    });
  }

  async findByUsername(username: string): Promise<User | null> {
    return await this.db.user.findFirst({
      where: { name: username },
    });
  }

  async findByProviderUserId(providerUserId: string, workspaceId: string): Promise<User | null> {
    return await this.db.user.findUnique({
      where: { providerUserId_workspaceId: { providerUserId, workspaceId } },
    });
  }

  async findMany(options?: QueryOptions): Promise<User[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.user.findMany({
      skip,
      take,
      orderBy,
      where,
    });
  }

  async findManyPaginated(options: PaginationOptions & { where?: any }): Promise<PaginatedResult<User>> {
    const { page, pageSize, where } = options;
    const paginationQuery = this.buildPaginationQuery({ page, pageSize });

    return this.paginate(
      () => this.db.user.findMany({
        ...paginationQuery,
        where,
        orderBy: { createdAt: 'desc' },
      }),
      () => this.db.user.count({ where }),
      { page, pageSize }
    );
  }

  async update(id: string, data: UpdateUserInput): Promise<User> {
    if (data.email && typeof data.email === 'string') {
      await this.validateString(data.email, 'email', 255);
    }

    if (data.name && typeof data.name === 'string') {
      await this.validateString(data.name, 'name', 255);
    }

    if (data.providerUserId && typeof data.providerUserId === 'string') {
      await this.validateString(data.providerUserId, 'providerUserId', 255);
    }

    if (data.authProvider) {
      await this.validateEnum(data.authProvider, 'authProvider', Object.values(AuthProvider));
    }

    if (data.status) {
      await this.validateEnum(data.status, 'status', Object.values(UserStatus));
    }

    const user = await this.db.user.update({
      where: { id },
      data,
    });

    // Queue updated user for Vespa ingestion
    // try {
    //   await queueUserIngestion(user, 'update');
    // } catch (error) {
    //   // Log error but don't fail the user update
    // }

    return user;
  }

  async delete(id: string): Promise<User> {
    // Get the user before deletion for Vespa queue
    // const user = await this.db.user.findUnique({
    //   where: { id },
    // });

    const deletedUser = await this.db.user.delete({
      where: { id },
    });

    // Queue user deletion for Vespa
    // if (user) {
    //   try {
    //     await queueUserIngestion(user, 'delete');
    //   } catch (error) {
    //     // Log error but don't fail the user deletion
    //   }
    // }

    return deletedUser;
  }

  async findWithMappings(id: string): Promise<UserWithMappings | null> {
    const user = await this.db.user.findUnique({
      where: { id }
    });

    if (!user) return null;

    // Fetch all mappings for this user
    const mappings = await this.db.userGroupMapping.findMany({
      where: { userId: id }
    });

    if (mappings.length === 0) {
      return {
        ...user,
        userGroupMappings: []
      } as UserWithMappings;
    }

    // Extract user group IDs from mappings
    const userGroupIds = mappings.map(m => m.userGroupId);

    // Fetch all user groups in ONE batch query
    const userGroups = await this.db.userGroup.findMany({
      where: { id: { in: userGroupIds } }
    });

    // Create a map for quick lookup
    const userGroupMap = new Map(userGroups.map(g => [g.id, g]));

    // Combine mappings with their corresponding user groups
    const userGroupMappings = mappings.map(mapping => ({
      ...mapping,
      userGroup: userGroupMap.get(mapping.userGroupId) || null
    }));

    return {
      ...user,
      userGroupMappings
    } as UserWithMappings;
  }

  async findWithAccess(id: string): Promise<UserWithAccess | null> {
    return await this.db.user.findUnique({
      where: { id },
      include: {
        resourceAccess: {
          include: {
            resource: true,
          },
        },
      },
    });
  }

  async findByUserGroup(userGroupId: string): Promise<User[]> {
    // Get all user IDs in this group
    const mappings = await this.db.userGroupMapping.findMany({
      where: { userGroupId },
      select: { userId: true }
    });

    if (mappings.length === 0) return [];

    const userIds = mappings.map(m => m.userId);

    // Fetch all users in ONE batch query
    return await this.db.user.findMany({
      where: { id: { in: userIds } },
      orderBy: { email: 'asc' }
    });
  }

  async findByStatus(status: UserStatus): Promise<User[]> {
    return await this.db.user.findMany({
      where: { status },
      orderBy: { email: 'asc' },
    });
  }

  /**
   * Private helper method to enrich users with their group mappings
   * Efficiently fetches mappings and groups in batched queries, then combines them
   */
  private async enrichUsersWithMappings(users: User[]): Promise<UserWithMappings[]> {
    if (users.length === 0) {
      return [];
    }

    // Get all mappings for these users
    const userIds = users.map(u => u.id);
    const mappings = await this.db.userGroupMapping.findMany({
      where: { userId: { in: userIds } }
    });

    if (mappings.length === 0) {
      return users.map(user => ({ ...user, userGroupMappings: [] })) as UserWithMappings[];
    }

    // Get all unique user group IDs
    const groupIds = [...new Set(mappings.map(m => m.userGroupId))];

    // Batch fetch all user groups
    const userGroups = await this.db.userGroup.findMany({
      where: { id: { in: groupIds } }
    });

    // Create maps for quick lookup
    const groupMap = new Map(userGroups.map(g => [g.id, g]));
    const userMappingsMap = new Map<string, any[]>();

    // Build user mappings map
    mappings.forEach(mapping => {
      if (!userMappingsMap.has(mapping.userId)) {
        userMappingsMap.set(mapping.userId, []);
      }
      userMappingsMap.get(mapping.userId)!.push({
        ...mapping,
        userGroup: groupMap.get(mapping.userGroupId) || null
      });
    });

    // Combine users with their mappings
    return users.map(user => ({
      ...user,
      userGroupMappings: userMappingsMap.get(user.id) || []
    })) as UserWithMappings[];
  }

  async findBySearch(searchTerm: string, options?: PaginationOptions): Promise<PaginatedResult<UserWithMappings> | UserWithMappings[]> {
    // Search filter that only matches names starting with the search term
    const searchFilter = {
      name: {
        startsWith: searchTerm,
        mode: 'insensitive' as const,
      },
    };

    if (options) {
      const { page, pageSize } = options;
      const paginationQuery = this.buildPaginationQuery({ page, pageSize });

      // Get paginated users first
      const users = await this.db.user.findMany({
        ...paginationQuery,
        where: searchFilter,
        orderBy: { name: 'asc' },
      });

      const count = await this.db.user.count({ where: searchFilter });

      // Enrich users with their group mappings using helper method
      const usersWithMappings = await this.enrichUsersWithMappings(users);

      return {
        data: usersWithMappings,
        pagination: {
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize),
          total: count
        }
      };
    }

    // Non-paginated search
    const users = await this.db.user.findMany({
      where: searchFilter,
      orderBy: { name: 'asc' },
    });

    // Enrich users with their group mappings using helper method
    return await this.enrichUsersWithMappings(users);
  }

  async validateEmailUnique(email: string, workspaceId: string, excludeId?: string): Promise<void> {
    const existing = await this.db.user.findUnique({
      where: { email_workspaceId: { email, workspaceId } },
    });

    if (existing && existing.id !== excludeId) {
      throw new Error(`User with email '${email}' already exists`);
    }
  }

  async validateProviderUserIdUnique(providerUserId: string, workspaceId: string, excludeId?: string): Promise<void> {
    const existing = await this.db.user.findUnique({
      where: { providerUserId_workspaceId: { providerUserId, workspaceId } },
    });

    if (existing && existing.id !== excludeId) {
      throw new Error(`User with provider user ID '${providerUserId}' already exists`);
    }
  }

  async findActiveUsers(): Promise<User[]> {
    return await this.db.user.findMany({
      where: { status: UserStatus.ACTIVE },
      orderBy: { email: 'asc' },
    });
  }

  async updateStatus(id: string, status: UserStatus): Promise<User> {
    const user = await this.db.user.update({
      where: { id },
      data: { status },
    });

    // Queue user status update for Vespa ingestion
    // try {
    //   await queueUserIngestion(user, 'update');
    // } catch (error) {
    //   // Log error but don't fail the status update
    // }

    return user;
  }

  async findByMetadataField(key: string, value: string, workspaceId?: string): Promise<User | null> {
    return await this.db.user.findFirst({
      where: {
        metadata: {
          path: [key],
          equals: value,
        },
        ...(workspaceId ? { workspaceId } : {}),
      },
    });
  }

  async upsertMetaDataField(userId: string, key: string, value: any): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new Error(`User with id '${userId}' not found`);
    }

    const currentMetadata = (user.metadata as Record<string, any>) || {};

    const updatedMetadata = {
      ...currentMetadata,
      [key]: value,
    };

    return await this.db.user.update({
      where: { id: userId },
      data: {
        metadata: updatedMetadata,
      },
    });
  }

  /**
   * Get user names by user IDs
   * Supports transaction client for atomic operations
   */
  async getUserNamesByIds(
    userIds: string[],
    tx: Prisma.TransactionClient
  ): Promise<Array<{ id: string; name: string; displayName: string | null }>> {
    return await tx.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, displayName: true },
    });
  }
}
