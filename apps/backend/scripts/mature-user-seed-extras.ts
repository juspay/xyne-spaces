#!/usr/bin/env npx tsx
/// <reference types="node" />

/**
 * Mature User Seed Extras — fills remaining empty Surfaces for the same logged-in user.
 *
 * Follow-on to mature-user-seed.ts: HEADLESS recordings, Desk/EMAIL tickets, RCAs,
 * Knowledge Base collections, Automations, Forms, PRs, UserGroups, KnowledgeDocuments,
 * and enriches existing VIDEO calls with transcripts.
 *
 * PREREQUISITE: base seed + mature-user-seed.ts should have run.
 *
 * Usage (from apps/backend):
 *   NODE_ENV=development SEED_USER_EMAIL=you@example.com pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/mature-user-seed-extras.ts
 *   MATURE_EXTRAS_WIPE=1 ...  # wipe extras-tagged data before reseeding
 */

import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import {
  serializeInitialMessageMd,
  ChannelType,
  ChannelScopeType,
  ChannelVisibility,
  ChannelRole,
  MessageType,
  AuthProvider,
  UserStatus,
  OrgRole,
  WorkspaceRole,
  TicketStatus,
  TicketStatusV2,
  TicketPriority,
  CallType,
  CallStatus,
  InvitationResponse,
  ProjectType,
  EmailType,
  FormFieldType,
  FormContextType,
  FormEntityType,
  PRStatus,
  RecordingType,
  RecordingStatus,
  CollectionRole,
  WorkflowEventType,
} from '@xyne/shared';

const prisma = new PrismaClient();

// ---- knobs ----
const envInt = (name: string, fallback: number, { allowZero = false } = {}): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (!allowZero && n <= 0) return fallback;
  return Math.floor(n);
};

const HEADLESS_RECORDINGS = envInt('HEADLESS_RECORDINGS', 90);
const DESK_TICKETS = envInt('DESK_TICKETS', 160);
const RCAS = envInt('RCAS', 30);
const COLLECTIONS = envInt('COLLECTIONS', 10);
const KB_FILES = envInt('KB_FILES', 48);
const AUTOMATIONS = envInt('AUTOMATIONS', 10);
const FORMS = envInt('FORMS', 6);
const PRS = envInt('PRS', 45);
const USER_GROUPS = envInt('USER_GROUPS', 5);
const KNOWLEDGE_DOCS = envInt('KNOWLEDGE_DOCS', 15);
const HISTORY_DAYS = envInt('HISTORY_DAYS', 320);

const MATURE_MARKER = '[mature-seed]';
const SEED_META = { seed: 'mature' } as const;
const SEED_META_EXTRAS = { seed: 'mature-extras' } as const;
const USER_EMAIL_PREFIX = 'mature-user-';
const PLATFORM_PROJECT_CODE = process.env.PLATFORM_PROJECT_CODE ?? 'PLAT';
const DEFAULT_PLATFORM_PROJECT_ID = process.env.PLATFORM_PROJECT_ID ?? 'cmsq33yxd000b75atdjq8ute7';
const EMAIL_CHANNEL_NAME = 'customer-ops-inbox';
const AUTOMATION_WORKFLOW_TYPE = 'Automations';
const PR_URL_MARKER = 'mature-extras-seed';

const KB_CHANNEL_NAMES = ['knowledge', 'engineering', 'product', 'design'];

const COPS_STAGES = ['Triage', 'In Progress', 'Waiting on Customer', 'Done'];

const USER_GROUP_SPECS = [
  { name: 'MATURE_ENG', alias: 'mature-eng' },
  { name: 'MATURE_DESIGN', alias: 'mature-design' },
  { name: 'MATURE_SUPPORT', alias: 'mature-support' },
  { name: 'MATURE_PRODUCT', alias: 'mature-product' },
  { name: 'MATURE_ONCALL', alias: 'mature-oncall' },
];

const AUTOMATION_EVENT_TYPES = [
  WorkflowEventType.TICKET_CREATED,
  WorkflowEventType.TICKET_UPDATED,
  WorkflowEventType.MESSAGE_RECEIVED,
];

const AUTOMATION_NAMES = [
  'Notify assignee on new ticket',
  'Ping channel on status change',
  'Archive stale waiting tickets',
  'Route VIP emails to on-call',
  'Post incident summary to releases',
  'Sync ticket labels from form',
  'Escalate overdue SLA tickets',
  'Mirror merged PRs to engineering',
  'Welcome message on desk intake',
  'Digest open tickets every morning',
];

const HEADLESS_TITLES = [
  'Product sync — roadmap Q3',
  'Customer call — onboarding friction',
  'Incident retro notes',
  'Design review — call lobby',
  'Sprint planning recording',
  'Architecture deep-dive — search',
  'Weekly leadership sync',
  'Partner integration walkthrough',
  'Support escalation review',
  'Release readiness check',
];

const DESK_SUBJECTS = [
  'Cannot export canvas to PDF',
  'SSO login loop on mobile',
  'Billing invoice mismatch',
  'API rate limit errors spike',
  'Desk email threading broken',
  'Missing notifications for mentions',
  'Ticket board drag-drop glitch',
  'Call recording not appearing',
  'Slow channel load after deploy',
  'Need help migrating Slack history',
];

const RCA_SUMMARIES = [
  'Checkout error rate spiked during a cache stampede on channel stats refresh.',
  'Search index lag caused stale results for recently updated tickets.',
  'Recording upload pipeline stalled when GCS credentials expired.',
  'Email merge incorrectly grouped two unrelated customer threads.',
  'Mobile web canvas pinch-zoom regressed after a CSS deploy.',
];

const KB_DOC_TITLES = [
  'Incident Response Playbook',
  'On-call Escalation Matrix',
  'Release Checklist Template',
  'API Rate Limiting Guide',
  'Customer Ops Desk Runbook',
  'Digital Twin Memory Model',
  'Zero Mutator Conventions',
  'Canvas Export Troubleshooting',
  'SSO Configuration Notes',
  'Search Index Rebuild Steps',
  'Call Recording Retention Policy',
  'Automation Trigger Catalog',
  'Form Field Best Practices',
  'PR Check Integration Guide',
  'Knowledge Base Collection ACLs',
];

const FIRST = ['Anika', 'Rohan', 'Meera', 'Arjun', 'Sofia', 'Liam', 'Yuki', 'Elena'];
const LAST = ['Sharma', 'Patel', 'Nguyen', 'Kim', 'Fernandez', 'Brooks', 'Tanaka', 'Okafor'];
const AV_BG = ['6276BE', 'E91E63', '4CAF50', 'FF9800', '9C27B0', '009688', 'F44336', '3F51B5'];

const now = Date.now();
const minsAgo = (m: number) => new Date(now - m * 60_000);
const hoursAgo = (h: number) => new Date(now - h * 60 * 60_000);
const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60_000);

type U = { id: string; email: string };
type Me = U & { name: string | null };

let meId = '';
let wsId = '';
let orgName = '';

const pick = <T,>(arr: T[], i: number): T => arr[i % arr.length];

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
    boardId: board.id,
    orgId: orgMember.orgId,
    orgName: org?.name ?? 'xyne-default-org',
  };
}

async function ensureLightCoworkers(workspaceId: string, orgId: string, count = 8): Promise<U[]> {
  const existing = await prisma.user.findMany({
    where: { email: { startsWith: USER_EMAIL_PREFIX } },
    select: { id: true, email: true },
  });
  if (existing.length) return existing;

  const out: U[] = [];
  for (let i = 0; i < count; i++) {
    const email = `${USER_EMAIL_PREFIX}${String(i).padStart(3, '0')}@xyne.test`;
    const name = `${pick(FIRST, i)} ${pick(LAST, i + 2)}`;
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

async function ensureCopsProject(workspaceId: string, createdBy: string) {
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

  for (let i = 0; i < COPS_STAGES.length; i++) {
    await prisma.stage.create({
      data: {
        name: COPS_STAGES[i],
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

function fakeTranscript(speakers: string[], lines = 6): string {
  return Array.from({ length: lines }, (_, i) => {
    const speaker = pick(speakers, i);
    const text = pick(
      [
        'Let us walk through the timeline from the alert.',
        'The regression correlates with the deploy at 14:02 IST.',
        'We should add a guardrail before the next release.',
        'Customers on the enterprise plan were most affected.',
        'I will follow up with a canvas summary after this call.',
        'Can we capture this as a ticket for the board?',
        'Recording looks good — transcript should index in Ask AI.',
        'Agreed — ship the fix behind a workspace flag first.',
      ],
      i + 2,
    );
    return `${speaker}: ${text}`;
  }).join('\n');
}

function fakeAiSummary(title: string): string {
  return `Summary for "${title}": team aligned on root cause, owners assigned, and a follow-up ticket will track the remediation work.`;
}

function fakeBulletSummary(title: string): string {
  return [
    `• ${title}`,
    '• Key decisions captured in marked items',
    '• Follow-up: ticket + canvas update',
    '• No blockers for the next sprint slice',
  ].join('\n');
}

// ---- idempotency / wipe ----

async function extrasAlreadySeeded(): Promise<boolean> {
  const hit = await prisma.call.findFirst({
    where: {
      callType: CallType.HEADLESS,
      metadata: { path: ['seed'], equals: 'mature-extras' },
    },
    select: { id: true },
  });
  return !!hit;
}

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

async function wipeExtras() {
  console.log('  collecting mature-extras data to remove...');

  // HEADLESS calls + recordings
  const headlessCalls = await prisma.call.findMany({
    where: { metadata: { path: ['seed'], equals: 'mature-extras' } },
    select: { id: true },
  });
  if (headlessCalls.length) {
    const callIds = headlessCalls.map(c => c.id);
    await prisma.callRecording.deleteMany({ where: { callId: { in: callIds } } });
    await prisma.callParticipant.deleteMany({ where: { callId: { in: callIds } } });
    await prisma.call.deleteMany({ where: { id: { in: callIds } } });
    console.log(`  wiped ${callIds.length} extras calls (HEADLESS + enriched VIDEO recordings tagged mature-extras)`);
  }

  // EMAIL desk channel
  const emailChannels = await prisma.channel.findMany({
    where: {
      type: ChannelType.EMAIL,
      OR: [
        { description: { contains: MATURE_MARKER } },
        { metadata: { path: ['seed'], equals: 'mature-extras' } },
      ],
    },
    select: { id: true },
  });
  const emailChannelIds = emailChannels.map(c => c.id);

  if (emailChannelIds.length) {
    const deskTickets = await prisma.ticket.findMany({
      where: {
        channelId: { in: emailChannelIds },
        metadata: { path: ['seed'], equals: 'mature-extras' },
      },
      select: { id: true, conversationId: true },
    });
    const deskConvIds = deskTickets.map(t => t.conversationId);
    await prisma.email.deleteMany({ where: { channelId: { in: emailChannelIds } } });
    if (deskTickets.length) {
      await prisma.ticket.deleteMany({ where: { id: { in: deskTickets.map(t => t.id) } } });
    }
    await deleteConversations(deskConvIds);
    await prisma.emailChannelPreference.deleteMany({ where: { channelId: { in: emailChannelIds } } });
    await prisma.channelParticipant.deleteMany({ where: { channelId: { in: emailChannelIds } } });
    await prisma.channelUserStatus.deleteMany({ where: { channelId: { in: emailChannelIds } } });
    await prisma.channelStats.deleteMany({ where: { channelId: { in: emailChannelIds } } });
    await prisma.channel.deleteMany({ where: { id: { in: emailChannelIds } } });
    console.log(`  wiped EMAIL desk channel(s) and ${deskTickets.length} desk tickets`);
  }

  // RCAs tagged by title prefix
  const rcas = await prisma.rCA.findMany({
    where: { title: { startsWith: '[Mature] ' } },
    select: { id: true, ticketId: true },
  });
  if (rcas.length) {
    const rcaIds = rcas.map(r => r.id);
    const ticketIds = rcas.map(r => r.ticketId);
    await prisma.cOE.deleteMany({ where: { rcaId: { in: rcaIds } } });
    await prisma.impact.deleteMany({ where: { OR: [{ rcaId: { in: rcaIds } }, { ticketId: { in: ticketIds } }] } });
    await prisma.rCA.deleteMany({ where: { id: { in: rcaIds } } });
    console.log(`  wiped ${rcaIds.length} RCAs`);
  }

  // Collections
  const collections = await prisma.collection.findMany({
    where: {
      OR: [
        { description: { contains: MATURE_MARKER } },
        { name: { contains: MATURE_MARKER } },
      ],
    },
    select: { id: true },
  });
  if (collections.length) {
    const collectionIds = collections.map(c => c.id);
    await prisma.collectionPermission.deleteMany({ where: { collectionId: { in: collectionIds } } });
    await prisma.collectionItem.deleteMany({ where: { collectionId: { in: collectionIds } } });
    await prisma.collection.deleteMany({ where: { id: { in: collectionIds } } });
    console.log(`  wiped ${collectionIds.length} collections`);
  }

  // Automations
  const workflows = await prisma.workflow.findMany({
    where: { metadata: { contains: 'mature-extras' } },
    select: { id: true },
  });
  if (workflows.length) {
    await prisma.workflow.deleteMany({ where: { id: { in: workflows.map(w => w.id) } } });
    console.log(`  wiped ${workflows.length} automations`);
  }

  // Forms
  const forms = await prisma.form.findMany({
    where: { formDescription: { contains: MATURE_MARKER } },
    select: { id: true },
  });
  if (forms.length) {
    const formIds = forms.map(f => f.id);
    await prisma.formEntityValues.deleteMany({ where: { formId: { in: formIds } } });
    await prisma.formFields.deleteMany({ where: { formId: { in: formIds } } });
    await prisma.formContextMapping.deleteMany({ where: { formId: { in: formIds } } });
    await prisma.form.deleteMany({ where: { id: { in: formIds } } });
    console.log(`  wiped ${formIds.length} forms`);
  }

  // User groups
  const groups = await prisma.userGroup.findMany({
    where: { name: { startsWith: 'MATURE_' } },
    select: { id: true },
  });
  if (groups.length) {
    const groupIds = groups.map(g => g.id);
    await prisma.userGroupMapping.deleteMany({ where: { userGroupId: { in: groupIds } } });
    await prisma.userGroup.deleteMany({ where: { id: { in: groupIds } } });
    console.log(`  wiped ${groupIds.length} user groups`);
  }

  // Knowledge documents
  const docs = await prisma.knowledgeDocument.deleteMany({
    where: { metadata: { path: ['seed'], equals: 'mature-extras' } },
  });
  if (docs.count) console.log(`  wiped ${docs.count} knowledge documents`);

  // Pull requests (extras marker in URL)
  const prs = await prisma.pullRequests.deleteMany({
    where: { prUrl: { contains: PR_URL_MARKER } },
  });
  if (prs.count) console.log(`  wiped ${prs.count} pull requests`);

  console.log('  ✅ extras wipe done');
}

// ---- phases ----

async function phase1EnrichVideoCalls(coworkers: U[]) {
  console.log('\n📼 Phase 1: Enrich existing VIDEO mature calls...');

  const videoCalls = await prisma.call.findMany({
    where: {
      callType: CallType.VIDEO,
      OR: [
        { metadata: { path: ['seed'], equals: 'mature' } },
        { description: { contains: MATURE_MARKER } },
      ],
    },
    select: { id: true, title: true, startedAt: true, endedAt: true },
    orderBy: { startedAt: 'asc' },
  });

  if (!videoCalls.length) {
    console.log('  ⏭️  No mature VIDEO calls found — run mature-user-seed.ts first.');
    return { enriched: 0, recordings: 0 };
  }

  const toEnrich = videoCalls.filter((_, i) => i % 2 === 0);
  const speakers = ['You', ...coworkers.slice(0, 3).map((_, i) => pick(FIRST, i))];
  let recordings = 0;

  for (const call of toEnrich) {
    const title = call.title ?? 'Team call';
    const startedAt = call.startedAt;
    const endedAt = call.endedAt ?? new Date(startedAt.getTime() + 45 * 60_000);
    const recordingUrl = `gs://xyne-demo-recordings/${call.id}.mp4`;

    await prisma.call.update({
      where: { id: call.id },
      data: {
        transcript: fakeTranscript(speakers, 8),
        aiSummary: fakeAiSummary(title),
        recordingUrl,
        recordingEnabled: true,
      },
    });

    const existingRecording = await prisma.callRecording.findFirst({
      where: { callId: call.id },
      select: { id: true },
    });
    if (!existingRecording) {
      await prisma.callRecording.create({
        data: {
          workspaceId: wsId,
          callId: call.id,
          startedBy: meId,
          name: 'Recording 1',
          recordingType: RecordingType.AUDIO_VIDEO,
          status: RecordingStatus.RECORDING_UPLOADED,
          storagePath: recordingUrl,
          startedAt,
          endedAt,
          createdAt: startedAt,
        },
      });
      recordings += 1;
    }
  }

  console.log(`  ✅ Enriched ${toEnrich.length}/${videoCalls.length} VIDEO calls, created ${recordings} CallRecording rows`);
  return { enriched: toEnrich.length, recordings };
}

async function phase2HeadlessRecordings(coworkers: U[], platformChannels: Array<{ id: string; name: string }>) {
  console.log('\n🎙️  Phase 2: HEADLESS recordings (RecordingsV2)...');

  const calls: any[] = [];
  const participants: any[] = [];

  for (let i = 0; i < HEADLESS_RECORDINGS; i++) {
    const callId = createId();
    const externalId = createId();
    const dayOffset = Math.floor((i * HISTORY_DAYS) / Math.max(HEADLESS_RECORDINGS, 1));
    const started = daysAgo(dayOffset + 1);
    const durationMins = 18 + (i % 40);
    const ended = new Date(started.getTime() + durationMins * 60_000);
    const ch = platformChannels[i % platformChannels.length];
    const channelId = i % 5 === 0 ? null : ch?.id ?? null;
    const title = pick(HEADLESS_TITLES, i);
    const coworkerSlice = coworkers.slice(i % coworkers.length, (i % coworkers.length) + 2);

    const markedItems =
      i % 4 === 0
        ? [
            { type: 'decision', text: 'Ship behind workspace flag', timestampSeconds: 120 },
            { type: 'action', text: 'Open follow-up ticket', timestampSeconds: 240 },
          ]
        : [];

    calls.push({
      workspaceId: wsId,
      id: callId,
      externalId,
      title,
      createdByUserId: meId,
      organizerId: meId,
      channelId,
      orgName,
      description: `${title} — note-taker capture ${MATURE_MARKER}`,
      callType: CallType.HEADLESS,
      status: CallStatus.ENDED,
      recordingEnabled: true,
      recordingUrl: i % 3 === 0 ? `gs://xyne-demo-recordings/${callId}.mp4` : null,
      transcript: fakeTranscript(['Note Taker', pick(FIRST, i), pick(FIRST, i + 3)], 10),
      aiSummary: fakeBulletSummary(title),
      startedAt: started,
      endedAt: ended,
      lastActivityAt: ended,
      createdAt: started,
      updatedAt: ended,
      metadata: SEED_META_EXTRAS,
      labels: [],
      markedItems,
      participantCount: 1 + coworkerSlice.length,
    });

    const memberIds = [meId, ...coworkerSlice.map(c => c.id)];
    Array.from(new Set(memberIds)).forEach(userId => {
      participants.push({
        workspaceId: wsId,
        callId,
        userId,
        invitedBy: meId,
        response: InvitationResponse.ACCEPTED,
        joinedAt: started,
        leftAt: ended,
        invitedAt: started,
        meetingStatus: 'ENDED',
        respondedAt: started,
      });
    });
  }

  const chunk = 500;
  for (let i = 0; i < calls.length; i += chunk) {
    await prisma.call.createMany({ data: calls.slice(i, i + chunk) });
  }
  for (let i = 0; i < participants.length; i += chunk) {
    await prisma.callParticipant.createMany({ data: participants.slice(i, i + chunk) });
  }

  console.log(`  ✅ Created ${calls.length} HEADLESS calls with ${participants.length} participants`);
  return { calls: calls.length, participants: participants.length };
}

async function ensureEmailDeskChannel(
  copsProjectId: string,
  intakeBoardId: string,
  coworkers: U[],
) {
  const existing = await prisma.channel.findFirst({
    where: { name: EMAIL_CHANNEL_NAME, projectId: copsProjectId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const channelId = createId();
  const nowDt = new Date();
  const members = [{ id: meId, email: 'me' }, ...coworkers.slice(0, 6)];

  await prisma.channel.create({
    data: {
      id: channelId,
      name: EMAIL_CHANNEL_NAME,
      description: `Customer Ops EMAIL desk inbox ${MATURE_MARKER}`,
      type: ChannelType.EMAIL,
      scopeType: ChannelScopeType.DEFAULT,
      visibility: ChannelVisibility.PRIVATE,
      createdBy: meId,
      projectId: copsProjectId,
      workspaceId: wsId,
      participantCount: members.length,
      isMigrated: false,
      lastActivityAt: nowDt,
      metadata: SEED_META_EXTRAS,
    },
  });

  await prisma.channelStats.create({
    data: {
      workspaceId: wsId,
      channelId,
      lastActivityAt: nowDt,
      participantCount: members.length,
    },
  });

  for (const u of members) {
    await prisma.channelParticipant.create({
      data: {
        workspaceId: wsId,
        channelId,
        userId: u.id,
        role: u.id === meId ? ChannelRole.ADMIN : ChannelRole.MEMBER,
      },
    });
    await prisma.channelUserStatus.create({
      data: {
        workspaceId: wsId,
        channelId,
        userId: u.id,
        lastViewedAt: nowDt,
        conversationSeenCutoffAt: nowDt,
        updatedAt: nowDt,
      },
    });
  }

  await prisma.emailChannelPreference.create({
    data: {
      channelId,
      ownerUserId: meId,
      boardId: intakeBoardId,
      workspaceId: wsId,
      sendAsEmail: 'support@xyne.ai',
      deskType: 'EMAIL',
      metricsEnabled: true,
    },
  });

  return channelId;
}

async function phase3DeskEmail(
  copsProjectId: string,
  intakeBoardId: string,
  coworkers: U[],
) {
  console.log('\n📧 Phase 3: Desk / EMAIL support...');

  const channelId = await ensureEmailDeskChannel(copsProjectId, intakeBoardId, coworkers);
  const xyneStart = await nextXyneIdStart('COPS', wsId);

  const conversations: any[] = [];
  const messages: any[] = [];
  const tickets: any[] = [];
  const emails: any[] = [];

  for (let i = 0; i < DESK_TICKETS; i++) {
    const ticketId = createId();
    const conversationId = createId();
    const messageId = createId();
    const xyneId = `COPS-${String(xyneStart + i).padStart(5, '0')}`;
    const subject = pick(DESK_SUBJECTS, i);
    const stageName = pick(COPS_STAGES, i);
    const createdAt = daysAgo(5 + Math.floor((i * HISTORY_DAYS) / Math.max(DESK_TICKETS, 1)));
    const updatedAt = daysAgo(Math.max(1, Math.floor(i / 4)));
    const emailCount = 2 + (i % 3);
    const externalThreadId = `thread-${createId()}`;
    const reporterEmail = `customer${String(i % 200).padStart(3, '0')}@example.com`;

    const firstBody = `Hi support team,\n\nWe're seeing an issue: ${subject}. This started around ${createdAt.toISOString().slice(0, 10)}.\n\nThanks,\nCustomer ${i}`;

    messages.push({
      workspaceId: wsId,
      messageId,
      conversationId,
      senderId: meId,
      content: subject,
      msgType: MessageType.USER,
      showInChannel: false,
      createdAt,
    });

    conversations.push({
      workspaceId: wsId,
      conversationId,
      channelId,
      createdBy: meId,
      initialMessageId: messageId,
      ticketId,
      createdAt,
      lastActivityAt: updatedAt,
      replyCount: emailCount - 1,
      initial_message_md: serializeInitialMessageMd({
        messageId,
        conversationId,
        senderId: meId,
        content: subject,
        msgType: MessageType.USER,
        hasAttachment: false,
        edited: false,
        isDeleted: false,
        showInChannel: false,
        visibleTo: null,
        createdAt: createdAt.getTime(),
        isSent: true,
      }),
      metadata: SEED_META_EXTRAS,
    });

    tickets.push({
      id: ticketId,
      title: subject,
      description: `${subject} — desk ticket ${MATURE_MARKER}`,
      status: stageName === 'Done' ? TicketStatus.RESOLVED : TicketStatus.IN_PROGRESS,
      statusV2:
        stageName === 'Done'
          ? TicketStatusV2.COMPLETED
          : stageName === 'Triage'
            ? TicketStatusV2.TODO
            : TicketStatusV2.STARTED,
      createdBy: meId,
      updatedBy: meId,
      assignedTo: pick([meId, ...coworkers.map(c => c.id)], i),
      conversationId,
      channelId,
      xyneId,
      projectId: copsProjectId,
      workspaceId: wsId,
      boardId: intakeBoardId,
      stageName,
      priority: pick(
        [TicketPriority.LOW, TicketPriority.MEDIUM, TicketPriority.HIGH, TicketPriority.CRITICAL],
        i,
      ),
      metadata: { ...SEED_META_EXTRAS, desk: true },
      lastEmailAt: updatedAt,
      emailCount,
      createdAt,
      updatedAt,
      statusUpdatedAt: updatedAt,
      ...(stageName === 'Done' ? { closedAt: updatedAt, closedBy: meId } : {}),
    });

    for (let e = 0; e < emailCount; e++) {
      const isInbound = e === 0;
      const emailAt = new Date(createdAt.getTime() + e * 3600_000);
      emails.push({
        workspaceId: wsId,
        type: isInbound ? EmailType.DEFAULT : EmailType.REPLY,
        subject: isInbound ? subject : `Re: ${subject}`,
        body: isInbound
          ? firstBody
          : `Thanks for reaching out — we're investigating ${subject}. ${MATURE_MARKER}`,
        to: isInbound ? ['support@xyne.ai'] : [reporterEmail],
        from: isInbound ? reporterEmail : 'support@xyne.ai',
        cc: [],
        bcc: [],
        replyTo: [],
        conversationId,
        channelId,
        externalThreadId,
        externalMessageId: `msg-${createId()}`,
        sentByUserId: isInbound ? null : meId,
        createdAt: emailAt,
        updatedAt: emailAt,
      });
    }
  }

  const chunk = 500;
  for (let i = 0; i < conversations.length; i += chunk) {
    await prisma.conversation.createMany({ data: conversations.slice(i, i + chunk) });
  }
  for (let i = 0; i < messages.length; i += chunk) {
    await prisma.message.createMany({ data: messages.slice(i, i + chunk) });
  }
  for (let i = 0; i < tickets.length; i += chunk) {
    await prisma.ticket.createMany({ data: tickets.slice(i, i + chunk) });
  }
  for (let i = 0; i < emails.length; i += chunk) {
    await prisma.email.createMany({ data: emails.slice(i, i + chunk) });
  }

  console.log(
    `  ✅ Desk channel ${EMAIL_CHANNEL_NAME}: ${tickets.length} tickets, ${emails.length} emails`,
  );
  return { tickets: tickets.length, emails: emails.length, channelId };
}

async function phase4RCAs(platformProjectId: string) {
  console.log('\n🔍 Phase 4: RCAs...');

  const ticketPool =
    (await prisma.ticket.findMany({
      where: {
        projectId: platformProjectId,
        OR: [
          { metadata: { path: ['seed'], equals: 'mature' } },
          { metadata: { path: ['seed'], equals: 'mature-extras' } },
        ],
      },
      select: { id: true, xyneId: true, title: true },
      orderBy: { createdAt: 'desc' },
      take: RCAS * 2,
    })) ??
    [];

  if (!ticketPool.length) {
    const fallback = await prisma.ticket.findMany({
      where: { projectId: platformProjectId },
      select: { id: true, xyneId: true, title: true },
      orderBy: { createdAt: 'desc' },
      take: RCAS,
    });
    ticketPool.push(...fallback);
  }

  const severities = ['HIGH', 'MEDIUM', 'LOW'];
  const statuses = ['DRAFT', 'IN_REVIEW', 'CLOSED'];
  const impactTypes = ['customer', 'revenue', 'ops'];
  const coeActions = ['rate_limit', 'cache_guard', 'alert_tuning', 'runbook_update', 'capacity_plan'];
  const coeStatuses = ['OPEN', 'COMPLETED'];

  let rcaCount = 0;
  let impactCount = 0;
  let coeCount = 0;

  for (let i = 0; i < Math.min(RCAS, ticketPool.length); i++) {
    const ticket = ticketPool[i];
    const createdAt = daysAgo(20 + i * 3);
    const title = `[Mature] RCA — ${ticket.title.slice(0, 60)}`;
    const summary = pick(RCA_SUMMARIES, i);

    const rca = await prisma.rCA.create({
      data: {
        workspaceId: wsId,
        title,
        ticketId: ticket.id,
        ownerId: meId,
        severity: pick(severities, i),
        status: pick(statuses, i),
        bugTypeId: 'reliability',
        categoryTypeId: 'capacity',
        issueCategoryId: 'no_early_detection',
        summary,
        rootCause: `${summary} Root cause traced to a missing guardrail in the ingestion path.`,
        createdAt,
        updatedAt: createdAt,
      },
    });
    rcaCount += 1;

    const impactsToCreate = 1 + (i % 2);
    for (let j = 0; j < impactsToCreate; j++) {
      await prisma.impact.create({
        data: {
          workspaceId: wsId,
          ticketId: ticket.id,
          rcaId: rca.id,
          impactTypeId: pick(impactTypes, i + j),
          impact: `Impact on ${pick(impactTypes, i + j)} workflows for ${ticket.xyneId}.`,
          createdAt,
        },
      });
      impactCount += 1;
    }

    const coesToCreate = 1 + (i % 2);
    for (let j = 0; j < coesToCreate; j++) {
      await prisma.cOE.create({
        data: {
          workspaceId: wsId,
          rcaId: rca.id,
          ownerId: meId,
          actionTypeId: pick(coeActions, i + j),
          action: `COE action: ${pick(coeActions, i + j)} for ${ticket.xyneId}.`,
          status: pick(coeStatuses, i + j),
          dueDate: daysAgo(-14 + j * 3),
          createdAt,
          ...(pick(coeStatuses, i + j) === 'COMPLETED' ? { completedAt: daysAgo(1) } : {}),
        },
      });
      coeCount += 1;
    }
  }

  console.log(`  ✅ Created ${rcaCount} RCAs, ${impactCount} impacts, ${coeCount} COEs`);
  return { rcas: rcaCount, impacts: impactCount, coes: coeCount };
}

async function phase5Collections(kbChannels: Array<{ id: string; name: string }>) {
  console.log('\n📚 Phase 5: Knowledge Base collections...');

  const channelTargets = kbChannels.slice(0, Math.max(1, Math.min(KB_CHANNEL_NAMES.length, COLLECTIONS)));
  let collectionCount = 0;
  let itemCount = 0;
  const filesPerChannel = Math.max(1, Math.floor(KB_FILES / Math.max(channelTargets.length, 1)));

  for (let i = 0; i < channelTargets.length; i++) {
    const ch = channelTargets[i];
    const createdAt = daysAgo(60 + i * 10);
    const rootName = `Team knowledge — ${ch.name}`;
    const rootDescription = `${rootName} ${MATURE_MARKER}`;

    const root = await prisma.collection.create({
      data: {
        workspaceId: wsId,
        ownerId: meId,
        name: rootName,
        scopeType: 'CHANNEL',
        scopeId: ch.id,
        description: rootDescription,
        isPrivate: false,
        rootCollectionId: null,
        createdAt,
        updatedAt: createdAt,
      },
    });
    collectionCount += 1;

    const folder = await prisma.collection.create({
      data: {
        workspaceId: wsId,
        parentId: root.id,
        ownerId: meId,
        name: 'Runbooks',
        scopeType: 'CHANNEL',
        scopeId: ch.id,
        description: `Runbooks folder ${MATURE_MARKER}`,
        isPrivate: false,
        rootCollectionId: root.id,
        createdAt: daysAgo(55 + i * 10),
        updatedAt: daysAgo(50 + i * 10),
      },
    });
    collectionCount += 1;

    await prisma.collectionPermission.create({
      data: {
        workspaceId: wsId,
        collectionId: root.id,
        userId: meId,
        role: CollectionRole.OWNER,
        canShare: true,
        grantedBy: meId,
        createdAt,
        updatedAt: createdAt,
      },
    });

    const items: any[] = [];
    for (let f = 0; f < filesPerChannel; f++) {
      const fileId = createId();
      const at = daysAgo(40 + f + i);
      const inFolder = f % 2 === 1;
      items.push({
        workspaceId: wsId,
        rootCollectionId: root.id,
        collectionId: inFolder ? folder.id : root.id,
        fileId,
        ownerId: meId,
        name: `runbook-${i}-${f}.md`,
        uploadedById: meId,
        ingestionStatus: 'NONE',
        versionNumber: 1,
        isLatest: true,
        createdAt: at,
        updatedAt: at,
      });
      itemCount += 1;
    }

    await prisma.collectionItem.createMany({ data: items });
  }

  console.log(`  ✅ Created ${collectionCount} collections and ${itemCount} collection items`);
  return { collections: collectionCount, items: itemCount };
}

async function phase6Automations() {
  console.log('\n⚙️  Phase 6: Automations...');

  const rows: any[] = [];
  for (let i = 0; i < AUTOMATIONS; i++) {
    const eventType = pick(AUTOMATION_EVENT_TYPES, i);
    const name = pick(AUTOMATION_NAMES, i);
    const createdAt = daysAgo(30 + i * 5);
    rows.push({
      workspaceId: wsId,
      workflowType: AUTOMATION_WORKFLOW_TYPE,
      eventType,
      status: 'SUCCESS',
      workflowName: name,
      context: JSON.stringify({
        trigger: { type: eventType, config: {} },
        steps: [{ id: '1', type: 'notify', config: { channel: 'engineering' } }],
      }),
      metadata: JSON.stringify({
        description: MATURE_MARKER,
        createdById: meId,
        seed: 'mature-extras',
      }),
      automationSeriesId: createId(),
      createdAt,
      updatedAt: createdAt,
    });
  }

  await prisma.workflow.createMany({ data: rows });
  console.log(`  ✅ Created ${rows.length} automations`);
  return { automations: rows.length };
}

async function phase7Forms(boardIds: string[]) {
  console.log('\n📝 Phase 7: Forms...');

  const formNames = [
    'Mature Ticket Intake',
    'Mature Bug Report',
    'Mature Feature Request',
    'Mature Customer Escalation',
    'Mature Release Checklist',
    'Mature On-call Handoff',
  ];

  let formCount = 0;
  let fieldCount = 0;
  let mappingCount = 0;

  for (let i = 0; i < Math.min(FORMS, formNames.length); i++) {
    const boardId = boardIds[i % boardIds.length];
    const createdAt = daysAgo(45 + i * 4);

    const form = await prisma.form.create({
      data: {
        formName: formNames[i],
        formDescription: `${formNames[i]} ${MATURE_MARKER}`,
        entityType: FormEntityType.TICKET,
        contextType: FormContextType.BOARD,
        workspaceId: wsId,
        createdBy: meId,
        createdAt,
        updatedAt: createdAt,
      },
    });
    formCount += 1;

    const fields = [
      {
        workspaceId: wsId,
        formId: form.id,
        fieldName: 'estimatedHours',
        fieldType: FormFieldType.NUMBER,
        isOptional: false,
        sequenceNumber: 0,
      },
      {
        workspaceId: wsId,
        formId: form.id,
        fieldName: 'priorityBand',
        fieldType: FormFieldType.SINGLE_SELECT,
        fieldEnum: ['Low', 'Medium', 'High'].map(value => ({ id: createId(), value })),
        isOptional: false,
        sequenceNumber: 1,
      },
      {
        workspaceId: wsId,
        formId: form.id,
        fieldName: 'needsReview',
        fieldType: FormFieldType.BOOLEAN,
        isOptional: true,
        sequenceNumber: 2,
      },
    ];

    await prisma.formFields.createMany({ data: fields });
    fieldCount += fields.length;

    const existingMapping = await prisma.formContextMapping.findUnique({
      where: {
        contextId_entityType: {
          contextId: boardId,
          entityType: FormEntityType.TICKET,
        },
      },
    });
    if (!existingMapping) {
      await prisma.formContextMapping.create({
        data: {
          workspaceId: wsId,
          formId: form.id,
          contextId: boardId,
          contextType: FormContextType.BOARD,
          entityType: FormEntityType.TICKET,
        },
      });
      mappingCount += 1;
    }
  }

  console.log(`  ✅ Created ${formCount} forms, ${fieldCount} fields, ${mappingCount} context mappings`);
  return { forms: formCount, fields: fieldCount, mappings: mappingCount };
}

async function phase8PRs() {
  console.log('\n🔀 Phase 8: Pull Requests...');

  const rows: any[] = [];
  const basePrId = 9000 + Math.floor(Math.random() * 1000);
  const branches = [
    'feature/digital-twin-motion',
    'fix/channel-cursor-pagination',
    'chore/mature-seed-extras',
    'feat/desk-email-threading',
    'fix/call-recording-upload',
    'feat/kb-collections-acl',
  ];

  for (let i = 0; i < PRS; i++) {
    const prId = basePrId + i;
    const branch = pick(branches, i);
    const date = daysAgo(Math.floor((i * HISTORY_DAYS) / Math.max(PRS, 1)));
    const status = i % 3 === 0 ? PRStatus.MERGED : PRStatus.OPEN;
    rows.push({
      workspaceId: wsId,
      prId,
      repoName: 'xyne-spaces',
      sourceBranchName: branch,
      destinationBranchName: 'develop',
      date,
      numberOfComments: i % 12,
      repositoryUrl: 'https://github.com/xyne/xyne-spaces',
      prUrl: `https://github.com/xyne/xyne-spaces/pull/${prId}?${PR_URL_MARKER}`,
      status,
      updatedAt: hoursAgo(i % 48),
    });
  }

  await prisma.pullRequests.createMany({ data: rows });
  console.log(`  ✅ Created ${rows.length} pull requests`);
  return { prs: rows.length };
}

async function phase9UserGroups(coworkers: U[]) {
  console.log('\n👥 Phase 9: UserGroups...');

  let groupCount = 0;
  let mappingCount = 0;
  const specs = USER_GROUP_SPECS.slice(0, USER_GROUPS);

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const existing = await prisma.userGroup.findFirst({
      where: { workspaceId: wsId, name: spec.name },
      select: { id: true },
    });
    if (existing) continue;

    const group = await prisma.userGroup.create({
      data: {
        workspaceId: wsId,
        name: spec.name,
        alias: spec.alias,
        description: `${spec.name} mature extras group ${MATURE_MARKER}`,
        metadata: SEED_META_EXTRAS,
        createdBy: meId,
      },
    });
    groupCount += 1;

    const members = [meId, ...coworkers.slice(i, i + 3).map(c => c.id)];
    const uniqueMembers = Array.from(new Set(members));
    for (const userId of uniqueMembers) {
      await prisma.userGroupMapping.create({
        data: {
          workspaceId: wsId,
          userId,
          userGroupId: group.id,
        },
      });
      mappingCount += 1;
    }
  }

  console.log(`  ✅ Created ${groupCount} user groups with ${mappingCount} mappings`);
  return { groups: groupCount, mappings: mappingCount };
}

async function phase10KnowledgeDocs(platformProjectId: string) {
  console.log('\n📖 Phase 10: KnowledgeDocuments...');

  const rows: any[] = [];
  for (let i = 0; i < KNOWLEDGE_DOCS; i++) {
    const title = pick(KB_DOC_TITLES, i);
    const createdAt = daysAgo(70 + i * 6);
    rows.push({
      workspaceId: wsId,
      projectId: platformProjectId,
      title,
      content: `## ${title}\n\nDocument seeded for mature extras.\n\n- ${MATURE_MARKER}\n- Owner: me\n- Last reviewed ${createdAt.toISOString().slice(0, 10)}`,
      approvedBy: meId,
      approvedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      metadata: {
        seed: 'mature-extras',
        tags: ['mature', 'extras', pick(['runbook', 'playbook', 'guide'], i)],
      },
    });
  }

  await prisma.knowledgeDocument.createMany({ data: rows });
  console.log(`  ✅ Created ${rows.length} knowledge documents`);
  return { docs: rows.length };
}

async function main() {
  console.log('🌱 Mature user seed extras (remaining surfaces)...\n');

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development') {
    console.error(`❌ Refusing to run: NODE_ENV is "${nodeEnv}", expected "development".`);
    process.exit(1);
  }

  if (process.env.MATURE_EXTRAS_WIPE === '1') {
    console.log('🧹 Wiping previous mature-extras data...');
    await wipeExtras();
  } else if (await extrasAlreadySeeded()) {
    console.log('  ⏭️  Mature extras already present (HEADLESS calls tagged mature-extras). Set MATURE_EXTRAS_WIPE=1 to reseed.');
    return;
  }

  const { me, project, boardId, orgId, orgName: org } = await getFoundation();
  meId = me.id;
  wsId = project.workspaceId;
  orgName = org;

  console.log(`  user=${me.email} project=${project.id} (${project.code}) board=${boardId} workspace=${wsId}`);
  console.log(
    `  config: HEADLESS=${HEADLESS_RECORDINGS} DESK_TICKETS=${DESK_TICKETS} RCAS=${RCAS} ` +
      `COLLECTIONS=${COLLECTIONS} KB_FILES=${KB_FILES} AUTOMATIONS=${AUTOMATIONS} FORMS=${FORMS} ` +
      `PRS=${PRS} USER_GROUPS=${USER_GROUPS} KNOWLEDGE_DOCS=${KNOWLEDGE_DOCS}\n`,
  );

  const coworkers = await ensureLightCoworkers(wsId, orgId);
  console.log(`  ✅ ${coworkers.length} mature coworkers available`);

  const copsProject = await ensureCopsProject(wsId, me.id);
  const intakeBoard = await prisma.board.findFirst({
    where: { projectId: copsProject.id, name: 'Intake' },
    select: { id: true },
  });
  if (!intakeBoard) throw new Error('COPS Intake board not found.');

  const platformChannels = await prisma.channel.findMany({
    where: {
      projectId: project.id,
      scopeType: ChannelScopeType.DEFAULT,
      name: { in: [...KB_CHANNEL_NAMES, 'general', 'engineering', 'incidents', 'releases'] },
    },
    select: { id: true, name: true },
  });

  const kbChannels = platformChannels.filter(c => KB_CHANNEL_NAMES.includes(c.name));

  const p1 = await phase1EnrichVideoCalls(coworkers);
  const p2 = await phase2HeadlessRecordings(coworkers, platformChannels);
  const p3 = await phase3DeskEmail(copsProject.id, intakeBoard.id, coworkers);
  const p4 = await phase4RCAs(project.id);
  const p5 = await phase5Collections(kbChannels.length ? kbChannels : platformChannels.slice(0, 4));
  const p6 = await phase6Automations();
  const p7 = await phase7Forms([boardId, intakeBoard.id]);
  const p8 = await phase8PRs();
  const p9 = await phase9UserGroups(coworkers);
  const p10 = await phase10KnowledgeDocs(project.id);

  console.log('\n✅ Mature user seed extras complete.');
  console.log(`   Phase 1 — VIDEO enrich: ${p1.enriched} calls, ${p1.recordings} recordings`);
  console.log(`   Phase 2 — HEADLESS: ${p2.calls} calls, ${p2.participants} participants`);
  console.log(`   Phase 3 — Desk EMAIL: ${p3.tickets} tickets, ${p3.emails} emails`);
  console.log(`   Phase 4 — RCAs: ${p4.rcas} (+ ${p4.impacts} impacts, ${p4.coes} COEs)`);
  console.log(`   Phase 5 — Collections: ${p5.collections} collections, ${p5.items} items`);
  console.log(`   Phase 6 — Automations: ${p6.automations}`);
  console.log(`   Phase 7 — Forms: ${p7.forms}`);
  console.log(`   Phase 8 — PRs: ${p8.prs}`);
  console.log(`   Phase 9 — User groups: ${p9.groups}`);
  console.log(`   Phase 10 — Knowledge docs: ${p10.docs}`);
}

main()
  .catch(e => {
    console.error('❌ Mature user seed extras failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
