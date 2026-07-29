#!/usr/bin/env npx tsx

/**
 * Nuke ALL xyne-desk data: sources, channels, tickets, emails, conversations, etc.
 *
 * Deletes (in FK-safe order):
 *   WorkflowExecution → Workflow → Ticket children → Ticket
 *   ExternalMessage, MessageSearch, MessageAttachment, Message
 *   Email, EmailDraft, EmailRead
 *   ConversationParticipant → Conversation
 *   ChannelParticipant, ClassificationMapping
 *   EmailChannelPreference → Channel → ExternalSource
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/reset-desk-local.ts [--channel <id>] [--apply]
 *
 * Options:
 *   --channel  Target a specific channel ID. Can be repeated. Default: all EMAIL channels + all ExternalSources.
 *   --apply    Actually delete. Without this, dry-run only.
 */

import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV !== 'development') {
  console.error('reset-desk-local is only allowed when NODE_ENV=development');
  process.exit(1);
}

const prisma = new PrismaClient();

interface Args {
  channelIds: string[];
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { channelIds: [], apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--channel') {
      if (!next || next.startsWith('--')) throw new Error(`${arg} requires a channel ID`);
      args.channelIds.push(next.trim());
      i++;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`
Usage:
  npx dotenv -e .env.local -- npx tsx scripts/reset-desk-local.ts [--channel <id>] [--apply]

Options:
  --channel  Target specific channel(s). Can be repeated. Default: all EMAIL/SUPPORT/SLACK or TICKET-scoped channels.
  --apply    Actually delete rows. Without this flag, dry-run only.

Examples:
  # Dry-run: show everything that would be deleted
  npx dotenv -e .env.local -- npx tsx scripts/reset-desk-local.ts

  # Delete everything desk-related
  npx dotenv -e .env.local -- npx tsx scripts/reset-desk-local.ts --apply

  # Delete only specific channel
  npx dotenv -e .env.local -- npx tsx scripts/reset-desk-local.ts --channel cmq0pujwd0013bdp5j1qxmn93 --apply
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Discover channels
  let channelIds: string[];
  if (args.channelIds.length > 0) {
    channelIds = args.channelIds;
  } else {
    const emailChannels = await prisma.channel.findMany({
      where: {
        OR: [
          { type: { in: ['EMAIL', 'SUPPORT', 'SLACK'] } },
          { scopeType: 'TICKET' },
        ],
      },
      select: { id: true },
    });
    channelIds = emailChannels.map(c => c.id);
  }

  // Discover all external sources (both channel-linked and workspace-level)
  const sources = await prisma.externalSource.findMany({
    where: {
      OR: [
        ...(channelIds.length > 0 ? [{ channelId: { in: channelIds } }] : []),
        { channelId: null },
      ],
    },
    select: { id: true, name: true, sourceType: true, channelId: true, displayName: true, isActive: true, workspaceId: true },
  });

  // Include channels referenced by sources but not yet in list
  for (const s of sources) {
    if (s.channelId && !channelIds.includes(s.channelId)) {
      channelIds.push(s.channelId);
    }
  }

  const sourceIds = sources.map(s => s.id);

  const channels = channelIds.length > 0
    ? await prisma.channel.findMany({
        where: { id: { in: channelIds } },
        select: { id: true, name: true, type: true },
      })
    : [];

  console.log(`Mode: ${args.apply ? '*** APPLY (destructive) ***' : 'dry-run'}`);

  console.log(`\nChannels (${channels.length}):`);
  if (channels.length === 0) console.log('  none');
  for (const c of channels) {
    console.log(`  ${c.id}  ${c.name}  type=${c.type}`);
  }

  console.log(`\nExternal Sources (${sources.length}):`);
  if (sources.length === 0) console.log('  none');
  for (const s of sources) {
    console.log(`  ${s.id}  ${s.name}  type=${s.sourceType}  channel=${s.channelId ?? 'workspace-level'}  active=${s.isActive}`);
  }

  if (channels.length === 0 && sources.length === 0) {
    console.log('\nNothing to clean up.');
    return;
  }

  const counts = await gatherCounts(sourceIds, channelIds);
  console.log('\nRows to delete:');
  for (const [label, count] of Object.entries(counts)) {
    if (count > 0) console.log(`  ${label}: ${count}`);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`  TOTAL: ${total}`);

  if (!args.apply) {
    console.log('\nDry-run only. Re-run with --apply to delete.');
    return;
  }

  console.log('\nDeleting...');
  const result = await deleteAll(sourceIds, channelIds);
  console.log('\nDeleted:');
  for (const [label, count] of Object.entries(result)) {
    if (count > 0) console.log(`  ${label}: ${count}`);
  }
  const totalDeleted = Object.values(result).reduce((a, b) => a + b, 0);
  console.log(`  TOTAL: ${totalDeleted}`);
  console.log('\nDone.');
}

async function gatherCounts(
  sourceIds: string[],
  channelIds: string[],
): Promise<Record<string, number>> {
  const c: Record<string, number> = {};

  c['ExternalSource'] = sourceIds.length;

  if (sourceIds.length > 0) {
    c['ExternalMessage'] = await prisma.externalMessage.count({
      where: { externalSourceId: { in: sourceIds } },
    });
  }

  if (channelIds.length === 0) return c;

  const conversationIds = (
    await prisma.conversation.findMany({
      where: { channelId: { in: channelIds } },
      select: { conversationId: true },
    })
  ).map(cv => cv.conversationId);

  const ticketIds = (
    await prisma.ticket.findMany({
      where: { channelId: { in: channelIds } },
      select: { id: true },
    })
  ).map(t => t.id);

  const workflowIds = ticketIds.length > 0
    ? (await prisma.workflow.findMany({
        where: { ticketId: { in: ticketIds } },
        select: { id: true },
      })).map(w => w.id)
    : [];

  if (workflowIds.length > 0) {
    c['WorkflowExecution'] = await prisma.workflowExecution.count({ where: { workflowId: { in: workflowIds } } });
  }
  c['Workflow'] = workflowIds.length;

  if (ticketIds.length > 0) {
    c['TicketActivity'] = await prisma.ticketActivity.count({ where: { ticketId: { in: ticketIds } } });
    c['TicketTag'] = await prisma.ticketTag.count({ where: { ticketId: { in: ticketIds } } });
    c['TicketAssignment'] = await prisma.ticketAssignment.count({ where: { ticketId: { in: ticketIds } } });
    c['TicketStageEta'] = await prisma.ticketStageEta.count({ where: { ticketId: { in: ticketIds } } });
    c['TicketSubTicketMapping'] = await prisma.ticketSubTicketMapping.count({ where: { ticketId: { in: ticketIds } } });
    c['TicketEntityMapping'] = await prisma.ticketEntityMapping.count({ where: { ticketId: { in: ticketIds } } });
    c['TicketReferenceMapping'] = await prisma.ticketReferenceMapping.count({
      where: { OR: [{ sourceTicketId: { in: ticketIds } }, { targetTicketId: { in: ticketIds } }] },
    });
    c['EmailRead'] = await prisma.emailRead.count({ where: { ticketId: { in: ticketIds } } });
  }
  c['Ticket'] = ticketIds.length;

  const messageIds = conversationIds.length > 0
    ? (await prisma.message.findMany({
        where: { conversationId: { in: conversationIds } },
        select: { messageId: true },
      })).map(m => m.messageId)
    : [];

  if (messageIds.length > 0) {
    c['Message'] = messageIds.length;
    c['MessageAttachment'] = await prisma.messageAttachment.count({ where: { conversationId: { in: conversationIds } } });
    c['MessageSearch'] = await prisma.messageSearch.count({ where: { messageId: { in: messageIds } } });
    c['Reaction'] = await prisma.reaction.count({ where: { messageId: { in: messageIds } } });
    c['ReactionCount'] = await prisma.reactionCount.count({ where: { messageId: { in: messageIds } } });
  }
  if (conversationIds.length > 0) {
    c['ConversationParticipant'] = await prisma.conversationParticipant.count({
      where: { conversationId: { in: conversationIds } },
    });
  }

  c['Email'] = await prisma.email.count({ where: { channelId: { in: channelIds } } });
  c['EmailDraft'] = await prisma.emailDraft.count({ where: { channelId: { in: channelIds } } });
  c['Conversation'] = conversationIds.length;
  c['ChannelParticipant'] = await prisma.channelParticipant.count({ where: { channelId: { in: channelIds } } });
  c['ChannelUserStatus'] = await prisma.channelUserStatus.count({ where: { channelId: { in: channelIds } } });
  c['ChannelStats'] = await prisma.channelStats.count({ where: { channelId: { in: channelIds } } });
  c['ClassificationMapping'] = await prisma.classificationMapping.count({ where: { channelId: { in: channelIds } } });
  c['EmailChannelPreference'] = await prisma.emailChannelPreference.count({ where: { channelId: { in: channelIds } } });
  c['AppIncomingWebhook'] = await prisma.appIncomingWebhook.count({ where: { channelId: { in: channelIds } } });
  c['CanvasFolder'] = await prisma.canvasFolder.count({ where: { channelId: { in: channelIds } } });
  c['Call'] = await prisma.call.count({ where: { channelId: { in: channelIds } } });
  c['ScheduledMessage'] = await prisma.scheduledMessage.count({ where: { channelId: { in: channelIds } } });
  c['Link'] = await prisma.link.count({ where: { channelId: { in: channelIds } } });
  c['SurfaceNudgeCount'] = await prisma.surfaceNudgeCount.count({ where: { channelId: { in: channelIds } } });
  c['Channel'] = channelIds.length;

  return c;
}

async function deleteAll(
  sourceIds: string[],
  channelIds: string[],
): Promise<Record<string, number>> {
  const r: Record<string, number> = {};

  // 1. ExternalMessage
  if (sourceIds.length > 0) {
    r['ExternalMessage'] = (await prisma.externalMessage.deleteMany({
      where: { externalSourceId: { in: sourceIds } },
    })).count;
  }

  if (channelIds.length === 0) {
    if (sourceIds.length > 0) {
      r['ExternalSource'] = (await prisma.externalSource.deleteMany({
        where: { id: { in: sourceIds } },
      })).count;
    }
    return r;
  }

  // 2. Gather IDs
  const conversationIds = (
    await prisma.conversation.findMany({
      where: { channelId: { in: channelIds } },
      select: { conversationId: true },
    })
  ).map(cv => cv.conversationId);

  const ticketIds = (
    await prisma.ticket.findMany({
      where: { channelId: { in: channelIds } },
      select: { id: true },
    })
  ).map(t => t.id);

  const workflowIds = ticketIds.length > 0
    ? (await prisma.workflow.findMany({
        where: { ticketId: { in: ticketIds } },
        select: { id: true },
      })).map(w => w.id)
    : [];

  // 3. Workflow tree
  if (workflowIds.length > 0) {
    r['WorkflowExecution'] = (await prisma.workflowExecution.deleteMany({
      where: { workflowId: { in: workflowIds } },
    })).count;
    r['Workflow'] = (await prisma.workflow.deleteMany({
      where: { id: { in: workflowIds } },
    })).count;
  }

  // 4. Ticket children
  if (ticketIds.length > 0) {
    r['TicketActivity'] = (await prisma.ticketActivity.deleteMany({ where: { ticketId: { in: ticketIds } } })).count;
    r['TicketTag'] = (await prisma.ticketTag.deleteMany({ where: { ticketId: { in: ticketIds } } })).count;
    r['TicketAssignment'] = (await prisma.ticketAssignment.deleteMany({ where: { ticketId: { in: ticketIds } } })).count;
    r['TicketStageEta'] = (await prisma.ticketStageEta.deleteMany({ where: { ticketId: { in: ticketIds } } })).count;
    r['TicketSubTicketMapping'] = (await prisma.ticketSubTicketMapping.deleteMany({ where: { ticketId: { in: ticketIds } } })).count;
    r['TicketEntityMapping'] = (await prisma.ticketEntityMapping.deleteMany({ where: { ticketId: { in: ticketIds } } })).count;
    r['TicketReferenceMapping'] = (await prisma.ticketReferenceMapping.deleteMany({
      where: { OR: [{ sourceTicketId: { in: ticketIds } }, { targetTicketId: { in: ticketIds } }] },
    })).count;
    r['EmailRead'] = (await prisma.emailRead.deleteMany({ where: { ticketId: { in: ticketIds } } })).count;
    r['Ticket'] = (await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })).count;
  }

  // 5. Message tree
  if (conversationIds.length > 0) {
    r['MessageAttachment'] = (await prisma.messageAttachment.deleteMany({
      where: { conversationId: { in: conversationIds } },
    })).count;

    const messageIds = (
      await prisma.message.findMany({
        where: { conversationId: { in: conversationIds } },
        select: { messageId: true },
      })
    ).map(m => m.messageId);

    if (messageIds.length > 0) {
      r['MessageSearch'] = (await prisma.messageSearch.deleteMany({
        where: { messageId: { in: messageIds } },
      })).count;
      r['ReactionCount'] = (await prisma.reactionCount.deleteMany({
        where: { messageId: { in: messageIds } },
      })).count;
      r['Reaction'] = (await prisma.reaction.deleteMany({
        where: { messageId: { in: messageIds } },
      })).count;
    }

    r['ConversationParticipant'] = (await prisma.conversationParticipant.deleteMany({
      where: { conversationId: { in: conversationIds } },
    })).count;
    r['Message'] = (await prisma.message.deleteMany({
      where: { conversationId: { in: conversationIds } },
    })).count;
  }

  // 6. Email tables
  r['Email'] = (await prisma.email.deleteMany({ where: { channelId: { in: channelIds } } })).count;
  r['EmailDraft'] = (await prisma.emailDraft.deleteMany({ where: { channelId: { in: channelIds } } })).count;

  // 7. Conversation
  if (conversationIds.length > 0) {
    r['Conversation'] = (await prisma.conversation.deleteMany({
      where: { conversationId: { in: conversationIds } },
    })).count;
  }

  // 8. Channel-level tables
  r['ChannelParticipant'] = (await prisma.channelParticipant.deleteMany({ where: { channelId: { in: channelIds } } })).count;
  r['ChannelUserStatus'] = (await prisma.channelUserStatus.deleteMany({ where: { channelId: { in: channelIds } } })).count;
  r['ChannelStats'] = (await prisma.channelStats.deleteMany({ where: { channelId: { in: channelIds } } })).count;
  r['ClassificationMapping'] = (await prisma.classificationMapping.deleteMany({ where: { channelId: { in: channelIds } } })).count;
  r['EmailChannelPreference'] = (await prisma.emailChannelPreference.deleteMany({ where: { channelId: { in: channelIds } } })).count;
  r['AppIncomingWebhook'] = (await prisma.appIncomingWebhook.deleteMany({ where: { channelId: { in: channelIds } } })).count;
  r['CanvasFolder'] = (await prisma.canvasFolder.deleteMany({ where: { channelId: { in: channelIds } } })).count;
  r['Call'] = (await prisma.call.deleteMany({ where: { channelId: { in: channelIds } } })).count;
  r['ScheduledMessage'] = (await prisma.scheduledMessage.deleteMany({ where: { channelId: { in: channelIds } } })).count;
  r['Link'] = (await prisma.link.deleteMany({ where: { channelId: { in: channelIds } } })).count;
  r['SurfaceNudgeCount'] = (await prisma.surfaceNudgeCount.deleteMany({ where: { channelId: { in: channelIds } } })).count;

  // 9. ExternalSource
  if (sourceIds.length > 0) {
    r['ExternalSource'] = (await prisma.externalSource.deleteMany({
      where: { id: { in: sourceIds } },
    })).count;
  }

  // 10. ConversationParticipant backup (catches orphaned rows with channelId but no matching conversationId)
  r['ConversationParticipant'] = ((r['ConversationParticipant'] ?? 0) as number) +
    (await prisma.conversationParticipant.deleteMany({ where: { channelId: { in: channelIds } } })).count;

  // 11. Channel
  r['Channel'] = (await prisma.channel.deleteMany({ where: { id: { in: channelIds } } })).count;

  return r;
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
