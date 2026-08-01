#!/usr/bin/env tsx
/// <reference types="node" />

/**
 * Add an extra local login, on top of the seeded default admin.
 *
 * `seed-acl.ts` always creates admin@xyne.ai / xynelocal@123. This script does not
 * touch that account — it adds a second one so a developer can sign in as
 * themselves while the documented default keeps working.
 *
 * The password lives on OrgMember.passwordHash, not on User, which is why this
 * creates both rows rather than just a User.
 *
 * Usage:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/create-dev-login.ts <email> <password>
 *   DEV_LOGIN_EMAIL=… DEV_LOGIN_PASSWORD=… pnpm exec tsx scripts/create-dev-login.ts
 *
 * Re-running with the same email resets that account's password rather than failing.
 */

import { PrismaClient, AuthProvider, UserStatus, WorkspaceRole } from '@prisma/client';
import { hashPassword } from '../src/utils/passwordUtils';

const prisma = new PrismaClient();

const DEFAULT_ORG_ID = 'xyne-default-org';
const DEFAULT_WORKSPACE_NAME = 'Default Workspace';

async function main() {
  const email = (process.argv[2] || process.env.DEV_LOGIN_EMAIL || '').trim();
  const password = process.argv[3] || process.env.DEV_LOGIN_PASSWORD || '';

  if (!email || !password) {
    console.error('❌ Need an email and a password.');
    console.error('   Usage: tsx scripts/create-dev-login.ts <email> <password>');
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error('❌ Password must be at least 8 characters.');
    process.exitCode = 1;
    return;
  }

  const workspace = await prisma.workspace.findFirst({
    where: { name: DEFAULT_WORKSPACE_NAME },
    select: { id: true },
  });
  if (!workspace) {
    console.error(`❌ "${DEFAULT_WORKSPACE_NAME}" not found — run scripts/seed-acl.ts first.`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);

  // OrgMember carries the credential; User is the workspace identity.
  const existingMember = await prisma.orgMember.findFirst({
    where: { email, orgId: DEFAULT_ORG_ID },
    select: { memberId: true },
  });

  let memberId: string;
  if (existingMember) {
    await prisma.orgMember.update({
      where: { memberId: existingMember.memberId },
      data: { passwordHash },
    });
    memberId = existingMember.memberId;
    console.log(`  ✅ Reset the password for ${email}`);
  } else {
    const member = await prisma.orgMember.create({
      data: { email, orgId: DEFAULT_ORG_ID, role: 'OWNER', passwordHash },
      select: { memberId: true },
    });
    memberId = member.memberId;
    console.log(`  ✅ Created org member for ${email}`);
  }

  const existingUser = await prisma.user.findFirst({
    where: { email, workspaceId: workspace.id },
    select: { id: true },
  });

  if (existingUser) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { orgMemberId: memberId, status: UserStatus.ACTIVE, role: WorkspaceRole.ADMIN },
    });
    console.log(`  ✅ Updated existing user ${email}`);
  } else {
    await prisma.user.create({
      data: {
        name: email.split('@')[0],
        email,
        authProvider: AuthProvider.EMAIL,
        providerUserId: `email-dev-login-${memberId}`,
        status: UserStatus.ACTIVE,
        role: WorkspaceRole.ADMIN,
        workspaceId: workspace.id,
        orgMemberId: memberId,
      },
    });
    console.log(`  ✅ Created user ${email}`);
  }

  // Mirror the default admin's group membership so permissions match.
  const adminGroup = await prisma.userGroup.findUnique({
    where: { workspaceId_name: { workspaceId: workspace.id, name: 'ADMIN' } },
    select: { id: true },
  });
  if (adminGroup) {
    const user = await prisma.user.findFirst({
      where: { email, workspaceId: workspace.id },
      select: { id: true },
    });
    if (user) {
      const mapped = await prisma.userGroupMapping.findFirst({
        where: { userId: user.id, userGroupId: adminGroup.id },
        select: { id: true },
      });
      if (!mapped) {
        await prisma.userGroupMapping.create({
          data: { userId: user.id, userGroupId: adminGroup.id },
        });
        console.log('  ✅ Added to the ADMIN group');
      }
    }
  }

  console.log(`\n  🔐 You can now sign in as ${email}`);
  console.log('     The default admin@xyne.ai / xynelocal@123 login still works.\n');
}

main()
  .catch((error) => {
    console.error('❌ Failed to create the login:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
