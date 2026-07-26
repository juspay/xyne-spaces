#!/usr/bin/env npx tsx

import { PrismaClient, WorkspaceRole } from '@prisma/client';
import { hashPassword } from '../src/utils/passwordUtils';

const prisma = new PrismaClient();

const DEV_USER_PASSWORD = 'xynelocal@123';

async function assignUserToGroup() {
  const email = process.argv[2] || process.env.DEFAULT_ADMIN_EMAIL || 'admin@xyne.ai';

  if (!email) {
    console.error('❌ Please provide user email as argument or set DEFAULT_ADMIN_EMAIL env var');
    console.log('Usage: npx tsx scripts/assign-user-group.ts <user-email>');
    process.exit(1);
  }

  console.log(`🔧 Assigning ${email} to DEVELOPER group...`);

  try {
    // Find default workspace first
    const defaultWorkspace = await prisma.workspace.findFirst({
      where: { name: 'Default Workspace' }
    });

    if (!defaultWorkspace) {
      console.error('❌ Default Workspace not found. Please run seed-acl.ts first.');
      return;
    }

    // Find DEVELOPER group in the default workspace
    const developerGroup = await prisma.userGroup.findUnique({
      where: {
        workspaceId_name: {
          workspaceId: defaultWorkspace.id,
          name: 'DEVELOPER'
        }
      }
    });

    if (!developerGroup) {
      console.error('❌ DEVELOPER group not found in default workspace');
      return;
    }

    // Find or create user
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

      // Create orgMember with password for email/password login
      const passwordHash = await hashPassword(DEV_USER_PASSWORD);
      const orgMember = await prisma.orgMember.create({
        data: {
          email,
          orgId: defaultWorkspace.orgId,
          role: 'MEMBER',
          passwordHash,
        }
      });
      console.log(`✅ Created orgMember with password for ${email}`);

      user = await prisma.user.create({
        data: {
          email,
          name: name || 'Developer',
          authProvider: 'GOOGLE',
          providerUserId: `dev-${email.replace(/[^a-zA-Z0-9]/g, '-')}`,
          status: 'ACTIVE',
          workspaceId: defaultWorkspace.id,
          role: WorkspaceRole.MEMBER,
          orgMemberId: orgMember.memberId,
        }
      });
      console.log(`✅ Created user ${email} in default workspace`);
      console.log(`ℹ️  Dev login: ${email} / ${DEV_USER_PASSWORD}`);
    }

    // Ensure user is linked to DEVELOPER group via UserGroupMapping
    const existingMapping = await prisma.userGroupMapping.findUnique({
      where: {
        userId_userGroupId: {
          userId: user.id,
          userGroupId: developerGroup.id
        }
      }
    });

    if (!existingMapping) {
      await prisma.userGroupMapping.create({
        data: {
          userId: user.id,
          userGroupId: developerGroup.id
        }
      });
      console.log(`✅ Linked user ${user.email} to DEVELOPER group`);
    } else {
      console.log(`✅ User ${user.email} already in DEVELOPER group`);
    }
    console.log('📋 DEVELOPER group permissions:');
    console.log('  - TICKETS: WRITE access');
    console.log('  - WORKFLOWS: WRITE access');  
    console.log('  - AGENTS: WRITE access');
    console.log('  - TOOLS: READ access');
    console.log('  - MODELS: READ access');
    console.log('  - ANALYTICS: READ access');
    console.log('  - HEALTH: READ access');
    console.log('  - AUTH: READ access');
    
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
