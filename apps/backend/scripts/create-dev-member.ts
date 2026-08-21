#!/usr/bin/env tsx
/// <reference types="node" />

/**
 * Add a basic MEMBER dev login (not an admin), in the Default Workspace.
 *
 * Mirrors create-dev-login.ts but with MEMBER roles and the explicit
 * grantPermissionsForRole(MEMBER) call the app uses (userController / migration),
 * so the member actually has baseline permissions rather than an empty account.
 *
 * The password lives on OrgMember.passwordHash (EMAIL auth), so a password login works.
 *
 * Usage:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/create-dev-member.ts --email=someone@example.com
 *
 * Password is always "12345678" (dev only). Override with --password=… if needed.
 */

const DEV_PASSWORD = '12345678';

import { PrismaClient } from '@prisma/client';
import { AuthProvider, UserStatus, WorkspaceRole, OrgRole } from '@xyne/shared';
import { hashPassword } from '../src/utils/passwordUtils';
import { grantPermissionsForRole } from '../src/services/permissionMatrix';
import { runAsServiceActor } from '../src/database/tenant/context';

const prisma = new PrismaClient();
const WORKSPACE_NAME = 'Default Workspace';

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const email = (flag('email') || args.find((a) => !a.startsWith('--')) || '').trim();
  const password = flag('password') || DEV_PASSWORD;
  if (!email) {
    console.error('❌ Usage: tsx scripts/create-dev-member.ts --email=someone@example.com   (password defaults to 12345678)');
    process.exitCode = 1;
    return;
  }

  const workspace = await prisma.workspace.findFirst({ where: { name: WORKSPACE_NAME }, select: { id: true } });
  if (!workspace) {
    console.error(`❌ "${WORKSPACE_NAME}" not found — seed the workspace first.`);
    process.exitCode = 1;
    return;
  }
  const org = await prisma.orgMember.findFirst({ select: { orgId: true } });
  if (!org) { console.error('❌ No organization found.'); process.exitCode = 1; return; }

  const passwordHash = await hashPassword(password);

  // OrgMember carries the credential; role MEMBER.
  let member = await prisma.orgMember.findFirst({ where: { email }, select: { memberId: true } });
  if (member) {
    await prisma.orgMember.update({ where: { memberId: member.memberId }, data: { passwordHash, role: OrgRole.MEMBER } });
    console.log(`  ℹ️  ${email} org member already existed — updated (MEMBER, password reset)`);
  } else {
    member = await prisma.orgMember.create({
      data: { email, orgId: org.orgId, role: OrgRole.MEMBER, passwordHash },
      select: { memberId: true },
    });
    console.log(`  ✅ Created org member (MEMBER) for ${email}`);
  }

  // User is the workspace identity; role MEMBER, EMAIL auth.
  let user = await prisma.user.findFirst({ where: { email, workspaceId: workspace.id }, select: { id: true } });
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { orgMemberId: member.memberId, status: UserStatus.ACTIVE, role: WorkspaceRole.MEMBER },
    });
    console.log(`  ✅ Updated user ${email} → MEMBER`);
  } else {
    user = await prisma.user.create({
      data: {
        name: email.split('@')[0],
        email,
        authProvider: AuthProvider.EMAIL,      // EMAIL auth so the password login works
        providerUserId: `email-${email}`,
        status: UserStatus.ACTIVE,
        role: WorkspaceRole.MEMBER,
        workspaceId: workspace.id,
        orgMemberId: member.memberId,
      },
      select: { id: true },
    });
    console.log(`  ✅ Created user (MEMBER) ${email}`);
  }

  // Baseline MEMBER permissions — same call the app makes for a new member.
  await runAsServiceActor(user.id, workspace.id, () =>
    grantPermissionsForRole(user!.id, email, WorkspaceRole.MEMBER, workspace.id),
  );
  console.log('  ✅ Granted MEMBER permissions');

  console.log(`\n  🔐 Sign in as ${email} / ${password} (basic member — not an admin).\n`);
}

main()
  .catch((error) => {
    console.error('❌ Failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
