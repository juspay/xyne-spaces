#!/usr/bin/env npx tsx
/**
 * DEV-ONLY cleanup for release-manager auto-stub tickets.
 *
 * Lists (and with `--delete`, removes) the throwaway dev-ticket stubs created
 * by the autostub path (RELEASE_AUTOSTUB_MISSING_TICKETS=1). Useful after
 * changing autostub behavior so a re-run regenerates fresh stubs.
 *
 * Dry run (default):  npx tsx backend/scripts/release-manager/cleanup-autostub-tickets.ts
 * Delete:             npx tsx backend/scripts/release-manager/cleanup-autostub-tickets.ts --delete
 *
 * Deletes the ticket plus its hard-FK dependents (no ON DELETE CASCADE in the
 * schema) and any ART rows that referenced it. Leaves channel participants,
 * users, and release_change_types (string-keyed, non-blocking) untouched.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const STUB_DESCRIPTION = '[Auto-stub created by release-manager dev mode]';
const doDelete = process.argv.includes('--delete');

async function main(): Promise<void> {
  const stubs = await prisma.ticket.findMany({
    where: {
      OR: [{ description: STUB_DESCRIPTION }, { title: { startsWith: '[stub] ' } }],
    },
    select: { id: true, xyneId: true, title: true, assignedTo: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`\n🔎 Found ${stubs.length} auto-stub ticket(s):`);
  for (const s of stubs) {
    console.log(`   - ${s.xyneId}  assignedTo=${s.assignedTo ?? '—'}  "${s.title.slice(0, 60)}"`);
  }
  if (stubs.length === 0) return;

  const ids = stubs.map(s => s.id);

  // Report how many ART rows reference these stubs (cleaned alongside).
  const artCount = await prisma.applicationReleaseTicket.count({ where: { ticketId: { in: ids } } });
  console.log(`\n🔗 ART rows referencing these stubs: ${artCount}`);

  if (!doDelete) {
    console.log('\nDry run — nothing deleted. Re-run with --delete to remove them.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.applicationReleaseTicket.deleteMany({ where: { ticketId: { in: ids } } });
    await tx.ticketActivity.deleteMany({ where: { ticketId: { in: ids } } });
    await tx.ticketTag.deleteMany({ where: { ticketId: { in: ids } } });
    await tx.ticketEntityMapping.deleteMany({ where: { ticketId: { in: ids } } });
    await tx.ticketStageEta.deleteMany({ where: { ticketId: { in: ids } } });
    await tx.ticketAssignment.deleteMany({ where: { ticketId: { in: ids } } });
    await tx.ticketSubTicketMapping.deleteMany({ where: { ticketId: { in: ids } } });
    await tx.ticketReferenceMapping.deleteMany({
      where: { OR: [{ sourceTicketId: { in: ids } }, { targetTicketId: { in: ids } }] },
    });
    await tx.ticket.deleteMany({ where: { id: { in: ids } } });
  });

  console.log(`\n✅ Deleted ${stubs.length} stub ticket(s) + ${artCount} ART row(s) and dependents.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
