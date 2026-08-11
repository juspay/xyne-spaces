#!/usr/bin/env tsx
/// <reference types="node" />

/**
 * Org-scale seed — 100 people, 100 channels, one lived-in company channel.
 *
 * Fills the Default Workspace with something that looks like a real payments
 * company rather than a demo: a directory of 100 people with photographs, the
 * ~100 channels such a company accumulates (public and private, squads through
 * company-wide), and one channel — #xyne-spaces — that everybody is in and that
 * carries a real conversation with threads and reactions.
 *
 * Avatars are fetched from randomuser.me and uploaded into the local GCS
 * emulator, so `users.picture` holds a storage path exactly as it would after a
 * real upload through POST /users/me/picture, and the dashboard streams them
 * back through GET /users/:id/picture. Nothing points at an external image host.
 *
 * Runs alongside `demo-seed.ts` rather than replacing it: everything here hangs
 * off its own project (code JSP) and its own email domain, so either seed can be
 * wiped without touching the other.
 *
 * PREREQUISITE: the ACL seed must have run, so the workspace and org exist.
 *
 * Usage:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/org-seed.ts
 *   ORG_WIPE=1 …           # remove a previous run of this seed first
 *   ORG_SKIP_AVATARS=1 …   # skip the image download/upload entirely
 *   ORG_SKIP_VESPA=1 …     # seed Postgres only, queue nothing for search
 *
 * Idempotent: re-running stops if the JSP project is already there.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { randomUUID } from 'node:crypto';
// The enum columns are plain TEXT since XYNE-16525; @xyne/shared is now the only
// place these values are defined. @prisma/client no longer exports them.
import {
  serializeInitialMessageMd,
  serializeReactionsMd,
  serializeRepliesMd,
  ChannelType,
  ChannelScopeType,
  ChannelVisibility,
  ChannelRole,
  MessageType,
  AuthProvider,
  UserStatus,
  UserType,
  OrgRole,
  WorkspaceRole,
  MessageType as SharedMessageType,
} from '@xyne/shared';
import { PEOPLE, CHANNELS, XYNE_SPACES } from './org-seed-content';

const prisma = new PrismaClient();

const PROJECT_CODE = 'JSP';
const PROJECT_NAME = 'Payments Platform';
/** Distinct from any real login domain, so the wipe can never touch a real account. */
const EMAIL_DOMAIN = '@juspay.team';
const HERO_CHANNEL = 'xyne-spaces';

const WIPE = process.env.ORG_WIPE === '1';
const SKIP_VESPA = process.env.ORG_SKIP_VESPA === '1';
const SKIP_AVATARS = process.env.ORG_SKIP_AVATARS === '1';

type SeededUser = { id: string; email: string; name: string };

const vespaJobs: Array<{ schema: string; docId: string }> = [];

const now = Date.now();
const minsAgo = (m: number) => new Date(now - m * 60_000);
const daysAgo = (d: number) => new Date(now - d * 86_400_000);

/**
 * Deterministic PRNG. Membership, channel sizes and activity dates are all
 * drawn from it, so two runs of this script produce the same workspace — which
 * makes "it looked different yesterday" a real signal rather than noise.
 */
function mulberry32(seed: number) {
  return function random(): number {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260803);

const pick = <T>(items: T[], n: number): T[] => {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
};
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

/** Prisma rejects an empty createMany on some versions; also saves a round trip. */
async function insert<T>(rows: T[], fn: (chunk: T[]) => Promise<unknown>, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    if (chunk.length) await fn(chunk);
  }
}

// ---------------------------------------------------------------------------
// Foundation
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

  /**
   * Whoever already exists and is a person — the accounts someone actually logs
   * in as, plus anyone an earlier seed created. They are put into #xyne-spaces
   * and a share of the other channels, so the workspace is populated from the
   * point of view of the person looking at it rather than only for the 100
   * people this script invents.
   */
  const insiders = await prisma.user.findMany({
    where: {
      workspaceId: workspace.id,
      userType: { not: UserType.BOT },
      status: UserStatus.ACTIVE,
      email: { not: { endsWith: EMAIL_DOMAIN } },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true },
  });

  return { workspace, orgId: orgMember.orgId, insiders };
}

// ---------------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------------

async function wipe() {
  const project = await prisma.project.findFirst({
    where: { code: PROJECT_CODE },
    select: { id: true },
  });

  const channels = project
    ? await prisma.channel.findMany({ where: { projectId: project.id }, select: { id: true } })
    : [];
  const channelIds = channels.map((c) => c.id);

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

  if (project) await prisma.project.deleteMany({ where: { id: project.id } });

  // Only ever the seeded domain — a real login can never match this.
  const seeded = await prisma.user.findMany({
    where: { email: { endsWith: EMAIL_DOMAIN } },
    select: { id: true, picture: true },
  });
  const seededIds = seeded.map((u) => u.id);

  // Delete the avatar objects too. Without this every ORG_WIPE=1 re-run leaves
  // another 100 unreferenced images in the bucket.
  const avatarPaths = seeded
    .map((u) => u.picture)
    .filter((p): p is string => Boolean(p) && !p!.startsWith('http'));
  if (avatarPaths.length) {
    const { getStorageService } = await import('../src/services/storage/storageServiceFactory');
    const storage = getStorageService();
    let removed = 0;
    for (const path of avatarPaths) {
      try {
        await storage.deleteFile(path);
        removed++;
      } catch {
        // Already gone, or storage is down — neither should stop the wipe.
      }
    }
    console.log(`  🧹 removed ${removed}/${avatarPaths.length} avatar objects from the bucket`);
  }

  if (seededIds.length) {
    await prisma.userProfile.deleteMany({ where: { userId: { in: seededIds } } });
    await prisma.channelParticipant.deleteMany({ where: { userId: { in: seededIds } } });
    await prisma.channelUserStatus.deleteMany({ where: { userId: { in: seededIds } } });
  }
  const users = await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  const members = await prisma.orgMember.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });

  console.log(
    `  🧹 wiped ${channelIds.length} channels, ${users.count} users, ${members.count} org members`
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** first.last@domain, with a numeric suffix if two people collide. */
function emailFor(index: number): string {
  const p = PEOPLE[index];
  const base = `${p.first}.${p.last}`.toLowerCase().replace(/[^a-z.]/g, '');
  const earlier = PEOPLE.slice(0, index).filter(
    (o) => `${o.first}.${o.last}`.toLowerCase() === `${p.first}.${p.last}`.toLowerCase()
  ).length;
  return `${base}${earlier ? earlier + 1 : ''}${EMAIL_DOMAIN}`;
}

async function createPeople(workspaceId: string, orgId: string): Promise<SeededUser[]> {
  const members = PEOPLE.map((_, i) => ({
    memberId: createId(),
    orgId,
    email: emailFor(i),
    role: OrgRole.MEMBER,
    joinedAt: daysAgo(between(40, 900)),
  }));

  await insert(members, (chunk) => prisma.orgMember.createMany({ data: chunk, skipDuplicates: true }));

  const users = PEOPLE.map((p, i) => ({
    id: createId(),
    name: `${p.first} ${p.last}`,
    email: members[i].email,
    authProvider: AuthProvider.GOOGLE,
    providerUserId: `org-seed-${members[i].memberId}`,
    status: UserStatus.ACTIVE,
    workspaceId,
    orgMemberId: members[i].memberId,
    role: WorkspaceRole.MEMBER,
    createdAt: members[i].joinedAt,
  }));

  await insert(users, (chunk) => prisma.user.createMany({ data: chunk, skipDuplicates: true }));

  // Titles and teams show up in the profile pane, and make the directory read
  // like an org chart rather than a list of names.
  await insert(
    PEOPLE.map((p, i) => ({
      userId: users[i].id,
      workspaceId,
      team: p.team,
      role: p.title,
      joinedOn: members[i].joinedAt,
    })),
    (chunk) => prisma.userProfile.createMany({ data: chunk, skipDuplicates: true })
  );

  users.forEach((u) => vespaJobs.push({ schema: 'user', docId: u.id }));

  return users.map((u) => ({ id: u.id, email: u.email, name: u.name }));
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

/**
 * Download a portrait per person and put it in the bucket the app itself uses.
 *
 * `users.picture` gets the storage path, not a URL — that is what
 * `uploadProfilePicture` stores and what `GET /users/:id/picture` expects to
 * read back. A full URL would also render (the dashboard passes anything
 * starting with http straight to <img>), but then the images would not actually
 * be in storage, which is the point of doing this.
 *
 * randomuser.me publishes 100 portraits per set under a permissive licence and
 * needs no key. If it cannot be reached the person keeps a generated fallback
 * avatar URL instead of no picture at all.
 */
async function attachAvatars(users: SeededUser[]) {
  if (SKIP_AVATARS) {
    console.log('  ⏭  ORG_SKIP_AVATARS=1 — no images fetched');
    return { uploaded: 0, fallback: 0 };
  }

  const { getStorageService } = await import('../src/services/storage/storageServiceFactory');
  const storage = getStorageService();
  await storage.ensureBucketExists();

  let menIdx = 0;
  let womenIdx = 0;
  const sources = PEOPLE.map((p) => {
    const set = p.g === 'm' ? 'men' : 'women';
    const n = p.g === 'm' ? menIdx++ : womenIdx++;
    return `https://randomuser.me/api/portraits/${set}/${n % 100}.jpg`;
  });

  let uploaded = 0;
  let fallback = 0;

  // A small pool: 100 sequential round trips is slow, 100 parallel ones get
  // throttled by the image host.
  const POOL = 8;
  let cursor = 0;

  async function worker() {
    while (cursor < users.length) {
      const i = cursor++;
      const user = users[i];
      try {
        const res = await fetch(sources[i]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        if (!buffer.length) throw new Error('empty body');

        // Same shape as a real upload: path carries a timestamp, so the
        // dashboard's content-addressed cache busts correctly on change.
        const path = `profile-pictures/${user.id}/${Date.now()}-${randomUUID()}-avatar.jpg`;
        await storage.uploadFileV2(buffer, {
          path,
          contentType: 'image/jpeg',
          cacheControl: 'public, max-age=31536000',
          metadata: { userId: user.id, seededBy: 'org-seed' },
        });
        await prisma.user.update({ where: { id: user.id }, data: { picture: path } });
        uploaded++;
      } catch (error) {
        const name = encodeURIComponent(user.name);
        await prisma.user.update({
          where: { id: user.id },
          data: { picture: `https://ui-avatars.com/api/?name=${name}&background=random&color=fff` },
        });
        fallback++;
        if (fallback <= 3) {
          console.warn(
            `     ${user.email}: ${error instanceof Error ? error.message : error} — using a generated avatar`
          );
        }
      }
    }
  }

  await Promise.all(Array.from({ length: POOL }, worker));
  if (fallback > 3) console.warn(`     …and ${fallback - 3} more fell back to generated avatars`);

  return { uploaded, fallback };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

const SIZES: Record<string, [number, number]> = {
  squad: [4, 9],
  team: [12, 28],
  org: [45, 85],
};

async function createChannels(
  people: SeededUser[],
  insiders: SeededUser[],
  workspaceId: string,
  projectId: string
) {
  const channelRows: Prisma.ChannelCreateManyInput[] = [];
  const statsRows: Prisma.ChannelStatsCreateManyInput[] = [];
  const participantRows: Prisma.ChannelParticipantCreateManyInput[] = [];
  const statusRows: Prisma.ChannelUserStatusCreateManyInput[] = [];

  for (let i = 0; i < CHANNELS.length; i++) {
    const spec = CHANNELS[i];
    const [lo, hi] = SIZES[spec.size];
    const members = pick(people, between(lo, hi));

    // The people who actually log in are in roughly a third of the channels,
    // weighted towards the company-wide ones — otherwise the sidebar is empty
    // for the only account anyone signs into.
    const insiderChance = spec.size === 'org' ? 0.9 : spec.size === 'team' ? 0.35 : 0.2;
    const withInsiders = [
      ...members,
      ...(rand() < insiderChance ? insiders : []),
    ];

    const channelId = createId();
    const lastActivityAt = daysAgo(rand() * 30);

    channelRows.push({
      id: channelId,
      name: spec.name,
      description: spec.purpose,
      type: ChannelType.DEFAULT,
      scopeType: ChannelScopeType.DEFAULT,
      visibility:
        spec.visibility === 'PRIVATE' ? ChannelVisibility.PRIVATE : ChannelVisibility.PUBLIC,
      createdBy: members[0].id,
      projectId,
      workspaceId,
      participantCount: withInsiders.length,
      isMigrated: false,
      createdAt: daysAgo(between(30, 700)),
      lastActivityAt,
    });

    // Without a channel_stats row the channel never appears in the sidebar.
    statsRows.push({ channelId, workspaceId, lastActivityAt, participantCount: withInsiders.length });

    withInsiders.forEach((m, idx) => {
      participantRows.push({
        channelId,
        userId: m.id,
        workspaceId,
        role: idx === 0 ? ChannelRole.ADMIN : ChannelRole.MEMBER,
      });
      statusRows.push({
        channelId,
        userId: m.id,
        workspaceId,
        unreadCount: 0,
        isStarred: false,
      });
    });

    vespaJobs.push({ schema: 'chat_container', docId: channelId });
  }

  await insert(channelRows, (chunk) => prisma.channel.createMany({ data: chunk, skipDuplicates: true }));
  await insert(statsRows, (chunk) => prisma.channelStats.createMany({ data: chunk, skipDuplicates: true }));
  await insert(participantRows, (chunk) =>
    prisma.channelParticipant.createMany({ data: chunk, skipDuplicates: true })
  );
  await insert(statusRows, (chunk) =>
    prisma.channelUserStatus.createMany({ data: chunk, skipDuplicates: true })
  );

  return { channels: channelRows.length, participants: participantRows.length };
}

// ---------------------------------------------------------------------------
// #xyne-spaces
// ---------------------------------------------------------------------------

/**
 * The one channel with a conversation in it.
 *
 * Three things here are load-bearing:
 *
 *  1. The channel feed lists conversations, not messages, so every top-level
 *     remark is its own conversation and its replies are further messages in it.
 *  2. The UI renders from denormalized copies, not from the tables: the first
 *     bubble comes from `initial_message_md`, the "N replies" strip from
 *     `replies_md`, and reaction pills from `messages.reactions_md`. Writing only
 *     the rows produces a channel that looks empty.
 *  3. Conversations must not share a `createdAt` — the feed paginates on that
 *     cursor and ties make it return nothing.
 */
async function seedHeroChannel(
  people: SeededUser[],
  insiders: SeededUser[],
  workspaceId: string,
  projectId: string
) {
  const everyone = [...people, ...insiders];
  const channelId = createId();
  const owner = insiders[0] ?? people[16];

  await prisma.channel.create({
    data: {
      id: channelId,
      name: HERO_CHANNEL,
      description: 'The company channel — everyone is here. Releases, incidents, and the rest.',
      type: ChannelType.DEFAULT,
      scopeType: ChannelScopeType.DEFAULT,
      visibility: ChannelVisibility.PUBLIC,
      createdBy: owner.id,
      projectId,
      workspaceId,
      participantCount: everyone.length,
      isMigrated: false,
      createdAt: daysAgo(400),
      lastActivityAt: minsAgo(5),
    },
  });
  vespaJobs.push({ schema: 'chat_container', docId: channelId });

  await prisma.channelStats.create({
    data: { channelId, workspaceId, lastActivityAt: minsAgo(5), participantCount: everyone.length },
  });

  await insert(
    everyone.map((m, idx) => ({
      channelId,
      userId: m.id,
      workspaceId,
      role: m.id === owner.id || idx === 16 ? ChannelRole.ADMIN : ChannelRole.MEMBER,
    })),
    (chunk) => prisma.channelParticipant.createMany({ data: chunk, skipDuplicates: true })
  );
  await insert(
    everyone.map((m) => ({
      channelId,
      userId: m.id,
      workspaceId,
      unreadCount: 0,
      // Starred for the people who log in, so it sits at the top of their sidebar.
      isStarred: insiders.some((i) => i.id === m.id),
    })),
    (chunk) => prisma.channelUserStatus.createMany({ data: chunk, skipDuplicates: true })
  );

  let messageCount = 0;

  for (let t = 0; t < XYNE_SPACES.length; t++) {
    const thread = XYNE_SPACES[t];
    const conversationId = createId();

    // Threads march forward in time, oldest first, ending a few minutes ago.
    // Widely spaced so no two conversations can collide on createdAt.
    const baseMinutes = (XYNE_SPACES.length - t) * 420 - t * 7;
    const lines = [thread, ...thread.replies];
    const messageIds: string[] = [];
    let initialMd: string | null = null;

    for (let k = 0; k < lines.length; k++) {
      const line = lines[k];
      const messageId = createId();
      messageIds.push(messageId);

      const sender = people[line.from % people.length];
      const createdAt = minsAgo(baseMinutes - k * 3);

      // Reactions come from a handful of other members, and the pill count in
      // the UI is read from reactions_md.
      let reactionsMd: string | null = null;
      const reactors = line.react ? pick(everyone.filter((u) => u.id !== sender.id), between(1, 6)) : [];
      if (line.react && reactors.length) {
        reactionsMd = serializeReactionsMd({ [line.react]: reactors.map((r) => r.id) });
      }

      await prisma.message.create({
        data: {
          messageId,
          conversationId,
          senderId: sender.id,
          workspaceId,
          content: line.text,
          msgType: MessageType.USER,
          // Not "visible in the channel" — it marks a thread reply that was also
          // broadcast, and the UI then withholds the reply action.
          showInChannel: false,
          createdAt,
          reactions_md: reactionsMd,
        },
      });
      messageCount++;
      vespaJobs.push({ schema: 'chat_message', docId: messageId });

      if (line.react && reactors.length) {
        await prisma.reaction.createMany({
          data: reactors.map((r) => ({
            workspaceId,
            messageId,
            userId: r.id,
            emojiName: line.react as string,
          })),
          skipDuplicates: true,
        });
        await prisma.reactionCount.create({
          data: { workspaceId, messageId, emojiName: line.react, count: reactors.length },
        });
      }

      if (k === 0) {
        initialMd = serializeInitialMessageMd({
          messageId,
          conversationId,
          senderId: sender.id,
          content: line.text,
          msgType: SharedMessageType.USER,
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          showInChannel: false,
          visibleTo: null,
          createdAt: createdAt.getTime(),
          isSent: true,
        });
      }
    }

    // Ordered, de-duplicated, most recent last — what the reply strip draws.
    const repliers: string[] = [];
    for (const r of thread.replies) {
      const id = people[r.from % people.length].id;
      const at = repliers.indexOf(id);
      if (at >= 0) repliers.splice(at, 1);
      repliers.push(id);
    }

    await prisma.conversation.create({
      data: {
        conversationId,
        channelId,
        workspaceId,
        createdBy: people[thread.from % people.length].id,
        initialMessageId: messageIds[0],
        createdAt: minsAgo(baseMinutes),
        lastActivityAt: minsAgo(baseMinutes - (lines.length - 1) * 3),
        replyCount: thread.replies.length,
        initial_message_md: initialMd,
        replies_md: serializeRepliesMd({ repliers }),
      },
    });
  }

  return { channelId, members: everyone.length, threads: XYNE_SPACES.length, messageCount };
}

// ---------------------------------------------------------------------------
// Vespa
// ---------------------------------------------------------------------------

async function queueForVespa(workspaceId: string, orgId: string, userId: string) {
  if (SKIP_VESPA) {
    console.log(`\n  ⏭  ORG_SKIP_VESPA=1 — skipped queueing ${vespaJobs.length} documents`);
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
    } catch {
      // One failed enqueue is not worth stopping a seed over.
    }
  }

  await vespaQueue.close();
  console.log(`\n  🔍 Queued ${queued}/${vespaJobs.length} documents for Vespa indexing`);
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\n🌱 Seeding a 100-person workspace\n');

  const { workspace, orgId, insiders } = await getFoundation();
  console.log(`  workspace: ${workspace.name}`);
  console.log(`  existing accounts kept in the loop: ${insiders.map((i) => i.email).join(', ') || 'none'}`);

  if (WIPE) await wipe();

  const existing = await prisma.project.findFirst({
    where: { code: PROJECT_CODE },
    select: { id: true },
  });
  if (existing) {
    console.log(`\n  ✅ Already seeded (project ${PROJECT_CODE}) — nothing to do.`);
    console.log('     Re-run with ORG_WIPE=1 to replace it.\n');
    return;
  }

  const project = await prisma.project.create({
    data: {
      name: PROJECT_NAME,
      code: PROJECT_CODE,
      description: 'Payment rails, bank integrations, settlements and risk.',
      workspaceId: workspace.id,
      createdBy: insiders[0]?.id ?? (await prisma.user.findFirstOrThrow({ select: { id: true } })).id,
    },
    select: { id: true },
  });
  vespaJobs.push({ schema: 'project', docId: project.id });

  const people = await createPeople(workspace.id, orgId);
  console.log(`  👥 ${people.length} people`);

  const avatars = await attachAvatars(people);
  if (!SKIP_AVATARS) {
    console.log(`  🖼  ${avatars.uploaded} avatars uploaded to the bucket, ${avatars.fallback} generated`);
  }

  const { channels, participants } = await createChannels(people, insiders, workspace.id, project.id);
  console.log(`  #️⃣  ${channels} channels, ${participants} memberships`);

  const hero = await seedHeroChannel(people, insiders, workspace.id, project.id);
  console.log(
    `  💬 #${HERO_CHANNEL} — ${hero.members} members, ${hero.threads} conversations, ${hero.messageCount} messages`
  );

  await queueForVespa(workspace.id, orgId, insiders[0]?.id ?? people[0].id);

  console.log('\n✅ Workspace seeded');
  console.log(
    `   ${people.length} people · ${channels + 1} channels · ${hero.messageCount} messages in #${HERO_CHANNEL}\n`
  );
}

main()
  .catch((error) => {
    console.error('\n❌ Org seed failed:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
