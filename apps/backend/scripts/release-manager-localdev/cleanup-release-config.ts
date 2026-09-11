#!/usr/bin/env npx tsx
/**
 * DEV-ONLY cleanup for Release Manager configuration + analysis data.
 *
 * Removes the RELEASE boards created by the "Configure Applications" wizard
 * (main release board + per-application boards), their Applications, seeded
 * stages, and all release analysis artifacts (ART rows, release events/changes/
 * change-types/attributions) — plus any release/hotfix tickets living on those
 * boards and their hard-FK dependents. Use it to clear the slate after test runs
 * (e.g. the `create-github-release-fixture.mjs` fixtures) or to resolve the
 * `boards_name_projectId_key` collision from reusing app/board names.
 *
 * Scope is REQUIRED (safety): either --project <projectId> or --all.
 * Dry run is the default; pass --delete to actually remove rows.
 *
 * Dry run (project):  npx tsx backend/scripts/release-manager-localdev/cleanup-release-config.ts --project <projectId>
 * Delete (project):   npx tsx backend/scripts/release-manager-localdev/cleanup-release-config.ts --project <projectId> --delete
 * Dry run (ALL):      npx tsx backend/scripts/release-manager-localdev/cleanup-release-config.ts --all
 * Delete (ALL):       npx tsx backend/scripts/release-manager-localdev/cleanup-release-config.ts --all --delete
 *
 * Deletes only RELEASE-type boards and their dependents. DEFAULT boards, their
 * tickets, and unrelated project data are left untouched. Runs in a single
 * transaction — if an unexpected FK blocks a delete, nothing is committed.
 */
import { PrismaClient, BoardType, FormContextType } from '@prisma/client';

const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const doDelete = argv.includes('--delete');
const allScope = argv.includes('--all');
const projectId = (() => {
  const i = argv.indexOf('--project');
  return i >= 0 ? argv[i + 1] : undefined;
})();

function uniq(xs: (string | null | undefined)[]): string[] {
  return [...new Set(xs.filter((x): x is string => Boolean(x)))];
}

async function main(): Promise<void> {
  if (!projectId && !allScope) {
    console.error('❌ Scope required: pass --project <projectId> or --all');
    process.exit(1);
  }
  const scopeLabel = projectId ? `project ${projectId}` : 'ALL projects';
  console.log(`\n🧹 Release Manager cleanup — scope: ${scopeLabel}  mode: ${doDelete ? 'DELETE' : 'dry-run'}`);

  // 1. Target RELEASE boards
  const releaseBoards = await prisma.board.findMany({
    where: { boardType: BoardType.RELEASE, ...(projectId ? { projectId } : {}) },
    select: { id: true, name: true, projectId: true },
    orderBy: { name: 'asc' },
  });
  const boardIds = releaseBoards.map(b => b.id);

  // 2. Applications owned by / pointing at those boards (or in the project)
  const applications = await prisma.application.findMany({
    where: {
      OR: [
        ...(projectId ? [{ projectId }] : []),
        { boardId: { in: boardIds } },
        { mainReleaseBoardId: { in: boardIds } },
      ],
    },
    select: { id: true, name: true, repoUrl: true, boardId: true, mainReleaseBoardId: true },
  });
  const appIds = applications.map(a => a.id);
  // include any app-owned boards not already in the RELEASE set
  const allBoardIds = uniq([...boardIds, ...applications.flatMap(a => [a.boardId, a.mainReleaseBoardId])]);

  // 3. Tickets living on these boards (release tickets + per-app subtickets)
  const tickets = await prisma.ticket.findMany({
    where: { boardId: { in: allBoardIds } },
    select: { id: true, xyneId: true, conversationId: true },
  });
  const ticketIds = tickets.map(t => t.id);

  // stages on these boards (for stage_pr_status_mappings)
  const stages = await prisma.stage.findMany({ where: { boardId: { in: allBoardIds } }, select: { id: true } });
  const stageIds = stages.map(s => s.id);

  // sub-ticket mappings for these tickets
  const subMappings = await prisma.ticketSubTicketMapping.findMany({
    where: { ticketId: { in: ticketIds } },
    select: { id: true, subTicketId: true },
  });
  const subTicketIds = uniq(subMappings.map(m => m.subTicketId));

  // Conversations owned by the release tickets + their sub-tickets. When we delete
  // the ticket, its conversation's messages (the "Ticket created" / "Release Analysis"
  // cards) are orphaned and keep rendering as ghost cards in the channel. These must be
  // HARD-deleted — soft-delete (isDeleted) does NOT hide these card/canvas messages in
  // the channel view. To stay safe, we only purge a conversation if NO surviving ticket
  // (outside this delete set) still references it — so a channel thread shared with a
  // live ticket is never touched.
  const subTickets = subTicketIds.length
    ? await prisma.subTicket.findMany({ where: { id: { in: subTicketIds } }, select: { conversationId: true } })
    : [];
  const candidateConvIds = uniq([
    ...tickets.map(t => t.conversationId),
    ...subTickets.map(s => s.conversationId),
  ]);
  const survivingInConvs = candidateConvIds.length
    ? await prisma.ticket.findMany({
        where: { conversationId: { in: candidateConvIds }, id: { notIn: ticketIds } },
        select: { conversationId: true },
      })
    : [];
  const survivingConvSet = new Set(survivingInConvs.map(t => t.conversationId));
  const conversationIds = candidateConvIds.filter(c => !survivingConvSet.has(c));

  // ---- report ----
  console.log(`\n  RELEASE boards        : ${allBoardIds.length}`);
  for (const b of releaseBoards) console.log(`     · "${b.name}"  (project ${b.projectId})`);
  console.log(`  Applications          : ${applications.length}`);
  for (const a of applications) console.log(`     · ${a.name}  ${a.repoUrl}`);
  console.log(`  Tickets on boards     : ${ticketIds.length}${ticketIds.length ? '  (' + tickets.map(t => t.xyneId).join(', ') + ')' : ''}`);
  console.log(`  Stages                : ${stageIds.length}`);
  console.log(`  Sub-tickets           : ${subTicketIds.length}`);

  const [artCount, evtCount, chgCount, ctypeCount, attrCount, webhookCount] = await Promise.all([
    prisma.applicationReleaseTicket.count({ where: { OR: [{ releaseId: { in: ticketIds } }, { ticketId: { in: ticketIds } }] } }),
    prisma.releaseEvent.count({ where: { releaseId: { in: ticketIds } } }),
    prisma.releaseChange.count({ where: { OR: [{ releaseId: { in: ticketIds } }, { applicationId: { in: appIds } }] } }),
    prisma.releaseChangeType.count({ where: { OR: [{ releaseId: { in: ticketIds } }, { applicationId: { in: appIds } }] } }),
    prisma.releaseAttribution.count({ where: { releaseId: { in: ticketIds } } }),
    prisma.appIncomingWebhook.count({ where: { boardId: { in: allBoardIds } } }),
  ]);
  console.log(`  ART rows              : ${artCount}`);
  console.log(`  Release events        : ${evtCount}`);
  console.log(`  Release changes       : ${chgCount}`);
  console.log(`  Release change types  : ${ctypeCount}`);
  console.log(`  Release attributions  : ${attrCount}`);
  console.log(`  Incoming webhooks     : ${webhookCount}`);

  const messageCount = conversationIds.length
    ? await prisma.message.count({ where: { conversationId: { in: conversationIds } } })
    : 0;
  console.log(`  Messages (hard-delete): ${messageCount}  (in ${conversationIds.length} orphaned conversation(s))`);

  if (allBoardIds.length === 0 && appIds.length === 0) {
    console.log('\n✅ Nothing to clean for this scope.');
    return;
  }
  if (!doDelete) {
    console.log('\nDry run — nothing deleted. Re-run with --delete to remove the above.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // release analysis artifacts (bare-string keys)
    await tx.applicationReleaseTicket.deleteMany({ where: { OR: [{ releaseId: { in: ticketIds } }, { ticketId: { in: ticketIds } }] } });
    await tx.releaseEvent.deleteMany({ where: { releaseId: { in: ticketIds } } });
    await tx.releaseChange.deleteMany({ where: { OR: [{ releaseId: { in: ticketIds } }, { applicationId: { in: appIds } }] } });
    await tx.releaseChangeType.deleteMany({ where: { OR: [{ releaseId: { in: ticketIds } }, { applicationId: { in: appIds } }] } });
    await tx.releaseAttribution.deleteMany({ where: { releaseId: { in: ticketIds } } });

    // Ghost channel cards: HARD-delete the messages in the deleted tickets' orphaned
    // conversations (soft-delete does NOT hide card/canvas messages in the channel).
    // Clear reaction rows first (Restrict FK); MessageSearch cascades on message delete.
    if (conversationIds.length) {
      await tx.reaction.deleteMany({ where: { message: { conversationId: { in: conversationIds } } } });
      await tx.reactionCount.deleteMany({ where: { message: { conversationId: { in: conversationIds } } } });
      await tx.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
    }

    // ticket hard-FK dependents (mirrors cleanup-autostub-tickets.ts) then the tickets
    if (ticketIds.length) {
      await tx.ticketActivity.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await tx.ticketTag.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await tx.ticketEntityMapping.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await tx.ticketStageEta.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await tx.ticketAssignment.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await tx.ticketSubTicketMapping.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await tx.ticketReferenceMapping.deleteMany({ where: { OR: [{ sourceTicketId: { in: ticketIds } }, { targetTicketId: { in: ticketIds } }] } });
      await tx.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    }
    if (subTicketIds.length) {
      await tx.ticketSubTicketMapping.deleteMany({ where: { subTicketId: { in: subTicketIds } } });
      await tx.subTicket.deleteMany({ where: { id: { in: subTicketIds } } });
    }

    // applications MUST go before their boards (FK onDelete: Restrict)
    if (appIds.length) await tx.application.deleteMany({ where: { id: { in: appIds } } });

    // board-FK dependents
    if (stageIds.length) await tx.stagePRStatusMapping.deleteMany({ where: { stageId: { in: stageIds } } });
    await tx.stage.deleteMany({ where: { boardId: { in: allBoardIds } } });
    await tx.stageTransition.deleteMany({ where: { boardId: { in: allBoardIds } } });
    // forms_context_mapping is keyed by (contextId, contextType), not boardId:
    // BOARD-context rows point at the board; STAGE-context rows point at its stages.
    await tx.formContextMapping.deleteMany({
      where: {
        OR: [
          { contextType: FormContextType.BOARD, contextId: { in: allBoardIds } },
          { contextType: FormContextType.STAGE, contextId: { in: stageIds } },
        ],
      },
    });
    await tx.boardComplexityScore.deleteMany({ where: { boardId: { in: allBoardIds } } });
    await tx.userWorkloadMapping.deleteMany({ where: { boardId: { in: allBoardIds } } });
    await tx.userExpertiseMapping.deleteMany({ where: { boardId: { in: allBoardIds } } });
    await tx.appIncomingWebhook.deleteMany({ where: { boardId: { in: allBoardIds } } });

    // finally the boards
    await tx.board.deleteMany({ where: { id: { in: allBoardIds } } });
  });

  console.log(`\n✅ Deleted ${allBoardIds.length} release board(s), ${appIds.length} application(s), ${ticketIds.length} ticket(s), ${messageCount} conversation message(s), and all release artifacts for ${scopeLabel}.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
