#!/usr/bin/env npx tsx

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function assignUserToGroup() {
  const email = process.argv[2];

  if (!email) {
    console.error('❌ Please provide user email as argument');
    console.log('Usage: npx tsx scripts/assign-user-group.ts <user-email>');
    process.exit(1);
  }

  console.log(`🔧 Assigning ${email} to DEVELOPER group...`);

  try {
    // Find DEVELOPER group
    const developerGroup = await prisma.userGroup.findUnique({
      where: { name: 'DEVELOPER' }
    });

    if (!developerGroup) {
      console.error('❌ DEVELOPER group not found');
      return;
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      console.log(`👤 User ${email} not found, creating new user...`);

      // Extract name from email
      const emailUser = email.split('@')[0];
      const name = emailUser.split('.').map(part =>
        part.charAt(0).toUpperCase() + part.slice(1)
      ).join(' ');

      user = await prisma.user.create({
        data: {
          email,
          name: name || 'Developer',
          authProvider: 'GOOGLE',
          providerUserId: `dev-${email.replace(/[^a-zA-Z0-9]/g, '-')}`,
          status: 'ACTIVE'
        }
      });
      console.log(`✅ Created user ${email}`);
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
