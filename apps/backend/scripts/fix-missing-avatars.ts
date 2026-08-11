#!/usr/bin/env tsx
/// <reference types="node" />

/**
 * Targeted fix-up: give every user/bot in the local dev DB a real photographic
 * avatar, without touching anything else.
 *
 * "Missing" means: picture is NULL/empty, OR it points at the ui-avatars.com
 * initials-generator fallback (the same fallback org-seed.ts uses when a real
 * fetch fails — not a real avatar).
 *
 * Uses the exact same pipeline as org-seed.ts's attachAvatars(): fetch a
 * portrait from randomuser.me, upload it into the fake-GCS bucket via the
 * app's own storage service, and store the storage path in users.picture —
 * never a bare URL.
 *
 * Read-then-write, in place. No deletes, no wipes, no ORG_WIPE.
 *
 * Usage:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/fix-missing-avatars.ts
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

// org-seed-content.ts's PEOPLE roster is 51 men / 50 women, consuming
// randomuser.me indices 0..50 and 0..49 respectively. Start past that so
// these portraits don't visibly duplicate an existing employee's photo.
const MEN_START = 51;
const WOMEN_START = 50;

async function main() {
  const candidates = await prisma.user.findMany({
    where: {
      OR: [
        { picture: null },
        { picture: '' },
        { picture: { startsWith: 'https://ui-avatars.com' } },
      ],
    },
    select: { id: true, name: true, email: true, userType: true, picture: true },
    orderBy: { email: 'asc' },
  });

  console.log(`\n🔍 ${candidates.length} user(s) missing a real avatar\n`);
  for (const u of candidates) {
    console.log(`   ${u.userType.padEnd(5)} ${u.email}  (picture: ${u.picture ?? 'NULL'})`);
  }
  if (!candidates.length) {
    console.log('\n✅ Nothing to do — everyone already has a real avatar.\n');
    return;
  }

  const { getStorageService } = await import('../src/services/storage/storageServiceFactory');
  const storage = getStorageService();
  await storage.ensureBucketExists();

  let menIdx = MEN_START;
  let womenIdx = WOMEN_START;
  const sources = candidates.map((_, i) => {
    const isMan = i % 2 === 0;
    const set = isMan ? 'men' : 'women';
    const n = (isMan ? menIdx++ : womenIdx++) % 100;
    return `https://randomuser.me/api/portraits/${set}/${n}.jpg`;
  });

  let uploaded = 0;
  let fallback = 0;
  const failures: string[] = [];

  const POOL = 8;
  let cursor = 0;

  async function worker() {
    while (cursor < candidates.length) {
      const i = cursor++;
      const user = candidates[i];
      try {
        const res = await fetch(sources[i]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        if (!buffer.length) throw new Error('empty body');

        const path = `profile-pictures/${user.id}/${Date.now()}-${randomUUID()}-avatar.jpg`;
        await storage.uploadFileV2(buffer, {
          path,
          contentType: 'image/jpeg',
          cacheControl: 'public, max-age=31536000',
          metadata: { userId: user.id, seededBy: 'fix-missing-avatars' },
        });
        await prisma.user.update({ where: { id: user.id }, data: { picture: path } });
        uploaded++;
        console.log(`   ✅ ${user.email} -> ${path}`);
      } catch (error) {
        failures.push(user.email);
        const name = encodeURIComponent(user.name);
        await prisma.user.update({
          where: { id: user.id },
          data: { picture: `https://ui-avatars.com/api/?name=${name}&background=random&color=fff` },
        });
        fallback++;
        console.warn(
          `   ⚠️  ${user.email}: ${error instanceof Error ? error.message : error} — kept a generated fallback`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: POOL }, worker));

  console.log(`\n🖼  ${uploaded} avatars uploaded to the bucket, ${fallback} fell back to generated avatars`);
  if (failures.length) console.log(`   fallback: ${failures.join(', ')}`);
  console.log('');
}

main()
  .catch((error) => {
    console.error('\n❌ fix-missing-avatars failed:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
