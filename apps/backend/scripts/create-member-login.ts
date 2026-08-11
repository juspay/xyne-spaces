#!/usr/bin/env npx tsx

import { PrismaClient } from '@prisma/client';
import { AuthProvider, OrgRole, UserStatus, WorkspaceRole } from '@xyne/shared';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../src/utils/passwordUtils';

dotenv.config({
  path: fileURLToPath(new URL('../.env.local', import.meta.url)),
  quiet: true,
});

const prisma = new PrismaClient();
const DEFAULT_WORKSPACE_NAME = 'Default Workspace';
const MEMBER_PERMISSIONS = [
  'TICKETS',
  'WORKFLOWS',
  'AGENTS',
  'MODELS',
  'TOOLS',
  'AGENT-TOOLS-MAPPINGS',
  'ANALYTICS',
  'PROJECTS',
  'XYNE-APPS',
  'CHANNELS',
  'CANVASES',
].map((resourceName) => ({ resourceName, accessType: 'WRITE' }));

function deriveName(email: string): string {
  return email
    .split('@')[0]
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function promptForPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error(
      'A password argument or MEMBER_LOGIN_PASSWORD is required in non-interactive mode.'
    );
  }

  return new Promise((resolve, reject) => {
    let password = '';

    const finish = (): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
    };
    const onData = (data: Buffer): void => {
      for (const input of data.toString('utf8')) {
        if (input === '\u0003') {
          finish();
          reject(new Error('Cancelled.'));
          return;
        }
        if (input === '\r' || input === '\n') {
          finish();
          resolve(password);
          return;
        }
        if (input === '\u007f' || input === '\b') {
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }

        password += input;
        process.stdout.write('*');
      }
    };

    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('This local-development script cannot run with NODE_ENV=production.');
  }

  const email = (process.argv[2] ?? '').trim().toLowerCase();
  let password = process.argv[3] ?? process.env.MEMBER_LOGIN_PASSWORD ?? '';
  const name = (process.argv[4] ?? '').trim() || deriveName(email) || 'Member';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Usage: npx tsx scripts/create-member-login.ts <email> [password] [name]');
  }
  if (!password) {
    password = await promptForPassword('Password: ');
    const confirmation = await promptForPassword('Confirm password: ');
    if (password !== confirmation) {
      throw new Error('Passwords do not match.');
    }
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error('Password must be between 8 and 128 characters.');
  }

  const workspace = await prisma.workspace.findFirst({
    where: { name: DEFAULT_WORKSPACE_NAME },
    select: { id: true, orgId: true },
  });
  if (!workspace) {
    throw new Error(`"${DEFAULT_WORKSPACE_NAME}" was not found. Run pnpm run services first.`);
  }

  // Mirrors the MEMBER entries in src/services/permissionMatrix.ts without
  // importing that service and starting unrelated backend infrastructure.
  const expectedPermissions = MEMBER_PERMISSIONS;
  const resources = await prisma.resource.findMany({
    where: {
      name: { in: expectedPermissions.map(({ resourceName }) => resourceName) },
    },
    select: { id: true, name: true },
  });
  const resourcesByName = new Map(resources.map((resource) => [resource.name, resource.id]));
  const missingResources = expectedPermissions.filter(
    ({ resourceName }) => !resourcesByName.has(resourceName)
  );
  if (missingResources.length > 0) {
    console.warn(
      `Skipping MEMBER resources not present in this database: ${missingResources
        .map(({ resourceName }) => resourceName)
        .join(', ')}.`
    );
  }
  const grantablePermissions = expectedPermissions.filter(({ resourceName }) =>
    resourcesByName.has(resourceName)
  );

  const [existingOrgMember, existingUser] = await Promise.all([
    prisma.orgMember.findUnique({ where: { email } }),
    prisma.user.findUnique({
      where: {
        email_workspaceId: {
          email,
          workspaceId: workspace.id,
        },
      },
    }),
  ]);

  if ((existingOrgMember && !existingUser) || (!existingOrgMember && existingUser)) {
    throw new Error(
      `${email} has a partial existing identity. Refusing to modify it automatically.`
    );
  }

  let userId: string;
  const passwordHash = await hashPassword(password);

  if (existingOrgMember && existingUser) {
    const isMatchingMember =
      existingOrgMember.memberId === existingUser.orgMemberId &&
      existingOrgMember.orgId === workspace.orgId &&
      existingOrgMember.role === OrgRole.MEMBER &&
      existingOrgMember.leftAt === null &&
      existingUser.role === WorkspaceRole.MEMBER &&
      existingUser.authProvider === AuthProvider.EMAIL &&
      existingUser.status === UserStatus.ACTIVE &&
      existingUser.leftAt === null;

    if (!isMatchingMember) {
      throw new Error(
        `${email} already exists but is not an active EMAIL/MEMBER account in ${DEFAULT_WORKSPACE_NAME}.`
      );
    }

    const [adminAccessCount, adminGroupCount] = await Promise.all([
      prisma.resourceAccess.count({
        where: { userId: existingUser.id, accessType: 'ADMIN' },
      }),
      prisma.userGroupMapping.count({
        where: {
          userId: existingUser.id,
          userGroup: { name: 'ADMIN' },
        },
      }),
    ]);
    if (adminAccessCount > 0 || adminGroupCount > 0) {
      throw new Error(
        `${email} already has admin access. Refusing to reset or relabel the account.`
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.orgMember.update({
        where: { memberId: existingOrgMember.memberId },
        data: { passwordHash },
      });
      for (const permission of grantablePermissions) {
        await tx.resourceAccess.upsert({
          where: {
            userId_resourceId_accessType: {
              userId: existingUser.id,
              resourceId: resourcesByName.get(permission.resourceName)!,
              accessType: permission.accessType,
            },
          },
          update: {},
          create: {
            userId: existingUser.id,
            resourceId: resourcesByName.get(permission.resourceName)!,
            accessType: permission.accessType,
            workspaceId: workspace.id,
          },
        });
      }
    });
    userId = existingUser.id;
    console.log(`Updated the password for existing MEMBER account ${email}.`);
  } else {
    const createdUser = await prisma.$transaction(async (tx) => {
      const orgMember = await tx.orgMember.create({
        data: {
          email,
          orgId: workspace.orgId,
          role: OrgRole.MEMBER,
          passwordHash,
        },
      });

      const user = await tx.user.create({
        data: {
          email,
          name,
          authProvider: AuthProvider.EMAIL,
          providerUserId: `email-${email}`,
          status: UserStatus.ACTIVE,
          workspaceId: workspace.id,
          role: WorkspaceRole.MEMBER,
          orgMemberId: orgMember.memberId,
        },
      });

      for (const permission of grantablePermissions) {
        await tx.resourceAccess.create({
          data: {
            userId: user.id,
            resourceId: resourcesByName.get(permission.resourceName)!,
            accessType: permission.accessType,
            workspaceId: workspace.id,
          },
        });
      }

      return user;
    });
    userId = createdUser.id;
    console.log(`Created MEMBER account ${email}.`);
  }

  const accessRows = await prisma.resourceAccess.findMany({
    where: { userId },
    select: {
      accessType: true,
      resource: { select: { name: true } },
    },
  });
  const actualPermissions = new Set(
    accessRows.map((row) => `${row.resource.name}:${row.accessType}`)
  );
  const missingPermissions = grantablePermissions.filter(
    ({ resourceName, accessType }) => !actualPermissions.has(`${resourceName}:${accessType}`)
  );
  const hasAdminAccess = accessRows.some((row) => row.accessType === 'ADMIN');

  if (missingPermissions.length > 0) {
    throw new Error(
      `MEMBER permissions are incomplete: ${missingPermissions
        .map(({ resourceName, accessType }) => `${resourceName}:${accessType}`)
        .join(', ')}. Run scripts/seed-acl.ts and retry.`
    );
  }
  if (hasAdminAccess) {
    throw new Error('Safety check failed: the account has direct ADMIN access.');
  }

  console.log(`Member login is ready for ${DEFAULT_WORKSPACE_NAME}.`);
  console.log(`Email: ${email}`);
  console.log('Role: MEMBER (non-admin)');
}

main()
  .catch((error) => {
    console.error('Failed to create member login:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
