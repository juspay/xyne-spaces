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

import { PrismaClient, AccessType, AuthProvider, UserStatus, SessionStatus } from '@prisma/client';
import { repositories } from '../src/database/repositories/index';

const prisma = new PrismaClient();

// Essential resources that the application needs
const ESSENTIAL_RESOURCES = [
  { name: 'TICKETS', description: 'Ticket management endpoints (/api/tickets/*)' },
  { name: 'USERS', description: 'User management endpoints (/api/users/*)' },
  { name: 'WORKFLOWS', description: 'Workflow management endpoints (/api/workflows/*)' },
  { name: 'AGENTS', description: 'Agent management endpoints (/api/agents/*)' },
  { name: 'TOOLS', description: 'Tool management endpoints (/api/tools/*)' },
  { name: 'MODELS', description: 'Model management endpoints (/api/models/*)' },
  { name: 'ANALYTICS', description: 'Analytics endpoints (/api/analytics/*)' },
  { name: 'HEALTH', description: 'Health check endpoints (/api/health/*)' },
  { name: 'AUTH', description: 'Authentication endpoints (/api/auth/*)' },
  { name: 'EXTERNAL-STEP-RESPONSE', description: 'External step response endpoints (/api/external-step-response/*)' },
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
      { resourceName: 'EXTERNAL-STEP-RESPONSE', accessType: AccessType.WRITE },
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
  authProvider: AuthProvider.GOOGLE,
  providerUserId: 'admin-seed-user-001',
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

        // Step 3: Set up permissions for each group
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

    // Step 4: Create default admin user
    console.log('\n👤 Creating default admin user...');
    try {
      // Get admin group ID
      const adminGroupId = createdGroups.get('ADMIN');
      if (!adminGroupId) {
        throw new Error('ADMIN group not found');
      }

      // Check if admin user already exists
      let adminUser = await repositories.users.findByEmail(DEFAULT_ADMIN_USER.email);

      if (adminUser) {
        console.log('  ✅ Default admin user already exists');
      } else {
        // Create admin user
        adminUser = await repositories.users.create({
          ...DEFAULT_ADMIN_USER
        });
        console.log(`  ✅ Created default admin user: ${DEFAULT_ADMIN_USER.email}`);
      }

      // Ensure admin user is in ADMIN group
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
            userGroupId: adminGroupId
          }
        });
        console.log('  ✅ Linked admin user to ADMIN group');
      } else {
        console.log('  ✅ Admin user already linked to ADMIN group');
      }
    } catch (error) {
      console.error('  ❌ Failed to create default admin user:', error);
      throw error;
    }

    // Step 5: Developer user assignment
    // Note: Developer users are assigned via assign-user-group.ts script after they log in
    console.log('\n👤 Developer users will be assigned via assign-user-group.ts script');

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
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seeding script failed:', error);
    process.exit(1);
  });

export { main as seedACLSystem };
