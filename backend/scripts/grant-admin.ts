#!/usr/bin/env npx tsx

import { PrismaClient, AccessType, WorkspaceRole, AuthProvider, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function grantAdmin() {
  const email = process.argv[2];

  if (!email) {
    console.error('❌ Please provide user email as argument');
    console.log('Usage: npx tsx scripts/grant-admin.ts <user-email>');
    process.exit(1);
  }

  console.log(`🔧 Granting admin access to ${email}...`);

  try {
    const defaultWorkspace = await prisma.workspace.findFirst({
      where: { name: 'Default Workspace' }
    });

    if (!defaultWorkspace) {
      console.error('❌ Default Workspace not found. Run seed-acl.ts first.');
      return;
    }

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

    const defaultOrg = await prisma.organization.findFirst({
      where: { orgId: 'xyne-default-org' }
    });

    let user = await prisma.user.findUnique({
      where: {
        email_workspaceId: {
          email,
          workspaceId: defaultWorkspace.id
        }
      }
    });

    if (!user) {
      console.log(`👤 User ${email} not found, creating...`);

      let orgMemberId: string | undefined;
      if (defaultOrg) {
        const orgMember = await prisma.orgMember.create({
          data: {
            email,
            orgId: defaultOrg.orgId,
            role: 'OWNER',
          }
        });
        orgMemberId = orgMember.memberId;
      }

      const emailUser = email.split('@')[0];
      const name = emailUser.split(/[.\-_]/).map(part =>
        part.charAt(0).toUpperCase() + part.slice(1)
      ).join(' ');

      user = await prisma.user.create({
        data: {
          email,
          name: name || 'Administrator',
          authProvider: AuthProvider.GOOGLE,
          providerUserId: `admin-${email.replace(/[^a-zA-Z0-9]/g, '-')}`,
          status: UserStatus.ACTIVE,
          workspaceId: defaultWorkspace.id,
          role: WorkspaceRole.ADMIN,
          ...(orgMemberId ? { orgMemberId } : {}),
        }
      });
      console.log(`✅ Created user ${email} with ADMIN role`);
    } else {
      if (user.role !== WorkspaceRole.ADMIN) {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: WorkspaceRole.ADMIN }
        });
        console.log(`✅ Upgraded user role to ADMIN`);
      }
    }

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
      console.log('✅ Added to ADMIN group');
    } else {
      console.log('✅ Already in ADMIN group');
    }

    console.log('\n🔐 Granting direct ADMIN access to all resources...');
    const allResources = await prisma.resource.findMany();
    let grantedCount = 0;

    for (const resource of allResources) {
      const existingPermission = await prisma.resourceAccess.findFirst({
        where: {
          userId: user.id,
          resourceId: resource.id,
          accessType: AccessType.ADMIN,
        },
      });

      if (!existingPermission) {
        await prisma.resourceAccess.create({
          data: {
            userId: user.id,
            resourceId: resource.id,
            accessType: AccessType.ADMIN,
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

    if (defaultOrg) {
      const existingOrgMember = await prisma.orgMember.findFirst({
        where: {
          email,
          orgId: defaultOrg.orgId
        }
      });

      if (!existingOrgMember) {
        await prisma.orgMember.create({
          data: {
            email,
            orgId: defaultOrg.orgId,
            role: 'OWNER',
          }
        });
        console.log('✅ Added to organization as OWNER');
      }
    }

    console.log(`\n✅ ${email} now has full admin access`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

grantAdmin()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
