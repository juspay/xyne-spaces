#!/usr/bin/env npx tsx

/**
 * Purge mis-ingested app-desk rows for one ExternalSource.
 *
 * Built for the History-fetch mis-filing incident: rows ingested by the app-desk
 * refetch with a broken `responseMapping` (wrong-cased `threadId`, wrong `sentAt`
 * path) produced single-message Nov-1 tickets / silently dropped rows. This script
 * removes everything reachable from the source's `workflow.external_messages`
 * rows so the windows can be re-pulled cleanly afterwards.
 *
 * Why purge is required BEFORE re-pulling:
 *   `external_messages` is unique on (externalSourceId, externalId) and
 *   `emails` is unique on externalMessageId — the refetch's pre-dedup and
 *   `Duplicate externalMessageId skipped` guards would silently skip every
 *   re-delivered row that is still present here.
 *
 * Deletes (in FK-safe order, mirrors jiraMigrationController.runPurgeJob +
 * reset-desk-local.ts; external_messages go LAST so a mid-purge failure is
 * resumable — discovery re-finds rows until they are deleted):
 *   ticket graph: ticketReferenceMapping, ticketActivity, ticketAssignment,
 *     ticketEntityMapping, ticketTag, ticketTagMapping, ticketStageEta,
 *     ticketStageRequest, ticketSubTicketMapping, subTicket.mappedTicketId,
 *     formEntityValues(TICKET), emailRead, ticketUserMailbox, ticketDescription,
 *     surfaceNudgeCount(ticketId), workflowExecution, workflow, ticket
 *   conversation graph: formEntityValues, emailRead, emailDraft,
 *     messageAttachment, message, email, conversationParticipant,
 *     conversationLabelMapping, messageArtifact, executionItem,
 *     executionItemMutation, executionRunLog, executionThreadState,
 *     radarPrLink, conversation
 *   chat-message artifacts: messageArtifact, proactiveNudge,
 *     surfaceNudgeCount(messageId) keyed to purged chat messages
 *   labels & tags: conversation_label_mappings link rows, non_zero.tags AI-tag
 *     rows keyed to purged emails / tickets / chat messages, and
 *     conversation_labels catalog rows the purge leaves with NO remaining
 *     mappings (labels still applied to surviving conversations, or referenced
 *     by desk auto-label rules — that relation is onDelete: Restrict —, are KEPT)
 *   attachments: object-storage blobs + Vespa file docs
 *   external_messages: every row linked to a purged entity (email, chat
 *     message, attachment) — including the provenance rows of foreign emails
 *     taken by --include-shared-conversations. Deleting those is REQUIRED for
 *     the refetch to re-deliver the messages: dedup keys on
 *     (externalSourceId, externalId), so a leftover row suppresses re-ingest.
 *   Vespa: ticket / chat_message / file docs via the vespa delete queue
 *     (same queue the Jira/WhatsApp purges use — run with the target env's
 *     Redis config so the prod workers process the deletes; verify no FAILED
 *     rows in vespa_insertion_logs afterwards)
 *
 * Safety:
 *   - Dry-run by default; --apply required to delete.
 *   - "Shared" conversations (conversations that also hold emails outside the
 *     purge set — another source's, or the same source's messages outside the
 *     --message-* window) are skipped entirely by default: their emails AND
 *     their external_messages provenance rows are kept. With
 *     --include-shared-conversations they purge wholesale — foreign emails go
 *     too, together with their external_messages rows, so a re-pull of the
 *     thread re-ingests them.
 *   - --created-after/--created-before filter `external_messages.createdAt`
 *     (when WE ingested the row, NOT the message's own sentAt) — use this to
 *     keep legitimately pushed rows and purge only the History-fetch writes.
 *   - --message-after/--message-before filter on the message's OWN date as
 *     recorded at ingest (linked `emails.createdAt` / `messages.createdAt` =
 *     the source-side sent/created time). Use this to purge exactly the rows
 *     belonging to a pulled history window while KEEPING live rows that were
 *     ingested at the same time.
 *
 * Usage (from apps/backend/):
 *   npx dotenv -e .env.prod -- npx tsx scripts/purge-appdesk-mis-ingested.ts \
 *     --source <externalSourceId> [--actor <userId>] \
 *     [--created-after <ISO>] [--created-before <ISO>] \
 *     [--message-after <ISO>] [--message-before <ISO>] \
 *     [--include-shared-conversations] [--reset-cursor] [--apply]
 *
 * After a successful purge: re-run with --reset-cursor (or let it ride along)
 * so windows replay from their start, then re-trigger the Nov windows.
 */

import { db } from '../src/database/client';
import { runWithContext } from '../src/database/tenant/context';
import {
  queueJiraPurgeAttachmentVespaDeleteJob,
  queueJiraPurgeMessageVespaDeleteJob,
  queueJiraPurgeTicketVespaDeleteJob,
} from '../src/services/jira/vespa';
import { storageService } from '../src/services/storage';
import { vespaQueue } from '../src/queues/vespaQueue';

interface Args {
  sourceId: string;
  actorUserId: string;
  createdAfter?: Date;
  createdBefore?: Date;
  messageAfter?: Date;
  messageBefore?: Date;
  includeSharedConversations: boolean;
  misthreadedOnly: boolean;
  resetCursor: boolean;
  apply: boolean;
}

const EXTERNAL_MESSAGE_CHUNK = 500;
const CHAT_MESSAGE_CHUNK_SIZE = 1000;
const CONVERSATION_CHUNK = 100;
const TICKET_CHUNK = 50;
const TICKET_CHUNK_DELAY_MS = 1000;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    sourceId: '',
    actorUserId: 'system-purge',
    includeSharedConversations: false,
    misthreadedOnly: false,
    resetCursor: false,
    apply: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--reset-cursor') {
      args.resetCursor = true;
    } else if (arg === '--include-shared-conversations') {
      args.includeSharedConversations = true;
    } else if (arg === '--misthreaded-only') {
      args.misthreadedOnly = true;
    } else if (arg === '--source' || arg === '--actor' || arg === '--created-after' || arg === '--created-before' || arg === '--message-after' || arg === '--message-before') {
      if (!next || next.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--source') args.sourceId = next.trim();
      else if (arg === '--actor') args.actorUserId = next.trim();
      else if (arg === '--created-after') args.createdAfter = parseIso(arg, next);
      else if (arg === '--created-before') args.createdBefore = parseIso(arg, next);
      else if (arg === '--message-after') args.messageAfter = parseIso(arg, next);
      else args.messageBefore = parseIso(arg, next);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.sourceId) {
    printUsage();
    throw new Error('--source <externalSourceId> is required');
  }
  return args;
}

function parseIso(flag: string, value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${flag} is not a valid ISO date: ${value}`);
  return date;
}

function printUsage(): void {
  console.log(`
Usage:
  npx dotenv -e .env.prod -- npx tsx scripts/purge-appdesk-mis-ingested.ts --source <externalSourceId> [options]

Options:
  --source <id>                   ExternalSource id whose mis-ingested rows should be purged (required).
  --actor <userId>                User id for the tenant scope + Vespa delete logs. Default: system-purge.
  --created-after <ISO>           Only purge external_messages rows ingested at/after this time.
  --created-before <ISO>          Only purge external_messages rows ingested at/before this time.
  --message-after <ISO>           Only purge rows whose message's OWN date (source-side
                                  sent/created time, on the linked emails/messages row) is
                                  at/after this time. Keeps live rows ingested alongside them.
  --message-before <ISO>          Same, upper bound (inclusive).
  --include-shared-conversations  Purge "shared" conversations wholesale: foreign emails
                                  (other source, or outside the --message-* window) are
                                  deleted with their external_messages provenance rows,
                                  so a later re-pull re-ingests those messages.
  --misthreaded-only              Only purge rows ingested without a thread id: the refetch then
                                  fell back to the message's own id as its thread, so each one
                                  became a single-message ticket. Matched on
                                  externalId == "<sourceId>:<externalThreadId>" (or the raw,
                                  pre-scoping form). Correctly threaded rows are never touched,
                                  whatever their dates. Combines with the date filters.
  --reset-cursor                  Null out the source's lastSyncCursor after the purge.
  --apply                         Actually delete. Without this flag, dry-run only.

Examples:
  # Dry-run: show everything that would be deleted
  npx dotenv -e .env.prod -- npx tsx scripts/purge-appdesk-mis-ingested.ts --source cmxxxx

  # Purge only rows the November History-fetch runs wrote, then reset the cursor
  npx dotenv -e .env.prod -- npx tsx scripts/purge-appdesk-mis-ingested.ts --source cmxxxx \\
    --created-after 2026-11-01T00:00:00Z --reset-cursor --apply

  # Purge exactly the rows belonging to a pulled history window (by the message's
  # own date), keeping live rows that were ingested at the same time
  npx dotenv -e .env.prod -- npx tsx scripts/purge-appdesk-mis-ingested.ts --source cmxxxx \\
    --message-after 2026-10-23T00:00:00Z --message-before 2026-11-12T23:59:59.999Z --reset-cursor --apply
`);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function dbHost(): string {
  const raw = process.env.DATABASE_URL ?? '';
  try {
    return new URL(raw).host || '(unknown host)';
  } catch {
    return '(DATABASE_URL not set or unparsable)';
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const source = await db.externalSource.findUnique({ where: { id: args.sourceId } });
  if (!source) throw new Error(`ExternalSource ${args.sourceId} not found`);

  console.log(`\nTarget DB : ${dbHost()}`);
  console.log(`Source    : ${source.name} (${source.id})`);
  console.log(`Type      : ${source.sourceType} · channel=${source.channelId ?? '-'} · workspace=${source.workspaceId}`);
  if (args.createdAfter || args.createdBefore) {
    console.log(`Ingested  : ${args.createdAfter?.toISOString() ?? '-'} .. ${args.createdBefore?.toISOString() ?? '-'}`);
  }
  if (args.messageAfter || args.messageBefore) {
    console.log(`Msg date  : ${args.messageAfter?.toISOString() ?? '-'} .. ${args.messageBefore?.toISOString() ?? '-'} (message's own date; keeps live rows)`);
  }
  console.log('');

  await runWithContext({ userId: args.actorUserId, workspaceId: source.workspaceId }, async () => {
    // ---------------------------------------------------------------- discovery
    let externalMessages = await db.externalMessage.findMany({
      where: {
        externalSourceId: source.id,
        ...(args.createdAfter || args.createdBefore
          ? {
              createdAt: {
                ...(args.createdAfter ? { gte: args.createdAfter } : {}),
                ...(args.createdBefore ? { lte: args.createdBefore } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true,
        externalId: true,
        externalThreadId: true,
        entityType: true,
        entityId: true,
        messageId: true,
        createdAt: true,
      },
    });

    // ------------------------------------------------ mis-threaded row filter
    // A row pulled while the threadId mapping was broken has no thread of its
    // own: ingest used `message.externalThreadId ?? message.externalId`, so its
    // externalThreadId IS its raw message id, while externalId is that id
    // source-scoped ("<sourceId>:<raw>"). Every such row is a single-message
    // conversation — the correct thread id never matches it — so this purges
    // whole mis-filed tickets and nothing that was threaded correctly.
    if (args.misthreadedOnly) {
      const before = externalMessages.length;
      externalMessages = externalMessages.filter(
        row =>
          !!row.externalThreadId &&
          (row.externalId === `${source.id}:${row.externalThreadId}` ||
            row.externalId === row.externalThreadId),
      );
      console.log(
        `Mis-threaded filter: kept ${externalMessages.length} of ${before} row(s) whose thread id is their own message id.`,
      );
    }

    // --------------------------------------------- message-date window filter
    // `--message-after/--message-before` filter on the message's OWN date as
    // recorded at ingest (linked `emails.createdAt` / `messages.createdAt` =
    // source-side sent/created time) — NOT our ingestion time. This is what
    // separates history-fetch rows of a pulled window from live rows that were
    // ingested at the same time. Rows with no resolvable message date are
    // excluded (never deleted on a guess) and reported.
    if (args.messageAfter || args.messageBefore) {
      const linkedIds = new Set<string>();
      for (const row of externalMessages) {
        if (row.entityId) linkedIds.add(row.entityId);
        if (row.messageId) linkedIds.add(row.messageId);
      }
      const messageDateById = new Map<string, Date>();
      if (linkedIds.size > 0) {
        const [dateEmails, dateMessages] = await Promise.all([
          db.email.findMany({ where: { id: { in: [...linkedIds] } }, select: { id: true, createdAt: true } }),
          db.message.findMany({ where: { messageId: { in: [...linkedIds] } }, select: { messageId: true, createdAt: true } }),
        ]);
        for (const e of dateEmails) messageDateById.set(e.id, e.createdAt);
        for (const m of dateMessages) if (!messageDateById.has(m.messageId)) messageDateById.set(m.messageId, m.createdAt);
      }
      let outsideWindow = 0;
      let undated = 0;
      externalMessages = externalMessages.filter(row => {
        const messageDate =
          (row.entityId ? messageDateById.get(row.entityId) : undefined) ??
          (row.messageId ? messageDateById.get(row.messageId) : undefined);
        if (!messageDate) {
          undated += 1;
          return false;
        }
        if (args.messageAfter && messageDate < args.messageAfter) {
          outsideWindow += 1;
          return false;
        }
        if (args.messageBefore && messageDate > args.messageBefore) {
          outsideWindow += 1;
          return false;
        }
        return true;
      });
      console.log(
        `Message-date filter: kept ${externalMessages.length} row(s); ${outsideWindow} outside the window, ${undated} with no linked message date (excluded).`,
      );
      if (undated > 0) {
        console.log(
          '  NOTE: rows whose linked email/message is already gone cannot be dated. If a previous purge was interrupted before phase 5, finish it with --created-after/--created-before instead.',
        );
      }
    }

    const emailIds = new Set<string>();
    const mappedMessageIds = new Set<string>();
    const mappedAttachmentIds = new Set<string>();
    for (const row of externalMessages) {
      if (row.entityType === 'EMAIL') {
        if (row.entityId) emailIds.add(row.entityId);
        if (row.messageId) emailIds.add(row.messageId);
      } else if (row.entityType === 'MESSAGE') {
        if (row.entityId) mappedMessageIds.add(row.entityId);
        if (row.messageId) mappedMessageIds.add(row.messageId);
      } else if (row.entityType === 'ATTACHMENT') {
        if (row.entityId) mappedAttachmentIds.add(row.entityId);
      }
    }

    const emails = emailIds.size
      ? await db.email.findMany({
          where: { id: { in: [...emailIds] } },
          select: { id: true, conversationId: true, channelId: true, subject: true, createdAt: true },
        })
      : [];
    const allConversationIds = [...new Set(emails.map(e => e.conversationId))];

    // Conversations that also hold emails outside our set are shared — skip by default.
    const foreignEmails = allConversationIds.length
      ? await db.email.findMany({
          where: { conversationId: { in: allConversationIds }, id: { notIn: [...emailIds] } },
          select: { id: true, conversationId: true },
        })
      : [];
    const sharedConversationIds = new Set(foreignEmails.map(e => e.conversationId));
    const skippedConversationIds = args.includeSharedConversations ? new Set<string>() : sharedConversationIds;
    const conversationIds = allConversationIds.filter(id => !skippedConversationIds.has(id));

    const tickets = conversationIds.length
      ? await db.ticket.findMany({
          where: { conversationId: { in: conversationIds } },
          select: { id: true, conversationId: true },
        })
      : [];
    const ticketIds = tickets.map(t => t.id);

    // Chat-shape rows (defensive: desk conversations may carry Message rows).
    const conversationMessages = conversationIds.length
      ? await db.message.findMany({
          where: { conversationId: { in: conversationIds } },
          select: { messageId: true, conversationId: true },
        })
      : [];
    const mappedMessageRows = mappedMessageIds.size
      ? await db.message.findMany({
          where: { messageId: { in: [...mappedMessageIds] } },
          select: { messageId: true, conversationId: true },
        })
      : [];
    const chatMessageIds = [
      ...new Set(
        [...conversationMessages, ...mappedMessageRows]
          .filter(m => !skippedConversationIds.has(m.conversationId))
          .map(m => m.messageId),
      ),
    ];

    const conversationEmailIds = [...emails, ...foreignEmails]
      .filter(e => !skippedConversationIds.has(e.conversationId))
      .map(e => e.id);
    const attachmentRows = (
      await db.messageAttachment.findMany({
        where: {
          OR: [
            { conversationId: { in: conversationIds } },
            { id: { in: [...mappedAttachmentIds] } },
            ...(conversationEmailIds.length ? [{ entityId: { in: conversationEmailIds } }] : []),
            ...(chatMessageIds.length ? [{ entityId: { in: chatMessageIds } }] : []),
          ],
        },
        select: { id: true, url: true, thumbnailUrl: true, conversationId: true, entityId: true },
      })
    ).filter(a => a.conversationId == null || !skippedConversationIds.has(a.conversationId));

    // --------------------------- external_messages rows to purge / to keep
    // Purge every provenance row linked to a purged entity (email, chat message,
    // attachment); KEEP every row linked to a surviving one. The keep-side
    // matters for skipped conversations (emails survive → rows survive). The
    // purge-side matters for --include-shared-conversations: its foreign emails
    // are deleted too, and their provenance rows must go with them — the
    // refetch dedups on (externalSourceId, externalId), so a leftover row would
    // silently suppress the re-ingest of those live messages.
    const purgedEntityIds = [...conversationEmailIds, ...chatMessageIds, ...attachmentRows.map(a => a.id)];
    const linkedProvenanceRows: typeof externalMessages = [];
    for (const chunk of chunkArray(purgedEntityIds, EXTERNAL_MESSAGE_CHUNK)) {
      const rows = await db.externalMessage.findMany({
        where: {
          externalSourceId: source.id,
          OR: [{ entityId: { in: chunk } }, { messageId: { in: chunk } }],
        },
        select: {
          id: true,
          externalId: true,
          externalThreadId: true,
          entityType: true,
          entityId: true,
          messageId: true,
          createdAt: true,
        },
      });
      linkedProvenanceRows.push(...rows);
    }
    const skippedEmailIds = new Set(
      emails.filter(e => skippedConversationIds.has(e.conversationId)).map(e => e.id),
    );
    const discoveredPurgeRows = externalMessages.filter(row => {
      if (row.entityId && skippedEmailIds.has(row.entityId)) return false;
      if (row.messageId && skippedEmailIds.has(row.messageId)) return false;
      return true;
    });
    const discoveredRowIds = new Set(discoveredPurgeRows.map(r => r.id));
    const purgeExternalMessages = [
      ...discoveredPurgeRows,
      ...linkedProvenanceRows.filter(r => !discoveredRowIds.has(r.id)),
    ];
    const foreignProvenanceRows = purgeExternalMessages.length - discoveredPurgeRows.length;

    // Labels whose mappings the purge removes. The catalog rows themselves are
    // deleted in phase 3's pre-step ONLY when the purge leaves them with no
    // remaining mappings — labels still applied to surviving conversations or
    // targeted by desk auto-label rules must survive. The set must be computed
    // HERE, before the mapping rows are deleted (afterwards it is uncomputable).
    const purgeLabelLinks = conversationIds.length
      ? await db.conversationLabelMapping.findMany({
          where: { conversationId: { in: conversationIds } },
          select: { labelId: true },
          distinct: ['labelId'],
        })
      : [];
    const candidateLabelIds = purgeLabelLinks.map(l => l.labelId);

    // -------------------------------------------------------------- dry-run report
    const labelMappingCount = conversationIds.length
      ? await db.conversationLabelMapping.count({ where: { conversationId: { in: conversationIds } } })
      : 0;
    const mailboxOverlayCount = ticketIds.length
      ? await db.ticketUserMailbox.count({ where: { ticketId: { in: ticketIds } } })
      : 0;
    const aiTagCount =
      (conversationEmailIds.length ? await db.tag.count({ where: { sourceId: { in: conversationEmailIds } } }) : 0) +
      (ticketIds.length ? await db.tag.count({ where: { sourceId: { in: ticketIds } } }) : 0) +
      (chatMessageIds.length ? await db.tag.count({ where: { sourceId: { in: chatMessageIds } } }) : 0);
    const ticketDescriptionCount = ticketIds.length
      ? await db.ticketDescription.count({ where: { ticketId: { in: ticketIds } } })
      : 0;
    const msgArtifactCount =
      chatMessageIds.length || conversationIds.length
        ? await db.messageArtifact.count({
            where: {
              OR: [
                ...(chatMessageIds.length ? [{ messageId: { in: chatMessageIds } }] : []),
                ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : []),
              ],
            },
          })
        : 0;
    const nudgeCount = chatMessageIds.length
      ? await db.proactiveNudge.count({ where: { messageId: { in: chatMessageIds } } })
      : 0;
    const surfaceNudgeRowCount =
      (chatMessageIds.length ? await db.surfaceNudgeCount.count({ where: { messageId: { in: chatMessageIds } } }) : 0) +
      (ticketIds.length ? await db.surfaceNudgeCount.count({ where: { ticketId: { in: ticketIds } } }) : 0);
    const executionRowCount = conversationIds.length
      ? (await db.executionItem.count({ where: { conversationId: { in: conversationIds } } })) +
        (await db.executionItemMutation.count({ where: { conversationId: { in: conversationIds } } })) +
        (await db.executionRunLog.count({ where: { conversationId: { in: conversationIds } } })) +
        (await db.executionThreadState.count({ where: { conversationId: { in: conversationIds } } }))
      : 0;
    const radarLinkCount = conversationIds.length
      ? await db.radarPrLink.count({ where: { conversationId: { in: conversationIds } } })
      : 0;

    // Prospective orphan labels: mappings on surviving conversations or rule
    // references keep the label alive (desk_auto_label_rule_references is
    // onDelete: Restrict, so rule-referenced labels cannot be deleted at all).
    const remainingLabelLinks = candidateLabelIds.length
      ? await db.conversationLabelMapping.findMany({
          where: { labelId: { in: candidateLabelIds }, conversationId: { notIn: conversationIds } },
          select: { labelId: true },
          distinct: ['labelId'],
        })
      : [];
    const ruleLabelLinks = candidateLabelIds.length
      ? await db.deskAutoLabelRuleReference.findMany({
          where: { labelId: { in: candidateLabelIds } },
          select: { labelId: true },
          distinct: ['labelId'],
        })
      : [];
    const keptLabelIds = new Set([
      ...remainingLabelLinks.map(r => r.labelId),
      ...ruleLabelLinks.map(r => r.labelId),
    ]);
    const orphanLabelIds = candidateLabelIds.filter(id => !keptLabelIds.has(id));

    console.log('Would purge:');
    console.log(`  external_messages          ${purgeExternalMessages.length}${foreignProvenanceRows > 0 ? ` (incl. ${foreignProvenanceRows} linked to foreign emails)` : ''}`);
    console.log(`  emails                     ${conversationEmailIds.length}${args.includeSharedConversations && foreignEmails.length > 0 ? ` (incl. ${foreignEmails.length} foreign)` : ''}`);
    console.log(`  tickets                    ${ticketIds.length}`);
    console.log(`  conversations              ${conversationIds.length}`);
    console.log(`  chat messages              ${chatMessageIds.length}`);
    console.log(`  message attachments        ${attachmentRows.length}`);
    console.log(`  conversation label links   ${labelMappingCount} (label catalog survives)`);
    console.log(`  mailbox overlays           ${mailboxOverlayCount}`);
    console.log(`  AI tags (non_zero.tags)    ${aiTagCount}`);
    console.log(`  ticket_descriptions        ${ticketDescriptionCount}`);
    console.log(`  message artifacts          ${msgArtifactCount}`);
    console.log(`  proactive nudges           ${nudgeCount}`);
    console.log(`  surface nudge counts       ${surfaceNudgeRowCount}`);
    console.log(`  executor rows              ${executionRowCount} (items + mutations + run logs + thread state)`);
    console.log(`  radar PR links             ${radarLinkCount}`);
    console.log(`  orphaned labels            ${orphanLabelIds.length} (catalog rows emptied by this purge; still-used / rule-linked kept)`);
    console.log(`  attachment Vespa docs      ${attachmentRows.length} (queued deletes)`);
    console.log(`  ticket Vespa docs          ${ticketIds.length} (queued deletes)`);
    console.log(`  message Vespa docs         ${chatMessageIds.length} (queued deletes)`);
    if (args.includeSharedConversations && sharedConversationIds.size > 0) {
      console.log(`\n  Shared conversations INCLUDED: ${sharedConversationIds.size} conversation(s) purge wholesale, taking ${foreignEmails.length} foreign email(s) with ${foreignProvenanceRows} extra external_messages row(s).`);
      console.log('  Those messages re-ingest on the next pull (dedup keys on (externalSourceId, externalId)).');
    } else if (skippedConversationIds.size > 0) {
      console.log(`\n  SKIPPED ${skippedConversationIds.size} shared conversation(s) with ${foreignEmails.length} foreign email(s):`);
      for (const convId of [...skippedConversationIds].slice(0, 10)) {
        console.log(`    ${convId}`);
      }
      console.log('  (their emails AND external_messages rows are kept — pass --include-shared-conversations to purge them wholesale)');
    }
    const sampleExternalIds = externalMessages.slice(0, 5).map(m => m.externalId);
    if (sampleExternalIds.length > 0) {
      console.log(`\n  Sample externalIds: ${sampleExternalIds.join(', ')}`);
    }
    const sampleTickets = tickets.slice(0, 5).map(t => t.id);
    if (sampleTickets.length > 0) {
      console.log(`  Sample ticket ids : ${sampleTickets.join(', ')}`);
    }
    console.log('');

    if (!args.apply) {
      console.log('DRY RUN — nothing deleted. Re-run with --apply to purge.');
      return;
    }

    const stats: Record<string, number> = {};

    // The Vespa delete jobs below only enqueue when the queue is initialized
    // (server startup normally does this; a standalone script must do it itself).
    let vespaReady = false;
    try {
      await vespaQueue.initialize();
      vespaReady = true;
    } catch (error) {
      console.warn(`Could not initialize the Vespa queue: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!vespaReady) {
      throw new Error('Refusing to apply: Vespa delete queue could not be initialized — deleting now would orphan search docs. Fix the Redis/queue env and re-run.');
    }

    // ------------------------------------------- phase 1: reactions + messages
    for (const chunk of chunkArray(chatMessageIds, CHAT_MESSAGE_CHUNK_SIZE)) {
      if (chunk.length === 0) continue;
      const txnResults = await db.$transaction([
        db.reactionCount.deleteMany({ where: { messageId: { in: chunk } } }),
        db.reaction.deleteMany({ where: { messageId: { in: chunk } } }),
        db.messageAttachment.deleteMany({ where: { entityId: { in: chunk } } }),
        db.message.deleteMany({ where: { messageId: { in: chunk } } }),
        db.tag.deleteMany({ where: { sourceId: { in: chunk } } }),
        db.messageArtifact.deleteMany({ where: { messageId: { in: chunk } } }),
        db.proactiveNudge.deleteMany({ where: { messageId: { in: chunk } } }),
        db.surfaceNudgeCount.deleteMany({ where: { messageId: { in: chunk } } }),
      ]);
      stats['Message'] = (stats['Message'] ?? 0) + txnResults[3].count;
      stats['MessageAttachment'] = (stats['MessageAttachment'] ?? 0) + txnResults[2].count;
      for (const messageId of chunk) {
        queueJiraPurgeMessageVespaDeleteJob(messageId, args.actorUserId, source.workspaceId);
      }
    }
    console.log(`Phase 2 done — chat messages: ${stats['Message'] ?? 0}`);

    // -------------------------------------------------------- phase 2: tickets
    const ticketChunks = chunkArray(ticketIds, TICKET_CHUNK);
    for (let index = 0; index < ticketChunks.length; index += 1) {
      const chunk = ticketChunks[index];
      if (chunk.length === 0) continue;

      const workflows = await db.workflow.findMany({ where: { ticketId: { in: chunk } }, select: { id: true } });
      if (workflows.length > 0) {
        await db.workflowExecution.deleteMany({ where: { workflowId: { in: workflows.map(w => w.id) } } });
      }

      const txnResults = await db.$transaction([
        db.ticketReferenceMapping.deleteMany({
          where: { OR: [{ sourceTicketId: { in: chunk } }, { targetTicketId: { in: chunk } }] },
        }),
        db.ticketActivity.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.ticketAssignment.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.ticketEntityMapping.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.ticketTag.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.ticketTagMapping.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.ticketStageEta.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.ticketStageRequest.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.ticketSubTicketMapping.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.subTicket.updateMany({ where: { mappedTicketId: { in: chunk } }, data: { mappedTicketId: null } }),
        db.formEntityValues.deleteMany({ where: { entityId: { in: chunk }, entityType: 'TICKET' } }),
        db.emailRead.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.ticketUserMailbox.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.tag.deleteMany({ where: { sourceId: { in: chunk } } }),
        // Keep ticket.deleteMany LAST: stats reads txnResults[length - 1] as the
        // ticket count below.
        db.ticketDescription.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.surfaceNudgeCount.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.workflow.deleteMany({ where: { ticketId: { in: chunk } } }),
        db.ticket.deleteMany({ where: { id: { in: chunk } } }),
      ]);
      stats['Ticket'] = (stats['Ticket'] ?? 0) + txnResults[txnResults.length - 1].count;

      for (const ticketId of chunk) {
        queueJiraPurgeTicketVespaDeleteJob(ticketId, args.actorUserId, source.workspaceId);
      }

      console.log(`Phase 2 progress — tickets: ${stats['Ticket'] ?? 0}/${ticketIds.length} (batch ${index + 1}/${ticketChunks.length})`);
      if (index < ticketChunks.length - 1) await sleep(TICKET_CHUNK_DELAY_MS);
    }

    // -------------------------------------------------- phase 3: conversations
    // Pre-step: orphaned label catalog rows. Uses the prospective orphan set
    // from discovery — must run BEFORE the mapping rows below are deleted,
    // and is idempotent (re-running a crashed purge re-deletes nothing).
    if (orphanLabelIds.length > 0) {
      const labelsDeleted = await db.conversationLabel.deleteMany({ where: { id: { in: orphanLabelIds } } });
      stats['ConversationLabel'] = labelsDeleted.count;
      console.log(`Phase 3 pre-step — orphaned labels deleted: ${labelsDeleted.count}/${orphanLabelIds.length}`);
    }
    const convEmailIdsByConv = new Map<string, string[]>();
    for (const email of [...emails, ...foreignEmails]) {
      if (skippedConversationIds.has(email.conversationId)) continue;
      const list = convEmailIdsByConv.get(email.conversationId) ?? [];
      list.push(email.id);
      convEmailIdsByConv.set(email.conversationId, list);
    }
    for (const chunk of chunkArray(conversationIds, CONVERSATION_CHUNK)) {
      if (chunk.length === 0) continue;
      const convEmailIds = chunk.flatMap(convId => convEmailIdsByConv.get(convId) ?? []);
      const txnResults = await db.$transaction([
        db.formEntityValues.deleteMany({ where: { entityId: { in: [...chunk, ...convEmailIds] } } }),
        db.emailRead.deleteMany({ where: { lastReadEmailId: { in: convEmailIds } } }),
        db.emailDraft.deleteMany({ where: { conversationId: { in: chunk } } }),
        db.messageAttachment.deleteMany({ where: { conversationId: { in: chunk } } }),
        db.message.deleteMany({ where: { conversationId: { in: chunk } } }),
        db.email.deleteMany({ where: { conversationId: { in: chunk } } }),
        db.conversationParticipant.deleteMany({ where: { conversationId: { in: chunk } } }),
        db.conversationLabelMapping.deleteMany({ where: { conversationId: { in: chunk } } }),
        db.tag.deleteMany({ where: { sourceId: { in: convEmailIds } } }),
        // No DB cascades (relationMode="prisma"): every row keyed to the purged
        // conversations must be deleted explicitly or it dangles forever.
        db.messageArtifact.deleteMany({ where: { conversationId: { in: chunk } } }),
        db.executionItemMutation.deleteMany({ where: { conversationId: { in: chunk } } }),
        db.executionItem.deleteMany({ where: { conversationId: { in: chunk } } }),
        db.executionRunLog.deleteMany({ where: { conversationId: { in: chunk } } }),
        db.executionThreadState.deleteMany({ where: { conversationId: { in: chunk } } }),
        db.radarPrLink.deleteMany({ where: { conversationId: { in: chunk } } }),
      ]);
      stats['Email'] = (stats['Email'] ?? 0) + txnResults[5].count;
      stats['MessageAttachment'] = (stats['MessageAttachment'] ?? 0) + txnResults[3].count;
      stats['MessageArtifact'] = (stats['MessageArtifact'] ?? 0) + txnResults[9].count;
      stats['ExecutionRows'] =
        (stats['ExecutionRows'] ?? 0) +
        txnResults[10].count + txnResults[11].count + txnResults[12].count + txnResults[13].count;
      stats['RadarPrLink'] = (stats['RadarPrLink'] ?? 0) + txnResults[14].count;
      const conversationDeleted = await db.conversation.deleteMany({ where: { conversationId: { in: chunk } } });
      stats['Conversation'] = (stats['Conversation'] ?? 0) + conversationDeleted.count;
    }
    console.log(`Phase 3 done — emails: ${stats['Email'] ?? 0}, conversations: ${stats['Conversation'] ?? 0}`);

    // ----------------------------------------- phase 4: attachment blobs + Vespa
    let deletedBlobs = 0;
    for (const attachment of attachmentRows) {
      queueJiraPurgeAttachmentVespaDeleteJob(attachment.id, args.actorUserId, source.workspaceId);
      for (const url of [attachment.url, attachment.thumbnailUrl]) {
        if (!url) continue;
        try {
          await storageService.deleteFile(url);
          deletedBlobs += 1;
        } catch (error) {
          console.warn(`  Could not delete blob for attachment ${attachment.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    console.log(`Phase 4 done — attachment blobs deleted: ${deletedBlobs}`);

    // ------------------------------- phase 5: external message mappings (LAST —
    // resumability: discovery re-finds rows until this point, so a mid-purge
    // failure can simply be re-run to finish the remainder)
    for (const chunk of chunkArray(purgeExternalMessages.map(m => m.id), EXTERNAL_MESSAGE_CHUNK)) {
      const result = await db.externalMessage.deleteMany({ where: { id: { in: chunk } } });
      stats['ExternalMessage'] = (stats['ExternalMessage'] ?? 0) + result.count;
    }
    console.log(`Phase 5 done — external_messages: ${stats['ExternalMessage'] ?? 0}`);

    // ------------------------------------------------------- phase 6: cursor
    if (args.resetCursor) {
      await db.externalSource.update({ where: { id: source.id }, data: { lastSyncCursor: null } });
      console.log('Phase 6 done — lastSyncCursor reset to NULL (windows will replay from their start).');
    }

    console.log('\nPurge complete:');
    for (const [table, count] of Object.entries(stats)) {
      console.log(`  ${table.padEnd(22)} ${count}`);
    }
    console.log(`  ${'attachment blobs'.padEnd(22)} ${deletedBlobs}`);
    console.log('\nReminder: Vespa deletes are queued — check vespa_insertion_logs for FAILED rows once workers drain.');
    console.log('Next: re-trigger the Nov windows (same windows = same cursors = full replay).');
  });
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    // Bull keeps Redis connections open once the Vespa queue is initialized;
    // exit explicitly so the run terminates when it is done.
    process.exit(process.exitCode ?? 0);
  });


