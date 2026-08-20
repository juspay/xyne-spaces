#!/usr/bin/env npx tsx
/// <reference types="node" />

/**
 * Mature User Seeding Script — realistic 6–12 month "power user" history.
 *
 * Seeds dense but believable activity for whoever last logged in locally
 * (or SEED_USER_EMAIL): chat across Platform channels, DMs, tickets, calls,
 * canvases, notifications, bookmarks, and mention activities.
 *
 * PREREQUISITE: base seeds must have run (workspace, Platform project, channels):
 *   npm run db:seed
 *   npx tsx scripts/dummy-seed.ts   # optional extra foundation
 *
 * Usage (from apps/backend):
 *   npx tsx scripts/mature-user-seed.ts
 *   MATURE_WIPE=1 npx tsx scripts/mature-user-seed.ts
 *   COWORKERS=18 TICKETS=100 CALLS=55 npx tsx scripts/mature-user-seed.ts
 *
 * Wipe: MATURE_WIPE=1 removes data tagged with [mature-seed] / metadata.seed=mature.
 * Re-run without wipe is idempotent for coworkers and marker channels; skips if
 * mature tickets already exist unless MATURE_WIPE=1.
 */

import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import {
  serializeInitialMessageMd,
  serializeTicketMd,
  ChannelType,
  ChannelScopeType,
  ChannelVisibility,
  ChannelRole,
  MessageType,
  AuthProvider,
  UserStatus,
  OrgRole,
  WorkspaceRole,
  ActivityClassification,
  TicketStatus,
  TicketStatusV2,
  TicketPriority,
  CallType,
  CallStatus,
  InvitationResponse,
  NotificationType,
  NotificationStatus,
  NotificationDeliveryMethod,
  CanvasVisibility,
  CanvasRole,
  BookmarkEntityType,
  DocType,
  ProjectType,
} from '@xyne/shared';

const prisma = new PrismaClient();

// ---- knobs ----
// Prefer defaults when an env var is unset, empty, or non-positive (shells often
// leak MSGS_PER_CONV=0 / DMS=0 from unrelated bulk-seed experiments).
const envInt = (name: string, fallback: number, { allowZero = false } = {}): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (!allowZero && n <= 0) return fallback;
  return Math.floor(n);
};

const COWORKERS = envInt('COWORKERS', 18);
const CONV_PER_EXISTING_CHANNEL = envInt('CONV_PER_EXISTING_CHANNEL', 48);
const CONV_PER_SQUAD_CHANNEL = envInt('CONV_PER_SQUAD_CHANNEL', 48);
const MSGS_PER_CONV = envInt('MSGS_PER_CONV', 10);
const REPLIES_PER_CONV = envInt('REPLIES_PER_CONV', 4, { allowZero: true });
const DMS = envInt('DMS', 18);
const GROUP_DMS = envInt('GROUP_DMS', 5);
const EXTRA_CHANNELS = envInt('EXTRA_CHANNELS', 4);
const TICKETS = envInt('TICKETS', 100);
const CALLS = envInt('CALLS', 55);
const CANVASES = envInt('CANVASES', 24);
const NOTIFICATIONS = envInt('NOTIFICATIONS', 60);
const BOOKMARKS = envInt('BOOKMARKS', 20);
const ACTIVITIES = envInt('ACTIVITIES', 25);
const HISTORY_DAYS = envInt('HISTORY_DAYS', 320);
const CREATE_CUSTOMER_OPS = process.env.CREATE_CUSTOMER_OPS !== '0';

const MATURE_MARKER = '[mature-seed]';
const SEED_META = { seed: 'mature' } as const;
const USER_EMAIL_PREFIX = 'mature-user-';
const PLATFORM_PROJECT_CODE = process.env.PLATFORM_PROJECT_CODE ?? 'PLAT';
const DEFAULT_PLATFORM_PROJECT_ID = process.env.PLATFORM_PROJECT_ID ?? 'cmsq33yxd000b75atdjq8ute7';

const EXISTING_CHANNEL_NAMES = [
  'general', 'engineering', 'product', 'design', 'announcements', 'releases',
  'incidents', 'automations', 'customer-voice', 'random', 'onboarding',
  'knowledge', 'ai-help', 'claw-lab',
];

const SQUAD_CHANNEL_NAMES = [
  'squad-digital-twin',
  'squad-platform-core',
  'squad-reliability',
  'squad-customer-ops',
];

const FIRST = [
  'Anika', 'Rohan', 'Meera', 'Arjun', 'Sofia', 'Liam', 'Yuki', 'Elena',
  'Marcus', 'Priya', 'Noah', 'Amara', 'Felix', 'Zoe', 'Owen', 'Nadia',
  'Kai', 'Isla', 'Dev', 'Maya',
];
const LAST = [
  'Sharma', 'Patel', 'Nguyen', 'Kim', 'Fernandez', 'Brooks', 'Tanaka',
  'Okafor', 'Silva', 'Rao', 'Chen', 'Murphy', 'Khan', 'Berg', 'Singh', 'Costa',
];
const AV_BG = ['6276BE', 'E91E63', '4CAF50', 'FF9800', '9C27B0', '009688', 'F44336', '3F51B5'];

const EMOJIS = ['👍', '🔥', '🎉', '❤️', '😄', '🙏', '👀', '🚀', '✨', '💯'];

const CONVERSATION_SNIPPETS: Record<string, string[]> = {
  general: [
    'Morning standup notes are on the canvas from yesterday — same link as always.',
    'Anyone else seeing slower channel loads after the last deploy? Not blocking, just curious.',
    'Customer Ops asked for a one-pager on Digital Twin — I dropped a draft in #product.',
    'LGTM on the release comms. Shipping the blog post at 4pm IST.',
    'Reminder: office hours for Spaces onboarding is Thursday 3pm.',
  ],
  engineering: [
    'Pushed the cursor-pagination fix for channelConversationsPaginatedV3 — please sanity-check.',
    'The flaky e2e on ticket board drag-drop is back. Bisecting now.',
    'Zero mutator for canvas comments landed; migration is additive only.',
    'Heap snapshot after bulk-seed is still ugly — mature-user-seed should be lighter.',
    'Can we gate the new call recording UI behind a workspace flag?',
  ],
  product: [
    'PRD for Ask AI over call transcripts is ready for review.',
    'Digital Twin persona tab needs clearer empty state copy — design has mocks.',
    'Cut scope on multi-workspace search for Q2; keeping single-workspace fast path.',
    'Customer interview: teams want ticket↔canvas linking in one click.',
    'Metrics dashboard for claw-lab usage — what do we ship first?',
  ],
  design: [
    'Updated motion tokens for Digital Twin modals — see Figma link in thread.',
    'Empty states for DM list when you have zero DMs feel too bare; iterating.',
    'Design critique Friday: call lobby + presence indicators.',
    'Component audit: bookmark row vs notification row — aligning density.',
    'Dark mode contrast fix for mention pills is in review.',
  ],
  incidents: [
    'Error rate on checkout spiked at 14:02 — call in this channel, join if around.',
    'Root cause looks like cache stampede on channel stats refresh.',
    'Postmortem canvas is linked from the incident ticket — comment there.',
    'Deduping on alert key worked — only one ticket opened automatically.',
    'Customer comms draft ready; needs a quick review before send.',
  ],
  'claw-lab': [
    'Agent run opened PLAT-00142 when latency crossed threshold — worked as expected.',
    'Tuning the Digital Twin memory recall prompt — fewer false positives now.',
    'Claw agent permissions: need tickets:write for auto-assignment flow.',
    'Sharing a canvas with the agent playbook — feedback welcome.',
    'Hot tab metrics look noisy; smoothing algorithm in progress.',
  ],
  default: [
    'Synced with platform on the rollout plan — notes in the ticket.',
    'Ask AI pulled the right thread from three weeks ago. Pleasant surprise.',
    'Moving this to next sprint — scope grew after the design review.',
    'Recording plus transcript means I do not have to re-watch the whole call.',
    'Bookmarked the canvas — best onboarding doc we have so far.',
  ],
};

const TICKET_TITLES = [
  'Digital Twin: persona tab empty state',
  'Channel feed cursor skips conversations with tied timestamps',
  'Ask AI should cite call transcripts in answers',
  'Bookmark list sort by updatedAt regressed',
  'Canvas comment @-mentions not notifying',
  'DM unread badge counts self-started threads',
  'Ticket board: drag to In Review drops on wrong column',
  'Release notes template for automations channel',
  'Import Slack history: thread parent mapping',
  'Claw agent: auto-open ticket on SLO breach',
  'Notification batching for mention storms',
  'Canvas export to PDF missing images',
  'Call recording retention policy config',
  'Platform search: index canvas body text',
  'Customer Ops desk: Gmail-style archive',
  'Onboarding checklist canvas for new hires',
  'Incidents channel: auto-post call summary',
  'Knowledge base: cross-link tickets and canvases',
  'Mobile web: pinch-zoom on canvas view',
  'Performance: channelStats refresh storm',
];

const CALL_TITLES = [
  'Sprint planning',
  'Design critique — Digital Twin',
  'Incident bridge',
  'Release readiness review',
  'Customer feedback sync',
  'Architecture review — search',
  'Weekly platform standup',
  'Retro',
  'Pairing session — Zero mutators',
  'Roadmap prioritization',
];

const CANVAS_TITLES = [
  'Q3 Platform Roadmap',
  'Digital Twin — Persona & Memory Model',
  'Incident Response Playbook',
  'Onboarding: Your First Week in Spaces',
  'Release 2.14 — Comm Checklist',
  'Claw Lab — Agent Permissions Matrix',
  'Design System — Motion Tokens',
  'Customer Ops — Escalation Tree',
  'Engineering RFC: Ask AI Context Window',
  'Squad Reliability — SLO Dashboard Spec',
];

const STATUS_STAGE: Array<{ statusV2: TicketStatusV2; stage: string; legacy: TicketStatus }> = [
  { statusV2: TicketStatusV2.TODO, stage: 'Triage', legacy: TicketStatus.NEW },
  { statusV2: TicketStatusV2.STARTED, stage: 'In Progress', legacy: TicketStatus.IN_PROGRESS },
  { statusV2: TicketStatusV2.PAUSED, stage: 'In Progress', legacy: TicketStatus.IN_PROGRESS },
  { statusV2: TicketStatusV2.STARTED, stage: 'In Review', legacy: TicketStatus.IN_PROGRESS },
  { statusV2: TicketStatusV2.COMPLETED, stage: 'Done', legacy: TicketStatus.RESOLVED },
];

const PRIORITIES = [
  TicketPriority.LOW,
  TicketPriority.MEDIUM,
  TicketPriority.HIGH,
  TicketPriority.CRITICAL,
];

const now = Date.now();
const minsAgo = (m: number) => new Date(now - m * 60_000);
const hoursAgo = (h: number) => new Date(now - h * 60 * 60_000);
const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60_000);

let meId = '';
let meName = '';
let wsId = '';
let orgName = '';

type U = { id: string; email: string };
type Me = U & { name: string | null };

const pick = <T,>(arr: T[], i: number): T => arr[i % arr.length];

const mentionMe = (): string =>
  `<span data-mention="" data-mention-type="user" data-user-id="${meId}" data-username="${meName}" class="chat-input-mention">@${meName}</span> `;

function snippetForChannel(channelName: string, index: number): string {
  const pool = CONVERSATION_SNIPPETS[channelName] ?? CONVERSATION_SNIPPETS.default;
  return pick(pool, index);
}

function legacyStatus(v2: TicketStatusV2): TicketStatus {
  const hit = STATUS_STAGE.find(s => s.statusV2 === v2);
  return hit?.legacy ?? TicketStatus.NEW;
}

// ---- foundation ----

async function resolveUser(): Promise<Me | null> {
  const targetEmail = process.env.SEED_USER_EMAIL;
  if (targetEmail) {
    const hit = await prisma.user.findFirst({
      where: { email: targetEmail },
      select: { id: true, email: true, name: true },
    });
    if (hit) return hit;
    console.log(`  ⚠️  SEED_USER_EMAIL "${targetEmail}" not found — falling back to the last logged-in user.`);
  }
  const session = await prisma.userSession.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { lastActivity: 'desc' },
    select: { user: { select: { id: true, email: true, name: true } } },
  });
  if (session?.user) return session.user;
  console.log('  ⚠️  No active session found — falling back to the first human user. Set SEED_USER_EMAIL to target another.');
  return prisma.user.findFirst({
    where: {
      NOT: [
        { email: { contains: '@app.xyne.ai' } },
        { email: { contains: '@bot.xyne.ai' } },
        { email: { startsWith: USER_EMAIL_PREFIX } },
        { email: { startsWith: 'bulk-user-' } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true },
  });
}

async function getFoundation() {
  const me = await resolveUser();
  if (!me) throw new Error('No users in DB. Run `npm run db:seed` first.');

  const project =
    (await prisma.project.findFirst({
      where: { OR: [{ id: DEFAULT_PLATFORM_PROJECT_ID }, { code: PLATFORM_PROJECT_CODE }] },
      select: { id: true, workspaceId: true, code: true },
    })) ??
    (await prisma.project.findFirst({
      where: { type: ProjectType.DEFAULT },
      select: { id: true, workspaceId: true, code: true },
    }));
  if (!project) throw new Error('No Platform project found. Run a base seed first.');

  const dmProject =
    (await prisma.project.findFirst({ where: { type: ProjectType.DM }, select: { id: true } })) ??
    { id: project.id };

  const board = await prisma.board.findFirst({
    where: { projectId: project.id, name: 'Delivery' },
    select: { id: true },
  });
  if (!board) throw new Error('Delivery board not found on Platform project.');

  const orgMember = await prisma.orgMember.findFirst({ select: { orgId: true } });
  if (!orgMember) throw new Error('No org member found.');

  const org = await prisma.organization.findFirst({
    where: { orgId: orgMember.orgId },
    select: { name: true },
  });

  return {
    me,
    project,
    dmProject,
    boardId: board.id,
    orgId: orgMember.orgId,
    orgName: org?.name ?? 'xyne-default-org',
  };
}

async function ensureCoworkers(workspaceId: string, orgId: string): Promise<U[]> {
  const existing = await prisma.user.findMany({
    where: { email: { startsWith: USER_EMAIL_PREFIX } },
    select: { id: true, email: true },
  });
  const byEmail = new Map(existing.map(u => [u.email, u]));
  const out: U[] = [];
  for (let i = 0; i < COWORKERS; i++) {
    const email = `${USER_EMAIL_PREFIX}${String(i).padStart(3, '0')}@xyne.test`;
    const hit = byEmail.get(email);
    if (hit) { out.push(hit); continue; }
    const name = `${pick(FIRST, i)} ${pick(LAST, i + 5)}`;
    const memberId = createId();
    await prisma.orgMember.create({ data: { memberId, orgId, email, role: OrgRole.MEMBER } });
    const u = await prisma.user.create({
      data: {
        name,
        email,
        picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${pick(AV_BG, i)}&color=fff`,
        authProvider: AuthProvider.GOOGLE,
        providerUserId: `mature-${memberId}`,
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

async function ensureCustomerOpsProject(workspaceId: string, createdBy: string) {
  if (!CREATE_CUSTOMER_OPS) return null;
  const existing = await prisma.project.findFirst({
    where: { code: 'COPS', workspaceId },
    select: { id: true },
  });
  if (existing) return existing;

  const project = await prisma.project.create({
    data: {
      name: 'Customer Ops',
      code: 'COPS',
      description: `Customer support and escalations ${MATURE_MARKER}`,
      workspaceId,
      createdBy,
      type: ProjectType.DEFAULT,
    },
    select: { id: true },
  });

  const board = await prisma.board.create({
    data: {
      name: 'Intake',
      projectId: project.id,
      workspaceId,
      createdBy,
      description: `Customer Ops board ${MATURE_MARKER}`,
    },
    select: { id: true },
  });

  const stages = ['Triage', 'In Progress', 'Waiting on Customer', 'Done'];
  for (let i = 0; i < stages.length; i++) {
    await prisma.stage.create({
      data: {
        name: stages[i],
        boardId: board.id,
        workspaceId,
        sequenceNumber: i + 1,
        createdBy,
      },
    });
  }
  return project;
}

async function nextXyneIdStart(projectCode: string, workspaceId: string): Promise<number> {
  const rows = await prisma.ticket.findMany({
    where: { workspaceId, xyneId: { startsWith: `${projectCode}-` } },
    select: { xyneId: true },
  });
  let max = 100;
  for (const row of rows) {
    const n = Number.parseInt(row.xyneId.split('-')[1] ?? '0', 10);
    if (!Number.isNaN(n) && n >= max) max = n + 1;
  }
  return max;
}

// ---- wipe ----

async function deleteConversations(convIds: string[]) {
  if (!convIds.length) return;
  const msgs = await prisma.message.findMany({
    where: { conversationId: { in: convIds } },
    select: { messageId: true },
  });
  const msgIds = msgs.map(m => m.messageId);
  if (msgIds.length) {
    await prisma.reaction.deleteMany({ where: { messageId: { in: msgIds } } });
    await prisma.reactionCount.deleteMany({ where: { messageId: { in: msgIds } } });
    await prisma.message.deleteMany({ where: { messageId: { in: msgIds } } });
  }
  await prisma.activity.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.conversation.deleteMany({ where: { conversationId: { in: convIds } } });
}

async function wipe() {
  console.log('  collecting mature-seed data to remove...');

  const matureUsers = await prisma.user.findMany({
    where: { email: { startsWith: USER_EMAIL_PREFIX } },
    select: { id: true },
  });
  const matureUserIds = matureUsers.map(u => u.id);

  const markerChannels = await prisma.channel.findMany({
    where: { description: { contains: MATURE_MARKER } },
    select: { id: true },
  });
  const markerChannelIds = markerChannels.map(c => c.id);

  const convIdSet = new Set<string>();
  if (matureUserIds.length) {
    const fromUsers = await prisma.conversation.findMany({
      where: { createdBy: { in: matureUserIds } },
      select: { conversationId: true },
    });
    fromUsers.forEach(c => convIdSet.add(c.conversationId));
  }
  if (markerChannelIds.length) {
    const fromChannels = await prisma.conversation.findMany({
      where: { channelId: { in: markerChannelIds } },
      select: { conversationId: true },
    });
    fromChannels.forEach(c => convIdSet.add(c.conversationId));
  }

  const matureTickets = await prisma.ticket.findMany({
    where: { metadata: { path: ['seed'], equals: 'mature' } },
    select: { id: true, conversationId: true },
  });
  matureTickets.forEach(t => convIdSet.add(t.conversationId));

  const convIds = [...convIdSet];
  if (convIds.length) {
    console.log(`  wiping ${convIds.length} conversations...`);
    await deleteConversations(convIds);
  }

  if (matureTickets.length) {
    const ticketIds = matureTickets.map(t => t.id);
    await prisma.ticketActivity.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticketTag.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticketAssignment.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    console.log(`  wiped ${ticketIds.length} tickets`);
  }

  if (markerChannelIds.length) {
    await prisma.channelParticipant.deleteMany({ where: { channelId: { in: markerChannelIds } } });
    await prisma.channelUserStatus.deleteMany({ where: { channelId: { in: markerChannelIds } } });
    await prisma.channelStats.deleteMany({ where: { channelId: { in: markerChannelIds } } });
    await prisma.activity.deleteMany({ where: { channelId: { in: markerChannelIds } } });
    await prisma.channel.deleteMany({ where: { id: { in: markerChannelIds } } });
    console.log(`  wiped ${markerChannelIds.length} marker channels`);
  }

  const matureCalls = await prisma.call.findMany({
    where: { metadata: { path: ['seed'], equals: 'mature' } },
    select: { id: true },
  });
  if (matureCalls.length) {
    const callIds = matureCalls.map(c => c.id);
    await prisma.callParticipant.deleteMany({ where: { callId: { in: callIds } } });
    await prisma.call.deleteMany({ where: { id: { in: callIds } } });
    console.log(`  wiped ${callIds.length} calls`);
  }

  const matureCanvases = await prisma.canvas.findMany({
    where: { metadata: { path: ['seed'], equals: 'mature' } },
    select: { id: true },
  });
  if (matureCanvases.length) {
    const canvasIds = matureCanvases.map(c => c.id);
    await prisma.canvasParticipant.deleteMany({ where: { canvasId: { in: canvasIds } } });
    await prisma.canvasUserStatus.deleteMany({ where: { canvasId: { in: canvasIds } } });
    await prisma.canvas.deleteMany({ where: { id: { in: canvasIds } } });
    console.log(`  wiped ${canvasIds.length} canvases`);
  }

  const notif = await prisma.notification.deleteMany({
    where: { metadata: { path: ['seed'], equals: 'mature' } },
  });
  const bookmarks = await prisma.bookmark.deleteMany({
    where: { metadata: { path: ['seed'], equals: 'mature' } },
  });

  if (matureUserIds.length) {
    await prisma.activity.deleteMany({ where: { actorId: { in: matureUserIds } } });
    const du = await prisma.user.deleteMany({ where: { id: { in: matureUserIds } } });
    const om = await prisma.orgMember.deleteMany({ where: { email: { startsWith: USER_EMAIL_PREFIX } } });
    console.log(`  removed ${du.count} mature coworkers, ${om.count} org members`);
  }

  const copsProject = await prisma.project.findFirst({
    where: { code: 'COPS', description: { contains: MATURE_MARKER } },
    select: { id: true },
  });
  if (copsProject) {
    await prisma.ticket.deleteMany({ where: { projectId: copsProject.id } });
    const boards = await prisma.board.findMany({ where: { projectId: copsProject.id }, select: { id: true } });
    for (const b of boards) {
      await prisma.stage.deleteMany({ where: { boardId: b.id } });
    }
    await prisma.board.deleteMany({ where: { projectId: copsProject.id } });
    await prisma.project.delete({ where: { id: copsProject.id } });
    console.log('  wiped Customer Ops project');
  }

  console.log(`  ✅ wipe done (notifications ${notif.count}, bookmarks ${bookmarks.count})`);
}

async function alreadySeeded(): Promise<boolean> {
  const hit = await prisma.ticket.findFirst({
    where: { metadata: { path: ['seed'], equals: 'mature' } },
    select: { id: true },
  });
  return !!hit;
}

// ---- accumulators ----

const channels: any[] = [];
const channelStats: any[] = [];
const participants: any[] = [];
const statuses: any[] = [];
const conversations: any[] = [];
const messages: any[] = [];
const reactions: any[] = [];
const reactionCounts: any[] = [];
const activities: any[] = [];
const tickets: any[] = [];
const ticketConversations: any[] = [];
const ticketMessages: any[] = [];
const calls: any[] = [];
const callParticipants: any[] = [];
const canvases: any[] = [];
const canvasParticipants: any[] = [];
const notifications: any[] = [];
const bookmarks: any[] = [];

const touchedChannelIds = new Set<string>();
const channelLastActivity = new Map<string, Date>();

type ConvInfo = { createdAt: Date; createdBy: string; rootActivity: boolean };

function markChannelTouch(channelId: string, at: Date) {
  touchedChannelIds.add(channelId);
  const prev = channelLastActivity.get(channelId);
  if (!prev || at > prev) channelLastActivity.set(channelId, at);
}

function addConversationWithMessages(
  channelId: string,
  channelName: string,
  members: U[],
  convIndex: number,
  dayOffset: number,
  mentionBudget: { left: number },
): ConvInfo {
  const conversationId = createId();
  const msgIds: string[] = [];
  const total = MSGS_PER_CONV + REPLIES_PER_CONV;
  let initialMd: string | null = null;
  let initialSender = members[0].id;
  let rootActivity = false;

  const baseMinutes = dayOffset * 24 * 60 + convIndex * 37;

  for (let k = 0; k < total; k++) {
    const messageId = createId();
    msgIds.push(messageId);
    const sender = pick(members, convIndex + k);
    const isReply = k >= MSGS_PER_CONV;
    const isMention =
      k === 0 &&
      convIndex % 7 === 1 &&
      sender.id !== meId &&
      mentionBudget.left > 0 &&
      activities.length < ACTIVITIES;
    const content = isMention
      ? `${mentionMe()}${snippetForChannel(channelName, convIndex + k)}`
      : snippetForChannel(channelName, convIndex + k);
    const createdAt = minsAgo(baseMinutes - k);

    messages.push({
      workspaceId: wsId,
      messageId,
      conversationId,
      senderId: sender.id,
      content,
      msgType: MessageType.USER,
      showInChannel: !isReply,
      createdAt,
    });

    if (k === 0) {
      initialSender = sender.id;
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

    if (k % 5 === 0) {
      const emoji = pick(EMOJIS, k + convIndex);
      const reactor = pick(members, k + 2);
      reactions.push({ workspaceId: wsId, messageId, userId: reactor.id, emojiName: emoji });
      reactionCounts.push({ workspaceId: wsId, messageId, emojiName: emoji, count: 1 });
    }

    if (isMention) {
      rootActivity = true;
      mentionBudget.left -= 1;
      activities.push({
        workspaceId: wsId,
        userId: meId,
        actorId: sender.id,
        actorAction: 'mentioned_user',
        actionSource: 'message',
        actionSourceId: messageId,
        messageId,
        conversationId,
        channelId,
        classification: ActivityClassification.ACTIONABLE,
        isRead: convIndex % 3 === 0,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }

  const createdAt = minsAgo(baseMinutes);
  const lastAt = minsAgo(baseMinutes - (total - 1));
  conversations.push({
    workspaceId: wsId,
    conversationId,
    channelId,
    createdBy: initialSender,
    initialMessageId: msgIds[0],
    createdAt,
    lastActivityAt: lastAt,
    replyCount: REPLIES_PER_CONV,
    pinned: convIndex === 0 && dayOffset % 30 === 0,
    initial_message_md: initialMd,
    metadata: SEED_META,
  });
  markChannelTouch(channelId, lastAt);

  return { createdAt, createdBy: initialSender, rootActivity };
}

function addChannel(
  opts: {
    name: string;
    scopeType: ChannelScopeType;
    visibility: ChannelVisibility;
    members: U[];
    projectId: string;
    workspaceId: string;
    createdBy: string;
    convCount: number;
    daySpreadStart: number;
  },
  idx: number,
) {
  const channelId = createId();
  const isDm =
    opts.scopeType === ChannelScopeType.DM || opts.scopeType === ChannelScopeType.GROUP_DM;
  const channelName = isDm ? opts.members.map(m => m.id).sort().join(',') : opts.name;

  const lastAt = daysAgo(opts.daySpreadStart % HISTORY_DAYS);
  channels.push({
    id: channelId,
    name: channelName,
    description: `${opts.name} ${MATURE_MARKER}`,
    type: ChannelType.DEFAULT,
    scopeType: opts.scopeType,
    visibility: opts.visibility,
    createdBy: opts.createdBy,
    projectId: opts.projectId,
    workspaceId: opts.workspaceId,
    participantCount: opts.members.length,
    isMigrated: false,
    lastActivityAt: lastAt,
  });

  channelStats.push({
    workspaceId: opts.workspaceId,
    channelId,
    lastActivityAt: lastAt,
    participantCount: opts.members.length,
  });

  const convs: ConvInfo[] = [];
  const mentionBudget = { left: 3 };
  for (let c = 0; c < opts.convCount; c++) {
    const dayOffset = opts.daySpreadStart + Math.floor((c * HISTORY_DAYS) / Math.max(opts.convCount, 1));
    convs.push(
      addConversationWithMessages(channelId, opts.name, opts.members, c, dayOffset, mentionBudget),
    );
  }

  const unreadConvs = convs.filter(c => (isDm ? c.createdBy !== meId : c.rootActivity));
  const allRead = unreadConvs.length === 0 || idx % 4 === 0;
  const oldestUnread = unreadConvs.reduce((min, c) => Math.min(min, c.createdAt.getTime()), Infinity);
  const myLastViewedAt = allRead ? new Date(now) : new Date(oldestUnread - 1000);

  opts.members.forEach((u, mi) => {
    participants.push({
      workspaceId: opts.workspaceId,
      channelId,
      userId: u.id,
      role: mi === 0 ? ChannelRole.ADMIN : ChannelRole.MEMBER,
    });
    statuses.push({
      workspaceId: opts.workspaceId,
      channelId,
      userId: u.id,
      lastViewedAt: u.id === meId ? myLastViewedAt : new Date(now),
      unreadCount: u.id === meId && !allRead ? unreadConvs.length : 0,
      isStarred: u.id === meId && idx % 11 === 0,
    });
  });

  markChannelTouch(channelId, lastAt);
  return channelId;
}

function addConversationsToExistingChannel(
  channelId: string,
  channelName: string,
  members: U[],
  convCount: number,
  seedOffset: number,
) {
  const mentionBudget = { left: 2 };
  for (let c = 0; c < convCount; c++) {
    const dayOffset = 5 + seedOffset + Math.floor((c * HISTORY_DAYS) / Math.max(convCount, 1));
    addConversationWithMessages(channelId, channelName, members, c, dayOffset, mentionBudget);
  }
}

function queueTicket(
  index: number,
  projectId: string,
  projectCode: string,
  boardId: string,
  channelId: string,
  channelName: string,
  members: U[],
  xyneNum: number,
) {
  const spec = STATUS_STAGE[index % STATUS_STAGE.length];
  const priority = pick(PRIORITIES, index + 2);
  const reporter = pick(members, index);
  const assignee = pick([meId, ...members.map(m => m.id)], index + 1);
  const createdAt = daysAgo(10 + Math.floor((index * HISTORY_DAYS) / Math.max(TICKETS, 1)));
  const updatedAt = daysAgo(Math.max(1, Math.floor(index / 3)));

  const ticketId = createId();
  const conversationId = createId();
  const messageId = createId();
  const xyneId = `${projectCode}-${String(xyneNum).padStart(5, '0')}`;
  const title = pick(TICKET_TITLES, index);
  const description = `${title} — tracked on the ${channelName} board. ${MATURE_MARKER}`;

  ticketMessages.push({
    workspaceId: wsId,
    messageId,
    conversationId,
    senderId: reporter.id,
    content: title,
    msgType: MessageType.USER,
    showInChannel: false,
    createdAt,
  });

  const withChannelCard = index % 3 === 0;
  ticketConversations.push({
    workspaceId: wsId,
    conversationId,
    channelId,
    createdBy: reporter.id,
    initialMessageId: messageId,
    ticketId,
    createdAt,
    lastActivityAt: updatedAt,
    replyCount: index % 4,
    initial_message_md: serializeInitialMessageMd({
      messageId,
      conversationId,
      senderId: reporter.id,
      content: title,
      msgType: MessageType.USER,
      hasAttachment: false,
      edited: false,
      isDeleted: false,
      showInChannel: false,
      visibleTo: null,
      createdAt: createdAt.getTime(),
      isSent: true,
    }),
    ...(withChannelCard
      ? {
          ticket_md: serializeTicketMd({
            id: ticketId,
            title,
            description,
            statusV2: spec.statusV2,
            priority,
            assignedTo: assignee,
            createdBy: reporter.id,
            createdAt: createdAt.getTime(),
            xyneId,
            stageName: spec.stage,
            channelId,
            conversationId,
          }),
        }
      : {}),
    metadata: SEED_META,
  });

  tickets.push({
    id: ticketId,
    title,
    description,
    status: legacyStatus(spec.statusV2),
    statusV2: spec.statusV2,
    createdBy: reporter.id,
    updatedBy: reporter.id,
    assignedTo: assignee,
    conversationId,
    channelId,
    xyneId,
    projectId,
    workspaceId: wsId,
    boardId,
    stageName: spec.stage,
    priority,
    metadata: SEED_META,
    lastEmailAt: createdAt,
    createdAt,
    updatedAt,
    statusUpdatedAt: updatedAt,
    ...(spec.statusV2 === TicketStatusV2.COMPLETED
      ? { closedAt: updatedAt, closedBy: assignee }
      : {}),
  });

  if (withChannelCard) markChannelTouch(channelId, updatedAt);
}

function queueCall(index: number, channelId: string, members: U[]) {
  const callId = createId();
  const started = daysAgo(3 + (index % 90));
  const durationMins = 25 + (index % 50);
  const ended = new Date(started.getTime() + durationMins * 60_000);
  const organizer = pick(members, index);
  const title = pick(CALL_TITLES, index);

  calls.push({
    workspaceId: wsId,
    id: callId,
    externalId: createId(),
    title,
    createdByUserId: organizer.id,
    organizerId: organizer.id,
    channelId,
    orgName,
    description: `${title} — ${MATURE_MARKER}`,
    callType: CallType.VIDEO,
    status: CallStatus.ENDED,
    recordingEnabled: index % 3 === 0,
    startedAt: started,
    endedAt: ended,
    lastActivityAt: ended,
    createdAt: started,
    updatedAt: ended,
    metadata: SEED_META,
    participantCount: Math.min(4, members.length),
  });

  const callMembers = [meId, ...members.slice(0, 3).map(m => m.id)];
  const uniqueMembers = [...new Set(callMembers)];
  uniqueMembers.forEach((userId, pi) => {
    callParticipants.push({
      workspaceId: wsId,
      callId,
      userId,
      invitedBy: organizer.id,
      response: InvitationResponse.ACCEPTED,
      joinedAt: started,
      leftAt: ended,
      invitedAt: started,
      meetingStatus: 'ENDED',
      respondedAt: started,
    });
  });
}

function queueCanvas(index: number, projectId: string, channelId: string | null, members: U[]) {
  const canvasId = createId();
  const title = pick(CANVAS_TITLES, index);
  const editor = pick(members, index);
  const updated = daysAgo(2 + (index % 120));

  canvases.push({
    workspaceId: wsId,
    id: canvasId,
    title,
    content: [
      { type: 'heading', content: title },
      { type: 'paragraph', content: `Working notes for ${title}. Last updated by ${editor.id === meId ? 'me' : 'the squad'}.` },
      { type: 'bullet', content: 'Decisions and open questions live here.' },
      { type: 'bullet', content: 'Link related tickets from the board for traceability.' },
    ],
    channelId,
    projectId,
    createdBy: editor.id,
    lastEditedBy: editor.id,
    lastEditedAt: updated,
    viewAccessId: createId(),
    editAccessId: createId(),
    visibility: index % 4 === 0 ? CanvasVisibility.PUBLIC : CanvasVisibility.PRIVATE,
    docType: DocType.Canvas,
    isCollaborative: true,
    createdAt: daysAgo(30 + index * 4),
    updatedAt: updated,
    metadata: SEED_META,
  });

  const partMembers = [meId, editor.id, pick(members, index + 2).id];
  [...new Set(partMembers)].forEach((userId, ri) => {
    canvasParticipants.push({
      workspaceId: wsId,
      canvasId,
      userId,
      role: userId === editor.id ? CanvasRole.OWNER : ri === 0 ? CanvasRole.EDITOR : CanvasRole.VIEWER,
    });
  });
}

function queueNotification(index: number, entity?: { type: string; id: string; url?: string }) {
  const types = [
    NotificationType.TICKET_ASSIGNMENT,
    NotificationType.MENTION,
    NotificationType.TICKET_STATUS_CHANGE,
    NotificationType.THREAD_REPLY,
  ];
  const type = pick(types, index);
  const isRead = index % 3 !== 0;
  const createdAt = daysAgo(1 + (index % 45));

  notifications.push({
    workspaceId: wsId,
    userId: meId,
    type,
    title: type === NotificationType.MENTION ? 'You were mentioned' : 'Update in Spaces',
    message:
      type === NotificationType.MENTION
        ? 'A teammate mentioned you in a thread about Digital Twin'
        : `Notification ${index + 1} from your mature seed history`,
    status: isRead ? NotificationStatus.READ : NotificationStatus.UNREAD,
    deliveryMethods: [NotificationDeliveryMethod.BROWSER],
    relatedEntityType: entity?.type,
    relatedEntityId: entity?.id,
    actionUrl: entity?.url,
    readAt: isRead ? createdAt : null,
    createdAt,
    updatedAt: createdAt,
    metadata: SEED_META,
  });
}

async function flush() {
  const chunk = 1000;
  const batched = async (label: string, rows: any[], fn: (slice: any[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += chunk) await fn(rows.slice(i, i + chunk));
    if (rows.length) console.log(`    ✅ ${rows.length} ${label}`);
  };

  await batched('channels', channels, s => prisma.channel.createMany({ data: s }));
  await batched('channel stats', channelStats, s => prisma.channelStats.createMany({ data: s }));
  await batched('participants', participants, s => prisma.channelParticipant.createMany({ data: s }));
  await batched('channel statuses', statuses, s => prisma.channelUserStatus.createMany({ data: s }));
  await batched('conversations', conversations, s => prisma.conversation.createMany({ data: s }));
  await batched('messages', messages, s => prisma.message.createMany({ data: s }));
  await batched('reactions', reactions, s => prisma.reaction.createMany({ data: s }));
  await batched('reaction counts', reactionCounts, s => prisma.reactionCount.createMany({ data: s }));
  await batched('activities', activities, s => prisma.activity.createMany({ data: s }));

  // Conversations before messages (and before tickets that reference them).
  await batched('ticket conversations', ticketConversations, s => prisma.conversation.createMany({ data: s }));
  await batched('ticket messages', ticketMessages, s => prisma.message.createMany({ data: s }));
  await batched('tickets', tickets, s => prisma.ticket.createMany({ data: s }));

  await batched('calls', calls, s => prisma.call.createMany({ data: s }));
  await batched('call participants', callParticipants, s => prisma.callParticipant.createMany({ data: s }));
  await batched('canvases', canvases, s => prisma.canvas.createMany({ data: s }));
  await batched('canvas participants', canvasParticipants, s => prisma.canvasParticipant.createMany({ data: s }));
  await batched('notifications', notifications, s => prisma.notification.createMany({ data: s }));
  await batched('bookmarks', bookmarks, s => prisma.bookmark.createMany({ data: s }));

  for (const [channelId, lastAt] of channelLastActivity) {
    await prisma.channel.update({
      where: { id: channelId },
      data: { lastActivityAt: lastAt },
    });
    await prisma.channelStats.updateMany({
      where: { channelId },
      data: { lastActivityAt: lastAt },
    });
  }
  if (channelLastActivity.size) {
    console.log(`    ✅ updated lastActivityAt on ${channelLastActivity.size} channels`);
  }
}

async function dmExists(memberIds: string[]): Promise<boolean> {
  const name = memberIds.sort().join(',');
  const hit = await prisma.channel.findFirst({
    where: { name, scopeType: ChannelScopeType.DM },
    select: { id: true },
  });
  return !!hit;
}

async function squadChannelExists(name: string, projectId: string): Promise<boolean> {
  const hit = await prisma.channel.findFirst({
    where: { name, projectId, description: { contains: MATURE_MARKER } },
    select: { id: true },
  });
  return !!hit;
}

async function main() {
  console.log('🌱 Mature user seeding (power-user history)...\n');

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development') {
    console.error(`❌ Refusing to run: NODE_ENV is "${nodeEnv}", expected "development".`);
    process.exit(1);
  }

  if (process.env.MATURE_WIPE === '1') {
    console.log('🧹 Wiping previous mature-seed data...');
    await wipe();
  } else if (await alreadySeeded()) {
    console.log('  ⏭️  Mature seed data already present. Set MATURE_WIPE=1 to reseed.');
    return;
  }

  const { me, project, dmProject, boardId, orgId, orgName: org } = await getFoundation();
  meId = me.id;
  meName = me.name ?? me.email.split('@')[0];
  wsId = project.workspaceId;
  orgName = org;

  console.log(`  user=${me.email} project=${project.id} (${project.code}) board=${boardId} workspace=${wsId}`);
  console.log(
    `  config: COWORKERS=${COWORKERS} CONV_PER_EXISTING_CHANNEL=${CONV_PER_EXISTING_CHANNEL} ` +
      `MSGS_PER_CONV=${MSGS_PER_CONV} DMS=${DMS} TICKETS=${TICKETS} CALLS=${CALLS} CANVASES=${CANVASES}\n`,
  );

  console.log('  Ensuring coworkers...');
  const coworkers = await ensureCoworkers(wsId, orgId);
  const everyone: U[] = [{ id: me.id, email: me.email }, ...coworkers];
  console.log(`    ✅ ${coworkers.length} coworkers ready`);

  await ensureCustomerOpsProject(wsId, me.id);

  const platformChannels = await prisma.channel.findMany({
    where: {
      projectId: project.id,
      scopeType: ChannelScopeType.DEFAULT,
      name: { in: EXISTING_CHANNEL_NAMES },
    },
    select: { id: true, name: true },
  });
  console.log(`  Found ${platformChannels.length} existing Platform channels`);

  const rotate = (start: number, n: number): U[] =>
    Array.from({ length: n }, (_, k) => coworkers[(start + k) % coworkers.length]);

  // Conversations on existing Platform channels (wiped via createdBy mature-user ids)
  let platformConvTotal = 0;
  for (let i = 0; i < platformChannels.length; i++) {
    const ch = platformChannels[i];
    const memberCount = 3 + (i % 4);
    const members = [{ id: me.id, email: me.email }, ...rotate(i * 2, memberCount - 1)];
    addConversationsToExistingChannel(
      ch.id,
      ch.name,
      members,
      CONV_PER_EXISTING_CHANNEL,
      i * 17,
    );
    platformConvTotal += CONV_PER_EXISTING_CHANNEL;
  }

  // Squad channels (marker in description — fully wipeable)
  let squadCount = 0;
  for (let i = 0; i < EXTRA_CHANNELS; i++) {
    const name = SQUAD_CHANNEL_NAMES[i % SQUAD_CHANNEL_NAMES.length];
    if (await squadChannelExists(name, project.id)) {
      console.log(`    ⏭️  squad channel #${name} already exists`);
      continue;
    }
    const members = [everyone[0], ...rotate(i + 3, 4)];
    addChannel(
      {
        name,
        scopeType: ChannelScopeType.DEFAULT,
        visibility: ChannelVisibility.PRIVATE,
        members,
        projectId: project.id,
        workspaceId: wsId,
        createdBy: me.id,
        convCount: CONV_PER_SQUAD_CHANNEL,
        daySpreadStart: 20 + i * 40,
      },
      i,
    );
    squadCount++;
  }

  // 1:1 DMs
  let dmCount = 0;
  for (let i = 0; i < DMS; i++) {
    const other = coworkers[i % coworkers.length];
    if (await dmExists([me.id, other.id])) continue;
    addChannel(
      {
        name: `dm-${other.email}`,
        scopeType: ChannelScopeType.DM,
        visibility: ChannelVisibility.PRIVATE,
        members: [{ id: me.id, email: me.email }, other],
        projectId: dmProject.id,
        workspaceId: wsId,
        createdBy: me.id,
        convCount: 8 + (i % 6),
        daySpreadStart: 10 + i * 12,
      },
      100 + i,
    );
    dmCount++;
  }

  // Group DMs
  let gdmCount = 0;
  for (let i = 0; i < GROUP_DMS; i++) {
    const group = everyone.slice(0, 3 + (i % 3));
    const name = group.map(m => m.id).sort().join(',');
    if (await prisma.channel.findFirst({ where: { name, scopeType: ChannelScopeType.GROUP_DM } })) continue;
    addChannel(
      {
        name: `gdm-${i}`,
        scopeType: ChannelScopeType.GROUP_DM,
        visibility: ChannelVisibility.PRIVATE,
        members: group,
        projectId: dmProject.id,
        workspaceId: wsId,
        createdBy: me.id,
        convCount: 10 + i,
        daySpreadStart: 50 + i * 25,
      },
      200 + i,
    );
    gdmCount++;
  }

  // Tickets
  const xyneStart = await nextXyneIdStart(project.code, wsId);
  const channelByName = new Map(platformChannels.map(c => [c.name, c]));
  for (let i = 0; i < TICKETS; i++) {
    const slug = pick(EXISTING_CHANNEL_NAMES, i);
    const ch = channelByName.get(slug) ?? platformChannels[i % platformChannels.length];
    const members = [{ id: me.id, email: me.email }, ...rotate(i, 5)];
    queueTicket(i, project.id, project.code, boardId, ch.id, ch.name, members, xyneStart + i);
  }

  // Calls spread across channels
  for (let i = 0; i < CALLS; i++) {
    const ch = platformChannels[i % platformChannels.length];
    queueCall(i, ch.id, [{ id: me.id, email: me.email }, ...rotate(i, 4)]);
  }

  // Canvases
  for (let i = 0; i < CANVASES; i++) {
    const ch = i % 2 === 0 ? platformChannels[i % platformChannels.length] : null;
    queueCanvas(i, project.id, ch?.id ?? null, [{ id: me.id, email: me.email }, ...rotate(i, 3)]);
  }

  // Notifications
  for (let i = 0; i < NOTIFICATIONS; i++) {
    const ticket = tickets[i % tickets.length];
    queueNotification(i, {
      type: 'ticket',
      id: ticket?.id,
      url: ticket ? `/tickets/${ticket.xyneId}` : undefined,
    });
  }

  // Bookmarks for me — messages, tickets, canvases
  const bookmarkPool: Array<{ entityId: string; entityType: string }> = [];
  messages.slice(0, 30).forEach(m => bookmarkPool.push({ entityId: m.messageId, entityType: BookmarkEntityType.MESSAGE }));
  tickets.forEach(t => bookmarkPool.push({ entityId: t.id, entityType: BookmarkEntityType.TICKET }));
  canvases.forEach(c => bookmarkPool.push({ entityId: c.id, entityType: BookmarkEntityType.CANVAS }));
  conversations.slice(0, 20).forEach(c =>
    bookmarkPool.push({ entityId: c.conversationId, entityType: BookmarkEntityType.CONVERSATION }),
  );

  for (let i = 0; i < Math.min(BOOKMARKS, bookmarkPool.length); i++) {
    const target = bookmarkPool[Math.floor((i * bookmarkPool.length) / BOOKMARKS)];
    bookmarks.push({
      workspaceId: wsId,
      userId: meId,
      entityId: target.entityId,
      entityType: target.entityType,
      createdAt: daysAgo(2 + i * 5),
      metadata: SEED_META,
    });
  }

  console.log('  Flushing to DB...');
  await flush();

  console.log('\n✅ Mature user seed complete.');
  console.log(`   Platform channel conversations: ${platformConvTotal}`);
  console.log(`   New channels: ${channels.length} (squad ${squadCount}, DMs ${dmCount}, group DMs ${gdmCount})`);
  console.log(`   Conversations: ${conversations.length}  Messages: ${messages.length + ticketMessages.length}`);
  console.log(`   Tickets: ${tickets.length}  Calls: ${calls.length}  Canvases: ${canvases.length}`);
  console.log(`   Notifications: ${notifications.length}  Bookmarks: ${bookmarks.length}  Activities: ${activities.length}`);
}

main()
  .catch(e => {
    console.error('❌ Mature user seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
