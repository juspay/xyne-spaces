#!/usr/bin/env npx tsx

import { PrismaClient } from '@prisma/client';
import { AppPermissionRepository } from '../src/database/repositories/appPermissionRepository';

const prisma = new PrismaClient();
const appPermissions = new AppPermissionRepository();

const APP_PERMISSION_SCOPES = [
  { scope: 'calls:write', description: 'Schedule and manage calls from apps' },
  { scope: 'channels:read', description: 'Read channel metadata and history from apps' },
  { scope: 'chat:write', description: 'Post and update chat messages from apps' },
  { scope: 'chat:delete', description: 'Delete chat messages the app posted, from apps' },
  { scope: 'desk:read', description: 'Read desk configuration and desk-linked channel metadata' },
  { scope: 'desk:write', description: 'Create inbound desk events and desk-linked ticket activity' },
  { scope: 'email:read', description: 'Read email replies and email-thread data from apps' },
  { scope: 'files:read', description: 'Read file metadata and download attachments from apps' },
  { scope: 'files:write', description: 'Upload files and attachments from apps' },
  { scope: 'im:write', description: 'Open direct-message channels from apps' },
  { scope: 'tickets:read', description: 'Read tickets and ticket-linked conversations from apps' },
  { scope: 'tickets:write', description: 'Create and update tickets from apps' },
  { scope: 'usergroups:read', description: 'Read user groups from apps' },
  { scope: 'users:read', description: 'Read user profile information from apps' },
];

async function main() {
  console.log('Seeding app permission registry...');

  for (const permission of APP_PERMISSION_SCOPES) {
    await appPermissions.upsertByScope(permission.scope, permission.description);
    console.log(`  Registered ${permission.scope}`);
  }

  const total = await prisma.availableAppPermission.count();
  console.log(`Done. Total app permissions in registry: ${total}`);
}

main()
  .catch(error => {
    console.error('Failed to seed app permissions:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
