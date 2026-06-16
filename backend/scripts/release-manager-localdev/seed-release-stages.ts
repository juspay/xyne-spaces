#!/usr/bin/env npx tsx

/**
 * Reset stages on all local RELEASE-typed boards to the Xyne-Spaces release
 * lifecycle. Idempotent — upserts the 9 canonical lifecycle stages by
 * (boardId, name) on each release board, keeping existing stage ids stable and
 * leaving any custom non-canonical stages in place (no blanket delete).
 *
 * NOTE: this is the **Xyne-Spaces-specific** lifecycle for LOCAL dev only — it
 * is intentionally richer than the generic default the release-config wizard
 * seeds for new boards (BACKLOG / IN PROGRESS / COMPLETED / NOT REQUIRED, see
 * `seedReleaseStages` in backend/src/zero/mutators.ts). Do NOT propagate this
 * set into the wizard / prod defaults — keep workspace-specific seed data
 * scoped to this script.
 *
 * Xyne-Spaces stages (sequenceNumber, name → defaultTicketStatusV2):
 *   1. Created     → TODO
 *   2. Env_Ready   → STARTED
 *   3. Initiated   → STARTED
 *   4. Tested      → STARTED
 *   5. Approved    → STARTED
 *   6. In_Progress → STARTED
 *   7. Monitoring  → STARTED
 *   8. Completed   → COMPLETED
 *   9. Reverted    → CANCELLED
 *
 * Note: tickets reference `stageName` as a free string (no FK), so if an
 * existing ticket on a release board has a stageName not in the canonical
 * set, its label will appear unmapped in the UI dropdown after this runs.
 * Re-trigger the release flow (which sets the first stage) or move them
 * manually if that matters.
 *
 * Run via:  npx tsx backend/scripts/release-manager/seed-release-stages.ts
 */

import { PrismaClient, BoardType, TicketStatusV2 } from '@prisma/client';

const prisma = new PrismaClient();

interface StageSpec {
  name: string;
  status: TicketStatusV2;
}

const XYNE_SPACES_STAGES: StageSpec[] = [
  { name: 'Created', status: TicketStatusV2.TODO },
  { name: 'Env_Ready', status: TicketStatusV2.STARTED },
  { name: 'Initiated', status: TicketStatusV2.STARTED },
  { name: 'Tested', status: TicketStatusV2.STARTED },
  { name: 'Approved', status: TicketStatusV2.STARTED },
  { name: 'In_Progress', status: TicketStatusV2.STARTED },
  { name: 'Monitoring', status: TicketStatusV2.STARTED },
  { name: 'Completed', status: TicketStatusV2.COMPLETED },
  { name: 'Reverted', status: TicketStatusV2.CANCELLED },
];

const DEFAULT_ETA_HOURS = 1;

async function main(): Promise<void> {
  console.log('🚀 Resetting stages on RELEASE boards to canonical set...');

  const releaseBoards = await prisma.board.findMany({
    where: { boardType: BoardType.RELEASE },
    select: { id: true, name: true, createdBy: true },
  });

  if (releaseBoards.length === 0) {
    console.log('  ℹ️  No RELEASE boards found.');
    return;
  }

  console.log(`  Found ${releaseBoards.length} RELEASE board(s).`);

  for (const board of releaseBoards) {
    // Upsert canonical stages by (boardId, name) instead of a blanket
    // deleteMany+createMany. This keeps existing stage rows' ids stable (so
    // tickets whose `stageName` free-string points at a canonical stage stay
    // mapped) and leaves any custom non-canonical stages untouched. Stage has
    // no unique on (boardId, name), so resolve manually inside the txn.
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      // Prefetch existing stages once and resolve by name in-memory instead of
      // a findFirst per canonical stage (1 read/board instead of 9).
      const existingStages = await tx.stage.findMany({
        where: { boardId: board.id },
        select: { id: true, name: true },
      });
      const stageIdByName = new Map(existingStages.map((s) => [s.name, s.id]));
      for (const [idx, s] of XYNE_SPACES_STAGES.entries()) {
        const existingId = stageIdByName.get(s.name);
        if (existingId) {
          await tx.stage.update({
            where: { id: existingId },
            data: {
              sequenceNumber: idx + 1,
              eta: DEFAULT_ETA_HOURS,
              updatedBy: board.createdBy,
              updatedAt: now,
              defaultTicketStatusV2: s.status,
            },
          });
        } else {
          await tx.stage.create({
            data: {
              name: s.name,
              boardId: board.id,
              sequenceNumber: idx + 1,
              eta: DEFAULT_ETA_HOURS,
              createdBy: board.createdBy,
              updatedBy: board.createdBy,
              createdAt: now,
              updatedAt: now,
              defaultTicketStatusV2: s.status,
            },
          });
        }
      }
    });
    console.log(`  ✅ ${board.name} (${board.id}): ${XYNE_SPACES_STAGES.length} canonical stages upserted`);
  }

  console.log('\n✅ Done.');
}

main()
  .catch((error) => {
    console.error('\n❌ Stage seed failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
