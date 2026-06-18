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

      // Find or create OrgMember (required for User.orgMemberId)
      let orgMember = await prisma.orgMember.findUnique({
        where: { email }
      });

      if (!orgMember) {
        orgMember = await prisma.orgMember.create({
          data: {
            email,
            orgId: 'xyne-default-org',
            role: 'OWNER',
            joinedAt: new Date(),
          }
        });
      }

      user = await prisma.user.create({
        data: {
          email,
          name: name || 'Administrator',
          authProvider: 'GOOGLE',
          providerUserId: `admin-${email.replace(/[^a-zA-Z0-9]/g, '-')}`,
          status: 'ACTIVE',
          role: WorkspaceRole.ADMIN,
          workspace: {
            connect: { id: defaultWorkspace.id }
          },
          orgMember: {
            connect: { memberId: orgMember.memberId }
          },
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
    const allResources = await prisma.resource.findMany();
    const adminResources = allResources.filter(r => r.accessType === AccessType.ADMIN);
    
    for (const resource of adminResources) {
      const existingAccess = await prisma.resourceAccess.findUnique({
        where: {
          userId_resourceId: {
            userId: user.id,
            resourceId: resource.id
          }
        }
      });

      if (!existingAccess) {
        await prisma.resourceAccess.create({
          data: {
            userId: user.id,
            resourceId: resource.id,
            accessType: AccessType.ADMIN
          }
        });
        console.log(`✅ Granted ADMIN access to resource: ${resource.name}`);
      }
    }

    console.log(`🎉 User ${user.email} successfully assigned to ADMIN group with full admin access!`);
    console.log(`📋 Details:`);
    console.log(`   • User ID: ${user.id}`);
    console.log(`   • Workspace: ${defaultWorkspace.name} (${defaultWorkspace.id})`);
    console.log(`   • Role: ${user.role}`);
    console.log(`   • Group: ${adminGroup.name} (${adminGroup.id})`);

  } catch (error) {
    console.error('❌ Error assigning user to group:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

assignUserToGroup();
