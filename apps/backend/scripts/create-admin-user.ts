#!/usr/bin/env npx tsx

import { PrismaClient } from '@prisma/client';
import { AccessType, WorkspaceRole, AuthProvider, UserStatus, OrgRole } from '@xyne/shared';

const prisma = new PrismaClient();

async function createAdminUser() {
  if (process.env.NODE_ENV !== 'development') {
    console.error('❌ This script is only allowed when NODE_ENV=development');
    process.exit(1);
  }

  const email = process.argv[2] || process.env.DEFAULT_ADMIN_EMAIL;

  if (!email) {
    console.error('❌ Please provide user email as argument or set DEFAULT_ADMIN_EMAIL in .env.local');
    console.log('Usage: npx tsx scripts/create-admin-user.ts <user-email>');
    process.exit(1);
  }

  console.log(`🔧 Creating admin user: ${email}...`);

  try {
    const defaultWorkspace = await prisma.workspace.findFirst({
      where: { name: 'Default Workspace' },
    });

    if (!defaultWorkspace) {
      console.error('❌ Default Workspace not found. Run seed-acl.ts first.');
      process.exit(1);
    }

    const defaultOrg = await prisma.organization.findFirst({
      where: { orgId: 'xyne-default-org' },
    });

    if (!defaultOrg) {
      console.error('❌ Default Organization not found. Run seed-acl.ts first.');
      process.exit(1);
    }

    const adminGroup = await prisma.userGroup.findUnique({
      where: {
        workspaceId_name: {
          workspaceId: defaultWorkspace.id,
          name: 'ADMIN',
        },
      },
    });

    if (!adminGroup) {
      console.error('❌ ADMIN group not found in default workspace. Run seed-acl.ts first.');
      process.exit(1);
    }

    // Find or create OrgMember
    let orgMember = await prisma.orgMember.findFirst({
      where: { email, orgId: defaultOrg.orgId },
    });

    if (!orgMember) {
      orgMember = await prisma.orgMember.create({
        data: {
          email,
          orgId: defaultOrg.orgId,
          role: OrgRole.OWNER,
        },
      });
      console.log('✅ Created OrgMember as OWNER');
    } else {
      console.log('✅ OrgMember already exists');
    }

    // Find or create User
    let user = await prisma.user.findUnique({
      where: {
        email_workspaceId: {
          email,
          workspaceId: defaultWorkspace.id,
        },
      },
    });

    if (!user) {
      const emailUser = email.split('@')[0];
      const name = emailUser
        .split(/[.\-_]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

      user = await prisma.user.create({
        data: {
          email,
          name: name || 'Administrator',
          authProvider: AuthProvider.GOOGLE,
          providerUserId: `admin-${email.replace(/[^a-zA-Z0-9]/g, '-')}`,
          status: UserStatus.ACTIVE,
          workspaceId: defaultWorkspace.id,
          role: WorkspaceRole.ADMIN,
          orgMemberId: orgMember.memberId,
        },
      });
      console.log(`✅ Created user: ${user.name} (${email})`);
    } else {
      if (user.role !== WorkspaceRole.ADMIN) {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: WorkspaceRole.ADMIN },
        });
        console.log('✅ Upgraded existing user role to ADMIN');
      } else {
        console.log('✅ User already exists with ADMIN role');
      }
    }

    // Add to ADMIN user group
    const existingMapping = await prisma.userGroupMapping.findUnique({
      where: {
        userId_userGroupId: {
          userId: user.id,
          userGroupId: adminGroup.id,
        },
      },
    });

    if (!existingMapping) {
      await prisma.userGroupMapping.create({
        data: {
          userId: user.id,
          userGroupId: adminGroup.id,
          workspaceId: defaultWorkspace.id,
        },
      });
      console.log('✅ Added to ADMIN group');
    } else {
      console.log('✅ Already in ADMIN group');
    }

    // Ensure local admin-surface resources exist before granting ADMIN access.
    // Older local DBs may predate these resources.
    const requiredResources = [
      {
        name: 'USER-MANAGEMENT',
        description: 'User and user-group administration endpoints (/api/user-management/*)',
      },
      {
        name: 'USER-GROUPS',
        description: 'User Groups dashboard access and group visibility management',
      },
    ];
    for (const resource of requiredResources) {
      await prisma.resource.upsert({
        where: { name: resource.name },
        update: {},
        create: resource,
      });
    }

    // Grant direct ADMIN access to all resources
    console.log('\n🔐 Granting direct ADMIN access to all resources...');
    const allResources = await prisma.resource.findMany();
    let grantedCount = 0;

    for (const resource of allResources) {
      const existing = await prisma.resourceAccess.findFirst({
        where: {
          userId: user.id,
          resourceId: resource.id,
          accessType: AccessType.ADMIN,
        },
      });

      if (!existing) {
        await prisma.resourceAccess.create({
          data: {
            userId: user.id,
            resourceId: resource.id,
            accessType: AccessType.ADMIN,
            workspaceId: defaultWorkspace.id,
          },
        });
        grantedCount++;
        console.log(`  ✅ ${resource.name}`);
      }
    }

    if (grantedCount === 0) {
      console.log('  ✅ Already has ADMIN access to all resources');
    } else {
      console.log(`  ✅ Granted ADMIN access to ${grantedCount} resources`);
    }

    console.log(`\n✅ Done! ${email} has full admin access in Default Workspace`);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createAdminUser()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
