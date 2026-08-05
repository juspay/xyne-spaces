#!/usr/bin/env tsx
/// <reference types="node" />

/**
 * Demo Data Seeding Script
 *
 * Seeds a workspace that looks lived-in: a team of people talking in #general and
 * a few topic channels about how they actually use Spaces, plus the tickets,
 * board, and project those conversations refer to.
 *
 * Everything it writes is also queued for Vespa, so search works on the seeded
 * data. The queue is Redis-backed (Bull): if Vespa or the worker is down the jobs
 * simply wait there and drain when `pnpm --filter xyne-spaces-backend dev:worker`
 * comes up. Nothing is lost and no separate backfill is needed.
 *
 * PREREQUISITE: the ACL seed must have run first, so the default workspace and
 * organization exist:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-acl.ts
 *
 * Usage:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/demo-seed.ts
 *   DEMO_WIPE=1 …                      # remove previous demo data, then reseed
 *   DEMO_SKIP_VESPA=1 …                # seed Postgres only, queue nothing
 *
 * Idempotent: re-running detects the existing demo data and stops rather than
 * creating a second copy. Use DEMO_WIPE=1 to start over.
 */

import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { hashPassword } from '../src/utils/passwordUtils';
import {
  serializeInitialMessageMd,
  serializeTicketMd,
  MessageType,
  TicketStatusV2,
  TicketPriority,
  ChannelType,
  ChannelScopeType,
  ChannelVisibility,
  ChannelRole,
  AuthProvider,
  UserStatus,
  OrgRole,
  WorkspaceRole,
} from '@xyne/shared';
import { CHANNELS, DEMO_USERS, TICKETS, type Line } from './demo-seed-content';

const prisma = new PrismaClient();

/**
 * Everything seeded hangs off one project, found by its code. That is the handle
 * DEMO_WIPE uses, so nothing needs a marker string in a name or description that
 * a user would actually see.
 */
const PROJECT_CODE = 'PLAT';
const PROJECT_NAME = 'Platform';
const BOARD_NAME = 'Delivery';
/** Distinct domain so the seeded people can be cleaned up without touching real accounts. */
const DEMO_EMAIL_DOMAIN = '@xyne.team';
/** Shared password for the seeded teammates — same shape as the dev admin's. */
const DEMO_USER_PASSWORD = 'xynelocal@123';

const WIPE = process.env.DEMO_WIPE === '1';
const SKIP_VESPA = process.env.DEMO_SKIP_VESPA === '1';

const now = Date.now();
/** Distinct, ordered timestamps. Conversations MUST NOT share a createdAt — the
 *  channel feed paginates on a createdAt cursor and ties make it return nothing. */
const minsAgo = (m: number) => new Date(now - m * 60_000);

type SeededUser = { id: string; email: string; name: string };

/** Collected as we go, then queued for Vespa in one pass at the end. */
const vespaJobs: Array<{ schema: string; docId: string }> = [];

// ---------------------------------------------------------------------------
// Foundation — what seed-acl.ts already created
// ---------------------------------------------------------------------------

async function getFoundation() {
  const workspace = await prisma.workspace.findFirst({
    where: { name: 'Default Workspace' },
    select: { id: true, name: true },
  });
  if (!workspace) {
    throw new Error(
      'No "Default Workspace" found. Run the ACL seed first:\n' +
        '  pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-acl.ts'
    );
  }

  const orgMember = await prisma.orgMember.findFirst({ select: { orgId: true } });
  if (!orgMember) throw new Error('No organization found. Run scripts/seed-acl.ts first.');

  // The admin becomes user 0 — the person logging in sees themselves in the team.
  const admin = await prisma.user.findFirst({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true },
  });

  return { workspace, orgId: orgMember.orgId, admin };
}

// ---------------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------------

async function wipe() {
  const seededProject = await prisma.project.findFirst({
    where: { code: PROJECT_CODE },
    select: { id: true },
  });

  // Channels are found by project rather than by a marker in their description,
  // so nothing user-visible has to carry a tag.
  const channels = seededProject
    ? await prisma.channel.findMany({ where: { projectId: seededProject.id }, select: { id: true } })
    : [];
  const channelIds = channels.map((c) => c.id);

  // Tickets first: Ticket→Channel is a required relation, so deleting a channel
  // out from under a ticket fails with a TicketChannel constraint error.
  if (seededProject) {
    await prisma.ticket.deleteMany({ where: { projectId: seededProject.id } });
  }
  if (channelIds.length) {
    await prisma.ticket.deleteMany({ where: { channelId: { in: channelIds } } });
  }

  if (channelIds.length) {
    const convs = await prisma.conversation.findMany({
      where: { channelId: { in: channelIds } },
      select: { conversationId: true },
    });
    const convIds = convs.map((c) => c.conversationId);
    const msgs = convIds.length
      ? await prisma.message.findMany({
          where: { conversationId: { in: convIds } },
          select: { messageId: true },
        })
      : [];
    const msgIds = msgs.map((m) => m.messageId);

    if (msgIds.length) {
      await prisma.reaction.deleteMany({ where: { messageId: { in: msgIds } } });
      await prisma.reactionCount.deleteMany({ where: { messageId: { in: msgIds } } });
      await prisma.message.deleteMany({ where: { messageId: { in: msgIds } } });
    }
    if (convIds.length) {
      await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: convIds } } });
      await prisma.conversation.deleteMany({ where: { conversationId: { in: convIds } } });
    }
    await prisma.channelParticipant.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.channelUserStatus.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.channelStats.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.activity.deleteMany({ where: { channelId: { in: channelIds } } });
    await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
  }

  if (seededProject) {
    await prisma.ticket.deleteMany({ where: { projectId: seededProject.id } });
    const boards = await prisma.board.findMany({
      where: { projectId: seededProject.id },
      select: { id: true },
    });
    const boardIds = boards.map((b) => b.id);
    if (boardIds.length) await prisma.stage.deleteMany({ where: { boardId: { in: boardIds } } });
    await prisma.board.deleteMany({ where: { projectId: seededProject.id } });
    await prisma.project.deleteMany({ where: { id: seededProject.id } });
  }

  const users = await prisma.user.deleteMany({ where: { email: { endsWith: DEMO_EMAIL_DOMAIN } } });
  const members = await prisma.orgMember.deleteMany({ where: { email: { endsWith: DEMO_EMAIL_DOMAIN } } });

  console.log(
    `  🧹 wiped ${channelIds.length} channels, ${users.count} users, ${members.count} org members`
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

async function ensureUsers(workspaceId: string, orgId: string, admin: SeededUser | null) {
  const out: SeededUser[] = [];

  for (let i = 0; i < DEMO_USERS.length; i++) {
    const person = DEMO_USERS[i];
    const name = `${person.first} ${person.last}`;

    // Index 0 is the person who logs in — reuse the real admin rather than
    // creating a lookalike they cannot sign in as.
    if (i === 0 && admin) {
      out.push({ id: admin.id, email: admin.email, name: admin.name ?? name });
      continue;
    }

    const email = `${person.first.toLowerCase()}.${person.last.toLowerCase()}${DEMO_EMAIL_DOMAIN}`;
    const existing = await prisma.user.findFirst({
      where: { email },
      select: { id: true, email: true, name: true },
    });
    if (existing) {
      out.push({ id: existing.id, email: existing.email, name: existing.name ?? name });
      continue;
    }

    const memberId = createId();

    // These are password accounts, not SSO ones. Three things have to agree or
    // email+password login rejects them (see emailAuthController):
    //
    //   orgMember.passwordHash   — the login path verifies against this, and
    //                              bails with "no password set" when it is null
    //   authProvider = EMAIL     — a non-EMAIL provider is refused outright with
    //                              provider_mismatch; account linking is
    //                              deliberately unsupported
    //   providerUserId           — `email-<address>`, the convention
    //                              migrateLegacyIdentity writes
    //
    // Seeding these as GOOGLE produced users who look right in the UI and cannot
    // sign in at all.
    await prisma.orgMember.create({
      data: {
        memberId,
        orgId,
        email,
        role: OrgRole.MEMBER,
        passwordHash: await hashPassword(DEMO_USER_PASSWORD),
      },
    });
    const user = await prisma.user.create({
      data: {
        name,
        email,
        picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`,
        authProvider: AuthProvider.EMAIL,
        providerUserId: `email-${email}`,
        status: UserStatus.ACTIVE,
        workspaceId,
        orgMemberId: memberId,
        role: WorkspaceRole.MEMBER,
      },
      select: { id: true, email: true, name: true },
    });
    out.push({ id: user.id, email: user.email, name: user.name ?? name });
    vespaJobs.push({ schema: 'user', docId: user.id });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Project, board, stages
// ---------------------------------------------------------------------------

const STAGES = ['Triage', 'In Progress', 'In Review', 'Done'];

async function ensureProjectAndBoard(workspaceId: string, createdBy: string) {
  const project = await prisma.project.create({
    data: {
      name: PROJECT_NAME,
      code: PROJECT_CODE,
      description: 'Product and platform work — onboarding, imports, dashboards, and the rest.',
      workspaceId,
      createdBy,
    },
    select: { id: true },
  });
  vespaJobs.push({ schema: 'project', docId: project.id });

  const board = await prisma.board.create({
    data: {
      name: BOARD_NAME,
      projectId: project.id,
      workspaceId,
      createdBy,
      description: 'What the team is working on, by stage.',
    },
    select: { id: true },
  });

  for (let i = 0; i < STAGES.length; i++) {
    await prisma.stage.create({
      data: {
        name: STAGES[i],
        boardId: board.id,
        workspaceId,
        sequenceNumber: i + 1,
        createdBy,
      },
    });
  }

  return { projectId: project.id, boardId: board.id };
}

// ---------------------------------------------------------------------------
// Channels, conversations, messages
// ---------------------------------------------------------------------------

/**
 * Writes one conversation — which in this product *is* a thread.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * 1. The channel feed lists conversations, not messages. Each top-level remark
 *    is therefore its own conversation, and its replies are further messages in
 *    that same conversation. Cramming many top-level remarks into one
 *    conversation renders as a single feed row with everything buried inside it.
 *
 * 2. `showInChannel` does NOT mean "visible in the channel". It marks a thread
 *    reply that was additionally broadcast to the channel, and the UI treats
 *    those specially — ChatBubble computes `isShowInChannel` from it and then
 *    withholds the "reply in thread" action (`!isShowInChannel` gates it). Seed
 *    ordinary messages with `false` or nothing offers a reply on hover.
 *
 * `initial_message_md` is a denormalized copy of the first message; the chat view
 * renders bubbles from it, not from the messages table, so skipping it shows date
 * separators with no messages under them.
 */
async function createConversation(
  channelId: string,
  workspaceId: string,
  members: SeededUser[],
  parent: Line,
  replies: Line[],
  baseMinutes: number
) {
  const conversationId = createId();
  const lines = [parent, ...replies];
  const messageIds: string[] = [];
  let initialMd: string | null = null;

  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    const messageId = createId();
    messageIds.push(messageId);

    const sender = members[line.from % members.length];
    const createdAt = minsAgo(baseMinutes - k);

    await prisma.message.create({
      data: {
        messageId,
        conversationId,
        senderId: sender.id,
        // Denormalized from the conversation for ACL filtering. Rows without it
        // fall outside the workspace-scoped queries the client runs.
        workspaceId,
        content: line.text,
        msgType: MessageType.USER,
        showInChannel: false,
        createdAt,
      },
    });
    vespaJobs.push({ schema: 'chat_message', docId: messageId });

    if (k === 0) {
      initialMd = serializeInitialMessageMd({
        messageId,
        conversationId,
        senderId: sender.id,
        content: line.text,
        msgType: MessageType.USER,
        hasAttachment: false,
        edited: false,
        isDeleted: false,
        showInChannel: false,
        visibleTo: null,
        createdAt: createdAt.getTime(),
        isSent: true,
      });
    }

    if (line.react) {
      const reactor = members[(line.from + 1) % members.length];
      await prisma.reaction.create({
        data: { messageId, userId: reactor.id, emojiName: line.react, workspaceId },
      });
      await prisma.reactionCount.create({
        data: { messageId, emojiName: line.react, count: 1, workspaceId },
      });
    }
  }

  await prisma.conversation.create({
    data: {
      conversationId,
      channelId,
      workspaceId,
      createdBy: members[parent.from % members.length].id,
      initialMessageId: messageIds[0],
      createdAt: minsAgo(baseMinutes),
      lastActivityAt: minsAgo(baseMinutes - (lines.length - 1)),
      replyCount: replies.length,
      initial_message_md: initialMd,
    },
  });

  return { conversationId, messageIds };
}

async function createChannels(
  users: SeededUser[],
  workspaceId: string,
  projectId: string
) {
  const created: Array<{ id: string; slug: string; conversationId: string }> = [];

  for (let i = 0; i < CHANNELS.length; i++) {
    const spec = CHANNELS[i];
    const members = spec.members.map((idx) => users[idx]);
    const admin = members[0];
    const channelId = createId();

    await prisma.channel.create({
      data: {
        id: channelId,
        name: spec.slug,
        description: spec.purpose,
        type: ChannelType.DEFAULT,
        scopeType: ChannelScopeType.DEFAULT,
        visibility: ChannelVisibility.PUBLIC,
        createdBy: admin.id,
        projectId,
        workspaceId,
        participantCount: members.length,
        isMigrated: false,
        lastActivityAt: minsAgo(i),
      },
    });
    vespaJobs.push({ schema: 'chat_container', docId: channelId });

    // The DM/channel lists read channel_stats, not channels — without a row the
    // channel does not appear in the sidebar.
    await prisma.channelStats.create({
      data: { channelId, lastActivityAt: minsAgo(i), participantCount: members.length, workspaceId },
    });

    for (let m = 0; m < members.length; m++) {
      await prisma.channelParticipant.create({
        data: {
          channelId,
          userId: members[m].id,
          role: m === 0 ? ChannelRole.ADMIN : ChannelRole.MEMBER,
          workspaceId,
        },
      });
      await prisma.channelUserStatus.create({
        data: { channelId, userId: members[m].id, unreadCount: 0, isStarred: spec.slug === 'general', workspaceId },
      });
    }

    // Each top-level line becomes its own conversation — that is one row in the
    // channel feed. Lines carrying `to` are replies and join the conversation of
    // the line they point at, which is what makes a thread.
    let firstConversationId = '';
    let conversationCount = 0;

    for (let c = 0; c < spec.conversations.length; c++) {
      const lines = spec.conversations[c].lines;

      const threads: Array<{ parent: Line; replies: Line[] }> = [];
      const indexOfThread = new Map<number, number>(); // line index → threads[] index

      lines.forEach((line, idx) => {
        if (line.to === undefined) {
          indexOfThread.set(idx, threads.length);
          threads.push({ parent: line, replies: [] });
          return;
        }
        // Attach to the thread of the referenced line, falling back to the most
        // recent one if the reference points at another reply.
        const target = indexOfThread.get(line.to);
        const thread = target !== undefined ? threads[target] : threads[threads.length - 1];
        if (thread) thread.replies.push(line);
        else threads.push({ parent: line, replies: [] });
      });

      for (let t = 0; t < threads.length; t++) {
        // Unique, widely separated base so no two conversations tie on createdAt.
        const base = (i + 1) * 10000 + c * 500 + t * 20;
        const { conversationId } = await createConversation(
          channelId,
          workspaceId,
          members,
          threads[t].parent,
          threads[t].replies,
          base
        );
        if (!firstConversationId) firstConversationId = conversationId;
        conversationCount++;
      }
    }

    created.push({ id: channelId, slug: spec.slug, conversationId: firstConversationId });
    console.log(`  💬 #${spec.slug} — ${conversationCount} conversations, ${members.length} members`);
  }

  return created;
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

const STATUS_TO_STAGE: Record<string, string> = {
  TODO: 'Triage',
  STARTED: 'In Progress',
  COMPLETED: 'Done',
};

/** Which channel each ticket is raised in, by slug. Falls back to general. */
const TICKET_CHANNEL: Record<number, string> = {
  0: 'product',
  1: 'engineering',
  2: 'general',
  3: 'product',
  4: 'design',
  5: 'general',
  6: 'engineering',
  7: 'engineering',
  8: 'general',
  9: 'product',
  10: 'design',
  11: 'engineering',
  12: 'customer-voice',
  13: 'customer-voice',
  14: 'incidents',
  15: 'onboarding',
  16: 'announcements',
  17: 'knowledge',
  18: 'claw-lab',
  19: 'automations',
  20: 'automations',
  21: 'automations',
  22: 'claw-lab',
  23: 'claw-lab',
};

/**
 * Creates the tickets, each with its own conversation in a channel.
 *
 * A ticket shows up in a channel through its conversation, not through the
 * ticket row: the bubble renders when `conversation.ticket_md` is present
 * (MessageBubble checks `conversation.ticket_md` before drawing the card). So
 * three things have to line up —
 *
 *   ticket.conversationId  → the conversation
 *   conversation.ticketId  → back to the ticket
 *   conversation.ticket_md → the denormalized card the UI actually draws
 *
 * Setting only ticket.conversationId creates a ticket that exists on the board
 * and is invisible in the channel, which is exactly what it looked like.
 */
async function createTickets(
  users: SeededUser[],
  workspaceId: string,
  projectId: string,
  boardId: string,
  channels: Array<{ id: string; slug: string; conversationId: string }>
) {
  const bySlug = new Map(channels.map((c) => [c.slug, c]));
  const fallback = bySlug.get('general') ?? channels[0];

  for (let i = 0; i < TICKETS.length; i++) {
    const spec = TICKETS[i];
    const reporter = users[spec.reporter % users.length];
    const assignee = users[spec.assignee % users.length];
    const channel = bySlug.get(TICKET_CHANNEL[i] ?? 'general') ?? fallback;
    const createdAt = minsAgo(600 - i * 30);

    // The conversation that carries this ticket in the channel feed.
    const conversationId = createId();
    const messageId = createId();
    const xyneId = `${PROJECT_CODE}-${i + 1}`;

    await prisma.message.create({
      data: {
        messageId,
        conversationId,
        senderId: reporter.id,
        workspaceId,
        content: spec.title,
        msgType: MessageType.USER,
        showInChannel: false,
        createdAt,
      },
    });
    vespaJobs.push({ schema: 'chat_message', docId: messageId });

    // The discussion on the ticket itself, so opening one shows people working
    // the problem rather than a bare title with no conversation under it.
    const thread = spec.thread ?? [];
    for (let m = 0; m < thread.length; m++) {
      const replyId = createId();
      const speaker = users[thread[m].from % users.length];
      await prisma.message.create({
        data: {
          messageId: replyId,
          conversationId,
          senderId: speaker.id,
          workspaceId,
          content: thread[m].text,
          msgType: MessageType.USER,
          showInChannel: false,
          createdAt: new Date(createdAt.getTime() + (m + 1) * 60_000),
        },
      });
      vespaJobs.push({ schema: 'chat_message', docId: replyId });
    }

    const ticket = await prisma.ticket.create({
      data: {
        title: spec.title,
        description: spec.description,
        statusV2: spec.status as TicketStatusV2,
        priority: spec.priority as TicketPriority,
        createdBy: reporter.id,
        updatedBy: reporter.id,
        assignedTo: assignee.id,
        conversationId,
        channelId: channel.id,
        xyneId,
        projectId,
        workspaceId,
        boardId,
        stageName: STATUS_TO_STAGE[spec.status] ?? 'Triage',
        // No DB default: every create path sets this explicitly so Zero sees the write.
        lastEmailAt: createdAt,
        createdAt,
        statusUpdatedAt: createdAt,
      },
      select: { id: true, xyneId: true },
    });

    await prisma.conversation.create({
      data: {
        conversationId,
        channelId: channel.id,
        workspaceId,
        createdBy: reporter.id,
        initialMessageId: messageId,
        ticketId: ticket.id,
        createdAt,
        lastActivityAt: new Date(createdAt.getTime() + thread.length * 60_000),
        replyCount: thread.length,
        initial_message_md: serializeInitialMessageMd({
          messageId,
          conversationId,
          senderId: reporter.id,
          content: spec.title,
          msgType: MessageType.USER,
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          showInChannel: false,
          visibleTo: null,
          createdAt: createdAt.getTime(),
          isSent: true,
        }),
        ticket_md: serializeTicketMd({
          id: ticket.id,
          title: spec.title,
          description: spec.description,
          statusV2: TicketStatusV2[spec.status],
          priority: TicketPriority[spec.priority],
          assignedTo: assignee.id,
          createdBy: reporter.id,
          createdAt: createdAt.getTime(),
          xyneId,
          stageName: STATUS_TO_STAGE[spec.status] ?? 'Triage',
          channelId: channel.id,
          conversationId,
        }),
      },
    });

    vespaJobs.push({ schema: 'ticket', docId: ticket.id });
    console.log(`  🎫 ${ticket.xyneId} — ${spec.title}  (#${channel.slug})`);
  }
}

// ---------------------------------------------------------------------------
// Vespa
// ---------------------------------------------------------------------------

/**
 * Queue everything for indexing.
 *
 * Jobs go to Redis via Bull. If Vespa is not running, or the worker is not up,
 * they stay queued and are processed when it starts — which is why `pnpm run up`
 * now starts the worker alongside the backend.
 */
async function queueForVespa(workspaceId: string, orgId: string, userId: string) {
  if (SKIP_VESPA) {
    console.log(`\n  ⏭  DEMO_SKIP_VESPA=1 — skipped queueing ${vespaJobs.length} documents`);
    return;
  }

  const { vespaQueue } = await import('../src/queues/vespaQueue');

  try {
    await vespaQueue.initialize();
  } catch (error) {
    console.warn(
      `\n  ⚠️  Could not reach Redis to queue ${vespaJobs.length} documents for search: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
    console.warn('     The data is seeded and usable; search will not find it until you re-run with Redis up.');
    return;
  }

  let queued = 0;
  for (const job of vespaJobs) {
    try {
      await vespaQueue.addJob({
        schema: job.schema as never,
        jobType: 'feed' as never,
        docId: job.docId,
        workspaceId,
        orgId,
        userId,
      } as never);
      queued++;
    } catch (error) {
      console.warn(`     failed to queue ${job.schema}/${job.docId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  await vespaQueue.close();
  console.log(`\n  🔍 Queued ${queued}/${vespaJobs.length} documents for Vespa indexing`);
  console.log('     The worker drains this queue — jobs wait in Redis until it runs.');
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\n🌱 Seeding demo data\n');

  const { workspace, orgId, admin } = await getFoundation();
  console.log(`  workspace: ${workspace.name}`);

  if (WIPE) await wipe();

  const existing = await prisma.project.findFirst({
    where: { code: PROJECT_CODE },
    select: { id: true },
  });
  if (existing) {
    console.log(`\n  ✅ Sample data is already present (project ${PROJECT_CODE}) — nothing to do.`);
    console.log('     Re-run with DEMO_WIPE=1 to replace it.\n');
    return;
  }

  const users = await ensureUsers(workspace.id, orgId, admin);
  console.log(`  👥 ${users.length} people`);

  const { projectId, boardId } = await ensureProjectAndBoard(workspace.id, users[0].id);
  console.log(`  📁 ${PROJECT_NAME} project + ${BOARD_NAME} board (${STAGES.length} stages)`);

  const channels = await createChannels(users, workspace.id, projectId);
  await createTickets(users, workspace.id, projectId, boardId, channels);

  await queueForVespa(workspace.id, orgId, users[0].id);

  const messageCount = vespaJobs.filter((j) => j.schema === 'chat_message').length;
  console.log('\n✅ Demo data ready');
  console.log(`   Seeded teammates sign in with their email and ${DEMO_USER_PASSWORD}`);
  console.log(`   ${users.length} people · ${channels.length} channels · ${messageCount} messages · ${TICKETS.length} tickets\n`);
}

main()
  .catch((error) => {
    console.error('\n❌ Demo seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
