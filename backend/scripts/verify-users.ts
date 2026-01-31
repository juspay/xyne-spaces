#!/usr/bin/env npx tsx

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Verifying users in database...\n');

  const totalUsers = await prisma.user.count();
  console.log(`📊 Total users in database: ${totalUsers}\n`);

  const recentUsers = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
    }
  });

  console.log('📋 Recent users (last 25):');
  console.log('─'.repeat(80));
  recentUsers.forEach((user, idx) => {
    console.log(`${idx + 1}. ${user.name.padEnd(25)} | ${user.email}`);
  });
  console.log('─'.repeat(80));

  await prisma.$disconnect();
}

main().catch(console.error);
