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
  AccessType,
  AuthProvider,
  UserStatus,
  SessionStatus,
  WorkspaceRole,
  ProjectType,
  OrgRole,
  UserType,
} from '@xyne/shared';
import { runAsSystem } from '../src/database/tenant/context';
import { hashPassword } from '../src/utils/passwordUtils';
import { vespaQueue } from '../src/queues/vespaQueue';

const prisma = new PrismaClient();

// Essential resources that the application needs
const ESSENTIAL_RESOURCES = [
  { name: 'TICKETS', description: 'Ticket management endpoints (/api/tickets/*)' },
  { name: 'USERS', description: 'User management endpoints (/api/users/*)' },
  { name: 'USER-MANAGEMENT', description: 'User and user-group administration endpoints (/api/user-management/*)' },
  { name: 'USER-GROUPS', description: 'User Groups dashboard access and group visibility management' },
  { name: 'WORKFLOWS', description: 'Workflow management endpoints (/api/workflows/*)' },
  { name: 'AGENTS', description: 'Agent management endpoints (/api/agents/*)' },
  { name: 'TOOLS', description: 'Tool management endpoints (/api/tools/*)' },
  { name: 'MODELS', description: 'Model management endpoints (/api/models/*)' },
  { name: 'ANALYTICS', description: 'Analytics endpoints (/api/analytics/*)' },
  { name: 'HEALTH', description: 'Health check endpoints (/api/health/*)' },
  { name: 'AUTH', description: 'Authentication endpoints (/api/auth/*)' },
  { name: 'FORMS', description: 'Form management and submission access' },
  { name: 'SUPPORT', description: 'Support ticket and help desk access' },
  { name: 'PROJECTS', description: 'Project management access' },
  { name: 'PRODUCT-INSIGHTS', description: 'Product insights and analytics access' },
  { name: 'LISTPROJECTS', description: 'Project listing and management access' },
  { name: 'CHANNELS', description: 'Read only will not allow to create channel' },
  { name: 'CANVASES', description: 'Canvases creation access' },
  { name: 'DATA_SOURCES', description: 'Dynamic dashboard data source connect + introspection (/api/data-sources/*)' },
  { name: 'DASHBOARDS', description: 'Dynamic dashboard feature gate — create/view/share dashboards' },
  { name: 'WORKSPACE', description: 'Workspace management access' },
  { name: 'ORGANIZATIONS', description: 'Organization management access' },
  { name: 'TICKET-MIGRATION', description: 'Admin access to Jira and ticket migration workflows'},
  { name: 'XYNE-APPS', description: 'Admin access to Xyne Apps management (webhooks, bot configuration, signing secrets)'},
  { name: 'ROLES', description: 'Role creation and management UI' },
  { name: 'SDLC', description: 'SDLC fast-lane surface access (/sdlc, /api/sdlc/*)' },
  {
    name: 'AUTOMATIONS',
    description:
      'Automation approval and on/off control (/api/automations/*). ADMIN access lets a user approve/reject proposals and toggle live automations on/off.',
  },
  {
    name: 'VESPA',
    description:
      'Vespa backfill / reindex admin endpoints (/api/admin/vespa-backfill/*, /api/migration/vespa-workspace-backfill/*). WRITE or ADMIN access lets a user trigger and manage backfill jobs.',
  },
  {
    name: 'RELEASE-MANAGER',
    description:
      'Release-config edit access (/api/commits/analyze/*, save release config). Admins/owners have it by role; grant to other users to let them edit without admin privilege.',
  },
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
      { resourceName: 'FORMS', accessType: AccessType.WRITE },
      { resourceName: 'SUPPORT', accessType: AccessType.WRITE },
      { resourceName: 'PROJECTS', accessType: AccessType.WRITE },
      { resourceName: 'PRODUCT-INSIGHTS', accessType: AccessType.READ },
      { resourceName: 'LISTPROJECTS', accessType: AccessType.READ },
      { resourceName: 'CHANNELS', accessType: AccessType.WRITE },
      { resourceName: 'CANVASES', accessType: AccessType.WRITE },
      { resourceName: 'DATA_SOURCES', accessType: AccessType.WRITE },
      { resourceName: 'DASHBOARDS', accessType: AccessType.WRITE },
      { resourceName: 'WORKSPACE', accessType: AccessType.WRITE },
      { resourceName: 'ORGANIZATIONS', accessType: AccessType.READ },
      { resourceName: 'AUTOMATIONS', accessType: AccessType.WRITE },
      { resourceName: 'SDLC', accessType: AccessType.WRITE },
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
      { resourceName: 'FORMS', accessType: AccessType.READ },
      { resourceName: 'SUPPORT', accessType: AccessType.READ },
      { resourceName: 'PROJECTS', accessType: AccessType.READ },
      { resourceName: 'PRODUCT-INSIGHTS', accessType: AccessType.READ },
      { resourceName: 'LISTPROJECTS', accessType: AccessType.READ },
      { resourceName: 'CHANNELS', accessType: AccessType.READ },
      { resourceName: 'CANVASES', accessType: AccessType.READ },
      { resourceName: 'DATA_SOURCES', accessType: AccessType.READ },
      { resourceName: 'DASHBOARDS', accessType: AccessType.READ },
      { resourceName: 'WORKSPACE', accessType: AccessType.READ },
      { resourceName: 'AUTOMATIONS', accessType: AccessType.READ },
      { resourceName: 'SDLC', accessType: AccessType.READ },
    ]
  }
];

// Default admin user configuration
const DEFAULT_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || 'admin@xyne.ai';
const DEFAULT_ADMIN_USER = {
  name: DEFAULT_ADMIN_EMAIL.split('@')[0],
  email: DEFAULT_ADMIN_EMAIL,
  authProvider: AuthProvider.EMAIL,
  providerUserId: `email-${DEFAULT_ADMIN_EMAIL}`,
  status: UserStatus.ACTIVE,
  role: WorkspaceRole.ADMIN,
};

// Default password for the admin user in local dev (meets complexity requirements)
const DEV_ADMIN_PASSWORD = 'xynelocal@123';

// Default organization and workspace
const DEFAULT_ORG = {
  name: 'Xyne Default',
  orgId: 'xyne-default-org',
  createdBy: 'system-seed',
};

const DEFAULT_WORKSPACE = {
  name: 'Default Workspace',
  createdBy: 'system-seed',
}; 

async function main() {
  console.log('🚀 Starting ACL system seeding...');

  await vespaQueue.initialize();

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

    // Step 2: Create default organization and workspace (must be before user groups)
    console.log('\n🏢 Creating default organization and workspace...');
    let defaultWorkspaceId: string;
    try {
      // Check if default org exists
      let defaultOrg = await prisma.organization.findFirst({
        where: { orgId: DEFAULT_ORG.orgId }
      });

      if (!defaultOrg) {
        defaultOrg = await prisma.organization.create({
          data: DEFAULT_ORG
        });
        console.log('  ✅ Created default organization');
      } else {
        console.log('  ✅ Default organization already exists');
      }

      // Check if default workspace exists
      let defaultWorkspace = await prisma.workspace.findFirst({
        where: { name: DEFAULT_WORKSPACE.name, orgId: defaultOrg.orgId }
      });

      if (!defaultWorkspace) {
        defaultWorkspace = await prisma.workspace.create({
          data: {
            name: DEFAULT_WORKSPACE.name,
            orgId: defaultOrg.orgId,
            createdBy: DEFAULT_WORKSPACE.createdBy,
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
            createdBy: DEFAULT_WORKSPACE.createdBy,
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

    // Step 3: Create default user groups (requires workspace)
    console.log('\n👥 Creating default user groups...');
    const createdGroups = new Map<string, string>();

    for (const groupData of DEFAULT_USER_GROUPS) {
      try {
        // Check if group already exists in this workspace
        let group = await prisma.userGroup.findFirst({
          where: { name: groupData.name, workspaceId: defaultWorkspaceId }
        });

        if (group) {
          console.log(`  ✅ User group ${groupData.name} already exists`);
          createdGroups.set(groupData.name, group.id);
        } else {
          // Create new group with workspaceId
          group = await repositories.userGroups.create({
            name: groupData.name,
            description: groupData.description,
            workspaceId: defaultWorkspaceId,
          });
          createdGroups.set(groupData.name, group.id);
          console.log(`  ✅ Created user group: ${groupData.name}`);
        }

        // Step 4: Set up permissions for each group
        if (!group) {
          console.error(`  ❌ Group ${groupData.name} not found, skipping permissions`);
          continue;
        }

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
              accessType: permission.accessType,
              workspaceId: defaultWorkspaceId
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
    try {
      // Check if default org exists
      let defaultOrg = await prisma.organization.findFirst({
        where: { orgId: DEFAULT_ORG.orgId }
      });

      if (!defaultOrg) {
        defaultOrg = await prisma.organization.create({
          data: DEFAULT_ORG
        });
        console.log('  ✅ Created default organization');
      } else {
        console.log('  ✅ Default organization already exists');
      }

      // Check if default workspace exists
      let defaultWorkspace = await prisma.workspace.findFirst({
        where: { name: DEFAULT_WORKSPACE.name, orgId: defaultOrg.orgId }
      });

      if (!defaultWorkspace) {
        defaultWorkspace = await prisma.workspace.create({
          data: {
            name: DEFAULT_WORKSPACE.name,
            orgId: defaultOrg.orgId,
            createdBy: DEFAULT_WORKSPACE.createdBy,
            workspaceType: WorkspaceType.ENTERPRISE,
            joinPolicy: WorkspaceJoinPolicy.INVITE_ONLY,
          }
        });
        console.log('  ✅ Created default workspace');
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
      // Get admin group ID
      const adminGroupId = createdGroups.get('ADMIN');
      if (!adminGroupId) {
        throw new Error('ADMIN group not found');
      }

      // Check if admin user already exists in the default workspace
      let adminUser = await repositories.users.findByEmail(DEFAULT_ADMIN_USER.email, defaultWorkspaceId);

      if (adminUser) {
        console.log('  ✅ Default admin user already exists');
      } else {
        // Create orgMember FIRST to get memberId
        const passwordHash = await hashPassword(DEV_ADMIN_PASSWORD);
        const orgMember = await prisma.orgMember.create({
          data: {
            email: DEFAULT_ADMIN_USER.email,
            orgId: DEFAULT_ORG.orgId,
            role: OrgRole.OWNER,
            passwordHash,
          }
        });
        console.log(`  ✅ Created orgMember with id: ${orgMember.memberId}`);
        console.log(`  ℹ️  Admin login: ${DEFAULT_ADMIN_USER.email} / ${DEV_ADMIN_PASSWORD}`);

        // Create admin user with workspaceId and orgMemberId
        adminUser = await repositories.users.create({
          ...DEFAULT_ADMIN_USER,
          workspaceId: defaultWorkspaceId,
          orgMemberId: orgMember.memberId,
        });
        console.log(`  ✅ Created default admin user: ${DEFAULT_ADMIN_USER.email}`);
      }

      // Ensure admin user is in ADMIN group via UserGroupMapping
      const existingMapping = await prisma.userGroupMapping.findUnique({
        where: {
          userId_userGroupId: {
            userId: adminUser.id,
            userGroupId: adminGroupId
          }
        }
      });

      if (!existingMapping) {
        await prisma.userGroupMapping.create({
          data: {
            userId: adminUser.id,
            userGroupId: adminGroupId,
            workspaceId: defaultWorkspaceId
          }
        });
        console.log('  ✅ Linked admin user to ADMIN group');
      } else {
        console.log('  ✅ Admin user already linked to ADMIN group');
      }

      // Grant direct ADMIN access to ALL resources for this user (required for ACL checks)
      console.log('  🔐 Granting direct ADMIN access to all resources...');
      let grantedCount = 0;

      for (const [resourceName, resourceId] of createdResources) {
        const existingDirectPermission = await prisma.resourceAccess.findFirst({
          where: {
            userId: adminUser.id,
            resourceId: resourceId,
            accessType: AccessType.ADMIN,
          },
        });

        if (!existingDirectPermission) {
          await prisma.resourceAccess.create({
            data: {
              userId: adminUser.id,
              resourceId: resourceId,
              accessType: AccessType.ADMIN,
              workspaceId: defaultWorkspaceId,
            },
          });
          grantedCount++;
        }
      }

      if (grantedCount > 0) {
        console.log(`  ✅ Granted direct ADMIN access to ${grantedCount} resources`);
      } else {
        console.log('  ✅ Direct ADMIN access already exists for all resources');
      }

      // Ensure admin user is in OrgMember table
      const existingOrgMember = await prisma.orgMember.findFirst({
        where: {
          email: adminUser.email,
          orgId: DEFAULT_ORG.orgId
        }
      });

      if (!existingOrgMember) {
        await prisma.orgMember.create({
          data: {
            email: adminUser.email,
            orgId: DEFAULT_ORG.orgId,
            role: OrgRole.OWNER,
          }
        });
        console.log('  ✅ Linked admin user to organization as OWNER');
      } else {
        console.log('  ✅ Admin user already linked to organization');
      }
    } catch (error) {
      console.error('  ❌ Failed to create default admin user:', error);
      throw error;
    }

    // Step 5: Create DEFAULT_ADMIN_EMAIL user if set
    const defaultAdminEmail = process.env.DEFAULT_ADMIN_EMAIL;
    if (defaultAdminEmail && defaultAdminEmail !== DEFAULT_ADMIN_USER.email) {
      console.log(`\n👤 Creating DEFAULT_ADMIN_EMAIL user (${defaultAdminEmail})...`);
      try {
        // Check if user already exists in the default workspace
        let defaultAdminUser = await repositories.users.findByEmail(defaultAdminEmail, defaultWorkspaceId);

        if (defaultAdminUser) {
          console.log(`  ✅ Default admin email user already exists: ${defaultAdminEmail}`);
        } else {
          // Create orgMember FIRST to get memberId
          const orgMember = await prisma.orgMember.create({
            data: {
              email: defaultAdminEmail,
              orgId: DEFAULT_ORG.orgId,
              role: OrgRole.OWNER,
            }
          });
          console.log(`  ✅ Created orgMember with id: ${orgMember.memberId}`);

          // Create user with workspaceId and orgMemberId
          defaultAdminUser = await repositories.users.create({
            name: defaultAdminEmail.split('@')[0],
            email: defaultAdminEmail,
            authProvider: AuthProvider.GOOGLE,
            providerUserId: `admin-${Date.now()}`,
            status: UserStatus.ACTIVE,
            workspaceId: defaultWorkspaceId,
            role: WorkspaceRole.ADMIN,
            orgMemberId: orgMember.memberId,
          });
          console.log(`  ✅ Created default admin email user: ${defaultAdminEmail}`);
        }

        // Ensure user is in ADMIN group
        const adminGroupId = createdGroups.get('ADMIN');
        if (adminGroupId) {
          const existingMapping = await prisma.userGroupMapping.findUnique({
            where: {
              userId_userGroupId: {
                userId: defaultAdminUser.id,
                userGroupId: adminGroupId
              }
            }
          });

          if (!existingMapping) {
            await prisma.userGroupMapping.create({
              data: {
                userId: defaultAdminUser.id,
                userGroupId: adminGroupId,
                workspaceId: defaultWorkspaceId
              }
            });
            console.log('  ✅ Linked default admin email user to ADMIN group');
          }
        }

        // Grant direct ADMIN access to ALL resources
        console.log('  🔐 Granting direct ADMIN access to all resources...');
        let grantedCount = 0;
        for (const [resourceName, resourceId] of createdResources) {
          const existingDirectPermission = await prisma.resourceAccess.findFirst({
            where: {
              userId: defaultAdminUser.id,
              resourceId: resourceId,
              accessType: AccessType.ADMIN,
            },
          });

          if (!existingDirectPermission) {
            await prisma.resourceAccess.create({
              data: {
                userId: defaultAdminUser.id,
                resourceId: resourceId,
                accessType: AccessType.ADMIN,
                workspaceId: defaultWorkspaceId,
              },
            });
            grantedCount++;
          }
        }

        if (grantedCount > 0) {
          console.log(`  ✅ Granted direct ADMIN access to ${grantedCount} resources`);
        }

        // Ensure user is in OrgMember table
        const existingOrgMember = await prisma.orgMember.findFirst({
          where: {
            email: defaultAdminUser.email,
            orgId: DEFAULT_ORG.orgId
          }
        });

        if (!existingOrgMember) {
          await prisma.orgMember.create({
            data: {
              email: defaultAdminUser.email,
              orgId: DEFAULT_ORG.orgId,
              role: OrgRole.OWNER,
            }
          });
          console.log('  ✅ Linked default admin email user to organization as OWNER');
        }
      } catch (error) {
        console.error(`  ❌ Failed to create DEFAULT_ADMIN_EMAIL user:`, error);
        // Don't throw - this is optional
      }
    }

    // Step 6: Developer user assignment
    // Note: Developer users are assigned via assign-user-group.ts script after they log in
    console.log('\n👤 Developer users will be assigned via assign-user-group.ts script');

    // Step 7: Clean up expired user sessions
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

    // Step 8: Ensure all bot users are in OrgMember table
    console.log('\n🤖 Ensuring all bot users are in org_member table...');
    try {
      const { UserType } = await import('@xyne/shared');

      // Find all bots (using string literal since UserType enum may not be generated yet)
      const botUsers = await prisma.user.findMany({
        where: { userType: UserType.BOT }
      });

      let addedCount = 0;

      for (const botUser of botUsers) {
        // Check if bot is already in org_member
        const existingOrgMember = await prisma.orgMember.findFirst({
          where: {
            email: botUser.email,
            orgId: DEFAULT_ORG.orgId
          }
        });

        if (!existingOrgMember) {
          await prisma.orgMember.create({
            data: {
              email: botUser.email,
              orgId: DEFAULT_ORG.orgId,
              role: OrgRole.MEMBER, // Bots are regular members, not owners
            }
          });
          addedCount++;
          console.log(`    ✅ Added bot '${botUser.email}' to org_member`);
        }
      }

      if (addedCount > 0) {
        console.log(`  ✅ Added ${addedCount} bot(s) to org_member table`);
      } else {
        console.log('  ✅ All bots are already in org_member table');
      }
    } catch (error) {
      console.error('  ❌ Failed to add bots to org_member:', error);
      // Don't throw - this is not critical
    }

    // Step 9: Verify setup
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

// Execute the seeding script when run directly. Run under a system tenant context so
// audit logging works: ACLAuditLog.workspaceId is NOT NULL, and the seed creates global
// resources before any workspace exists, so logEvent has no request-scoped tenant to read.
runAsSystem(() => main())
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seeding script failed:', error);
    process.exit(1);
  });

export { main as seedACLSystem };
