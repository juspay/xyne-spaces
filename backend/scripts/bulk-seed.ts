#!/usr/bin/env npx tsx
/// <reference types="node" />

/**
 * Bulk Data Seeding Script — for reproducing the activity-switch memory leak.
 *
 * Generates a HIGH volume of channels / DMs / group-DMs, each with multiple
 * conversations, many messages, threads and reactions, so the chat sidebar has
 * hundreds of rows and switching between channels mounts/unmounts enough DOM to
 * surface the leak in a heap snapshot.
 *
 * PREREQUISITE: run the base seeds first so users / workspace / project exist:
 *   npm run db:seed
 *   npx tsx scripts/dummy-seed.ts
 *
 * Usage:
 *   npx tsx scripts/bulk-seed.ts
 *   CHANNELS=400 MSGS_PER_CONV=25 CONVS_PER=4 DMS=80 GROUP_DMS=20 npx tsx scripts/bulk-seed.ts
 *   BULK_WIPE=1 npx tsx scripts/bulk-seed.ts   # remove previous bulk data, then reseed
 *
 * All generated entities are name-prefixed `bulk-` so BULK_WIPE can find them.
 * Tables here have no FK constraints (per schema comments) so children are
 * deleted explicitly by collected ids.
 */

import { PrismaClient, ChannelType, ChannelScopeType, ChannelVisibility, ChannelRole, MessageType, AuthProvider, UserStatus, OrgRole, WorkspaceRole, ActivityClassification } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { serializeInitialMessageMd } from '@xyne/shared';

const prisma = new PrismaClient();

// ---- knobs ----
const DUMMY_USERS = Number(process.env.DUMMY_USERS ?? 12);
const CHANNELS = Number(process.env.CHANNELS ?? 400);
const CONVS_PER = Number(process.env.CONVS_PER ?? 4);
const MSGS_PER_CONV = Number(process.env.MSGS_PER_CONV ?? 25);
const DMS = Number(process.env.DMS ?? 80);
const GROUP_DMS = Number(process.env.GROUP_DMS ?? 20);
const REPLIES_PER_CONV = Number(process.env.REPLIES_PER_CONV ?? 6); // thread replies (showInChannel=false)
const REACT_EVERY = Number(process.env.REACT_EVERY ?? 7); // 1 reaction per N messages
const ACTIVITIES = Number(process.env.ACTIVITIES ?? 40); // mention activities (dummy user @-mentions me)

const NAME_PREFIX = 'bulk-';
const BULK_MARKER = '[bulk-seed]'; // stamped into channel.description so wipe can find ALL bulk channels — DMs can't use a name prefix (their name must be the participant-id list)
const USER_EMAIL_PREFIX = 'bulk-user-'; // @xyne.test — so wipe can find them
const FIRST = ['Aria', 'Ravi', 'Mei', 'Diego', 'Nina', 'Omar', 'Yuki', 'Leah', 'Kofi', 'Sana', 'Theo', 'Ivy', 'Hugo', 'Zara', 'Eli', 'Priya'];
const LAST = ['Patel', 'Kim', 'Silva', 'Khan', 'Nguyen', 'Cohen', 'Okafor', 'Mensah', 'Rao', 'Tanaka', 'Lopez', 'Singh'];
const AV_BG = ['6276BE', 'E91E63', '4CAF50', 'FF9800', '9C27B0', '009688', 'F44336', '3F51B5', '795548', '607D8B'];
const EMOJIS = ['👍', '🔥', '🎉', '❤️', '😄', '🙏', '👀', '🚀', '✨', '💯'];
const SAMPLE = [
  'Pushed the latest changes, please review when you get a chance.',
  'Can we sync on this tomorrow morning?',
  'Found an edge case in the parser — opening a ticket.',
  'LGTM 🚀',
  'Deploy is green. Monitoring the dashboards now.',
  'Anyone else seeing the flaky test on CI?',
  'Updated the docs with the new flow.',
  'Great work on this, shipping it.',
  'Re-ran the heap snapshot, numbers look better.',
  'Moving this to next sprint, too much scope.',
];

const now = Date.now();
const minsAgo = (m: number) => new Date(now - m * 60_000);
let meId = ''; // logged-in user id, set in main() — the activity receiver
const pick = <T,>(arr: T[], i: number): T => arr[i % arr.length];

type U = { id: string; email: string };

async function getFoundation() {
  // The user whose sidebar gets the channels — override with SEED_USER_EMAIL to
  // match whoever you log in as locally. Falls back to the first user in the DB.
  const targetEmail = process.env.SEED_USER_EMAIL ?? 'john.developer@xyne.ai';

  let me = await prisma.user.findFirst({ where: { email: targetEmail }, select: { id: true, email: true } });
  if (!me) {
    me = await prisma.user.findFirst({ select: { id: true, email: true } });
    if (me) console.log(`  ⚠️  "${targetEmail}" not found — using first user "${me.email}". Set SEED_USER_EMAIL to target another.`);
  }
  if (!me) throw new Error('No users in DB. Run `npm run db:seed` (and optionally dummy-seed.ts) first.');

  const project = await prisma.project.findFirst({ select: { id: true, workspaceId: true } });
  if (!project) throw new Error('No project found. Run a base seed first.');

  const orgMember = await prisma.orgMember.findFirst({ select: { orgId: true } });
  if (!orgMember) throw new Error('No org member found. Run a base seed first.');

  return { me, project, orgId: orgMember.orgId };
}

/**
 * Create (or reuse) dummy people so DMs / message senders show real names +
 * avatars instead of "unknown user". Each needs an OrgMember (email unique) and
 * a User row with workspaceId + orgMemberId. Idempotent by email prefix.
 */
async function ensureDummyUsers(workspaceId: string, orgId: string): Promise<U[]> {
  const existing = await prisma.user.findMany({
    where: { email: { startsWith: USER_EMAIL_PREFIX } },
    select: { id: true, email: true },
  });
  const byEmail = new Map(existing.map(u => [u.email, u]));
  const out: U[] = [];
  for (let i = 0; i < DUMMY_USERS; i++) {
    const email = `${USER_EMAIL_PREFIX}${String(i).padStart(3, '0')}@xyne.test`;
    const hit = byEmail.get(email);
    if (hit) { out.push(hit); continue; }
    const name = `${pick(FIRST, i)} ${pick(LAST, i + 3)}`;
    const memberId = createId();
    await prisma.orgMember.create({ data: { memberId, orgId, email, role: OrgRole.MEMBER } });
    const u = await prisma.user.create({
      data: {
        name,
        email,
        picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${pick(AV_BG, i)}&color=fff`,
        authProvider: AuthProvider.GOOGLE,
        providerUserId: `bulk-${memberId}`,
        status: UserStatus.ACTIVE,
        workspaceId,
        orgMemberId: memberId,
        role: WorkspaceRole.MEMBER,
      },
      select: { id: true, email: true },
    });
    out.push(u);
  }
  return out;
}

async function wipe() {
  const chans = await prisma.channel.findMany({
    where: {
      OR: [
        { description: { contains: BULK_MARKER } }, // new marker
        { description: { contains: 'bulk seed' } }, // legacy description
        { name: { startsWith: NAME_PREFIX } }, // legacy non-DM names
      ],
    },
    select: { id: true },
  });
  if (!chans.length) { console.log('  (nothing to wipe)'); return; }
  const channelIds = chans.map(c => c.id);
  const convs = await prisma.conversation.findMany({ where: { channelId: { in: channelIds } }, select: { conversationId: true } });
  const convIds = convs.map(c => c.conversationId);
  const msgs = convIds.length
    ? await prisma.message.findMany({ where: { conversationId: { in: convIds } }, select: { messageId: true } })
    : [];
  const msgIds = msgs.map(m => m.messageId);
  console.log(`  wiping ${channelIds.length} channels, ${convIds.length} conversations, ${msgIds.length} messages...`);
  if (msgIds.length) {
    await prisma.reaction.deleteMany({ where: { messageId: { in: msgIds } } });
    await prisma.reactionCount.deleteMany({ where: { messageId: { in: msgIds } } });
    await prisma.message.deleteMany({ where: { messageId: { in: msgIds } } });
  }
  if (convIds.length) {
    // ConversationParticipant has a real FK to Conversation — must clear first.
    // (Created by the backend's mutation-sync when it processes replicated rows.)
    await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversation.deleteMany({ where: { conversationId: { in: convIds } } });
  }
  await prisma.channelParticipant.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.channelUserStatus.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.channelStats.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.activity.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
  // dummy users + their org members
  const du = await prisma.user.deleteMany({ where: { email: { startsWith: USER_EMAIL_PREFIX } } });
  const om = await prisma.orgMember.deleteMany({ where: { email: { startsWith: USER_EMAIL_PREFIX } } });
  console.log(`  ✅ wipe done (removed ${du.count} dummy users, ${om.count} org members)`);
}

// accumulators (flushed in batches)
const channels: any[] = [];
const channelStats: any[] = [];
const participants: any[] = [];
const statuses: any[] = [];
const conversations: any[] = [];
const messages: any[] = [];
const reactions: any[] = [];
const reactionCounts: any[] = [];
const activities: any[] = [];

function addConversationWithMessages(
  channelId: string,
  members: U[],
  convIndex: number,
  baseMinutes: number,
) {
  const conversationId = createId();
  const msgIds: string[] = [];
  const total = MSGS_PER_CONV + REPLIES_PER_CONV;
  // capture the initial (k=0) message so we can denormalize it onto the conversation
  let initialMd: string | null = null;
  for (let k = 0; k < total; k++) {
    const messageId = createId();
    msgIds.push(messageId);
    // offset by convIndex so the initial message (k=0) — the one shown in the
    // channel feed — rotates across members instead of always being members[0] (me)
    const sender = pick(members, convIndex + k);
    const isReply = k >= MSGS_PER_CONV;
    const content = pick(SAMPLE, convIndex + k);
    const createdAt = minsAgo(baseMinutes - k);
    messages.push({
      messageId,
      conversationId,
      senderId: sender.id,
      content,
      msgType: MessageType.USER,
      showInChannel: !isReply, // replies are thread-only
      createdAt,
    });
    if (k === 0) {
      // The chat view renders message bubbles from conversation.initial_message_md
      // (a denormalized summary), NOT from the messages table directly. The backend
      // mutation handler writes this on send; a raw insert must replicate it or the
      // chat view shows date pills with no messages.
      initialMd = serializeInitialMessageMd({
        messageId,
        conversationId,
        senderId: sender.id,
        content,
        msgType: MessageType.USER,
        hasAttachment: false,
        edited: false,
        isDeleted: false,
        showInChannel: true,
        visibleTo: null,
        createdAt: createdAt.getTime(),
        isSent: true,
      });
    }
    if (k % REACT_EVERY === 0) {
      const emoji = pick(EMOJIS, k);
      const reactor = pick(members, k + 1);
      reactions.push({ messageId, userId: reactor.id, emojiName: emoji });
      reactionCounts.push({ messageId, emojiName: emoji, count: 1 });
    }
    // Mention activity: one per channel (conv 0, k=1 — sender is a dummy, not me),
    // up to ACTIVITIES. Shows in the Activity page as "<dummy> mentioned you".
    if (convIndex === 0 && k === 1 && sender.id !== meId && activities.length < ACTIVITIES) {
      activities.push({
        userId: meId, // receiver = me
        actorId: sender.id, // who mentioned me
        actorAction: 'mentioned_user',
        actionSource: 'message',
        actionSourceId: messageId,
        messageId,
        conversationId,
        channelId,
        classification: ActivityClassification.ACTIONABLE,
        isRead: false,
        createdAt: minsAgo(baseMinutes - k),
        updatedAt: minsAgo(baseMinutes - k),
      });
    }
  }
  conversations.push({
    conversationId,
    channelId,
    createdBy: members[0].id,
    initialMessageId: msgIds[0],
    // MUST set a distinct createdAt. Prisma createMany is a single INSERT and the
    // column default now() returns the transaction timestamp — identical for every
    // row. The channel feed paginates with a cursor keyed on createdAt
    // (channelConversationsPaginatedV3 .start({createdAt})); tied timestamps make the
    // cursor return nothing → no messages render. baseMinutes is unique per conv.
    createdAt: minsAgo(baseMinutes),
    lastActivityAt: minsAgo(baseMinutes - (total - 1)),
    replyCount: REPLIES_PER_CONV,
    pinned: convIndex === 0,
    initial_message_md: initialMd, // denormalized initial message — drives the chat-view bubble
  });
}

function addChannel(
  opts: { name: string; scopeType: ChannelScopeType; visibility: ChannelVisibility; members: U[]; projectId: string; workspaceId: string; createdBy: string },
  idx: number,
) {
  const channelId = createId();
  // DM/Group-DM display names are derived client-side by splitting channel.name on
  // commas into participant userIds (see ChatDirectory.utils parseDMParticipantIds).
  // So a DM's name MUST be the sorted comma-joined member ids, NOT a "bulk-" label —
  // otherwise every participant resolves to "Unknown User".
  const isDm = opts.scopeType === ChannelScopeType.DM || opts.scopeType === ChannelScopeType.GROUP_DM;
  const channelName = isDm ? opts.members.map(m => m.id).sort().join(',') : opts.name;
  channels.push({
    id: channelId,
    name: channelName,
    description: `${opts.name} ${BULK_MARKER}`,
    type: ChannelType.DEFAULT,
    scopeType: opts.scopeType,
    visibility: opts.visibility,
    createdBy: opts.createdBy,
    projectId: opts.projectId,
    workspaceId: opts.workspaceId,
    participantCount: opts.members.length,
    isMigrated: false,
    lastActivityAt: minsAgo(idx),
  });
  // channel_stats — the DM list (dmChannelsLatestMessagesPaginated) queries this table,
  // NOT channels. No stats row → DM never appears in the DM page list.
  channelStats.push({
    channelId,
    lastActivityAt: minsAgo(idx),
    participantCount: opts.members.length,
  });
  opts.members.forEach((u, mi) => {
    participants.push({ channelId, userId: u.id, role: mi === 0 ? ChannelRole.ADMIN : ChannelRole.MEMBER });
    statuses.push({
      channelId,
      userId: u.id,
      unreadCount: u.id === opts.createdBy ? Math.floor(Math.random() * 6) : 0,
      isStarred: mi === 0 && idx % 9 === 0,
    });
  });
  for (let c = 0; c < CONVS_PER; c++) {
    addConversationWithMessages(channelId, opts.members, c, idx * 100 + c * 30);
  }
}

async function flush() {
  const chunk = 1000;
  const batched = async (label: string, rows: any[], fn: (slice: any[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += chunk) await fn(rows.slice(i, i + chunk));
    console.log(`    ✅ ${rows.length} ${label}`);
  };
  // order: channels -> stats -> participants/status -> conversations -> messages -> reactions
  await batched('channels', channels, s => prisma.channel.createMany({ data: s }));
  await batched('channel stats', channelStats, s => prisma.channelStats.createMany({ data: s }));
  await batched('participants', participants, s => prisma.channelParticipant.createMany({ data: s }));
  await batched('channel statuses', statuses, s => prisma.channelUserStatus.createMany({ data: s }));
  await batched('conversations', conversations, s => prisma.conversation.createMany({ data: s }));
  await batched('messages', messages, s => prisma.message.createMany({ data: s }));
  await batched('reactions', reactions, s => prisma.reaction.createMany({ data: s }));
  await batched('reaction counts', reactionCounts, s => prisma.reactionCount.createMany({ data: s }));
  await batched('activities', activities, s => prisma.activity.createMany({ data: s }));
}

async function main() {
  console.log('🌱 Bulk seeding for leak repro...\n');
  // Safety guard: this script wipes + writes high volumes of data. Refuse to run
  // anywhere but development so it can never touch staging/prod by accident.
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development') {
    console.error(`❌ Refusing to run: NODE_ENV is "${nodeEnv}", expected "development".`);
    console.error('   This is a destructive dev-only seed. Set NODE_ENV=development to proceed.');
    process.exit(1);
  }
  if (process.env.BULK_WIPE === '1') {
    console.log('🧹 Wiping previous bulk data...');
    await wipe();
  }
  const { me, project, orgId } = await getFoundation();
  meId = me.id; // activity receiver
  console.log(`  using user=${me.email} project=${project.id} workspace=${project.workspaceId} org=${orgId}`);
  console.log(`  config: DUMMY_USERS=${DUMMY_USERS} CHANNELS=${CHANNELS} CONVS_PER=${CONVS_PER} MSGS_PER_CONV=${MSGS_PER_CONV} DMS=${DMS} GROUP_DMS=${GROUP_DMS}\n`);

  console.log('  Ensuring dummy users...');
  const others = await ensureDummyUsers(project.workspaceId, orgId);
  console.log(`    ✅ ${others.length} dummy users ready`);

  const everyone: U[] = [me, ...others];

  // public + private channels (me always a member so they show in my sidebar)
  const rotate = (start: number, n: number): U[] =>
    Array.from({ length: n }, (_, k) => others[(start + k) % others.length]);
  for (let i = 0; i < CHANNELS; i++) {
    const memberCount = 2 + (i % 3); // 2..4 members
    const members = [me, ...rotate(i, memberCount - 1)]; // rotate dummy users for variety
    addChannel({
      name: `${NAME_PREFIX}ch-${String(i).padStart(4, '0')}`,
      scopeType: ChannelScopeType.DEFAULT,
      visibility: i % 4 === 0 ? ChannelVisibility.PRIVATE : ChannelVisibility.PUBLIC,
      members,
      projectId: project.id,
      workspaceId: project.workspaceId,
      createdBy: me.id,
    }, i);
  }

  // 1:1 DMs
  for (let i = 0; i < DMS; i++) {
    const other = pick(others, i);
    addChannel({
      name: `${NAME_PREFIX}dm-${String(i).padStart(4, '0')}`,
      scopeType: ChannelScopeType.DM,
      visibility: ChannelVisibility.PRIVATE,
      members: [me, other],
      projectId: project.id,
      workspaceId: project.workspaceId,
      createdBy: me.id,
    }, CHANNELS + i);
  }

  // group DMs
  for (let i = 0; i < GROUP_DMS; i++) {
    addChannel({
      name: `${NAME_PREFIX}gdm-${String(i).padStart(4, '0')}`,
      scopeType: ChannelScopeType.GROUP_DM,
      visibility: ChannelVisibility.PRIVATE,
      members: everyone.slice(0, 3 + (i % 2)),
      projectId: project.id,
      workspaceId: project.workspaceId,
      createdBy: me.id,
    }, CHANNELS + DMS + i);
  }

  console.log('  Flushing to DB...');
  await flush();
  console.log(`\n✅ Done. ${channels.length} channels, ${conversations.length} conversations, ${messages.length} messages, ${reactions.length} reactions.`);
}

main()
  .catch(e => { console.error('❌ Bulk seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
