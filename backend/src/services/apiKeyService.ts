import crypto from 'crypto';
import { DatabaseClient } from '../database/client';
import { logger } from '../utils/logger';
import { AuthProvider, UserStatus, AccessType } from '@prisma/client';
import { CreateApiKeyRequest, CreateApiKeyResponse, ApiKeyListItem, ApiKeyUser } from '../types/express';

export class ApiKeyService {
  private db = DatabaseClient.getInstance();

  /**
   * Generate a new API key
   */
  generateApiKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash an API key for storage
   */
  private hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  /**
   * Extract API key from Authorization header (base64 encoded or raw)
   */
  extractApiKey(authHeader: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.split(' ')[1];
    
    // Check if the raw token matches the environment API key first
    const envApiKey = process.env.API_KEY;
    if (envApiKey && token === envApiKey) {
      return token; // Return raw environment API key
    }
    
    try {
      // Try to decode as base64 - regular API keys are base64 encoded
      const decodedKey = Buffer.from(token, 'base64').toString('utf-8');
      return decodedKey;
    } catch (error) {
      // If base64 decoding fails, it might be a regular JWT token
      return null;
    }
  }

  /**
   * Validate API key and return user data
   * @param apiKey The API key to validate
   * @param userHeaders Optional headers containing user details (X-User-Name, X-User-Email)
   */
  async validateApiKey(apiKey: string, userHeaders?: { name?: string; email?: string; workspaceId?: string }): Promise<ApiKeyUser | null> {
    try {
      // Check for environment API key first
      const envApiKey = process.env.API_KEY;
      if (envApiKey && apiKey === envApiKey) {
        logger.info('Environment API key used for authentication');
        
        // Use custom user details from headers if provided, otherwise use defaults
        const userName = userHeaders?.name || 'API User';
        const userEmail = userHeaders?.email || 'api@xyne.juspay.in';
        
        logger.info(`API key user: ${userName} (${userEmail})`);
        
        // Create or find a real user in the database for environment API key
        try {
          const workspaceId = userHeaders?.workspaceId;
          if (!workspaceId) {
            logger.error('workspaceId is required for API key authentication');
            return null;
          }
          // Find existing user by email or create a new one
          let user = await this.db.user.findUnique({
            where: { email_workspaceId: { email: userEmail, workspaceId } }
          });

          if (!user) {
            // Fetch existing orgMember by email
            const orgMember = await this.db.orgMember.findUnique({
              where: { email: userEmail },
              select: { memberId: true }
            });

            if (!orgMember) {
              logger.error(`Cannot create API key user: orgMember not found for email ${userEmail}`);
              return null;
            }

            // Create new user for environment API key
            user = await this.db.user.create({
              data: {
                name: userName,
                email: userEmail,
                authProvider: 'API_KEY',
                providerUserId: `env_api_${Buffer.from(userEmail).toString('base64')}`,
                status: 'ACTIVE',
                workspace: { connect: { id: workspaceId } },
                orgMember: { connect: { memberId: orgMember.memberId } },
              }
            });
            logger.info(`Created new user for environment API key: ${userEmail} (${user.id})`);
          } else {
            // Update existing user's name if provided
            if (userHeaders?.name && user.name !== userName) {
              user = await this.db.user.update({
                where: { id: user.id },
                data: { name: userName }
              });
            }
            logger.info(`Found existing user for environment API key: ${userEmail} (${user.id})`);
          }

          // Fetch org member for role
          const orgMember = await this.db.orgMember.findUnique({
            where: { memberId: user.orgMemberId },
            select: { role: true }
          });

          // Return admin user for the environment key with real user ID
          return {
            id: user.id, // Use real database user ID
            username: user.name,
            email: user.email,
            role: 'user',
            scopes: [
              'tickets:read', 'tickets:write',
              'workflows:read', 'workflows:write', 'workflows:execute',
            ],
            isApiKeyUser: true,
            apiKeyName: 'Environment API Key',
            workspaceId: user.workspaceId,
            orgRole: orgMember!.role,
            memberId: user.orgMemberId,
          };
        } catch (dbError) {
          logger.error('Error creating/finding user for environment API key:', dbError);
          // Fallback to virtual user if database operation fails
          return {
            id: 'env-api-user',
            username: userName,
            email: userEmail,
            role: 'user',
            scopes: [
              'tickets:read', 'tickets:write',
              'workflows:read', 'workflows:write', 'workflows:execute',
            ],
            isApiKeyUser: true,
            apiKeyName: 'Environment API Key',
            workspaceId: userHeaders?.workspaceId ?? '',
            orgRole: '',
            memberId: '',
          };
        }
      }

      const keyHash = this.hashApiKey(apiKey);

      // Find API key in database with user and permissions
      const apiKeyRecord = await this.db.apiKey.findUnique({
        where: {
          keyHash,
          isActive: true
        },
        include: {
          user: {
            include: {
              resourceAccess: {
                include: {
                  resource: true
                }
              }
            }
          }
        }
      });

      if (!apiKeyRecord) {
        return null;
      }

      // Check if API key is expired
      if (apiKeyRecord.expiresAt && new Date() > apiKeyRecord.expiresAt) {
        logger.warn(`API key expired: ${apiKeyRecord.name}`);
        return null;
      }

      // Update last used timestamp
      await this.db.apiKey.update({
        where: { id: apiKeyRecord.id },
        data: { lastUsedAt: new Date() }
      });

      // Collect all permissions from user (filter out invalid resource access records)
      const userPermissions = apiKeyRecord.user.resourceAccess
        .filter(ra => ra.resource)
        .map(ra => ({
          resource: ra.resource.name,
          access: ra.accessType
        }));

      // Manually fetch user group mappings (no FK relation)
      const userGroupMappings = await this.db.userGroupMapping.findMany({
        where: { userId: apiKeyRecord.user.id }
      });

      // Fetch group resource access for all user's groups
      let groupPermissions: { resource: string; access: AccessType }[] = [];
      if (userGroupMappings.length > 0) {
        const groupIds = userGroupMappings.map(m => m.userGroupId);
        const groupAccess = await this.db.resourceAccess.findMany({
          where: { groupId: { in: groupIds } },
          include: { resource: true }
        });

        // Filter out invalid resource access records before mapping
        groupPermissions = groupAccess
          .filter(ra => ra.resource)
          .map(ra => ({
            resource: ra.resource.name,
            access: ra.accessType
          }));
      }

      // Combine permissions
      const allPermissions = [...userPermissions, ...groupPermissions];

      // Convert to scopes format for compatibility
      const scopes = this.permissionsToScopes(allPermissions);

      // Determine user role (admin if has any ADMIN access)
      const isAdmin = allPermissions.some(p => p.access === AccessType.ADMIN);

      // Fetch org member for role
      const orgMember = await this.db.orgMember.findUnique({
        where: { memberId: apiKeyRecord.user.orgMemberId },
        select: { role: true }
      });

      return {
        id: apiKeyRecord.user.id,
        username: apiKeyRecord.user.name,
        email: apiKeyRecord.user.email,
        role: isAdmin ? 'admin' : 'user',
        scopes,
        isApiKeyUser: true,
        apiKeyName: apiKeyRecord.name,
        workspaceId: apiKeyRecord.user.workspaceId,
        orgRole: orgMember!.role,
        memberId: apiKeyRecord.user.orgMemberId,
      };

    } catch (error) {
      logger.error('Error validating API key:', error);
      return null;
    }
  }

  /**
   * Convert ResourceAccess permissions to legacy scope format
   */
  private permissionsToScopes(permissions: { resource: string; access: AccessType }[]): string[] {
    const scopes: string[] = [];
    
    permissions.forEach(({ resource, access }) => {
      // Map resource names to scope prefixes
      const scopePrefix = this.resourceToScopePrefix(resource);
      
      switch (access) {
        case AccessType.READ:
          scopes.push(`${scopePrefix}:read`);
          break;
        case AccessType.WRITE:
          scopes.push(`${scopePrefix}:read`, `${scopePrefix}:write`);
          break;
        case AccessType.ADMIN:
          scopes.push(`${scopePrefix}:read`, `${scopePrefix}:write`, `admin:${scopePrefix}`);
          break;
      }
    });

    return [...new Set(scopes)]; // Remove duplicates
  }

  /**
   * Map resource names to scope prefixes
   */
  private resourceToScopePrefix(resourceName: string): string {
    const mapping: Record<string, string> = {
      'tickets': 'tickets',
      'workflows': 'workflows', 
      'analytics': 'analytics',
      'agents': 'agents',
      'api-keys': 'api_keys',
      'users': 'users',
      'system': 'system'
    };
    
    return mapping[resourceName] || resourceName;
  }

  /**
   * Create a new API key with proper user and permissions
   */
  async createApiKey(request: CreateApiKeyRequest, createdByUserId: string): Promise<CreateApiKeyResponse> {
    try {
      const creatingUser = await this.db.user.findUnique({
        where: { id: createdByUserId }
      });
      if (!creatingUser) {
        throw new Error('Creating user not found');
      }
      const workspaceId = creatingUser.workspaceId;

      // Generate the actual API key
      const rawApiKey = this.generateApiKey();
      const keyHash = this.hashApiKey(rawApiKey);
      const base64Key = Buffer.from(rawApiKey).toString('base64');

      // Calculate expiration date
      const expiresAt = request.expiresInDays
        ? new Date(Date.now() + request.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      // Generate email for API key user
      const apiKeyUserEmail = `${request.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}@api.xyne.juspay.in`;

      // Fetch existing orgMember by email (should exist for workspace members)
      const orgMember = await this.db.orgMember.findFirst({
        where: { email: apiKeyUserEmail },
        select: { memberId: true }
      });

      if (!orgMember) {
        throw new Error(`orgMember not found for API key user email ${apiKeyUserEmail}. User must be added to the organization first.`);
      }

      // Create API key user in database
      const apiKeyUser = await this.db.user.create({
        data: {
          name: request.name,
          email: apiKeyUserEmail,
          authProvider: AuthProvider.API_KEY,
          providerUserId: `api_${crypto.randomUUID()}`,
          status: UserStatus.ACTIVE,
          workspace: { connect: { id: workspaceId } },
          orgMember: { connect: { memberId: orgMember.memberId } },
        }
      });

      // Create the API key record
      const apiKeyRecord = await this.db.apiKey.create({
        data: {
          name: request.name,
          description: request.description,
          keyHash,
          userId: apiKeyUser.id,
          scopes: JSON.stringify(request.scopes),
          expiresAt,
          isActive: true,
        }
      });

      // Grant resource permissions based on scopes
      await this.grantScopePermissions(apiKeyUser.id, request.scopes);

      logger.info(`API key created: ${request.name} for user ${apiKeyUser.id} by ${createdByUserId}`);

      return {
        id: apiKeyRecord.id,
        name: apiKeyRecord.name,
        apiKey: base64Key, // Return base64 encoded key
        scopes: request.scopes,
        expiresAt: expiresAt?.toISOString(),
        createdAt: apiKeyRecord.createdAt.toISOString(),
      };

    } catch (error) {
      logger.error('Error creating API key:', error);
      throw new Error('Failed to create API key');
    }
  }

  /**
   * Grant ResourceAccess permissions based on scopes
   */
  private async grantScopePermissions(userId: string, scopes: string[]): Promise<void> {
    const scopeToPermission: Record<string, { resource: string; access: AccessType }[]> = {
      'tickets:read': [{ resource: 'tickets', access: AccessType.READ }],
      'tickets:write': [
        { resource: 'tickets', access: AccessType.READ },
        { resource: 'tickets', access: AccessType.WRITE }
      ],
      'workflows:read': [{ resource: 'workflows', access: AccessType.READ }],
      'workflows:write': [
        { resource: 'workflows', access: AccessType.READ },
        { resource: 'workflows', access: AccessType.WRITE }
      ],
      'workflows:execute': [
        { resource: 'workflows', access: AccessType.READ },
        { resource: 'workflows', access: AccessType.WRITE }
      ],
      'analytics:read': [{ resource: 'analytics', access: AccessType.READ }],
      'agents:read': [{ resource: 'agents', access: AccessType.READ }],
      'agents:write': [
        { resource: 'agents', access: AccessType.READ },
        { resource: 'agents', access: AccessType.WRITE }
      ],
      'admin:api_keys': [{ resource: 'api-keys', access: AccessType.ADMIN }],
      'admin:users': [{ resource: 'users', access: AccessType.ADMIN }],
      'admin:system': [{ resource: 'system', access: AccessType.ADMIN }],
    };

    // Collect all required permissions
    const requiredPermissions = new Map<string, AccessType>();
    
    scopes.forEach(scope => {
      const permissions = scopeToPermission[scope] || [];
      permissions.forEach(({ resource, access }) => {
        const key = resource;
        const current = requiredPermissions.get(key);
        
        // Upgrade access level if needed (READ < WRITE < ADMIN)
        if (!current || this.compareAccessLevel(access, current) > 0) {
          requiredPermissions.set(key, access);
        }
      });
    });

    // Create resource access records
    for (const [resourceName, accessType] of requiredPermissions) {
      // Ensure resource exists
      await this.db.resource.upsert({
        where: { name: resourceName },
        update: {},
        create: {
          name: resourceName,
          description: `${resourceName} resource`
        }
      });

      // Grant permission to user
      const resource = await this.db.resource.findUnique({
        where: { name: resourceName }
      });

      if (resource) {
        await this.db.resourceAccess.upsert({
          where: {
            userId_resourceId_accessType: {
              userId,
              resourceId: resource.id,
              accessType
            }
          },
          update: {},
          create: {
            userId,
            resourceId: resource.id,
            accessType
          }
        });
      }
    }
  }

  /**
   * Compare access levels for upgrading permissions
   */
  private compareAccessLevel(a: AccessType, b: AccessType): number {
    const levels = { [AccessType.READ]: 1, [AccessType.WRITE]: 2, [AccessType.ADMIN]: 3 };
    return levels[a] - levels[b];
  }

  /**
   * List all API keys
   */
  async listApiKeys(): Promise<ApiKeyListItem[]> {
    try {
      const apiKeys = await this.db.apiKey.findMany({
        include: {
          user: true
        },
        orderBy: { createdAt: 'desc' }
      });

      return apiKeys.map(key => ({
        id: key.id,
        name: key.name,
        description: key.description || undefined,
        scopes: key.scopes ? JSON.parse(key.scopes) : [],
        createdAt: key.createdAt.toISOString(),
        expiresAt: key.expiresAt?.toISOString(),
        lastUsed: key.lastUsedAt?.toISOString(),
        isActive: key.isActive && (!key.expiresAt || new Date() < key.expiresAt),
      }));

    } catch (error) {
      logger.error('Error listing API keys:', error);
      throw new Error('Failed to list API keys');
    }
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(keyId: string, revokedByUserId: string): Promise<boolean> {
    try {
      const apiKey = await this.db.apiKey.findUnique({
        where: { id: keyId },
        include: { user: true }
      });

      if (!apiKey) {
        return false;
      }

      // Deactivate the API key
      await this.db.apiKey.update({
        where: { id: keyId },
        data: { isActive: false }
      });

      // Also deactivate the associated user
      await this.db.user.update({
        where: { id: apiKey.userId },
        data: { status: UserStatus.INACTIVE }
      });

      logger.info(`API key revoked: ${apiKey.name} (${keyId}) by user ${revokedByUserId}`);
      return true;

    } catch (error) {
      logger.error('Error revoking API key:', error);
      throw new Error('Failed to revoke API key');
    }
  }

  /**
   * Check if user has required scope (for API key users)
   */
  hasScope(user: ApiKeyUser, requiredScope: string): boolean {
    // Admin users have access to everything
    if (user.role === 'admin') {
      return true;
    }

    // Check if user has the specific scope
    return user.scopes.includes(requiredScope);
  }

  /**
   * Get available scopes
   */
  getAvailableScopes(): { scope: string; description: string }[] {
    return [
      { scope: 'tickets:read', description: 'Read access to tickets and ticket data' },
      { scope: 'tickets:write', description: 'Create and update tickets' },
      { scope: 'workflows:read', description: 'Read access to workflows' },
      { scope: 'workflows:write', description: 'Create and update workflows' },
      { scope: 'workflows:execute', description: 'Execute workflow operations' },
      { scope: 'analytics:read', description: 'Read access to analytics and reports' },
      { scope: 'agents:read', description: 'Read access to agents and tools' },
      { scope: 'agents:write', description: 'Create and update agents and tools' },
      { scope: 'admin:users', description: 'Manage users and permissions' },
      { scope: 'admin:api_keys', description: 'Manage API keys' },
      { scope: 'admin:system', description: 'System administration access' },
    ];
  }

  /**
   * Validate scopes
   */
  validateScopes(scopes: string[]): { valid: boolean; invalidScopes: string[] } {
    const validScopes = this.getAvailableScopes().map(s => s.scope);
    const invalidScopes = scopes.filter(scope => !validScopes.includes(scope));
    
    return {
      valid: invalidScopes.length === 0,
      invalidScopes,
    };
  }
}

// Export singleton instance
export const apiKeyService = new ApiKeyService();