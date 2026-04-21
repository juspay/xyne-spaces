#!/usr/bin/env npx tsx

import { PrismaClient, AccessType, WorkspaceRole } from '@prisma/client';

const prisma = new PrismaClient();

async function assignUserToGroup() {
  const email = process.argv[2] || process.env.DEFAULT_ADMIN_EMAIL;

  if (!email) {
    console.error('❌ Please provide user email as argument or set DEFAULT_ADMIN_EMAIL in .env.local');
    console.log('Usage: npx tsx scripts/assign-admin-user.ts <user-email>');
    console.log('   OR: Set DEFAULT_ADMIN_EMAIL in .env.local and run without arguments');
    process.exit(1);
  }

  console.log(`🔧 Assigning ${email} to ADMIN group...`);

  try {
    // Find default workspace first
    const defaultWorkspace = await prisma.workspace.findFirst({
      where: { name: 'Default Workspace' }
    });

    if (!defaultWorkspace) {
      console.error('❌ Default Workspace not found. Please run seed-acl.ts first.');
      return;
    }

    // Find ADMIN group in the default workspace
    const adminGroup = await prisma.userGroup.findUnique({
      where: {
        workspaceId_name: {
          workspaceId: defaultWorkspace.id,
          name: 'ADMIN'
        }
      }
    });

    if (!adminGroup) {
      console.error('❌ ADMIN group not found in default workspace');
      return;
    }

    // Find or create user in default workspace
    let user = await prisma.user.findUnique({
      where: {
        email_workspaceId: {
          email,
          workspaceId: defaultWorkspace.id
        }
      } 
    });

    if (!user) {
      console.log(`👤 User ${email} not found in default workspace, creating new user...`); 

      // Extract name from email
      const emailUser = email.split('@')[0];
      const name = emailUser.split('.').map(part =>
        part.charAt(0).toUpperCase() + part.slice(1)
      ).join(' ');

      user = await prisma.user.create({
        data: {
          email,
          name: name || 'Administrator',
          authProvider: 'GOOGLE',
          providerUserId: `admin-${email.replace(/[^a-zA-Z0-9]/g, '-')}`,
          status: 'ACTIVE',
          workspaceId: defaultWorkspace.id,
          role: WorkspaceRole.ADMIN,
        }
      });
      console.log(`✅ Created user ${email} in default workspace`);
    }

    // Ensure user is linked to ADMIN group via UserGroupMapping
    const existingMapping = await prisma.userGroupMapping.findUnique({
      where: {
        userId_userGroupId: {
          userId: user.id,
          userGroupId: adminGroup.id
        }
      }
    });

    if (!existingMapping) {
      await prisma.userGroupMapping.create({
        data: {
          userId: user.id,
          userGroupId: adminGroup.id
        }
      });
      console.log(`✅ Linked user ${user.email} to ADMIN group`);
    } else {
      console.log(`✅ User ${user.email} already in ADMIN group`);
    }

    // Grant direct ADMIN access to ALL resources for this user (required for User Management admin checks)
    console.log('\n🔐 Granting direct ADMIN access to all resources...');
    const allResources = await prisma.resource.findMany();
    let grantedCount = 0;

    for (const resource of allResources) {
      // Check if direct permission already exists
      const existingDirectPermission = await prisma.resourceAccess.findFirst({
        where: {
          userId: user.id,
          resourceId: resource.id,
          accessType: AccessType.ADMIN,
        },
      });

      if (!existingDirectPermission) {
        await prisma.resourceAccess.create({
          data: {
            userId: user.id,
            resourceId: resource.id,
            accessType: AccessType.ADMIN,
          },
        });
        grantedCount++;
        console.log(`  ✅ Granted ADMIN access: ${resource.name}`);
      }
    }

    if (grantedCount === 0) {
      console.log('  ✅ Direct ADMIN access already exists for all resources');
    } else {
      console.log(`  ✅ Granted direct ADMIN access to ${grantedCount} resources`);
    }

    console.log('\n📋 Admin user permissions:');
    console.log('  - Full system access via ADMIN group');
    console.log('  - Direct ADMIN access to all resources (for ACL checks)');
    console.log('  - Can grant/modify/revoke resource access for other users');

  } catch (error) {
    console.error('❌ Error assigning user to group:', error);
  } finally {
    await prisma.$disconnect();
  }
}

assignUserToGroup()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
