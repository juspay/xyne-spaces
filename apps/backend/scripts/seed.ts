#!/usr/bin/env npx tsx

/**
 * ACL System Seeding Script
 * 
 * This script sets up the complete ACL system by:
 * 1. Creating essential resources (TICKETS, USERS, WORKFLOWS, etc.)
 * 2. Setting up default user groups with proper permissions
 * 3. Creating a default admin user
 * 4. Cleaning up expired user sessions
 */

import { PrismaClient } from '@prisma/client';
import { repositories } from '../src/database/repositories/index';
import {
  WorkspaceJoinPolicy,
  WorkspaceType,
  OrgLLMServiceAccountProvider,
  OrgLLMServiceAccountPurpose,
  OrgLLMServiceAccountCredentialStatus,
  AccessType,
  AuthProvider,
  UserStatus,
  SessionStatus,
  WorkspaceRole,
  OrgRole,
  ProjectType,
} from '@xyne/shared';
import { encrypt } from '../src/services/encryptionService';

const prisma = new PrismaClient();

// Essential resources that the application needs
const ESSENTIAL_RESOURCES = [
  { name: 'PROJECTS', description: 'Project management endpoints (/api/projects/*)' },
  { name: 'TICKETS', description: 'Ticket management endpoints (/api/tickets/*)' },
  { name: 'USERS', description: 'User management endpoints (/api/users/*)' },
  { name: 'WORKFLOWS', description: 'Workflow management endpoints (/api/workflows/*)' },
  { name: 'AGENTS', description: 'Agent management endpoints (/api/agents/*)' },
  { name: 'TOOLS', description: 'Tool management endpoints (/api/tools/*)' },
  { name: 'MODELS', description: 'Model management endpoints (/api/models/*)' },
  { name: 'ANALYTICS', description: 'Analytics endpoints (/api/analytics/*)' },
  { name: 'HEALTH', description: 'Health check endpoints (/api/health/*)' },
  { name: 'AUTH', description: 'Authentication endpoints (/api/auth/*)' },
  { name: 'XYNE-APPS', description: 'Xyne Apps management endpoints (/api/apps/*)' },
  { name: 'VESPA', description: 'Vespa backfill / reindex admin endpoints (/api/admin/vespa-backfill/*, /api/migration/vespa-workspace-backfill/*)' },
  { name: 'RELEASE-MANAGER', description: 'Release-config edit access (/api/commits/analyze/*, save release config). Admins/owners have it by role; grant to other users to let them edit without admin privilege.' },
  { name: 'ROLES', description: 'Role creation and management UI' },
  { name: 'SDLC', description: 'SDLC fast-lane surface access (/sdlc, /api/sdlc/*)' },
];

// Default user groups with their permissions
const DEFAULT_USER_GROUPS = [
  {
    name: 'ADMIN',
    description: 'Full system access - can manage all resources',
    permissions: ESSENTIAL_RESOURCES.map(resource => ({
      resourceName: resource.name,
      accessType: AccessType.ADMIN
    }))
  },
  {
    name: 'DEVELOPER',
    description: 'Developer access - can read/write most resources',
    permissions: [
      { resourceName: 'TICKETS', accessType: AccessType.WRITE },
      { resourceName: 'WORKFLOWS', accessType: AccessType.WRITE },
      { resourceName: 'AGENTS', accessType: AccessType.WRITE },
      { resourceName: 'TOOLS', accessType: AccessType.READ },
      { resourceName: 'MODELS', accessType: AccessType.READ },
      { resourceName: 'ANALYTICS', accessType: AccessType.READ },
      { resourceName: 'HEALTH', accessType: AccessType.READ },
      { resourceName: 'AUTH', accessType: AccessType.READ },
    ]
  },
  {
    name: 'VIEWER',
    description: 'Read-only access to most resources',
    permissions: [
      { resourceName: 'TICKETS', accessType: AccessType.READ },
      { resourceName: 'WORKFLOWS', accessType: AccessType.READ },
      { resourceName: 'AGENTS', accessType: AccessType.READ },
      { resourceName: 'TOOLS', accessType: AccessType.READ },
      { resourceName: 'MODELS', accessType: AccessType.READ },
      { resourceName: 'ANALYTICS', accessType: AccessType.READ },
      { resourceName: 'HEALTH', accessType: AccessType.READ },
    ]
  }
];

// Default admin user configuration
const DEFAULT_ADMIN_USER = {
  name: 'System Administrator',
  email: 'admin@xyne.ai',
  authProvider: AuthProvider.EMAIL,
  providerUserId: 'email-admin@xyne.ai',
  status: UserStatus.ACTIVE,
};

async function main() {
  console.log('🚀 Starting ACL system seeding...');

  try {
    // Step 1: Create essential resources
    console.log('\n📦 Creating essential resources...');
    const createdResources = new Map<string, string>();
    
    for (const resourceData of ESSENTIAL_RESOURCES) {
      try {
        // Check if resource already exists
        const existing = await repositories.resources.findByName(resourceData.name);
        if (existing) {
          console.log(`  ✅ Resource ${resourceData.name} already exists`);
          createdResources.set(resourceData.name, existing.id);
          continue;
        }

        // Create new resource
        const resource = await repositories.resources.create(resourceData);
        createdResources.set(resourceData.name, resource.id);
        console.log(`  ✅ Created resource: ${resourceData.name}`);
      } catch (error) {
        console.error(`  ❌ Failed to create resource ${resourceData.name}:`, error);
        throw error;
      }
    }

    // Step 2: Create default user groups
    console.log('\n👥 Creating default user groups...');
    const createdGroups = new Map<string, string>();

    for (const groupData of DEFAULT_USER_GROUPS) {
      try {
        // Check if group already exists
        let group = await prisma.userGroup.findUnique({
          where: { name: groupData.name }
        });

        if (group) {
          console.log(`  ✅ User group ${groupData.name} already exists`);
          createdGroups.set(groupData.name, group.id);
        } else {
          // Create new group
          group = await repositories.userGroups.create({
            name: groupData.name,
            description: groupData.description
          });
          createdGroups.set(groupData.name, group.id);
          console.log(`  ✅ Created user group: ${groupData.name}`);
        }

        // Ensure group exists before setting up permissions
        if (!group) {
          console.error(`  ❌ Failed to create or find group: ${groupData.name}`);
          continue;
        }

        // Step 3: Set up permissions for each group
        console.log(`  🔐 Setting up permissions for ${groupData.name}...`);
        for (const permission of groupData.permissions) {
          const resourceId = createdResources.get(permission.resourceName);
          if (!resourceId) {
            console.warn(`    ⚠️  Resource ${permission.resourceName} not found, skipping permission`);
            continue;
          }

          try {
            // Check if permission already exists
            const existingPermission = await prisma.resourceAccess.findUnique({
              where: {
                groupId_resourceId_accessType: {
                  groupId: group.id,
                  resourceId: resourceId,
                  accessType: permission.accessType
                }
              }
            });

            if (existingPermission) {
              console.log(`    ✅ Permission already exists: ${groupData.name} -> ${permission.resourceName} (${permission.accessType})`);
              continue;
            }

            // Create new permission
            await repositories.resourceAccess.create({
              groupId: group.id,
              resourceId: resourceId,
              accessType: permission.accessType
            });
            console.log(`    ✅ Granted ${permission.accessType} access to ${permission.resourceName}`);
          } catch (error) {
            console.error(`    ❌ Failed to grant permission ${permission.resourceName}:`, error);
          }
        }
      } catch (error) {
        console.error(`  ❌ Failed to create group ${groupData.name}:`, error);
        throw error;
      }
    }

    // Step 4: Create default organization and workspace
    console.log('\n🏢 Creating default organization and workspace...');
    let defaultWorkspaceId: string;
    try {
      // Check if default org exists
      let defaultOrg = await prisma.organization.findFirst({
        where: { name: 'Xyne Default' }
      });

      if (!defaultOrg) {
        defaultOrg = await prisma.organization.create({
          data: {
            name: 'Xyne Default',
            orgId: 'xyne-default-org',
            createdBy: 'system',
          }
        });
        console.log('  ✅ Created default organization');
      } else {
        console.log('  ✅ Default organization already exists');
      }

      // Check if default workspace exists
      let defaultWorkspace = await prisma.workspace.findFirst({
        where: { name: 'Default Workspace' }
      });

      if (!defaultWorkspace) {
        defaultWorkspace = await prisma.workspace.create({
          data: {
            name: 'Default Workspace',
            orgId: defaultOrg.orgId,
            createdBy: 'system',
            workspaceType: WorkspaceType.ENTERPRISE,
            joinPolicy: WorkspaceJoinPolicy.INVITE_ONLY,
          }
        });
        console.log('  ✅ Created default workspace');

        // Create DM project for the workspace
        await prisma.project.create({
          data: {
            name: 'Direct Messages',
            code: 'DM',
            description: 'DM project for direct message channels',
            type: ProjectType.DM,
            workspaceId: defaultWorkspace.id,
            createdBy: 'system',
          }
        });
        console.log('  ✅ Created DM project for default workspace');
      } else {
        console.log('  ✅ Default workspace already exists');
      }

      defaultWorkspaceId = defaultWorkspace.id;

      // Link org to workspace if not already linked
      const existingLink = await prisma.workspaceOrganization.findFirst({
        where: { orgId: defaultOrg.orgId, workspaceId: defaultWorkspace.id }
      });
      if (!existingLink) {
        await prisma.workspaceOrganization.create({
          data: {
            orgId: defaultOrg.orgId,
            workspaceId: defaultWorkspace.id,
            role: WorkspaceRole.OWNER,
          }
        });
        console.log('  ✅ Linked organization to workspace');
      }
    } catch (error) {
      console.error('  ❌ Failed to create default organization/workspace:', error);
      throw error;
    }

    // Step 5: Create default admin user
    console.log('\n👤 Creating default admin user...');
    try {
      // First, ensure default org exists for orgMember creation
      const defaultOrg = await prisma.organization.findFirst({
        where: { name: 'Xyne Default' }
      });

      if (!defaultOrg) {
        throw new Error('Default organization not found');
      }

      // Check if admin user already exists in the default workspace
      let adminUser = await repositories.users.findByEmail(DEFAULT_ADMIN_USER.email, defaultWorkspaceId);
      let orgMemberId: string;

      if (adminUser) {
        console.log('  ✅ Default admin user already exists');
        
        // Get or create orgMember for existing admin user
        const existingOrgMember = await prisma.orgMember.findUnique({
          where: { email: adminUser.email }
        });
        
        if (existingOrgMember) {
          orgMemberId = existingOrgMember.memberId;
          if (existingOrgMember.role !== OrgRole.ADMIN) {
            await prisma.orgMember.update({
              where: { memberId: orgMemberId },
              data: { role: OrgRole.ADMIN }
            });
            console.log('  ✅ Updated admin user organization role to ADMIN');
          }
        } else {
          const newOrgMember = await prisma.orgMember.create({
            data: {
              orgId: defaultOrg.orgId,
              email: adminUser.email,
              role: OrgRole.ADMIN,
            }
          });
          orgMemberId = newOrgMember.memberId;
          console.log('  ✅ Created orgMember for existing admin user');
        }
      } else {
        // Get admin group ID
        const adminGroupId = createdGroups.get('ADMIN');
        if (!adminGroupId) {
          throw new Error('ADMIN group not found');
        }

        // Create orgMember FIRST (to get the memberId)
        const orgMember = await prisma.orgMember.create({
          data: {
            orgId: defaultOrg.orgId,
            email: DEFAULT_ADMIN_USER.email,
            role: OrgRole.ADMIN,
          }
        });
        orgMemberId = orgMember.memberId;
        console.log('  ✅ Created orgMember for admin user');

        // Create admin user with workspaceId, ADMIN role, and orgMemberId
        adminUser = await repositories.users.create({
          ...DEFAULT_ADMIN_USER,
          workspaceId: defaultWorkspaceId,
          userGroupId: adminGroupId,
          role: WorkspaceRole.ADMIN,
          orgMemberId: orgMemberId,
        });
        console.log(`  ✅ Created default admin user: ${DEFAULT_ADMIN_USER.email} with ADMIN role and orgMemberId`);

        // Link admin user to ADMIN group via UserGroupMapping
        await prisma.userGroupMapping.create({
          data: {
            userId: adminUser.id,
            userGroupId: adminGroupId,
            workspaceId: defaultWorkspaceId,
          }
        });
        console.log('  ✅ Linked admin user to ADMIN group');
      }

      // Ensure admin user has ADMIN workspace role and orgMemberId
      if (adminUser.role !== WorkspaceRole.ADMIN || !adminUser.orgMemberId) {
        await repositories.users.update(adminUser.id, {
          role: WorkspaceRole.ADMIN,
          orgMemberId: orgMemberId,
        });
        console.log('  ✅ Updated admin user workspace role and orgMemberId');
      }

      // Grant direct ADMIN access to XYNE-APPS resource for admin user
      const xyneAppsResourceId = createdResources.get('XYNE-APPS');
      if (xyneAppsResourceId) {
        try {
          const existingDirectAccess = await prisma.resourceAccess.findFirst({
            where: {
              userId: adminUser.id,
              resourceId: xyneAppsResourceId,
              accessType: AccessType.ADMIN
            }
          });

          if (!existingDirectAccess) {
            await repositories.resourceAccess.create({
              userId: adminUser.id,
              resourceId: xyneAppsResourceId,
              accessType: AccessType.ADMIN
            });
            console.log('  ✅ Granted direct ADMIN access to XYNE-APPS for admin user');
          } else {
            console.log('  ✅ Admin user already has direct ADMIN access to XYNE-APPS');
          }
        } catch (error) {
          console.error('  ❌ Failed to grant direct XYNE-APPS access:', error);
          // Don't throw - this is not critical
        }
      }
    } catch (error) {
      console.error('  ❌ Failed to create default admin user:', error);
      throw error;
    }

    // Step 5: Seed org LLM service account credentials from env
    console.log('\n🔑 Seeding org LLM service account credentials...');
    try {
      const litellmApiKey = process.env.LITELLM_API_KEY;
      const litellmBaseUrl = process.env.LITELLM_BASE_URL || 'https://grid.ai.example.com/';

      if (!litellmApiKey) {
        console.log('  ⚠️  LITELLM_API_KEY not set in environment, skipping org LLM credential seeding');
      } else {
        const defaultOrg = await prisma.organization.findFirst({
          where: { name: 'Xyne Default' },
        });

        if (!defaultOrg) {
          console.log('  ⚠️  Default organization not found, skipping org LLM credential seeding');
        } else {
          const purposes = Object.values(OrgLLMServiceAccountPurpose);
          const now = new Date();
          const credentialsPayload = {
            source: 'xyne-spaces',
            litellmTeamId: 'seed-default-team',
            key: litellmApiKey,
            providerUrl: litellmBaseUrl,
            defaultModel: process.env.DEFAULT_MODEL_NAME ?? null,
            teamAlias: defaultOrg.name,
            provisionedAt: now.toISOString(),
          };
          const encryptedCredentials = encrypt(JSON.stringify(credentialsPayload));

          for (const purpose of purposes) {
            try {
              await prisma.orgLLMServiceAccountCredential.upsert({
                where: {
                  orgId_provider_purpose: {
                    orgId: defaultOrg.orgId,
                    provider: OrgLLMServiceAccountProvider.LITELLM,
                    purpose,
                  },
                },
                create: {
                  orgId: defaultOrg.orgId,
                  provider: OrgLLMServiceAccountProvider.LITELLM,
                  purpose,
                  credentials: encryptedCredentials,
                  status: OrgLLMServiceAccountCredentialStatus.ACTIVE,
                  lastProvisionedAt: now,
                  createdAt: now,
                  updatedAt: now,
                },
                update: {
                  credentials: encryptedCredentials,
                  status: OrgLLMServiceAccountCredentialStatus.ACTIVE,
                  lastProvisionedAt: now,
                  updatedAt: now,
                },
              });
              console.log(`  ✅ Seeded LLM credential for purpose: ${purpose}`);
            } catch (error) {
              console.error(`  ❌ Failed to seed LLM credential for purpose ${purpose}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error('  ❌ Failed to seed org LLM credentials:', error);
      // Don't throw - this is not critical for ACL seeding
    }

    // Step 6: Clean up expired user sessions
    console.log('\n🧹 Cleaning up expired user sessions...');
    try {
      const now = new Date();
      
      // Find expired sessions
      const expiredSessions = await prisma.userSession.findMany({
        where: {
          OR: [
            { refreshTokenExpiry: { lt: now } },
            { status: SessionStatus.EXPIRED },
            { status: SessionStatus.REVOKED }
          ]
        }
      });

      if (expiredSessions.length > 0) {
        // Delete expired sessions
        const deleteResult = await prisma.userSession.deleteMany({
          where: {
            OR: [
              { refreshTokenExpiry: { lt: now } },
              { status: SessionStatus.EXPIRED },
              { status: SessionStatus.REVOKED }
            ]
          }
        });

        console.log(`  ✅ Cleaned up ${deleteResult.count} expired sessions`);
      } else {
        console.log('  ✅ No expired sessions found');
      }
    } catch (error) {
      console.error('  ❌ Failed to clean up expired sessions:', error);
      // Don't throw - this is not critical
    }

    // Release-management system data (TICKET_TYPE lookups, xyne_release_specs_form,
    // per-board form mappings) now lives in `scripts/release-manager/seed-release.ts` — run that
    // separately after this ACL seed.

    // Step 7: Verify setup
    console.log('\n🔍 Verifying ACL setup...');
    
    // Verify resources
    const resourceCount = await prisma.resource.count();
    console.log(`  📦 Total resources: ${resourceCount}`);
    
    // Verify user groups
    const groupCount = await prisma.userGroup.count();
    console.log(`  👥 Total user groups: ${groupCount}`);
    
    // Verify permissions
    const permissionCount = await prisma.resourceAccess.count();
    console.log(`  🔐 Total permissions: ${permissionCount}`);
    
    // Verify users
    const userCount = await prisma.user.count();
    console.log(`  👤 Total users: ${userCount}`);

    // Verify active sessions
    const activeSessionCount = await prisma.userSession.count({
      where: { status: SessionStatus.ACTIVE }
    });
    console.log(`  🔑 Active sessions: ${activeSessionCount}`);

    console.log('\n✅ ACL system seeding completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('  1. Admin user created with email: admin@xyne.ai');
    console.log('  2. Users need to authenticate via Google OAuth');
    console.log('  3. New users will need to be assigned to appropriate groups');
    console.log('  4. Test the /api/tickets endpoint to verify TICKETS resource access');

  } catch (error) {
    console.error('\n❌ ACL system seeding failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Execute the seeding script when run directly
main().catch((error) => {
  console.error('Seeding script failed:', error);
});

export { main as seedACLSystem };
