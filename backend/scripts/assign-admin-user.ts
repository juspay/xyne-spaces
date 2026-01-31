#!/usr/bin/env npx tsx

import { PrismaClient } from '@prisma/client';

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
    // Find ADMIN group
    const adminGroup = await prisma.userGroup.findUnique({
      where: { name: 'ADMIN' }
    });

    if (!adminGroup) {
      console.error('❌ ADMIN group not found');
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
          name: name || 'Administrator',
          authProvider: 'GOOGLE',
          providerUserId: `admin-${email.replace(/[^a-zA-Z0-9]/g, '-')}`,
          status: 'ACTIVE'
        }
      });
      console.log(`✅ Created user ${email}`);
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
    console.log('📋 ADMIN group permissions:');
    console.log('  - Full system access');
    console.log('  - Can manage all resources');
    console.log('  - ADMIN access to all modules');
    
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
